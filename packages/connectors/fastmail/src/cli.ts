#!/usr/bin/env node
/**
 * One-shot CLI entry point for the Fastmail Connector.
 *
 * Invoked by `bin/sync-fastmail` (which wraps this in `keyring exec
 * FASTMAIL_API_TOKEN -- ...` so the token is scoped to this child
 * process). Runs exactly one Run and exits.
 *
 * Exit codes:
 * - 0  Run recorded with status=succeeded
 * - 1  Run recorded with status=failed (Database has a row explaining why)
 * - 2  Unexpected error before Run could be recorded (rare)
 */
import { FastmailJmapLive } from "@pulse/jmap";
import { openMigratedDb, PulseDb, DATABASE_PATH } from "@pulse/database";
import { Effect, Layer } from "effect";

import { runOnce } from "./connector";

const FASTMAIL_TOKEN_ENV = "FASTMAIL_API_TOKEN";

const main = async (): Promise<void> => {
  const token = process.env[FASTMAIL_TOKEN_ENV];
  if (token === undefined || token === "") {
    console.error(
      `error: ${FASTMAIL_TOKEN_ENV} is not set. Run via \`bin/sync-fastmail\` (which wraps \`keyring exec\`).`,
    );
    process.exit(2);
  }

  // openMigratedDb opens the file at DATABASE_PATH, applies pending migrations
  // (idempotent), and returns the Db. The path resolves via import.meta.url
  // inside @pulse/database so it lands at the repo-root `data/pulse.db`
  // regardless of pnpm's per-package cwd.
  const storeLayer = Layer.sync(PulseDb, () => openMigratedDb());
  const jmapLayer = FastmailJmapLive({ token });

  const result = await Effect.runPromise(
    runOnce().pipe(Effect.provide(Layer.mergeAll(storeLayer, jmapLayer))),
  );

  if (result.status === "succeeded") {
    console.log(
      `✓ Run #${result.id.toString()} succeeded at ${result.endedAt.toISOString()}` +
        (result.errorTag !== null ? ` (audit: ${result.errorTag})` : ""),
    );
    process.exit(0);
  }

  console.error(
    `✗ Run #${result.id.toString()} failed: ${result.errorTag ?? "unknown"}` +
      (result.errorMessage !== null ? ` — ${result.errorMessage}` : ""),
  );
  console.error(`  Database path: ${DATABASE_PATH}`);
  process.exit(1);
};

// Surface unexpected throws (programmer errors) before the Run could
// record itself. Operational failures are handled via the Effect error
// channel inside runOnce.
main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(2);
});
