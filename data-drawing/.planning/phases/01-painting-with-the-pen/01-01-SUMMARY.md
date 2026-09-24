---
phase: 01-painting-with-the-pen
plan: 01
subsystem: sim-core
tags: [cpp20, cmake, fixed-point, q32.32, sha256, picosha2, emscripten, wasm, web-worker, vite, vitest, doctest, tapestry-plugin]

# Dependency graph
requires: []
provides:
  - "data-drawing/sim: dependency-free C++20 ddsim library (fx64 Q32.32, ids, rng, state, action decoder, Sim apply/step/hash/serialize/restore, flat C ABI)"
  - "SIM-01 build gate: -fwrapv on every target, forbidden-token scan at configure time and as CTest ddsim_forbidden_tokens"
  - "One canonical byte walk + SHA-256; committed goldens noop/one-brush at ticks 0/1/60/600 reproduced by Debug, Release, Wasm-in-Node and Vitest"
  - "CMake presets native-debug / native-release / wasm-release with Emscripten pinned to 6.0.10 (checked against EMSCRIPTEN_VERSION)"
  - "plugins/data-drawing: manifest, CommonJS entry, Vite library build (dist/surface.js + ES worker chunk + ddsim.wasm file), Vitest golden test"
  - "SimHost interface + WorkerTransport; sim.worker.ts running the Wasm sim at 60 Hz with a whole-tick accumulator and transferred HEAPU8.slice() snapshots"
  - "Dev page (npm --prefix plugins/data-drawing run dev) showing live tick, node count, hash and a Define brush button; window.__dd for console poking"
  - "emsdk 6.0.10 installed at ~/emsdk"
affects: [01-02, 01-03, 01-04, 01-05, 01-06, 01-07, 01-08, phase-2-grammar]

# Actuals (#2632) — chars/4 over the realized diff (git diff f72ce80..HEAD), not a harness token count.
actuals:
  tokens: 34917
  tasks: 3
  commits: 3
plan_head_before: f72ce80b7fe9e2fa85e4b37d17ebb84d1d280b79

# Tech tracking
tech-stack:
  added:
    - "Emscripten 6.0.10 (emsdk at ~/emsdk, bootstrapped with emsdk's own bundled Python 3.13.3)"
    - "PicoSHA2 vendored into data-drawing/sim/third_party (pin 161cb3fc4170fa7a3eca9e582cebd27cc4d1fe29)"
    - "doctest v2.5.3 reused from tapestry/third_party via DDSIM_DOCTEST_DIR (test-only)"
    - "Vite 5.4.21 / Vitest 2.1.9 / TypeScript 5.9.3 (already hoisted; new workspace member plugins/data-drawing)"
  patterns:
    - "fx64: the only numeric type; floating-point construction deleted via a std::is_floating_point_v-constrained template so the header itself passes the forbidden-token gate"
    - "Decode into a local, commit only on DD_OK: a rejected action or restore never touches state or the hash"
    - "One canonical byte walk, every field explicit little-endian, never memcpy of a struct; PicoSHA2 lives behind a single TU (hash.cpp)"
    - "Strict inverse restore: magic, every version pin, DD_MAX_* limits, ascending ids, no trailing bytes — any deviation is DD_ERR_RESTORE"
    - "Flat C ABI wrappers are one-line forwards with null/length checks; validation lives in the library"
    - "Wall clock only in the worker loop and only to decide how many dd_step() calls run; whole ticks, never a fractional step"
    - "Renderer receives copies only: HEAPU8.slice() in a transfer list; HEAPU8 re-read from the module object at every use; no SharedArrayBuffer"
    - "Golden fixtures as readable text (seed / action <tick> <hex> / checkpoint <tick>) with one replay rule shared by C++, the Node checker and Vitest"

