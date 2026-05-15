import { resolve } from "node:path";

import type { EmailRow } from "@pulse/core";
import { runTest } from "@pulse/core/testing";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { PulseDbTest, tryDb } from "./db";
import {
  deleteEmailsByIds,
  getEmailIdsSince,
  getConnectorCursor,
  getThreadIdForEmail,
  getUnreadEmailIdsByThread,
  latestRun,
  latestRunAttempt,
  recordRun,
  setEmailUnread,
  setConnectorCursor,
  upcomingUnreadThreads,
  upsertEmails,
} from "./queries";

const migrationsFolder = resolve(import.meta.dirname, "..", "migrations");

const testLayer = () => PulseDbTest(migrationsFolder);

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

const run = runTest;

describe("upcomingUnreadThreads", () => {
  let layer: ReturnType<typeof testLayer>;

  beforeEach(() => {
    layer = testLayer();
  });

  it("returns an empty list on an empty Database", async () => {
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
    expect(result[0]?.latestEmailId).toBe("M-1");
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
    // latestEmailId tracks the newest message in the thread.
    expect(result[0]?.latestEmailId).toBe("M-2");
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

describe("getEmailIdsSince", () => {
  it("returns ids of rows received on or after the given date, omitting older rows", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* upsertEmails([
        sampleEmail({ id: "M-old", receivedAt: new Date("2026-04-01T00:00:00Z") }),
        sampleEmail({ id: "M-edge", receivedAt: new Date("2026-04-15T00:00:00Z") }),
        sampleEmail({ id: "M-new", receivedAt: new Date("2026-05-14T00:00:00Z") }),
      ]);
      return yield* getEmailIdsSince(new Date("2026-04-15T00:00:00Z"));
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    // gte: the boundary row is included.
    expect([...result].sort()).toEqual(["M-edge", "M-new"]);
  });

  it("returns an empty array when no rows match the window", async () => {
    const layer = testLayer();
    const result = await run(
      getEmailIdsSince(new Date("2099-01-01T00:00:00Z")).pipe(Effect.provide(layer)),
    );
    expect(result).toEqual([]);
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

describe("recordRun + latestRun + latestRunAttempt", () => {
  it("returns null when no runs exist", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      const ok = yield* latestRun("fastmail");
      const any = yield* latestRunAttempt("fastmail");
      return { ok, any };
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result.ok).toBeNull();
    expect(result.any).toBeNull();
  });

  it("latestRun returns the most recent succeeded row", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* recordRun({
        connectorName: "fastmail",
        startedAt: new Date("2026-05-14T10:00:00Z"),
        endedAt: new Date("2026-05-14T10:00:05Z"),
        status: "succeeded",
      });
      yield* recordRun({
        connectorName: "fastmail",
        startedAt: new Date("2026-05-14T11:00:00Z"),
        endedAt: new Date("2026-05-14T11:00:03Z"),
        status: "failed",
        errorTag: "TransportError",
        errorMessage: "ECONNRESET",
      });
      return yield* latestRun("fastmail");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result?.status).toBe("succeeded");
    expect(result?.startedAt.toISOString()).toBe("2026-05-14T10:00:00.000Z");
  });

  it("latestRunAttempt returns the most recent regardless of outcome", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* recordRun({
        connectorName: "fastmail",
        startedAt: new Date("2026-05-14T10:00:00Z"),
        endedAt: new Date("2026-05-14T10:00:05Z"),
        status: "succeeded",
      });
      yield* recordRun({
        connectorName: "fastmail",
        startedAt: new Date("2026-05-14T11:00:00Z"),
        endedAt: new Date("2026-05-14T11:00:03Z"),
        status: "failed",
        errorTag: "TransportError",
        errorMessage: "ECONNRESET",
      });
      return yield* latestRunAttempt("fastmail");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result?.status).toBe("failed");
    expect(result?.errorTag).toBe("TransportError");
  });

  it("succeeded row carries an audit annotation (catchup recovery per ADR 0004)", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* recordRun({
        connectorName: "fastmail",
        startedAt: new Date("2026-05-14T10:00:00Z"),
        endedAt: new Date("2026-05-14T10:00:05Z"),
        status: "succeeded",
        annotation: "recovered_via_catchup",
      });
      return yield* latestRun("fastmail");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result?.status).toBe("succeeded");
    // Annotation lands in error_tag column for backward compatibility with
    // the binary status schema (ADR 0004).
    expect(result?.errorTag).toBe("recovered_via_catchup");
  });
});

