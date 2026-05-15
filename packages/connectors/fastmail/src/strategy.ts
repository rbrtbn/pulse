import {
  type AuthError,
  type EmailRow,
  MalformedSourceResponse,
  type DatabaseError,
  type TransportError,
} from "@pulse/core";
import { FastmailJmap } from "@pulse/jmap";
import { getEmailIdsSince, PulseDb } from "@pulse/database";
import { Effect } from "effect";

import { jmapToEmailRow } from "./email-mapping";

/**
 * Properties to fetch from Email/get. Per ADR 0005, only the metadata
 * `/inbox` renders — no bodies, attachments, or recipient lists.
 */
const EMAIL_PROPERTIES = [
  "id",
  "threadId",
  "mailboxIds",
  "keywords",
  "from",
  "subject",
  "preview",
  "receivedAt",
];

const BOOTSTRAP_WINDOW_DAYS = 30;

/**
 * What a Run **strategy** yields. The envelope (in `connector.ts`)
 * turns this into a recorded `Run` row — handling timestamps, the
 * `upsertEmails` write, the `deleteEmailsByIds` delete, the cursor
 * advance, and the success-recording call. Strategies own discovery;
 * the envelope owns framing.
 *
 * `idsToDelete` is the destroyed-or-departed set:
 * - Bootstrap: omitted (or empty) — Bootstrap doesn't reconcile.
 * - Incremental: `Email/changes` `destroyed` array.
 * - Catchup: local rows whose IDs are no longer in the upstream window.
 *
 * `annotation` lands on the succeeded `Run` row's `error_tag` column
 * per ADR 0004 — used by Catchup to audit a recovered run.
 */
export type StrategyResult = {
  readonly rows: ReadonlyArray<EmailRow>;
  readonly idsToDelete?: ReadonlyArray<string>;
  readonly cursorToken: string;
  readonly annotation?: string;
};

/**
 * Source-side failure tags a strategy can produce. The envelope catches
 * these and records them as a failed `Run` row with the tag's name
 * in `error_tag` and the tag's `detail` in `error_message`.
 */
export type StrategyError = AuthError | MalformedSourceResponse | TransportError;

/**
 * A Run strategy. M1.1 shipped Bootstrap; M1.2 adds Incremental
 * and Catchup. All strategies share this shape so the envelope can
 * swap between them without knowing which kind ran.
 *
 * Strategies can **read** from the Database (Catchup's local-ID diff
 * needs `getEmailIdsSince`); they don't **write** — that's the
 * envelope's job. A `DatabaseError` from a strategy's read escapes
 * through the envelope's residual the same way `DatabaseError` from the
 * envelope's own writes does: no useful row to record, so the caller
 * (CLI exit code, web loader's error boundary) handles it.
 */
export type Strategy = Effect.Effect<
  StrategyResult,
  StrategyError | DatabaseError,
  FastmailJmap | PulseDb
>;

/**
 * Bootstrap discovery: `Mailbox/get` → `Email/query` in the last
 * `BOOTSTRAP_WINDOW_DAYS` → `Email/get` → project to `EmailRow`. Yields
 * the rows + the JMAP `queryState` token to seed the cursor for M1.2's
 * Incremental path.
 *
 * Re-runs are idempotent under the envelope's upsert. M1.1 always picks
 * this strategy — the cursor-aware selection lands in M1.2.
 */
