import { type AuthError, type MalformedSourceResponse, type TransportError } from "@cerebro/core";
import { Schema } from "effect";

/**
 * Union of all errors the JMAP client surfaces. Mapped from underlying
 * causes (network, HTTP status, schema validation) to the tagged-error
 * inventory in @cerebro/core so callers handle them with `Effect.catchTag`.
 */
export type JmapError = AuthError | MalformedSourceResponse | TransportError;

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
 * Worker validates each one against `JmapEmail` from `@cerebro/core`,
 * keeping the per-entry boundary check in one place.
 */
export const EmailGetResponseSchema = Schema.Struct({
  list: Schema.Array(Schema.Unknown),
});

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
