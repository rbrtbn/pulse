import { Schema } from "effect";

/**
 * Single sender entry in a JMAP Email.from list.
 *
 * Per JMAP spec, name is optional (some addresses are bare email only).
 */
const EmailAddress = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.String,
});

/**
 * JMAP Email transport shape — the subset of properties M1 reads from the
 * Source. JMAP itself returns many more properties; we only validate what we
 * use, so the Schema rejects malformed responses without policing fields
 * Cerebro doesn't care about.
 *
 * Reference: JMAP spec §4 (jmap.io/spec-mail.html#emails).
 */
export const JmapEmail = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  mailboxIds: Schema.Record({ key: Schema.String, value: Schema.Boolean }),
  /**
   * keywords is a JMAP record; presence of `$seen` means the message is read.
   * Absent or false means unread. Optional because some Email/changes responses
   * omit keywords when only mailboxIds changed.
   */
  keywords: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Boolean })),
  from: Schema.NullOr(Schema.Array(EmailAddress)),
  subject: Schema.NullOr(Schema.String),
  /**
   * Server-computed snippet, ~256 chars. Stored verbatim — Cerebro does not
   * derive its own preview from message bodies (ADR 0005).
   */
  preview: Schema.String,
  /**
   * RFC 3339 UTC datetime. We keep it as a string at the transport boundary;
   * the Worker parses it into a Date for the Store row.
   */
  receivedAt: Schema.String,
});

export type JmapEmail = Schema.Schema.Type<typeof JmapEmail>;

/**
 * EmailRow — what we persist in `cerebro_emails`.
 *
 * Per ADR 0005 (metadata-only Store), this is intentionally minimal: no body
 * content, no attachments, no full recipient lists. Bodies are fetched on
 * demand by the future Curator/Concierge via packages/jmap.
 *
 * Cerebro metadata columns (firstSeen, lastSeen, source) are managed by the
 * Worker on insert/update; the user-visible content is everything else.
 *
 * Per ADR 0002, the SQL table name is `cerebro_emails`; the Drizzle TS binding
 * stays short (just `emails`).
 */
export const EmailRow = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  isUnread: Schema.Boolean,
  fromName: Schema.NullOr(Schema.String),
  fromEmail: Schema.String,
  subject: Schema.String,
  preview: Schema.String,
  receivedAt: Schema.DateFromSelf,
  /** When the Worker first observed this email in any Sync Run. */
  firstSeen: Schema.DateFromSelf,
  /** When the Worker most recently observed this email (advances on every Sync Run that sees it). */
  lastSeen: Schema.DateFromSelf,
  /** Source identifier — future Workers contribute their own (e.g., "github"). */
  source: Schema.Literal("fastmail"),
});

export type EmailRow = Schema.Schema.Type<typeof EmailRow>;
