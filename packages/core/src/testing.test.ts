import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { DatabaseError } from "./errors";
import { runTest, runTestExit } from "./testing";

describe("runTest", () => {
  it("resolves the success value", async () => {
    await expect(runTest(Effect.succeed(42))).resolves.toBe(42);
  });

  it("rejects with the typed error on Effect.fail", async () => {
    const failing = Effect.fail(new DatabaseError({ op: "x", detail: "boom" }));
    await expect(runTest(failing)).rejects.toMatchObject({
      _tag: "DatabaseError",
      op: "x",
      detail: "boom",
    });
  });

  it("traps an unwrapped sync throw inside Effect.gen as a loud defect", async () => {
    // The pattern that caused the original tryDb bug: a plain function
    // call inside Effect.gen that throws. Effect treats this as a defect
    // (Cause.Die), invisible in the error channel. runTest must surface it.
    const liar: Effect.Effect<number, never> = Effect.gen(function* () {
      yield* Effect.succeed(undefined);
      throw new Error("sensitive internal detail");
    });
    await expect(runTest(liar)).rejects.toThrow(/Unexpected defect.*sensitive internal detail/s);
  });

  it("traps Effect.die directly", async () => {
    const dying = Effect.die("boom-payload");
    await expect(runTest(dying)).rejects.toThrow(/Unexpected defect/);
  });
});

describe("runTestExit", () => {
  it("returns the Exit on success", async () => {
    const exit = await runTestExit(Effect.succeed("ok"));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe("ok");
  });

  it("returns the Exit on typed failure (does NOT throw)", async () => {
    const failing = Effect.fail(new DatabaseError({ op: "x", detail: "boom" }));
    const exit = await runTestExit(failing);
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("throws loudly when the Exit carries a defect", async () => {
    const dying = Effect.die("internal");
    await expect(runTestExit(dying)).rejects.toThrow(/Unexpected defect/);
  });
});
