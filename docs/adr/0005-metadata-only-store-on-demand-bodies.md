# ADR 0005 — Metadata-only Store; bodies fetched on demand from the Source

- **Status:** Accepted
- **Date:** 2026-05-14
- **Deciders:** Rob
- **Supersedes:** —

## Context

PRD #11 stores only email metadata in `cerebro_emails` — `id`,
`thread_id`, `is_unread`, `from_name`, `from_email`, `subject`, `preview`
(JMAP's server-computed snippet ~256 chars), `received_at`, plus standard
Cerebro metadata. No HTML bodies, no plain-text bodies, no attachments,
no recipient lists.

This is a deliberate departure from the obvious instinct ("mirror as
much as possible so future features have data ready") and is load-bearing
for the longer arc of Cerebro:

- **M1's `/inbox` view** only renders metadata fields, so storage matches
  view-shape exactly.
- **The future Curator** — the agent that will produce Digests, classify
  emails into categories (newsletters, transactional, personal,
  side-project), and surface anomaly flags — **will** need richer email
  content for rule matching and AI classification.
- **The future Concierge** — the on-demand chat layer — will also want to
  ask "what did Mira say in her last email?" which needs body content.

The naive read of "Curator + Concierge need bodies eventually" is "store
bodies now so they're there when needed." This ADR commits to the
opposite: store nothing the M1 view doesn't need; fetch on demand when
later features need more.

## Decision

**The Store mirrors only the metadata fields `/inbox` renders. Bodies,
attachments, and recipient lists are fetched on demand from the Source
when future features need them.**

The fetch-on-demand path uses the same `packages/jmap` client the Worker
uses (per ADR 0003's "one place owns Source semantics" rule). When the
Curator needs the body of `cerebro_emails.id = X`, it calls
`packages/workers/fastmail.fetchBody(id)` — a Worker method, not a
direct JMAP call from the Curator process. The credentials reach
follows: `keyring exec FASTMAIL_API_TOKEN -- <worker-command>` — same as
the Sync Run path.

Critically: **this ADR pins the policy, not the future method's exact
shape.** `fetchBody` doesn't exist in M1 because the Curator doesn't
exist in M1.

## Consequences

### Positive

- **Privacy footprint is minimal.** Email metadata is sensitive; email
  bodies and attachments are *much* more so. Keeping bodies out of the
  Store reduces the local-disk-leak blast radius. If `data/cerebro.db`
  is ever copied accidentally, what leaks is "subjects + senders +
  preview snippets" not "every email Rob has received in the last 30 days
  in full."
- **Storage stays small.** Email bodies are typically 1–50 KB each;
  metadata is ~bytes per row. Over months, with active inboxes, the
  difference is hundreds of MB vs hundreds of KB.
- **Schema stays simple.** No body-parts modeling, no attachment-blob
  references, no recipient-list normalisation. Drizzle schema fits on
  one screen.
- **PG-portability stays cheap.** Per ADR 0001's re-open conditions, a
  Postgres migration is in the future. The fewer columns and the simpler
  the types, the lower-friction the migration.
- **Caching invalidation is the Source's problem, not ours.** When a
  draft is edited, an attachment is re-uploaded, or a recipient is added
  to a thread, Fastmail knows. Cerebro doesn't need to track or
  invalidate cached body content.
- **Cerebro doesn't become a backup of Fastmail.** It's an aggregator
  over Fastmail. The Source remains authoritative.

### Negative

- **Body access requires network round-trips** when the Curator or
  Concierge wants them. JMAP's `Email/get` for one email is fast (~50ms)
  but adds latency the "stored locally" path would skip.
- **Offline operation is limited.** With no bodies in the Store, an
  offline laptop can't run categorization or "what did X say" queries
  against history. M1 doesn't need this; future milestones may.
- **Multiple round-trips for batch operations.** Categorizing 100
  newsletters would need 100 `Email/get` calls (or a batched JMAP method
  call). The Worker's batching layer needs to be efficient.
- **The Source must stay reachable.** Fastmail downtime affects body
  access. Metadata reads from the Store still work; body-dependent
  features don't.

## Conditions that would re-open this decision

The "metadata-only" rule is forward-compatible — adding body storage
later is a nullable-column addition, not a rewrite. Reopen when:

1. **The Curator's categorization quality demands body content
   *and* the network round-trip cost or batch latency becomes a real
   bottleneck.** Measure first — Fastmail JMAP is fast; this may never
   bite.
2. **Offline use becomes a Milestone goal.** If Cerebro needs to function
   without network access to the Source, bodies (and attachments) need to
   live locally.
3. **Privacy posture changes** — e.g., end-to-end-encrypted-at-rest
   storage is added, removing the "leak risk" half of the current
   trade-off. Body storage becomes safer; cost calculation shifts.
4. **Bulk export / search across history** becomes a feature. Full-text
   search over bodies is much faster against a local store than against
   `Email/query` filters.

If reopened, the migration is: add `body_text` (nullable) and/or
`body_html` (nullable) columns to `cerebro_emails`; backfill via a one-off
Sync-Run-shaped script. Categorization writes into the future
`cerebro_email_categories` table either way; the categories themselves
don't depend on bodies-being-stored.

## What this ADR does not decide

- **Categorization mechanism** (rules vs AI vs hybrid). Curator
  territory; out of M1 scope.
- **The shape of the future `cerebro_email_categories` table.** Sketched
  in PRD #11's "Longer arc" note; pinned when the Curator is real.
- **Concierge's body-access pattern** — direct via `packages/jmap` or
  via a Worker method like `fetchBody(id)`. ADR 0003's "one place owns
  Source semantics" implies the Worker; the exact method shape waits
  for the Concierge.
- **Caching of fetched bodies.** A short-lived in-memory cache in the
  Curator process to avoid re-fetching the same email twice in one
  Digest run might be reasonable; it's an implementation detail, not a
  schema decision.

## References

- [PRD #11 — Milestone 1, Fastmail vertical slice](https://github.com/rbrtbn/cerebro/issues/11) —
  storage scope pinned; "Longer arc — Cerebro as smart inbox" note
  references this ADR.
- [ADR 0003 — Interface-driven writes round-trip through a Worker](./0003-interface-writes-via-worker.md) —
  the "one place owns Source semantics" rule that shapes how the future
  body-fetch method will be exposed.
- [`CONTEXT.md`](../../CONTEXT.md) — **Curator** and **Concierge**
  definitions.
