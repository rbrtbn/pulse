import { newTraceId } from "@pulse/core";
import { Cause, Effect, Exit } from "effect";

/**
 * Boundary helper for loaders and server functions. Runs an Effect and:
 *
 * - On success, returns the value as a plain Promise<A> so loaders stay
 *   Effect-free.
 * - On failure (typed `Effect.fail` *or* uncaught defect via `Cause.Die`),
 *   logs the full cause to the server console keyed by a short trace ID,
 *   then throws a generic `Error(\`${label} unavailable (trace=...)\`)` so
 *   nothing schema-, path-, or token-shaped reaches the HTML.
 *
 * The trace ID surfaces in the user-facing message so Rob can grep the
 * server log to find the corresponding entry.
 */
export const redactToLoader = async <A, E>(
  label: string,
  effect: Effect.Effect<A, E, never>,
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const traceId = newTraceId();
  console.error(`[trace=${traceId}] ${label} failed: ${formatCause(exit.cause)}`);
  throw new Error(`${label} unavailable (trace=${traceId})`);
};

/**
 * Stringify a Cause so the typed failure fields (`DatabaseError.op`, `.detail`,
 * …) actually land in the log. `Cause.pretty` alone only renders the tag
 * and stack — the field values it carries get dropped, which defeats the
 * point of logging.
 */
const formatCause = (cause: Cause.Cause<unknown>): string => {
  const failures = Array.from(Cause.failures(cause)).map((f) => `failure=${JSON.stringify(f)}`);
  const defects = Array.from(Cause.defects(cause)).map(
    (d) => `defect=${d instanceof Error ? `${d.name}: ${d.message}` : String(d)}`,
  );
  const parts = [...failures, ...defects];
  const pretty = Cause.pretty(cause);
  return parts.length === 0 ? pretty : `${parts.join(" ; ")}\n${pretty}`;
};