key-files:
  created:
    - data-drawing/sim/CMakeLists.txt
    - data-drawing/sim/CMakePresets.json
    - data-drawing/sim/cmake/forbidden_tokens.cmake
    - data-drawing/sim/include/ddsim/fx64.hpp
    - data-drawing/sim/include/ddsim/ids.hpp
    - data-drawing/sim/include/ddsim/rng.hpp
    - data-drawing/sim/include/ddsim/state.hpp
    - data-drawing/sim/include/ddsim/brush.hpp
    - data-drawing/sim/include/ddsim/action.hpp
    - data-drawing/sim/include/ddsim/sim.hpp
    - data-drawing/sim/include/ddsim/ddsim_c.h
    - data-drawing/sim/src/sim.cpp
    - data-drawing/sim/src/hash.cpp
    - data-drawing/sim/src/ddsim_c.cpp
    - data-drawing/sim/wasm/ddsim_wasm.cpp
    - data-drawing/sim/tests/main.cpp
    - data-drawing/sim/tests/golden_support.hpp
    - data-drawing/sim/tests/skeleton_test.cpp
    - data-drawing/sim/tests/golden/noop.actions
    - data-drawing/sim/tests/golden/noop.sha256
    - data-drawing/sim/tests/golden/one-brush.actions
    - data-drawing/sim/tests/golden/one-brush.sha256
    - data-drawing/sim/tools/gen_fixtures/main.cpp
    - data-drawing/sim/tools/wasm-hash-check.mjs
    - data-drawing/sim/third_party/picosha2/picosha2.h
    - data-drawing/sim/third_party/picosha2/LICENSE
    - plugins/data-drawing/tapestry.plugin.json
    - plugins/data-drawing/index.js
    - plugins/data-drawing/package.json
    - plugins/data-drawing/tsconfig.json
    - plugins/data-drawing/surface/vite.config.ts
    - plugins/data-drawing/surface/vitest.config.ts
    - plugins/data-drawing/surface/index.html
    - plugins/data-drawing/surface/scripts/build-wasm.sh
    - plugins/data-drawing/surface/src/ddsim-abi.ts
    - plugins/data-drawing/surface/src/ddsim-glue.d.ts
    - plugins/data-drawing/surface/src/host-types.ts
    - plugins/data-drawing/surface/src/main.ts
    - plugins/data-drawing/surface/src/dev-host.ts
    - plugins/data-drawing/surface/src/sim-host.ts
    - plugins/data-drawing/surface/src/sim.worker.ts
    - plugins/data-drawing/surface/test/fixture-replay.ts
    - plugins/data-drawing/surface/test/wasm-golden.test.ts
  modified:
    - .gitignore
    - package-lock.json

key-decisions:
  - "fx64 deletes floating-point construction through a constrained template instead of naming the two type keywords, so the forbidden-token gate can scan include/ without an exemption; static_asserts in the tests prove float, double and long double are not constructible or convertible"
  - "emsdk was bootstrapped with its own bundled Python 3.13.3 artifact (the tarball its manifest declares for macOS arm64) because the system Python is 3.9.6 and emsdk.py refuses < 3.10; nothing was installed through Homebrew"
  - "The worker encodes DefineBrush itself (message defineBrush { id, spec }) and assigns brush_count + 1, because the worker is the recorder and the only place the brush count is authoritative; the rejected message carries actionKind because DdError.kind collided with the message discriminator"
  - "Vite library mode inlines every asset as base64 regardless of assetsInlineLimit, so a build-only plugin (dd-wasm-as-file) emits ddsim.wasm as a real asset for both the ?url import and the Emscripten glue's own new URL('ddsim.wasm', import.meta.url) fallback; fileName is pinned to surface.js because a package without type: module would otherwise get .mjs"
  - "gen_fixtures shares the single C++ test encoder in tests/golden_support.hpp rather than carrying a private copy, so there is exactly one C++ encoder and one TS encoder, proven equal by wasm-golden.test.ts"
  - "SIM-01/02/03 are NOT marked complete by this plan: requirements.ready-ids reports 0/3 ready because 01-03 (SIM-01, SIM-02), 01-05 (SIM-02) and 01-08 (SIM-03) also declare them; the shared-ID gate holds them until those plans finish"

