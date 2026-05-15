# ADR 0002 — `pulse_*` prefix on every Pulse table

- **Status:** Accepted
- **Date:** 2026-05-14
- **Deciders:** Rob
- **Supersedes:** —

## Context

Milestone 1 introduces the first three tables in the Pulse Database: one
domain table (`pulse_emails`) and two plumbing tables (`pulse_runs`,
`pulse_connector_cursors`). The PRD for the Fastmail vertical slice
([#11](https://github.com/rbrtbn/pulse/issues/11)) needs a naming
convention, and the choice has implications well beyond M1.

Two framings competed during the PRD grilling:

1. **"Plumbing vs domain" prefixing.** Infrastructure tables get a `pulse_*`
   (or `_`) prefix; domain tables stay bare (`emails`, future `gym_bookings`,
   etc.). The prefix signals "this is system table — don't touch."
2. **Service-namespacing prefixing.** *Every* Pulse table gets the
   `pulse_*` prefix, regardless of role. The prefix is a namespace for the
   eventual shared-Postgres future where Pulse coexists with sibling
   services (e.g. photos uses `photo_*`).

ADR 0001 already commits to a future where Pulse may share a Postgres
project with photos. In that world, framing #1's "plumbing vs domain"
prefix becomes ambiguous — `emails` and `photos.photos` would both be bare
table names colliding in the same schema. Framing #2 makes the migration a
clean namespace lift rather than a rename pass.

## Decision

**Every Pulse table carries the `pulse_*` prefix in SQL — domain and
plumbing alike.**

- Domain: `pulse_emails`, future `pulse_gym_bookings`, future
  `pulse_email_categories`, etc.
- Plumbing: `pulse_runs`, `pulse_connector_cursors`.

The prefix is a **service namespace**, not a plumbing-vs-domain signal.
It matches the sibling photos project's `photo_*` convention. When ADR
0001's re-open conditions fire and the Database migrates to shared Postgres,
the migration is a driver swap plus a namespace lift; no rename pass.

Drizzle's TS variable names stay short — the binding name is independent
of the SQL identifier:

```ts
export const emails = sqliteTable('pulse_emails', { ... })
```

Application code reads as `db.query.emails.findMany(...)`. The verbosity
lives only at the schema boundary.

## Consequences

### Positive

- **Cross-service coexistence in shared Postgres** is friction-free.
  `pulse_*` and `photo_*` cannot collide; future services pick their
  own prefix and join the pattern.
- **Schema files are self-documenting** — opening a `.sql` file or a
  Drizzle schema and seeing `pulse_*` immediately tells the reader
  which service owns the table.
- **No "is this plumbing or domain?" debate** when adding new tables.
  Every table answers the same question the same way.
- **Aligned with the sibling photos project** — `photo_*` there,
  `pulse_*` here. Cross-project muscle memory works.

### Negative

- **SQL identifiers are longer.** `pulse_emails` is more characters than
  `emails`. Marginal cost.
- **Hand-written SQL** (queries outside Drizzle, e.g. ad-hoc
  `sqlite3 data/pulse.db` inspection) is slightly more typing.
- **Drizzle TS variable names** can drift from SQL table names if the
  pattern isn't enforced — `export const emails = sqliteTable('pulse_emails')`
  needs a convention to stay honest. Easy to lint or review-check.

## Conditions that would re-open this decision

The naming convention is repo-wide and applied at every new table.
Reasons to revisit:

1. **Postgres `SCHEMA` namespacing becomes the chosen mechanism instead.**
   If the shared-Postgres migration uses `CREATE SCHEMA pulse;` and tables
   live at `pulse.emails`, the table-name prefix becomes redundant.
   Decide at migration time.
2. **A second naming-convention conflict** (e.g. a sibling service picks a
   prefix that collides with one of Pulse's column names).

## What this ADR does not decide

- **Column-name prefixing.** Columns stay bare (`id`, `thread_id`,
  `received_at`) — they're scoped to their table already.
- **TS module / variable naming.** The Drizzle binding name (`emails`) is
  free to be short; only the SQL table name is namespaced.
- **The Postgres-schema vs table-prefix question.** Decided when migration
  actually happens, per the re-open condition above.

## References

- [PRD #11 — Milestone 1, Fastmail vertical slice](https://github.com/rbrtbn/pulse/issues/11) —
  Contracts and conventions section pins this convention.
- [ADR 0001 — Defer Supabase migration past Milestone 1](./0001-defer-supabase-migration.md) —
  the shared-Postgres future this ADR is forward-compatible with.
- Sibling photos project uses `photo_*` prefix on every table — same
  pattern, established first.
