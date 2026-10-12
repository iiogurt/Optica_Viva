#!/usr/bin/env bash
# Load every page in headless Chrome/Chromium and fail on uncaught errors or modules
# that fail to load. Usage: scripts/smoke.sh   (needs python3 and chromium/google-chrome)
set -uo pipefail
cd "$(dirname "$0")/.."
BROWSER=$(command -v chromium || command -v chromium-browser || command -v google-chrome || command -v google-chrome-stable) || { echo "no Chrome/Chromium found"; exit 1; }
PORT=${PORT:-8797}
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
PAGES=$(grep -oE "\{ id: '[a-z]+'" js/app.js | sed -E "s/\{ id: '([a-z]+)'/\1/")
status=0
for id in $PAGES; do
  route=$([ "$id" = home ] && echo "" || echo "$id")
  out=$(timeout 120 "$BROWSER" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=6000 \
        --enable-logging=stderr --v=0 --dump-dom "http://127.0.0.1:$PORT/#/$route" 2>&1)
  if grep -qE "Uncaught|Failed to load module|SyntaxError|TypeError|ReferenceError" <<<"$out"; then
    echo "✗ $id"; grep -oE "CONSOLE[^\"]*\"[^\"]{0,200}|Failed to load module: [^<]{0,200}" <<<"$out" | head -3
    status=1
  else
    echo "✓ $id"
  fi
done
exit $status
