import { MarkReadError } from "@pulse/core";
import {
  getThreadIdForEmail,
  getUnreadEmailIdsByThread,
  PulseDb,
  setEmailUnread,
} from "@pulse/database";
import { FastmailJmap } from "@pulse/jmap";
import { Effect } from "effect";

/**
 * The App→Connector→Source write round-trip of ADR 0003: mark every
 * unread message in a clicked row's thread read.
 *
 * Resolves the thread from `emailId`, computes its unread message set,
 * flips `$seen` upstream via JMAP `Email/set`, and only then mirrors the
 * change into the Database — so any JMAP failure leaves the Database
 * untouched and the row stays unread. Every failure mode (JMAP
 * transport/auth/malformed, a per-id `notUpdated`, a Database error)
 * collapses to `MarkReadError` carrying the originating `emailId`, which
 * the /inbox row matches back to itself to render a retryable inline
 * error.
 *
 * No-ops without a JMAP round-trip when the email is untracked or its
 * thread is already fully read.
 */
export const markRead = (
  emailId: string,
): Effect.Effect<void, MarkReadError, FastmailJmap | PulseDb> =>
  Effect.gen(function* () {
    const jmap = yield* FastmailJmap;

    const threadId = yield* getThreadIdForEmail(emailId);
    if (threadId === null) return;

    const ids = yield* getUnreadEmailIdsByThread(threadId);
    if (ids.length === 0) return;

    const update: Record<string, Record<string, unknown>> = {};
    for (const id of ids) {
      update[id] = { "keywords/$seen": true };
    }

    const { notUpdated } = yield* jmap.emailSet(update);
    if (notUpdated.length > 0) {
      return yield* new MarkReadError({
        emailId,
        detail: `Fastmail refused to mark ${notUpdated.length.toString()} message(s) read`,
      });
    }

    yield* setEmailUnread(ids, false);
  }).pipe(
    // Collapse every underlying failure into MarkReadError — the /inbox
    // row only ever handles one error shape. MarkReadError from the
    // `notUpdated` branch above is already that shape, so it isn't listed.
    Effect.catchTags({
      AuthError: (e) => new MarkReadError({ emailId, detail: e.detail }),
      TransportError: (e) => new MarkReadError({ emailId, detail: e.detail }),
      MalformedSourceResponse: (e) => new MarkReadError({ emailId, detail: e.detail }),
      DatabaseError: (e) => new MarkReadError({ emailId, detail: e.detail }),
    }),
  );