patterns-established:
  - "Determinism compile settings: ddsim_settings INTERFACE with -Wall -Wextra -Wpedantic -Wshadow -Wconversion -ffp-contract=off -fwrapv, PUBLIC through the library so every preset and the Emscripten link inherit it"
  - "Two-sided build gate: cmake/forbidden_tokens.cmake include()d at configure time (cmake -B fails) and registered as CTest ddsim_forbidden_tokens"
  - "Golden production: ddsim_tests with DDSIM_WRITE_GOLDEN=1 writes a missing .sha256 from native-release; committed goldens are then required by Debug, Release, Wasm-in-Node and Vitest"
  - "Plugin dev loop: surface/index.html + dev-host.ts mount the surface with a stub SurfaceHostLike; no native app build is needed to try the plugin"

requirements-completed: []

coverage:
  - id: D1
    description: "ddsim native harness: fx64/ids/rng/state/action/sim/hash/C ABI compile with -fwrapv under Debug and Release; 11 doctest cases (327 assertions) plus the forbidden-token gate pass; the gate fails configure and CTest when a floating-point keyword is planted under src/"
    requirement: SIM-01
    verification:
      - kind: unit
        ref: "cd data-drawing/sim && ctest --preset native-release --output-on-failure (12/12) && ctest --preset native-debug --output-on-failure (12/12)"
        status: pass
      - kind: other
        ref: "fail-first proof: src/zz_probe.cpp containing `double` -> cmake --preset native-debug exit 1 'forbidden token in .../zz_probe.cpp'; ctest -R ddsim_forbidden_tokens Failed; after rm both pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "One canonical byte walk hashed with SHA-256; goldens noop/one-brush at ticks 0/1/60/600 committed and reproduced byte for byte by native-debug, native-release and the Wasm module in Node; restore(serialize(s)).hash() == s.hash() at every checkpoint; truncated/magic/version/trailing inputs rejected with the hash unchanged"
    requirement: SIM-02
    verification:
      - kind: unit
        ref: "data-drawing/sim/tests/skeleton_test.cpp#sim: golden noop hashes at checkpoints / sim: golden one-brush hashes at checkpoints / sim: restore(serialize(s)).hash() == s.hash() at every checkpoint / sim: restore rejects ..."
        status: pass
      - kind: integration
        ref: "node data-drawing/sim/tools/wasm-hash-check.mjs build/wasm-release/ddsim.mjs tests/golden/{noop,one-brush}.actions tests/golden/{noop,one-brush}.sha256 -> OK noop 4 / OK one-brush 4"
        status: pass
    human_judgment: false
  - id: D3
    description: "The same source builds with Emscripten 6.0.10 (pinned and checked), loads in Node and in a module Web Worker through the flat C ABI only; Vitest replays every committed golden through the real ddsim.mjs; the TS DefineBrush encoder equals the C++ one byte for byte; the renderer only ever receives transferred copies (no SharedArrayBuffer, no Electron import)"
    requirement: SIM-03
    verification:
      - kind: integration
        ref: "npm --prefix plugins/data-drawing test -> test/wasm-golden.test.ts 5 passed"
        status: pass
      - kind: other
        ref: "npm --prefix plugins/data-drawing run typecheck && run build -> dist/surface.js, dist/assets/sim.worker-*.js, dist/assets/ddsim-*.wasm; negative greps for SharedArrayBuffer and electron pass"
        status: pass
    human_judgment: false
  - id: D4
    description: "Dev page at http://localhost:5173 runs the Wasm sim in a module Worker at 60 Hz, shows a 64-hex hash, and one Define brush click changes the hash, is recorded once in the worker log at the applied tick, and hashes identically to the golden machinery at the same tick; pause freezes and resumes the counter"
    requirement: SIM-03
    verification:
      - kind: automated_ui
        ref: "headless browser script (browser-automation skill) against `npm --prefix plugins/data-drawing run dev`: 59.9 ticks/s, applied at tick 125, log [{tick:125}] with bytes == one-brush.actions action 0, hash e307a184... -> 505529d3..., pause frozen at 127 / resumed to 187; paused page hash at tick 4 == wasm-hash-check of (seed 42, DefineBrush@0, checkpoint 4)"
        status: pass
    human_judgment: false

