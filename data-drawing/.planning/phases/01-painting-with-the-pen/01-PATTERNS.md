# Phase 1: Painting with the Pen - Pattern Map

**Mapped:** 2026-09-22
**Files analyzed:** 38 (sim library 17, plugin package 15, outer-app CANV-04 touch list 6)
**Analogs found:** 27 / 38

All analog paths below are git-tracked (verified with `git ls-files`); none point into `.gsd/` mirrors or `node_modules`. Paths are relative to the monorepo root `/Users/kaelencook/Tapestry` unless stated. The sim library lives at `data-drawing/sim/`, the plugin at `plugins/data-drawing/` (per RESEARCH.md § Recommended Project Structure). Nothing under `data-drawing/sim/` or `plugins/data-drawing/` exists yet; the codebase has no fixed-point, Worker, Wasm, or three.js production code, so several analogs are "role-match" from the kernel and from tracked spike sources.

## File Classification

### Sim library (`data-drawing/sim/`) — C++20, zero deps

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `sim/CMakeLists.txt` | config (build) | batch | `tapestry/CMakeLists.txt` lines 1-38, 57-90 | exact (library + doctest + discover_tests) |
| `sim/CMakePresets.json` | config | batch | none (kernel has no presets) | no analog |
| `sim/include/ddsim/fx64.hpp` | utility (numeric type) | transform | `tapestry/kernel/Ids.hpp` (strong-typedef struct style) | role-match (struct conventions only; numerics from RESEARCH § fx64) |
| `sim/include/ddsim/ids.hpp` | model (id types) | transform | `tapestry/kernel/Ids.hpp` lines 10-41 | exact (uint64 id structs, comparators, `Tick` alias) |
| `sim/include/ddsim/rng.hpp` | utility | transform | none | no analog (reference C in RESEARCH § PRNG) |
| `sim/include/ddsim/brush.hpp` | model | CRUD (versioned table) | `tapestry/kernel/Ids.hpp` (POD struct + validator returning `std::optional`) | partial |
| `sim/include/ddsim/action.hpp` | model + codec | transform (LE byte encode/decode) | `tapestry/kernel/tree/Codec.hpp` usage in `tapestry/kernel_tests/codec_test.cpp` lines 234-262 (strict round-trip discipline) | role-match |
| `sim/include/ddsim/state.hpp` | model (POD SoA, constants) | — | `tapestry/kernel/Ids.hpp` | partial |
| `sim/include/ddsim/sim.hpp` + `src/sim.cpp` | service (apply/step/hash/serialize/restore) | event-driven (actions) + batch (step) | `tapestry/kernel/Digest.hpp` / `Digest.cpp` for the hash surface | partial |
| `sim/src/hash.cpp` (or inside `sim.cpp`) | utility | transform | `tapestry/kernel/Digest.cpp` lines 1-18 | exact (PicoSHA2 call) |
| `sim/include/ddsim/rules/brush_body.hpp`, `rules/emit.hpp` | service (rules) | batch | none | no analog (RESEARCH § Spring-damper, § Emission) |
| `sim/include/ddsim/ddsim_c.h` | config (C ABI header) | request-response | `app/native/addon.cpp` lines 1-25 (thin wrapper over kernel, no logic) | partial |
| `sim/wasm/ddsim_wasm.cpp` | adapter | request-response | `app/native/addon.cpp` (same "wrapper only, validation lives in the library" stance) | role-match |
| `sim/third_party/picosha2/picosha2.h` + LICENSE | vendored dep | — | `tapestry/third_party/picosha2/` (copy verbatim, same pin) | exact |
| `sim/tests/main.cpp` | test | — | `tapestry/kernel_tests/main.cpp` | exact |
| `sim/tests/*_test.cpp` (fx64_oracle, determinism, roundtrip, golden, id_stability, tpf_invariance) | test | batch | `tapestry/kernel_tests/codec_test.cpp` lines 12-60, 234-262 | exact (doctest style, fixture dir define) |
| `sim/tests/golden/*.actions`, `*.sha256` | fixture | file-I/O | `tapestry/docs/tree/` fixtures via `TAPESTRY_FIXTURE_DIR` | role-match |
| `sim/tools/ddsim_replay/main.cpp` | CLI | file-I/O + batch | `tapestry/tests/CameraTest.cpp` style plain executables (`tapestry/CMakeLists.txt` lines 196-208) | partial |