export const bootstrapStrategy = (startedAt: Date): Strategy =>
  Effect.gen(function* () {
    const client = yield* FastmailJmap;

    const mailboxes = yield* client.mailboxGet();
    const inbox = mailboxes.find((m) => m.role === "inbox");
    if (inbox === undefined) {
      return yield* new MalformedSourceResponse({
        source: "fastmail",
        detail: "no Mailbox with role='inbox' returned by Mailbox/get",
      });
    }

    const after = new Date(
      startedAt.getTime() - BOOTSTRAP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const queryResult = yield* client.emailQuery({
      filter: { inMailbox: inbox.id, after },
      sort: [{ property: "receivedAt", isAscending: false }],
      limit: 500,
    });

    if (queryResult.ids.length === 0) {
      return { rows: [], cursorToken: queryResult.queryState };
    }

    const rawEmails = yield* client.emailGet(queryResult.ids, EMAIL_PROPERTIES);
    const observedAt = new Date();
    const rows = yield* Effect.all(rawEmails.map((raw) => jmapToEmailRow(raw, observedAt)));

    return { rows, cursorToken: queryResult.queryState };
  });

/**
 * Incremental discovery: `Email/changes` since `sinceState` yields
 * `created` / `updated` / `destroyed` sets; fetch the first two via
 * `Email/get`, hand the third to the envelope's delete step. On
 * `cannotCalculateChanges` (cursor expired) falls back to Catchup —
 * the recovery edge per ADR 0004. Auth/Transport/MalformedSourceResponse
 * still propagate up to the envelope as failed Runs.
 *
 * `Email/changes` returns deltas across *all* mailboxes, not just INBOX.
 * The envelope upserts everything; a non-INBOX email may briefly appear
 * in the Database until the next Catchup reconciles. ADR 0004 records that
 * trade-off.
 */
export const incrementalStrategy = (startedAt: Date, sinceState: string): Strategy =>
  Effect.gen(function* () {
    const client = yield* FastmailJmap;
    const changes = yield* client.emailChanges(sinceState);

    const toFetch = [...changes.created, ...changes.updated];
    if (toFetch.length === 0) {
      return {
        rows: [],
        idsToDelete: changes.destroyed,
        cursorToken: changes.newState,
      };
    }

    const rawEmails = yield* client.emailGet(toFetch, EMAIL_PROPERTIES);
    const observedAt = new Date();
    const rows = yield* Effect.all(rawEmails.map((raw) => jmapToEmailRow(raw, observedAt)));

    return {
      rows,
      idsToDelete: changes.destroyed,
      cursorToken: changes.newState,
    };
  }).pipe(Effect.catchTag("CannotCalculateChanges", () => catchupStrategy(startedAt)));

/**
 * Catchup discovery: cursor was rejected as too old. Re-query the 30-day
 * upstream window, diff against the Database's IDs in the same window, fetch
 * only the upstream-only IDs (bounded — most rows are already local), and
 * tell the envelope to delete the local-only IDs (delete-on-leave-INBOX
 * applied at recovery). Annotate the row with `recovered_via_catchup` per
 * ADR 0004 so the run is visible in audit queries without changing the
 * binary status enum.
 */
export const catchupStrategy = (startedAt: Date): Strategy =>
  Effect.gen(function* () {
    const client = yield* FastmailJmap;

    const mailboxes = yield* client.mailboxGet();
    const inbox = mailboxes.find((m) => m.role === "inbox");
    if (inbox === undefined) {
      return yield* new MalformedSourceResponse({
        source: "fastmail",
        detail: "no Mailbox with role='inbox' returned by Mailbox/get",
      });
    }

    const after = new Date(startedAt.getTime() - BOOTSTRAP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const queryResult = yield* client.emailQuery({
      filter: { inMailbox: inbox.id, after: after.toISOString() },
      sort: [{ property: "receivedAt", isAscending: false }],
      limit: 500,
    });
    const upstreamSet = new Set(queryResult.ids);

    const localIds = yield* getEmailIdsSince(after);
    const localSet = new Set(localIds);

    const newUpstreamIds = queryResult.ids.filter((id) => !localSet.has(id));
    const missingLocalIds = localIds.filter((id) => !upstreamSet.has(id));

    let rows: ReadonlyArray<EmailRow> = [];
    if (newUpstreamIds.length > 0) {
      const rawEmails = yield* client.emailGet(newUpstreamIds, EMAIL_PROPERTIES);
      const observedAt = new Date();
      rows = yield* Effect.all(rawEmails.map((raw) => jmapToEmailRow(raw, observedAt)));
    }

    const result: StrategyResult = {
      rows,
      idsToDelete: missingLocalIds,
      cursorToken: queryResult.queryState,
      annotation: "recovered_via_catchup",
    };
    return result;
  });
