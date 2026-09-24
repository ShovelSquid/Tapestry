# Stack Research

**Domain:** Deterministic fixed-point 3D particle simulation with a pressure-pen painting frontend, hosted as a Tapestry plugin inside an Electron/TypeScript renderer on macOS Apple silicon
**Researched:** 2026-09-22
**Confidence:** MEDIUM overall (versions HIGH; runtime behaviour claims MEDIUM; two items LOW and flagged)

Fixed and out of scope for this document: the Tapestry kernel (C++20, CMake 3.24+, doctest v2.5.3 vendored, `.tree` journal with SHA-256 chained commits via vendored PicoSHA2), the Electron app (`app/`), the plugin SDK (`sdk/`), and the plugin host (`app/src/main/plugin-host.ts`). Everything below is what goes *around* them.

## The Five Decisions in One Table

| Question | Decision | Confidence |
|---|---|---|
| 1. Sim core numerics and build | In-house `fx64` Q32.32 type on `int64_t` with a portable 64x64->128 multiply (no `__int128` on the hot path), one C++20 static library `ddsim` with zero dependencies, doctest v2.5.3 (already vendored), state hash = SHA-256 over a canonical little-endian byte layout via the same vendored PicoSHA2 the kernel uses | MEDIUM |
| 2. Painting surface renderer | three.js r186 (`three/webgpu` `WebGPURenderer`, automatic WebGL 2 fallback) inside the renderer, camera-facing `PlaneGeometry` raycast for stroke placement, `InstancedMesh`/`Points` placeholder node renderer. Not native Metal, not raw WebGL | MEDIUM-HIGH |
| 3. Pen input | W3C Pointer Events only: `pointerType === 'pen'`, `pressure`, `tiltX/Y`, `twist`, `tangentialPressure`, `getCoalescedEvents()` for recording, `getPredictedEvents()` for preview only. No native tablet addon. Chromium's macOS builder maps NSEvent tablet data to all of these (verified in source) | HIGH for the mapping, MEDIUM for latency |
| 4. Bridge | The **same** C++ compiled two ways from one `extern "C"` header: (a) Emscripten 6.0.10 WASM running in a Web Worker inside the renderer as the live sim for the plugin (fits the public SDK, no native build to try the plugin); (b) cmake-js 8 + node-addon-api 8.9 N-API addon for CTest, a headless replay/hash CLI, and the native-vs-wasm hash cross-check. Snapshots move worker->main via transferred `ArrayBuffer`s; no `SharedArrayBuffer` | MEDIUM |
| 5. Fixed-point patterns | Q32.32; integer digit-by-digit `isqrt`; xoshiro256** seeded through splitmix64 with per-action derived streams; no trig in the core (store directions as vectors); `-fwrapv` and UBSan in tests; canonical serialization sorted by stable id | MEDIUM-HIGH |

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| C++20 static library `ddsim` | C++20, CMake >= 3.24 (machine has CMake 4.4.1) | Authoritative fixed-point, fixed-timestep node simulation; pure module | Matches the kernel toolchain already in the repo; integer-only C++ is the one language that compiles bit-identically to both a native addon and WASM. Zero third-party runtime dependencies keeps it "engine-independent" by construction |
| In-house `fx64` (Q32.32 on `int64_t`) | project code | All authoritative arithmetic | Q16.16 (range +/-32768, resolution 1.5e-5) is too small for a 3D world with scale bands; Q32.32 gives +/-2.1e9 range and 2.3e-10 resolution. The needed op set (add, sub, mul, div, sqrt, min/max/abs/clamp, lerp) is ~300 lines; owning it lets you delete every float constructor so a float can never enter the authoritative path, and lets you implement multiply with four 32x32->64 products so native and wasm run the identical instruction sequence (Emscripten lowers `__int128` through compiler-rt `__multi3`, which is 2-7x slower in wasm and a second code path to trust) |
| `fpm` (MikeLankamp) | v1.1.0 tag (2021), repo last pushed 2026-03, MIT, header-only, C++11 | **Reference and test oracle only**, plus polynomial trig/exp/log if a material ever needs them | Verified from source: `fixed<int64_t, __int128, 32>` passes its static_asserts; `sqrt` is integer digit-by-digit; `math.hpp` contains no `float`/`double`. But its constructors convert from float with real floating arithmetic, so it must not be the authoritative type. Use it in `ddsim_tests` to cross-check `fx64` results |
| PicoSHA2 (single header, MIT) | same copy the kernel vendors in `tapestry/kernel/Digest.cpp` | State hashing for replay verification | The kernel already hashes commits with SHA-256 and writes 64-hex digests into `.tree`; using the same algorithm means a person can verify a recorded state hash with `shasum -a 256` on the canonical bytes. Vendoring the header (not linking the kernel) keeps `ddsim` dependency-free |
| xoshiro256** + splitmix64 | public-domain reference C (Vigna/Blackman, 2019) | Seeded randomness | 2^256-1 period, passes BigCrush, integer-only, trivially embeddable, state is four `uint64_t` (hashable and serializable). splitmix64 expands a 64-bit seed into state and derives per-action sub-seeds |
| doctest | v2.5.3 (latest, 2026-07-06; already vendored in `tapestry/third_party/doctest`) | `ddsim_tests` | Already in the repo; CTest discovery scripts present |
| Emscripten (emsdk) | 6.0.10 (latest, 2026-09-21). **Not installed**: Apple clang 14.0.3 on this Mac has no `wasm32` target | WASM build of `ddsim` for the renderer worker and for Node tests | WebAssembly integer instructions are fully specified with no implementation-defined behaviour, so integer-only C++ is bit-identical native vs wasm. Emscripten's compiler-rt ships `__multi3`, `__udivti3`, `ashlti3`, `lshrti3` so `__int128` compiles today (the 2017 issue #5630 is obsolete), but see the portable multiply note above |
| node-addon-api + cmake-js | node-addon-api 8.9.2 (app has ^8), cmake-js 8.0.0 (app has ^7.3; v8 needs Node >= 20.17, machine has 20.20.2) | `ddsim.node` N-API addon for CTest/CLI/cross-check and a future utility-process host | Same pattern as `app/native/addon.cpp` already used for the kernel; Node-API is ABI-stable across Electron/Node versions |
| three.js | 0.186.0 / r186 (2026-09-08), MIT; `@types/three` 0.186.0 (three ships no `types` field) | Painting scene, camera-facing plane, node field placeholder renderer | `three/webgpu` export verified; `WebGPURenderer` tries WebGPU first and falls back to WebGL 2 with a warning (`forceWebGL: true` for testing). One codebase, TSL shaders compile to WGSL or GLSL. Gives you orbit controls, raycasting, instancing and a path to compute shaders for the later render tier without writing a GPU abstraction |
| WebGPU (via three) | Chromium-provided; Electron 32.3.3 = Chromium 128, WebGPU shipped by default on macOS in Chrome 113 | GPU backend | Available on macOS without flags in every Electron >= 25; `enable-unsafe-webgpu` is a Linux concern. Storage buffers and compute matter for the render milestone; WebGL 2 remains the safety net |
| Pointer Events (W3C Level 3) | Chromium built-in | All pen input | Chromium `components/input/web_input_event_builders_mac.mm` sets `force=[event pressure]`, `tilt_x=tilt.x*90`, `tilt_y=(isFlipped?1:-1)*tilt.y*90`, `tangential_pressure`, `twist=[event rotation] mod 360` for `NSEventSubtypeTabletPoint`, and pen pointer type via tablet proximity. No native tablet SDK needed |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@webgpu/types` | 0.1.74 (2026-09-19) | TS typings for `navigator.gpu` | Only when touching WebGPU directly (adapter feature checks, compute later); three's own typings cover the renderer |
| `three/addons` `OrbitControls`, `TransformControls` | ships with three r186 | Orbit camera; move the painting plane | From day one for "camera can orbit, plane can be moved" |
| BLAKE3 C | 1.8.7 (2026-08-20), CC0/Apache-2.0, NEON via `BLAKE3_USE_NEON=1` | Faster per-tick hashing | **Defer.** Only if hashing every tick becomes measurable; keep recorded hashes SHA-256 so `.tree` stays verifiable with one algorithm |
| pcg-cpp | v0.98.1 (Apache-2.0/MIT) | Alternative PRNG with 2^63 selectable streams | Only if you want many independent streams keyed by id without a hash-derive step; xoshiro + splitmix derive covers it |
| Vitest | app pins 2.1.9 (latest 5.0.1) | TS tests for the plugin and the wasm/native hash cross-check | Stay on the app's pinned line; do not add a second test runner |
| electron-vite / Vite | app pins electron-vite ^2.3 / vite ^5.4 (latest 5.0.0 / 8.3.0; electron-vite 4.x and 5.x peer `vite ^5||^6||^7`, Node ^20.19||>=22.12) | Bundling the plugin's renderer component and worker | Use the app's existing pipeline; a `.wasm` asset and a `new Worker(new URL(...))` are both supported by Vite 5 |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| emsdk | Provides `emcc` | `git clone emsdk && ./emsdk install 6.0.10 && ./emsdk activate 6.0.10`; pin the exact version in `data-drawing/sim/CMakePresets.json` and in the `.tree` version pin, because a toolchain change is a "pinned version" in the core value statement |
| CMake presets | `native` (Apple clang), `wasm` (`-DCMAKE_TOOLCHAIN_FILE=$EMSDK/.../Emscripten.cmake`), `addon` (via cmake-js) | Same `ddsim` target in all three; only the thin ABI wrappers differ |
| CTest + a `ddsim_replay` CLI | Replay a recorded action log headlessly and print the tick/state hash | This is the tool a person uses to verify "same file, same seed, same hash"; make it a milestone-1 deliverable |
| UBSan (`-fsanitize=undefined`) in `ddsim_tests` | Catch signed overflow before it becomes nondeterminism | Signed overflow is UB; the native optimizer and the wasm optimizer may exploit it differently. Compile the core with `-fwrapv` everywhere and treat any UBSan hit as a bug |
| Chrome DevTools `about:gpu` inside Electron | Confirm the WebGPU adapter and Metal backend on the M4 | First thing to check in the feasibility spike |

## Installation

```bash
# Native toolchain (kernel already builds; cmake 4.4.1 and Apple clang 14 present)
# Sim core: no packages. Vendor into data-drawing/sim/third_party:
#   - fpm v1.1.0 (tests only), xoshiro256starstar.c + splitmix64.c (public domain),
#   - picosha2.h (copy the kernel's vendored header, do not link the kernel)

