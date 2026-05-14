# CLAUDE.md — Cerebro working conventions

You are working on **Cerebro**, Rob's personal aggregator and assistant.
This file is the single source of truth that survives context compaction.
Treat it as authoritative. If something here conflicts with a stale memory
or a guess from training data, **this file wins.**

Rob is a Senior Product Engineer (~10y), based in Berlin, functional
TypeScript style, strong type-safety preference, self-hosting over managed
PaaS, careful about dependencies. Voice dictation is his main input — his
prompts may be long-winded; extract the signal.

---

## What Cerebro is

A personal aggregator and assistant: the single place Rob opens to see the
state of his digital life — emails, articles, side-project status, calendar,
gym bookings, running coding agents — with a secondary conversational layer
(the Concierge) for synthesis and ad-hoc questions.

**Read-mostly dashboard first. Chat layer second.**

## Architecture (decided — do not re-litigate)

**Materialized aggregator pattern.** Cerebro owns its own SQLite database.
Per-Source **Workers** pull data on schedules or via webhooks, normalize it
into Cerebro's schema, and write to the local Store. **Interfaces** read the
Store directly. Interface-driven writes round-trip through a Source (or
Satellite) — never via direct DB writes from Interface code.

**Three roles for AI** (only Workers exist in Milestone 1):

1. **Workers** — deterministic ETL. NOT agents. Plain code. No LLM calls.
2. **Curator** — scheduled agent producing Digests (summaries, anomaly flags,
   ranked items) on a cadence. Writes structured output to the Store.
3. **Concierge** — on-demand chat. Tool access to the Store (typed queries)
   and to MCP servers (for actions and uncached reads).

**Satellites** are external coding agents (OpenClaw sessions, Claude Code
background runs) that Cerebro observes but does not own. A future Source.

---

## Glossary (canonical)

The **bold** terms are canonical. Aliases in parentheses are forbidden.

- **Source** (NOT "data source", "integration") — an external system Cerebro
  pulls from: Gmail, Notion, GitHub, eversports-mcp, etc.
- **Worker** (NOT "sync agent", "ETL job") — the deterministic-code component
  that pulls from one Source and writes to the Store. One Worker per Source.
- **Store** (NOT "DB", "database", "cache") — the SQLite database Cerebro
  owns. Single source of truth for the Interfaces.
- **Interface** (NOT "frontend", "UI", "app", "surface") — a way Rob
  interacts with Cerebro. Reads the Store directly. Writes round-trip via
  Sources or Satellites — never direct DB writes from Interface code.
  Two exist: **Web Interface** (`apps/web`) and **Desktop Interface**
  (`apps/desktop`).
- **Curator** (NOT "summary agent", "background AI") — the scheduled agent
  that reads the Store and produces Digests.
- **Digest** (NOT "brief", "briefing", "summary", "report") — the Curator's
  structured output for a time period. Stored, versioned, rendered by
  Interfaces.
- **Concierge** (NOT "chat", "assistant", "agent") — the on-demand
  conversational agent. Each conversation is a **Concierge Session**.
- **Satellite** (NOT "outpost", "external agent", "remote agent") — an
  external coding agent that Cerebro observes as a Source.
- **Sync Run** (NOT "fetch", "poll cycle") — one execution of a Worker
  against a Source. Has a status, started-at, ended-at, error.
- **Transport** — protocol a Worker uses to reach a Source/Satellite:
  **MCP Server** (default), **A2A**, or vendor APIs. Per-Worker detail.

The full ubiquitous-language doc is at [`CONTEXT.md`](./CONTEXT.md). When the
two disagree, CONTEXT.md is the more recent source — update this glossary.

---

## Stack (decided — do not re-litigate)

- **Repo:** monorepo, **pnpm** workspaces.
- **Toolchain:** **Vite+** (`vp`) — dev server, lint (Oxlint), format
  (Oxfmt), tests (Vitest), build (Rolldown), monorepo task running (Vite
  Task). One config file: `vite.config.ts`. **NOT Biome. NOT Turborepo.
  NOT ESLint. NOT Prettier.**
- **Web framework:** **TanStack Start v1** (released March 2026; Vite-native,
  end-to-end type-safe). **NOT Next.js. NOT React Router 7.**
