import { Effect, Layer } from "effect";

import { FastmailJmap, type FastmailJmapClient } from "./client";

/**
 * Build a test Layer for FastmailJmap that returns whatever the supplied
 * handlers produce. Connector tests inject this in place of the real client
 * so they don't hit Fastmail.
 *
 * Handlers can return either a plain value (auto-wrapped in Effect.succeed)
 * or an Effect (for testing failure paths via Effect.fail).
 */
export const FastmailJmapStub = (
  impl: Partial<FastmailJmapClient> & { readonly accountId?: string },
): Layer.Layer<FastmailJmap> => {
  const unreachable = (method: string): Effect.Effect<never, never, never> =>
    Effect.dieMessage(
      `FastmailJmapStub: no handler provided for ${method}; supply one in the test fixture`,
    );
  return Layer.succeed(FastmailJmap, {
    accountId: impl.accountId ?? "u-test-account",
    mailboxGet: impl.mailboxGet ?? ((_ids) => unreachable("mailboxGet")),
    emailQuery: impl.emailQuery ?? ((_params) => unreachable("emailQuery")),
    emailGet: impl.emailGet ?? ((_ids, _props) => unreachable("emailGet")),
    emailChanges: impl.emailChanges ?? ((_sinceState) => unreachable("emailChanges")),
  });
};