### Plugin package (`plugins/data-drawing/`) — TS, Vite 5, three.js

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `tapestry.plugin.json` | config (manifest) | — | `plugins/example-plugin/tapestry.plugin.json` | exact |
| `index.js` | controller (plugin entry, main process) | event-driven (activate/deactivate) | `plugins/example-plugin/index.js` lines 1-22, 79-97 | exact |
| `package.json` | config | — | `sdk/package.json` (workspace member shape); no plugin has one today | partial |
| `surface/vite.config.ts` | config | — | `app/electron.vite.config.ts` renderer block lines 37-47 | partial (library mode + worker format are new) |
| `surface/vitest.config.ts` | config | — | `app/vitest.config.ts` | exact (drop `pool: 'forks'`) |
| `surface/index.html` + `src/dev-host.ts` | dev harness | — | `.planning/spikes/005-thread-in-real-app/thread-layer.tsx` (stubbed host, real code) | role-match |
| `surface/src/main.ts` (`SurfaceModule.mount`) | component (surface entry) | event-driven (mount/dispose) | `.planning/spikes/005-thread-in-real-app/thread-layer.tsx` lines 95-113 | role-match |
| `surface/src/sim-host.ts` | service (transport-agnostic host) | request-response + pub-sub | `.planning/spikes/007-hybrid-glyph-worker/hybrid.js` lines 84-121 | role-match (Worker request/response, transferred buffers) |
| `surface/src/sim.worker.ts` | worker | event-driven | `.planning/spikes/007-hybrid-glyph-worker/hybrid.js` (main side); worker side has no tracked analog | partial |
| `surface/src/ddsim-abi.ts` | utility (encoder, snapshot layout) | transform | none in TS; mirrors `action.hpp` | no analog |
| `surface/src/input.ts` (the fence) | controller (native pointer listener) | streaming | `app/src/renderer/components/Canvas.tsx` lines 461-476 (pointer capture) — React-synthetic, so pattern only | partial |
| `surface/src/stage/scene.ts` | component (three.js renderer owner) | streaming | `.planning/spikes/001-thread-stream-load/thread.js` lines 54-59; `005/thread-layer.tsx` lines 95-113 | role-match |
| `surface/src/stage/nodes.ts`, `overlay.ts`, `colour.ts` | component | transform | none (three.js `InstancedMesh`; FNV-1a in RESEARCH § Code Examples) | no analog |
| `surface/src/brushes.ts` | store (in-memory versioned table) | CRUD | none | no analog |
| `surface/test/*.test.ts` | test | batch | `app/src/main/plugin-facade.test.ts` / `kernel-history.test.ts` lines 1-14 (vitest imports, "real artefact not a mock" stance) | role-match |

### Outer app — CANV-04 extension point touch list

| Modified/New File | Role | Data Flow | Closest Analog (same file, existing sibling) | Match Quality |
|-------------------|------|-----------|----------------------------------------------|---------------|
| `sdk/src/contributions.ts` (add `SurfaceContribution`, `SurfaceHost`, `SurfaceModule`) | model (types) | — | same file lines 98-115 (`InspectorContribution`) | exact |
| `sdk/src/index.ts` (`registerSurface`, `surfaces?:` on manifest) | model (types) | — | same file lines 186-210 (`PluginContext`), 264-286 (`PluginManifest`) | exact |
| `app/src/main/plugin-host.ts` (registry map, `registerSurface`, entry containment, `getContributions`) | service | CRUD (registry) | same file lines 156-161, 334-347, 377-409, 633-681 | exact |
| `app/src/main/index.ts` (privileged scheme + `protocol.handle`) | config (main process bootstrap) | request-response (file serving) | same file lines 39-58, 208-239; containment check pattern `plugin-host.ts` lines 868-874 | role-match (no `protocol` use exists yet) |
| `app/src/renderer/components/PluginSurfaceLayer.tsx` (new) | component (full-window layer) | event-driven (import/mount/dispose) | `app/src/renderer/components/PluginErrorNotification.tsx` lines 64-74 (fixed layer, zIndex); `.planning/spikes/005-thread-in-real-app/thread-layer.tsx` lines 95-113 (dispose) | role-match |
| `app/src/renderer/App.tsx` + `global.d.ts` (read `contributions.surfaces`) | controller | request-response (IPC) | `App.tsx` lines 127-138; `global.d.ts` lines 125-130 | exact |

## Pattern Assignments

### `sim/CMakeLists.txt` (config, batch)

**Analog:** `tapestry/CMakeLists.txt`

**Project header and shared settings** (lines 1-38) — copy, renaming `tapestry_settings` → `ddsim_settings`, add `-fwrapv` as PUBLIC so every preset and the Emscripten link inherit it (RESEARCH Pitfall 2):
```cmake
cmake_minimum_required(VERSION 3.24)
project(tapestry VERSION 0.1.0 DESCRIPTION "..." LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "Build type" FORCE)
endif()
option(TAPESTRY_BUILD_TESTS "Build the test suite" ON)

add_library(tapestry_settings INTERFACE)
target_compile_features(tapestry_settings INTERFACE cxx_std_20)
if(MSVC)
    target_compile_options(tapestry_settings INTERFACE /W4 /permissive- /fp:strict)
else()
    target_compile_options(tapestry_settings INTERFACE
        -Wall -Wextra -Wpedantic -Wshadow -Wconversion
        -ffp-contract=off)
endif()
```

