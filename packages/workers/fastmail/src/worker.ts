import type { StoreError, SyncRun } from "@cerebro/core";
import { FastmailJmap } from "@cerebro/jmap";
import {
  deleteEmailsByIds,
  getSyncCursor,
  recordSyncRun,
  setSyncCursor,
  StoreDb,
  upsertEmails,
} from "@cerebro/store";
import { Effect } from "effect";

import {
  bootstrapStrategy,
  incrementalStrategy,
  type Strategy,
  type StrategyError,
} from "./strategy";

export const WORKER_NAME = "fastmail";

/**
 * One Sync Run. Picks a strategy based on cursor state — Bootstrap on a
 * fresh Store, Incremental once a cursor exists (with internal Catchup
 * recovery when the cursor is rejected). Runs the chosen strategy
 * through the envelope, returns the recorded `SyncRun`.
 *
 * The envelope handles framing — startedAt/endedAt, the
 * `upsertEmails` + `deleteEmailsByIds` + `setSyncCursor` writes on
 * success, the `recordSyncRun(failed)` route on Source-side errors.
 * The residual `StoreError` channel covers the rare case where the
 * Store itself is unreachable: no row to write, so the caller surfaces
 * it directly (the CLI's exit-code-2 path, the web loader's
 * `redactToLoader`).
 */
export const runSyncRun = (): Effect.Effect<SyncRun, StoreError, FastmailJmap | StoreDb> =>
  Effect.gen(function* () {
    const startedAt = new Date();
    const cursor = yield* getSyncCursor(WORKER_NAME);
    const strategy: Strategy =
      cursor === null
        ? bootstrapStrategy(startedAt)
        : incrementalStrategy(startedAt, cursor.stateToken);
    return yield* runWithEnvelope(startedAt, strategy);
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
        yield* deleteEmailsByIds(result.idsToDelete ?? []);
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
