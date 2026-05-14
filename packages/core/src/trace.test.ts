import { describe, expect, it } from "vitest";

import { newTraceId } from "./trace";

describe("newTraceId", () => {
  it("returns an 8-character lowercase hex string", () => {
    const id = newTraceId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns different values across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newTraceId()));
    expect(ids.size).toBeGreaterThan(95);
  });
});
