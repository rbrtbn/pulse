#!/usr/bin/env bash
# SessionStart hook — inject the current milestone into context.
#
# CLAUDE.md is the compaction-surviving conventions file; it must not
# hard-code which milestone is active. This hook derives that from the
# single open `PRD:` issue and its matching `M<n>.` task issues, so the
# milestone line never goes stale. Every failure path exits 0: a
# SessionStart hook must never disrupt the session (offline, gh not
# installed, not authenticated, no PRD issue — all degrade to silence).
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

command -v gh >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

issues="$(gh issue list --state open --json number,title --limit 200 2>/dev/null)" || exit 0
[ -n "$issues" ] || exit 0

prd="$(printf '%s' "$issues" \
  | jq -c '[.[] | select(.title | startswith("PRD:"))] | first // empty' 2>/dev/null)" || exit 0
[ -n "$prd" ] || exit 0

prd_num="$(printf '%s' "$prd" | jq -r '.number' 2>/dev/null)" || exit 0
prd_title="$(printf '%s' "$prd" | jq -r '.title' 2>/dev/null)" || exit 0

# "PRD: Milestone 1 — ..." → strip the prefix, pull the milestone number.
title="${prd_title#PRD:}"
title="${title# }"
mnum=""
[[ "$prd_title" =~ Milestone\ ([0-9]+) ]] && mnum="${BASH_REMATCH[1]}"

# Task issues for the milestone: open issues titled "M<n>.…".
tasks=""
if [ -n "$mnum" ]; then
  tasks="$(printf '%s' "$issues" | jq -r --arg p "M${mnum}." '
    [.[] | select(.title | startswith($p))]
    | sort_by(.number) | map("#\(.number)") | join(", ")' 2>/dev/null)" || tasks=""
fi

ctx="Current milestone: PRD #${prd_num} \"${title}\"."
[ -n "$tasks" ] && ctx="${ctx} Open task issues: ${tasks}."

jq -nc --arg ctx "$ctx" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
