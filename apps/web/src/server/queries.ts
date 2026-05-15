import type { DatabaseError, Run } from "@pulse/core";
import {
  latestRun,
  latestRunAttempt,
  PulseDb,
  type UnreadThread,
  upcomingUnreadThreads,
} from "@pulse/database";
import { Effect } from "effect";

import { PulseDbAppLayer } from "./db";
import { redactToLoader } from "./redact";

/** The Connector whose Runs back the /inbox freshness + failure UX. */
const INBOX_CONNECTOR = "fastmail";

/**
 * Failure-banner payload. Present only when the most recent Run attempt
 * failed *and* no later success has cleared it — see `deriveFailure`.
 */
export type SyncFailure = {
  errorTag: string;
  errorMessage: string;
};

/** Everything the /inbox route loader needs, fetched in one pass. */
export type InboxData = {
  threads: UnreadThread[];
  latestSuccess: Run | null;
  failure: SyncFailure | null;
};

/**
 * Conditional failure banner per issue #15: surface the latest attempt's
 * error only when that attempt failed and is newer than the latest
 * success. A success that post-dates the failure clears the banner; when
 * there has never been a success, any failed attempt shows.
 *
 * Pure — the comparison is the load-bearing logic, kept testable without a
 * Database.
 */
export const deriveFailure = (
  latestAttempt: Run | null,
  latestSuccess: Run | null,
): SyncFailure | null => {
  if (latestAttempt === null || latestAttempt.status !== "failed") return null;
  if (
    latestSuccess !== null &&
    latestAttempt.startedAt.getTime() <= latestSuccess.startedAt.getTime()
  ) {
    return null;
  }
  return {
    errorTag: latestAttempt.errorTag ?? "unknown",
    errorMessage: latestAttempt.errorMessage ?? "",
  };
};

/**
 * Assemble the /inbox loader payload: the unread thread list, the latest
 * successful Run (freshness line + State B), and the derived failure
 * banner. Effect-returning so tests provide an in-memory `PulseDb`; the
 * `fetchInbox` wrapper provides the live layer.
 */
export const loadInbox = (): Effect.Effect<InboxData, DatabaseError, PulseDb> =>
  Effect.gen(function* () {
    const threads = yield* upcomingUnreadThreads();
    const latestSuccess = yield* latestRun(INBOX_CONNECTOR);
    const latestAttempt = yield* latestRunAttempt(INBOX_CONNECTOR);
    return { threads, latestSuccess, failure: deriveFailure(latestAttempt, latestSuccess) };
  });

/**
 * Loader-facing wrapper: runs `loadInbox` against the live Database and
 * funnels any failure through `redactToLoader`, so the raw better-sqlite3
 * message (file paths, schema, lock state) never reaches the HTML the
 * browser receives.
 */
export const fetchInbox = (): Promise<InboxData> =>
  redactToLoader("Inbox", loadInbox().pipe(Effect.provide(PulseDbAppLayer)));
