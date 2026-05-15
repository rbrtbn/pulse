import {
  type AuthError,
  type CannotCalculateChanges,
  type MalformedSourceResponse,
  type TransportError,
} from "@pulse/core";
import { Schema } from "effect";

/**
 * Errors common to every JMAP client method. Mapped from underlying
 * causes (network, HTTP status, schema validation) to the tagged-error
 * inventory in @pulse/core so callers handle them with `Effect.catchTag`.
 */
export type JmapError = AuthError | MalformedSourceResponse | TransportError;

/**
 * Error union for `emailChanges` specifically — extends `JmapError` with
 * the change-stream-specific failure that triggers the Catchup strategy
 * per ADR 0004. Kept separate so the recovery error doesn't leak into
 * method signatures (`mailboxGet`, `emailQuery`, `emailGet`) that can't
 * actually produce it.
 */
export type JmapChangesError = JmapError | CannotCalculateChanges;

/** A JMAP method call triple: ["Method/name", arguments, clientCallId]. */
export type JmapMethodCall = readonly [string, Record<string, unknown>, string];

/** Server's response to one method call. */
export type JmapMethodResponse = readonly [string, Record<string, unknown>, string];

/** The full JMAP HTTP response body. */
export type JmapResponse = {
  readonly sessionState: string;
  readonly methodResponses: ReadonlyArray<JmapMethodResponse>;
};

/**
 * Response schemas. Defined here (not in `client.ts`) so the public
 * transport types (`Mailbox`, `EmailQueryResult`) can be *derived* from
 * the schemas — keeping the runtime decoder and the static type in
 * lockstep without parallel hand-written shapes that drift.
 *
 * Only the subset of fields the M1 slice reads is validated; the Schema
 * rejects malformed responses but ignores extra fields.
 */

/** JMAP session document — only the fields the client uses. */
export const SessionSchema = Schema.Struct({
  apiUrl: Schema.String,
  primaryAccounts: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type Session = Schema.Schema.Type<typeof SessionSchema>;

/** JMAP Mailbox object — the subset we read for INBOX discovery. */
export const MailboxSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.NullOr(Schema.String),
});
export type Mailbox = Schema.Schema.Type<typeof MailboxSchema>;

/** Mailbox/get response — `list` is the array of mailboxes for the query. */
export const MailboxGetResponseSchema = Schema.Struct({
  list: Schema.Array(MailboxSchema),
});

/** Email/query response — anchored ids + the cursor token to seed Incremental. */
export const EmailQueryResponseSchema = Schema.Struct({
  ids: Schema.Array(Schema.String),
  queryState: Schema.String,
});
export type EmailQueryResult = Schema.Schema.Type<typeof EmailQueryResponseSchema>;

/**
 * Email/get response. The `list` entries are deliberately unknown — the
 * Connector validates each one against `JmapEmail` from `@pulse/core`,
 * keeping the per-entry boundary check in one place.
 */
export const EmailGetResponseSchema = Schema.Struct({
  list: Schema.Array(Schema.Unknown),
});

/**
 * Email/changes response — IDs that entered, mutated, or vanished since
 * `sinceState`. `newState` becomes the next cursor; `hasMoreChanges`
 * signals a truncated batch (M1.2 picks up the rest on the next run).
 */
export const EmailChangesResponseSchema = Schema.Struct({
  created: Schema.Array(Schema.String),
  updated: Schema.Array(Schema.String),
  destroyed: Schema.Array(Schema.String),
  newState: Schema.String,
  hasMoreChanges: Schema.Boolean,
});
export type EmailChangesResult = Schema.Schema.Type<typeof EmailChangesResponseSchema>;

/** Filter passed to Email/query. The PRD only needs inMailbox + after. */
export type EmailFilter = {
  readonly inMailbox?: string;
  readonly after?: string;
};

/** Sort spec passed to Email/query. */
export type EmailSort = {
  readonly property: string;
  readonly isAscending?: boolean;
};

export type EmailQueryParams = {
  readonly filter?: EmailFilter;
  readonly sort?: ReadonlyArray<EmailSort>;
  readonly limit?: number;
  readonly position?: number;
};
