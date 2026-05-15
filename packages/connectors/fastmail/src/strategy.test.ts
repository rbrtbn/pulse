import { resolve } from "node:path";

import { CannotCalculateChanges } from "@pulse/core";
import { runTest } from "@pulse/core/testing";
import { FastmailJmap, FastmailJmapStub } from "@pulse/jmap";
import { PulseDb, PulseDbTest, upsertEmails } from "@pulse/database";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { catchupStrategy, incrementalStrategy } from "./strategy";

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

const layers = (jmap: Layer.Layer<FastmailJmap>): Layer.Layer<FastmailJmap | PulseDb> =>
  Layer.merge(jmap, PulseDbTest(migrationsFolder));

describe("incrementalStrategy", () => {
  it("applies created + updated rows, returns destroyed as idsToDelete, advances cursor", async () => {
    const jmap = FastmailJmapStub({
      emailChanges: () =>
        Effect.succeed({
          created: ["M-new"],
          updated: ["M-mod"],
          destroyed: ["M-gone"],
          newState: "state-2",
          hasMoreChanges: false,
        }),
      emailGet: () =>
        Effect.succeed([sampleEmail("M-new", "T-new"), sampleEmail("M-mod", "T-mod")]),
    });
    const result = await runTest(
      incrementalStrategy(new Date(), "state-1").pipe(Effect.provide(layers(jmap))),
    );
    expect(result.rows.map((r) => r.id).sort()).toEqual(["M-mod", "M-new"]);
    expect(result.idsToDelete).toEqual(["M-gone"]);
    expect(result.cursorToken).toBe("state-2");
    expect(result.annotation).toBeUndefined();
  });

  it("fetches both created and updated ids in a single Email/get call", async () => {
    // Bounded-fetch concern: created and updated should be merged, not
    // fetched separately, so we make at most one Email/get round-trip.
    const emailGetCalls: ReadonlyArray<string>[] = [];
    const jmap = FastmailJmapStub({
      emailChanges: () =>
        Effect.succeed({
          created: ["M-a"],
          updated: ["M-b"],
          destroyed: [],
          newState: "state-2",
          hasMoreChanges: false,
        }),
      emailGet: (ids) => {
        emailGetCalls.push([...ids]);
        return Effect.succeed([sampleEmail("M-a", "T-a"), sampleEmail("M-b", "T-b")]);
      },
    });
    await runTest(incrementalStrategy(new Date(), "state-1").pipe(Effect.provide(layers(jmap))));
    expect(emailGetCalls).toHaveLength(1);
    expect([...emailGetCalls[0]!].sort()).toEqual(["M-a", "M-b"]);
  });

  it("yields empty rows and skips Email/get when no created/updated changes exist", async () => {
    let emailGetCalled = false;
    const jmap = FastmailJmapStub({
      emailChanges: () =>
        Effect.succeed({
          created: [],
          updated: [],
          destroyed: ["M-d"],
          newState: "state-2",
          hasMoreChanges: false,
        }),
      emailGet: () => {
        emailGetCalled = true;
        return Effect.succeed([]);
      },
    });
    const result = await runTest(
      incrementalStrategy(new Date(), "state-1").pipe(Effect.provide(layers(jmap))),
    );
    expect(result.rows).toEqual([]);
    expect(result.idsToDelete).toEqual(["M-d"]);
    expect(result.cursorToken).toBe("state-2");
    expect(emailGetCalled).toBe(false);
  });

  it("falls back to catchupStrategy when emailChanges returns CannotCalculateChanges", async () => {
    const startedAt = new Date("2026-05-14T12:00:00Z");
    const jmap = FastmailJmapStub({
      emailChanges: () => Effect.fail(new CannotCalculateChanges({ source: "fastmail" })),
      mailboxGet: () => Effect.succeed([inboxMailbox]),
      emailQuery: () => Effect.succeed({ ids: ["M-up"], queryState: "state-fresh" }),
      emailGet: () => Effect.succeed([sampleEmail("M-up", "T-up")]),
    });
    const result = await runTest(
      incrementalStrategy(startedAt, "stale-state").pipe(Effect.provide(layers(jmap))),
    );
    // Catchup's signature: annotation set, cursor from a fresh Email/query.
    expect(result.annotation).toBe("recovered_via_catchup");
    expect(result.cursorToken).toBe("state-fresh");
    expect(result.rows.map((r) => r.id)).toEqual(["M-up"]);
  });
});

describe("catchupStrategy", () => {
  it("reconciles [A,B,C] vs upstream [B,C,D] AND fetches only the new id", async () => {
    // The bounded-fetch invariant — Email/get must receive [M-D] only, not
    // the full upstream list. Re-fetching B and C on every Catchup would
    // waste bandwidth proportional to the window size.
    const recentDate = new Date("2026-05-14T14:00:00Z");
    const seed = (id: string, threadId: string) => ({
      id,
      threadId,
      isUnread: true,
      fromName: null,
      fromEmail: "sender@example.com",
      subject: `Subject ${id}`,
      preview: "preview",
      receivedAt: recentDate,
      firstSeen: recentDate,
      lastSeen: recentDate,
      source: "fastmail" as const,
    });
    const emailGetCalls: ReadonlyArray<string>[] = [];
    const jmap = FastmailJmapStub({
      mailboxGet: () => Effect.succeed([inboxMailbox]),
      emailQuery: () => Effect.succeed({ ids: ["M-B", "M-C", "M-D"], queryState: "state-fresh" }),
      emailGet: (ids) => {
        emailGetCalls.push([...ids]);
        return Effect.succeed([sampleEmail("M-D", "T-D")]);
      },
    });
    const program = Effect.gen(function* () {
      yield* upsertEmails([seed("M-A", "T-A"), seed("M-B", "T-B"), seed("M-C", "T-C")]);
      return yield* catchupStrategy(new Date());
    });
    const result = await runTest(program.pipe(Effect.provide(layers(jmap))));
    expect([...result.idsToDelete!].sort()).toEqual(["M-A"]);
    expect(result.rows.map((r) => r.id)).toEqual(["M-D"]);
    expect(emailGetCalls).toEqual([["M-D"]]);
    expect(result.cursorToken).toBe("state-fresh");
    expect(result.annotation).toBe("recovered_via_catchup");
  });

  it("annotates the result with recovered_via_catchup even when no diff exists", async () => {
    const jmap = FastmailJmapStub({
      mailboxGet: () => Effect.succeed([inboxMailbox]),
      emailQuery: () => Effect.succeed({ ids: [], queryState: "state-fresh" }),
    });
    const result = await runTest(catchupStrategy(new Date()).pipe(Effect.provide(layers(jmap))));
    expect(result.rows).toEqual([]);
    expect(result.idsToDelete).toEqual([]);
    expect(result.annotation).toBe("recovered_via_catchup");
  });
});
