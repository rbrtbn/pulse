import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for cerebro_emails / cerebro_sync_runs / cerebro_sync_cursor.
 *
 * Used by `pnpm --filter @cerebro/store generate` (regenerates migrations from
 * schema.ts) and `pnpm --filter @cerebro/store migrate:dev` (applies pending
 * migrations against the file-backed Store at STORE_PATH).
 *
 * Production migration application happens via runMigrations() called at
 * Worker startup; this config is for the dev-time generation workflow.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: "file:../../data/cerebro.db",
  },
});
