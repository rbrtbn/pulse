import type { SyncRun } from "@cerebro/core";
import {
  latestSyncRun as latestSyncRunQuery,
  type UnreadThread,
  upcomingUnreadThreads as upcomingUnreadThreadsQuery,
} from "@cerebro/store";
import { Effect } from "effect";

import { StoreDbAppLayer } from "./db";

/**
 * Thin async wrappers around the Effect-returning Store queries. Route
 * loaders import these and treat them as plain Promises. The Effect ↔
 * Promise boundary lives here so route code stays free of Effect ceremony.
 */
export const fetchUnreadThreads = (): Promise<UnreadThread[]> =>
  Effect.runPromise(upcomingUnreadThreadsQuery().pipe(Effect.provide(StoreDbAppLayer)));

export const fetchLatestSyncRun = (workerName: string): Promise<SyncRun | null> =>
  Effect.runPromise(latestSyncRunQuery(workerName).pipe(Effect.provide(StoreDbAppLayer)));
