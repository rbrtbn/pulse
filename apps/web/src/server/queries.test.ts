import { resolve } from "node:path";

import type { EmailRow, Run } from "@pulse/core";
import { runTest } from "@pulse/core/testing";
import { PulseDbTest, recordRun, upsertEmails } from "@pulse/database";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { deriveFailure, loadInbox } from "./queries";

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

const succeededAt = (iso: string) => ({
  connectorName: "fastmail" as const,
  startedAt: new Date(iso),
  endedAt: new Date(iso),
  status: "succeeded" as const,
});

const failedAt = (iso: string, errorTag: string, errorMessage: string) => ({
  connectorName: "fastmail" as const,
  startedAt: new Date(iso),
  endedAt: new Date(iso),
  status: "failed" as const,
  errorTag,
  errorMessage,
});

const unreadEmail = (): EmailRow => ({
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
});

const run = <A, E>(eff: Effect.Effect<A, E, never>) => runTest(eff);

describe("loadInbox", () => {
  it("State A — no Run rows, no threads: latestSuccess and failure both null", async () => {
    const result = await run(loadInbox().pipe(Effect.provide(PulseDbTest(migrationsFolder))));
    expect(result.threads).toEqual([]);
    expect(result.latestSuccess).toBeNull();
    expect(result.failure).toBeNull();
  });

  it("State B — a succeeded Run with no unread threads: latestSuccess set, failure null", async () => {
    const program = Effect.gen(function* () {
      yield* recordRun(succeededAt("2026-05-15T08:00:00Z"));
      return yield* loadInbox();
    });
    const result = await run(program.pipe(Effect.provide(PulseDbTest(migrationsFolder))));
    expect(result.threads).toEqual([]);
    expect(result.latestSuccess?.status).toBe("succeeded");
    expect(result.failure).toBeNull();
  });

  it("surfaces the failure banner when the newest attempt failed after the last success", async () => {
    const program = Effect.gen(function* () {
      yield* recordRun(succeededAt("2026-05-15T08:00:00Z"));
      yield* recordRun(failedAt("2026-05-15T09:00:00Z", "AuthError", "API token rejected"));
      return yield* loadInbox();
    });
    const result = await run(program.pipe(Effect.provide(PulseDbTest(migrationsFolder))));
    expect(result.failure).toEqual({ errorTag: "AuthError", errorMessage: "API token rejected" });
    expect(result.latestSuccess?.startedAt.toISOString()).toBe("2026-05-15T08:00:00.000Z");
  });

  it("clears the failure banner when a success post-dates the failure", async () => {
    const program = Effect.gen(function* () {
      yield* recordRun(failedAt("2026-05-15T09:00:00Z", "TransportError", "ECONNRESET"));
      yield* recordRun(succeededAt("2026-05-15T10:00:00Z"));
      return yield* loadInbox();
    });
    const result = await run(program.pipe(Effect.provide(PulseDbTest(migrationsFolder))));
    expect(result.failure).toBeNull();
    expect(result.latestSuccess?.startedAt.toISOString()).toBe("2026-05-15T10:00:00.000Z");
  });

  it("returns the unread thread list alongside the sync status", async () => {
    const program = Effect.gen(function* () {
      yield* upsertEmails([unreadEmail()]);
      yield* recordRun(succeededAt("2026-05-15T08:00:00Z"));
      return yield* loadInbox();
    });
    const result = await run(program.pipe(Effect.provide(PulseDbTest(migrationsFolder))));
    expect(result.threads.map((t) => t.threadId)).toEqual(["T-1"]);
  });
});

describe("deriveFailure", () => {
  const ok: Run = {
    id: 1,
    connectorName: "fastmail",
    startedAt: new Date("2026-05-15T10:00:00Z"),
    endedAt: new Date("2026-05-15T10:00:00Z"),
    status: "succeeded",
    errorTag: null,
    errorMessage: null,
  };
  const bad: Run = {
    id: 2,
    connectorName: "fastmail",
    startedAt: new Date("2026-05-15T11:00:00Z"),
    endedAt: new Date("2026-05-15T11:00:00Z"),
    status: "failed",
    errorTag: "AuthError",
    errorMessage: "token rejected",
  };

  it("returns null when there is no attempt at all", () => {
    expect(deriveFailure(null, null)).toBeNull();
  });

  it("returns null when the newest attempt succeeded", () => {
    expect(deriveFailure(ok, ok)).toBeNull();
  });

  it("returns null when a success is newer than the failed attempt", () => {
    const laterSuccess: Run = { ...ok, startedAt: new Date("2026-05-15T12:00:00Z") };
    expect(deriveFailure(bad, laterSuccess)).toBeNull();
  });

  it("surfaces the error when the failed attempt is the newest", () => {
    expect(deriveFailure(bad, ok)).toEqual({
      errorTag: "AuthError",
      errorMessage: "token rejected",
    });
  });

  it("surfaces the error when a failure exists and there has never been a success", () => {
    expect(deriveFailure(bad, null)).toEqual({
      errorTag: "AuthError",
      errorMessage: "token rejected",
    });
  });
});
