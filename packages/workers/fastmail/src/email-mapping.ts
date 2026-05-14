import { type EmailRow, JmapEmail, MalformedSourceResponse } from "@cerebro/core";
import { Effect, Schema } from "effect";

/**
 * Validate a JMAP Email payload via the @cerebro/core JmapEmail schema, then
 * project it into the Store's EmailRow shape.
 *
 * Boundary discipline: every JMAP `list` entry passes through this function
 * before the Worker touches the Store. A malformed entry surfaces as
 * MalformedSourceResponse so the Sync Run records the failure with the
 * right tag.
 */
export const jmapToEmailRow = (
  raw: unknown,
  observedAt: Date,
): Effect.Effect<EmailRow, MalformedSourceResponse> =>
  Schema.decodeUnknown(JmapEmail)(raw).pipe(
    Effect.mapError(
      (err) =>
        new MalformedSourceResponse({
          source: "fastmail",
          detail: err.message,
        }),
    ),
    Effect.map((email) => projectToRow(email, observedAt)),
  );

const projectToRow = (email: Schema.Schema.Type<typeof JmapEmail>, observedAt: Date): EmailRow => {
  // JMAP convention: `$seen` keyword present and true means the message is
  // read. Absent keywords or absent $seen means unread.
  const isUnread = email.keywords?.["$seen"] !== true;

  const primarySender = email.from?.[0];
  return {
    id: email.id,
    threadId: email.threadId,
    isUnread,
    fromName: primarySender?.name ?? null,
    // JMAP guarantees the `email` field on sender entries; fall back to an
    // explicit sentinel only for the genuinely-malformed case so /inbox
    // doesn't render with confusing empty strings.
    fromEmail: primarySender?.email ?? "unknown@unknown",
    subject: email.subject ?? "",
    preview: email.preview,
    receivedAt: new Date(email.receivedAt),
    firstSeen: observedAt,
    lastSeen: observedAt,
    source: "fastmail",
  };
};
