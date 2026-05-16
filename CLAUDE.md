# CLAUDE.md — Pulse working conventions

You are working on **Pulse**, Rob's personal aggregator and assistant.
This file is the single source of truth that survives context compaction.
Treat it as authoritative. If something here conflicts with a stale memory
or a guess from training data, **this file wins.**

Rob is a Senior Product Engineer (~10y), based in Berlin, functional
TypeScript style, strong type-safety preference, self-hosting over managed
PaaS, careful about dependencies. Voice dictation is his main input — his
prompts may be long-winded; extract the signal.

---

## What Pulse is

A personal aggregator and assistant: the single place Rob opens to see the
state of his digital life — emails, articles, side-project status, calendar,
gym bookings, running coding agents — with a secondary conversational layer
(the Chat) for synthesis and ad-hoc questions.

**Read-mostly dashboard first. Chat second.**

## Architecture (decided — do not re-litigate)

**Materialized aggregator pattern.** Pulse owns its own SQLite database.
Per-Source **Connectors** pull data on schedules or via webhooks, normalize
it into Pulse's schema, and write to the local Database. **Apps** read the
Database directly. App-driven writes round-trip through a Source (or
Agent) — never via direct DB writes from App code.

**Three roles for AI** (only Connectors exist in Milestone 1):

1. **Connectors** — deterministic ETL. NOT agents. Plain code. No LLM calls.
2. **Reporter** — scheduled agent producing Digests (summaries, anomaly flags,
   ranked items) on a cadence. Writes structured output to the Database.
3. **Chat** — on-demand conversational agent. Tool access to the Database
   (typed queries) and to MCP servers (for actions and uncached reads).

**Agents** are external coding agents (OpenClaw sessions, Claude Code
background runs) that Pulse observes but does not own. A future Source.

---

## Glossary (canonical)

The **bold** terms are canonical. Aliases in parentheses are forbidden.

- **Source** (NOT "data source", "integration") — an external system Pulse
  pulls from: an email host, Notion, GitHub, a gym-booking service, etc.
- **Connector** (NOT "worker", "sync agent", "ETL job") — the
  deterministic-code component that pulls from one Source and writes to the
  Database. One Connector per Source.
- **Database** (NOT "store", "DB", "cache") — the SQLite file Pulse owns.
  Single source of truth for the Apps.
- **App** (NOT "interface", "frontend", "UI", "surface") — a way Rob
  interacts with Pulse. Reads the Database directly. Writes round-trip via
  Sources or Agents — never direct DB writes from App code.
  Two exist: **Web App** (`apps/web`) and **Desktop App** (`apps/desktop`).
- **Reporter** (NOT "curator", "summary agent", "background AI") — the
  scheduled agent that reads the Database and produces Digests.
- **Digest** (NOT "brief", "briefing", "summary", "report") — the Reporter's
  structured output for a time period. Stored, versioned, rendered by Apps.
- **Chat** (NOT "concierge", "assistant", "the agent") — the on-demand
  conversational agent. Each conversation is a **Session**.
- **Agent** (NOT "satellite", "outpost", "observer", "bot") — an external
  coding agent that Pulse observes as a Source. Examples: a Claude Code
  background session, an OpenClaw mission, an Aider / Cursor / Goose run,
  a custom LLM-in-the-loop cron job. Distinct from Pulse's own AI roles
  (Reporter, Chat), which have specific names. **Connectors are NOT Agents.**
- **Run** (NOT "fetch", "poll cycle", "sync run") — one execution of a
  Connector against a Source. Has a status, started-at, ended-at, error.
- **Transport** — protocol a Connector uses to reach a Source/Agent:
  **MCP Server** (default), **A2A**, or vendor APIs. Per-Connector detail.

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
- **Database engine:** **SQLite** + **Drizzle ORM**, WAL mode. Local file.
  Migrate to Postgres only if/when pgvector or concurrent writers force it.
- **Business logic:** **Effect v3** throughout — typed errors via
  `Data.TaggedError`, dependency injection via Layers, structured
  concurrency. **NOT Effect v4 (still beta).**
- **AI layer:** **Vercel AI SDK v6** (`Agent`, `ToolLoopAgent`, MCP support)
  wrapped in Effect via `Effect.tryPromise`. **NOT @effect/ai (alpha).
  NOT Mastra. NOT LangChain. NOT OpenClaw as a foundation.**
