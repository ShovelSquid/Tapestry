# Walking Skeleton — Data Drawing

**Phase:** 1
**Generated:** 2026-09-22

## Capability Proven End-to-End

> A plugin dev page shows a live tick counter and SHA-256 state hash coming from the `ddsim` C++20 fixed-point sim compiled to WebAssembly and stepping at 60 Hz inside a Web Worker; submitting one `DefineBrush` action from the page changes that hash to exactly the value the native CTest build prints for the same action at the same tick.

That is the thinnest path through every layer Phase 1 touches: C++ sim → canonical byte walk + SHA-256 → flat C ABI → Emscripten Wasm → module Worker → `SimHost` → a page. One action applied (`DefineBrush`), one snapshot read back (tick, node count, hash). Plans 01-03 through 01-08 expand it; none may change its architectural decisions.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sim core language and build | C++20 static library `ddsim` at `data-drawing/sim/`, CMake >= 3.24 with presets `native-debug`, `native-release`, `native-ubsan`, `wasm-release`; zero runtime dependencies (PicoSHA2 vendored, doctest test-only from `tapestry/third_party/doctest`) | Same toolchain as the kernel; integer-only C++ is what compiles bit-identically native and Wasm (CLAUDE.md decision 1) |
| Authoritative numerics | In-house `fx64` Q32.32 on `int64_t`, portable four-partial-product multiply, floor rounding everywhere, `-fwrapv` on every target, deleted floating-point constructors, `cmake/forbidden_tokens.cmake` as a CTest test and configure-time check | One bit of drift at tick 10 is a different painting at tick 10,000; cannot be retrofitted (SIM-01) |
| Time | `DD_TICK_HZ = 60` compile-time constant; `dd_step()` takes no arguments; the host's accumulator decides only how many whole steps run | Roadmap "Pin the tick rate (60 Hz recommended)"; ticks-per-frame invariance falls out of a zero-argument step |
| Randomness | xoshiro256** seeded through splitmix64; per-entity streams derived as `splitmix64(seed ^ purpose ^ entity)`; PRNG state in the hash | Integer-only, 4 x u64 state, serializable (CLAUDE.md decision 5) |
| Identity | `NodeId` u64 = `branch(8) \| stroke ordinal(32) \| emission index(24)`; `StrokeId` = `branch << 32 \| ordinal`; never a counter | STRK-03; branch tag reserved for Tapestry Phase 3 (`b2.n12` rule in FORMAT.md) |
| State hashing | One `write_canonical()` explicit little-endian byte walk (magic `DDS1`, version pins, tick_hz, seed, tick, brushes, rng, active strokes, nodes ascending by id); `hash()` = SHA-256 over exactly those bytes; `serialize()` returns them; `restore()` is the strict inverse (reject, never clamp) | SIM-02; goldens are `.sha256` files a person can check with `shasum -a 256` |
| Bridge | `extern "C"` ABI `ddsim_c.h` (`dd_create/dd_destroy/dd_apply/dd_step/dd_tick/dd_hash/dd_serialize/dd_restore/dd_nodes_ptr/dd_node_count/dd_node_stride/dd_body_ptr/dd_body_count/dd_body_stride`); integers only cross it; Emscripten 6.0.10 pinned, `-sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker,node`, output `ddsim.mjs` + `ddsim.wasm` | SIM-03; the same source runs in Node (Vitest goldens) and in the renderer Worker |
| Action grammar (in-memory, Phase 1) | `u8 kind \| u8 version=1 \| u16 reserved \| u32 payload_len \| payload`; kinds 1 DefineBrush, 2 StrokeBegin, 3 StrokeSamples, 4 StrokeEnd; plane coordinates cross as i32 Q16.16 and widen to Q32.32 in the sim | Phase 2 renders this grammar as readable `.tree` text; nothing is on disk in Phase 1 so the encoding is free to change |
| Host | `SimHost` (async, transport-agnostic) over a module Worker; the worker is the recorder: it stamps `(tick, index)` at record time with its own `dd_tick()`, applies at the start of that tick before physics, appends to the session log; snapshots are `HEAPU8.slice()` copies transferred as `ArrayBuffer`s between steps; no `SharedArrayBuffer` | Roadmap wave 3; live optimistic state equals replay by construction |
| Surface delivery | Tapestry `SurfaceContribution` (SDK) + privileged `tapestry-plugin://<plugin-id>/<path>` scheme + `PluginSurfaceLayer` full-window stage layer in the outer app; the data-drawing plugin ships `surface/dist/surface.js` built by Vite 5 library mode (`es`, `worker.format: 'es'`) | CANV-04; first-party plugins use the same public API as third-party (outer CLAUDE.md); a surface compiled into the app is not acceptable |
| Renderer | three.js 0.186.0 `WebGPURenderer` from `three/webgpu` with `forceWebGL` as a first-run switch; one renderer per surface; `setAnimationLoop(null)` → traverse-dispose → `renderer.dispose()` → `renderer.forceContextLoss()` on unmount; idempotent for StrictMode | CLAUDE.md decision 2; spike-findings context-lifetime rules |
| Pen input | Native (non-React) Pointer Events listener, `setPointerCapture`, `touch-action: none`, paint on `pointerType === 'pen' && (buttons & 1)` (mouse behind a setting), `getCoalescedEvents()` recorded, `getPredictedEvents()` preview only; quantized once at the fence: u/v i32 Q16.16, pressure u16 0..65535 (provisional), tilt i8 degrees, twist u16 degrees | CLAUDE.md decision 3; CANV-02/STRK-01/STRK-06 |
| Directory layout | `data-drawing/sim/{include/ddsim,src,wasm,tests,tools,cmake,third_party}` and `plugins/data-drawing/{tapestry.plugin.json,index.js,package.json,surface/{src,test,scripts,index.html,vite.config.ts,vitest.config.ts}}` | RESEARCH.md § Recommended Project Structure |