**Vendored doctest as an INTERFACE target with SYSTEM include** (lines 57-59) — point at `${PROJECT_SOURCE_DIR}/../../tapestry/third_party/doctest` (reuse the repo's vendored copy; it is a test-only dependency so the "zero deps" rule for `ddsim` itself holds) or copy the three files:
```cmake
add_library(doctest INTERFACE)
target_include_directories(doctest SYSTEM INTERFACE ${PROJECT_SOURCE_DIR}/third_party/doctest)
add_library(doctest::doctest ALIAS doctest)
```

**Static library with globbed sources, PicoSHA2 PRIVATE SYSTEM include** (lines 68-72):
```cmake
file(GLOB_RECURSE TAPESTRY_KERNEL_SOURCES CONFIGURE_DEPENDS ${PROJECT_SOURCE_DIR}/kernel/*.cpp)
add_library(tapestry_kernel STATIC ${TAPESTRY_KERNEL_SOURCES})
target_include_directories(tapestry_kernel PUBLIC ${PROJECT_SOURCE_DIR})
target_include_directories(tapestry_kernel SYSTEM PRIVATE ${PROJECT_SOURCE_DIR}/third_party/picosha2)
target_link_libraries(tapestry_kernel PUBLIC tapestry_settings)
```

**Test binary with fixture-dir define and CTest discovery** (lines 79-90) — `DDSIM_GOLDEN_DIR` replaces `TAPESTRY_FIXTURE_DIR`:
```cmake
if(TAPESTRY_BUILD_TESTS)
    enable_testing()
    file(GLOB TAPESTRY_KERNEL_TEST_SOURCES CONFIGURE_DEPENDS ${PROJECT_SOURCE_DIR}/kernel_tests/*.cpp)
    add_executable(tapestry_kernel_tests ${TAPESTRY_KERNEL_TEST_SOURCES})
    target_link_libraries(tapestry_kernel_tests PRIVATE tapestry_kernel doctest::doctest)
    target_compile_definitions(tapestry_kernel_tests PRIVATE
        TAPESTRY_FIXTURE_DIR="${PROJECT_SOURCE_DIR}/docs/tree")
    include(${PROJECT_SOURCE_DIR}/third_party/doctest/doctest.cmake)
    doctest_discover_tests(tapestry_kernel_tests)
endif()
```

**Plain-executable test registration** (lines 196-208) — the pattern for the CI-grep test and `ddsim_replay`:
```cmake
add_executable(tapestry_tests tests/CameraTest.cpp)
target_link_libraries(tapestry_tests PRIVATE tapestry_core)
add_test(NAME camera COMMAND tapestry_tests)
```
For the grep gate use `add_test(NAME ddsim_no_floats COMMAND ${CMAKE_COMMAND} -P ${PROJECT_SOURCE_DIR}/cmake/NoFloats.cmake)` or a shell `grep -rnE` over `include/ src/` (RESEARCH § Code Examples "CI grep as a CTest test"). Scope to `sim/` only — `app/native/addon.cpp:22` includes `<cmath>`.

**Gating a subtree by option** (lines 96-104, `if(TAPESTRY_BUILD_RENDER)`) — same shape for `if(EMSCRIPTEN) add_executable(ddsim_wasm wasm/ddsim_wasm.cpp) ... target_link_options(... "-sMODULARIZE=1" ...) endif()`.

---

### `sim/tests/main.cpp` (test entry)

**Analog:** `tapestry/kernel_tests/main.cpp` lines 1-2 — copy verbatim:
```cpp
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
```

### `sim/tests/*_test.cpp` (doctest suites)

**Analog:** `tapestry/kernel_tests/codec_test.cpp`

**File header and imports** (lines 1-30) — a top comment stating the invariant the suite protects, project headers first, then `<doctest.h>`, then std headers, everything inside an anonymous namespace with `using` declarations:
```cpp
// Codec invariants.
//
// The .tree file is the only copy of a person's history, so the property that
// matters is exactness in both directions ...
#include "kernel/Digest.hpp"
#include "kernel/Ids.hpp"
...
#include <doctest.h>

#include <cstddef>
#include <optional>
#include <string>
namespace {
using tapestry::kernel::Digest;
using tapestry::kernel::sha256;
```

**Shared fixture builders + TEST_CASE with CHECK_MESSAGE** (lines 88-101, 234-262):
```cpp
// A commit with the fixed header lines filled in; ops are added per case.
CommitRecord baseRecord(CommitSeq seq, Tick tick = 0) { ... }

TEST_CASE("codec: every op and value type round-trips byte-identically") {
    const CommitRecord original = everythingRecord();
    const tree::Encoded encoded = tree::encodeCommit(original);
    for (const char* needle : {"@commit 7 ", "parent sha256:", ...}) {
        CHECK_MESSAGE(bytes.find(needle) != std::string::npos, needle);
    }
    CHECK(bytes.find("<<TEXT\n") == std::string::npos);
    auto decoded = decode(bytes, 7, 4);
```
Name cases `"fx64: mul matches __int128 oracle on seeded pairs"`, `"sim: restore(serialize(s)).hash() == s.hash()"`, `"sim: golden <fixture> hashes at checkpoints"`, `"ids: inserting a stroke leaves later strokes' node ids unchanged"`, `"sim: 1 tick per step() hashes identical to 4"`. Read golden files with a helper in the style of `tapestry/kernel_tests/support.hpp` lines 30-45 (`readFile` with C stdio in binary mode) rooted at `DDSIM_GOLDEN_DIR`.

---

### `sim/src/hash.cpp` / `sim.hpp` hash surface (utility, transform)

**Analog:** `tapestry/kernel/Digest.hpp` + `Digest.cpp`

**Header: keep the hash impl behind one TU** (`Digest.hpp` lines 10-23):
```cpp
struct Digest {
    std::string hex;
    friend bool operator==(const Digest& a, const Digest& b) { return a.hex == b.hex; }
};
// SHA-256 of exactly the bytes given. This is the only place the kernel
// touches a hash implementation; the vendored PicoSHA2 header stays behind
// Digest.cpp so no other translation unit depends on it.
Digest sha256(std::string_view bytes);
```

**PicoSHA2 call** (`Digest.cpp` lines 1-18):
```cpp
#include "kernel/Digest.hpp"
#include <picosha2.h>
namespace tapestry::kernel {
Digest sha256(std::string_view bytes) {
    return Digest{picosha2::hash256_hex_string(bytes.begin(), bytes.end())};
}
```
For `dd_hash(out[32])` use `picosha2::hash256(bytes.begin(), bytes.end(), out, out + 32)`; keep `hash256_hex_string` for the golden `.sha256` files so they match `shasum -a 256`. Vendor: `cp tapestry/third_party/picosha2/{picosha2.h,LICENSE} data-drawing/sim/third_party/picosha2/` and record the pin `161cb3fc4170fa7a3eca9e582cebd27cc4d1fe29` in a CMake comment exactly as `tapestry/CMakeLists.txt` lines 50-53 do.

**Strict parse, reject not clamp** (`Digest.cpp` lines 20-29) — the model for `restore()` and for `parse` of any golden line:
```cpp
std::optional<Digest> parseDigestHex(std::string_view text) {
    if (text.size() != kHexLength) return std::nullopt;
    for (const char c : text) if (!isLowerHex(c)) return std::nullopt;
    return Digest{std::string(text)};
}
```

---

### `sim/include/ddsim/ids.hpp`, `state.hpp`, `brush.hpp` (model)

**Analog:** `tapestry/kernel/Ids.hpp` lines 10-41

**Strong id struct with a documented zero marker and ordering** (lines 15-24) — reuse for `NodeId`/`StrokeId`; document the bit layout (`63..56 branch, 55..24 stroke ordinal, 23..0 emission index`) in the same comment style:
```cpp
// Kernel-assigned node identifier. Ids are sequential per world, start at 1,
// ... Zero is the unassigned marker ...
struct NodeId {
    std::uint64_t value = 0;
    bool assigned() const { return value != 0; }
    friend bool operator==(NodeId a, NodeId b) { return a.value == b.value; }
    friend bool operator<(NodeId a, NodeId b) { return a.value < b.value; }
};
using Tick = std::uint64_t;   // line 41
```
Separate struct types for `NodeId` vs `StrokeId` vs `BrushVersionId` (the file's `EdgeId` rationale, lines 26-36: "a separate type so an edge id can never be passed where a node id is expected"). `fx64` should follow the same shape: `struct fx64 { std::int64_t raw; }` with deleted float constructors and `static fx64 from_raw/from_int`.

---

### `sim/include/ddsim/ddsim_c.h` + `sim/wasm/ddsim_wasm.cpp` (adapter, request-response)

**Analog:** `app/native/addon.cpp` lines 1-25 (stance) and `app/native/CMakeLists.txt` (if the `addon` preset is ever built)

**Wrapper stance** (`addon.cpp` lines 1-11): "Each method converts between JavaScript values and the kernel's typed C++ structures, keeping all validation in the kernel itself." Copy this: `ddsim_wasm.cpp` and any addon only marshal bytes; `dd_apply` returns the error code the library computed.

**Addon CMake (deferred, for reference)** (`app/native/CMakeLists.txt` lines 14, 21-27, 33-37, 43-54):
```cmake
include_directories(SYSTEM ${CMAKE_JS_INC})
set(TAPESTRY_BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../tapestry ${CMAKE_CURRENT_BINARY_DIR}/tapestry)
add_library(tapestry_addon SHARED addon.cpp ${CMAKE_JS_SRC})
set_target_properties(tapestry_addon PROPERTIES PREFIX "" SUFFIX ".node")
execute_process(COMMAND node -p "require('node-addon-api').include" ... OUTPUT_VARIABLE NODE_ADDON_API_DIR)
target_compile_definitions(tapestry_addon PRIVATE NAPI_DISABLE_CPP_EXCEPTIONS)
```
Build invocation: `cmake-js build --directory native -O native/build` (`app/package.json:8`); loaded via `require(addonPath)` with an actionable error when missing (`app/src/main/kernel-bridge.ts` lines 32-42).

---

### `plugins/data-drawing/tapestry.plugin.json` (manifest)

**Analog:** `plugins/example-plugin/tapestry.plugin.json` (whole file):
```json
{
  "name": "example-plugin",
  "version": "1",
  "displayName": "Example Property Inspector",
  "main": "index.js",
  "api": "1",
  "contributions": { "nodeTypes": [], "commands": ["example.inspect"] }
}
```
Add `"surfaces": ["datadrawing.canvas"]` once `PluginManifest.contributions.surfaces?` lands in the SDK. `name` must satisfy `PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` (`plugin-host.ts:41`) and equal the directory name (`data-drawing`).

### `plugins/data-drawing/index.js` (plugin entry, CommonJS)

**Analog:** `plugins/example-plugin/index.js`

**Header, JSDoc types from the SDK only** (lines 1-22):
```js
/**
 * example-plugin — third-party example plugin for Tapestry.
 * Plugins are plain CommonJS JavaScript so the host can `require()` them
 * directly without a build step ...
 * Per PLUG-03: imports ONLY from the SDK package — no Electron, no host internals.
 */
/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */
```

**Plugin object with activate/deactivate and CJS export** (lines 79-97):
```js
/** @type {TapestryPlugin} */
const examplePlugin = {
  name: 'example-plugin',
  version: '1',
  /** @param {PluginContext} context */
  activate(context) {
    context.registerCommand(inspectCommand)
    context.registerPropertyPanel(propertyPanel)
  },
  deactivate() {
    // No subscriptions or handlers to clean up.
  },
}
module.exports = examplePlugin
```
For data-drawing: `activate(context) { context.registerSurface({ id: 'datadrawing.canvas', displayName: 'Data Drawing', entry: 'surface/dist/surface.js', placement: 'stage' }) }`. Constraint from `plugin-host.ts:343`: entry must match `/\.c?js$/`, and `package.json` must not set `"type": "module"`.

### `plugins/data-drawing/package.json`

**Analog:** `sdk/package.json` (workspace member; root `package.json` lines 4-8 declare `"workspaces": ["app", "sdk", "plugins/*"]`, so `plugins/data-drawing` is picked up automatically):
```json
{
  "name": "@tapestry/sdk",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": { "build": "tsc", "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.5.0" },
  "license": "MIT"
}
```
Add `"scripts": { "dev": "vite --config surface/vite.config.ts", "build": "vite build --config surface/vite.config.ts", "test": "vitest run --config surface/vitest.config.ts" }`, `"dependencies": { "three": "0.186.0" }`, `"devDependencies": { "@types/three": "0.186.0", "@webgpu/types": "0.1.74", "vite": "^5.4.0", "vitest": "2.1.9" }` — exact pins for three per the 02.3-04 plan's `--save-exact` precedent (`.planning/phases/02.3-time-threads/02.3-04-PLAN.md` Task 1 action). Installs gated by a `checkpoint:human-verify` (RESEARCH § Package Legitimacy Audit).

### `plugins/data-drawing/surface/vitest.config.ts`

**Analog:** `app/vitest.config.ts` — copy, drop `pool: 'forks'` (its comment explains it exists only for the addon's flock):
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['out/**', 'node_modules/**', 'native/**'],
    pool: 'forks',
    testTimeout: 30000,
  },
})
```

### `plugins/data-drawing/surface/vite.config.ts`

**Analog:** `app/electron.vite.config.ts` renderer block (lines 37-47) for the `root`/`rollupOptions.input` shape; the library-mode and worker settings are new (RESEARCH § The plugin's own dev loop: `build.lib.formats: ['es']`, `worker.format: 'es'`):
```ts
renderer: {
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
},
```
The main block's `external: [/\.node$/]` (line 23) is the precedent for keeping a binary artefact out of the bundle; for the surface, `ddsim.wasm` is a static asset referenced by `?url`.

### `plugins/data-drawing/surface/test/*.test.ts`

**Analog:** `app/src/main/kernel-history.test.ts` lines 1-14:
```ts
/**
 * ... These run against the real native addon in a temp world. A mocked bridge
 * would prove nothing here ...
 */
