#!/usr/bin/env bash
# PreToolUse(Bash) hook — keep the root checkout pinned to `main`.
#
# Git's *main working tree* (the root checkout) must never leave `main`.
# A worktree created without an explicit base inherits whatever HEAD the
# checkout it was spawned from is on, so a stray root branch silently
# poisons every worktree branched afterwards — and harness-created
# worktrees can't be given an explicit base.
#
# This hook denies `git switch` / `git checkout` of a non-main branch
# *when the Bash command runs in the root checkout*. Linked worktrees are
# left alone. Best-effort: it guards the common forms, not a `cd /root &&
# …` bypass. Every non-decision path exits 0 so unrelated commands and
# any internal error never block the tool.
set -euo pipefail

input="$(cat)" || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)" || exit 0
[ -n "$cmd" ] && [ -n "$cwd" ] || exit 0

# Guard only the root checkout — the first entry of `git worktree list`.
main_wt="$(git -C "$cwd" worktree list --porcelain 2>/dev/null \
  | awk 'NR==1{print substr($0,10)}')" || exit 0
top="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$main_wt" ] && [ "$top" = "$main_wt" ] || exit 0

violation=""

# `git switch` is always a branch operation. Anything but a switch to
# main/master (optionally preceded by flags) is a violation.
if [[ "$cmd" =~ git[[:space:]]+switch ]]; then
  if [[ ! "$cmd" =~ switch([[:space:]]+-[A-Za-z-]+)*[[:space:]]+(main|master)([[:space:]]|\;|\&|\||$) ]]; then
    violation="git switch"
  fi
fi

# `git checkout -b/-B` creates and switches to a branch.
if [ -z "$violation" ] && [[ "$cmd" =~ checkout[[:space:]]+-[bB]([[:space:]]|$) ]]; then
  violation="git checkout -b"
fi

# `git checkout <branch>` — a violation only when the first non-flag
# argument resolves to a local branch other than main. File-restore
# forms (`git checkout -- file`, `git checkout .`) leave it empty/flag.
if [ -z "$violation" ] && [[ "$cmd" =~ git[[:space:]]+checkout ]]; then
  arg=""
  [[ "$cmd" =~ checkout[[:space:]]+([^[:space:]]+) ]] && arg="${BASH_REMATCH[1]}"
  case "$arg" in
    "" | -* | main | master) : ;;
    *)
      if git -C "$main_wt" show-ref --verify --quiet "refs/heads/$arg" 2>/dev/null; then
        violation="git checkout $arg"
      fi
      ;;
  esac
fi

[ -n "$violation" ] || exit 0

reason="Blocked: \`${violation}\` in the root checkout (${main_wt}).
The root must stay on main. Branch in a worktree instead:
  git fetch origin && git worktree add ../pulse-<slug> -b <branch> origin/main"

jq -nc --arg r "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
exit 0
