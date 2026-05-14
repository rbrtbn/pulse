# ADR 0003 — Interface-driven writes round-trip through a Worker, never directly to the Store

- **Status:** Accepted
- **Date:** 2026-05-14
- **Deciders:** Rob
- **Supersedes:** —

## Context

`CLAUDE.md` and `CONTEXT.md` establish the materialized-aggregator pattern:
Workers pull from Sources and write to the Store; Interfaces read from the
Store. Interface-driven writes "round-trip through a Source (or
Satellite) — never via direct DB writes from Interface code."

Up until Milestone 1, no Interface-driven write existed — the eversports
PRD ([#5](https://github.com/rbrtbn/cerebro/issues/5)) deferred all writes
out of scope. The Fastmail PRD ([#11](https://github.com/rbrtbn/cerebro/issues/11))
introduces **mark-read** as the second M1 issue, deliberately to exercise
this rule before more Sources arrive and the architecture grows muddy.

The choice this ADR pins is what "round-trip" means in practice for the
Cerebro codebase:

1. **Through the Worker.** Interface → TanStack Start server function →
   `packages/workers/<source>` → JMAP / Source API → Store update.
   Same Worker code path the CLI uses; same Effect Layer wiring; same
   error types.
2. **Through a thin "action" layer separate from the Worker.** Interface →
   server function → `packages/actions` → Source API → Store update.
   Adds a layer; arguments are similar to "fat models, skinny controllers"
   in MVC.
3. **Through the Store directly, with the Worker only syncing reads.**
   Interface → server function → `packages/store` write → background
   reconcile via Worker. Violates the CONTEXT.md rule but tempting for
   "obviously trivial" writes.

## Decision

**Interface-driven writes go through the same Worker that owns reads of
that Source.** Option 1.

Concretely for Fastmail M1:
- Read path: Worker `runSyncRun()` writes `cerebro_emails`; Interface
  loader reads.
- Write path: Interface `markRead` server function calls
  `packages/workers/fastmail.markRead(emailId)`. The Worker calls JMAP
  `Email/set` and, on success, updates `cerebro_emails`. The Interface
  does not depend on `drizzle-orm`.

This holds for every future Interface-driven write:
- Sending a calendar event → Calendar Worker.
- Creating a Linear issue → Linear Worker.
- Marking an article as read in the future Articles Source → Articles
  Worker.

The Worker is the single place that knows how to talk to a Source —
reads, writes, transports, schemas, error mapping. Interfaces stay
focused on rendering and intent.

## Consequences

### Positive

- **Single ownership of Source semantics.** Auth, request batching, error
  mapping, schema validation — all live in one package per Source. Bugs
  found in any of those have one home to fix in.
- **Symmetric testability.** Worker reads and Worker writes are both
  testable via the same Effect Layer pattern (stubbed JMAP transport).
  Interface tests can use a fake Worker without touching real JMAP at all.
- **No drift between CLI and UI invocations.** The CLI runs the same
  `runSyncRun()` the Sync-now button does; mark-read from a script and
  mark-read from `/inbox` go through the same `markRead()` function.
- **Refactor safety.** When a Source's API changes (e.g. JMAP version
  bump, Fastmail moves an endpoint), the blast radius is bounded to one
  Worker. Interfaces see no churn.
- **The "Interfaces never write the Store" invariant is enforceable by
  inspection** — `apps/web` does not import from `drizzle-orm` or from
  `packages/store`'s mutation surface. Trivially lint-checkable later.

### Negative

- **Trivial writes pay a small ceremony tax.** Marking one email as read
  could be a one-line Drizzle UPDATE; instead it's a server function
  calling a Worker calling JMAP calling Drizzle. The architecture wins
  the long game; individual cases feel verbose.
- **The Worker grows two public surfaces per write-capable Source** —
  `runSyncRun()` and one method per write action. Disciplined naming
  matters more.
- **First-write inertia.** Without the precedent, every new write
  invents the wiring. With it, the pattern is copy-able. M1 deliberately
  pays this cost by including mark-read as Issue 2.

## Conditions that would re-open this decision

1. **A truly local-only write** (e.g. UI preferences, dismissed banners,
   Cerebro-internal state with no upstream Source) might justify a
   direct Store write. The right shape would be a separate
   `packages/store-local` or a dedicated "user-prefs" table that never
   participates in Sync Runs. Reopen only if such writes accumulate.
2. **Optimistic-update + rollback machinery** becomes load-bearing for
   UX. M1 is pessimistic; if/when optimistic becomes necessary, the Worker
   surface might need a more nuanced shape (queue, conflict resolution).
3. **A Satellite-driven write** (an external agent mutates state via a
   path Cerebro observes rather than initiates). Probably resolved by
   treating the Satellite as a Source like any other; flag if it bends
   the rule.

## What this ADR does not decide

- **The optimistic-vs-pessimistic UX call.** PRD #11 pins pessimistic for
  M1; that's UX, not architecture.
- **The TanStack Start server-function shape.** Implementation detail.
- **How write errors surface in the UI.** PRD #11 pins "inline error on
  the row" for mark-read; other writes will decide their own surface.
- **Batching of writes.** Marking 50 threads read at once might want a
  single bulk JMAP `Email/set` call; that's a Worker-implementation
  decision, not an architectural one.

## References

- [`CLAUDE.md`](../../CLAUDE.md) — the architecture statement this ADR
  pins concretely.
- [`CONTEXT.md`](../../CONTEXT.md) — the **Interface** definition and the
  "writes round-trip via Sources" rule.
- [PRD #11 — Milestone 1, Fastmail vertical slice](https://github.com/rbrtbn/cerebro/issues/11) —
  Issue 2 is the first concrete instance of this pattern.
