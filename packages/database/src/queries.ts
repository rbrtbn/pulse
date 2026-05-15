import type { EmailRow, DatabaseError, ConnectorCursor, Run } from "@pulse/core";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import { PulseDb, tryDb } from "./db";
import { emails, connectorCursor, runs } from "./schema";

/**
 * Aggregated thread row rendered as one line on /inbox.
 *
 * - `distinctOthers` = (distinct sender emails in the thread) − 1. Drives
 *   the "Latest Name +N others" sender display: when 0, render just the
 *   latest sender; when ≥1, append " +N others".
 */
export type UnreadThread = {
  threadId: string;
  latestFromName: string | null;
  latestFromEmail: string;
  subject: string;
  preview: string;
  receivedAt: Date;
  messageCount: number;
  distinctOthers: number;
};

/**
 * /inbox query: top-50 unread threads in INBOX, ordered by latest-message
 * desc, with sender-display aggregation.
 *
 * Two-step approach: (1) list distinct thread ids with any unread message;
 * (2) pull every message row for those threads; (3) summarise in TS.
 * The 30-day bootstrap window keeps the row count bounded; the second
 * query is at most a few thousand rows on a heavy inbox, sub-millisecond
 * against an indexed local SQLite.
 *
 * Could be expressed as a single CTE/window query for theoretical
 * efficiency, but the simpler shape is correct, portable, and trivially
 * testable.
 */
export const upcomingUnreadThreads = (): Effect.Effect<UnreadThread[], DatabaseError, PulseDb> =>
  tryDb("upcomingUnreadThreads", (db) => {
    const unreadThreadRows = db
      .selectDistinct({ threadId: emails.threadId })
      .from(emails)
      .where(eq(emails.isUnread, true))
      .all();

    if (unreadThreadRows.length === 0) return [];

    const threadIds = unreadThreadRows.map((r) => r.threadId);
    const rows = db.select().from(emails).where(inArray(emails.threadId, threadIds)).all();

    const byThread = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = byThread.get(row.threadId);
      if (bucket) {
        bucket.push(row);
      } else {
        byThread.set(row.threadId, [row]);
      }
    }

    const threads: UnreadThread[] = [];
    for (const [threadId, msgs] of byThread) {
      const sorted = [...msgs].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
      const latest = sorted[0];
      if (latest === undefined) continue;
      const distinctSenders = new Set(msgs.map((m) => m.fromEmail));
      threads.push({
        threadId,
        latestFromName: latest.fromName,
        latestFromEmail: latest.fromEmail,
        subject: latest.subject,
        preview: latest.preview,
        receivedAt: latest.receivedAt,
        messageCount: msgs.length,
        distinctOthers: Math.max(0, distinctSenders.size - 1),
      });
    }

    threads.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    return threads.slice(0, 50);
  });

/**
 * Upsert by JMAP email id. For existing rows the user-visible columns are
 * updated, `last_seen` advances, and `first_seen` is preserved. For new
 * rows the Connector supplies first_seen/last_seen explicitly (typically
 * `new Date()` at Run time).
 */
export const upsertEmails = (
  rows: ReadonlyArray<EmailRow>,
): Effect.Effect<void, DatabaseError, PulseDb> =>
  tryDb("upsertEmails", (db) => {
    if (rows.length === 0) return;
    db.insert(emails)
      .values(rows.map(toEmailColumns))
      .onConflictDoUpdate({
        target: emails.id,
        set: {
          threadId: sql`excluded.thread_id`,
          isUnread: sql`excluded.is_unread`,
          fromName: sql`excluded.from_name`,
          fromEmail: sql`excluded.from_email`,
          subject: sql`excluded.subject`,
          preview: sql`excluded.preview`,
          receivedAt: sql`excluded.received_at`,
          lastSeen: sql`excluded.last_seen`,
          source: sql`excluded.source`,
        },
      })
      .run();
  });

/**
 * IDs of every email with `received_at >= after`. Drives the Catchup
 * strategy's ID-diff: compare the set the Database currently holds against
 * the set the upstream Email/query returns in the same window, then
 * fetch the upstream-only IDs and delete the local-only IDs.
 */
export const getEmailIdsSince = (
  after: Date,
): Effect.Effect<ReadonlyArray<string>, DatabaseError, PulseDb> =>
  tryDb("getEmailIdsSince", (db) => {
    const rows = db
      .select({ id: emails.id })
      .from(emails)
      .where(gte(emails.receivedAt, after))
      .all();
    return rows.map((r) => r.id);
  });

/** Hard-delete rows by JMAP id. Used by Incremental destroyed-set and Catchup reconciliation. */
export const deleteEmailsByIds = (
  ids: ReadonlyArray<string>,
): Effect.Effect<void, DatabaseError, PulseDb> =>
  tryDb("deleteEmailsByIds", (db) => {
    if (ids.length === 0) return;
    db.delete(emails)
      .where(inArray(emails.id, [...ids]))
      .run();
  });

