#!/usr/bin/env bash
# Keeps the root checkout's `main` up to date.
#
#   SessionStart → fetch + fast-forward root main when work begins.
#   PostToolUse  → after a `gh pr merge`, fast-forward root main so it
#                  reflects the just-merged PR immediately.
#
# Fast-forward only, and only when the root checkout is on a clean
# `main`; every other case degrades to a short notice in context. A
# stale or diverged root is reported, never forced. Never fails the
# session — all error paths exit 0.
set -euo pipefail

input="$(cat)" || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

event="$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null)" || exit 0
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)" || exit 0
[ -n "$event" ] && [ -n "$cwd" ] || exit 0

# PostToolUse fires on every Bash call — only react to a `gh pr merge`.
# Anchor to a command-segment start (string start, or after ; & |) so
# the words "gh pr merge" merely quoted inside some other command (a
# commit message, an echo) don't trigger a spurious fetch.
if [ "$event" = "PostToolUse" ]; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
  [[ "$cmd" =~ (^|[&\;|])[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge ]] || exit 0
fi

emit() { # $1 = message → added to context as additionalContext
  jq -nc --arg e "$event" --arg m "$1" \
    '{hookSpecificOutput: {hookEventName: $e, additionalContext: $m}}'
}

# The root checkout is the first entry of `git worktree list`.
main_wt="$(git -C "$cwd" worktree list --porcelain 2>/dev/null \
  | awk 'NR==1{print substr($0,10)}')" || exit 0
[ -n "$main_wt" ] || exit 0

branch="$(git -C "$main_wt" symbolic-ref --quiet --short HEAD 2>/dev/null)" || branch=""
if [ "$branch" != "main" ]; then
  emit "⚠️ Root checkout ${main_wt} is on '${branch:-detached HEAD}', not main. Move that branch into its own worktree, then: git -C ${main_wt} checkout main"
  exit 0
fi

if [ -n "$(git -C "$main_wt" status --porcelain 2>/dev/null)" ]; then
  emit "ℹ️ Root main has uncommitted changes — skipped fast-forward."
  exit 0
fi

git -C "$main_wt" fetch --quiet origin main 2>/dev/null || exit 0
before="$(git -C "$main_wt" rev-parse --short HEAD 2>/dev/null)" || exit 0
if ! git -C "$main_wt" merge --ff-only --quiet origin/main 2>/dev/null; then
  emit "⚠️ Root main has diverged from origin/main — fast-forward skipped."
  exit 0
fi
after="$(git -C "$main_wt" rev-parse --short HEAD 2>/dev/null)" || exit 0

[ "$before" != "$after" ] && emit "✓ Root main fast-forwarded ${before} → ${after}."
exit 0
