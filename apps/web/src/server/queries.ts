import type { Run } from "@pulse/core";
import {
  latestRun as latestRunQuery,
  type UnreadThread,
  upcomingUnreadThreads as upcomingUnreadThreadsQuery,
} from "@pulse/database";
import { Effect } from "effect";

import { PulseDbAppLayer } from "./db";
import { redactToLoader } from "./redact";

/**
 * Thin async wrappers around the Effect-returning Database queries. Route
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
  redactToLoader("Inbox", upcomingUnreadThreadsQuery().pipe(Effect.provide(PulseDbAppLayer)));

export const fetchLatestRun = (connectorName: string): Promise<Run | null> =>
  redactToLoader(
    "Sync status",
    latestRunQuery(connectorName).pipe(Effect.provide(PulseDbAppLayer)),
  );