# Metrics
duration: 27min
completed: 2026-09-23
status: complete
---

# Phase 1 Plan 01: Walking Skeleton Summary

**Dependency-free C++20 `ddsim` with a Q32.32 `fx64`, one canonical SHA-256 byte walk and a flat C ABI, built natively (doctest goldens under CTest) and with Emscripten 6.0.10, running live at 60 Hz in a module Worker behind `SimHost`, with the plugin's own Vite dev page submitting one `DefineBrush` and showing the same hash the native goldens produce.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-09-23T00:13:28Z
- **Completed:** 2026-09-23T00:40:37Z
- **Tasks:** 3
- **Files modified:** 45 (43 created, 2 modified)

## Accomplishments

- SIM-01 skeleton: `fx64` is the only numeric type in `include/`, `src/` and `wasm/`; construction from any floating-point type is deleted; `-fwrapv` is PUBLIC on `ddsim_settings`; `cmake/forbidden_tokens.cmake` fails both `cmake -B` and `ctest` when a floating-point keyword, `<cmath>`, `<random>` or `unordered_` appears (fail-first proof below); the seeded xoshiro256** state sits in the hash.
- SIM-02 skeleton: `hash.cpp` holds the one canonical walk (`"DDS1"` | five version pins | `tick_hz` | seed | tick | brushes | rng | strokes | nodes) and its strict inverse; goldens at ticks 0/1/60/600 for `noop` and `one-brush` are committed and reproduced by Debug, Release, the Wasm module in Node and Vitest; `restore(serialize(s)).hash() == s.hash()` at every checkpoint; malformed inputs are rejected with the hash untouched.
- SIM-03 skeleton: the same source builds to `ddsim.mjs`/`ddsim.wasm` with Emscripten pinned to 6.0.10 (CMake errors on any other `EMSCRIPTEN_VERSION`); `sim.worker.ts` runs it in a module Worker draining whole ticks from an accumulator; `WorkerTransport implements SimHost`; the renderer receives only `HEAPU8.slice()` copies in transfer lists.
- The dev page shows tick, node count and hash live; `Define brush` changes the hash, is recorded once in the worker's log at the applied tick, and the paused page hash equals the golden machinery's hash at the same tick.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install emsdk 6.0.10, vendor PicoSHA2, ignore build outputs** - `5879d1f` (chore)
2. **Task 2: End-to-end "one action changes the hash" — native goldens and the same hash from the Wasm module in Node** - `688cc7b` (feat, tracer)
3. **Task 3: Plugin package, module Worker sim host and the dev page that shows tick and hash** - `ca01fbd` (feat)

**Plan metadata:** see the final `docs(01-01)` commit.

## Task 1 record: emsdk

- Install path: `/Users/kaelencook/emsdk` (cloned from `https://github.com/emscripten-core/emsdk.git`; `./emsdk install 6.0.10 && ./emsdk activate 6.0.10`).
- Version line after `source ~/emsdk/emsdk_env.sh`:
  `emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.10 (d6c521a7f05449857c76bd99e396895583cf2083)`
