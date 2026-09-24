#!/usr/bin/env bash
# Railway start: ensure runtime files, fetch browser if missing, run server.
set -euo pipefail
cd "$(dirname "$0")"

[ -f config.json ] || cp config.example.json config.json
mkdir -p accounts

if [ -z "$(ls -A "$HOME/.cache/camoufox" 2>/dev/null)" ]; then
  echo "[railway] fetching camoufox browser (one-time, ~1 GB)..."
  python -m camoufox fetch
fi

exec python -m web.server
