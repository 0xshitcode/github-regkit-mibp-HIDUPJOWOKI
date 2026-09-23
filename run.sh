#!/usr/bin/env bash
# run.sh: one-command setup + run for github-regkit.
#   ./run.sh                 start the web console (http://127.0.0.1:8093)
#   ./run.sh --cli           register one account from the CLI
#   ./run.sh --cli --count 3 register three accounts from the CLI
#   ./run.sh --rebuild       rebuild the frontend, then start the web console
# Every step is skipped when already satisfied.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MODE="web"
REBUILD=0
CLI_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --cli) MODE="cli" ;;
    --rebuild) REBUILD=1 ;;
    *) CLI_ARGS+=("$arg") ;;
  esac
done

log() { printf '[run.sh] %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

SUDO=""
if [ "$(id -u)" -ne 0 ] && have sudo; then
  SUDO="sudo"
fi

# --- 1. python3 -------------------------------------------------------------
if ! have python3; then
  log "python3 missing, installing"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq python3 python3-venv
else
  log "python3 ok ($(python3 --version 2>&1))"
fi

# --- 2. venv module (Debian splits it out) ----------------------------------
if ! python3 -c "import venv, ensurepip" >/dev/null 2>&1; then
  log "python3-venv missing, installing"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq python3-venv
fi

# --- 3. Firefox system libraries (headful/headless Camoufox) -----------------
MISSING_LIBS=""
for lib in libgtk-3.so.0 libnss3.so libasound.so.2 libXss.so.1; do
  if ! ldconfig -p 2>/dev/null | grep -q "$lib"; then
    MISSING_LIBS="$MISSING_LIBS $lib"
  fi
done
if [ -n "$MISSING_LIBS" ]; then
  log "system libraries missing ($MISSING_LIBS), installing"
  $SUDO apt-get update -qq
  # libasound2t64 on Debian 13+, libasound2 on older releases
  if apt-cache show libasound2t64 >/dev/null 2>&1; then
    ASOUND="libasound2t64"
  else
    ASOUND="libasound2"
  fi
  $SUDO apt-get install -y -qq libgtk-3-0 libdbus-glib-1-2 libxt6 "$ASOUND" \
    libnss3 libxss1 xvfb
else
  log "system libraries ok"
fi

# --- 4. virtualenv + python deps --------------------------------------------
if [ ! -x .venv/bin/python ]; then
  log "creating .venv"
  python3 -m venv .venv
else
  log ".venv exists, reusing"
fi
if ! .venv/bin/python -c "import camoufox, fastapi, pyotp" >/dev/null 2>&1; then
  log "installing requirements.txt"
  .venv/bin/pip install -q -r requirements.txt
else
  log "python deps ok, skipping pip install"
fi

# --- 5. Camoufox browser (about 1.3 GB, once) --------------------------------
if [ -d "$HOME/.cache/camoufox/browsers" ] && [ -n "$(ls -A "$HOME/.cache/camoufox/browsers" 2>/dev/null)" ]; then
  log "camoufox browser cached, skipping fetch"
else
  log "fetching camoufox browser"
  .venv/bin/python -m camoufox fetch
fi

# --- 6. frontend (needed: dist/ is git-ignored) -------------------------------
if [ "$MODE" = "web" ]; then
  if [ "$REBUILD" = "1" ] || [ ! -f frontend/dist/index.html ]; then
    if ! have node || ! have npm; then
      log "node missing, installing"
      $SUDO apt-get update -qq
      $SUDO apt-get install -y -qq nodejs npm
    fi
    log "building frontend"
    (cd frontend && npm install --no-audit --no-fund -q && npm run build)
  else
    log "frontend/dist exists, skipping build (use --rebuild to force)"
  fi
fi

# --- 7. local files -----------------------------------------------------------
if [ ! -f config.json ]; then
  log "creating config.json from example (edit it before production use)"
  cp config.example.json config.json
else
  log "config.json exists"
fi
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    log "creating .env from example (set a strong password)"
    cp .env.example .env
  fi
fi

# --- 8. run -------------------------------------------------------------------
if [ "$MODE" = "cli" ]; then
  log "starting CLI"
  exec .venv/bin/python main.py "${CLI_ARGS[@]}"
else
  log "starting web console on http://127.0.0.1:8093 (Ctrl+C to stop)"
  exec .venv/bin/python -m web.server
fi
