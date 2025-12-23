#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST="${HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

# frontend dev server config for Vite
export INDICATOR_UI_HOST="${INDICATOR_UI_HOST:-$HOST}"
export INDICATOR_UI_PORT="${INDICATOR_UI_PORT:-$FRONTEND_PORT}"

# Ensure Node version is compatible with Vite (>=20.19 or >=22.12).
meets_node_requirement() {
  command -v node >/dev/null 2>&1 || return 1
  node -e '
    const [maj, min] = process.versions.node.split(".").map(Number);
    const ok = (maj === 20 && min >= 19) || (maj === 22 && min >= 12) || (maj > 22);
    process.exit(ok ? 0 : 1);
  ' >/dev/null 2>&1
}

if ! meets_node_requirement; then
  for candidate in "/usr/local/opt/node@22/bin" "/opt/homebrew/opt/node@22/bin"; do
    if [[ -x "$candidate/node" ]]; then
      export PATH="$candidate:$PATH"
      break
    fi
  done
fi

if ! meets_node_requirement; then
  current="$(command -v node >/dev/null 2>&1 && node -v || echo 'missing')"
  echo "Node version not supported: ${current}"
  echo "Vite requires Node >=20.19 or >=22.12."
  echo "If you installed node@22 via Homebrew (keg-only), add it to PATH:"
  echo "  echo 'export PATH=\"/usr/local/opt/node@22/bin:\$PATH\"' >> ~/.zshrc"
  exit 1
fi

# backend storage (defaults to repo-local, ignored by git)
export INDICATOR_DATA_DIR="${INDICATOR_DATA_DIR:-"$ROOT_DIR/.localdata"}"
export INDICATOR_HOST="${INDICATOR_HOST:-$HOST}"
export INDICATOR_PORT="${INDICATOR_PORT:-$BACKEND_PORT}"

# default: no auth in dev (set INDICATOR_TOKEN to enable)
export INDICATOR_TOKEN="${INDICATOR_TOKEN:-}"

UVICORN_BIN="${UVICORN_BIN:-"$ROOT_DIR/backend/.venv/bin/uvicorn"}"
if [[ ! -x "$UVICORN_BIN" ]]; then
  echo "uvicorn not found: $UVICORN_BIN"
  echo "Hint: create venv + install deps:"
  echo "  python3 -m venv backend/.venv && source backend/.venv/bin/activate && pip install -r backend/requirements.txt"
  exit 1
fi

PNPM_BIN="${PNPM_BIN:-pnpm}"
if ! command -v "$PNPM_BIN" >/dev/null 2>&1; then
  echo "pnpm not found."
  echo "Hint: install pnpm:"
  echo "  corepack enable && corepack prepare pnpm@10.26.1 --activate"
  exit 1
fi
if ! "$PNPM_BIN" -v >/dev/null 2>&1; then
  echo "pnpm failed to run."
  echo "Hint: make sure you're using Node >=20.19 or >=22.12."
  exit 1
fi

FRONTEND_CMD=("$PNPM_BIN" dev)
BACKEND_CMD=("$UVICORN_BIN" backend.app.main:app --reload --host "$HOST" --port "$BACKEND_PORT")

backend_pid=""
frontend_pid=""

list_children() {
  local pid="$1"
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -P "$pid" 2>/dev/null || true
    return
  fi
  ps -o pid= -ppid "$pid" 2>/dev/null | awk '{print $1}' || true
}

kill_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  local child
  for child in $(list_children "$pid"); do
    kill_tree "$child"
  done

  kill -TERM "$pid" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  kill -KILL "$pid" >/dev/null 2>&1 || true
}

cleanup() {
  set +e
  kill_tree "${frontend_pid}"
  kill_tree "${backend_pid}"
}

on_signal() {
  trap - EXIT INT TERM
  cleanup
  exit 0
}

trap cleanup EXIT
trap on_signal INT TERM

echo "[backend] ${BACKEND_CMD[*]}"
(cd "$ROOT_DIR" && "${BACKEND_CMD[@]}") &
backend_pid="$!"

echo "[frontend] ${FRONTEND_CMD[*]}"
(cd "$ROOT_DIR/frontend" && "${FRONTEND_CMD[@]}") &
frontend_pid="$!"

echo
echo "Dev server:"
echo "  UI:  http://${HOST}:${FRONTEND_PORT}"
echo "  API: http://${HOST}:${BACKEND_PORT}/api"
echo
echo "Press Ctrl+C to stop."

wait "${backend_pid}" "${frontend_pid}"