# WebAssembly toolchain (not installed on this Mac)
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install 6.0.10 && ~/emsdk/emsdk activate 6.0.10

# Renderer side (inside the Tapestry npm workspace, plugin package plugins/data-drawing)
npm install three@0.186.0
npm install -D @types/three@0.186.0 @webgpu/types@0.1.74

# Addon build (reuse the app's pattern; bump cmake-js only if the app does)
npm install -D node-addon-api@^8.9 cmake-js@^8.0
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| In-house `fx64` Q32.32 | `fpm::fixed<int64_t, __int128, 32>` as the authoritative type | If you accept the risk that a float constructor is one typo away from the authoritative path and that wasm `__int128` goes through compiler-rt. Reasonable for a throwaway prototype, not for the core |
| In-house `fx64` | CNL (johnmcfarlane/cnl) v1.1.2 (2020; last push 2024; experimental SG14) | Never for this project: broader type algebra, few math functions, stale |
| Fixed-point | Controlled floats a la Box2D v3.1 (`-ffp-contract=off`, no fast-math, custom `sinf/cosf/atan2f`, keep `sqrtf`; verified bit-identical M2 vs Ryzen across MSVC/GCC/Clang) | Only if the fixed-point core proves too slow **and** you are prepared to verify wasm-vs-native float identity yourself (Box2D does not claim wasm). The brief, `semantic-world`, and PROJECT.md all already chose fixed-point; Tapestry Phase 3's "numeric compatibility envelope" wording should be tightened to match rather than the sim loosened |
| xoshiro256** | PCG32 | If you want cheap independent streams by stream id and are fine with a 2^64 period per stream |
| SHA-256 (PicoSHA2) | BLAKE3 C 1.8.7 | If profiling shows per-tick hashing dominates; still record SHA-256 in `.tree` |
| three.js `WebGPURenderer` | Raw WebGPU + `wgpu-matrix` 3.4.2 | Only for the later diffusion render tier if three's compute path proves limiting. Not for milestone 1 |
| three.js `WebGPURenderer` | Native Metal in a Node addon rendering to an IOSurface | No. There is no standard way to import a native Metal texture into WebGPU; Electron's shared-texture API is tied to offscreen rendering, and it would force the renderer out of the plugin SDK. See "What NOT to Use" |
| WASM sim in a renderer Web Worker | N-API addon in an Electron `utilityProcess` (Node env, MessagePort to renderer, documented for "CPU intensive tasks") | When the Tapestry SDK gains a way for a plugin to host background work; until then a plugin has no Electron access (PLUG-03) and cannot spawn processes. Build the addon now so the switch is a host change, not a sim change |
| WASM sim in a Web Worker | WASM sim on the renderer main thread | Never past the first spike: the sim must be out of the render thread so pen sampling and three.js frames never wait on a tick |
| Transferred `ArrayBuffer` snapshots | `SharedArrayBuffer` + `Atomics` | Only if copying snapshots each frame is measurable. SAB needs `crossOriginIsolated` (COOP+COEP); `loadFile`/`file://` cannot set headers (electron#31789), so it would require a custom protocol with headers |
| Pointer Events | Native tablet addon (Wacom SDK / NSEvent hooks) | No evidence it is needed on macOS; Chromium already forwards pressure, tilt, twist, tangential pressure. Revisit only if the spike shows missing eraser detection or proximity events |
| Electron 32.3.3 (as pinned by the app) | Electron 44.4.3 (Chromium 152, Node 24.21) | Recommend the app upgrade: Electron supports the latest three majors (42-44), so 32 is out of support and misses two years of Pointer Events, WebGPU and IOSurface fixes. Not this project's call, but note it in the roadmap |
| TypeScript 5.9.3 (installed) | TypeScript 7.0.2 (latest) | Stay on the app's 5.9 line; TS 7 is the new native compiler and the workspace tooling has not been validated against it |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| OpenGL 4.3 compute (the `chrono_magnetic_particles` path) | macOS is frozen at OpenGL 4.1; no compute shaders through OpenGL on this Mac | WebGPU via three.js; Metal is reachable only through WebGPU/Dawn in the renderer |
| `float`/`double` anywhere in `ddsim` | One bit of drift at tick 10 is a different painting at tick 10,000; cannot be retrofitted. Also x87/SSE/NEON/wasm differ in low bits | `fx64`; add a CI grep that fails on `float|double` in `sim/src` |
| `__int128` on the hot multiply path | Second code path (compiler-rt) in wasm, 2-7x slower, and Emscripten's builtins are a different implementation than the native instruction | Four 32x32->64 partial products (Hacker's Delight `mulhs`), identical on every target |
| `std::unordered_map`/`unordered_set` iteration in the sim | Iteration order differs between libc++ versions and native vs wasm; the classic lockstep desync cause | `std::vector` sorted by stable id, `std::map`, or index-based arenas |
| `std::sort` with ties, `std::rand`, `<random>` distributions | Unstable ordering; `std::uniform_int_distribution` and friends are implementation-defined | `std::stable_sort` on unique keys; own xoshiro + own integer range mapping (Lemire's multiply-shift on 64-bit) |
| Signed overflow left as UB | Native and wasm optimizers may differ | `-fwrapv` and explicit saturation; UBSan in tests |
| The canvas `desynchronized` hint for latency | Shipped in Chrome 75 for ChromeOS and Windows only; a Feb-2025 chromium graphics-dev proposal to enable it on Mac was deprioritized (IOSurface non-copy-on-write). On macOS it is a no-op | Coalesced events for recording, predicted events for the preview tail, cheap frames at display rate (120 Hz ProMotion), and never blocking the render thread on the sim |
| Recording `getPredictedEvents()` samples into actions | They are guesses; replay must use recorded outcomes | Record only coalesced (real) samples; predicted points feed the transient preview stroke |
| Storing raw `pressure` floats in actions | Pen pressure arrives as a float; storing it unquantized puts a float into the readable journal and the sim | Quantize at the plugin boundary to an integer (e.g. 0..65535) and record that integer in the action |
| `SharedArrayBuffer` in the first cut | Requires COOP/COEP; `file://` cannot set headers | Transfer `ArrayBuffer` snapshots (zero-copy move) |
| Wall clock or `performance.now()` inside the sim | Nondeterministic | Tick number only; the sim host assigns each action the tick it is applied at and records it |
| Electron-specific APIs in the plugin | Violates PLUG-03 and the "same public API as any third-party plugin" constraint | Web Worker + WASM + SDK `kernel.submit`; the native addon is a dev/test tool, not a plugin dependency |
| Wacom driver < 6.4.13 on macOS 26 | macOS 26.0-26.2 had a pen-click bug; Apple fixed it in 26.3 and Wacom 6.4.13 removed the workaround (this Mac is on 26.6.2) | Wacom driver 6.4.13 or newer |
| Electron `--enable-unsafe-webgpu` on macOS | Not needed; WebGPU is default on macOS since Chromium 113 | Feature-detect `navigator.gpu` and let three fall back |

## Stack Patterns by Variant

**If the WASM sim proves too slow for the target node count in the worker:**
- Move `ddsim.node` into an Electron `utilityProcess` and hand the plugin a `MessagePort` through a new SDK contribution (this is a host/SDK change to plan, not a sim change).
- Because both builds share `ddsim_c.h` and the snapshot byte layout, the worker script becomes the process client with no plugin logic change.

**If a material needs trigonometry (angles rather than vectors):**
- Vendor `fpm`'s polynomial `sin/cos/atan2` instantiated on the same Q32.32 layout, wrap them behind `fx64`, and add golden-value tests. Do not call `<cmath>`.

**If per-tick hashing shows up in profiles:**
- Hash only dirty regions per tick with BLAKE3 (tree-hashable), and still record a SHA-256 of the whole canonical state at recorded checkpoints so `.tree` stays verifiable with `shasum`.

**If WebGPU is unavailable (VM, remote session, old GPU driver):**
- three's `WebGPURenderer` already falls back to WebGL 2; the placeholder renderer must not depend on compute or storage buffers so the fallback stays functional.

**If the app upgrades Electron (recommended, 32 is out of support):**
- Rebuild `ddsim.node` against the new ABI with cmake-js (`--runtime=electron --runtime-version=<ver>`); node-addon-api keeps the source unchanged. The wasm build is unaffected.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| electron 32.3.3 (Chromium 128, Node 20.18.1) | three 0.186.0 `WebGPURenderer` | WebGPU on macOS since Chromium 113; verify adapter in `about:gpu`. Electron 32 is outside the supported window (42-44 as of 2026-09-18) |
| electron 32.3.3 | Pointer Events L3 (`getCoalescedEvents`, `getPredictedEvents`, `altitudeAngle/azimuthAngle`) | All present in Chromium 128 |
| cmake-js 8.0.0 | Node ^20.17 or >= 22.9 | Machine Node 20.20.2 OK; app currently pins ^7.3 (still fine) |
| node-addon-api 8.9.2 | Node ^18, ^20, >= 21; Electron via `NAPI_VERSION` | Same as the kernel addon |
| electron-vite 2.x / vite 5.4.21 (app) | worker bundling (`new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })`) and `.wasm` assets | Supported in Vite 5; if the app moves to electron-vite 4/5 it needs Vite 5-7 and Node >= 20.19 |
| Emscripten 6.0.10 | CMake 4.4.1 via `Emscripten.cmake` toolchain file; C++20 | `-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node` so the same `.wasm`/glue loads in the renderer worker and in Node tests |
| doctest v2.5.3 | CMake 4.4.1 | Already vendored with `doctest.cmake` discovery |
| @types/three 0.186.0 | three 0.186.0 | Keep the two in lockstep; three ships no `types` field |
| TypeScript 5.9.3 | @types/three 0.186.0, @webgpu/types 0.1.74 | Fine; do not move to TS 7 without validating electron-vite/vitest |

## Recommended Layout (stack-level, for the roadmap)

```
data-drawing/
  sim/                      # ddsim: C++20, no deps, CMake presets native | wasm | addon
    include/ddsim/fx64.hpp  # Q32.32, deleted float ctors, portable mulhi
    include/ddsim/ddsim_c.h # extern "C" ABI shared by addon and wasm
    src/                    # state, actions, tick, canonical serialize, sha256 hash
    third_party/            # picosha2.h, xoshiro256starstar.c, splitmix64.c, fpm (tests only)
    tests/                  # doctest: replay determinism, hash goldens, fx64 vs fpm oracle
    tools/ddsim_replay/     # CLI: replay action log -> tick hashes
  plugins/data-drawing/     # Tapestry plugin: React node view + sim.worker.ts + ddsim.wasm
  addon/                    # cmake-js ddsim.node (tests, CLI host, future utilityProcess host)
```

## Sources

- npm registry (2026-09-22): `electron` 44.4.3, `three` 0.186.0 (exports `./webgpu`, `./tsl`; no `types`), `@types/three` 0.186.0, `node-addon-api` 8.9.2, `cmake-js` 8.0.0 (engines node ^20.17), `@webgpu/types` 0.1.74, `electron-vite` 5.0.0 (peers vite ^5||^6||^7), `vite` 8.3.0, `typescript` 7.0.2, `vitest` 5.0.1 — HIGH
- https://releases.electronjs.org/releases.json — Electron 32.3.3 = Chromium 128.0.6613.186 / Node 20.18.1; 42.11.6, 43.7.3, 44.4.3 current lines; https://www.electronjs.org/docs/latest/tutorial/electron-timelines — "latest three stable major versions are supported" — HIGH
- GitHub releases: BLAKE3 1.8.7, Emscripten 6.0.10, doctest v2.5.3, Box2D v3.1.1, three.js r186, cmake-js v8.0.0; tags: fpm v1.1.0, CNL v1.1.2, pcg-cpp v0.98.1 — HIGH
- https://raw.githubusercontent.com/chromium/chromium/main/components/input/web_input_event_builders_mac.mm — NSEventSubtypeTabletPoint -> force/tilt/tangential_pressure/twist mapping — HIGH
- https://raw.githubusercontent.com/mrdoob/three.js/r186/src/renderers/webgpu/WebGPURenderer.js — WebGPU-first, WebGL 2 fallback, `forceWebGL` — HIGH
- https://raw.githubusercontent.com/MikeLankamp/fpm/master/include/fpm/fixed.hpp and math.hpp — static_asserts, integer sqrt, float conversions in ctors — HIGH
- https://raw.githubusercontent.com/emscripten-core/emscripten/main/system/lib/compiler-rt/lib/builtins/{multi3,udivti3,ashlti3,lshrti3}.c exist (HTTP 200) — 128-bit builtins present — MEDIUM (existence verified, not compiled here)
- https://box2d.org/posts/2024/08/determinism/ — controlled-float determinism approach and its limits — HIGH for what it claims
- https://groups.google.com/a/chromium.org/g/graphics-dev/c/20qDm3ZD2f8 — Mac canvas low-latency mode deprioritized — HIGH; https://developer.chrome.com/blog/desynchronized — ChromeOS/Windows only — HIGH
- https://www.electronjs.org/docs/latest/tutorial/process-model and /api/utility-process — utility process is a Node env for CPU-intensive work, MessagePorts to renderers; sandboxed renderers have no `require` — MEDIUM
- https://github.com/electron/electron/issues/41763 — WebGPU adapter works on macOS/Windows in Electron; Linux is the problem case — MEDIUM
- https://github.com/electron/electron/issues/31789 — SharedArrayBuffer unavailable under `loadFile` — MEDIUM
- https://developer.chrome.com/blog/webgpu-release — WebGPU default in Chrome 113 on macOS — HIGH
- https://webassembly.github.io/spec/core/exec/numerics.html — integer ops fully specified — HIGH
- https://prng.di.unimi.it/ — xoshiro256**/splitmix64 recommendation — HIGH
- https://support.wacom.com/hc/en-us/articles/40071370866199 — macOS 26.0-26.2 pen-click bug, fixed in 26.3 / driver 6.4.13 — MEDIUM
- Local evidence: `app/native/CMakeLists.txt` (kernel as N-API addon, cmake-js), `app/src/main/index.ts` (`sandbox: true`, `contextIsolation: true`), `sdk/src/contributions.ts` (React components by name, commands via `kernel.submit`), `plugins/example-plugin/index.js` (PLUG-03: no Electron access), `tapestry/kernel/Digest.hpp` (PicoSHA2, 64-hex digests), machine: Apple M4, macOS 26.6.2, Node 20.20.2, CMake 4.4.1, Apple clang 14.0.3 (no wasm32 target), no emcc — HIGH

### Open items flagged LOW confidence

- Eraser-end detection on macOS in Chromium (`button === 5` / `pointerType` for eraser) was not verified; check in the pen spike.
- Real-world pen-to-ink latency inside a sandboxed Electron renderer on this M4 was not measured; the spike must record it with and without the worker split.
- `pointerrawupdate` availability/behaviour under Electron 32 was not verified.

---
*Stack research for: Data Drawing (deterministic fixed-point sim + pen painting plugin)*
*Researched: 2026-09-22*
