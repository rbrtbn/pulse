#!/usr/bin/env node
/**
 * One-shot CLI entry point for the Fastmail Worker.
 *
 * Invoked by `bin/sync-fastmail` (which wraps this in `keyring exec
 * FASTMAIL_API_TOKEN -- ...` so the token is scoped to this child
 * process). Runs exactly one Sync Run and exits.
 *
 * Exit codes:
 * - 0  Sync Run recorded with status=succeeded
 * - 1  Sync Run recorded with status=failed (Store has a row explaining why)
 * - 2  Unexpected error before Sync Run could be recorded (rare)
 */
import { FastmailJmapLive } from "@cerebro/jmap";
import { openMigratedDb, StoreDb, STORE_PATH } from "@cerebro/store";
import { Effect, Layer } from "effect";

import { runSyncRun } from "./worker";

const FASTMAIL_TOKEN_ENV = "FASTMAIL_API_TOKEN";

const main = async (): Promise<void> => {
  const token = process.env[FASTMAIL_TOKEN_ENV];
  if (token === undefined || token === "") {
    console.error(
      `error: ${FASTMAIL_TOKEN_ENV} is not set. Run via \`bin/sync-fastmail\` (which wraps \`keyring exec\`).`,
    );
    process.exit(2);
  }

  // openMigratedDb opens the file at STORE_PATH, applies pending migrations
  // (idempotent), and returns the Db. The path resolves via import.meta.url
  // inside @cerebro/store so it lands at the repo-root `data/cerebro.db`
  // regardless of pnpm's per-package cwd.
  const storeLayer = Layer.sync(StoreDb, () => openMigratedDb());
  const jmapLayer = FastmailJmapLive({ token });

  const result = await Effect.runPromise(
    runSyncRun().pipe(Effect.provide(Layer.mergeAll(storeLayer, jmapLayer))),
  );

  if (result.status === "succeeded") {
    console.log(
      `✓ Sync Run #${result.id.toString()} succeeded at ${result.endedAt.toISOString()}` +
        (result.errorTag !== null ? ` (audit: ${result.errorTag})` : ""),
    );
    process.exit(0);
  }

  console.error(
    `✗ Sync Run #${result.id.toString()} failed: ${result.errorTag ?? "unknown"}` +
      (result.errorMessage !== null ? ` — ${result.errorMessage}` : ""),
  );
  console.error(`  Store path: ${STORE_PATH}`);
  process.exit(1);
};

// Surface unexpected throws (programmer errors) before the Sync Run could
// record itself. Operational failures are handled via the Effect error
// channel inside runSyncRun.
main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(2);
});
