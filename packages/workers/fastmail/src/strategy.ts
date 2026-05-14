import {
  type AuthError,
  type EmailRow,
  MalformedSourceResponse,
  type TransportError,
} from "@cerebro/core";
import { FastmailJmap } from "@cerebro/jmap";
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
 * What a Sync Run **strategy** yields. The envelope (in `worker.ts`)
 * turns this into a recorded `SyncRun` row — handling timestamps, the
 * `upsertEmails` write, the cursor advance, and the success-recording
 * call. Strategies own discovery; the envelope owns framing.
 *
 * `annotation` lands on the succeeded `SyncRun` row's `error_tag` column
 * per ADR 0004 — used by Catchup to audit a recovered run.
 */
export type StrategyResult = {
  readonly rows: ReadonlyArray<EmailRow>;
  readonly cursorToken: string;
  readonly annotation?: string;
};

/**
 * Error types a strategy is allowed to fail with. These are the
 * Source-side failures the envelope catches and records as a failed
 * `SyncRun` row. `StoreError` is deliberately not here — strategies
 * don't touch the Store; the envelope does.
 */
export type StrategyError = AuthError | TransportError | MalformedSourceResponse;

/**
 * A Sync Run strategy. M1.1 ships exactly one (Bootstrap); M1.2 will
 * add Incremental and Catchup. All strategies share this shape so the
 * envelope can swap between them without knowing which kind ran.
 */
export type Strategy = Effect.Effect<StrategyResult, StrategyError, FastmailJmap>;

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
