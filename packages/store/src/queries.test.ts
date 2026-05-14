import { resolve } from "node:path";

import type { EmailRow } from "@cerebro/core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { StoreDbTest } from "./db";
import {
  deleteEmailsByIds,
  getSyncCursor,
  latestSyncRun,
  latestSyncRunAttempt,
  recordSyncRun,
  setEmailUnread,
  setSyncCursor,
  upcomingUnreadThreads,
  upsertEmails,
} from "./queries";

const migrationsFolder = resolve(import.meta.dirname, "..", "migrations");

const testLayer = () => StoreDbTest(migrationsFolder);

const sampleEmail = (overrides: Partial<EmailRow> = {}): EmailRow => ({
  id: "M-1",
  threadId: "T-1",
  isUnread: true,
  fromName: "Mira Patel",
  fromEmail: "mira@example.com",
  subject: "Q2 planning",
  preview: "let's push to Thursday",
  receivedAt: new Date("2026-05-14T14:00:00Z"),
  firstSeen: new Date("2026-05-14T14:05:00Z"),
  lastSeen: new Date("2026-05-14T14:05:00Z"),
  source: "fastmail",
  ...overrides,
});

const run = <A>(effect: Effect.Effect<A, never, never>): Promise<A> => Effect.runPromise(effect);

describe("upcomingUnreadThreads", () => {
  let layer: ReturnType<typeof testLayer>;

  beforeEach(() => {
    layer = testLayer();
  });

  it("returns an empty list on an empty Store", async () => {
    const result = await run(upcomingUnreadThreads().pipe(Effect.provide(layer)));
    expect(result).toEqual([]);
  });

  it("returns a single thread when all messages are unread", async () => {
    const program = Effect.gen(function* () {
      yield* upsertEmails([sampleEmail()]);
      return yield* upcomingUnreadThreads();
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result).toHaveLength(1);
    expect(result[0]?.threadId).toBe("T-1");
    expect(result[0]?.messageCount).toBe(1);
    expect(result[0]?.distinctOthers).toBe(0);
    expect(result[0]?.latestFromName).toBe("Mira Patel");
  });

  it("excludes threads where every message is read", async () => {
    const program = Effect.gen(function* () {
      yield* upsertEmails([sampleEmail({ id: "M-1", threadId: "T-read", isUnread: false })]);
      return yield* upcomingUnreadThreads();
    });
    expect(await run(program.pipe(Effect.provide(layer)))).toEqual([]);
  });

  it("includes a thread when at least one message is unread", async () => {
    const program = Effect.gen(function* () {
      yield* upsertEmails([
        sampleEmail({
          id: "M-1",
          threadId: "T-mix",
          isUnread: false,
          receivedAt: new Date("2026-05-13T10:00:00Z"),
        }),
        sampleEmail({
          id: "M-2",
          threadId: "T-mix",
          isUnread: true,
          receivedAt: new Date("2026-05-14T10:00:00Z"),
        }),
      ]);
      return yield* upcomingUnreadThreads();
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result).toHaveLength(1);
    expect(result[0]?.messageCount).toBe(2);
  });

  it('counts distinct senders in distinctOthers ("+N" calculation)', async () => {
    const program = Effect.gen(function* () {
      yield* upsertEmails([
        sampleEmail({
          id: "M-1",
          threadId: "T-multi",
          fromEmail: "alice@example.com",
          receivedAt: new Date("2026-05-13T10:00:00Z"),
        }),
        sampleEmail({
          id: "M-2",
          threadId: "T-multi",
          fromEmail: "bob@example.com",
          receivedAt: new Date("2026-05-13T12:00:00Z"),
        }),
        sampleEmail({
          id: "M-3",
          threadId: "T-multi",
          fromEmail: "alice@example.com",
          receivedAt: new Date("2026-05-14T10:00:00Z"),
        }),
      ]);
      return yield* upcomingUnreadThreads();
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result[0]?.distinctOthers).toBe(1);
  });

  it("orders threads by latest-message desc", async () => {
    const program = Effect.gen(function* () {
      yield* upsertEmails([
        sampleEmail({
          id: "M-a",
          threadId: "T-old",
          receivedAt: new Date("2026-05-10T10:00:00Z"),
        }),
        sampleEmail({
          id: "M-b",
          threadId: "T-new",
          receivedAt: new Date("2026-05-14T10:00:00Z"),
        }),
      ]);
      return yield* upcomingUnreadThreads();
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result.map((t) => t.threadId)).toEqual(["T-new", "T-old"]);
  });

  it("caps the result at 50 threads", async () => {
    const program = Effect.gen(function* () {
      const many: EmailRow[] = [];
      for (let i = 0; i < 75; i += 1) {
        many.push(
          sampleEmail({
            id: `M-${i.toString()}`,
            threadId: `T-${i.toString()}`,
            receivedAt: new Date(2026, 4, 1 + i, 12, 0, 0),
          }),
        );
      }
      yield* upsertEmails(many);
      return yield* upcomingUnreadThreads();
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result).toHaveLength(50);
  });
});

describe("upsertEmails", () => {
  it("updates existing rows in place when ids collide", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* upsertEmails([sampleEmail({ subject: "v1" })]);
      yield* upsertEmails([sampleEmail({ subject: "v2" })]);
      return yield* upcomingUnreadThreads();
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result).toHaveLength(1);
    expect(result[0]?.subject).toBe("v2");
  });

  it("is a no-op when called with an empty array", async () => {
    const layer = testLayer();
    await run(upsertEmails([]).pipe(Effect.provide(layer)));
  });
});

describe("deleteEmailsByIds", () => {
  it("removes the specified rows", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* upsertEmails([
        sampleEmail({ id: "M-1", threadId: "T-1" }),
        sampleEmail({ id: "M-2", threadId: "T-2" }),
      ]);
      yield* deleteEmailsByIds(["M-1"]);
      return yield* upcomingUnreadThreads();
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result.map((t) => t.threadId)).toEqual(["T-2"]);
  });
});

describe("setEmailUnread", () => {
  it("flips is_unread to false for the supplied ids", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* upsertEmails([
        sampleEmail({ id: "M-1", threadId: "T-1" }),
        sampleEmail({ id: "M-2", threadId: "T-2" }),
      ]);
      yield* setEmailUnread(["M-1"], false);
      return yield* upcomingUnreadThreads();
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result.map((t) => t.threadId)).toEqual(["T-2"]);
  });
});

