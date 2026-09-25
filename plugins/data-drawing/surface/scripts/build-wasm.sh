#!/usr/bin/env bash
# build-wasm.sh — build the mathspace Wasm module (the root project's
# wasm-release preset) with the pinned Emscripten and copy mathspace.mjs +
# mathspace.wasm into surface/wasm/ (gitignored) for the worker, the dev
# page and the Vitest golden and bridge tests. The same module
# plugins/mathspace builds for itself; data-drawing keeps its own copy so
# each plugin's wasm/ is complete on its own.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SURFACE="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SURFACE/../../.." && pwd)"

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

mkdir -p "$SURFACE/wasm"
cp "$REPO/build/wasm-release/mathspace.mjs" "$REPO/build/wasm-release/mathspace.wasm" "$SURFACE/wasm/"
echo "copied mathspace.mjs and mathspace.wasm to $SURFACE/wasm/"
