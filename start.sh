#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST="${HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

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
  echo "Hint: install pnpm (requires Node 18+):"
  echo "  npm i -g pnpm"
  exit 1
fi
if ! "$PNPM_BIN" -v >/dev/null 2>&1; then
  echo "pnpm failed to run."
  echo "Hint: pnpm (and Vite 7) requires Node 18+."
  exit 1
fi

FRONTEND_CMD=("$PNPM_BIN" dev -- --host "$HOST" --port "$FRONTEND_PORT")
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
