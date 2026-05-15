import { createServerFn } from "@tanstack/react-start";

import { runSync, type SyncResult } from "./sync";

/**
 * Server function behind the /inbox "Sync now" button — the first
 * concrete App→Connector call (ADR 0003). The click handler awaits this,
 * then invalidates the route loader so the freshness line, failure
 * banner, and thread list re-render from the Run it just recorded.
 *
 * Kept apart from `sync.ts` so the testable `runFastmailSync` seam can be
 * exercised without pulling the TanStack Start server runtime into the
 * test graph.
 */
export const syncNow = createServerFn({ method: "POST" }).handler(
  (): Promise<SyncResult> => runSync(),
);
