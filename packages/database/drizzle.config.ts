import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for pulse_emails / pulse_runs / pulse_connector_cursors.
 *
 * Used by `pnpm --filter @pulse/database generate` (regenerates migrations from
 * schema.ts) and `pnpm --filter @pulse/database migrate:dev` (applies pending
 * migrations against the file-backed Database at DATABASE_PATH).
 *
 * Production migration application happens via runMigrations() called at
 * Connector startup; this config is for the dev-time generation workflow.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: "file:../../data/pulse.db",
  },
});
