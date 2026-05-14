import { StoreError } from "@cerebro/core";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redactToLoader } from "./redact";

describe("redactToLoader", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns the value on success without logging", async () => {
    const result = await redactToLoader("Inbox", Effect.succeed(42));
    expect(result).toBe(42);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("redacts typed failures: throws generic Error with trace ID, logs full cause", async () => {
    const sensitive = "unable to open database file: /Users/robertban/code/cerebro/data/cerebro.db";
    const failing = Effect.fail(new StoreError({ op: "upcomingUnreadThreads", detail: sensitive }));

    await expect(redactToLoader("Inbox", failing)).rejects.toThrow(
      /^Inbox unavailable \(trace=[0-9a-f]{8}\)$/,
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toMatch(/^\[trace=[0-9a-f]{8}\] Inbox failed:/);
    // Full sensitive detail lands in the server log.
    expect(logged).toContain(sensitive);
    expect(logged).toContain("upcomingUnreadThreads");
  });

  it("redacts defects (uncaught throws inside an Effect) the same way", async () => {
    const sensitive = "internal-detail-must-not-leak";
    const boom = Effect.sync(() => {
      throw new Error(sensitive);
    });

    await expect(redactToLoader("Inbox", boom)).rejects.toThrow(
      /^Inbox unavailable \(trace=[0-9a-f]{8}\)$/,
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain(sensitive);
  });

  it("re-uses the trace ID across the thrown message and the log line", async () => {
    const failing = Effect.fail(new StoreError({ op: "test", detail: "x" }));
    try {
      await redactToLoader("Inbox", failing);
      expect.fail("should have thrown");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const userTrace = /trace=([0-9a-f]{8})/.exec(msg)?.[1];
      const logTrace = /trace=([0-9a-f]{8})/.exec(String(errorSpy.mock.calls[0]?.[0] ?? ""))?.[1];
      expect(userTrace).toBeDefined();
      expect(userTrace).toBe(logTrace);
    }
  });
});
