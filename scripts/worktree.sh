#!/usr/bin/env bash
# One git worktree per branch, so the main checkout always stays on an up-to-date main.
# Worktrees live next to the repository in ../<repo>.worktrees/<type>-<name>.
#
#   scripts/worktree.sh new <type>/<name>   fetch origin, create the branch from origin/main
#                                           (no upstream until it is pushed) in its own worktree
#   scripts/worktree.sh finish <type>/<name> after the PR is merged: remove the worktree, delete
#                                           the local (and any leftover remote) branch, prune,
#                                           fast-forward main
#   scripts/worktree.sh list                 worktrees and their branches
#
# Branch types follow the Conventional Commits types used in this repository.
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --path-format=absolute --git-common-dir)/.."
ROOT="$(cd "$ROOT" && pwd)"
BASE="$(cd "$ROOT/.." && pwd)/$(basename "$ROOT").worktrees"
CMD="${1:-}"; BR="${2:-}"
need_branch() { [[ "$BR" =~ ^(feat|fix|docs|ci|chore|refactor|test|perf)/[a-z0-9][a-z0-9._-]*$ ]] || { echo "branch must be <type>/<kebab-name>, type ∈ feat fix docs ci chore refactor test perf" >&2; exit 1; }; }
dir_of() { echo "$BASE/${BR//\//-}"; }

case "$CMD" in
new)
  need_branch
  git -C "$ROOT" fetch -q --prune origin
  git -C "$ROOT" show-ref --quiet "refs/heads/$BR" && { echo "branch $BR already exists" >&2; exit 1; }
  mkdir -p "$BASE"
  git -C "$ROOT" worktree add -q --no-track -b "$BR" "$(dir_of)" origin/main
  echo "$(dir_of)"
  ;;
finish)
  need_branch
  STATE="$(gh pr view "$BR" --repo "$(git -C "$ROOT" remote get-url origin)" --json state -q .state 2>/dev/null || echo NONE)"
  [ "$STATE" = MERGED ] || [ "${3:-}" = --force ] || { echo "PR for $BR is $STATE, not MERGED (use --force to discard)" >&2; exit 1; }
  D="$(dir_of)"
  if [ -d "$D" ]; then
    [ -z "$(git -C "$D" status --porcelain)" ] || [ "${3:-}" = --force ] || { echo "uncommitted changes in $D" >&2; exit 1; }
    git -C "$ROOT" worktree remove ${3:+--force} "$D"
  fi
  git -C "$ROOT" branch -D "$BR" 2>/dev/null || true
  # the repository deletes merged head branches automatically; remove one that survived
  # (e.g. when gh skipped it because the branch was checked out in this worktree)
  if [ "$STATE" = MERGED ] && git -C "$ROOT" ls-remote --exit-code --heads origin "$BR" >/dev/null 2>&1; then git -C "$ROOT" push -q origin --delete "$BR"; fi
  git -C "$ROOT" fetch -q --prune origin
  git -C "$ROOT" worktree prune
  if [ "$(git -C "$ROOT" branch --show-current)" = main ] && [ -z "$(git -C "$ROOT" status --porcelain)" ]; then git -C "$ROOT" merge -q --ff-only origin/main; fi
  echo "finished $BR; main at $(git -C "$ROOT" rev-parse --short HEAD)"
  ;;
list) git -C "$ROOT" worktree list ;;
*) echo "usage: $0 new|finish <type>/<name> | list" >&2; exit 1 ;;
esac
