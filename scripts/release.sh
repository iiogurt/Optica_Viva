#!/usr/bin/env bash
# Usage: scripts/release.sh X.Y.Z "commit subject"
# Expects CHANGELOG.md to already contain a "## [X.Y.Z] - DATE" section.
# Bumps package.json and README version, commits, tags, pushes and publishes a GitHub release.
set -euo pipefail
V="$1"; MSG="$2"
cd "$(dirname "$0")/.."
grep -q "^## \[$V\]" CHANGELOG.md || { echo "CHANGELOG.md has no [$V] section" >&2; exit 1; }
sed -i -E "s/\"version\": \"[0-9.]+\"/\"version\": \"$V\"/" package.json
sed -i -E "s/Version \*\*[0-9.]+\*\*/Version **$V**/" README.md
git add -A
git commit -q -m "$MSG" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag -a "v$V" -m "v$V"
git push -q --follow-tags
NOTES=$(mktemp)
awk -v v="$V" '$0 ~ "^## \\[" v "\\]" {f=1; next} /^## \[/ {if (f) exit} f' CHANGELOG.md > "$NOTES"
gh release create "v$V" --title "v$V" --notes-file "$NOTES"
rm -f "$NOTES"
