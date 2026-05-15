import { resolve } from "node:path";

import { AuthError, CannotCalculateChanges, type EmailRow, TransportError } from "@pulse/core";
import { runTest } from "@pulse/core/testing";
import { FastmailJmap, FastmailJmapStub } from "@pulse/jmap";
import {
  getConnectorCursor,
  latestRunAttempt,
  setConnectorCursor,
  PulseDb,
  PulseDbTest,
  upcomingUnreadThreads,
  upsertEmails,
} from "@pulse/database";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import type { Strategy } from "./strategy";
import { runOnce, runWithEnvelope, CONNECTOR_NAME } from "./connector";

const migrationsFolder = resolve(import.meta.dirname, "..", "..", "..", "database", "migrations");

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

const layers = (jmap: Layer.Layer<FastmailJmap>): Layer.Layer<FastmailJmap | PulseDb> =>
  Layer.merge(jmap, PulseDbTest(migrationsFolder));

describe("runOnce — Bootstrap happy path", () => {
  it("upserts emails, advances cursor, records a succeeded run", async () => {
    const jmap = happyJmap([sampleEmail("M-1", "T-1"), sampleEmail("M-2", "T-2")]);
    const program = Effect.gen(function* () {
      const run = yield* runOnce();
      const cursor = yield* getConnectorCursor(CONNECTOR_NAME);
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
      const run = yield* runOnce();
      const cursor = yield* getConnectorCursor(CONNECTOR_NAME);
      const threads = yield* upcomingUnreadThreads();
      return { run, cursor, threads };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.run.status).toBe("succeeded");
    expect(result.cursor?.stateToken).toBe("qs-empty");
    expect(result.threads).toEqual([]);
  });
});

describe("runOnce — failure paths", () => {
  it("MalformedSourceResponse when JMAP returns a bad Email shape", async () => {
    const jmap = happyJmap([{ id: "M-1" }]); // missing threadId/mailboxIds/etc
    const program = Effect.gen(function* () {
      const run = yield* runOnce();
      const threads = yield* upcomingUnreadThreads();
      return { run, threads };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.run.status).toBe("failed");
    expect(result.run.errorTag).toBe("MalformedSourceResponse");
    expect(result.threads).toEqual([]);
  });

  it("TransportError when JMAP throws / 5xx — Database stays untouched", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () =>
        Effect.fail(new TransportError({ source: "fastmail", detail: "ECONNRESET" })),
    });
    const program = Effect.gen(function* () {
      const run = yield* runOnce();
      const cursor = yield* getConnectorCursor(CONNECTOR_NAME);
      const threads = yield* upcomingUnreadThreads();
      return { run, cursor, threads };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.run.status).toBe("failed");
    expect(result.run.errorTag).toBe("TransportError");
    expect(result.cursor).toBeNull();
    expect(result.threads).toEqual([]);
  });

  it("AuthError when JMAP returns 401 — runs records the tag", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () =>
        Effect.fail(new AuthError({ source: "fastmail", detail: "API token rejected" })),
    });
    const program = Effect.gen(function* () {
      return yield* runOnce();
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
      return yield* runOnce();
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.status).toBe("failed");
    expect(result.errorTag).toBe("MalformedSourceResponse");
  });

  it("latestRunAttempt surfaces the failed attempt for the M1.3 banner", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () =>
        Effect.fail(new TransportError({ source: "fastmail", detail: "ETIMEDOUT" })),
    });
    const program = Effect.gen(function* () {
      yield* runOnce();
      return yield* latestRunAttempt(CONNECTOR_NAME);
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result?.status).toBe("failed");
    expect(result?.errorTag).toBe("TransportError");
    expect(result?.errorMessage).toBe("ETIMEDOUT");
  });
});

