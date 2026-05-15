# ADR 0004 — Three Run kinds: Bootstrap, Incremental, Catchup

- **Status:** Accepted
- **Date:** 2026-05-14
- **Deciders:** Rob
- **Supersedes:** —

## Context

A Run executes a Connector against its Source and reconciles the result
into the Database. The simplest model has one shape — run, fetch, write.
But change-stream protocols like JMAP (and any future Source built on
similar primitives — Microsoft Graph, Google Calendar API with sync
tokens, GitHub Events API with delivery cursors, etc.) introduce a state
token that complicates the picture:

- The **first** run on a fresh Database has no token. It must fetch a
  bounded window from scratch.
- **Subsequent** runs have a token. They fetch only what changed since.
- The token **expires** when the server's change log ages out. The server
  rejects the request and the Connector must recover without manual
  intervention.

A naive "two kinds of run" model (bootstrap-or-incremental, with
incremental falling back to a fresh bootstrap on expiry) has a subtle
bug: a fresh-window bootstrap *replaces* the Database content with whatever's
in the current window, losing rows for emails that are still in the Database
but older than the bootstrap horizon. For Pulse's 30-day window, a
45-day-offline laptop would lose 15 days of historical rows on every
cursor expiry.

The PRD's Fastmail Connector explicitly avoids that bug.

## Decision

**Three Run kinds, distinguished by trigger, not by status. The
`pulse_runs.status` enum stays binary (`succeeded` | `failed`);
the kind is implicit in which code path executed.**

### Bootstrap

- **Trigger.** `pulse_connector_cursors` has no row for this Connector.
- **Behavior.** Fetch the configured window (30 days for Fastmail) from
  scratch via `Email/query` + `Email/get`. Insert every row. Write the
  resulting state token to `pulse_connector_cursors`.
- **Records.** `status=succeeded`, `error_tag=NULL`.

### Incremental

- **Trigger.** Cursor exists; server accepts the token.
- **Behavior.** JMAP change-tracking (`Email/changes` or
  `Email/queryChanges`, mix decided at issue level) returns
  added/updated/destroyed sets. `Email/get` for added+updated; delete
  rows for destroyed. Advance the cursor.
- **Records.** `status=succeeded`, `error_tag=NULL`.

### Catchup

- **Trigger.** Incremental attempt was rejected with
  `cannotCalculateChanges` (cursor too old for the server's change log).
- **Behavior.** Fall back to **state reconciliation, not re-bootstrap.**
  Specifically:
  1. `Email/query inMailbox:INBOX receivedAt >= (now - 30d)` → set of
     current upstream IDs in the window.
  2. Diff against local IDs in the same window → `(new, missing)`.
  3. `Email/get` only for `new` IDs (bounded fetch).
  4. Delete local rows for `missing` IDs (delete-on-leave-INBOX applied
     during recovery).
  5. Advance the cursor with the new state token.
- **Records.** `status=succeeded`,
  `error_tag='recovered_via_catchup'`. The audit tag on a succeeded row
  is the recovery signal — visible to anyone querying `pulse_runs`
  for "what happened" without splitting the state machine.

The `error_tag` column is therefore nullable and meaningful on both
succeeded and failed rows:
- On `failed`: categorises the failure (`MalformedSourceResponse`,
  `TransportError`, `AuthError`, etc.).
- On `succeeded`: optionally annotates the run (`recovered_via_catchup`,
  future audit tags like `partial_window_due_to_quota`, etc.).

## Consequences

### Positive

- **No data loss on cursor expiry.** Catchup's ID-diff approach
  reconciles state without replacing it. Historical rows survive.
- **Bounded recovery cost.** Catchup's expensive operation (`Email/get`
  for bodies/metadata) runs only for genuinely-new IDs. The cheap
  operation (`Email/query` returning IDs) is bounded by the window size.
- **Self-healing without user intervention.** Cursor expiry is a
  protocol-level concern; the user shouldn't need a `--reset` flag for it.
- **Generalises to every future change-stream Source.** Microsoft Graph,
  Google Calendar, GitHub — same three-kinds pattern, same recovery
  shape, same `error_tag` audit convention.
- **Binary state machine.** Only two `status` values means tests, queries,
  and UI rendering stay simple. The third kind is reconstructable from
  `error_tag` for anyone who cares.
- **Single transaction across all kinds.** Email writes and cursor write
  share one Drizzle transaction; partial states are impossible.

### Negative

- **Catchup is non-trivial to implement** — the ID-diff + selective fetch
  + delete reconciliation is more code than a naive re-bootstrap.
  Justified by the data-loss bug a naive approach has.
- **`error_tag` overloads two roles** (failure category + success
  annotation). Disambiguated by `status`, but readers of the schema need
  the convention in mind. ADR + PRD documentation is the mitigation.
- **The three kinds are implicit in code, not in schema** — the Connector
  decides which path ran based on cursor state and JMAP response.
  Someone querying `pulse_runs` cannot distinguish Bootstrap from
  Incremental at-a-glance (both have `error_tag=NULL`). Catchup is
  visible because of its `error_tag`. The non-distinction between
  Bootstrap and Incremental in the audit log is acceptable for M1; can
  add a `kind` column later if a UI needs to distinguish them.

## Conditions that would re-open this decision

1. **A future audit/UI surface needs at-a-glance distinction between
   Bootstrap and Incremental runs.** Add a `kind` column to
   `pulse_runs` then; cheap forward-compatible schema change.
2. **A Source emerges that needs a fundamentally different recovery
   shape** (e.g. one that doesn't expose change-streams at all, or one
   where catchup is impossible and bootstrap is the only fallback).
   Define a new pattern for that Source's Connector; don't force-fit.
3. **Optimistic concurrency on writes** — if the Reporter or Chat
   eventually need to write to the same tables Connectors maintain, the
   Run state machine might need to coordinate with non-Connector
   writers. Reopen this and ADR 0003 together.

## What this ADR does not decide

- **Exact JMAP method mix** for Incremental (`Email/changes` vs
  `Email/queryChanges` vs both). Issue-level call in PRD #11.
- **Pagination handling** within a single Incremental or Catchup run
  (JMAP responses are capped). Issue-level call.
- **Bootstrap window** size — Fastmail's is 30 days per PRD #11;
  different Sources will pick different windows.
- **Catchup ID-diff scope** — currently the 30-day window. If a Source
  has a fundamentally different "what counts as in-scope" question, that
  Source's Catchup will pick its own scope.

## References

- [PRD #11 — Milestone 1, Fastmail vertical slice](https://github.com/rbrtbn/pulse/issues/11) —
  Run kinds pinned in Implementation Decisions; test scenarios
  enumerate Bootstrap, Incremental, and Catchup happy and failure paths.
- [`CONTEXT.md`](../../CONTEXT.md) — **Run** definition.
- [JMAP specification §5.3 — Object/changes](https://jmap.io/spec-core.html#changes) —
  the `cannotCalculateChanges` error this ADR designs around.
