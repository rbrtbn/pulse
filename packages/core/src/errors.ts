import { Data } from "effect";

/**
 * Schema validation failed at a Source boundary.
 *
 * Recorded as the error_tag on a failed Run when the JMAP response did
 * not match the Effect Schema for JmapEmail (or any other Source response).
 */
export class MalformedSourceResponse extends Data.TaggedError("MalformedSourceResponse")<{
  source: string;
  detail: string;
}> {}

/**
 * Transport-level failure reaching the Source — network error, HTTP 5xx,
 * connection refused, DNS, etc. Distinct from AuthError (which is the server
 * rejecting credentials) and MalformedSourceResponse (which is the server
 * returning content that doesn't validate).
 */
export class TransportError extends Data.TaggedError("TransportError")<{
  source: string;
  detail: string;
}> {}

/**
 * The Source rejected our credentials (HTTP 401 / 403, or a JMAP-level auth
 * error). Distinct from TransportError so the Connector (and the future Chat
 * surface) can prompt for re-auth specifically.
 */
export class AuthError extends Data.TaggedError("AuthError")<{
  source: string;
  detail: string;
}> {}

/**
 * The Database rejected a read or write — e.g., a transaction conflict, a
 * constraint violation, a corrupt file. Indicates Pulse-internal damage,
 * not a Source problem. `op` names the query that failed so logs can
 * attribute the failure without a stack trace.
 */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  op: string;
  detail: string;
}> {}

/**
 * Mark-read failed end-to-end (JMAP Email/set rejected, or the subsequent
 * Database update failed). Distinct from DatabaseError because the failure can
 * surface inline on a /inbox row and the user can retry without restarting.
 *
 * Used by M1.2 (mark-read). Defined here in M1.1 so the error inventory is
 * complete from the first commit.
 */
export class MarkReadError extends Data.TaggedError("MarkReadError")<{
  detail: string;
  emailId: string;
}> {}

/**
 * The Source's change-stream cannot reconstruct the delta from the
 * supplied state token — the server has compacted its change log past
 * that point. Triggered by JMAP's `cannotCalculateChanges` method error.
 *
 * Distinct from `MalformedSourceResponse`: the response *is* well-formed
 * — it's a protocol-level "I can no longer answer that". The Fastmail
 * Connector catches this tag and falls back to the Catchup strategy
 * (ID-diff against the 30-day window) per ADR 0004.
 */
export class CannotCalculateChanges extends Data.TaggedError("CannotCalculateChanges")<{
  source: string;
}> {}
