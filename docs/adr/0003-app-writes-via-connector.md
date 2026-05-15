# ADR 0003 — App-driven writes round-trip through a Connector, never directly to the Database

- **Status:** Accepted
- **Date:** 2026-05-14
- **Deciders:** Rob
- **Supersedes:** —

## Context

`CLAUDE.md` and `CONTEXT.md` establish the materialized-aggregator pattern:
Connectors pull from Sources and write to the Database; Apps read from the
Database. App-driven writes "round-trip through a Source (or
Observer) — never via direct DB writes from App code."

Up until Milestone 1, no App-driven write existed — the eversports
PRD ([#5](https://github.com/rbrtbn/pulse/issues/5)) deferred all writes
out of scope. The Fastmail PRD ([#11](https://github.com/rbrtbn/pulse/issues/11))
introduces **mark-read** as the second M1 issue, deliberately to exercise
this rule before more Sources arrive and the architecture grows muddy.

The choice this ADR pins is what "round-trip" means in practice for the
Pulse codebase:

1. **Through the Connector.** App → TanStack Start server function →
   `packages/connectors/<source>` → JMAP / Source API → Database update.
   Same Connector code path the CLI uses; same Effect Layer wiring; same
   error types.
2. **Through a thin "action" layer separate from the Connector.** App →
   server function → `packages/actions` → Source API → Database update.
   Adds a layer; arguments are similar to "fat models, skinny controllers"
   in MVC.
3. **Through the Database directly, with the Connector only syncing reads.**
   App → server function → `packages/store` write → background
   reconcile via Connector. Violates the CONTEXT.md rule but tempting for
   "obviously trivial" writes.

## Decision

**App-driven writes go through the same Connector that owns reads of
that Source.** Option 1.

Concretely for Fastmail M1:
- Read path: Connector `runOnce()` writes `pulse_emails`; App
  loader reads.
- Write path: App `markRead` server function calls
  `packages/connectors/fastmail.markRead(emailId)`. The Connector calls JMAP
  `Email/set` and, on success, updates `pulse_emails`. The App
  does not depend on `drizzle-orm`.

This holds for every future App-driven write:
- Sending a calendar event → Calendar Connector.
- Creating a Linear issue → Linear Connector.
- Marking an article as read in the future Articles Source → Articles
  Connector.

The Connector is the single place that knows how to talk to a Source —
reads, writes, transports, schemas, error mapping. Apps stay
focused on rendering and intent.

## Consequences

### Positive

- **Single ownership of Source semantics.** Auth, request batching, error
  mapping, schema validation — all live in one package per Source. Bugs
  found in any of those have one home to fix in.
- **Symmetric testability.** Connector reads and Connector writes are both
  testable via the same Effect Layer pattern (stubbed JMAP transport).
  App tests can use a fake Connector without touching real JMAP at all.
- **No drift between CLI and UI invocations.** The CLI runs the same
  `runOnce()` the Sync-now button does; mark-read from a script and
  mark-read from `/inbox` go through the same `markRead()` function.
- **Refactor safety.** When a Source's API changes (e.g. JMAP version
  bump, Fastmail moves an endpoint), the blast radius is bounded to one
  Connector. Apps see no churn.
- **The "Apps never write the Database" invariant is enforceable by
  inspection** — `apps/web` does not import from `drizzle-orm` or from
  `packages/store`'s mutation surface. Trivially lint-checkable later.

### Negative

- **Trivial writes pay a small ceremony tax.** Marking one email as read
  could be a one-line Drizzle UPDATE; instead it's a server function
  calling a Connector calling JMAP calling Drizzle. The architecture wins
  the long game; individual cases feel verbose.
- **The Connector grows two public surfaces per write-capable Source** —
  `runOnce()` and one method per write action. Disciplined naming
  matters more.
- **First-write inertia.** Without the precedent, every new write
  invents the wiring. With it, the pattern is copy-able. M1 deliberately
  pays this cost by including mark-read as Issue 2.

## Conditions that would re-open this decision

1. **A truly local-only write** (e.g. UI preferences, dismissed banners,
   Pulse-internal state with no upstream Source) might justify a
   direct Database write. The right shape would be a separate
   `packages/store-local` or a dedicated "user-prefs" table that never
   participates in Runs. Reopen only if such writes accumulate.
2. **Optimistic-update + rollback machinery** becomes load-bearing for
   UX. M1 is pessimistic; if/when optimistic becomes necessary, the Connector
   surface might need a more nuanced shape (queue, conflict resolution).
3. **A Observer-driven write** (an external agent mutates state via a
   path Pulse observes rather than initiates). Probably resolved by
   treating the Observer as a Source like any other; flag if it bends
   the rule.

## What this ADR does not decide

- **The optimistic-vs-pessimistic UX call.** PRD #11 pins pessimistic for
  M1; that's UX, not architecture.
- **The TanStack Start server-function shape.** Implementation detail.
- **How write errors surface in the UI.** PRD #11 pins "inline error on
  the row" for mark-read; other writes will decide their own surface.
- **Batching of writes.** Marking 50 threads read at once might want a
  single bulk JMAP `Email/set` call; that's a Connector-implementation
  decision, not an architectural one.

## References

- [`CLAUDE.md`](../../CLAUDE.md) — the architecture statement this ADR
  pins concretely.
- [`CONTEXT.md`](../../CONTEXT.md) — the **App** definition and the
  "writes round-trip via Sources" rule.
- [PRD #11 — Milestone 1, Fastmail vertical slice](https://github.com/rbrtbn/pulse/issues/11) —
  Issue 2 is the first concrete instance of this pattern.
