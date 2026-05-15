# Ubiquitous Language

The canonical vocabulary for Pulse. **Bold** terms are the names to use in
code, commits, PRs, issues, and conversation. The "Aliases to avoid" column
lists wording that would muddle the model.

If you find yourself reaching for an aliased word, that's the signal to use
the bold one — or to surface a missing term and add it here.

This document is the more recent source than `CLAUDE.md`'s glossary section.
When the two diverge, update CLAUDE.md to match this file.

## The system

| Term         | Definition                                                                            | Aliases to avoid     |
| ------------ | ------------------------------------------------------------------------------------- | -------------------- |
| **Pulse**    | The personal aggregator and assistant. The whole system.                              | "the app", "the dashboard", "Cerebro" |
| **Milestone**| A defined vertical slice of Pulse's roadmap, gated by Rob's review.                   | "phase", "release", "sprint" |

## Data flow primitives

These are the moving parts of the materialized aggregator.

| Term            | Definition                                                                            | Aliases to avoid                  |
| --------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| **Source**      | An external system Pulse pulls from (Gmail, Notion, GitHub, eversports-mcp, …).       | "data source", "integration", "provider" |
| **Connector**   | The deterministic-code component that pulls from one Source and writes to the Database. One Connector per Source. No LLM calls. | "worker", "sync agent", "ETL job", "ingester" |
| **Run**         | One execution of a Connector against a Source. Has a status, started-at, ended-at, error.| "fetch", "poll cycle", "job", "sync run" |
| **Database**    | The SQLite file Pulse owns. Single source of truth for the Apps.                      | "store", "DB", "cache", "warehouse" |

## AI roles

Pulse carefully distinguishes three AI roles. They are NOT
interchangeable — each has a different lifecycle, trigger, and access pattern.
The bare word "agent" is **forbidden**; always name which one.

| Term       | Definition                                                                                          | Aliases to avoid                          |
| ---------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Reporter**| The scheduled agent that reads the Database and produces Digests on a cadence. Writes back to the Database. | "curator", "summary agent", "background AI" |
| **Digest** | The Reporter's structured output for a time period. Stored, versioned, rendered by Apps.           | "brief", "briefing", "summary", "report"  |
| **Chat**   | The on-demand conversational agent. Has tool access to the Database (typed queries) and to MCP servers (for actions and uncached reads). | "concierge", "assistant", "the agent", "AI" |
| **Session**| One conversation with Chat. Has a start, an end, and a transcript.                                 | "chat session", "thread", "conversation", "concierge session" |

## External agents Pulse observes (not owns)

| Term         | Definition                                                                              | Aliases to avoid                  |
| ------------ | --------------------------------------------------------------------------------------- | --------------------------------- |
| **Observer** | An external coding agent (OpenClaw session, Claude Code background run, …) that Pulse observes as a Source. Distinguishes external agents from Pulse's own (Reporter, Chat). | "satellite", "outpost", "external agent", "remote agent" |

## Apps

| Term            | Definition                                                                                                                          | Aliases to avoid                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **App**         | A way Rob interacts with Pulse. Reads the Database directly. Writes happen via Sources or Observers — never via direct DB writes from an App. | "interface", "frontend", "UI", "client", "surface" |
| **Web App**     | The primary dashboard. `apps/web`. TanStack Start + shadcn/ui. Milestone 1.                                                         | "the web interface", "the dashboard" |
| **Desktop App** | Experimental OS-like UI with floating windows. `apps/desktop`. base-ui + react-rnd. Post-Milestone 1.                               | "the desktop interface", "the native app" |

## Transport

A *transport* is a protocol a Connector (or the Chat) uses to reach a
Source or Observer. Transports are pluggable per Source — they are not
domain primitives, just the wiring underneath.

| Term            | Definition                                                                       | Aliases to avoid                  |
| --------------- | -------------------------------------------------------------------------------- | --------------------------------- |
| **MCP Server**  | A Model Context Protocol server. The default transport for Sources we wire ourselves. Not synonymous with Source — a Source is the underlying system; MCP is one way to reach it. | "tool server" (when ambiguous)    |

