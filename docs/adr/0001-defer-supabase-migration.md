# ADR 0001 — Defer Supabase migration past Milestone 1

- **Status:** Accepted
- **Date:** 2026-05-14
- **Deciders:** Rob
- **Supersedes:** —

## Context

`CLAUDE.md` decided cerebro's database is **SQLite + Drizzle ORM (WAL mode)**,
with the explicit note: "Migrate to Postgres only if/when pgvector or
concurrent writers force it." That decision still stands.

What's *new* since `CLAUDE.md`: a sibling personal-photos project has
moved its storage to **Supabase Pro** (PG 17 with `pgvector` + `pg_trgm` +
tsvector FTS + Realtime + Storage). Service-role access is wired up via
the macOS Keychain on the home server that runs both projects' workers.
Both projects share that runtime. This raises a reasonable question of
whether cerebro should join the same Supabase project.

This ADR records why the answer is **no, not in Milestone 1**, and what would
re-open the question later.

## Decision

**Cerebro stays on SQLite + Drizzle through Milestone 1.** Do not migrate to
Postgres in M1. Do not couple cerebro's storage to the photos Supabase
project yet.

## Consequences

### Positive

- **Single-writer simplicity** for Workers → Store. SQLite + WAL covers
  this for the foreseeable M1 throughput.
- **No external dependency** for Workers and the Web Interface — the Store
  is a local file. Works offline, no network round-trips, simple backups.
- **Stack alignment**: Drizzle has first-class SQLite support; Effect v3 +
  TanStack Start + the rest of the stack don't gain anything from PG yet.
- **No premature coupling** with the photos project. Each project iterates
  independently.
- **Milestone 1 stays small**: the slice is `eversports-mcp → eversports
  Worker → gym_bookings table → Web Interface route`. Postgres adds nothing
  to that slice.

### Negative

- **Cross-project queries are awkward**: "emails about photos from Lisbon"
  needs to join photos.public + cerebro.local — not possible while they're
  on different databases. Acceptable for M1 (no such queries exist).
- **Duplicate schema concepts**: if photos and cerebro both end up modeling
  e.g. annotations or embeddings, the shape will be defined twice. Mitigated
  by a future ADR about whether to extract a shared schema.

## Conditions that would re-open this decision

Revisit Postgres migration **after Milestone 1 ships**, if any of these is
true:

1. **Concurrent writers**: Curator + Concierge + multiple Workers writing
   simultaneously. SQLite + WAL handles bursts well, but sustained
   multi-writer contention is where PG starts to dominate.
2. **pgvector for Concierge RAG**: when the Concierge wants embedding search
   over the Store, SQLite options exist (`sqlite-vss`, `sqlite-vec`) but
   they're less mature than pgvector. The home server already runs a local
   embedding model for the photos pipeline; sharing the embedding column
   with photos in a joint PG would consolidate the embed infrastructure.
3. **Cross-project queries**: real user demand for joins across photos +
   mail. Materialized views or app-level joins from two SQLite files are
   awkward enough that PG would be worth the migration cost.
4. **Materialized views or streaming/CDC**: if cerebro's Interface needs
   Realtime subscriptions to push updates to the Web Interface as Workers
   write, Supabase Realtime is the path of least resistance.

If a future ADR decides to migrate, the photos Supabase project is already
provisioned with service-role access wired up. The migration would: add
`mail_*` / `cerebro_*` prefixed tables to the same Postgres, switch
Drizzle's driver to `pg` (Drizzle supports this), and update the Workers'
write path. Not free, but bounded.

## What this ADR does not decide

- **A future shared library between photos and cerebro**: deferred until
  real duplication surfaces.
- **Whether cerebro joins photos in a monorepo**: separate concern; mixed
  TS + Python tooling makes that costly without obvious payoff.

## References

- `CLAUDE.md` — Milestone 1 boundaries and stack decisions.
- For runtime host details (model servers, Keychain item names, what's
  pre-provisioned), see the private dotfiles repo's `docs/hosts/loft.md`
  if you have access. Cerebro intentionally does not duplicate that
  reference material here.
