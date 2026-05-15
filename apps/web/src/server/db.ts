import { type Db, openMigratedDb, PulseDb } from "@pulse/database";
import { Layer } from "effect";

let cached: Db | undefined;

const getDb = (): Db => {
  cached ??= openMigratedDb();
  return cached;
};

/**
 * Effect Layer providing the long-lived Database connection to route loaders
 * and server functions. The DB is opened lazily on first use and reused
 * for the rest of the process lifetime — exactly one SQLite handle per
 * dev/server process.
 */
export const PulseDbAppLayer = Layer.sync(PulseDb, () => getDb());
