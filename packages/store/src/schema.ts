import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema for the Cerebro Store.
 *
 * Conventions:
 * - SQL table names carry the `cerebro_*` prefix per ADR 0002 (service
 *   namespacing for the eventual shared-Postgres future).
 * - TS bindings stay short (e.g., `emails`, `syncRuns`) — application code
 *   reads cleanly while the SQL identifier is namespaced.
 * - PG-portable column types only per ADR 0001: text(), integer() with
 *   explicit modes. No FTS5, no JSON1 idioms. Dates stored as Unix seconds
 *   via integer({ mode: 'timestamp' }), boolean as 0/1 via integer({
 *   mode: 'boolean' }).
 */

/**
 * cerebro_emails — metadata-only mirror of Fastmail INBOX per ADR 0005.
 *
 * Keyed by JMAP email id. No bodies, attachments, or recipient lists; the
 * Curator fetches those on demand when it eventually needs them.
 */
export const emails = sqliteTable(
  "cerebro_emails",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    isUnread: integer("is_unread", { mode: "boolean" }).notNull(),
    fromName: text("from_name"),
    fromEmail: text("from_email").notNull(),
    subject: text("subject").notNull(),
    preview: text("preview").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
    firstSeen: integer("first_seen", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastSeen: integer("last_seen", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    source: text("source").notNull(),
  },
  (table) => ({
    // /inbox query: unread-first, latest-message-first.
    unreadReceivedAt: index("idx_emails_unread_received_at").on(table.isUnread, table.receivedAt),
    // Thread aggregation lookups.
    threadId: index("idx_emails_thread_id").on(table.threadId),
  }),
);

/**
 * cerebro_sync_runs — one row per Worker execution.
 *
 * Per ADR 0004 the status enum is binary (`succeeded` | `failed`). errorTag
 * is nullable and meaningful on both kinds of row: it categorises failures
 * on failed rows, and on succeeded rows it optionally annotates the run
 * (e.g. `recovered_via_catchup` after the recovery path runs).
 */
export const syncRuns = sqliteTable(
  "cerebro_sync_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workerName: text("worker_name").notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp" }).notNull(),
    status: text("status").notNull(),
    errorTag: text("error_tag"),
    errorMessage: text("error_message"),
  },
  (table) => ({
    workerStartedAt: index("idx_sync_runs_worker_started_at").on(table.workerName, table.startedAt),
  }),
);

/**
 * cerebro_sync_cursor — per-Worker change-stream cursor.
 *
 * The JMAP state token (or any future Source's equivalent) returned by the
 * most recent successful Sync Run. Written transactionally with email
 * writes so the cursor never advances ahead of the data it represents.
 */
export const syncCursor = sqliteTable("cerebro_sync_cursor", {
  workerName: text("worker_name").primaryKey(),
  stateToken: text("state_token").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
