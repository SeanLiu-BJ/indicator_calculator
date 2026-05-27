#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"

VERSION="$(
  node -e "const p=require(process.argv[1]); process.stdout.write(p.dependencies.electron);" \
    "$DESKTOP_DIR/package.json"
)"

PLATFORM="${npm_config_platform:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
ARCH="${npm_config_arch:-$(uname -m)}"

case "$PLATFORM" in
  darwin|linux|win32) ;;
  mingw*|msys*|cygwin*) PLATFORM="win32" ;;
  *)
    echo "Unsupported Electron platform: $PLATFORM"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "Unsupported Electron arch: $ARCH"
    exit 1
    ;;
esac

RUNTIME_NAME="electron-v${VERSION}-${PLATFORM}-${ARCH}"
CACHE_DIR="$DESKTOP_DIR/.cache/electron"
ZIP_PATH="$CACHE_DIR/$RUNTIME_NAME.zip"
OUTPUT_DIR="${1:-$DESKTOP_DIR/node_modules/electron/dist}"
DOWNLOAD_URL="https://github.com/electron/electron/releases/download/v${VERSION}/${RUNTIME_NAME}.zip"

mkdir -p "$CACHE_DIR"

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "[electron-runtime] downloading $DOWNLOAD_URL"
  curl -L --fail --progress-bar "$DOWNLOAD_URL" -o "$ZIP_PATH"
else
  echo "[electron-runtime] reusing cache $ZIP_PATH"
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "[electron-runtime] extracting to $OUTPUT_DIR"
unzip -q "$ZIP_PATH" -d "$OUTPUT_DIR"

if [[ "$PLATFORM" == "darwin" ]]; then
  test -x "$OUTPUT_DIR/Electron.app/Contents/MacOS/Electron"
elif [[ "$PLATFORM" == "linux" ]]; then
  test -x "$OUTPUT_DIR/electron"
else
  test -f "$OUTPUT_DIR/electron.exe"
fi

echo "[electron-runtime] ready at $OUTPUT_DIR"
