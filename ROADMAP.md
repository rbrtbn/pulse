# Pulse roadmap

A bird's-eye index of where Pulse is and what's queued. Milestone *detail*
lives in [`CLAUDE.md`](./CLAUDE.md) and the linked GitHub issues — this file
is the index, not a second source of truth.

## Milestone 1 — Fastmail vertical slice

PRD: [#11](https://github.com/rbrtbn/pulse/issues/11). Prove the pipeline
end-to-end with one Source.

- [x] M1.1 — read-only `/inbox` via Bootstrap Sync Run (#13)
- [x] M1.2 — Incremental + Catchup Run kinds (#14)
- [ ] M1.3 — Sync-now button + freshness UX + two-state empty UI (#15) — *in review*
- [ ] M1.4 — Mark-read from `/inbox` (#16)

## Post-M1

Sketch only — not committed scope. See `CLAUDE.md` "Architecture".

- Reporter — scheduled Digest agent
- Chat — on-demand conversational agent
- More Sources beyond Fastmail
- Desktop App (`apps/desktop`)

## Security follow-ups

Tracked so they aren't lost; not scheduled into a milestone yet.

- **Prompt-injection defense.** Pulse ingests email — attacker-controlled
  content — and the future Chat role will process it. A deliberate defense
  is needed before Chat ships: untrusted-content handling, constrained tool
  use, and a network-egress allowlist so a leaked secret cannot easily be
  exfiltrated. Its own workstream; gates the Chat role.
- **Agent secret-access hardening.** Once `kr` (the Keychain/1Password
  bridge) is adopted repo-wide: add Claude Code `deny` rules that block
  secret reads outside the `kr` flow, and a global CLAUDE.md rule that
  secret access must always go through `kr`. Follow-up to the `kr` work;
  do not land until `kr` is in place everywhere.