- **Data integration:** official **MCP TypeScript SDK** as a client, with
  typed Effect wrappers in `packages/mcp`.
- **Secrets:** macOS **Keychain** via `kr exec` (entry point: the
  `pnpm dev` script and `bin/sync-fastmail`), populated from 1Password by
  `kr sync`. The repo-root `.keyring` file pins the project namespace
  (`pulse`), so `kr exec -- CMD` injects every `pulse/*` secret into the
  child process without naming them. Items live in 1Password under titles
  like `pulse/ANTHROPIC_API_KEY`, tag `keychain-sync`. Never plain `.env`
  files committed; `.env.example` is the only env file in git. **Don't
  use `op run` here** — it's slow and exports secrets into the shell
  env where coding agents would see them.
- **Shell scripts:** `#!/usr/bin/env bash`, `set -euo pipefail`, `brew` not
  `apt` (macOS).

### Runtime environment

Pulse runs on Rob's home server ("loft"). When a task needs details about
that host (services running, model server endpoints, Keychain item names,
filesystem layout, what's auto-deployed via chezmoi), check the dotfiles
repo at **`~/code/dotfiles/docs/hosts/loft.md`** if available — it is the
source of truth. Pulse does **not** duplicate that material here, because
this repo is public and loft's topology lives in a private repo.

Decisions about how Pulse *uses* that environment live in `docs/adr/`.

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

## Apps (apps/)

- `apps/web` — primary dashboard. TanStack Start + shadcn/ui.
  **This is Milestone 1's App.**
- `apps/desktop` — experimental OS-like UI with floating windows. base-ui +
  react-rnd + custom shell. Inspired by PostHog's UI. May later be wrapped
  in Tauri 2 for a native macOS app. **Not Milestone 1.**

## Monorepo layout (target — create as needed, not all at once)

```
pulse/
├── .claude/                  # skills installed
├── .github/
│   └── pull_request_template.md
├── apps/
│   ├── web/                  # Milestone 1
│   └── desktop/              # later
├── packages/
│   ├── core/                 # Effect-based domain types, Schema, errors
│   ├── database/             # Drizzle schemas, migrations, typed queries
│   ├── ai/                   # Effect-wrapped AI SDK, Reporter, Chat
│   ├── mcp/                  # typed MCP client wrappers
│   ├── ui/
│   │   ├── primitives/       # base-ui re-exports + custom unstyled
│   │   ├── shadcn/           # shadcn components (for apps/web)
│   │   └── desktop/          # custom-styled wrappers (for apps/desktop)
│   └── connectors/           # one sub-package per Source
│       └── <source>/         # Milestone 1's Source
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

### Branching & worktrees

- The **root checkout** (first entry of `git worktree list`) stays on
  `main` — always. A `PreToolUse` hook (`~/.claude/guard-root-branch.sh`)
  denies `git switch` / `git checkout` of any other branch there.
- Do all work in a **worktree**, branched explicitly from latest main:

  ```
  git fetch origin
  git worktree add ../pulse-<slug> -b <branch> origin/main
  ```

  The explicit `origin/main` start-point is load-bearing — it fixes the
  base no matter what branch any checkout currently points at.
- One issue → one branch → one worktree → one draft PR.
- Branch name: `<issue-number>-<kebab-slug>`. Example: `12-add-run-table`.
- **Never push to `main` directly.** Branch protection rejects it server-side.
- The root's `main` is fast-forwarded automatically at session start and
  after `gh pr merge` (the `~/.claude/sync-root-main.sh` hook). If a hook
  reports the root is *not* on main, move the stray branch into its own
  worktree, then `git -C <root> checkout main`.
- Both hooks are **global** — installed in `~/.claude/` from the dotfiles
  repo, and armed for any repo carrying a tracked `.claude/root-pin` marker
  (this repo has one). Editing the hook logic happens in dotfiles, not here.

### Commits

- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`,
  `docs:`, `build:`, `ci:`. Optional scope: `feat(database): add Run table`.
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
- **Schema validation at every boundary** — incoming MCP responses, Connector
  inputs, route loaders. **Effect Schema is the canonical choice** in this
  repo; do not introduce Zod. Effect Schema composes natively with
  `Effect.gen` / `Effect.tryPromise` and produces typed errors
  (`MalformedSourceResponse`) that flow through the same `catchTag`
  surface as the rest of the domain.
- **Comments explain why, not what.** If the code needs a comment to explain
  what it does, the code is wrong. (Rob's global preference: prefer
  `@praha/byethrow` Result<T, E> over throw/catch where applicable — but in
  Pulse, Effect is the canonical mechanism.)

### Effect error discipline

The earlier `tryDb` bug — a helper typed `Effect<X, never, R>` that could
in fact throw — exposed a class of mistake that's invisible to `Effect.gen`
and to the type checker. Plain sync throws inside `Effect.gen` become
**defects** (`Cause.Die`), bypassing the typed error channel. To prevent it:

1. **Effect helpers must use `Effect.try` / `Effect.tryPromise` by
   construction.** Never write a wrapper that calls a plain thunk and
   `return`s its result inside `Effect.gen` — the throws escape as
   defects. If you find yourself writing `Effect<X, never, R>` for a
   helper that touches I/O (DB, network, filesystem, subprocess, parsing),
   stop: rewrite it around `Effect.try` so the error channel is honest.

2. **Tests run via `runTest` / `runTestExit` from `@pulse/core/testing`,
   not `Effect.runPromise` directly.** Those helpers trap defects as loud
   "Unexpected defect: …" failures, so any unwrapped throw in production
   code makes the relevant test fail with a clear signal instead of
   silently masquerading as a typed failure.

3. **TDD habit: every Effect ↔ non-Effect seam gets a throw-test.** When
   you write a helper that wraps a non-Effect computation (sync thunk,
   Promise, callback, third-party call), the *first* test alongside it
   injects a thrown value and asserts the typed error reaches the Effect
   channel. Don't declare `E` in a signature until you have a test that
   proves an error of that shape can actually arrive there.

4. **`Effect<X, never, R>` in non-pure code is a code smell.** Legitimate
   `never` lives on pure transformations and pre-validated values; any
   function touching I/O has some failure mode. If you keep `never`,
   leave a one-line comment explaining why no failure can escape (e.g.
   "pure: caller already validated"). Reviewers should challenge `never`
   on sight in I/O paths.

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
- No agent layer (no Reporter, no Chat). The Web App reads from the
  Database; the Connector writes to the Database. That's the entire pipeline.
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

**Current milestone:** not hard-coded here — the `current-milestone`
session-start hook (`.claude/hooks/current-milestone.sh`) derives it from
the open `PRD:` issue and injects a status line into context each session.
The hook depends on issue-title conventions: the PRD issue titled
`PRD: … Milestone <n> …` and task issues titled `M<n>. …` (e.g. `M1.3: …`) —
keep them when filing issues or the milestone line silently goes blank.

**Goal:** prove the pipeline end-to-end with one Source. Add more Sources,
the Reporter, the Chat, and the Desktop App only after this works and Rob
has reviewed.

**The slice:**

`<Source> → <Connector> → Database → Web App route.`

One Source, one Connector, one read-mostly route — the pipeline proven
end-to-end. The concrete Source is decided in the PRD: see the open PRD
issue for the current target and the milestone's issue list for the
breakdown. The slice **shape** is fixed; the Source it is proven against
may change without touching this file.

That's it. No Reporter, no Chat, no other Sources, no `apps/desktop`,
no Docker, no remote deployment.

---

## Workflow checkpoints

Each milestone moves through these steps in order. Which step is current —
and which issues are open — lives in the PRD issue and the milestone's
issue list, not here.

1. **Step 1 — Ubiquitous Language**: produce `CONTEXT.md`. Draft PR. Stop.
2. **Step 2 — PRD**: run `to-prd`, file as a GitHub issue. Stop.
3. **Step 3 — Grill the PRD**: run `grill-me` on the PRD issue. Update with
   answers. Write ADRs in `docs/adr/` only when a decision is **hard to
   reverse, surprising without context, AND a real trade-off**.
4. **Step 4 — Issues for the milestone**: run `to-issues` scoped to the
   vertical slice. Vertical-slice, AFK-where-possible, dependency-ordered.
   Likely 5–8 issues. Stop.
5. **Step 5 — Implementation**: per issue, branch + TDD + draft PR after
   first commit + ready-for-review when all gates green. Stop between
   issues.

After a milestone is complete and merged: run
`improve-codebase-architecture` before starting the next.
