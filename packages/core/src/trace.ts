/**
 * Short random hex ID used to correlate a server-side log entry with a
 * user-facing generic error message.
 *
 * Eight hex chars (~32 bits) is enough for grepping a server log in this
 * single-user app — collisions are not a concern at Pulse's volume.
 * `Math.random` is fine here: trace IDs are not a security boundary.
 */
export const newTraceId = (): string => Math.random().toString(16).slice(2, 10).padStart(8, "0");
