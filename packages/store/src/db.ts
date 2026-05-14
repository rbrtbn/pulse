import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StoreError } from "@cerebro/core";
import Database from "better-sqlite3";
import { Context, Effect, Layer } from "effect";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

/**
 * Default path to the Cerebro Store file. The Worker, the Web Interface
 * dev server, and any future task all import from here so the file path
 * has exactly one source of truth.
 *
 * Anchored to this file's location so it resolves to `<repo>/data/cerebro.db`
 * regardless of which workspace package the caller was launched from — pnpm
 * cd's into the filtered package before running its script, so
 * `process.cwd()` would otherwise point at e.g. `packages/workers/fastmail`.
 *
 * Override via the constructor argument to `openDb` (used by tests passing
 * `:memory:` and by anyone running multiple instances side-by-side).
 */
export const STORE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../data/cerebro.db",
);

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Effect Context tag identifying the Drizzle Db. Queries depend on this
 * tag rather than importing a global, so tests can substitute an in-memory
 * instance via a Layer.
 */
export class StoreDb extends Context.Tag("@cerebro/store/Db")<StoreDb, Db>() {}

/**
 * Open a Drizzle-wrapped better-sqlite3 connection.
 *
 * Sets WAL mode so the Worker can write while the Web Interface reads
 * without blocking, and `synchronous=NORMAL` (safe-under-WAL default).
 *
 * For file-backed paths, the parent directory is created if missing — the
 * CLI's first run on a fresh laptop shouldn't require manual `mkdir`.
 */
export const openDb = (path: string = STORE_PATH): Db => {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
};

/**
 * Apply Drizzle migrations against a Db. Used both by the production CLI
 * (on first launch) and by tests (per-test in-memory DBs).
 */
export const runMigrations = (db: Db, migrationsFolder: string): void => {
  migrate(db, { migrationsFolder });
};

/**
 * Absolute path to this package's migrations folder. Consumers (CLI, Web
 * Interface) use this so they don't have to know the package layout.
 */
export const MIGRATIONS_PATH = new URL("../migrations", import.meta.url).pathname;

/**
 * One-call helper: open the Store, apply pending migrations, return the
 * ready-to-use Db. Both the CLI's startup and the Web Interface's
 * lazy-initialised singleton call this.
 */
export const openMigratedDb = (path: string = STORE_PATH): Db => {
  const db = openDb(path);
  runMigrations(db, MIGRATIONS_PATH);
  return db;
};

/** Effect Layer providing a file-backed Db at STORE_PATH. */
export const StoreDbLive = Layer.sync(StoreDb, () => openDb());

/**
 * Effect Layer for tests — opens an in-memory Db and applies migrations
 * before yielding it. Each test calling `.pipe(Effect.provide(StoreDbTest(...)))`
 * gets a fresh isolated database.
 */
export const StoreDbTest = (migrationsFolder: string): Layer.Layer<StoreDb> =>
  Layer.sync(StoreDb, () => {
    const db = openDb(":memory:");
    runMigrations(db, migrationsFolder);
    return db;
  });

/**
 * Convenience runner used inside the Effect-returning query functions.
 * Wraps a synchronous Drizzle call so any throw (constraint violation, locked
 * DB, disk full, malformed SQL, …) maps to `StoreError` via `Effect.try`
 * rather than escaping as an Effect defect — defects are uncatchable via
 * `catchTag`, which is why the previous `never` error channel was wrong.
 *
 * `op` names the query and surfaces in the resulting `StoreError.op` so logs
 * can attribute a failure without a stack trace.
 */
export const tryDb = <A>(op: string, thunk: (db: Db) => A): Effect.Effect<A, StoreError, StoreDb> =>
  Effect.gen(function* () {
    const db = yield* StoreDb;
    return yield* Effect.try({
      try: () => thunk(db),
      catch: (cause) =>
        new StoreError({
          op,
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  });
