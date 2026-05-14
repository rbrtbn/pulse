import type { SyncRun } from "@cerebro/core";
import {
  latestSyncRun as latestSyncRunQuery,
  type UnreadThread,
  upcomingUnreadThreads as upcomingUnreadThreadsQuery,
} from "@cerebro/store";
import { Effect } from "effect";

import { StoreDbAppLayer } from "./db";
import { redactToLoader } from "./redact";

/**
 * Thin async wrappers around the Effect-returning Store queries. Route
 * loaders import these and treat them as plain Promises. The Effect ↔
 * Promise boundary lives here so route code stays free of Effect ceremony.
 *
 * Every failure is funneled through `redactToLoader` so the raw better-
 * sqlite3 message (which can carry file paths, schema details, or lock
 * state) never reaches the HTML the browser receives. The user sees a
 * generic message + trace ID; the full cause lands in the server log
 * under the same trace ID.
 */
export const fetchUnreadThreads = (): Promise<UnreadThread[]> =>
  redactToLoader("Inbox", upcomingUnreadThreadsQuery().pipe(Effect.provide(StoreDbAppLayer)));

export const fetchLatestSyncRun = (workerName: string): Promise<SyncRun | null> =>
  redactToLoader(
    "Sync status",
    latestSyncRunQuery(workerName).pipe(Effect.provide(StoreDbAppLayer)),
  );
