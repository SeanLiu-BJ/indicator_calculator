#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
FRONTEND_DIR="$ROOT_DIR/frontend"
OUTPUT_DIR="$DESKTOP_DIR/dist/release"
APP_DIR="$OUTPUT_DIR/app"
ELECTRON_DIR="$OUTPUT_DIR/electron"
ENSURE_RUNTIME_SCRIPT="$ROOT_DIR/scripts/ensure-electron-runtime.sh"

copy_tree() {
  local from="$1"
  local to="$2"
  rm -rf "$to"
  mkdir -p "$to"
  rsync -a \
    --delete \
    --exclude ".venv" \
    --exclude "__pycache__" \
    --exclude ".pytest_cache" \
    "$from"/ "$to"/
}

resolve_python() {
  if [[ -n "${INDICATOR_PYTHON:-}" ]]; then
    printf '%s\n' "$INDICATOR_PYTHON"
    return 0
  fi

  local candidates=(
    "$ROOT_DIR/backend/.venv/bin/python"
    "$ROOT_DIR/backend/.venv/Scripts/python.exe"
    "$ROOT_DIR/.venv/bin/python"
    "$ROOT_DIR/.venv/Scripts/python.exe"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v python3 >/dev/null 2>&1; then
    printf '%s\n' "python3"
    return 0
  fi

  if command -v python >/dev/null 2>&1; then
    printf '%s\n' "python"
    return 0
  fi

  return 1
}

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Run \`corepack enable\` and install frontend dependencies first."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found."
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "frontend dependencies are missing: $FRONTEND_DIR/node_modules"
  echo "Run \`pnpm --dir frontend install\` first."
  exit 1
fi

if [[ ! -x "$ENSURE_RUNTIME_SCRIPT" ]]; then
  echo "missing runtime helper: $ENSURE_RUNTIME_SCRIPT"
  exit 1
fi

PYTHON_EXEC="$(resolve_python || true)"
if [[ -z "$PYTHON_EXEC" ]]; then
  echo "No usable Python runtime found."
  echo "Set INDICATOR_PYTHON or create backend/.venv."
  exit 1
fi

echo "[desktop-release] verifying Python runtime with $PYTHON_EXEC"
(
  cd "$ROOT_DIR"
  "$PYTHON_EXEC" -c "import backend.app.serve, fastapi, uvicorn"
)

echo "[desktop-release] building frontend dist"
pnpm --dir "$FRONTEND_DIR" run build

echo "[desktop-release] staging release directory"
rm -rf "$OUTPUT_DIR"
mkdir -p "$APP_DIR/frontend"

echo "[desktop-release] preparing Electron runtime"
"$ENSURE_RUNTIME_SCRIPT" "$ELECTRON_DIR"

copy_tree "$ROOT_DIR/backend" "$APP_DIR/backend"
copy_tree "$FRONTEND_DIR/dist" "$APP_DIR/frontend/dist"

cp "$DESKTOP_DIR/main.js" "$APP_DIR/main.js"
cat >"$APP_DIR/package.json" <<EOF
{
  "name": "indicator-desktop-release",
  "private": true,
  "version": "0.1.0",
  "main": "main.js"
}
EOF

cat >"$OUTPUT_DIR/run-indicator-desktop.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/app"
ELECTRON_BIN="$ROOT_DIR/electron/Electron.app/Contents/MacOS/Electron"
PYTHON_EXECUTABLE="__INDICATOR_PYTHON__"

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Bundled Electron runtime not found: $ELECTRON_BIN"
  exit 1
fi

if [[ ! -x "$PYTHON_EXECUTABLE" ]]; then
  echo "Configured Python runtime not found: $PYTHON_EXECUTABLE"
  echo "Rebuild the desktop release after preparing the project Python environment."
  exit 1
fi

export INDICATOR_ELECTRON_MODE=release
export INDICATOR_BACKEND_ROOT="$APP_DIR"
export INDICATOR_FRONTEND_DIST="$APP_DIR/frontend/dist"
export INDICATOR_PYTHON="$PYTHON_EXECUTABLE"

exec "$ELECTRON_BIN" "$APP_DIR"
EOF
python_escaped="${PYTHON_EXEC//\\/\\\\}"
python_escaped="${python_escaped//\//\\/}"
sed -i.bak "s/__INDICATOR_PYTHON__/${python_escaped}/g" "$OUTPUT_DIR/run-indicator-desktop.sh"
rm -f "$OUTPUT_DIR/run-indicator-desktop.sh.bak"
chmod +x "$OUTPUT_DIR/run-indicator-desktop.sh"

mkdir -p "$OUTPUT_DIR"
cat >"$OUTPUT_DIR/runtime-assumptions.txt" <<EOF
Indicator Calculator desktop release assumptions
Built at: $(date '+%Y-%m-%d %H:%M:%S %Z')
Python runtime: $PYTHON_EXEC

1. This release ships backend source + frontend/dist + Electron runtime.
2. This release does not embed Python or backend dependencies.
3. Target machine must provide a Python interpreter that can import backend.app.serve, fastapi, and uvicorn.
4. Override the interpreter with INDICATOR_PYTHON when needed.
5. Launch the staged release via ./run-indicator-desktop.sh so Electron starts in explicit release mode.
EOF

if [[ "$(uname -s)" == "Darwin" ]] && command -v osacompile >/dev/null 2>&1; then
  APP_BUNDLE="$OUTPUT_DIR/Indicator Calculator.app"
  rm -rf "$APP_BUNDLE"
  osacompile -o "$APP_BUNDLE" <<'EOF'
on run
  set appBundlePath to POSIX path of (path to me)
  set releaseDir to do shell script "dirname " & quoted form of appBundlePath
  do shell script "cd " & quoted form of releaseDir & " && ./run-indicator-desktop.sh >/tmp/indicator_calculator_desktop.log 2>&1 &"
end run
EOF
fi

echo "[desktop-release] output ready under $OUTPUT_DIR"
