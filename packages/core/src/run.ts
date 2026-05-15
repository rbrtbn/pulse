import { Schema } from "effect";

/**
 * Run status — binary per ADR 0004. Run *kind* (Bootstrap /
 * Incremental / Catchup) is not in the status enum; Catchup recoveries are
 * audited via the error_tag field on a succeeded row.
 */
export const RunStatus = Schema.Literal("succeeded", "failed");
export type RunStatus = Schema.Schema.Type<typeof RunStatus>;

/**
 * One execution of a Connector against its Source.
 *
 * `errorTag` is nullable on both succeeded and failed rows:
 *   - On failed rows it categorises the failure (`MalformedSourceResponse`,
 *     `TransportError`, `AuthError`, `DatabaseError`).
 *   - On succeeded rows it optionally annotates the run (e.g.
 *     `recovered_via_catchup` after a cursor-expiry Catchup; see ADR 0004).
 *
 * Per ADR 0002, the SQL table name is `pulse_runs`.
 */
export const Run = Schema.Struct({
  id: Schema.Number,
  connectorName: Schema.String,
  startedAt: Schema.DateFromSelf,
  endedAt: Schema.DateFromSelf,
  status: RunStatus,
  errorTag: Schema.NullOr(Schema.String),
  errorMessage: Schema.NullOr(Schema.String),
});

export type Run = Schema.Schema.Type<typeof Run>;

/**
 * Per-Connector change-stream cursor — the JMAP state token (or any future
 * Source's equivalent). Written transactionally with email writes inside a
 * successful Run.
 *
 * Per ADR 0002, the SQL table name is `pulse_connector_cursors`.
 */
export const ConnectorCursor = Schema.Struct({
  connectorName: Schema.String,
  stateToken: Schema.String,
  updatedAt: Schema.DateFromSelf,
});

export type ConnectorCursor = Schema.Schema.Type<typeof ConnectorCursor>;
