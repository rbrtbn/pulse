import { resolve } from "node:path";

import { type EmailRow, TransportError } from "@pulse/core";
import { runTest } from "@pulse/core/testing";
import { getUnreadEmailIdsByThread, PulseDb, PulseDbTest, upsertEmails } from "@pulse/database";
import { FastmailJmap, FastmailJmapStub } from "@pulse/jmap";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { markRead } from "./mark-read";

const migrationsFolder = resolve(import.meta.dirname, "..", "..", "..", "database", "migrations");

const at = new Date("2026-05-14T14:00:00Z");

const emailRow = (id: string, threadId: string, isUnread: boolean): EmailRow => ({
  id,
  threadId,
  isUnread,
  fromName: null,
  fromEmail: "sender@example.com",
  subject: `subject ${id}`,
  preview: "preview",
  receivedAt: at,
  firstSeen: at,
  lastSeen: at,
  source: "fastmail",
});

const layers = (jmap: Layer.Layer<FastmailJmap>): Layer.Layer<FastmailJmap | PulseDb> =>
  Layer.merge(jmap, PulseDbTest(migrationsFolder));

describe("markRead", () => {
  it("marks every unread message in the thread read when Email/set succeeds", async () => {
    const jmap = FastmailJmapStub({
      emailSet: (update) => Effect.succeed({ updated: Object.keys(update), notUpdated: [] }),
    });
    const program = Effect.gen(function* () {
      yield* upsertEmails([emailRow("M-1", "T-1", true), emailRow("M-2", "T-1", true)]);
      yield* markRead("M-1");
      return yield* getUnreadEmailIdsByThread("T-1");
    });
    const stillUnread = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(stillUnread).toEqual([]);
  });

  it("returns MarkReadError and leaves the Database untouched when Email/set errors", async () => {
    const jmap = FastmailJmapStub({
      emailSet: () => Effect.fail(new TransportError({ source: "fastmail", detail: "ECONNRESET" })),
    });
    const program = Effect.gen(function* () {
      yield* upsertEmails([emailRow("M-1", "T-1", true)]);
      const outcome = yield* Effect.either(markRead("M-1"));
      const stillUnread = yield* getUnreadEmailIdsByThread("T-1");
      return { outcome, stillUnread };
    });
    const { outcome, stillUnread } = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(outcome._tag).toBe("Left");
    if (outcome._tag === "Left") {
      expect(outcome.left._tag).toBe("MarkReadError");
      expect(outcome.left.emailId).toBe("M-1");
    }
    expect(stillUnread).toEqual(["M-1"]);
  });

  it("returns MarkReadError when JMAP refuses an id (notUpdated) — Database untouched", async () => {
    const jmap = FastmailJmapStub({
      emailSet: (update) => Effect.succeed({ updated: [], notUpdated: Object.keys(update) }),
    });
    const program = Effect.gen(function* () {
      yield* upsertEmails([emailRow("M-1", "T-1", true)]);
      const outcome = yield* Effect.either(markRead("M-1"));
      const stillUnread = yield* getUnreadEmailIdsByThread("T-1");
      return { outcome, stillUnread };
    });
    const { outcome, stillUnread } = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect(outcome._tag).toBe("Left");
    if (outcome._tag === "Left") expect(outcome.left._tag).toBe("MarkReadError");
    expect(stillUnread).toEqual(["M-1"]);
  });

  it("no-ops without a JMAP call when the thread is already fully read", async () => {
    // FastmailJmapStub({}) provides no emailSet — it dies loudly if called.
    const program = Effect.gen(function* () {
      yield* upsertEmails([emailRow("M-1", "T-read", false)]);
      yield* markRead("M-1");
      return yield* getUnreadEmailIdsByThread("T-read");
    });
    const stillUnread = await runTest(program.pipe(Effect.provide(layers(FastmailJmapStub({})))));
    expect(stillUnread).toEqual([]);
  });

  it("no-ops without a JMAP call when the email id is not tracked", async () => {
    const result = await runTest(
      markRead("M-ghost").pipe(Effect.provide(layers(FastmailJmapStub({})))),
    );
    expect(result).toBeUndefined();
  });
});