import { describe, expect, it } from 'vitest'
import { KernelBridge } from './kernel-bridge'
```
Same stance: the golden test `await import('../dist/ddsim.js')` (the real Wasm), reads `sim/tests/golden/*.sha256`, and compares hex.

---

### `surface/src/sim-host.ts` + `sim.worker.ts` (service + worker, request-response with transferred buffers)

**Analog:** `.planning/spikes/007-hybrid-glyph-worker/hybrid.js` lines 84-121 (main-thread side of a Worker protocol; tracked spike source)

**Spawn, ready promise, tagged messages, pending map, transferred buffer receipt**:
```js
const worker = new Worker('/007-hybrid-glyph-worker/msdf-worker.js')
const pending = new Map()
let nextRequestId = 1
const workerReady = new Promise((resolve, reject) => {
  worker.onmessage = (e) => {
    const msg = e.data
    if (msg.type === 'ready') { ...; return resolve() }
    if (msg.type === 'error') return reject(new Error(msg.message))
    if (msg.type === 'cell') {
      const sent = pending.get(msg.id); pending.delete(msg.id)
      // pixels arrived as a transferred ArrayBuffer
      msg.cell.pixels = new Uint8Array(msg.cell.pixels)
      layer?.upgrade(msg.grapheme, msg.cell)
    }
  }
  worker.onerror = (e) => reject(new Error(`worker: ${e.message}`))
})
worker.postMessage({ type: 'init', ... })
await workerReady
```
Adapt: `new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })` (Vite 5 form; the spike's string URL is not bundler-safe), message kinds `init | submit | pause | snapshot | hash | replay`, and the worker side posts `{ kind: 'snapshot', tick, count, nodes: copy.buffer }, [copy.buffer]` (RESEARCH § Reading a Wasm heap region). `SimHost` interface per RESEARCH Pattern 4; accumulator per Pattern 3 lives in the worker.

---

### `surface/src/stage/scene.ts` + `surface/src/main.ts` (three.js owner; mount/dispose)

**Analog:** `.planning/spikes/001-thread-stream-load/thread.js` lines 54-59 (creation) and `.planning/spikes/005-thread-in-real-app/thread-layer.tsx` lines 95-113 (dispose)

**Renderer creation**:
```js
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(innerWidth, innerHeight)
renderer.setClearColor(0x0d0f14)
document.body.prepend(renderer.domElement)
```
Adapt: `import { WebGPURenderer } from 'three/webgpu'`; `new WebGPURenderer({ canvas, antialias: true, forceWebGL })`; `await renderer.init()`; append to `host.container` not `document.body`; size from `host.onResize(cb)`.

**Dispose — idempotent, geometry/material/texture then renderer then context loss**:
```ts
dispose() {
  disposing = true
  removeEventListener('resize', onResize)
  scene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose()
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
    for (const m of mats) {
      for (const v of Object.values(m.uniforms ?? {})) if (v && v.value && v.value.isTexture) v.value.dispose()
      m.dispose()
    }
  })
  renderer.dispose()
  // dispose() alone leaves the context alive until GC; a browser allows only
  // a handful at once, so an app that opens and closes threads must release
  // it explicitly or the Nth open renders nothing.
  renderer.forceContextLoss()
  canvas.remove()
}
```
Also `renderer.setAnimationLoop(null)` before dispose (02.3-04-PLAN.md Task 1: "Stop the loop on close with `setAnimationLoop(null)`"; handle `webglcontextlost`/`webglcontextrestored` by rebuilding from the last snapshot). `SurfaceModule.mount` returns `{ dispose }` wrapping this; make `dispose` a no-op on second call because React 18 StrictMode double-mounts (spike skill `references/editor-and-app-integration.md` "Keep React 18 StrictMode on").

---

### `surface/src/input.ts` (the fence, streaming)

**Analog:** `app/src/renderer/components/Canvas.tsx` lines 461-476 — pointer capture with button check and `preventDefault`; but it is a React synthetic handler, which the fence must NOT be:
```ts
const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
  if (e.button !== 0) return
  if (!isBackground(e.target as HTMLElement, viewportRef.current)) return
  isPanningRef.current = true
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}, [...])
```
Adapt to a native listener on the surface canvas: `canvas.style.touchAction = 'none'`; `canvas.addEventListener('pointerdown', onDown)`; fence `paintable = (ev.pointerType === 'pen' || (settings.mouse && ev.pointerType === 'mouse')) && (ev.buttons & 1) === 1`; on move iterate `ev.getCoalescedEvents?.() ?? [ev]` (RESEARCH § Capture semantics, § Code Examples "The fence"). No analog exists for `getCoalescedEvents` in the app.

---

### `sdk/src/contributions.ts` (add surface types)

**Analog:** same file lines 98-115 — copy the section-banner + interface + doc-comment shape:
```ts
// ---------------------------------------------------------------------------
// Inspector Contribution
// ---------------------------------------------------------------------------

/**
 * Registers a general panel contribution not tied to a specific node type.
 * Shown in the inspector sidebar or tool area.
 */