## Stack Touched in Phase 1

- [ ] Project scaffold — `sim/CMakeLists.txt`, `CMakePresets.json`, forbidden-token gate, doctest under CTest; `plugins/data-drawing/package.json`, Vite 5 lib build, Vitest 2.1.9 (plan 01-01)
- [ ] Routing — the plugin surface is reached through `tapestry-plugin://data-drawing/surface/dist/surface.js` and opened from the Surfaces launcher in Tapestry (plans 01-02, 01-04, 01-06)
- [ ] "Database" (this project has none) — one real write: `DefineBrush` applied through `dd_apply`; one real read: a transferred snapshot (tick, node bytes, body bytes) plus `dd_hash` (plan 01-01)
- [ ] UI — the dev page's "Define brush" button submits an action and the tick/hash panel reflects it (plan 01-01); pen painting on the three.js stage (plans 01-06, 01-07)
- [ ] Deployment — documented local full-stack run: `npm --prefix plugins/data-drawing run sim:wasm && npm --prefix plugins/data-drawing run dev` (dev page), and `npm --prefix plugins/data-drawing run build && npm --prefix app run dev` (inside Tapestry)

## Out of Scope (Deferred to Later Slices)

- `.tree` writing, save/open, the sample-block grammar, kernel commits, `getNextIds()` ordinal prediction — Phase 2
- Settle rule (SIM-04), dead zone and finish line (STRK-05) — Phase 2
- Transport UI (play/pause/step/speed), scrubber, reopen hash verification, erase, undo, inspector — Phase 3
- Orbit camera and movable plane (CANV-05), tilt-driven parameters (CANV-06) — v2
- N-API `addon` preset, native-vs-Wasm CI test (SIM-05), replay oracle over `.tree` (SIM-06) — v2 / deferred
- `SharedArrayBuffer`, `pointerrawupdate` as the recording path, any frontend smoothing — never in this milestone

## Subsequent Slice Plan

Each later slice adds capability on top of this skeleton without altering its architectural decisions:

- 01-02 / 01-04: the outer host extension point (SDK `SurfaceContribution`, scheme, stage layer) proven by the example plugin's surface
- 01-03: real fixed-point numerics, PRNG streams, UBSan, replay CLI, two-process and Debug/Release goldens
- 01-05: stroke actions, spring-damper brush body, emission with stable ids, versioned presets, synthetic-stroke goldens
- 01-06: pen measurement on this Mac, then the deterministic fence with the measured constants
- 01-07: three.js stage, colour-by-description, cursor overlay, brush picker and versioning, live painting in the dev page
- 01-08: the surface mounted inside Tapestry, replay-from-zero equality, latency with and without the Worker, feel verification
- Phase 2: readable journal; Phase 3: timeline and marks
