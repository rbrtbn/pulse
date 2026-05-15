import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { type MarkReadResult, runMarkReadLive } from "./mark-read";
import { fetchInbox, type InboxData } from "./queries";
import { runSync, type SyncResult } from "./sync";

/**
 * Server function for the /inbox route loader. Loaders are isomorphic —
 * they run on the client as well as the server — so the loader must not
 * call `fetchInbox` directly: that drags `@pulse/database` (and the
 * native better-sqlite3 driver) into the client bundle, where it throws
 * at eval time and breaks route hydration. Wrapping it leaves the client
 * only an RPC stub.
 */
export const fetchInboxData = createServerFn().handler((): Promise<InboxData> => fetchInbox());

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

/** Validated at the App boundary — Effect Schema, the repo's canonical check. */
const MarkReadInput = Schema.Struct({ emailId: Schema.String });

/**
 * Server function behind a /inbox row click — the first App→Connector
 * *write* (ADR 0003). Marks every unread message in the row's thread
 * read upstream. Returns a structured `MarkReadResult` rather than
 * throwing: `MarkReadError` is user-facing by design, so the row renders
 * its tag + message inline and stays put for a retry.
 */
export const markRead = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Schema.decodeUnknownSync(MarkReadInput)(data))
  .handler(({ data }): Promise<MarkReadResult> => runMarkReadLive(data.emailId));
