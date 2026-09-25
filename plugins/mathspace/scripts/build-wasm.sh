#!/usr/bin/env bash
# build-wasm.sh — build the mathspace Wasm module with the pinned Emscripten
# and copy mathspace.mjs + mathspace.wasm into plugins/mathspace/wasm/
# (gitignored) for engine.js and the Vitest golden test. Same shape as
# data-drawing's, but the engine lives in the root project's CMake tree.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$PLUGIN/../.." && pwd)"

EMSDK_DIR="${EMSDK:-$HOME/emsdk}"
if [ ! -f "$EMSDK_DIR/emsdk_env.sh" ]; then
  echo "error: emsdk not found at $EMSDK_DIR (clone emscripten-core/emsdk there and run: ./emsdk install 6.0.10 && ./emsdk activate 6.0.10)" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc is not on PATH after sourcing $EMSDK_DIR/emsdk_env.sh" >&2
  exit 1
fi
echo "using $(emcc --version | head -1)"

(cd "$REPO" && cmake --preset wasm-release && cmake --build --preset wasm-release --target mathspace_wasm)

mkdir -p "$PLUGIN/wasm"
cp "$REPO/build/wasm-release/mathspace.mjs" "$REPO/build/wasm-release/mathspace.wasm" "$PLUGIN/wasm/"
echo "copied mathspace.mjs and mathspace.wasm to $PLUGIN/wasm/"
