import { type EmailRow, MalformedSourceResponse, type SyncRun } from "@cerebro/core";
import { FastmailJmap } from "@cerebro/jmap";
import { recordSyncRun, setSyncCursor, StoreDb, upsertEmails } from "@cerebro/store";
import { Effect } from "effect";

import { jmapToEmailRow } from "./email-mapping";

export const WORKER_NAME = "fastmail";
const BOOTSTRAP_WINDOW_DAYS = 30;

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

/**
 * One Sync Run. Returns the recorded SyncRun on every path — success or
 * failure — so the caller can decide whether to surface the outcome to
 * the user (CLI exit code, server function response).
 *
 * **M1.1 ships the Bootstrap path only.** The cursor returned from this
 * run becomes the starting point for M1.2's Incremental path. M1.1 always
 * runs Bootstrap even when a cursor already exists — re-fetching the
 * 30-day window is idempotent under upsert, and the Incremental short
 * circuit lands in M1.2.
 */
export const runSyncRun = (): Effect.Effect<SyncRun, never, FastmailJmap | StoreDb> =>
  Effect.gen(function* () {
    const startedAt = new Date();
    return yield* runBootstrap(startedAt).pipe(
      Effect.catchAll((err) =>
        recordSyncRun({
          workerName: WORKER_NAME,
          startedAt,
          endedAt: new Date(),
          status: "failed",
          errorTag: err._tag,
          errorMessage: errorDetail(err),
        }),
      ),
    );
  });

const runBootstrap = (startedAt: Date) =>
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
      // Empty INBOX in the window: still record a successful Sync Run + cursor
      // advance so /inbox knows a sync happened.
      yield* setSyncCursor(WORKER_NAME, queryResult.queryState);
      return yield* recordSyncRun({
        workerName: WORKER_NAME,
        startedAt,
        endedAt: new Date(),
        status: "succeeded",
        errorTag: null,
        errorMessage: null,
      });
    }

    const rawEmails = yield* client.emailGet(queryResult.ids, EMAIL_PROPERTIES);
    const observedAt = new Date();
    const rows: ReadonlyArray<EmailRow> = yield* projectAll(rawEmails, observedAt);

    yield* upsertEmails(rows);
    yield* setSyncCursor(WORKER_NAME, queryResult.queryState);

    return yield* recordSyncRun({
      workerName: WORKER_NAME,
      startedAt,
      endedAt: new Date(),
      status: "succeeded",
      errorTag: null,
      errorMessage: null,
    });
  });

const projectAll = (raws: ReadonlyArray<unknown>, observedAt: Date) =>
  Effect.all(raws.map((raw) => jmapToEmailRow(raw, observedAt)));

const errorDetail = (err: { readonly _tag: string }): string => {
  if ("detail" in err && typeof err.detail === "string") return err.detail;
  return err._tag;
};
