import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ConnectorCursor, Run, RunStatus } from "./run";

describe("RunStatus", () => {
  it.each(["succeeded", "failed"])("accepts %s", (status) => {
    const result = Schema.decodeUnknownEither(RunStatus)(status);
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects a third value (per ADR 0004 the enum is binary)", () => {
    const result = Schema.decodeUnknownEither(RunStatus)("recovered");
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("Run schema", () => {
  const wellFormed = {
    id: 1,
    connectorName: "fastmail",
    startedAt: new Date("2026-05-14T14:00:00Z"),
    endedAt: new Date("2026-05-14T14:00:05Z"),
    status: "succeeded" as const,
    errorTag: null,
    errorMessage: null,
  };

  it("parses a well-formed succeeded run", () => {
    const result = Schema.decodeUnknownEither(Run)(wellFormed);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts errorTag on a succeeded row (catchup audit, ADR 0004)", () => {
    const result = Schema.decodeUnknownEither(Run)({
      ...wellFormed,
      errorTag: "recovered_via_catchup",
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a failed row with tag + message", () => {
    const result = Schema.decodeUnknownEither(Run)({
      ...wellFormed,
      status: "failed",
      errorTag: "TransportError",
      errorMessage: "ECONNRESET",
    });
    expect(Either.isRight(result)).toBe(true);
  });
});

describe("ConnectorCursor schema", () => {
  it("parses a well-formed cursor row", () => {
    const result = Schema.decodeUnknownEither(ConnectorCursor)({
      connectorName: "fastmail",
      stateToken: "state-abc-123",
      updatedAt: new Date("2026-05-14T14:00:00Z"),
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects a cursor with non-string stateToken", () => {
    const result = Schema.decodeUnknownEither(ConnectorCursor)({
      connectorName: "fastmail",
      stateToken: 12345,
      updatedAt: new Date(),
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
