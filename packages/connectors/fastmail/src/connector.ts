import type { DatabaseError, Run } from "@pulse/core";
import { FastmailJmap } from "@pulse/jmap";
import {
  deleteEmailsByIds,
  getConnectorCursor,
  recordRun,
  setConnectorCursor,
  PulseDb,
  upsertEmails,
} from "@pulse/database";
import { Effect } from "effect";

import {
  bootstrapStrategy,
  incrementalStrategy,
  type Strategy,
  type StrategyError,
} from "./strategy";

export const CONNECTOR_NAME = "fastmail";

/**
 * One Run. Picks a strategy based on cursor state — Bootstrap on a
 * fresh Database, Incremental once a cursor exists (with internal Catchup
 * recovery when the cursor is rejected). Runs the chosen strategy
 * through the envelope, returns the recorded `Run`.
 *
 * The envelope handles framing — startedAt/endedAt, the
 * `upsertEmails` + `deleteEmailsByIds` + `setConnectorCursor` writes on
 * success, the `recordRun(failed)` route on Source-side errors.
 * The residual `DatabaseError` channel covers the rare case where the
 * Database itself is unreachable: no row to write, so the caller surfaces
 * it directly (the CLI's exit-code-2 path, the web loader's
 * `redactToLoader`).
 */
export const runOnce = (): Effect.Effect<Run, DatabaseError, FastmailJmap | PulseDb> =>
  Effect.gen(function* () {
    const startedAt = new Date();
    const cursor = yield* getConnectorCursor(CONNECTOR_NAME);
    const strategy: Strategy =
      cursor === null
        ? bootstrapStrategy(startedAt)
        : incrementalStrategy(startedAt, cursor.stateToken);
    return yield* runWithEnvelope(startedAt, strategy);
  });

/**
 * Envelope around a Run strategy. Same shape for every strategy
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
): Effect.Effect<Run, DatabaseError, FastmailJmap | PulseDb> =>
  strategy.pipe(
    Effect.flatMap((result) =>
      Effect.gen(function* () {
        yield* upsertEmails(result.rows);
        yield* deleteEmailsByIds(result.idsToDelete ?? []);
        yield* setConnectorCursor(CONNECTOR_NAME, result.cursorToken);
        return yield* recordRun({
          connectorName: CONNECTOR_NAME,
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
  recordRun({
    connectorName: CONNECTOR_NAME,
    startedAt,
    endedAt: new Date(),
    status: "failed",
    errorTag: err._tag,
    errorMessage: err.detail,
  });
