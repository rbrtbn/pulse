import { describe, expect, it } from "vitest";

import { formatHybrid } from "./time-format";

const now = new Date("2026-05-14T14:00:00Z");

describe("formatHybrid", () => {
  it("renders today's time as HH:MM", () => {
    const out = formatHybrid(new Date("2026-05-14T12:34:00Z"), now);
    expect(out).toMatch(/^\d{2}:\d{2}$/);
  });

  it("prefixes yesterday's time with 'Yesterday '", () => {
    const out = formatHybrid(new Date("2026-05-13T20:00:00Z"), now);
    expect(out.startsWith("Yesterday ")).toBe(true);
  });

  it("prefixes earlier this week with a 3-letter weekday", () => {
    const out = formatHybrid(new Date("2026-05-11T10:00:00Z"), now);
    // Mon/Tue/Wed/etc. depending on locale, but always 3 chars + " " + HH:MM
    expect(out).toMatch(/^\w{3} \d{2}:\d{2}$/);
  });

  it("renders earlier this year without the year", () => {
    const out = formatHybrid(new Date("2026-01-15T10:00:00Z"), now);
    expect(out).not.toMatch(/2026/);
    expect(out).toMatch(/Jan/);
  });

  it("includes the year for prior years", () => {
    const out = formatHybrid(new Date("2025-12-01T10:00:00Z"), now);
    expect(out).toMatch(/2025/);
  });
});
