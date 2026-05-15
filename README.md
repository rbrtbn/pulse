# Pulse

Personal aggregator and assistant. The single place to see the state of my
digital life — emails, articles, side-project status, calendar, gym bookings,
running coding agents — with a **Chat** layer for synthesis and ad-hoc
questions.

Read-mostly dashboard first. Chat second.

## Architecture (at a glance)

**Materialized aggregator.** Pulse owns its own SQLite database. Per-Source
**Connectors** (deterministic ETL, no LLMs) pull data on schedules or via
webhooks and write to the local **Database**. **Apps** (the **Web App** in
`apps/web`, later the **Desktop App** in `apps/desktop`) only ever read
from the Database.

Two AI roles, both deferred past Milestone 1:

- **Reporter** — scheduled agent producing **Digests** from the Database.
- **Chat** — on-demand conversational agent with tool access to the Database
  and MCP servers.

**Agents** (external coding agents like OpenClaw sessions) are a future
Source — Pulse observes, doesn't own.

See [`CONTEXT.md`](./CONTEXT.md) for the canonical glossary and
[`CLAUDE.md`](./CLAUDE.md) for working conventions.

## Status

Pre-Milestone 1. Repo skeleton only. The first vertical slice is the
eversports gym-booking pipeline:

`eversports-mcp Source → eversports Connector → Database → Web App route`

## Setup

_To be filled in as the project develops._

```bash
# pnpm i
# kr sync          # populate Keychain from 1Password (pulse/* items)
# pnpm dev         # web dev server, pulse/* secrets injected per-process
```