- Toolchain file present: `~/emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake`.
- `EMSDK_PYTHON=/Users/kaelencook/emsdk/python/3.13.3_64bit/bin/python3` (emsdk's bundled Python; see Deviations).
- PicoSHA2 vendored byte-identically (`cmp` clean) with its LICENSE; `.gitignore` gained `data-drawing/sim/build/`, `plugins/data-drawing/surface/wasm/`, `plugins/data-drawing/surface/dist/`.

## Task 2 record: goldens and the gate

`tests/golden/noop.actions` (seed 42, no actions, checkpoints 0 1 60 600) -> `noop.sha256`:

```
0 198a1ff547b0adb0f969a111a4ce6c31be7b2406220e1bc22fb2905f70c98586
1 d9d3693be1ef6b44600a4fce07b35255941ba9a9061dc5062f59627d0b1fb595
60 98ff7ed7bbdc420f21c63adab48a51b1627765f0d9fb9beb03afaea0c2688293
600 04411bbe5d2f42ab9fd4d6060d0a78cfa0916d288d14ae6a9f495425902b8458
```

`tests/golden/one-brush.actions` (seed 42; `action 0` = DefineBrush id 1, "ink", mass 1.0, radius 0.75, spacing 0.5, identity curve; checkpoints 0 1 60 600) -> `one-brush.sha256`:

```
0 fc271b773a764b146c3b01ab1c6600bf2d8a9275023b8d0b0e9e45378bedff73
1 07c14a6f4e983e059a94ac28061fc18ffa1215f565cee9bc3d05124c98c32abd
60 cdd0a5f7aeb38b5b3ad0b4711ce10b1c12761c9a461e539f89f10261f453ab52
600 0b06a0f241e683874c0465ddd6b5d6a490adce125a7d20dca1e3121ebdb0fba4
```

The `action 0` bytes are `01010000450000000100000003000000696e6b0000000001000000000000c0000000000000008000000000000000100020003000400050006000700080009000a000b000c000d000e000f0ffff` (header `01 01 0000 45000000`, payload 69 bytes). The two files differ at every tick and `noop` differs between tick 0 and tick 1 (the tick is in the walk).

Reproduction: `ctest --preset native-release` 12/12, `ctest --preset native-debug` 12/12 (11 doctest cases + `ddsim_forbidden_tokens`, 327 assertions), `node tools/wasm-hash-check.mjs build/wasm-release/ddsim.mjs tests/golden/noop.actions tests/golden/noop.sha256` -> `OK noop 4`, same for one-brush -> `OK one-brush 4`. `clang -x c -fsyntax-only include/ddsim/ddsim_c.h` exits 0. The Wasm module exports all 15 `_dd_*` symbols plus `_malloc`/`_free`; `_dd_tick` returns a `bigint` and `_dd_create` takes one (WASM_BIGINT is on by default in Emscripten 6).

**Forbidden-token fail-first proof** (with `src/zz_probe.cpp` containing `static double zz_probe_value = 0;`):

```
$ cmake --preset native-debug        -> exit 1
  CMake Error at cmake/forbidden_tokens.cmake:32 (message):
    forbidden token in /Users/kaelencook/Tapestry/data-drawing/sim/src/zz_probe.cpp
$ ctest --preset native-debug -R ddsim_forbidden_tokens
  1/1 Test #12: ddsim_forbidden_tokens ...***Failed
  0% tests passed, 1 tests failed out of 1
$ rm src/zz_probe.cpp && cmake --preset native-debug
  -- ddsim_forbidden_tokens: 12 sim sources are clean
$ ctest --preset native-debug -R ddsim_forbidden_tokens   -> 100% tests passed out of 1
```

## Task 3 record: dev-page observation

Measured headlessly (browser-automation skill, patchright) against `npm --prefix plugins/data-drawing run dev` at `http://localhost:5173/`, zero console errors, zero failed requests:

| Observation | Value |
|---|---|
| Status line | `status sim v1 at 60 Hz in a module Worker` |
| Tick rate | tick 0 -> 120 over 2.0 s wall clock = **59.9 ticks/s** |
| Hash before Define brush | `e307a184e0e65f651471df5a429d352e670c537903ea0426dc87d6a997c5c286` |
| `window.__dd.sim.log()` before | 0 entries |
| Click `Define brush` | panel: `applied at tick 125 (brush version 1)` |
| `log()` after | exactly one entry, `tick: 125`, bytes == `one-brush.actions` action 0 |
| Hash after (panel refresh and `sim.hash()`) | `505529d36b3b0c513e7e1dd85f628b7db36b17946a0c541eb33ebe5a00f9a89c` |
| `pause(true)` | counter frozen at 127 for 1 s |
| `pause(false)` | counter at 187 one second later (60 ticks) |
| second `defineBrush(...)` | applied as version 2; `log()` has 2 entries |
| Cross-check | in a fresh page: Define brush, `pause(true)`, `currentTick()` = 4, `hash()` = `81b4afbe7cb3ea7c3b51f21a6e2f5bb02cf3be736e185c3dbd1254c51a875149`; `wasm-hash-check.mjs` on fixture (seed 42, DefineBrush at tick 0, checkpoint 4) -> `OK page 1`, i.e. the page's hash equals the golden machinery's hash for the same tick |

Build: `dist/surface.js` (5.8 kB), `dist/assets/sim.worker-*.js` (11.6 kB), `dist/assets/ddsim-*.wasm` (36.6 kB); `surface.js` references the worker via `new URL(`; the worker chunk references the wasm via `new URL("ddsim-*.wasm", import.meta.url)`; no `data:` URLs in dist.

## Files Created/Modified

- `data-drawing/sim/include/ddsim/fx64.hpp` - Q32.32 `fx64`, `ONE`, `from_int/from_raw/from_q16`, `to_q16`, `floor_to_int`, add/sub/compare; floating-point construction deleted
- `data-drawing/sim/include/ddsim/ids.hpp` - `NodeId`/`StrokeId`/`BrushVersionId`, `Tick`, bit layout branch(8)|ordinal(32)|index(24), `make_node_id`/`make_stroke_id`
- `data-drawing/sim/include/ddsim/rng.hpp` - `splitmix64`, `Xoshiro256ss::seed_from`
- `data-drawing/sim/include/ddsim/state.hpp` - all `DD_*` pins/limits, `BrushVersion`, `Node`, `BrushBody`, `ActiveStroke`, `State`
- `data-drawing/sim/include/ddsim/brush.hpp` - `validate_brush` (reject, never clamp)
- `data-drawing/sim/include/ddsim/action.hpp` - `ActionKind`, `ActionHeader`, bounds-checked LE `ByteReader`, `decode_header`, `decode_define_brush`
- `data-drawing/sim/include/ddsim/sim.hpp` / `src/sim.cpp` - `class Sim`; `apply` commits only on `DD_OK`; `step` advances the tick; snapshot byte buffers
- `data-drawing/sim/src/hash.cpp` - `write_canonical`, `read_canonical` (strict inverse), `sha256_bytes` (only PicoSHA2 TU)
- `data-drawing/sim/include/ddsim/ddsim_c.h` / `src/ddsim_c.cpp` / `wasm/ddsim_wasm.cpp` - the flat C ABI, one-line forwards, Emscripten link root
- `data-drawing/sim/CMakeLists.txt` / `CMakePresets.json` / `cmake/forbidden_tokens.cmake` - targets `ddsim`, `ddsim_tests`, `ddsim_gen_fixtures`, `ddsim_wasm`; presets; the SIM-01 gate
- `data-drawing/sim/tests/*` - doctest main, `golden_support.hpp` (readFile, ByteWriter, `encodeDefineBrush`, fixture parsers, replay rule), `skeleton_test.cpp`, goldens
- `data-drawing/sim/tools/gen_fixtures/main.cpp` / `tools/wasm-hash-check.mjs` - fixture writer; Node replay checker
- `plugins/data-drawing/{tapestry.plugin.json,index.js,package.json,tsconfig.json}` - plugin package (workspace member)
- `plugins/data-drawing/surface/{vite.config.ts,vitest.config.ts,index.html,scripts/build-wasm.sh}` - library build with the wasm-as-file plugin; Node-env Vitest; dev page; wasm build+copy script
- `plugins/data-drawing/surface/src/{ddsim-abi.ts,ddsim-glue.d.ts,host-types.ts,sim-host.ts,sim.worker.ts,main.ts,dev-host.ts}` - ABI mirror and encoder, glue typings, `SurfaceHostLike`, `SimHost`/`WorkerTransport`, the worker, the panel surface, the stub host
- `plugins/data-drawing/surface/test/{fixture-replay.ts,wasm-golden.test.ts}` - shared fixture parser/replay; golden + encoder tests
- `.gitignore`, `package-lock.json` - build-output ignores; workspace entry

## Decisions Made

See `key-decisions` in the frontmatter. In short: constrained-template deletion for `fx64`; emsdk's own bundled Python for the bootstrap; worker-side DefineBrush encoding with `actionKind` on rejections; a build-only Vite plugin to keep `ddsim.wasm` a file in library mode and `surface.js` as the entry name; one C++ encoder shared by tests and `gen_fixtures`; requirements left to the shared-ID gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] emsdk refused to run on the system Python**
- **Found during:** Task 1
- **Issue:** `emsdk.py` requires Python >= 3.10; this Mac has only the Xcode CLT Python 3.9.6 and no other interpreter (no Homebrew python, pyenv, uv or conda).
- **Fix:** Downloaded the exact artifact emsdk's own manifest declares for macOS arm64 (`python-3.13.3-0-macos-arm64.tar.gz` from `storage.googleapis.com/webassembly/emscripten-releases-builds/deps/`) into `~/emsdk/python/3.13.3_64bit/`, the first path the `emsdk` wrapper probes. `emsdk install 6.0.10` then ran and itself re-installed the same `python-3.13.3-64bit` tool as an SDK dependency; `emsdk_env.sh` exports `EMSDK_PYTHON` to it. No Homebrew, no pip.
- **Files modified:** none in the repo
- **Verification:** `emcc --version` prints 6.0.10; the wasm preset builds.
- **Committed in:** n/a (toolchain outside the repo)

**2. [Rule 2 - Correctness] Deleted floating-point constructors without naming the forbidden keywords**
- **Found during:** Task 2
- **Issue:** The plan requires both deleted floating-point constructors on `fx64` and a gate that fails when either floating-point type keyword appears anywhere under `include/`; RESEARCH's `fx64(float) = delete;` example would trip the gate on its own header.
- **Fix:** `template <typename T, typename = std::enable_if_t<std::is_floating_point_v<T>>> fx64(T) = delete;` — rejects `float`, `double` and `long double`; `static_assert(!std::is_constructible_v<fx64, ...>)` and `!std::is_convertible_v` in `skeleton_test.cpp` prove it.
- **Files modified:** `data-drawing/sim/include/ddsim/fx64.hpp`, `tests/skeleton_test.cpp`
- **Verification:** gate reports 12 sim sources clean; static_asserts compile.
- **Committed in:** `688cc7b`

**3. [Rule 3 - Blocking] Vite library mode inlined the .wasm and named the entry `.mjs`**
- **Found during:** Task 3
- **Issue:** `vite build` with `build.lib` inlines every asset as a base64 data URL regardless of `assetsInlineLimit` (Vite 5 asset plugin: `if (config.build.lib) return true`), so `dist/` had no `.wasm` file and the worker chunk carried it twice (the `?url` import and the glue's own `new URL('ddsim.wasm', import.meta.url)` fallback). The entry was also emitted as `surface.mjs` because the package has no `"type": "module"`, which the host's `/\.c?js$/` entry check would reject.
- **Fix:** A build-only plugin `dd-wasm-as-file` in `vite.config.ts` (registered in both `plugins` and `worker.plugins`) resolves `ddsim.wasm?url` to an emitted asset (`import.meta.ROLLUP_FILE_URL_…`) and rewrites the glue's fallback to the same ref; `lib.fileName: () => 'surface.js'`.
- **Files modified:** `plugins/data-drawing/surface/vite.config.ts`
- **Verification:** `dist/assets/ddsim-*.wasm` present, worker chunk 11.6 kB with no `data:` URLs, single `new URL("ddsim-*.wasm", import.meta.url)`.
- **Committed in:** `ca01fbd`

**4. [Rule 3 - Blocking] Typings for the untyped Emscripten glue**
- **Found during:** Task 3
- **Issue:** `import createDdsim from '../wasm/ddsim.mjs'` has no declaration file, so `tsc --noEmit` fails under `strict`.
- **Fix:** Added `surface/src/ddsim-glue.d.ts` (`declare module '*/ddsim.mjs'` typed as `CreateDdsim` from `ddsim-abi.ts`). Not in the plan's file list.
- **Files modified:** `plugins/data-drawing/surface/src/ddsim-glue.d.ts`
- **Verification:** `npm run typecheck` passes.
- **Committed in:** `ca01fbd`

**5. [Rule 1 - Bug] Message discriminator collided with `DdError.kind`**
- **Found during:** Task 3
- **Issue:** The plan's `rejected { id, code, name, kind }` message reuses `kind` for the action kind, but `kind` is the message discriminator of the worker protocol, so the union could not type-check.
- **Fix:** The outbound message carries `actionKind`; `DdError.kind` (the interfaces-block name) is unchanged on the SimHost side.
- **Files modified:** `sim-host.ts`, `sim.worker.ts`
- **Verification:** typecheck; dev page shows `rejected: DD_ERR_…` paths compile and the second define resolves.
- **Committed in:** `ca01fbd`

### Design choices within the plan's contract (not deviations from must-haves)

- The worker encodes `DefineBrush` from a `spec` (`defineBrush { id, spec }`) and assigns `brush_count + 1`, rather than the main thread sending pre-encoded `bytes`: the worker is the recorder and the only place the count is authoritative, and it avoids a version-id race between concurrent calls. `encodeDefineBrush(spec, versionId)` still lives in `ddsim-abi.ts` and is proven byte-identical to the C++ encoder.
- `@types/node` was added to the plugin's devDependencies (hoisted at 20.19.43, no download) because the golden test reads fixtures with `node:fs`.
- `gen_fixtures` includes `tests/golden_support.hpp` for the encoder instead of carrying a private copy.
- Ninja is not installed, so the presets use `Unix Makefiles` (the plan allowed either).

---

**Total deviations:** 5 auto-fixed (1 bug, 1 correctness, 3 blocking). **Impact on plan:** all necessary to satisfy the plan's own must-haves (gate over `include/`, a `.wasm` file in `dist/`, `surface.js` entry, strict typecheck); no scope creep.

## Issues Encountered

- doctest cannot decompose expressions with two binary operators (`x == 5 << 16`, `a && b` inside `REQUIRE_MESSAGE`); rewritten with parentheses / a local bool.
- patchright (the headless driver) evaluates in an isolated world, so `window.__dd` was invisible to `page.evaluate`; the observation script injects an inline `<script>` that writes JSON into the DOM instead. Purely a test-harness matter.
- Vite prints `Module "node:module" has been externalized for browser compatibility` for the glue's guarded Node branch at build time; harmless (the branch never runs in the browser; the same glue runs in Node for Vitest).

## Known Stubs

Intentional skeleton stubs, each with the plan that fills it; none prevents this plan's goal:

| Stub | File | Resolved by |
|---|---|---|
| `dd_step()` advances the tick and runs no rules; stroke kinds 2-4 return `DD_ERR_UNKNOWN_KIND` | `data-drawing/sim/src/sim.cpp` | 01-05 |
| `fx64` has no multiply/divide/sqrt; `Xoshiro256ss` has no `next()`/streams | `fx64.hpp`, `rng.hpp` | 01-03 |
| `activate()` registers nothing; manifest has no `surfaces` entry | `plugins/data-drawing/index.js`, `tapestry.plugin.json` | 01-06 (after 01-02) |
| The surface is a monospace panel, not a stage; `SurfaceHostLike` stands in for the SDK type | `surface/src/main.ts`, `host-types.ts` | 01-06, 01-07 |

## User Setup Required

None - no external service configuration required. (`~/emsdk` is installed; `source ~/emsdk/emsdk_env.sh` or `npm --prefix plugins/data-drawing run sim:wasm` finds it.)

## Next Phase Readiness

- Ready for 01-02 (SDK surface contribution) and 01-03 (full `fx64` op set, UBSan preset, two-process goldens); both build on the committed headers and presets without changing the walk.
- SIM-01/02/03 stay unchecked in REQUIREMENTS.md by design until 01-03, 01-05 and 01-08 finish (shared-ID gate).
- A human look at the dev page is optional (everything asserted here was measured headlessly): `npm --prefix plugins/data-drawing run sim:wasm && npm --prefix plugins/data-drawing run dev`, then http://localhost:5173/.

---
*Phase: 01-painting-with-the-pen*
*Completed: 2026-09-23*

## Self-Check: PASSED

All 43 created files and 2 modified files exist on disk; commits 5879d1f, 688cc7b and ca01fbd are in history.
