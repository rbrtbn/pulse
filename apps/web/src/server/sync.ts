import type { DatabaseError, Run } from "@pulse/core";
import { runOnce } from "@pulse/connector-fastmail";
import type { PulseDb } from "@pulse/database";
import { FastmailJmap, FastmailJmapLive } from "@pulse/jmap";
import { Effect, Layer } from "effect";

import { PulseDbAppLayer } from "./db";
import { redactToLoader } from "./redact";

const FASTMAIL_TOKEN_ENV = "FASTMAIL_API_TOKEN";

/**
 * Outcome of an App-triggered Run. A Source-side failure
 * (Auth/Transport/Malformed) still resolves here as `status: "failed"` —
 * the Run row exists and the /inbox failure banner reads it once the
 * loader re-runs. Only an unreachable Database rejects the promise.
 */
export type SyncResult = {
  runId: number;
  status: Run["status"];
};

const toResult = (run: Run): SyncResult => ({ runId: run.id, status: run.status });

/**
 * The App→Connector write path of ADR 0003: one Fastmail Run, driven by
 * the same `runOnce` the `bin/sync-fastmail` CLI uses. Layer-injected so
 * tests provide a stubbed JMAP transport + in-memory Database; `runSync`
 * provides the live layers.
 *
 * `LE` is the layer's own construction-error channel (the live JMAP layer
 * can fail to build); it joins `DatabaseError` so `redactToLoader` redacts
 * either before it reaches the browser.
 */
export const runFastmailSync = <LE>(
  layers: Layer.Layer<FastmailJmap | PulseDb, LE>,
): Effect.Effect<SyncResult, DatabaseError | LE, never> =>
  runOnce().pipe(Effect.map(toResult), Effect.provide(layers));

/**
 * Production entry point behind the /inbox "Sync now" button. Reads
 * `FASTMAIL_API_TOKEN` from the dev server's process env (populated by
 * `bin/dev` → `keyring exec`, the same precedent as `bin/sync-fastmail`),
 * runs one Run against the live Database, and redacts any raw
 * better-sqlite3 detail before it can reach the browser.
 */
export const runSync = async (): Promise<SyncResult> => {
  const token = process.env[FASTMAIL_TOKEN_ENV];
  if (token === undefined || token === "") {
    throw new Error(`${FASTMAIL_TOKEN_ENV} is not set — start the dev server via bin/dev`);
  }
  const layers = Layer.merge(FastmailJmapLive({ token }), PulseDbAppLayer);
  return redactToLoader("Sync", runFastmailSync(layers));
};
