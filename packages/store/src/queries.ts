import type { EmailRow, StoreError, SyncCursor, SyncRun } from "@cerebro/core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import { StoreDb, tryDb } from "./db";
import { emails, syncCursor, syncRuns } from "./schema";

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
export const upcomingUnreadThreads = (): Effect.Effect<UnreadThread[], StoreError, StoreDb> =>
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
 * rows the Worker supplies first_seen/last_seen explicitly (typically
 * `new Date()` at Sync Run time).
 */
export const upsertEmails = (
  rows: ReadonlyArray<EmailRow>,
): Effect.Effect<void, StoreError, StoreDb> =>
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

/** Hard-delete rows by JMAP id. Used by Incremental destroyed-set and Catchup reconciliation. */
export const deleteEmailsByIds = (
  ids: ReadonlyArray<string>,
): Effect.Effect<void, StoreError, StoreDb> =>
  tryDb("deleteEmailsByIds", (db) => {
    if (ids.length === 0) return;
    db.delete(emails)
      .where(inArray(emails.id, [...ids]))
      .run();
  });

/**
 * Toggle is_unread for a set of email ids. Used by markRead in M1.4; defined
 * here so the Store's mutation surface is complete from M1.1.
 */
export const setEmailUnread = (
  ids: ReadonlyArray<string>,
  unread: boolean,
): Effect.Effect<void, StoreError, StoreDb> =>
  tryDb("setEmailUnread", (db) => {
    if (ids.length === 0) return;
    db.update(emails)
      .set({ isUnread: unread, lastSeen: new Date() })
      .where(inArray(emails.id, [...ids]))
      .run();
  });

/**
 * Common identity + timing of a Sync Run, present on every recorded row
 * regardless of outcome.
 */
type SyncRunIdentity = {
  workerName: string;
  startedAt: Date;
  endedAt: Date;
};

/**
 * Input shape for recording a Sync Run. The succeeded/failed split is
 * encoded in the type so a caller cannot construct a failed row without
 * its categorisation, or a succeeded row that fakes an errorMessage. The
 * shape mirrors ADR 0004: the only string a succeeded row carries is an
 * optional `annotation` (e.g. `recovered_via_catchup`), stored as the
 * `error_tag` column for backward compatibility with the binary schema.
 *
 * Failed rows require both `errorTag` (the categorisation —
 * `MalformedSourceResponse` / `TransportError` / `AuthError` /
 * `StoreError`) and `errorMessage` (the human-readable detail).
 */
export type SyncRunInput = SyncRunIdentity &
  (
    | { status: "succeeded"; annotation?: string }
    | { status: "failed"; errorTag: string; errorMessage: string }
  );

/** Insert a Sync Run row and return it with its assigned id. */
export const recordSyncRun = (input: SyncRunInput): Effect.Effect<SyncRun, StoreError, StoreDb> =>
  tryDb("recordSyncRun", (db) => {
    const columns = toSyncRunColumns(input);
    const inserted = db.insert(syncRuns).values(columns).returning().get();
    return toSyncRun(inserted);
  });

const toSyncRunColumns = (input: SyncRunInput) => ({
  workerName: input.workerName,
  startedAt: input.startedAt,
  endedAt: input.endedAt,
  status: input.status,
  errorTag: input.status === "succeeded" ? (input.annotation ?? null) : input.errorTag,
  errorMessage: input.status === "succeeded" ? null : input.errorMessage,
});

/**
 * Most recent **successful** Sync Run for a given Worker. Drives the
 * "Last synced: <ts>" freshness indicator on /inbox.
 *
 * Returns null when the Worker has never succeeded (fresh laptop or
 * sustained failure).
 */
export const latestSyncRun = (
  workerName: string,
): Effect.Effect<SyncRun | null, StoreError, StoreDb> =>
  tryDb("latestSyncRun", (db) => {
    const row = db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.workerName, workerName), eq(syncRuns.status, "succeeded")))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1)
      .get();
    return row ? toSyncRun(row) : null;
  });

/**
 * Most recent Sync Run *attempt* regardless of outcome. Drives the
 * conditional failure banner: when this row's status is failed and its
 * startedAt is newer than latestSyncRun's, the banner renders.
 */
export const latestSyncRunAttempt = (
  workerName: string,
): Effect.Effect<SyncRun | null, StoreError, StoreDb> =>
  tryDb("latestSyncRunAttempt", (db) => {
    const row = db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.workerName, workerName))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1)
      .get();
    return row ? toSyncRun(row) : null;
  });

/** Fetch the cursor row for a Worker. null = Bootstrap path on next run. */
export const getSyncCursor = (
  workerName: string,
): Effect.Effect<SyncCursor | null, StoreError, StoreDb> =>
  tryDb("getSyncCursor", (db) => {
    const row = db
      .select()
      .from(syncCursor)
      .where(eq(syncCursor.workerName, workerName))
      .limit(1)
      .get();
    return row ?? null;
  });

/** Upsert the cursor row. Worker calls this in the same transaction as email writes. */
export const setSyncCursor = (
  workerName: string,
  stateToken: string,
): Effect.Effect<void, StoreError, StoreDb> =>
  tryDb("setSyncCursor", (db) => {
    db.insert(syncCursor)
      .values({ workerName, stateToken, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: syncCursor.workerName,
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

const toSyncRun = (row: typeof syncRuns.$inferSelect): SyncRun => ({
  id: row.id,
  workerName: row.workerName,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  status: row.status as SyncRun["status"],
  errorTag: row.errorTag,
  errorMessage: row.errorMessage,
});
