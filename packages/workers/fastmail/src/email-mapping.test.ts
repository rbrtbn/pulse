import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { jmapToEmailRow } from "./email-mapping";

const observedAt = new Date("2026-05-14T15:00:00Z");

const wellFormed = {
  id: "M-1",
  threadId: "T-1",
  mailboxIds: { "MBX-1": true },
  keywords: { $seen: false },
  from: [{ name: "Mira Patel", email: "mira@example.com" }],
  subject: "Q2 planning",
  preview: "let's push to Thursday",
  receivedAt: "2026-05-14T14:00:00Z",
};

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff);

describe("jmapToEmailRow", () => {
  it("projects a well-formed JmapEmail into an EmailRow", async () => {
    const exit = await run(jmapToEmailRow(wellFormed, observedAt));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toMatchObject({
        id: "M-1",
        threadId: "T-1",
        isUnread: true,
        fromName: "Mira Patel",
        fromEmail: "mira@example.com",
        subject: "Q2 planning",
        preview: "let's push to Thursday",
        source: "fastmail",
      });
      expect(exit.value.receivedAt.toISOString()).toBe("2026-05-14T14:00:00.000Z");
      expect(exit.value.firstSeen).toEqual(observedAt);
      expect(exit.value.lastSeen).toEqual(observedAt);
    }
  });

  it("marks isUnread=true when keywords is absent", async () => {
    const { keywords: _keywords, ...withoutKeywords } = wellFormed;
    const exit = await run(jmapToEmailRow(withoutKeywords, observedAt));
    if (Exit.isSuccess(exit)) expect(exit.value.isUnread).toBe(true);
  });

  it("marks isUnread=false when $seen=true", async () => {
    const exit = await run(
      jmapToEmailRow({ ...wellFormed, keywords: { $seen: true } }, observedAt),
    );
    if (Exit.isSuccess(exit)) expect(exit.value.isUnread).toBe(false);
  });

  it("handles a null subject by mapping to empty string", async () => {
    const exit = await run(jmapToEmailRow({ ...wellFormed, subject: null }, observedAt));
    if (Exit.isSuccess(exit)) expect(exit.value.subject).toBe("");
  });

  it("handles a sender with no name by storing null in fromName", async () => {
    const exit = await run(
      jmapToEmailRow({ ...wellFormed, from: [{ email: "noreply@example.com" }] }, observedAt),
    );
    if (Exit.isSuccess(exit)) {
      expect(exit.value.fromName).toBeNull();
      expect(exit.value.fromEmail).toBe("noreply@example.com");
    }
  });

  it("fails with MalformedSourceResponse when id is missing", async () => {
    const { id: _id, ...withoutId } = wellFormed;
    const exit = await run(jmapToEmailRow(withoutId, observedAt));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
