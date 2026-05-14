import { Cause, Effect, Exit } from "effect";

/**
 * Test-side runner that traps defects.
 *
 * Effect distinguishes two kinds of failures:
 * - **Typed failure** (`Cause.Fail`) — flowed through the error channel,
 *   visible in the function signature, catchable with `catchTag`. The
 *   normal, declared way an effect can go wrong.
 * - **Defect** (`Cause.Die`) — an *uncaught* synchronous throw that
 *   escaped the Effect runtime. Invisible in the type, uncatchable by
 *   `catchTag`. Happens when non-Effect code (a plain thunk, a
 *   third-party callback) throws inside `Effect.gen` without being
 *   wrapped in `Effect.try` / `Effect.tryPromise`.
 *
 * The earlier `tryDb` bug — `Effect<X, never, R>` that actually could
 * throw — was a defect-shaped hole. Plain `Effect.runPromise` rejects
 * with a `FiberFailure` either way, so tests passed without proving the
 * declared `never` was honest.
 *
 * `runTest` runs via `runPromiseExit` and surfaces any defect as a loud
 * "Unexpected defect: …" error so the test fails with a clear signal
 * rather than the defect masquerading as a typed failure.
 *
 * Use this in every test file in place of `Effect.runPromise`. The
 * surface stays the same: success resolves the value; typed failures
 * reject with the typed error (so `.rejects.toMatchObject({ _tag })`
 * keeps working).
 */
export const runTest = async <A, E>(eff: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(eff);
  if (Exit.isSuccess(exit)) return exit.value;
  const die = Cause.dieOption(exit.cause);
  if (die._tag === "Some") {
    throw new Error(`Unexpected defect: ${Cause.pretty(exit.cause)}`);
  }
  const failures = Array.from(Cause.failures(exit.cause));
  if (failures.length > 0) throw failures[0];
  throw new Error(`Effect failed with no typed failure: ${Cause.pretty(exit.cause)}`);
};

/**
 * Like `runTest` but returns the `Exit` for tests that want to assert on
 * success/failure shape directly. Still traps unexpected defects: if the
 * Exit carries a `Cause.Die`, this throws "Unexpected defect" so the test
 * fails loudly rather than silently treating the defect as a regular
 * failure.
 *
 * Use when a test explicitly wants to inspect the Exit (e.g., the JMAP
 * client tests that assert `Exit.isFailure(exit)` and read `exit.value`).
 */
export const runTestExit = async <A, E>(eff: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> => {
  const exit = await Effect.runPromiseExit(eff);
  if (Exit.isFailure(exit)) {
    const die = Cause.dieOption(exit.cause);
    if (die._tag === "Some") {
      throw new Error(`Unexpected defect: ${Cause.pretty(exit.cause)}`);
    }
  }
  return exit;
};
