import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { EmailRow, JmapEmail } from "./email";

const wellFormedJmapEmail = {
  id: "M-1234",
  threadId: "T-9876",
  mailboxIds: { "MBX-inbox": true },
  keywords: { $seen: true },
  from: [{ name: "Mira Patel", email: "mira@example.com" }],
  subject: "Re: Q2 planning doc",
  preview: "happy to push that to Thursday if it helps",
  receivedAt: "2026-05-14T14:03:00Z",
};

describe("JmapEmail schema", () => {
  it("parses a well-formed JMAP Email object", () => {
    const result = Schema.decodeUnknownEither(JmapEmail)(wellFormedJmapEmail);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts keywords omitted (Email/changes can return partials)", () => {
    const { keywords: _keywords, ...withoutKeywords } = wellFormedJmapEmail;
    const result = Schema.decodeUnknownEither(JmapEmail)(withoutKeywords);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a sender with no name (some addresses are email-only)", () => {
    const result = Schema.decodeUnknownEither(JmapEmail)({
      ...wellFormedJmapEmail,
      from: [{ email: "noreply@example.com" }],
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects an email missing required id", () => {
    const { id: _id, ...withoutId } = wellFormedJmapEmail;
    const result = Schema.decodeUnknownEither(JmapEmail)(withoutId);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an email whose receivedAt is not a string", () => {
    const result = Schema.decodeUnknownEither(JmapEmail)({
      ...wellFormedJmapEmail,
      receivedAt: 1_715_695_380,
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an email whose threadId is missing", () => {
    const { threadId: _threadId, ...withoutThreadId } = wellFormedJmapEmail;
    const result = Schema.decodeUnknownEither(JmapEmail)(withoutThreadId);
    expect(Either.isLeft(result)).toBe(true);
  });
});

const wellFormedEmailRow = {
  id: "M-1234",
  threadId: "T-9876",
  isUnread: false,
  fromName: "Mira Patel",
  fromEmail: "mira@example.com",
  subject: "Re: Q2 planning doc",
  preview: "happy to push that to Thursday if it helps",
  receivedAt: new Date("2026-05-14T14:03:00Z"),
  firstSeen: new Date("2026-05-14T14:05:00Z"),
  lastSeen: new Date("2026-05-14T14:05:00Z"),
  source: "fastmail" as const,
};

describe("EmailRow schema", () => {
  it("parses a well-formed Database row", () => {
    const result = Schema.decodeUnknownEither(EmailRow)(wellFormedEmailRow);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts fromName=null (senders with no display name)", () => {
    const result = Schema.decodeUnknownEither(EmailRow)({
      ...wellFormedEmailRow,
      fromName: null,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects source values other than 'fastmail' (M1 has one Source)", () => {
    const result = Schema.decodeUnknownEither(EmailRow)({
      ...wellFormedEmailRow,
      source: "github",
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects isUnread that is not a boolean", () => {
    const result = Schema.decodeUnknownEither(EmailRow)({
      ...wellFormedEmailRow,
      isUnread: "no",
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