Connectors may also use **A2A** (Agent2Agent protocol) or vendor APIs (REST,
GraphQL, file-system tailing) when the Source or Observer exposes one of
those instead. Transport choice is a per-Connector implementation detail, not
an architectural commitment.

## Milestone 1 instances

Concrete realizations of the above terms, used in the first vertical slice.

| Term                         | Definition                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------- |
| **eversports** (Source)      | The eversports gym-booking platform. Pulse's first Source.                       |
| **eversports-mcp**           | The MCP Server fronting eversports. Currently stale; Rob will revive it before integration. |
| **eversports Connector**     | The Connector that pulls from eversports-mcp and writes to the Database.         |
| **gym_bookings** (table)     | The Database table holding upcoming and historical bookings.                     |
| **runs** (table)             | The Database table holding one row per Run, across all Connectors.               |

## Relationships

- A **Connector** belongs to exactly one **Source**. One Connector per Source — never many-to-one or many-to-many.
- A **Run** belongs to exactly one **Connector** and represents one execution.
- The **Database** is written by **Connectors** (and the **Reporter**), and read by **Apps** and the **Chat**.
- A **Digest** is produced by the **Reporter**, persisted to the **Database**, and rendered by **Apps**.
- A **Session** reads from the **Database** and may invoke **MCP Servers** (or other transports) for live actions or uncached reads. It does not write to the Database.
- An **Observer** is observed *via a Source* — Pulse never controls it.
- An **App** never writes the Database directly. App-driven writes round-trip through a **Source** (the next **Run** picks up the change) or an **Observer**.
- A transport (**MCP Server**, **A2A**, vendor API) is wiring, not a Source. A Source may have zero, one, or many transports fronting it.

## Example dialogue

> **Rob:** "Why is yesterday's gym booking missing from the **Web App**?"
>
> **Claude:** "The **Web App** only reads from the **Database**, so the gap is upstream. The most recent **Run** for the **eversports Connector** failed two hours ago — the **eversports-mcp** server returned a malformed response. No new rows landed in `gym_bookings`."
>
> **Rob:** "Could the **Chat** have caught it earlier?"
>
> **Claude:** "Not on its own. The **Chat** only runs when you open a **Session**. The **Reporter** is the scheduled role — it would have flagged the stale **Run** in the next **Digest**. We haven't built the **Reporter** yet, though; that's post-Milestone 1."
>
> **Rob:** "And if I had a Claude Code agent fixing the eversports-mcp server in the background, would Pulse know?"
>
> **Claude:** "Only if we model that agent as an **Observer** — i.e., add a Source for it and a Connector that ingests its status. Observers are external; Pulse observes them but never controls them. The transport would depend on what the Observer exposes — A2A if it speaks that, otherwise a vendor API or a file tail."

## Flagged ambiguities

- **"agent"** — used in this codebase for three distinct things: the **Reporter** (scheduled), the **Chat** (on-demand), and **Observers** (external). The bare word "agent" is **forbidden**. Always name which one. **Connectors are NOT agents** — they are deterministic code with no LLM calls; calling them agents conflates the AI roles with ETL.
- **"Source" vs "MCP Server"** — eversports is the **Source** (the underlying system); **eversports-mcp** is the MCP Server fronting it. A Source may exist without any MCP Server (e.g., a REST API a Connector hits directly). Don't use them interchangeably.
- **"Run" vs "Connector"** — a **Connector** is a long-lived component (code that exists in the repo). A **Run** is one *execution* of that Connector (a row in `runs`). "The Connector failed" is ambiguous; prefer "the last **Run** for the eversports **Connector** failed."
- **"Digest" vs "Chat response"** — both are AI outputs, but a **Digest** is materialized to the Database and versioned, while a **Chat** response is ephemeral within a **Session**. Don't conflate them.
- **"App" vs directory name** — `apps/web` and `apps/desktop` are the *directories*; **Web App** and **Desktop App** are the *concepts*. They align — use either form naturally.
- **"App" writes** — Apps *appear* to write (the user clicks "book a class") but never touch the Database directly. The action goes out via a **Source** or **Observer**, and the next **Run** brings the result back into the Database. If you find yourself calling Drizzle from an App route handler, you've broken the contract.