describe("runWithEnvelope — independent of any concrete strategy", () => {
  it("upserts rows, advances cursor, records succeeded — for a trivial strategy", async () => {
    const strategy: Strategy = Effect.succeed({
      rows: [],
      cursorToken: "qs-envelope",
    });
    const startedAt = new Date("2026-05-14T10:00:00Z");
    const program = Effect.gen(function* () {
      const run = yield* runWithEnvelope(startedAt, strategy);
      const cursor = yield* getConnectorCursor(CONNECTOR_NAME);
      return { run, cursor };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(FastmailJmapStub({})))));
    expect(result.run.status).toBe("succeeded");
    expect(result.run.errorTag).toBeNull();
    expect(result.run.startedAt.toISOString()).toBe(startedAt.toISOString());
    expect(result.cursor?.stateToken).toBe("qs-envelope");
  });

  it("annotates the succeeded row when the strategy supplies one (ADR 0004 audit)", async () => {
    const strategy: Strategy = Effect.succeed({
      rows: [],
      cursorToken: "qs-recovered",
      annotation: "recovered_via_catchup",
    });
    const result = await runTest(
      runWithEnvelope(new Date(), strategy).pipe(Effect.provide(layers(FastmailJmapStub({})))),
    );
    expect(result.status).toBe("succeeded");
    expect(result.errorTag).toBe("recovered_via_catchup");
  });

  it("routes every StrategyError tag into a failed Run row — cursor untouched", async () => {
    const strategy: Strategy = Effect.fail(
      new TransportError({ source: "fastmail", detail: "ECONNRESET" }),
    );
    const program = Effect.gen(function* () {
      const run = yield* runWithEnvelope(new Date(), strategy);
      const cursor = yield* getConnectorCursor(CONNECTOR_NAME);
      return { run, cursor };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(FastmailJmapStub({})))));
    expect(result.run.status).toBe("failed");
    expect(result.run.errorTag).toBe("TransportError");
    expect(result.run.errorMessage).toBe("ECONNRESET");
    expect(result.cursor).toBeNull();
  });

  it("deletes the rows the strategy lists in idsToDelete", async () => {
    // Seed a row, then run a strategy that asks for it to be deleted.
    // The envelope must wire idsToDelete to deleteEmailsByIds, otherwise
    // Incremental's `destroyed` set and Catchup's `missing` reconciliation
    // would silently no-op.
    const recentDate = new Date("2026-05-14T14:00:00Z");
    const seeded: EmailRow = {
      id: "M-condemned",
      threadId: "T-condemned",
      isUnread: true,
      fromName: null,
      fromEmail: "x@example.com",
      subject: "deleteme",
      preview: "p",
      receivedAt: recentDate,
      firstSeen: recentDate,
      lastSeen: recentDate,
      source: "fastmail",
    };
    const strategy: Strategy = Effect.succeed({
      rows: [],
      idsToDelete: ["M-condemned"],
      cursorToken: "qs-after-delete",
    });
    const program = Effect.gen(function* () {
      yield* upsertEmails([seeded]);
      yield* runWithEnvelope(new Date(), strategy);
      return yield* upcomingUnreadThreads();
    });
    const threads = await runTest(program.pipe(Effect.provide(layers(FastmailJmapStub({})))));
    expect(threads).toEqual([]);
  });
});

