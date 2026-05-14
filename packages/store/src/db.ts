import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
 * Override via the constructor argument to `openDb` (used by tests passing
 * `:memory:` and by anyone running multiple instances side-by-side).
 */
export const STORE_PATH = resolve(process.cwd(), "data/cerebro.db");

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
 * Wraps a synchronous Drizzle call so failures map to StoreError via the
 * caller's catchTag rather than throwing uncaught.
 */
export const tryDb = <A>(thunk: (db: Db) => A): Effect.Effect<A, never, StoreDb> =>
  Effect.gen(function* () {
    const db = yield* StoreDb;
    return thunk(db);
  });
