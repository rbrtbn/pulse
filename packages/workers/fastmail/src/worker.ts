import type { StoreError, SyncRun } from "@cerebro/core";
import { FastmailJmap } from "@cerebro/jmap";
import { recordSyncRun, setSyncCursor, StoreDb, upsertEmails } from "@cerebro/store";
import { Effect } from "effect";

import { bootstrapStrategy, type Strategy, type StrategyError } from "./strategy";

export const WORKER_NAME = "fastmail";

/**
 * One Sync Run. Picks a strategy (M1.1: always Bootstrap), runs it
 * through the envelope, returns the recorded `SyncRun`.
 *
 * The envelope handles framing — startedAt/endedAt, the
 * `upsertEmails` + `setSyncCursor` writes on success, the
 * `recordSyncRun(failed)` route on Source-side errors. The residual
 * `StoreError` channel covers the rare case where the Store itself
 * is unreachable: no row to write, so the caller surfaces it
 * directly (the CLI's exit-code-2 path, the web loader's `redactToLoader`).
 *
 * **M1.1 ships the Bootstrap strategy only.** The cursor returned
 * from this run becomes the starting point for M1.2's Incremental
 * path. M1.1 always runs Bootstrap even when a cursor already exists
 * — re-fetching the 30-day window is idempotent under upsert.
 */
export const runSyncRun = (): Effect.Effect<SyncRun, StoreError, FastmailJmap | StoreDb> =>
  Effect.gen(function* () {
    const startedAt = new Date();
    return yield* runWithEnvelope(startedAt, bootstrapStrategy(startedAt));
  });

/**
 * Envelope around a Sync Run strategy. Same shape for every strategy
 * — Bootstrap today, Incremental + Catchup in M1.2 — so the framing
 * lives in one place and every future Source-side error tag flows
 * through the same recording path.
 *
 * Exported for direct testing (the test calls it with a hand-built
 * strategy that yields a known result, separately from the live
 * Bootstrap discovery).
 */
export const runWithEnvelope = (
  startedAt: Date,
  strategy: Strategy,
): Effect.Effect<SyncRun, StoreError, FastmailJmap | StoreDb> =>
  strategy.pipe(
    Effect.flatMap((result) =>
      Effect.gen(function* () {
        yield* upsertEmails(result.rows);
        yield* setSyncCursor(WORKER_NAME, result.cursorToken);
        return yield* recordSyncRun({
          workerName: WORKER_NAME,
          startedAt,
          endedAt: new Date(),
          status: "succeeded",
          ...(result.annotation === undefined ? {} : { annotation: result.annotation }),
        });
      }),
    ),
    Effect.catchTags({
      AuthError: (err) => recordFailure(startedAt, err),
      TransportError: (err) => recordFailure(startedAt, err),
      MalformedSourceResponse: (err) => recordFailure(startedAt, err),
    }),
  );

const recordFailure = (startedAt: Date, err: StrategyError) =>
  recordSyncRun({
    workerName: WORKER_NAME,
    startedAt,
    endedAt: new Date(),
    status: "failed",
    errorTag: err._tag,
    errorMessage: err.detail,
  });