/**
 * Toggle is_unread for a set of email ids. Used by markRead in M1.4; defined
 * here so the Database's mutation surface is complete from M1.1.
 */
export const setEmailUnread = (
  ids: ReadonlyArray<string>,
  unread: boolean,
): Effect.Effect<void, DatabaseError, PulseDb> =>
  tryDb("setEmailUnread", (db) => {
    if (ids.length === 0) return;
    db.update(emails)
      .set({ isUnread: unread, lastSeen: new Date() })
      .where(inArray(emails.id, [...ids]))
      .run();
  });

/**
 * Common identity + timing of a Run, present on every recorded row
 * regardless of outcome.
 */
type RunIdentity = {
  connectorName: string;
  startedAt: Date;
  endedAt: Date;
};

/**
 * Input shape for recording a Run. The succeeded/failed split is
 * encoded in the type so a caller cannot construct a failed row without
 * its categorisation, or a succeeded row that fakes an errorMessage. The
 * shape mirrors ADR 0004: the only string a succeeded row carries is an
 * optional `annotation` (e.g. `recovered_via_catchup`), stored as the
 * `error_tag` column for backward compatibility with the binary schema.
 *
 * Failed rows require both `errorTag` (the categorisation —
 * `MalformedSourceResponse` / `TransportError` / `AuthError` /
 * `DatabaseError`) and `errorMessage` (the human-readable detail).
 */
export type RunInput = RunIdentity &
  (
    | { status: "succeeded"; annotation?: string }
    | { status: "failed"; errorTag: string; errorMessage: string }
  );

/** Insert a Run row and return it with its assigned id. */
export const recordRun = (input: RunInput): Effect.Effect<Run, DatabaseError, PulseDb> =>
  tryDb("recordRun", (db) => {
    const columns = toRunColumns(input);
    const inserted = db.insert(runs).values(columns).returning().get();
    return toRun(inserted);
  });

const toRunColumns = (input: RunInput) => ({
  connectorName: input.connectorName,
  startedAt: input.startedAt,
  endedAt: input.endedAt,
  status: input.status,
  errorTag: input.status === "succeeded" ? (input.annotation ?? null) : input.errorTag,
  errorMessage: input.status === "succeeded" ? null : input.errorMessage,
});

/**
 * Most recent **successful** Run for a given Connector. Drives the
 * "Last synced: <ts>" freshness indicator on /inbox.
 *
 * Returns null when the Connector has never succeeded (fresh laptop or
 * sustained failure).
 */
export const latestRun = (
  connectorName: string,
): Effect.Effect<Run | null, DatabaseError, PulseDb> =>
  tryDb("latestRun", (db) => {
    const row = db
      .select()
      .from(runs)
      .where(and(eq(runs.connectorName, connectorName), eq(runs.status, "succeeded")))
      .orderBy(desc(runs.startedAt))
      .limit(1)
      .get();
    return row ? toRun(row) : null;
  });

/**
 * Most recent Run *attempt* regardless of outcome. Drives the
 * conditional failure banner: when this row's status is failed and its
 * startedAt is newer than latestRun's, the banner renders.
 */
export const latestRunAttempt = (
  connectorName: string,
): Effect.Effect<Run | null, DatabaseError, PulseDb> =>
  tryDb("latestRunAttempt", (db) => {
    const row = db
      .select()
      .from(runs)
      .where(eq(runs.connectorName, connectorName))
      .orderBy(desc(runs.startedAt))
      .limit(1)
      .get();
    return row ? toRun(row) : null;
  });

/** Fetch the cursor row for a Connector. null = Bootstrap path on next run. */
export const getConnectorCursor = (
  connectorName: string,
): Effect.Effect<ConnectorCursor | null, DatabaseError, PulseDb> =>
  tryDb("getConnectorCursor", (db) => {
    const row = db
      .select()
      .from(connectorCursor)
      .where(eq(connectorCursor.connectorName, connectorName))
      .limit(1)
      .get();
    return row ?? null;
  });

/** Upsert the cursor row. Connector calls this in the same transaction as email writes. */
export const setConnectorCursor = (
  connectorName: string,
  stateToken: string,
): Effect.Effect<void, DatabaseError, PulseDb> =>
  tryDb("setConnectorCursor", (db) => {
    db.insert(connectorCursor)
      .values({ connectorName, stateToken, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: connectorCursor.connectorName,
        set: {
          stateToken: sql`excluded.state_token`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .run();
  });

const toEmailColumns = (row: EmailRow) => ({
  id: row.id,
  threadId: row.threadId,
  isUnread: row.isUnread,
  fromName: row.fromName,
  fromEmail: row.fromEmail,
  subject: row.subject,
  preview: row.preview,
  receivedAt: row.receivedAt,
  firstSeen: row.firstSeen,
  lastSeen: row.lastSeen,
  source: row.source,
});

const toRun = (row: typeof runs.$inferSelect): Run => ({
  id: row.id,
  connectorName: row.connectorName,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  status: row.status as Run["status"],
  errorTag: row.errorTag,
  errorMessage: row.errorMessage,
});
