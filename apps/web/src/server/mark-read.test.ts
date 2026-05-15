import { resolve } from "node:path";

import { type EmailRow, TransportError } from "@pulse/core";
import { runTest } from "@pulse/core/testing";
import { openDb, PulseDb, runMigrations, upsertEmails } from "@pulse/database";
import { FastmailJmapStub } from "@pulse/jmap";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { runMarkRead } from "./mark-read";

const migrationsFolder = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "database",
  "migrations",
);

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

/**
 * A migrated in-memory DB wrapped as a concrete Layer — `Layer.succeed`
 * hands back the same instance every time, so the test's seed step and
 * `runMarkRead` (which provides its own layer internally) share one DB.
 */
const memoryDbLayer = (): Layer.Layer<PulseDb> => {
  const db = openDb(":memory:");
  runMigrations(db, migrationsFolder);
  return Layer.succeed(PulseDb, db);
};

describe("runMarkRead", () => {
  it("marks the thread read end-to-end through the Connector", async () => {
    const dbLayer = memoryDbLayer();
    const jmap = FastmailJmapStub({
      emailSet: (update) => Effect.succeed({ updated: Object.keys(update), notUpdated: [] }),
    });
    await runTest(upsertEmails([emailRow("M-1", "T-1", true)]).pipe(Effect.provide(dbLayer)));
    const result = await runTest(Effect.either(runMarkRead("M-1", Layer.merge(jmap, dbLayer))));
    expect(result._tag).toBe("Right");
  });

  it("surfaces MarkReadError when the Connector's JMAP write fails", async () => {
    const dbLayer = memoryDbLayer();
    const jmap = FastmailJmapStub({
      emailSet: () => Effect.fail(new TransportError({ source: "fastmail", detail: "ECONNRESET" })),
    });
    await runTest(upsertEmails([emailRow("M-1", "T-1", true)]).pipe(Effect.provide(dbLayer)));
    const result = await runTest(Effect.either(runMarkRead("M-1", Layer.merge(jmap, dbLayer))));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left._tag).toBe("MarkReadError");
  });
});
