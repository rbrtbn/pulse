import { resolve } from "node:path";

import { AuthError, TransportError } from "@cerebro/core";
import { runTest } from "@cerebro/core/testing";
import { FastmailJmap, FastmailJmapStub } from "@cerebro/jmap";
import {
  getSyncCursor,
  latestSyncRunAttempt,
  StoreDb,
  StoreDbTest,
  upcomingUnreadThreads,
} from "@cerebro/store";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { runSyncRun, WORKER_NAME } from "./worker";

const migrationsFolder = resolve(import.meta.dirname, "..", "..", "..", "store", "migrations");

const sampleEmail = (id: string, threadId: string, opts: { isUnread?: boolean } = {}) => ({
  id,
  threadId,
  mailboxIds: { "MBX-inbox": true },
  keywords: opts.isUnread === false ? { $seen: true } : { $seen: false },
  from: [{ name: "Mira Patel", email: "mira@example.com" }],
  subject: `Test ${id}`,
  preview: "preview snippet",
  receivedAt: "2026-05-14T14:00:00Z",
});

const inboxMailbox = { id: "MBX-inbox", name: "INBOX", role: "inbox" };

const happyJmap = (emails: ReadonlyArray<unknown>) =>
  FastmailJmapStub({
    mailboxGet: () => Effect.succeed([inboxMailbox]),
    emailQuery: () =>
      Effect.succeed({ ids: emails.map((e) => (e as { id: string }).id), queryState: "qs-1" }),
    emailGet: () => Effect.succeed(emails),
  });

const layers = (jmap: Layer.Layer<FastmailJmap>): Layer.Layer<FastmailJmap | StoreDb> =>
  Layer.merge(jmap, StoreDbTest(migrationsFolder));

describe("runSyncRun — Bootstrap happy path", () => {
  it("upserts emails, advances cursor, records a succeeded run", async () => {
    const jmap = happyJmap([sampleEmail("M-1", "T-1"), sampleEmail("M-2", "T-2")]);
    const program = Effect.gen(function* () {
      const run = yield* runSyncRun();
      const cursor = yield* getSyncCursor(WORKER_NAME);
      const threads = yield* upcomingUnreadThreads();
      return { run, cursor, threads };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.run.status).toBe("succeeded");
    expect(result.run.errorTag).toBeNull();
    expect(result.cursor?.stateToken).toBe("qs-1");
    expect(result.threads.map((t) => t.threadId).sort()).toEqual(["T-1", "T-2"]);
  });

  it("succeeds with an empty INBOX (no Email/get call needed)", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () => Effect.succeed([inboxMailbox]),
      emailQuery: () => Effect.succeed({ ids: [], queryState: "qs-empty" }),
    });
    const program = Effect.gen(function* () {
      const run = yield* runSyncRun();
      const cursor = yield* getSyncCursor(WORKER_NAME);
      const threads = yield* upcomingUnreadThreads();
      return { run, cursor, threads };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.run.status).toBe("succeeded");
    expect(result.cursor?.stateToken).toBe("qs-empty");
    expect(result.threads).toEqual([]);
  });
});

describe("runSyncRun — failure paths", () => {
  it("MalformedSourceResponse when JMAP returns a bad Email shape", async () => {
    const jmap = happyJmap([{ id: "M-1" }]); // missing threadId/mailboxIds/etc
    const program = Effect.gen(function* () {
      const run = yield* runSyncRun();
      const threads = yield* upcomingUnreadThreads();
      return { run, threads };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.run.status).toBe("failed");
    expect(result.run.errorTag).toBe("MalformedSourceResponse");
    expect(result.threads).toEqual([]);
  });

  it("TransportError when JMAP throws / 5xx — Store stays untouched", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () =>
        Effect.fail(new TransportError({ source: "fastmail", detail: "ECONNRESET" })),
    });
    const program = Effect.gen(function* () {
      const run = yield* runSyncRun();
      const cursor = yield* getSyncCursor(WORKER_NAME);
      const threads = yield* upcomingUnreadThreads();
      return { run, cursor, threads };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.run.status).toBe("failed");
    expect(result.run.errorTag).toBe("TransportError");
    expect(result.cursor).toBeNull();
    expect(result.threads).toEqual([]);
  });

  it("AuthError when JMAP returns 401 — sync_runs records the tag", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () =>
        Effect.fail(new AuthError({ source: "fastmail", detail: "API token rejected" })),
    });
    const program = Effect.gen(function* () {
      return yield* runSyncRun();
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.status).toBe("failed");
    expect(result.errorTag).toBe("AuthError");
  });

  it("MalformedSourceResponse when no INBOX mailbox is returned", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () => Effect.succeed([]),
    });
    const program = Effect.gen(function* () {
      return yield* runSyncRun();
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.status).toBe("failed");
    expect(result.errorTag).toBe("MalformedSourceResponse");
  });

  it("latestSyncRunAttempt surfaces the failed attempt for the M1.3 banner", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () =>
        Effect.fail(new TransportError({ source: "fastmail", detail: "ETIMEDOUT" })),
    });
    const program = Effect.gen(function* () {
      yield* runSyncRun();
      return yield* latestSyncRunAttempt(WORKER_NAME);
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result?.status).toBe("failed");
    expect(result?.errorTag).toBe("TransportError");
    expect(result?.errorMessage).toBe("ETIMEDOUT");
  });
});