export interface InspectorContribution {
  /** Unique identifier for this inspector panel. */
  id: string
  /** Human-readable display name for the panel. */
  displayName: string
  /** Name of the React component to render the panel. */
  component: string
}
```
`CommandContext` at lines 45-60 shows how a contribution type reaches the kernel: `kernel: import('./index').KernelAPI` — reuse that exact import form in `SurfaceHost.kernel`. Append the `SurfaceContribution` / `SurfaceHost` / `SurfaceModule` block from RESEARCH § Contribution name and shape.

### `sdk/src/index.ts` (`registerSurface`, manifest)

**Analog:** same file lines 186-210 and 264-286:
```ts
export interface PluginContext {
  kernel: KernelAPI;
  registerNodeView(contribution: import('./contributions').NodeViewContribution): void;
  ...
  registerInspector(contribution: import('./contributions').InspectorContribution): void;
}
export interface PluginManifest {
  ...
  contributions: {
    nodeTypes: string[];
    commands: string[];
  };
}
```
Add `registerSurface(contribution: import('./contributions').SurfaceContribution): void;` and `surfaces?: string[];`. Re-export the three new types wherever `NodeViewContribution` is re-exported (grep `export type` / `export *` in `sdk/src/index.ts`).

### `app/src/main/plugin-host.ts` (registry + registration + containment + getContributions)

**Analog:** same file — four sibling sites to extend in lockstep.

**Registry** (lines 156-161):
```ts
interface ContributionRegistry {
  nodeViews: Map<string, NodeViewContribution>
  commands: Map<string, CommandContribution>
  propertyPanels: Map<string, PropertyPanelContribution[]>
  inspectors: Map<string, InspectorContribution>
}
```
Add `surfaces: Map<string, SurfaceContribution>`; also extend `createEmptyRegistry()`.

**Entry-path containment** (lines 334-338) — apply identically to `contribution.entry` inside `registerSurface`:
```ts
const entryPath = resolve(pluginDir, manifest.main)
const relativeEntryPath = relative(pluginDir, entryPath)
if (relativeEntryPath.startsWith('..') || isAbsolute(relativeEntryPath)) {
  return this.recordFailure(name, manifest, 'Plugin entry path escapes plugin directory')
}
```

**Collision check + registration** (lines 358-367, 400-409):
```ts
const findOwner = (kind: 'nodeViews' | 'commands' | 'inspectors', key: string): string | null => {
  for (const [otherId, other] of this.plugins) {
    if (otherId === name || other.status !== 'loaded') continue
    if (other.contributions[kind].has(key)) return otherId
  }
  return null
}
...
registerInspector: (contribution: InspectorContribution) => {
  const owner = findOwner('inspectors', contribution.id)
  if (owner) {
    throw new Error(`Inspector ${contribution.id} is already registered by plugin ${owner}`)
  }
  contributions.inspectors.set(contribution.id, contribution)
},
```
Widen the `kind` union with `'surfaces'`; `registerSurface` throws on collision and on an escaping/non-`.js` entry (reuse the `/\.c?js$/` test at line 343 with the reason wording "build the plugin first").

**getContributions** (lines 636-681) — the inspectors branch is the shape to copy:
```ts
inspectors: Record<string, { id: string; displayName: string; component: string; pluginName: string }>
...
for (const [id, contrib] of loaded.contributions.inspectors) {
  result.inspectors[id] = { ...contrib, pluginName }
}
```
Emit `surfaces[id] = { ...contrib, pluginName }`; the renderer builds `tapestry-plugin://${pluginName}/${entry}` from `pluginName` (directory id) — never from the manifest `name`.