- **Components:**
  - `apps/web` uses **shadcn/ui** (installed into `packages/ui/shadcn`,
    re-exported from there — never installed ad-hoc into `apps/web`).
  - `apps/desktop` uses **base-ui** (unstyled headless primitives) plus a
    custom shell built on **react-rnd** for floating windows.
    **NOT react-mosaic.**
  - Shared primitives live in `packages/ui/primitives`.
- **Database:** **SQLite** + **Drizzle ORM**, WAL mode. Local file. Migrate
  to Postgres only if/when pgvector or concurrent writers force it.
- **Business logic:** **Effect v3** throughout — typed errors via
  `Data.TaggedError`, dependency injection via Layers, structured
  concurrency. **NOT Effect v4 (still beta).**
- **AI layer:** **Vercel AI SDK v6** (`Agent`, `ToolLoopAgent`, MCP support)
  wrapped in Effect via `Effect.tryPromise`. **NOT @effect/ai (alpha).
  NOT Mastra. NOT LangChain. NOT OpenClaw as a foundation.**
- **Data integration:** official **MCP TypeScript SDK** as a client, with
  typed Effect wrappers in `packages/mcp`.
- **Secrets:** **1Password via `op run`**. Never plain `.env` files
  committed. `.env.example` is the only env file in git.
- **Shell scripts:** `#!/usr/bin/env bash`, `set -euo pipefail`, `brew` not
  `apt` (macOS).

### Things to verify rather than assume

Training cutoff predates several of these. Don't trust internal knowledge for:

- **Vite+** (`vp`) — read https://viteplus.dev/guide/
- **TanStack Start v1** — read https://tanstack.com/start/latest
- **Effect v3** — read https://effect.website (production-stable section)
- **Vercel AI SDK v6** — read https://ai-sdk.dev (v6 Agent/ToolLoopAgent)
- **Drizzle** — current best practices for SQLite + WAL
- **MCP TypeScript SDK** — current client API

Use Context7 MCP for library docs. Don't guess current APIs.

---

## Interfaces (apps/)

- `apps/web` — primary dashboard. TanStack Start + shadcn/ui.
  **This is Milestone 1's Interface.**
- `apps/desktop` — experimental OS-like UI with floating windows. base-ui +
  react-rnd + custom shell. Inspired by PostHog's UI. May later be wrapped
  in Tauri 2 for a native macOS app. **Not Milestone 1.**

## Monorepo layout (target — create as needed, not all at once)

```
cerebro/
├── .claude/                  # skills installed
├── .github/
│   └── pull_request_template.md
├── apps/
│   ├── web/                  # Milestone 1
│   └── desktop/              # later
├── packages/
│   ├── core/                 # Effect-based domain types, Schema, errors
│   ├── store/                # Drizzle schemas, migrations, typed queries
│   ├── ai/                   # Effect-wrapped AI SDK, Curator, Concierge
│   ├── mcp/                  # typed MCP client wrappers
│   ├── ui/
│   │   ├── primitives/       # base-ui re-exports + custom unstyled
│   │   ├── shadcn/           # shadcn components (for apps/web)
│   │   └── desktop/          # custom-styled wrappers (for apps/desktop)
│   └── workers/              # one sub-package per Source
│       └── eversports/       # Milestone 1
├── docs/
│   └── adr/                  # ADRs, lazily created
├── CLAUDE.md
├── CONTEXT.md
├── README.md
├── vite.config.ts
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

---

## Conventions (enforce from commit #1)

### Branching

- One issue → one branch → one draft PR.
- Branch name: `<issue-number>-<kebab-slug>`. Example: `7-eversports-worker`.
- **Never push to `main` directly.** Branch protection rejects it server-side.

### Commits

- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`,
  `docs:`, `build:`, `ci:`. Optional scope: `feat(store): add SyncRun table`.
- **Commit at every green test.** TDD cycle ends with a commit. Codebase is
  green at every commit. Fowler-style.
- Commits are small. Aim for <100 lines diff per commit; if a commit feels
  bigger than that, you probably skipped a refactor step.
- Subject ≤ 72 chars, imperative mood, no trailing period.

### Pull Requests

- **Open as DRAFT after the first commit on a branch.** Don't wait until
  done — Rob follows along.
- One PR per issue. Title = issue title. Body uses the PR template.
- Mark ready-for-review only when:
  - All acceptance criteria from the issue are checked
  - `vp check` passes (lint + format + typecheck)
  - `vp test` passes
  - The PR description is filled in
