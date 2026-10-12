#!/usr/bin/env bash
# Two-phase release. Nothing is ever pushed to main directly: the version bump travels
# through a pull request like every other change, and only a tag is pushed afterwards.
#
#   scripts/release.sh prepare X.Y.Z "type(scope): summary"
#       from an up-to-date main: checks + tests, branch release/vX.Y.Z, turn
#       "## [Unreleased]" into "## [X.Y.Z] - date" (+ compare links), bump package.json
#       and the README version, commit, push the branch, open the release PR.
#
#   scripts/release.sh publish X.Y.Z
#       after the release PR is merged (CI green): verify main carries X.Y.Z,
#       tag the merge commit, push the tag, create the GitHub release from CHANGELOG.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=https://github.com/iiogurt/Optica_Viva
PHASE="${1:-}"; V="${2:-}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 prepare X.Y.Z \"message\" | publish X.Y.Z" >&2; exit 1; }

on_fresh_main() {
  [ "$(git branch --show-current)" = main ] || { echo "switch to main first" >&2; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "working tree not clean" >&2; exit 1; }
  git pull -q --ff-only
}

case "$PHASE" in
prepare)
  MSG="${3:?commit subject required}"
  on_fresh_main
  node scripts/check.mjs >/dev/null || { echo "checks failed (npm run check)" >&2; exit 1; }
  node --test test/ >/dev/null || { echo "tests failed (npm test)" >&2; exit 1; }
  grep -q "^## \[Unreleased\]" CHANGELOG.md || { echo "CHANGELOG.md has no [Unreleased] section" >&2; exit 1; }
  grep -q "^## \[$V\]" CHANGELOG.md && { echo "CHANGELOG.md already has [$V]" >&2; exit 1; }
  PREV=$(node -p "require('./package.json').version")
  git switch -q -c "release/v$V"
  # CHANGELOG: open a dated section under Unreleased and update the compare links
  node - "$V" "$PREV" "$REPO" <<'JS'
const fs = require('fs'); const [V, PREV, REPO] = process.argv.slice(2);
let s = fs.readFileSync('CHANGELOG.md', 'utf8');
const date = new Date().toISOString().slice(0, 10);
s = s.replace('## [Unreleased]\n', `## [Unreleased]\n\n## [${V}] - ${date}\n`);
s = s.replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: ${REPO}/compare/v${V}...HEAD\n[${V}]: ${REPO}/compare/v${PREV}...v${V}`);
fs.writeFileSync('CHANGELOG.md', s);
JS
  sed -i -E "s/\"version\": \"[0-9.]+\"/\"version\": \"$V\"/" package.json
  sed -i -E "s/Version \*\*[0-9.]+\*\*/Version **$V**/" README.md
  git add -A
  git commit -q -m "chore(release): v$V" -m "$MSG" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  git push -q -u origin "release/v$V"
  NOTES=$(awk -v v="$V" '$0 ~ "^## \\[" v "\\]" {f=1; next} /^## \[/ {if (f) exit} f' CHANGELOG.md)
  gh pr create --base main --title "chore(release): v$V" --body "$(printf 'Release **v%s**: %s\n\nAfter merge, run `scripts/release.sh publish %s` to tag and publish.\n\n%s\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)' "$V" "$MSG" "$V" "$NOTES")"
  ;;
publish)
  on_fresh_main
  [ "$(node -p "require('./package.json').version")" = "$V" ] || { echo "main is not at $V yet: merge the release PR first" >&2; exit 1; }
  git rev-parse -q --verify "refs/tags/v$V" >/dev/null && { echo "tag v$V exists" >&2; exit 1; }
  git tag -a "v$V" -m "v$V"
  git push -q origin "v$V"          # pushes the tag only; main is untouched
  NOTES=$(mktemp)
  awk -v v="$V" '$0 ~ "^## \\[" v "\\]" {f=1; next} /^## \[/ {if (f) exit} f' CHANGELOG.md > "$NOTES"
  gh release create "v$V" --title "v$V" --notes-file "$NOTES" --verify-tag
  rm -f "$NOTES"
  git branch -q -D "release/v$V" 2>/dev/null || true
  ;;
*) echo "unknown phase '$PHASE' (prepare | publish)" >&2; exit 1 ;;
esac