describe("runOnce — cursor-aware path selection", () => {
  // The runOnce integration test surface — verifies that runOnce picks
  // Bootstrap vs Incremental based on the cursor, and that the chosen
  // strategy's CannotCalculateChanges fallback chains through to Catchup.
  // Strategy-level behaviour is covered separately in strategy.test.ts.

  it("picks Incremental when a cursor exists, applies the delta, advances the cursor", async () => {
    const jmap = FastmailJmapStub({
      // mailboxGet/emailQuery are intentionally absent — Bootstrap would
      // call them. If runOnce mistakenly picked Bootstrap, the stub
      // would die loudly with "no handler provided for mailboxGet".
      emailChanges: () =>
        Effect.succeed({
          created: ["M-new"],
          updated: [],
          destroyed: [],
          newState: "qs-2",
          hasMoreChanges: false,
        }),
      emailGet: () =>
        Effect.succeed([
          {
            id: "M-new",
            threadId: "T-new",
            mailboxIds: { "MBX-inbox": true },
            keywords: { $seen: false },
            from: [{ name: "Mira Patel", email: "mira@example.com" }],
            subject: "incoming",
            preview: "p",
            receivedAt: "2026-05-14T14:00:00Z",
          },
        ]),
    });
    const program = Effect.gen(function* () {
      yield* setConnectorCursor(CONNECTOR_NAME, "qs-1");
      const run = yield* runOnce();
      const cursor = yield* getConnectorCursor(CONNECTOR_NAME);
      const threads = yield* upcomingUnreadThreads();
      return { run, cursor, threads };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.run.status).toBe("succeeded");
    expect(result.run.errorTag).toBeNull();
    expect(result.cursor?.stateToken).toBe("qs-2");
    expect(result.threads.map((t) => t.threadId)).toContain("T-new");
  });

  it("triggers Catchup fallback when Incremental gets cannotCalculateChanges — succeeded row carries the audit tag", async () => {
    // Manually corrupt the cursor (the runbook scenario from issue #14).
    // Incremental's emailChanges returns CannotCalculateChanges; the
    // strategy's internal catchTag swaps to Catchup; the recorded Run
    // is `succeeded` with errorTag='recovered_via_catchup' per ADR 0004.
    const recentDate = new Date("2026-05-14T14:00:00Z");
    const seeded: EmailRow = {
      id: "M-stale",
      threadId: "T-stale",
      isUnread: true,
      fromName: null,
      fromEmail: "x@example.com",
      subject: "older",
      preview: "p",
      receivedAt: recentDate,
      firstSeen: recentDate,
      lastSeen: recentDate,
      source: "fastmail",
    };
    const inboxMailbox2 = { id: "MBX-inbox", name: "INBOX", role: "inbox" };
    const jmap = FastmailJmapStub({
      emailChanges: () => Effect.fail(new CannotCalculateChanges({ source: "fastmail" })),
      mailboxGet: () => Effect.succeed([inboxMailbox2]),
      emailQuery: () => Effect.succeed({ ids: ["M-fresh"], queryState: "qs-fresh" }),
      emailGet: () =>
        Effect.succeed([
          {
            id: "M-fresh",
            threadId: "T-fresh",
            mailboxIds: { "MBX-inbox": true },
            keywords: { $seen: false },
            from: [{ name: "Mira Patel", email: "mira@example.com" }],
            subject: "newer",
            preview: "p",
            receivedAt: "2026-05-14T14:00:00Z",
          },
        ]),
    });
    const program = Effect.gen(function* () {
      yield* upsertEmails([seeded]);
      yield* setConnectorCursor(CONNECTOR_NAME, "garbage-state");
      const run = yield* runOnce();
      const cursor = yield* getConnectorCursor(CONNECTOR_NAME);
      const threads = yield* upcomingUnreadThreads();
      return { run, cursor, threads };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.run.status).toBe("succeeded");
    expect(result.run.errorTag).toBe("recovered_via_catchup");
    expect(result.cursor?.stateToken).toBe("qs-fresh");
    // Reconciliation: M-stale (local-only) gone, M-fresh (upstream-only) present.
    expect(result.threads.map((t) => t.threadId).sort()).toEqual(["T-fresh"]);
  });

  it("still picks Bootstrap when no cursor row exists — Incremental short-circuit doesn't fire", async () => {
    // Regression coverage for the acceptance criterion "Bootstrap path is
    // still selected when no cursor row exists." Provides only Bootstrap-path
    // stubs; if Incremental ran instead, emailChanges would die.
    const inboxMailbox2 = { id: "MBX-inbox", name: "INBOX", role: "inbox" };
    const jmap = FastmailJmapStub({
      mailboxGet: () => Effect.succeed([inboxMailbox2]),
      emailQuery: () => Effect.succeed({ ids: [], queryState: "qs-bootstrap" }),
    });
    const program = Effect.gen(function* () {
      const run = yield* runOnce();
      const cursor = yield* getConnectorCursor(CONNECTOR_NAME);
      return { run, cursor };
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(result.run.status).toBe("succeeded");
    expect(result.cursor?.stateToken).toBe("qs-bootstrap");
  });
});
