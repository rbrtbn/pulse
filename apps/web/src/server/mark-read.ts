import { markRead } from "@pulse/connector-fastmail";
import type { MarkReadError } from "@pulse/core";
import type { PulseDb } from "@pulse/database";
import { FastmailJmap, FastmailJmapLive, type JmapError } from "@pulse/jmap";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { PulseDbAppLayer } from "./db";

const FASTMAIL_TOKEN_ENV = "FASTMAIL_API_TOKEN";

/**
 * Outcome of an App-triggered mark-read. Any failure — a Source-side
 * JMAP error or the follow-up Database write — resolves here as
 * `ok: false` carrying the error tag + message, so the /inbox row
 * renders it inline and stays put for a retry. Unlike the loader path,
 * mark-read does NOT redact: `MarkReadError` is user-facing by design
 * (see its declaration in `@pulse/core`). The promise rejects only on a
 * defect — a genuine bug, not an expected failure.
 */
export type MarkReadResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errorTag: string; readonly errorMessage: string };

/**
 * The App→Connector seam (ADR 0003), layer-injected so tests provide a
 * stubbed JMAP transport + in-memory Database; `runMarkReadLive` provides
 * the live layers.
 */
export const runMarkRead = <LE>(
  emailId: string,
  layers: Layer.Layer<FastmailJmap | PulseDb, LE>,
): Effect.Effect<void, MarkReadError | LE, never> => markRead(emailId).pipe(Effect.provide(layers));

/** Map the Effect outcome to a MarkReadResult; a defect rethrows (it's a bug). */
const toResult = (exit: Exit.Exit<void, MarkReadError | JmapError>): MarkReadResult => {
  if (Exit.isSuccess(exit)) return { ok: true };
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) {
    throw new Error("Mark-read failed unexpectedly");
  }
  return { ok: false, errorTag: failure.value._tag, errorMessage: failure.value.detail };
};

/**
 * Production entry point behind a /inbox row click. Reads
 * `FASTMAIL_API_TOKEN` from the dev server's process env (injected by
 * `kr exec` via the `pnpm dev` script), runs markRead against the live
 * Database, and converts the typed outcome to a MarkReadResult.
 */
export const runMarkReadLive = async (emailId: string): Promise<MarkReadResult> => {
  const token = process.env[FASTMAIL_TOKEN_ENV];
  if (token === undefined || token === "") {
    throw new Error(`${FASTMAIL_TOKEN_ENV} is not set — start the dev server via pnpm dev`);
  }
  const layers = Layer.merge(FastmailJmapLive({ token }), PulseDbAppLayer);
  return toResult(await Effect.runPromiseExit(runMarkRead(emailId, layers)));
};