- Rob will review and either merge, request changes, or push back.
  **Wait before starting the next issue.**

### File-size guardrails

- Lint enforces `max-lines: 300` and `max-lines-per-function: 80` via Oxlint.
- If you find yourself wanting to disable the rule, that's the signal to
  split the file. **Always split, never disable.**

### Code style

- **Effect everywhere in business logic.** No `try`/`catch` — use
  `Effect.tryPromise` and `Data.TaggedError`. No raw Promises in domain code.
- **No `any`.** No non-null assertions (`!`). No disabling strict mode.
- **Schema validation at every boundary** — incoming MCP responses, Worker
  inputs, route loaders. Zod or Effect Schema, consistent within a package.
- **Comments explain why, not what.** If the code needs a comment to explain
  what it does, the code is wrong. (Rob's global preference: prefer
  `@praha/byethrow` Result<T, E> over throw/catch where applicable — but in
  Cerebro, Effect is the canonical mechanism.)

### When to STOP and ask

- After CONTEXT.md is created — Rob reviews before PRD.
- After the PRD is filed as an issue — Rob reviews before grilling.
- After `to-issues` produces the issue list — Rob reviews before any code.
- After each PR is opened as **draft** — proceed without waiting; Rob
  follows along.
- After each PR is marked **ready-for-review** — STOP. Rob reviews before
  the next issue.

These local stops **override** Rob's global "auto-commit through phases"
workflow rule. The stops are intentional review gates.

---

## Don'ts (Milestone 1)

- No Next.js, Mastra, LangChain, OpenClaw, CopilotKit, Postgres, Docker,
  Cloudflare Workers, Tauri, react-mosaic, Biome, Turborepo, ESLint,
  Prettier.
- No agent layer (no Curator, no Concierge). The Web Interface reads from
  the Store; the Worker writes to the Store. That's the entire pipeline.
- No `apps/desktop` work. Defer the OS-like UI to a later milestone.
- No `try`/`catch` in business logic — use Effect's typed errors.
- No `any`. No non-null assertions (`!`). No disabling strict mode.
- No introducing shadcn components ad-hoc in `apps/web` — install into
  `packages/ui/shadcn` and re-export.
- No remote deployment, no CI/CD setup yet.

---

## Skills (installed in `.claude/skills/`)

Available: `tdd`, `to-prd`, `to-issues`, `grill-me`, `ubiquitous-language`,
`domain-model`, `improve-codebase-architecture`, `request-refactor-plan`,
`triage-issue`, `design-an-interface`, `zoom-out`.

Don't invent processes when a skill covers it. Use `zoom-out` whenever stuck
or whenever you sense the thread is lost — including unprompted.

---

## Milestone 1 — vertical slice

**Goal:** prove the pipeline end-to-end with one Source. Add more Sources,
the Curator, the Concierge, and the Desktop Interface only after this works
and Rob has reviewed.

**The slice:**

`eversports-mcp Source → eversports Worker → Store (gym_bookings table) →
Web Interface route showing upcoming bookings.`

That's it. No Curator, no Concierge, no other Sources, no `apps/desktop`,
no Docker, no remote deployment.

**Note on eversports-mcp:** the MCP server exists but is currently stale.
Rob will revive it before integration. Don't try to build the MCP server
inside this repo.

---

## Workflow checkpoints

Past Step 0 (this commit), the order is:

1. **Step 1 — Ubiquitous Language**: branch `docs-ubiquitous-language`,
   produce `CONTEXT.md`. Draft PR. Stop.
2. **Step 2 — PRD**: branch `docs-prd-v1`, run `to-prd`, file as a GitHub
   issue. Stop.
3. **Step 3 — Grill the PRD**: run `grill-me` on the PRD issue. Update with
   answers. Write ADRs in `docs/adr/` only when a decision is **hard to
   reverse, surprising without context, AND a real trade-off**.
4. **Step 4 — Issues for Milestone 1**: run `to-issues` scoped to the
   eversports vertical slice. Vertical-slice, AFK-where-possible,
   dependency-ordered. Likely 5–8 issues. Stop.
5. **Step 5 — Implementation**: per issue, branch + TDD + draft PR after
   first commit + ready-for-review when all gates green. Stop between
   issues.

After Milestone 1 is complete and merged: run
`improve-codebase-architecture` before starting Milestone 2.