describe("getConnectorCursor + setConnectorCursor", () => {
  it("returns null before any cursor is set (Bootstrap path will be selected)", async () => {
    const layer = testLayer();
    const result = await run(getConnectorCursor("fastmail").pipe(Effect.provide(layer)));
    expect(result).toBeNull();
  });

  it("round-trips a cursor token", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* setConnectorCursor("fastmail", "state-abc-123");
      return yield* getConnectorCursor("fastmail");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result?.stateToken).toBe("state-abc-123");
  });

  it("upserts the cursor in place on repeated writes", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* setConnectorCursor("fastmail", "state-v1");
      yield* setConnectorCursor("fastmail", "state-v2");
      return yield* getConnectorCursor("fastmail");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect(result?.stateToken).toBe("state-v2");
  });
});

describe("getThreadIdForEmail", () => {
  it("returns null when the email id is not in the Database", async () => {
    const result = await run(getThreadIdForEmail("M-ghost").pipe(Effect.provide(testLayer())));
    expect(result).toBeNull();
  });

  it("returns the thread id of a stored email", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* upsertEmails([sampleEmail({ id: "M-1", threadId: "T-42" })]);
      return yield* getThreadIdForEmail("M-1");
    });
    expect(await run(program.pipe(Effect.provide(layer)))).toBe("T-42");
  });
});

describe("getUnreadEmailIdsByThread", () => {
  it("returns an empty list when the thread has no rows", async () => {
    const result = await run(getUnreadEmailIdsByThread("T-none").pipe(Effect.provide(testLayer())));
    expect(result).toEqual([]);
  });

  it("returns only the unread message ids in the thread", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* upsertEmails([
        sampleEmail({ id: "M-1", threadId: "T-1", isUnread: true }),
        sampleEmail({ id: "M-2", threadId: "T-1", isUnread: false }),
        sampleEmail({ id: "M-3", threadId: "T-1", isUnread: true }),
      ]);
      return yield* getUnreadEmailIdsByThread("T-1");
    });
    const result = await run(program.pipe(Effect.provide(layer)));
    expect([...result].sort()).toEqual(["M-1", "M-3"]);
  });

  it("returns an empty list when every message in the thread is already read", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* upsertEmails([sampleEmail({ id: "M-1", threadId: "T-read", isUnread: false })]);
      return yield* getUnreadEmailIdsByThread("T-read");
    });
    expect(await run(program.pipe(Effect.provide(layer)))).toEqual([]);
  });

  it("isolates unread ids to the requested thread", async () => {
    const layer = testLayer();
    const program = Effect.gen(function* () {
      yield* upsertEmails([
        sampleEmail({ id: "M-1", threadId: "T-1", isUnread: true }),
        sampleEmail({ id: "M-2", threadId: "T-2", isUnread: true }),
      ]);
      return yield* getUnreadEmailIdsByThread("T-1");
    });
    expect(await run(program.pipe(Effect.provide(layer)))).toEqual(["M-1"]);
  });
});

describe("tryDb (DatabaseError surface)", () => {
  it("wraps a synchronous throw as a DatabaseError carrying op + detail", async () => {
    const program = tryDb("test-op", () => {
      throw new Error("simulated DB failure");
    }).pipe(Effect.either, Effect.provide(testLayer()));
    const result = await runTest(program);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("DatabaseError");
      expect(result.left.op).toBe("test-op");
      expect(result.left.detail).toBe("simulated DB failure");
    }
  });

  it("stringifies non-Error throws into detail", async () => {
    const program = tryDb("weird-op", () => {
      throw "not an Error instance";
    }).pipe(Effect.either, Effect.provide(testLayer()));
    const result = await runTest(program);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.detail).toBe("not an Error instance");
    }
  });
});