describe("recordSyncRun + latestSyncRun + latestSyncRunAttempt", () => {
  it("returns null when no runs exist", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      const ok = yield* latestSyncRun("fastmail");
      const any = yield* latestSyncRunAttempt("fastmail");
      return { ok, any };
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result.ok).toBeNull();
    expect(result.any).toBeNull();
  });

  it("latestSyncRun returns the most recent succeeded row", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* recordSyncRun({
        workerName: "fastmail",
        startedAt: new Date("2026-05-14T10:00:00Z"),
        endedAt: new Date("2026-05-14T10:00:05Z"),
        status: "succeeded",
        errorTag: null,
        errorMessage: null,
      });
      yield* recordSyncRun({
        workerName: "fastmail",
        startedAt: new Date("2026-05-14T11:00:00Z"),
        endedAt: new Date("2026-05-14T11:00:03Z"),
        status: "failed",
        errorTag: "TransportError",
        errorMessage: "ECONNRESET",
      });
      return yield* latestSyncRun("fastmail");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result?.status).toBe("succeeded");
    expect(result?.startedAt.toISOString()).toBe("2026-05-14T10:00:00.000Z");
  });

  it("latestSyncRunAttempt returns the most recent regardless of outcome", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* recordSyncRun({
        workerName: "fastmail",
        startedAt: new Date("2026-05-14T10:00:00Z"),
        endedAt: new Date("2026-05-14T10:00:05Z"),
        status: "succeeded",
        errorTag: null,
        errorMessage: null,
      });
      yield* recordSyncRun({
        workerName: "fastmail",
        startedAt: new Date("2026-05-14T11:00:00Z"),
        endedAt: new Date("2026-05-14T11:00:03Z"),
        status: "failed",
        errorTag: "TransportError",
        errorMessage: "ECONNRESET",
      });
      return yield* latestSyncRunAttempt("fastmail");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result?.status).toBe("failed");
    expect(result?.errorTag).toBe("TransportError");
  });

  it("succeeded row carries audit errorTag (catchup recovery per ADR 0004)", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* recordSyncRun({
        workerName: "fastmail",
        startedAt: new Date("2026-05-14T10:00:00Z"),
        endedAt: new Date("2026-05-14T10:00:05Z"),
        status: "succeeded",
        errorTag: "recovered_via_catchup",
        errorMessage: null,
      });
      return yield* latestSyncRun("fastmail");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result?.status).toBe("succeeded");
    expect(result?.errorTag).toBe("recovered_via_catchup");
  });
});

describe("getSyncCursor + setSyncCursor", () => {
  it("returns null before any cursor is set (Bootstrap path will be selected)", async () => {
    const layer = testLayer();
    const result = await run(getSyncCursor("fastmail").pipe(Effect.provide(layer)));
    expect(result).toBeNull();
  });

  it("round-trips a cursor token", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* setSyncCursor("fastmail", "state-abc-123");
      return yield* getSyncCursor("fastmail");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result?.stateToken).toBe("state-abc-123");
  });

  it("upserts the cursor in place on repeated writes", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* setSyncCursor("fastmail", "state-v1");
      yield* setSyncCursor("fastmail", "state-v2");
      return yield* getSyncCursor("fastmail");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result?.stateToken).toBe("state-v2");
  });
});