### `app/src/main/index.ts` (privileged scheme + handler)

**Analog:** same file lines 208-239 (bootstrap order) and `plugin-host.ts` lines 868-874 (containment)

**Where the plugins dir is known** (lines 231-239):
```ts
const pluginsDir = join(app.getAppPath(), '..', 'plugins')
pluginHost = new PluginHost(pluginsDir)
...
PluginHost.registerHandlers(ipcMain, pluginHost)
```
`protocol.registerSchemesAsPrivileged([...])` must run at module top level before line 208's `app.whenReady()`; `protocol.handle('tapestry-plugin', ...)` goes inside the `whenReady` callback next to `PluginHost.registerHandlers`, closing over the same `pluginsDir`. Add `protocol, net` to the `electron` import at line 16 and `pathToFileURL` from `url`.

**Path containment for `<pluginId>/<path>`** (`plugin-host.ts` lines 868-874 + `isValidPluginName` line 44):
```ts
private resolvePluginDir(name: string): string | null {
  if (!isValidPluginName(name)) return null
  const dir = resolve(this.pluginsDir, name)
  const rel = relative(this.pluginsDir, dir)
  if (rel !== name || isAbsolute(rel) || rel.includes(sep)) return null
  return dir
}
```
Do the same for the requested file: `resolve(pluginDir, decodedPath)` then `relative(pluginDir, ...)` must not start with `..` or be absolute (`isWellFormedTreePath` at `index.ts` lines 90-95 also rejects `..` segments explicitly). Respond via `net.fetch(pathToFileURL(file).toString())` and set `Content-Type` by extension and `Access-Control-Allow-Origin: *` (RESEARCH § Outer files touched).

