import { Data } from "effect";

/**
 * Schema validation failed at a Source boundary.
 *
 * Recorded as the error_tag on a failed Sync Run when the JMAP response did
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
 * error). Distinct from TransportError so the Worker (and the future Concierge
 * surface) can prompt for re-auth specifically.
 */
export class AuthError extends Data.TaggedError("AuthError")<{
  source: string;
  detail: string;
}> {}

/**
 * The Store rejected a read or write — e.g., a transaction conflict, a
 * constraint violation, a corrupt file. Indicates Cerebro-internal damage,
 * not a Source problem.
 */
export class StoreError extends Data.TaggedError("StoreError")<{
  detail: string;
}> {}

/**
 * Mark-read failed end-to-end (JMAP Email/set rejected, or the subsequent
 * Store update failed). Distinct from StoreError because the failure can
 * surface inline on a /inbox row and the user can retry without restarting.
 *
 * Used by M1.2 (mark-read). Defined here in M1.1 so the error inventory is
 * complete from the first commit.
 */
export class MarkReadError extends Data.TaggedError("MarkReadError")<{
  detail: string;
  emailId: string;
}> {}
