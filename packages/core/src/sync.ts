import { Schema } from "effect";

/**
 * Sync Run status — binary per ADR 0004. Sync Run *kind* (Bootstrap /
 * Incremental / Catchup) is not in the status enum; Catchup recoveries are
 * audited via the error_tag field on a succeeded row.
 */
export const SyncRunStatus = Schema.Literal("succeeded", "failed");
export type SyncRunStatus = Schema.Schema.Type<typeof SyncRunStatus>;

/**
 * One execution of a Worker against its Source.
 *
 * `errorTag` is nullable on both succeeded and failed rows:
 *   - On failed rows it categorises the failure (`MalformedSourceResponse`,
 *     `TransportError`, `AuthError`, `StoreError`).
 *   - On succeeded rows it optionally annotates the run (e.g.
 *     `recovered_via_catchup` after a cursor-expiry Catchup; see ADR 0004).
 *
 * Per ADR 0002, the SQL table name is `cerebro_sync_runs`.
 */
export const SyncRun = Schema.Struct({
  id: Schema.Number,
  workerName: Schema.String,
  startedAt: Schema.DateFromSelf,
  endedAt: Schema.DateFromSelf,
  status: SyncRunStatus,
  errorTag: Schema.NullOr(Schema.String),
  errorMessage: Schema.NullOr(Schema.String),
});

export type SyncRun = Schema.Schema.Type<typeof SyncRun>;

/**
 * Per-Worker change-stream cursor — the JMAP state token (or any future
 * Source's equivalent). Written transactionally with email writes inside a
 * successful Sync Run.
 *
 * Per ADR 0002, the SQL table name is `cerebro_sync_cursor`.
 */
export const SyncCursor = Schema.Struct({
  workerName: Schema.String,
  stateToken: Schema.String,
  updatedAt: Schema.DateFromSelf,
});

export type SyncCursor = Schema.Schema.Type<typeof SyncCursor>;
