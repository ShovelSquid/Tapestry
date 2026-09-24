#!/usr/bin/env bash
# build-wasm.sh — build the ddsim Wasm module with the pinned Emscripten and
# copy ddsim.mjs + ddsim.wasm into surface/wasm/ (gitignored) for the worker,
# the dev page and the Vitest golden test.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SURFACE="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SURFACE/../../.." && pwd)"
SIM="$REPO/data-drawing/sim"

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

(cd "$SIM" && cmake --preset wasm-release && cmake --build --preset wasm-release)

mkdir -p "$SURFACE/wasm"
cp "$SIM/build/wasm-release/ddsim.mjs" "$SIM/build/wasm-release/ddsim.wasm" "$SURFACE/wasm/"
echo "copied ddsim.mjs and ddsim.wasm to $SURFACE/wasm/"
