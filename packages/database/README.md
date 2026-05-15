# @pulse/database

Drizzle-backed SQLite Database. Schema lives in `src/schema.ts`; migrations
are generated into `migrations/` by drizzle-kit and applied at runtime by
`openMigratedDb()`.

## Adding a migration

1. **Edit the schema.** Change `src/schema.ts` — add a table, add a
   column, add an index, drop something, whatever the diff is.
2. **Generate the migration.**

   ```sh
   pnpm --filter @pulse/database generate
   ```

   This runs `drizzle-kit generate`, diffs the new `schema.ts` against
   the journal in `migrations/meta/_journal.json`, and writes
   `migrations/00NN_<name>.sql` plus updated meta snapshots. The name
   is auto-generated; rename the file if the default is opaque.
3. **Inspect the SQL.** Open the generated file and check that the diff
   matches your intent. drizzle-kit is generally faithful but you own
   the migration — review it like you'd review any human-written DDL.
4. **Commit together.** `src/schema.ts`, the new `00NN_*.sql`, and the
   updated `migrations/meta/*` files go in the same commit. Splitting
   them creates a state where the journal references a migration that
   isn't on disk (or vice versa) and tests fail mysteriously.
5. **Done.** Apps pick the migration up automatically — `openMigratedDb()`
   runs `migrate()` against the file at `DATABASE_PATH` on every startup.
   It's idempotent; already-applied migrations are skipped.

## Don't hand-edit `migrations/meta/`

The `_journal.json` and snapshot files are drizzle-kit's bookkeeping. If
you need to undo a generated migration, delete the `.sql` file *and*
revert `_journal.json` to its prior state — or run `pnpm --filter
@pulse/database generate` again after editing `schema.ts` back to the
desired shape, and discard the no-op migration drizzle-kit emits.

## Running migrations against a file

`openMigratedDb()` handles the production and dev case. For ad-hoc
inspection against the file at `DATABASE_PATH`:

```sh
pnpm --filter @pulse/database migrate:dev
```

This invokes `drizzle-kit migrate`, which reads
`drizzle.config.ts` (which points at `file:../../data/pulse.db`).
Useful when you want to apply a migration without booting the Connector
or web app.

## Tests

Each test calls `PulseDbTest(migrationsFolder)` which opens a fresh
`:memory:` SQLite, applies every migration, and yields the Db via the
`PulseDb` tag. That way the test suite exercises the same migration
chain production runs.