**BrowserWindow security posture stays as is** (lines 40-50): `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` — the surface module runs sandboxed and reaches the kernel only through `window.tapestry` (preload `app/src/preload/index.ts` lines 101-106).

### `app/src/renderer/components/PluginSurfaceLayer.tsx` (new, full-window layer)

**Analog:** `app/src/renderer/components/PluginErrorNotification.tsx` lines 64-74 (fixed positioning + high zIndex, inline style):
```tsx
<div
  className="plugin-error-notification"
  style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10000, ... }}
>
```
Surface layer: `position: 'fixed', inset: 0, zIndex` below 10000 (notifications stay on top) and above the canvas + scrim; rendered as a sibling of the canvas in `App.tsx`, never inside the transformed container (spike skill SKILL.md "The thread is a full-window layer over the dimmed canvas"; order notes → scrim → surface → notifications). Mount logic in a `useEffect`: `const mod = await import(/* @vite-ignore */ url)`; `const handle = await mod.default.mount(host)`; cleanup calls `handle.dispose()` (idempotent). Dispose ordering follows `.planning/spikes/005-thread-in-real-app/thread-layer.tsx` lines 95-113 (see scene.ts above).

### `app/src/renderer/App.tsx` + `global.d.ts` (read surfaces)

**Analog:** `App.tsx` lines 127-138:
```ts
const refreshPluginContributions = useCallback(async () => {
  try {
    const contributions = await window.tapestry.plugins.getContributions()
    const views: Record<string, string> = {}
    for (const [nodeType, contrib] of Object.entries(contributions.nodeViews)) {
      views[nodeType] = (contrib as any).component
    }
    setPluginNodeViews(views)
  } catch {
    // Plugins not available yet — empty views
  }
}, [])
```
Add `setPluginSurfaces(Object.values(contributions.surfaces ?? {}))` in the same callback. `global.d.ts` lines 125-130 list the `getContributions()` return type per kind — add `surfaces: Record<string, { id: string; displayName: string; entry: string; placement: 'stage'; pluginName: string }>`.

## Shared Patterns

### Determinism compile settings
**Source:** `tapestry/CMakeLists.txt` lines 22-38
**Apply to:** every `ddsim` target (library, tests, replay CLI, wasm)
```cmake
# Determinism rule, inherited from semantic-world: no fast-math, no FP
# contraction. ...
target_compile_options(tapestry_settings INTERFACE
    -Wall -Wextra -Wpedantic -Wshadow -Wconversion
    -ffp-contract=off)
```
Add `-fwrapv` PUBLIC on `ddsim`; UBSan preset adds `-fsanitize=undefined -fno-sanitize-recover=all` to tests only.

### Vendored dependencies with recorded pins, SYSTEM includes
**Source:** `tapestry/CMakeLists.txt` lines 40-59, 71
**Apply to:** `sim/third_party/picosha2`, doctest
The comment block records upstream URL, exact tag/commit, license file; includes are `SYSTEM` so third-party warnings never gate the build.

### Strict parse: reject, never clamp
**Source:** `tapestry/kernel/Digest.cpp` lines 20-29; `tapestry/kernel/Ids.hpp` lines 43-50 comment ("an id that the writer would not have produced is not an id")
**Apply to:** `dd_restore`, action decoder, `DefineBrush` validator (stability clamps reject the action, RESEARCH § Spring-damper)

### Registration collision → throw with owner name
**Source:** `app/src/main/plugin-host.ts` lines 351-367
**Apply to:** `registerSurface`

### Plugin-id and path containment
**Source:** `app/src/main/plugin-host.ts` lines 41-46 (`PLUGIN_NAME_RE`, `isValidPluginName`), 334-338, 868-874
**Apply to:** `registerSurface` entry validation; `protocol.handle('tapestry-plugin')` file resolution

### Third-party plugin discipline
**Source:** `plugins/example-plugin/index.js` lines 8-16
**Apply to:** `plugins/data-drawing/index.js` and `surface/src/*` — "imports ONLY from the SDK package — no Electron, no host internals". The surface module must not import host React or `window.tapestry` internals beyond the `SurfaceHost` it is handed.

### WebGL/WebGPU context lifetime
**Source:** `.planning/spikes/005-thread-in-real-app/thread-layer.tsx` lines 95-113; `.claude/skills/spike-findings-tapestry/references/editor-and-app-integration.md` "Create the renderer when a thread opens; destroy it when it closes"
**Apply to:** `surface/src/stage/scene.ts`, `PluginSurfaceLayer.tsx`
One renderer per surface; `setAnimationLoop(null)` → traverse-dispose → `renderer.dispose()` → `renderer.forceContextLoss()` → remove canvas. Idempotent for StrictMode.

### Worker message protocol
**Source:** `.planning/spikes/007-hybrid-glyph-worker/hybrid.js` lines 84-121
**Apply to:** `sim-host.ts` / `sim.worker.ts`
Tagged `{ type | kind }` messages, a `ready` handshake promise, `pending` map keyed by request id, transferred `ArrayBuffer` re-wrapped as a typed array on receipt.

### Test-suite stance
**Source:** `tapestry/kernel_tests/codec_test.cpp` lines 1-10; `app/src/main/kernel-history.test.ts` lines 1-8
**Apply to:** all `sim/tests` and `surface/test`
Header comment names the invariant; tests run the real artefact (real Wasm, real golden bytes), no mocks; exact-bytes assertions.

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `sim/CMakePresets.json` | config | — | No presets anywhere in the repo; RESEARCH § CMake preset for the Wasm build |
| `sim/include/ddsim/fx64.hpp` (numerics) | utility | transform | No fixed-point code exists; RESEARCH § fx64 (`mul_q32`, isqrt, rounding rule) |
| `sim/include/ddsim/rng.hpp` | utility | transform | RESEARCH § PRNG reference C |
| `sim/include/ddsim/rules/*.hpp` | service | batch | RESEARCH § Spring-damper, § Emission |
| `sim/wasm/*` link flags | config | — | No Emscripten build exists; RESEARCH § Link flags |
| `surface/src/ddsim-abi.ts` | utility | transform | Mirror of `action.hpp` byte grammar; RESEARCH § The flat C ABI |
| `surface/src/stage/nodes.ts`, `overlay.ts`, `colour.ts` | component | transform | No `InstancedMesh`/three code in app; RESEARCH § Renderer Choice, § Code Examples (FNV-1a) |
| `surface/src/brushes.ts` | store | CRUD | RESEARCH § Brush table design |
| `surface/src/sim.worker.ts` (worker side) | worker | event-driven | Spike worker (`msdf-worker.js`) is Node-integrated, not a model; RESEARCH Pattern 3 accumulator |
| `surface/src/input.ts` coalesced/quantize path | controller | streaming | No `getCoalescedEvents` use in app; RESEARCH § Code Examples "The fence" |

## Metadata

**Analog search scope:** `tapestry/` (CMakeLists, kernel/, kernel_tests/, third_party/), `app/native/`, `app/src/main/`, `app/src/preload/`, `app/src/renderer/components/`, `app/*.config.ts`, `sdk/src/`, `sdk/package.json`, `plugins/*/`, `.planning/spikes/{001,005,007}`, `.planning/spikes/CONVENTIONS.md`, `.planning/phases/02.3-time-threads/02.3-04-PLAN.md`, `.claude/skills/spike-findings-tapestry/`
**Files scanned:** 31 (all reads targeted by line range; every analog path verified tracked via `git ls-files`)
**Pattern extraction date:** 2026-09-22
