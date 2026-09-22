# Phase 1: Painting with the Pen - Research

**Researched:** 2026-09-22
**Domain:** Deterministic fixed-point C++20 sim (native + Emscripten Wasm in a Web Worker), Tapestry plugin host surface extension (CANV-04), Pointer Events pen capture on macOS/Chromium 128, three.js placeholder renderer
**Confidence:** MEDIUM overall — everything about the outer Tapestry codebase and this machine is HIGH (read from source / probed this session); Chromium pen mapping and Emscripten flags are MEDIUM (official sources fetched, nothing executed here); the CANV-04 extension-point design and the brush-body constants are proposals (LOW until spiked)

<user_constraints>
## User Constraints

**No CONTEXT.md exists for this phase** (the user chose to plan without `/gsd-discuss-phase`). The closest thing to user decisions are the ROADMAP.md "Planning notes" for Phase 1 and the stack decisions recorded in `data-drawing/.claude/CLAUDE.md`. Both are copied verbatim below and treated as locked.

### Locked Decisions (from ROADMAP.md § Phase 1 "Planning notes", verbatim)

- Wave 1 is the harness, and the pen surface builds on it: fx64 Q32.32 on int64 with portable widening multiply, ids with reserved branch-tag bits, seeded PRNG with per-entity streams, POD state, canonical serialize/restore/hash, CI grep, `-fwrapv` and UBSan in tests, all passing on a no-op `step()` before any behaviour rule exists. Pin the tick rate (60 Hz recommended) as a constant here; changing it later is a new world. Establish the `wasm` CMake preset and pin the Emscripten version on this skeleton so toolchain failures surface with no behaviour to blame.
- Wave 2 is sim behaviour, native and headless: the Stroke action with tick-stamped samples (position, pressure, tilt, twist fields from the start so STRK-06 never reopens the sample shape), BrushBody as semi-implicit Euler spring-damper with stiffness and damping derived from mass and clamped to the stable region, Emit at spacing with `(stroke ordinal, emission index)` ids, a versioned immutable brush table with presets; golden hashes on synthetic strokes, the insert-a-stroke id-stability test, and identical geometry whether stepped one tick at a time or four.
- Raise CANV-04 with the outer Tapestry roadmap on day one; it is the one item outside this project's control and it now gates Phase 1's last wave. Needs codebase research in the outer project: `TreeFrame.tsx`, `plugin-host.ts`, preload/IPC, and the SDK contribution model; verify Vite worker and `.wasm` bundling under electron-vite 2 and whether `crossOriginIsolated` is reachable (design avoids `SharedArrayBuffer` regardless). Waves 2 through 4 can proceed in the plugin's own dev loop (a Vite page loading the Worker sim) while the extension point lands, but the phase is not complete until the surface is mounted in Tapestry through the public extension point; a surface compiled into the app is not an acceptable interim.
- Wave 3 is the host: flat C ABI (`create/apply/step/hash/serialize/positions`), Wasm loaded in a Web Worker with transferred `ArrayBuffer` snapshots, a `SimHost` that is async from day one with a fixed-timestep accumulator draining whole ticks only (no fractional final step), actions applied at the start of their stamped tick before physics, and pause in the interface even though transport UI is Phase 3.
- Wave 4 is the surface, and it starts by measuring the pen on this Mac in the Electron dev build (pressure range, tilt presence and sign, `pointerType`, coalesced rate, eraser end, `pointerrawupdate`, `isSecureContext`); the numbers become the fence's constants, not a side spike's notes. The deterministic fence: a native (non-React) pointer listener with `setPointerCapture` and `touch-action: none`, paint only on `pointerType === 'pen'` with `buttons & 1`, ray-plane unproject and quantize once at the boundary, tick-stamp, optimistic feed to the live sim. Renderer choice (three.js `WebGPURenderer` with WebGL 2 fallback vs raw WebGL2 like the Phase 2.3 thread stage) is confirmed in discussion against the extension point's constraints; check `about:gpu` under Electron 32. Measure pen-to-ink latency with and without the Worker split.
- Deliberately deferred: no `.tree` writing and no save; the in-memory action carries the integer fields the journal will carry, quantized once at the fence, but no serialized form is chosen, so the pressure quantization width (12 vs 16 bit, sized to what the driver delivers) is provisional until Phase 2 freezes it with the grammar; stroke ordinals come from the in-memory session count (the `getNextIds()` prediction arrives with the commit pipeline in Phase 2); nodes stay where they are emitted until Phase 2's Settle rule; dead zone and finish line are Phase 2 (STRK-05); the camera is fixed and never recorded (orbit and a movable plane are v2, CANV-05).

### Locked Decisions (from `data-drawing/.claude/CLAUDE.md` "The Five Decisions", verbatim)

| Question | Decision | Confidence |
|---|---|---|
| 1. Sim core numerics and build | In-house `fx64` Q32.32 type on `int64_t` with a portable 64x64->128 multiply (no `__int128` on the hot path), one C++20 static library `ddsim` with zero dependencies, doctest v2.5.3 (already vendored), state hash = SHA-256 over a canonical little-endian byte layout via the same vendored PicoSHA2 the kernel uses | MEDIUM |
| 2. Painting surface renderer | three.js r186 (`three/webgpu` `WebGPURenderer`, automatic WebGL 2 fallback) inside the renderer, camera-facing `PlaneGeometry` raycast for stroke placement, `InstancedMesh`/`Points` placeholder node renderer. Not native Metal, not raw WebGL | MEDIUM-HIGH |
| 3. Pen input | W3C Pointer Events only: `pointerType === 'pen'`, `pressure`, `tiltX/Y`, `twist`, `tangentialPressure`, `getCoalescedEvents()` for recording, `getPredictedEvents()` for preview only. No native tablet addon. Chromium's macOS builder maps NSEvent tablet data to all of these (verified in source) | HIGH for the mapping, MEDIUM for latency |
| 4. Bridge | The **same** C++ compiled two ways from one `extern "C"` header: (a) Emscripten 6.0.10 WASM running in a Web Worker inside the renderer as the live sim for the plugin (fits the public SDK, no native build to try the plugin); (b) cmake-js 8 + node-addon-api 8.9 N-API addon for CTest, a headless replay/hash CLI, and the native-vs-wasm hash cross-check. Snapshots move worker->main via transferred `ArrayBuffer`s; no `SharedArrayBuffer` | MEDIUM |
| 5. Fixed-point patterns | Q32.32; integer digit-by-digit `isqrt`; xoshiro256** seeded through splitmix64 with per-action derived streams; no trig in the core (store directions as vectors); `-fwrapv` and UBSan in tests; canonical serialization sorted by stable id | MEDIUM-HIGH |

### Claude's Discretion

- The exact shape of the CANV-04 extension point (contribution name, module contract, transport) — a proposal is made below; it must be confirmed with the outer Tapestry roadmap.
- Whether to build the N-API `addon` preset in this phase (recommendation below: defer; golden hash files give the native-vs-Wasm cross-check without it).
- The `WebGPURenderer` vs `WebGLRenderer` entry point inside three.js (the roadmap explicitly leaves the renderer choice to be confirmed; CLAUDE.md fixes three.js and rules out raw WebGL).
- Concrete constants: id bit layout, spring-damper clamp values, preset masses, pressure quantization width (provisional per roadmap), sample struct field widths.

### Deferred Ideas (OUT OF SCOPE)

- `.tree` writing, save/open, the sample-block grammar (Phase 2)
- Settle rule (SIM-04), dead zone and finish line (STRK-05) — Phase 2
- Transport UI, scrubbing, reopen verification, erase/undo/inspector — Phase 3
- Orbit camera and movable plane (CANV-05), tilt-driven parameters (CANV-06) — v2
- `SharedArrayBuffer`/`crossOriginIsolated` — design avoids it regardless
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SIM-01 | Fixed-point integer-only authoritative state (Q32.32 on int64), fixed timestep, strictly ordered updates, seeded PRNG, no wall clock/floats/threads/unordered containers; CI check fails the build on a leak | § Fixed-Point Sim Details (fx64 op set, portable mulhi, isqrt, xoshiro256**/splitmix64), § Validation Architecture (CI grep as a CTest test, `-fwrapv`, UBSan) |
| SIM-02 | Serialize, restore, hash through one canonical byte walk; two runs same SHA-256; restored state hashes identically | § Canonical serialization and SHA-256 (PicoSHA2 reuse verified at `tapestry/kernel/Digest.cpp`), golden-file test design |
| SIM-03 | Same C++20 source builds to Wasm and runs live in a renderer Web Worker through a flat C ABI; surface sees state without mutating it | § Toolchain Reality Check (emsdk 6.0.10 install, `Emscripten.cmake` preset, `-sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker,node`, heap copy → transferred `ArrayBuffer`), § Code Examples (SimHost, worker) |
| STRK-01 | Stroke action records raw samples quantized once, stamped with tick and sample index; nothing smoothed or predicted recorded | § Pen Input (coalesced vs predicted verified against W3C spec and Chromium source), § Sample struct |
| STRK-02 | Brush body = spring-damper integrated in the sim from recorded samples; stiffness/damping derived from mass | § Spring-damper stability bound (derived Jury conditions; conservative clamps), mass-derived formulas |
| STRK-03 | Node ids from `(stroke ordinal, emission index)` with branch-tag bits reserved, never a counter | § Id scheme (64-bit layout, kernel `NodeId` is `uint64_t`, FORMAT.md `b2.n12` rule) |
| STRK-04 | Versioned immutable brushes: description, mass, radius, spacing, pressure curve; editing creates a version; three or four presets differing in description and mass | § Brush table design, § Code Examples |
| STRK-06 | Tilt and twist captured and recorded when the pen reports them; no rule depends on them | § Pen Input (Chromium mac builder sets `tilt_x`, `tilt_y`, `twist`, `tangential_pressure`; ranges from W3C) |
| CANV-01 | One plane facing a fixed camera; 3D positions with z from the plane; plane frame recorded per stroke | § Architecture Patterns (plane frame captured at pen-down, ray-plane unproject once), § Sample struct |
| CANV-02 | Pen captured at full sample rate via pointer capture and coalesced events; record only pen with tip down (mouse behind a setting); predicted events preview only | § Pen Input (eraser end maps to `buttons & 32` and clears `buttons & 1` in Blink — verified), `getPredictedEvents`/`pointerrawupdate` shipped in Chrome 77 (present in Chromium 128) |
| CANV-03 | Deterministic placeholder renderer colored from a hash of the brush description; cursor overlay of pen, body, spring | § Renderer Choice, § Code Examples (FNV-1a colour hash, overlay) |
| CANV-04 | A plugin can own a WebGL/WebGPU canvas inside the Tapestry renderer through a public host extension point | § CANV-04: What Exists Today (verified) and § CANV-04: Proposed Extension Point (files touched, contract, dev loop) |
</phase_requirements>

## Summary

Phase 1 has two halves with one seam between them. The first half is the sim: a dependency-free C++20 static library `ddsim` whose only numeric type is an in-house Q32.32 `fx64`, whose only randomness is xoshiro256** seeded through splitmix64, whose state is a POD struct-of-arrays sorted by a 64-bit node id, and whose `serialize()` byte walk is also its SHA-256 `hash()` input. The same source builds natively (doctest under CTest, a `ddsim_replay` CLI) and to WebAssembly (Emscripten 6.0.10, not yet installed on this Mac). Nothing about that half is novel; the discipline is in the harness and in refusing every convenience (`float`, `<cmath>`, `<random>`, `unordered_`, `__int128` on the hot path) that would make native and Wasm disagree.

The second half is the surface, and it is blocked by something this project does not own. The outer Tapestry SDK today has exactly four contribution types (`NodeViewContribution`, `CommandContribution`, `PropertyPanelContribution`, `InspectorContribution`), all of which name a React component *by string*; the renderer resolves node views from a compiled-in two-entry map (`NoteCard`, `VaultNoteCard`) in `TreeFrame.tsx`, never renders property panels or inspectors at all, and plugin code runs only in the main process via `require()`. There is no path by which a plugin ships renderer code, a Worker, or a `.wasm`. CANV-04 therefore needs a new host extension point: a `SurfaceContribution` whose entry is an ES module the host dynamically imports from a privileged custom scheme (`tapestry-plugin://<id>/...`) into a full-window stage layer, handing it a container element and an SDK-shaped host API. That touches `sdk/src/contributions.ts`, `sdk/src/index.ts`, `app/src/main/plugin-host.ts`, `app/src/main/index.ts` (scheme registration and handler), a new renderer `PluginSurfaceLayer.tsx`, and `App.tsx`. It must be raised with the outer roadmap on day one, and the first host task should be a 30-line spike proving `import()` of a module, a module Worker spawned from it, and a `.wasm` instantiated from it, all over the custom scheme.

On this Mac in Electron 32.3.3 (Chromium 128), the pen path is better than the earlier research feared: Chromium's macOS event builder fills `pressure`, `tiltX/Y`, `twist`, and `tangentialPressure` from `NSEvent` tablet data; the eraser end is detected from `NSPointingDeviceTypeEraser` on proximity and surfaces in the DOM as `pointerType === 'pen'` with `buttons & 32` set and `buttons & 1` cleared, so the roadmap's `buttons & 1` paint fence already excludes the eraser; and `getPredictedEvents()` and `pointerrawupdate` both shipped in Chrome 77. The renderer recommendation is three.js 0.186.0 (locked by CLAUDE.md), entering through `three/webgpu` `WebGPURenderer` as CLAUDE.md states but with `forceWebGL: true` as the first-run fallback, because every Tapestry spike on this exact Electron validated only the classic `WebGLRenderer` path.

**Primary recommendation:** Build waves 1–3 (harness, behaviour, Worker host) headless and in the plugin's own Vite dev page while the CANV-04 `SurfaceContribution` is raised and built in the outer project; treat the custom-scheme import/worker/wasm spike as the first host task, and treat the pen measurement on this Mac as the first surface task whose numbers become constants in the fence.

## Project Constraints (from CLAUDE.md)

From `/Users/kaelencook/Tapestry/data-drawing/.claude/CLAUDE.md` [VERIFIED: read this session]:

- **Determinism:** fixed-point integer authoritative state, fixed timestep, strictly ordered updates, seeded randomness only, no wall clock, no parallelism that can reorder results.
- **Engine independence:** the sim is a pure module with no rendering, Electron, or kernel dependency; the frontend only views sim state and changes it only through recorded actions.
- **Readability:** strokes, brush descriptions, ticks, branch ancestry readable in `.tree` without the app; per-node state derived, never committed (Phase 2 consumes this; Phase 1 must not preclude it).
- **Tapestry contract:** the painting surface uses the same public plugin API as any third-party plugin; no core fork, no private hooks.
- **Platform:** must run on this Mac; no OpenGL 4.3, no compute shaders through OpenGL.
- **Dependency:** forking/snapshots come from Tapestry Phase 3; scrubbing must work without them.
- **"What NOT to Use" table (verbatim items that bind this phase):** `float`/`double` anywhere in `ddsim` (add a CI grep); `__int128` on the hot multiply path; `std::unordered_map`/`unordered_set` iteration in the sim; `std::sort` with ties, `std::rand`, `<random>`; signed overflow left as UB (`-fwrapv`, UBSan); the canvas `desynchronized` hint; recording `getPredictedEvents()` samples; storing raw `pressure` floats in actions; `SharedArrayBuffer` in the first cut; wall clock or `performance.now()` inside the sim; Electron-specific APIs in the plugin; Wacom driver < 6.4.13; `--enable-unsafe-webgpu`.
- **Stack pins to honour:** Vitest stays on the app's 2.1.9 line; TypeScript stays on 5.9; electron-vite 2 / Vite 5 is the pipeline; `@types/three` in lockstep with `three`.
- **GSD workflow enforcement:** file changes go through GSD commands.

From `/Users/kaelencook/Tapestry/.claude/CLAUDE.md` (outer) [VERIFIED: read this session]:

- **Plugins from the beginning:** "First-party plugins exercise the same API as third-party plugins; adding a normal feature must not require a core fork."
- **Developer accessibility:** "Plugin authors need a short development loop and clear examples, without having to build the native application to try an extension."
- **Public SDK table, UI row:** "Register node views, inspectors, tools and panels; standard controls for simple plugins and an isolated custom web surface for complex editors" — this is the sentence CANV-04 cashes in.
- **Development scope:** work in the primary checkout `/Users/kaelencook/Tapestry`; do not rename the branch (current branch is `data-drawing` [VERIFIED: `git branch --show-current`]).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fixed-point numerics, brush body, emission, ids, PRNG, hash | Sim core (C++20 `ddsim`, native + Wasm) | — | The only place authoritative state may change; must be a pure function of (seed, versions, actions, tick) |
| Flat C ABI, snapshot byte layout | Sim core (`ddsim_c.h`) | Worker glue (TS) | Integers only cross the boundary; the ABI is what both builds share |
| Fixed-timestep accumulator, tick-stamping, action queue, pause | Renderer Web Worker (`sim.worker.ts` + `SimHost` on main) | — | Ticks must never wait on a frame; the accumulator uses wall time only to decide *how many* whole `step()` calls to make |
| Pen capture, coalesced events, ray-plane unproject, quantization (the fence) | Renderer main thread (native listener on the surface canvas) | — | Pointer events arrive on the main thread; floats and wall clock are permitted left of the fence only |
| Placeholder renderer, cursor overlay | Renderer main thread (three.js on the plugin-owned canvas) | — | Reads transferred read-only snapshots; never writes state |
| Brush presets, brush versioning UI | Renderer (plugin surface UI) → sim `DefineBrush` action | Main-process plugin (`index.js`) in Phase 2 when brushes become `.tree` nodes | Phase 1 keeps brushes in memory; the action shape is what Phase 2 serializes |
| Surface extension point, module loading, custom scheme, stage layer | Tapestry host: Electron main (`protocol`) + renderer (`PluginSurfaceLayer`) + SDK types | — | Outside this project; CANV-04 |
| Kernel commits, `.tree` | Electron main (kernel N-API addon) | — | Not touched in Phase 1 (no `.tree` writing) |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| C++20 + CMake | CMake 4.4.1 on this Mac; kernel requires ≥ 3.24 [VERIFIED: `tapestry/CMakeLists.txt:1` `cmake_minimum_required(VERSION 3.24)`; `cmake --version` → 4.4.1] | `ddsim` static library, tests, `ddsim_replay` | Same toolchain as the kernel; integer-only C++ is what compiles bit-identically native and Wasm |
| Apple clang | 14.0.3 [VERIFIED: `clang --version`] | Native build | Present; **has no `wasm32` target**, hence emsdk |
| Emscripten (emsdk) | 6.0.10, tag published 2026-09-21 [VERIFIED: GitHub API `releases/latest` → `"tag_name": "6.0.10"`, `refs/tags/6.0.10` HTTP 200]; **not installed** [VERIFIED: `which emcc` → not found; no `~/emsdk`; no brew formula installed] | Wasm build of `ddsim` | Pinned toolchain is a "pinned version" in the core value sense |
| doctest | v2.5.3 vendored [VERIFIED: `tapestry/CMakeLists.txt:45-46` "pinned to tag v2.5.3"; files at `tapestry/third_party/doctest/{doctest.h,doctest.cmake,doctestAddTests.cmake}`] | `ddsim_tests` | Already in repo with CTest discovery |
| PicoSHA2 | master commit `161cb3fc4170fa7a3eca9e582cebd27cc4d1fe29` (2025-05-04), MIT [VERIFIED: `tapestry/CMakeLists.txt:50-53`] | SHA-256 state hash | Same algorithm the kernel writes into `.tree`; header contains no `float`/`double`/`<cmath>`/`<random>`/`unordered_` [VERIFIED: grep of `tapestry/third_party/picosha2/picosha2.h` this session — zero hits; includes are `<algorithm> <cassert> <iterator> <sstream> <vector> <fstream>`] |
| xoshiro256** + splitmix64 | Reference C (Blackman & Vigna, 2018), public domain [CITED: prng.di.unimi.it/xoshiro256starstar.c, splitmix64.c — fetched this session] | Seeded PRNG | Integer-only, 4×`uint64_t` state, trivially serialized |
| three.js | 0.186.0 (published 2026-09-08) [VERIFIED: `npm view three version` → 0.186.0; exports include `./webgpu`, `./tsl`, `./addons`] | Painting scene, plane raycast, instanced placeholder, overlay | Locked by CLAUDE.md; the 2.3 thread spikes ran on this exact version under Electron 32 [VERIFIED: `.planning/spikes/CONVENTIONS.md:8` "three.js 0.186.0, loaded as ES modules"] |
| @types/three | 0.186.0 (2026-09-11) [VERIFIED: npm view] | Types | Lockstep with three |
| Electron / Chromium | 32.3.3 installed [VERIFIED: `node_modules/electron/package.json` → 32.3.3]; app pins `^32.0.0` [VERIFIED: `app/package.json:38`] | Renderer host | Chromium 128 per STACK.md; out of Electron's support window (not this project's call) |
| electron-vite / Vite | 2.3.0 / 5.4.21 installed [VERIFIED: `node -e require(...)`]; app pins `^2.3.0` / `^5.4.0` [VERIFIED: `app/package.json:39,44`] | App pipeline; plugin surface bundling | Vite 5 supports `new Worker(new URL(...), {type:'module'})` and `.wasm?url` [CITED: v5.vite.dev/guide/features] |
| Vitest | 2.1.9 pinned [VERIFIED: `app/package.json:45` `"vitest": "2.1.9"`] | TS tests, Wasm golden cross-check | Stay on the app's line |
| TypeScript | 5.9.3 installed [VERIFIED] | Plugin/surface code | Stay on 5.x |
| Node / npm | 20.20.2 / 10.8.2 [VERIFIED] | Tooling | cmake-js 8 needs ≥ 20.17 (fine) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@webgpu/types` | 0.1.74 (2026-09-19) [VERIFIED: npm view] | Typings for `navigator.gpu` | Only for the `about:gpu`/adapter feature-detect helper; three's own typings cover the renderer |
| node-addon-api / cmake-js | 8.9.2 / 7.4.0 installed at the workspace root [VERIFIED] | N-API `addon` preset | **Defer** (see Claude's Discretion): the golden-hash files make the native-vs-Wasm cross-check free without an addon |
| `fpm` (MikeLankamp) v1.1.0 | not vendored | Test oracle for `fx64` | Optional; a native-only `__int128` oracle in `ddsim_tests` needs no vendoring and is recommended first |
| `vite-plugin-wasm` | 0.x, OK verdict (379k/wk) [VERIFIED: package-legitimacy seam] | ESM-integration of `.wasm` | **Not needed**: the Emscripten ES6 glue plus `?url` suffices |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `WebGPURenderer` (`three/webgpu`) | `WebGLRenderer` (`three`) | The classic path is what the spikes proved on Electron 32; WebGPU is CLAUDE.md's pick and gives the later render tier compute. Recommendation: WebGPURenderer with `forceWebGL` fallback wired from day one; if `about:gpu` shows no WebGPU adapter, flip the default and note it |
| Custom-scheme `import()` for the surface | `<iframe sandbox>` on the custom scheme with `postMessage` | Real isolation, but the surface would not share a DOM container with the host and pointer capture across the frame boundary needs care; keep as the future isolation path (plugin-host.ts already says isolation "is a later phase") |
| Golden hash files committed to the repo | Live N-API addon cross-check in Vitest | Goldens are simpler and also give Debug-vs-Release and two-process checks for free |
| Worker + transferred `ArrayBuffer` | Main-thread Wasm | Keep a main-thread transport behind the same `SimHost` interface for latency measurement and tests only |

**Installation:**
```bash
# Wasm toolchain (not installed on this Mac)
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install 6.0.10 && ~/emsdk/emsdk activate 6.0.10
source ~/emsdk/emsdk_env.sh          # then: emcc --version  →  6.0.10

# Plugin package (workspace member plugins/data-drawing; three is NOT installed today)
npm install -w plugins/data-drawing three@0.186.0
npm install -w plugins/data-drawing -D @types/three@0.186.0 @webgpu/types@0.1.74
```
[CITED: emscripten.org/docs/getting_started/downloads.html — "./emsdk install latest" / "./emsdk activate latest" / "source ./emsdk_env.sh", version number replaces `latest`; macOS needs Xcode CLT and CMake (both present)]

**Version verification:** run in this session on 2026-09-22 — `npm view three version` → `0.186.0` (modified 2026-09-08T19:25:22Z); `@types/three` → `0.186.0` (2026-09-11); `@webgpu/types` → `0.1.74` (2026-09-19); none has a `postinstall` script.

## Package Legitimacy Audit

Ran `gsd_run query package-legitimacy check --ecosystem npm three @types/three @webgpu/types vite-plugin-wasm` this session.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| three@0.186.0 | npm | 14 days (2026-09-08) | 12.18M/wk | github.com/mrdoob/three.js | [SUS] too-new | Flagged — planner must add `checkpoint:human-verify` before install (the outer 02.3-04 plan already gated this exact version the same way [VERIFIED: `.planning/phases/02.3-time-threads/02.3-04-PLAN.md:138-143`]) |
| @types/three@0.186.0 | npm | 11 days | 8.03M/wk | DefinitelyTyped | [SUS] too-new | Flagged — same checkpoint |
| @webgpu/types@0.1.74 | npm | 3 days | 5.91M/wk | github.com/gpuweb/types | [SUS] too-new | Flagged — same checkpoint; optional dependency |
| vite-plugin-wasm | npm | 6 months | 379k/wk | github.com/Menci/vite-plugin-wasm | [OK] | Not recommended (not needed) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** three, @types/three, @webgpu/types — all "too-new" by age only; downloads and repos are the canonical ones. One human-verify checkpoint before the plugin's `npm install` covers all three.

*Packages discovered via WebSearch or training data that have not been verified against an authoritative source are tagged `[ASSUMED]` and the planner must gate each install behind a `checkpoint:human-verify` task.*

## CANV-04: What Exists Today (verified from the outer codebase)

Every claim in this section was read from source this session.

### The SDK contribution surface

`sdk/src/contributions.ts` defines exactly four contribution interfaces [VERIFIED: `sdk/src/contributions.ts:24-36, 68-77, 87-96, 106-115`]. The node-view one is:

```ts
export interface NodeViewContribution {
  /** Node type in dotted-path/name@version format. */
  nodeType: string
  /** Human-readable display name for this node type. */
  displayName: string
  /**
   * Name of the React component to render this node type.
   * Registered by name and resolved at render time.
   */
  component: string
}
```

`PropertyPanelContribution` (`nodeType`, `displayName`, `component: string`) and `InspectorContribution` (`id`, `displayName`, `component: string`) are the same shape: a component **name**, never code. `PluginContext` exposes exactly `kernel`, `registerNodeView`, `registerCommand`, `registerPropertyPanel`, `registerInspector` [VERIFIED: `sdk/src/index.ts:186-210`]. The manifest declares only `contributions: { nodeTypes: string[]; commands: string[] }` [VERIFIED: `sdk/src/index.ts:280-286`].

### How the renderer resolves a plugin's component

`app/src/renderer/components/TreeFrame.tsx:49-52` [VERIFIED]:

```ts
const NODE_VIEW_COMPONENTS = {
  NoteCard,
  VaultNoteCard,
} as const
```

and at `TreeFrame.tsx:436-438` `const view = mappedNodeView(pluginNodeViews[node.type])`; any other name falls through to `FallbackNodeView`. The comment at lines 37-40 states the policy verbatim: "A plugin contributes a node view as a *string*, so the host is never handed code to execute." `App.tsx:127-138` reads **only** `contributions.nodeViews` into a `Record<string,string>`; `propertyPanels` and `inspectors` are typed in `app/src/renderer/global.d.ts:128-129` but no renderer file consumes them [VERIFIED: `grep -rn "propertyPanels\|inspectors\|ExamplePropertyPanel" app/src/renderer` → only `global.d.ts`]. So `plugins/example-plugin/PropertyPanel.tsx` is never loaded by anything.

### How plugin code is loaded

Plugins are discovered under `plugins/` by `tapestry.plugin.json`, loaded in the **main process** with `require(entryPath)` [VERIFIED: `app/src/main/plugin-host.ts:354` `const mod = require(entryPath)`], and the entry must be `.js`/`.cjs` [VERIFIED: `plugin-host.ts:343` `if (!/\.c?js$/.test(entryPath))` with the reason "Plugin entry must be a .js/.cjs file ... build the plugin first"]. The host's own comment on isolation [VERIFIED: `plugin-host.ts:65-68`]: "This is policy, not a sandbox. Plugins are require()d into the main process with full Node access ... Real isolation is a later phase." Contributions reach the renderer through `ipcMain.handle('plugin:getContributions', ...)` [VERIFIED: `plugin-host.ts:783-785`] and `window.tapestry.plugins.getContributions()` [VERIFIED: `app/src/preload/index.ts:105-106`].

**Consequence for the plugin package:** because the host `require()`s `index.js` under Node 20, the plugin's `package.json` must **not** set `"type": "module"` (or the entry must be `index.cjs`); the surface bundle can still be an ES module file that the *browser* imports, since browsers ignore `package.json` `type` [ASSUMED: Node 20 has no `require(esm)`; the `.c?js` regex is verified].

### Renderer security posture and loading

`app/src/main/index.ts:40-48` [VERIFIED]:

```ts
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Tapestry',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(__dirname, '../preload/index.js'),
    },
  })
```

Dev loads `process.env.ELECTRON_RENDERER_URL` (electron-vite's `http://localhost` dev server); production uses `mainWindow.loadFile(join(__dirname, '../renderer/index.html'))` [VERIFIED: `index.ts:54-58`]. There is **no Content-Security-Policy** anywhere: `app/src/renderer/index.html` is 12 lines with no `<meta http-equiv>` [VERIFIED: read], and `grep -rni content-security-policy app/src app/electron.vite.config.ts app/forge.config.ts` returns nothing [VERIFIED]. No custom `protocol` is registered [VERIFIED: grep for `protocol.` / `registerSchemes` in `app/src/main/index.ts` → none]. So Wasm compilation is not CSP-blocked today, and the top-level document is `file://` in production and `http://localhost:*` in dev, both of which are secure contexts [CITED: developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts — "A scheme of `https`, `wss`, or `file`", "A host value of `localhost`"; table row `file:///path/to/resource.html` ✅ Secure] → `window.isSecureContext` should be `true` and `pointerrawupdate` reachable. `crossOriginIsolated` is not reachable under `loadFile` (headers cannot be set) [CITED: electron#31789 via STACK.md]; the design does not need it.

### The build pipeline

`app/electron.vite.config.ts` [VERIFIED: lines 37-47]: the renderer root is `src/renderer`, plugins `[react()]`, single input `index.html`; main externalizes `/\.node$/` (line 23). There is no configuration that would include anything under `plugins/` in the renderer bundle. Packaging copies the whole `plugins/` directory as an `extraResource` outside asar [VERIFIED: `app/forge.config.ts:24-27`], so plugin files exist on disk at runtime in both dev and packaged builds — which is what a custom-scheme file server needs.

### Verdict

No existing contribution lets a plugin own a canvas, ship a Worker, or load a `.wasm`; property panels and inspectors are dead contribution types today. CANV-04 requires a **new** contribution type and a **new** renderer-side loading mechanism. [VERIFIED by the reads above.]

## CANV-04: Proposed Extension Point (raise with the Tapestry roadmap on day one)

This is a proposal [ASSUMED — design], shaped to fit the outer CLAUDE.md sentence "an isolated custom web surface for complex editors" and the existing name-based contribution style.

### Contribution name and shape

Add to `sdk/src/contributions.ts`:

```ts
/**
 * Registers a renderer-side surface: an ES module the host loads into a
 * full-window stage layer and hands a container element. The module is
 * the plugin's own code; it never imports from the host or Electron.
 */
export interface SurfaceContribution {
  /** Namespaced id (e.g. "datadrawing.canvas"). */
  id: string
  displayName: string
  /** ES module path relative to the plugin root (e.g. "surface/dist/surface.js"). */
  entry: string
  /** Phase 1 supports exactly one placement. */
  placement: 'stage'
}

/** What the host hands the surface module at mount time (renderer side). */
export interface SurfaceHost {
  readonly container: HTMLElement                 // host-owned, absolutely sized; plugin owns its children
  readonly treeId: string
  readonly kernel: import('./index').KernelAPI     // the same five methods, bound to treeId
  onResize(cb: (width: number, height: number, dpr: number) => void): () => void
  close(): void                                    // ask the host to unmount
}

export interface SurfaceModule {
  mount(host: SurfaceHost): Promise<{ dispose(): void }> | { dispose(): void }
}
```

`PluginContext` gains `registerSurface(contribution: SurfaceContribution): void`; `PluginManifest.contributions` gains `surfaces?: string[]`.

### Outer files touched

| File | Change |
|------|--------|
| `sdk/src/contributions.ts` | `SurfaceContribution`, `SurfaceHost`, `SurfaceModule` (above) |
| `sdk/src/index.ts` | re-export the three types; `registerSurface` on `PluginContext` (line ~210); `surfaces?: string[]` on the manifest (line ~281) |
| `app/src/main/plugin-host.ts` | `surfaces: Map<string, SurfaceContribution>` in `ContributionRegistry` (line 156-161); `registerSurface` in the context literal (line 377-409) with the same collision check as inspectors; validate `entry` stays inside the plugin dir exactly like `main` (line 334-338); include `surfaces` in `getContributions()` (line 633-681) with `pluginName` |
| `app/src/main/index.ts` | before `app.whenReady()`: `protocol.registerSchemesAsPrivileged([{ scheme: 'tapestry-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])`; after ready: `protocol.handle('tapestry-plugin', ...)` mapping `tapestry-plugin://<pluginId>/<path>` to `<pluginsDir>/<pluginId>/<path>` with `isValidPluginName` + realpath containment, MIME by extension (`.js` → `text/javascript`, `.wasm` → `application/wasm`, `.json`, `.css`, `.map`), and `Access-Control-Allow-Origin: *` on every response |
| `app/src/renderer/components/PluginSurfaceLayer.tsx` (new) | full-window layer above the dimmed canvas (the 2.3 D-09 order "notes → scrim → thread → typer" is the precedent); `const mod = await import(/* @vite-ignore */ url)`; `mod.default.mount(host)`; on close `dispose()` then unmount |
| `app/src/renderer/App.tsx` | read `contributions.surfaces` alongside `nodeViews` (line 127-138); a menu/toolbar entry "Open <displayName>" per surface; `openSurface` state |
| `app/src/renderer/global.d.ts` | `surfaces` in the contributions type (line ~128) |
| `plugins/example-plugin/` | (optional, strongly recommended) a tiny `surface/` example so the third-party path is exercised, per outer PLUG-01 |

[CITED: electronjs.org/docs/latest/api/protocol — `registerSchemesAsPrivileged` "must be called before the app's `ready` event", privileges `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `stream`, `codeCache`; `protocol.handle(scheme, handler)` returns a `Response`, "Deprecated methods (pre-v25)" so `handle` exists in Electron 32; example serves files from disk with a path check via `net.fetch(pathToFileURL(...))`]

### Why a custom standard scheme (and not `file://` or a blob)

- A `standard` scheme has a real origin, so `new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' })` inside the surface module resolves relative to `tapestry-plugin://data-drawing/surface/dist/` and the worker fetches its own chunks and the `.wasm` from the same origin. `file://` origins are opaque and Chromium blocks workers from them [ASSUMED — the standard-scheme relative-URL behaviour is cited above; the `file://` worker restriction is training knowledge].
- `secure: true` keeps the surface in a secure context.
- `corsEnabled` + `Access-Control-Allow-Origin: *` is required because the top document (`file://` or `http://localhost`) imports a module script cross-origin [ASSUMED — module scripts are fetched in CORS mode; verify in the spike].
- A `blob:` URL import would work for a single file but breaks relative worker/wasm URLs.
- `import()` with a runtime string needs `/* @vite-ignore */` so Vite/Rollup does not try to resolve it at build time [ASSUMED — Vite emits "cannot be analyzed" warnings without it].

**First host task = a spike, not a feature:** register the scheme, `import()` a three-line module from it, have that module spawn a module Worker that instantiates a 100-byte `.wasm`, and print `isSecureContext`, `crossOriginIsolated`, and `navigator.gpu !== undefined`. Everything above is [ASSUMED] until this runs in Electron 32.

### Isolation note for the roadmap discussion

The surface module runs in the host renderer's JS realm, so it can reach `window.tapestry` directly. That is the same "policy, not a sandbox" stance the main-process plugin host already documents [VERIFIED: `plugin-host.ts:65-68`]. Real isolation later would be an `<iframe sandbox>` on the same custom scheme with `postMessage`; the `SurfaceModule` contract should avoid anything that only works in a shared realm (no host React, no shared globals) so that move stays possible.

### The plugin's own dev loop (waves 2-4 while CANV-04 lands)

`plugins/data-drawing/surface/` is a self-contained Vite 5 project: `index.html` dev page + `src/dev-host.ts` that builds a stub `SurfaceHost` (in-memory `kernel` stub, a full-window container) and calls `mount()`. `vite build` in library mode (`build.lib.formats: ['es']`, `worker.format: 'es'`) emits `dist/surface.js`, the worker chunk, and `ddsim.wasm` with `import.meta.url`-relative references [CITED: v5.vite.dev/guide/build#library-mode — es format keeps `import.meta.url` references valid; v5.vite.dev/config/worker-options — `worker.format: 'es' | 'iife'`, default `'iife'`]. The same `dist/` is what the host imports over `tapestry-plugin://`. This satisfies the outer constraint "without having to build the native application to try an extension" [VERIFIED: outer CLAUDE.md].

## Existing Patterns to Reuse

### Kernel CMake layout

- Shared warning/determinism settings as an INTERFACE target [VERIFIED: `tapestry/CMakeLists.txt:29-38`]: `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -ffp-contract=off` with the comment "no fast-math, no FP contraction". `ddsim` should add `-fwrapv` and keep `-ffp-contract=off` (harmless with no floats, but keeps the convention).
- doctest as an INTERFACE target with SYSTEM include [VERIFIED: `tapestry/CMakeLists.txt:57-59`]:
  ```cmake
  add_library(doctest INTERFACE)
  target_include_directories(doctest SYSTEM INTERFACE ${PROJECT_SOURCE_DIR}/third_party/doctest)
  add_library(doctest::doctest ALIAS doctest)
  ```
- Test discovery [VERIFIED: `tapestry/CMakeLists.txt:79-90`]: `enable_testing()`, one test binary, `include(.../doctest.cmake)`, `doctest_discover_tests(tapestry_kernel_tests)`; `TAPESTRY_FIXTURE_DIR` passed as a compile definition — reuse for `DDSIM_GOLDEN_DIR`.
- Test main [VERIFIED: `tapestry/kernel_tests/main.cpp:1-2`]: `#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN` / `#include <doctest.h>`.
- PicoSHA2 as a SYSTEM PRIVATE include on the library only [VERIFIED: `tapestry/CMakeLists.txt:71`]; usage [VERIFIED: `tapestry/kernel/Digest.cpp:3,16-18`]:
  ```cpp
  #include <picosha2.h>
  Digest sha256(std::string_view bytes) {
      return Digest{picosha2::hash256_hex_string(bytes.begin(), bytes.end())};
  }
  ```
  `ddsim` should **copy** `third_party/picosha2/picosha2.h` into `data-drawing/sim/third_party/picosha2/` (with LICENSE) rather than reference the kernel tree, to keep the sim dependency-free; use `picosha2::hash256(begin, end, out32.begin(), out32.end())` for raw bytes and `hash256_hex_string` for the 64-hex form the kernel uses. Note the header pulls in `<sstream>`/`<fstream>`; that is iostream bloat in Wasm but not a determinism concern.
- Kernel ids [VERIFIED: `tapestry/kernel/Ids.hpp:15-17`]: `struct NodeId { std::uint64_t value = 0;` — kernel node ordinals are 64-bit, start at 1, never reused; `using Tick = std::uint64_t;` (line 41).
- Branch-tag rule to reserve bits for [VERIFIED: `tapestry/docs/tree/FORMAT.md:378-380`]: "When branching arrives, ids allocated after a fork carry the branch's tag — `b2.n12` is node 12 allocated on branch 2".

### N-API addon pattern (for later, if the `addon` preset is built)

[VERIFIED: `app/native/CMakeLists.txt`]: `include_directories(SYSTEM ${CMAKE_JS_INC})` (line 14); kernel added with `TAPESTRY_BUILD_APP/RENDER/TESTS OFF` (21-27); `add_library(tapestry_addon SHARED addon.cpp ${CMAKE_JS_SRC})` with `PREFIX ""`, `SUFFIX ".node"` (33-37); node-addon-api include found via `node -p "require('node-addon-api').include"` (43-51); `NAPI_DISABLE_CPP_EXCEPTIONS` (54). Build script: `cmake-js build --directory native -O native/build` [VERIFIED: `app/package.json:8`]. The addon is loaded from `app/native/build/Release/tapestry_addon.node` [VERIFIED: `app/src/main/kernel-bridge.ts:28`]. Note `addon.cpp:22` includes `<cmath>` — the CI grep must scope to `sim/` only.

### The 2.3 thread stage precedent (renderer)

The roadmap calls it "raw WebGL2 like the Phase 2.3 thread stage", but the 2.3 plan actually uses **three.js**: Task 1 adds a module "owning **one** `WebGLRenderer`, created lazily when the first thread overlay opens and reused for every later open. Stop the loop on close with `setAnimationLoop(null)`. Handle `webglcontextlost` and `webglcontextrestored` by rebuilding buffers from the records" [VERIFIED: `.planning/phases/02.3-time-threads/02.3-04-PLAN.md:173`], with references to "the three.js 0.186.0 gotchas" (line 163). None of the 2.3 stage code exists yet in any worktree [VERIFIED: grep for `webgl|getContext(` in `app/src` and in `~/Tapestry-trees/time-threads/app/src` → no hits; 2.3 plans are all unchecked in ROADMAP]. So the precedent is a plan plus spikes, and the spikes' verified rules apply to any WebGL surface in this app:

- Closing must call `renderer.dispose()` **and** `renderer.forceContextLoss()` — "dispose alone holds the context until GC and a browser allows only a handful" [VERIFIED: `.claude/skills/spike-findings-tapestry/references/editor-and-app-integration.md:14, 28-31`].
- Keep React 18 StrictMode on: its mount→unmount→remount is the context-leak detector [VERIFIED: same file line 33]. The surface `dispose()` must be idempotent for this reason.
- three 0.186.0 gotchas [VERIFIED: `.planning/spikes/CONVENTIONS.md:43-46`]: with any update range set, only the ranges upload; `ShaderMaterial` culls back faces (billboards need `DoubleSide`); a 1-D attribute aliased as `position` needs a manual `boundingSphere`.
- `gl.finish()` does not measure GPU time in Chromium; measure frame intervals from `requestAnimationFrame` [VERIFIED: `CONVENTIONS.md:23`].
- A full-window layer over the dimmed canvas, not a child of the transformed container, so CSS pan/zoom never touches it [VERIFIED: `SKILL.md:45`] — the stage layer for CANV-04 should follow this.

## Toolchain Reality Check

| Item | State on this Mac (2026-09-22) |
|------|-------------------------------|
| `emcc` | **absent** [VERIFIED: `which emcc` → "emcc not found"; `ls ~/emsdk` → none; `brew list --versions emscripten` → none] |
| Apple clang | 14.0.3 (`clang-1403.0.22.14.1`), no `wasm32` target [VERIFIED] |
| CMake | 4.4.1 [VERIFIED] |
| macOS SDK | 13.3 (`xcrun --show-sdk-version`) on macOS 26.6.2 arm64 [VERIFIED] |
| Node / npm | 20.20.2 / 10.8.2 [VERIFIED] |
| Homebrew | 6.0.22 [VERIFIED] |

### Installing emsdk 6.0.10

`git clone https://github.com/emscripten-core/emsdk.git ~/emsdk && ~/emsdk/emsdk install 6.0.10 && ~/emsdk/emsdk activate 6.0.10 && source ~/emsdk/emsdk_env.sh` [CITED: emscripten downloads page; emsdk bundles Python 3; macOS needs Xcode CLT (present, clang works) and CMake (present)]. This downloads a prebuilt LLVM (hundreds of MB) and needs network; it is the one install step in wave 1. Pin `6.0.10` in `data-drawing/sim/CMakePresets.json` and in the sim's version constants.

### CMake preset for the Wasm build

Use the toolchain file directly so presets stay declarative (no `emcmake` wrapper needed): `-DCMAKE_TOOLCHAIN_FILE=$ENV{EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake` [CITED: emscripten.org/docs/compiling/Building-Projects.html — "emcmake automatically passes the Emscripten CMake toolchain file (`-DCMAKE_TOOLCHAIN_FILE=.../Emscripten.cmake`)"; file exists at `cmake/Modules/Platform/Emscripten.cmake` on main — HTTP 200 this session]. `EMSDK` is exported by `emsdk_env.sh` [ASSUMED]. Presets: `native-debug`, `native-release` (both run tests and produce golden hashes), `wasm-release`.

### Link flags for an ES module usable in a Worker and in Node

```
-O2 -fwrapv
-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node
-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=1048576
-sEXPORTED_FUNCTIONS=_dd_version,_dd_create,_dd_destroy,_dd_apply,_dd_step,_dd_tick,_dd_hash,_dd_serialize,_dd_restore,_dd_nodes_ptr,_dd_node_count,_dd_body_ptr,_malloc,_free
-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32
-sEXPORT_NAME=createDdsim
```

[CITED: emscripten settings reference — `EXPORT_ES6` "MODULARIZE must be enabled for ES6 exports and is implicitly enabled"; `ENVIRONMENT` default `['web','webview','worker','node']` (listing it explicitly documents intent); `ALLOW_MEMORY_GROWTH` default false; `EXPORTED_FUNCTIONS` "need `_` at the beginning"; `STACK_SIZE` default 64 KiB "There is no way to enlarge the stack"] [CITED: Interacting-with-code — HEAP views "must be listed in `EXPORTED_RUNTIME_METHODS` if used directly"; in STRICT mode they are export-on-demand; with memory growth "existing array views essentially become invalid" so re-read `Module.HEAPU8` at every use]. Mark every ABI function `extern "C"` + `EMSCRIPTEN_KEEPALIVE` (guarded by `#ifdef __EMSCRIPTEN__`).

Sizes above (32 MiB initial, 1 MiB stack) are [ASSUMED] starting points; 20k nodes × ~96 bytes is ~2 MB, so growth should never trigger in Phase 1, which also means heap views never invalidate mid-frame.

### Reading a Wasm heap region into a transferred `ArrayBuffer`

Inside the worker, after `step()` and never during it:

```ts
const ptr = mod._dd_nodes_ptr(sim), n = mod._dd_node_count(sim)
const bytes = mod.HEAPU8.subarray(ptr, ptr + n * NODE_STRIDE)  // re-read HEAPU8 each time
const copy = bytes.slice()                                       // copies into a fresh ArrayBuffer
postMessage({ kind: 'snapshot', tick, count: n, nodes: copy.buffer }, [copy.buffer])
```

`slice()` on a typed array allocates a new buffer, and listing it in the transfer list moves it zero-copy to the main thread [ASSUMED — standard Web platform behaviour]. The worker converts nothing; the main-thread renderer turns Q32.32 pairs into `Float32Array` for the GPU (floats are allowed left of the fence). Re-reading `mod.HEAPU8` (not caching the view) is what the Emscripten docs require under `ALLOW_MEMORY_GROWTH`.

### Node-side loading of the same module (Vitest)

`-sENVIRONMENT=...,node` plus `EXPORT_ES6` yields a module Vitest can `await import('./ddsim.js')` in the `node` environment; the glue locates `ddsim.wasm` next to itself via `import.meta.url` [ASSUMED — verify on the first wasm build]. The plugin package gets its own `vitest.config.ts` (environment `node`, no `pool: 'forks'` requirement since no addon lock is involved; the app's config note at `app/vitest.config.ts:9-13` explains why the app needs forks).

## Fixed-Point Sim Details

### `fx64` (Q32.32 on `int64_t`)

Representation: `int64_t raw`, value = `raw / 2^32`; `ONE = 1LL << 32`; range ±2.1e9, resolution 2.33e-10. Every constructor from `float`/`double` is `= delete`; construction is `fx64::from_int(i)`, `fx64::from_raw(r)`, or user-defined literals on integers. The op set the phase needs: `add, sub, neg, mul, div, sqrt, abs, min, max, clamp, lerp, floor_to_int, cmp`. Compile with `-fwrapv` so wrap-around is defined, and rely on C++20's guarantee that `>>` on a negative signed value is an arithmetic shift [CITED: cppreference operator_arithmetic — since C++20 "right shift on signed `a` is arithmetic right shift" and `a << b` is "the unique value congruent to a·2^b modulo 2^N"].

**Portable 64×64→128 multiply (no `__int128` on the hot path).** Hacker's Delight's `mulhs` decomposition into 32-bit halves, done with `uint64_t` products [ASSUMED — well-known algorithm; the hackersdelight.org listing could not be fetched this session; test it against a native `__int128` oracle]:

```cpp
// (a*b) >> 32, exact, using four 32x32->64 partial products. -fwrapv assumed.
inline int64_t mul_q32(int64_t a, int64_t b) {
    uint64_t a0 = (uint32_t)a, b0 = (uint32_t)b;          // low halves (unsigned)
    int64_t  a1 = a >> 32,    b1 = b >> 32;               // high halves (signed, arithmetic)
    uint64_t w0 = a0 * b0;                                // unsigned
    int64_t  t  = a1 * (int64_t)b0 + (int64_t)(w0 >> 32); // signed x unsigned-as-signed (b0 < 2^32)
    int64_t  w1 = (int64_t)(uint32_t)t;                   // low 32 of t, zero-extended
    int64_t  w2 = t >> 32;                                // arithmetic
    w1 += (int64_t)a0 * b1;
    int64_t hi = a1 * b1 + w2 + (w1 >> 32);               // high 64 bits of the 128-bit product
    uint64_t lo = (uint64_t)a * (uint64_t)b;              // low 64 bits (wrapping)
    return (int64_t)((uint64_t)hi << 32) | (int64_t)(lo >> 32);
}
```

Rounding policy: **truncate toward negative infinity everywhere** (shifts do this; division goes through one helper `div_q32(a, b)` = `floor((a << 32) / b)` implemented as a 128-by-64 long division built from 64-bit steps, or — simpler and enough for this phase — restrict division to the few places that need it (spring constants from mass, `1/n` sub-steps) and precompute reciprocals with a documented `floor` rule). One rule, stated in `fx64.hpp`, is what PITFALLS.md pitfall 2 asks for.

Tests: `fx64` vs `__int128` oracle on 10^6 seeded random pairs (native only, `#if defined(__SIZEOF_INT128__)`); edge cases `INT64_MIN`, `-1`, `ONE`, `ONE-1`; commutativity; `mul(x, ONE) == x`.

### Integer square root (`isqrt`)

Digit-by-digit binary method on `uint64_t` with a fixed 32-iteration loop (not "until converged"). For `sqrt` of a Q32.32 value `x ≥ 0`: `sqrt(x) = isqrt128(x << 32)`; implement as `isqrt` on the 96-bit value via two 64-bit words, or simply compute `isqrt64(x) << 16` when `x < 2^32` and use the wide form otherwise [ASSUMED — design; verify against the `__int128`/`double` oracle in tests only]. `sqrt` of a negative input is a contract violation caught by `assert` in Debug and clamped to 0 in Release — but since both must hash identically, **never let the two differ**: clamp in both and assert additionally in Debug.

### PRNG: xoshiro256** seeded by splitmix64, per-entity streams

Reference code fetched this session [CITED: prng.di.unimi.it]:

```c
// splitmix64
uint64_t z = (x += 0x9e3779b97f4a7c15);
z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9;
z = (z ^ (z >> 27)) * 0x94d049bb133111eb;
return z ^ (z >> 31);

// xoshiro256**
const uint64_t result = rotl(s[1] * 5, 7) * 9;
const uint64_t t = s[1] << 17;
s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
s[2] ^= t;
s[3] = rotl(s[3], 45);
return result;
```

"The state must be seeded so that it is not everywhere zero. If you have a 64-bit seed, we suggest to seed a splitmix64 generator and use its output to fill s." Per-entity streams: `stream_seed = splitmix64(world_seed ^ purpose_tag ^ entity_id)` then four splitmix64 outputs fill `s[0..3]`. Uniform fixed-point in [0,1): `fx64::from_raw(next() >> 32)`. No rule in Phase 1 draws randomness (no Settle yet); the PRNG state is still part of the hash so wave 1 proves the plumbing.

### Tick rate and versions

`DD_TICK_HZ = 60` as a `constexpr` in the sim [locked by roadmap]; `DD_SIM_VERSION`, `DD_FX_FORMAT_ID` ("q32.32"), `DD_RNG_VERSION`, `DD_RULE_BRUSHBODY_VERSION`, `DD_RULE_EMIT_VERSION` as `uint32_t` constants written into the canonical byte walk so any change changes every hash.

### Id scheme (STRK-03, branch-tag bits reserved)

`NodeId` is a `uint64_t`, laid out so ascending numeric order is `(branch, stroke, index)` [ASSUMED — design]:

```
bits 63..56  branch tag   (8 bits;  0 = main, matching kernel ids that carry no b<k>. prefix today)
bits 55..24  stroke ordinal (32 bits; the kernel node ordinal of the stroke node in Phase 2; the
             in-memory session count in Phase 1 — both start at 1)
bits 23..0   emission index (24 bits; 16.7M nodes per stroke)
```

`StrokeId = (branch << 32) | ordinal`. The insert-a-stroke test: replay log A and log A' (A with one stroke inserted at position k), and assert every node whose stroke ordinal is unchanged has an identical id and position. In JS, treat ids as `BigInt` or as a `(stroke, index)` pair — a 64-bit id with the ordinal in bits 24-55 exceeds 2^53 as soon as the ordinal exceeds 2^29, so never put it in a `number`.

### Spring-damper brush body (STRK-02): update rule and stability

State per active stroke: body position `x` (plane-local `fx64` vec2), velocity `v` (vec2). Per tick, with `n` = number of samples stamped for this tick (n ≥ 1; if 0, hold the last target), sub-step `h = 1/n` (a Q32.32 reciprocal computed once per tick with the documented floor rule), and for each sample `p_i` in index order:

```
a  = k_t * (p_i - x) - c_t * v        // per-tick stiffness k_t and damping c_t, dimensionless
v += a * h                            // semi-implicit (symplectic) Euler: velocity first
x += v * h                            //                                   then position
path += |x_new - x_old|               // isqrt of the squared step; feeds Emit
```

Derivation from mass (the only brush-visible knob besides the rule constants): `k_t = K / m` and `c_t = 2·ζ·sqrt(k_t)` with rule constants `K` (reference stiffness for unit mass) and `ζ` (damping ratio) pinned in `DD_RULE_BRUSHBODY_VERSION`. Heavier `m` lowers both, so the body lags more and overshoots through curves; a light preset with `m` near 1 tracks closely.

**Stability bound (derived this session from the update matrix, [ASSUMED] until a test confirms):** with `h = 1`, the update in state `(x, v)` is the matrix `M = [[1-k_t, 1-c_t], [-k_t, 1-c_t]]`, trace `T = 2 - k_t - c_t`, determinant `D = 1 - c_t`. Jury's conditions for a 2×2 system (`|D| < 1`, `|T| < 1 + D`) give the exact stable region

```
0 < c_t < 2   and   0 < k_t < 4 - 2·c_t
```

which reduces to the classic undamped limit `ω·dt < 2` (`k_t < 4`) when `c_t → 0` [CITED: web search cross-check — "the formal stability limit is Ω₀ dt < 2" for symplectic schemes; "semi-implicit Euler is stable for any non-negative damping coefficient b, but ... only stable when k is sufficiently small"]. Sub-stepping by `h = 1/n` only shrinks the effective `k_t·h²` and `c_t·h`, so validating at `h = 1` is sufficient. **Recommended clamps to assert in the brush validator:** `k_t ≤ 1` and `c_t ≤ 1` (well inside the region, and `c_t ≤ 1` guarantees the velocity damping term never flips sign in one tick). With `K = 1`, `ζ = 0.5`: `m = 1 → k_t = 1, c_t = 1` (light, near-critical); `m = 4 → 0.25, 0.5`; `m = 16 → 0.0625, 0.25`; `m = 64 → 0.0156, 0.125` (heavy, visibly underdamped). Those four masses are a reasonable preset spread to start tuning from [ASSUMED]. Any preset failing the clamp is rejected at `DefineBrush` time — a rejected action, never a clamped one, so replay can never depend on silent correction.

**Ticks-per-frame invariance test:** the same recorded samples stepped 1 tick per `step()` call vs 4 must hash identically — automatic if `step()` takes no arguments and the accumulator only decides the call count.

### Emission (STRK-03/STRK-04)

Brush version fields: `description` (UTF-8 text), `mass` (fx), `radius` (fx), `spacing` (fx, plane units), `pressure_curve` (17 `uint16_t` knots, piecewise-linear over u16 pressure — integer interpolation, no floats). Emission: while `path_accum ≥ spacing`: emit node `k` at the body's current position (or, better for accuracy, at the point `spacing` back along the last segment), `weight = curve(pressure of the sample being tracked)`, `direction = normalized (v)` with an explicit `|v|² < ε` rule that keeps the previous direction, `velocity = v`, `creation_tick`, `scale_band = 0`, `brush = version id`; `path_accum -= spacing`; `k++`. 3D position = `plane.origin + u·plane.right + v·plane.up` in fixed point, so z comes from the plane frame (CANV-01).

### Canonical serialization and hash (SIM-02)

One function `write_canonical(State&, ByteSink&)` writes explicit little-endian fields (never `memcpy` of structs — padding is not canonical):

```
magic "DDS1" | u32 sim_version | u32 fx_format_id | u32 rng_version | u32 rule_brushbody_v | u32 rule_emit_v
u32 tick_hz | u64 seed | u64 tick
u32 brush_count, then per brush in version order: u32 id, u32 desc_len, bytes desc, i64 mass, i64 radius, i64 spacing, 17×u16 curve
u64 rng.s[0..3]
u32 active_stroke_count, then per active stroke in ordinal order: stroke id, brush id, plane frame (9×i64), body x,y,vx,vy (4×i64), path_accum, next_emission_index, pending samples in (tick,index) order
u32 node_count, then nodes in ascending NodeId: u64 id, i64 x,y,z, i64 weight, i64 dir_x,dir_y, i64 vx,vy, u32 tick, u8 scale_band, u32 brush
```

`hash()` = SHA-256 over exactly those bytes (PicoSHA2 `hash256`); `serialize()` returns them; `restore()` is the strict inverse (reject, never clamp, any out-of-range field — PITFALLS security row). `restore(serialize(s)).hash() == s.hash()` is the round-trip test. A cheaper per-tick trace hash (FNV-1a 64 over the same bytes, in-house, integer-only) is optional for bisecting divergence [ASSUMED]; do not use it in recorded artefacts.

### The flat C ABI (`ddsim_c.h`)

```c
uint32_t dd_version(void);
dd_sim*  dd_create(uint64_t seed);                       // tick_hz is a compile-time constant
void     dd_destroy(dd_sim*);
int      dd_apply(dd_sim*, const uint8_t* action, uint32_t len);   // canonical LE action bytes; 0 = accepted, else error code
void     dd_step(dd_sim*);                               // one tick; no arguments
uint64_t dd_tick(const dd_sim*);
void     dd_hash(const dd_sim*, uint8_t out[32]);
uint32_t dd_serialize(const dd_sim*, uint8_t* out, uint32_t cap);   // returns needed length when cap is 0
int      dd_restore(dd_sim*, const uint8_t* in, uint32_t len);
const uint8_t* dd_nodes_ptr(const dd_sim*); uint32_t dd_node_count(const dd_sim*); uint32_t dd_node_stride(void);
const uint8_t* dd_body_ptr(const dd_sim*);               // active brush body state for the cursor overlay
```

Actions (`DefineBrush`, `StrokeBegin{stroke ordinal, brush, plane frame, tick}`, `StrokeSamples{stroke, samples[]}`, `StrokeEnd{stroke, tick}`) are encoded by one TS encoder and one C++ decoder over the same byte grammar; that grammar is internal to Phase 1 and is what Phase 2 renders as readable text. Integers only cross the ABI; the sample's plane coordinates cross as `int32` Q16.16 plane units and the sim widens them to Q32.32 (`<< 16`), which keeps JS on safe integers and keeps the future journal numbers short [ASSUMED — design].

### The sample struct (STRK-01, STRK-06, CANV-02)

```ts
interface Sample {           // integers only; produced once at the fence, never recomputed
  tick: number               // u32 sim tick the sample is stamped for
  index: number              // u16 order within the tick
  u: number; v: number       // i32 plane-local Q16.16
  pressure: number           // u16 0..65535  (provisional width; 12-bit is the alternative — Phase 2 freezes)
  tiltX: number; tiltY: number   // i8 degrees, -90..90; 0 when absent
  twist: number              // u16 degrees, 0..359; 0 when absent
  flags: number              // bit0 hasTilt, bit1 hasTwist, bit2 pressureSource (0 = pen sensor, 1 = mouse/no sensor)
}
```

Per stroke: `strokeOrdinal`, `brushVersionId`, `planeFrame` (origin, right, up as 9 × i32 Q16.16), `startTick`, `endTick`, `pressureSource`.

## Pen Input on macOS / Chromium 128

### What Chromium's macOS builder delivers (verified from source this session)

`components/input/web_input_event_builders_mac.mm` [CITED: raw.githubusercontent.com/chromium/chromium/main/...]:

```
if (subtype == NSEventSubtypeTabletPoint) {
result.force = [event pressure];
result.tilt_x = tilt.x * 90.0f;
result.tilt_y = ([view isFlipped] ? 1.0 : (-1.0)) * tilt.y * 90.0f;
result.tangential_pressure = [event tangentialPressure];
int twist = (int)[event rotation]; twist = twist % 360; if (twist < 0) twist += 360; result.twist = twist;
```

Eraser detection lives one level up, in `content/app_shim_remote_cocoa/render_widget_host_view_cocoa.mm` [CITED]:

```
} else if (subtype == NSEventSubtypeTabletProximity) {
  _isStylusEnteringProximity = [theEvent isEnteringProximity];
  NSPointingDeviceType deviceType = [theEvent pointingDeviceType];
  _pointerType = deviceType == NSPointingDeviceTypeEraser
                     ? blink::WebPointerProperties::PointerType::kEraser
                     : blink::WebPointerProperties::PointerType::kPen;
```

and Blink maps that to the DOM in `third_party/blink/renderer/core/events/pointer_event_factory.cc` [CITED]:

```
case WebPointerProperties::PointerType::kEraser:
  return pointer_type_names::kPen;
...
if (pointer_type == WebPointerProperties::PointerType::kEraser) {
  if (buttons != 0) {
    buttons |= static_cast<unsigned>(WebPointerProperties::Buttons::kEraser);
    buttons &= ~static_cast<unsigned>(WebPointerProperties::Buttons::kLeft);
  }
  pointer_type = WebPointerProperties::PointerType::kPen;
}
```

**So on macOS the eraser end arrives as `pointerType === 'pen'` with `buttons & 32` set and `buttons & 1` cleared** (and `button === 5` on `pointerdown`, per the W3C table: "Pen eraser button" `button` 5 / `buttons` 32 [CITED: w3c.github.io/pointerevents]). The roadmap's fence `pointerType === 'pen' && (buttons & 1)` therefore already excludes the eraser end without extra code; Phase 3's erase action keys on `buttons & 32`. This resolves STACK.md's LOW-confidence "eraser-end detection" item at the source level; the runtime measurement still confirms it for the specific driver.

### Field ranges and pointer type facts

[CITED: W3C Pointer Events]: `pressure` in [0,1], "For hardware and platforms that do not support pressure, the value MUST be 0.5 when in the active buttons state and 0 otherwise" (hence the `pressureSource` flag); `tiltX/tiltY` in [-90, 90]; `twist` in [0, 359]; `tangentialPressure` in [-1, 1]; `pointerType` is one of `"mouse" | "pen" | "touch"` (there is no eraser type). `getCoalescedEvents()` returns the actual samples folded into one dispatched event; predicted events are "valid predictions until the next pointer event is dispatched" and are implementation-defined [CITED: MDN getPredictedEvents — "How the predicted positions are calculated depends on the user agent"]. `pointerrawupdate` fires "only ... within a secure context" and "before the corresponding pointermove" [CITED: W3C].

Both `PointerEvent.getPredictedEvents()` and `pointerrawupdate` shipped enabled-by-default in **Chrome 77** [VERIFIED: chromestatus.com API features 5765569655603200 and 6041426311774208, `"milestone_str": "77"`], so Chromium 128 has them. A later change restricting `pointerrawupdate` to secure contexts is targeting Chrome 143 [CITED: blink-dev intent thread via search] — irrelevant for Electron 32, and the document is secure anyway.

### Capture semantics and the fence (verbatim requirements the plan should copy)

- Native listener (`addEventListener`) on the surface canvas, never a React synthetic handler; `canvas.style.touchAction = 'none'`.
- On `pointerdown` with `pointerType === 'pen'` (or `'mouse'` only when the mouse setting is on) and `buttons & 1`: `canvas.setPointerCapture(ev.pointerId)`; capture the plane frame from the camera once; open the stroke with the current sim tick.
- On `pointermove`: `for (const s of ev.getCoalescedEvents?.() ?? [ev])` — quantize each, stamp `(tick, index)`, append; `ev.getPredictedEvents()` → overwrite the transient preview tail only.
- On `pointerup` / `pointercancel` / `lostpointercapture`: close the stroke at the current tick; `releasePointerCapture`.
- Ignore `touch` pointers while a pen stroke is open (palm policy).
- Record `event.timeStamp` nowhere that replay reads.

### Quantization recommendation

- **Pressure: 16-bit** (`Math.round(pressure * 65535)`, u16). Chromium hands over the float `NSEvent.pressure`; a Wacom driver typically delivers 8192 levels, so 16 bits loses nothing and 12 bits (`* 4095`) would also be lossless for an 8k-level pen. The roadmap keeps the width provisional; the measurement task should log the distinct-value count over a long stroke and Phase 2 picks the width from that. [ASSUMED for the driver level count]
- **Tilt: integer degrees** as delivered (`Math.round(tiltX)` → i8, range -90..90). The DOM attribute is integer-valued per the spec's `long` type [ASSUMED — type not quoted this session; ranges are cited].
- **Twist: integer degrees** u16 0..359 as delivered (Chromium already does `% 360`).
- **Tangential pressure:** not recorded in Phase 1 (no requirement names it); note as a possible field before Phase 2 freezes the grammar.
- **Plane position:** i32 Q16.16 plane units (1/65536 unit resolution over ±32768 units) — see the ABI note.

### Measurement task (wave 4, first task) — what to log and where it goes

A debug overlay/console logger in the surface records over three strokes: `pointerType` on down; `isPrimary`; `pressure` min/max and distinct-value count; whether `tiltX/tiltY` are ever non-zero and their sign when tilting the pen toward +x/+y on screen; `twist` presence; `buttons` on the eraser end (expect 32); coalesced samples per second (count `getCoalescedEvents().length` over one second of fast motion); predicted event count per `pointermove`; `window.isSecureContext`; whether `pointerrawupdate` fires and at what rate; `crossOriginIsolated` (expect `false`); `navigator.gpu` presence. These numbers become constants/assertions in `input.ts`, per the roadmap.

## Renderer Choice

**Recommendation (MEDIUM confidence): three.js 0.186.0, entering through `three/webgpu` `WebGPURenderer` as CLAUDE.md states, with `forceWebGL: true` wired as an explicit fallback switch from the first commit.** Reasons:

1. CLAUDE.md locks three.js and rules out raw WebGL; the roadmap's "raw WebGL2 like the Phase 2.3 thread stage" is a misremembering — the 2.3 plan uses three's `WebGLRenderer` [VERIFIED: `02.3-04-PLAN.md:173`].
2. The placeholder needs exactly what three ships without custom shaders: `PlaneGeometry` + `Raycaster` for the fixed-camera ray-plane hit, `InstancedMesh` (or `Points`) with per-instance colour for nodes, and `Line`/`LineSegments` for the pen→body spring overlay. Using built-in materials keeps the code identical under WebGPU and WebGL 2, which is what makes the fallback real.
3. WebGPU under Electron 32 on this M4 is unverified here (STACK cites Chrome 113 default on macOS and electron#41763). The `about:gpu` check is a manual step in the surface wave; if WebGPU is absent, flip the default to `forceWebGL` and note it in the phase verification.
4. Bundle size is irrelevant for a local app loaded from disk; the surface bundles its **own** copy of three, so there is no version coupling with the app's future 2.3 dependency (the app has no `three` today [VERIFIED: `three NOT INSTALLED` at the workspace root]).
5. Every spike rule about contexts applies regardless of entry point: one renderer per surface, `dispose()` + `forceContextLoss()` on unmount, `setAnimationLoop(null)` on close.

Deterministic colouring (CANV-03): FNV-1a 32-bit over the UTF-8 bytes of the brush description → hue; same function in the sim (for a future readable colour column) and in TS. Implement in TS with `Math.imul` so the 32-bit multiply is exact.

## Architecture Patterns

### System Architecture Diagram

```
                       RENDERER MAIN THREAD (plugin surface module, loaded via tapestry-plugin://)
  ┌──────────────┐  PointerEvent   ┌──────────────────┐  Sample[] (ints)  ┌──────────────┐
  │ Pen / tablet │ ──────────────► │ input.ts (FENCE) │ ────────────────► │ SimHost (TS) │
  │ NSEvent →    │  coalesced +    │ pen-only, capture│  tick-stamped,    │ async API,   │
  │ Chromium     │  predicted      │ ray-plane, quant │  quantized once   │ pause, tpf   │
  └──────────────┘                 └────────┬─────────┘                   └──────┬───────┘
                                            │ predicted tail (preview only)      │ postMessage(actions)
                                            ▼                                    ▼
  ┌──────────────────────────────────────────────────────┐        ┌───────────────────────────────┐
  │ stage/ (three.js): fixed camera, plane, InstancedMesh │ ◄───── │ WEB WORKER sim.worker.ts       │
  │ nodes coloured by hash(description), cursor overlay   │ snap-  │ accumulator → whole ticks only │
  │ (pen, body, spring); reads Float32 copies only        │ shot   │ apply(actions @ tick) ; step() │
  └──────────────────────────────────────────────────────┘ (xfer) │ HEAPU8.slice() → transfer       │
                                                                   └───────────────┬───────────────┘
                                                                                   │ flat C ABI (ints)
                                                                                   ▼
                                                              ┌────────────────────────────────────┐
                                                              │ ddsim.wasm  (same C++20 as native) │
                                                              │ fx64 · ids · rng · brush table ·   │
                                                              │ BrushBody · Emit · serialize/hash  │
                                                              └────────────────────────────────────┘
  HEADLESS (native, CTest): ddsim_tests (doctest) ── golden .sha256 files ── ddsim_replay CLI
  TAPESTRY HOST (outer project, CANV-04): protocol.handle('tapestry-plugin') · PluginSurfaceLayer · registerSurface
  KERNEL / .tree: untouched in Phase 1
```

Trace the primary use case: pen down → `input.ts` captures the pointer, captures the plane frame, quantizes each coalesced sample into integers stamped with the tick `SimHost` reports → `SimHost` posts `StrokeBegin`/`StrokeSamples` to the worker → the worker applies actions stamped for tick *t* at the start of tick *t*, calls `dd_step()` for each whole tick the accumulator owes, copies the node/body region out of the heap and transfers it → the main thread converts to floats and draws nodes and the overlay; the predicted tail is drawn from `getPredictedEvents()` and discarded on the next event.

### Recommended Project Structure

```
data-drawing/sim/                       # ddsim — pure C++20, zero deps
├── CMakeLists.txt                      # ddsim (STATIC) · ddsim_tests · ddsim_replay · ddsim_wasm (only under Emscripten) · grep test
├── CMakePresets.json                   # native-debug · native-release · wasm-release (EMSDK toolchain, 6.0.10 pinned)
├── include/ddsim/
│   ├── fx64.hpp                        # Q32.32, deleted float ctors, mul_q32, div, isqrt
│   ├── ids.hpp                         # NodeId/StrokeId bit layout, comparators
│   ├── rng.hpp                         # splitmix64, xoshiro256**, per-entity streams
│   ├── brush.hpp                       # BrushVersion, validator (stability clamps)
│   ├── action.hpp                      # DefineBrush / StrokeBegin / StrokeSamples / StrokeEnd + LE codec
│   ├── state.hpp                       # POD SoA, constants (DD_TICK_HZ, versions)
│   ├── sim.hpp                         # apply/step/hash/serialize/restore
│   ├── rules/brush_body.hpp, rules/emit.hpp
│   └── ddsim_c.h                       # extern "C" ABI shared by wasm and any addon
├── src/…                               # implementations
├── third_party/picosha2/               # copied header + LICENSE (pin 161cb3f…)
├── tests/                              # doctest: fx64_oracle, determinism, roundtrip, golden, id_stability, tpf_invariance
│   └── golden/*.actions, *.sha256      # committed goldens (native-release writes; every preset must match)
├── tools/ddsim_replay/main.cpp         # replay an action file, print per-checkpoint SHA-256
└── wasm/ddsim_wasm.cpp                 # EMSCRIPTEN_KEEPALIVE wrappers; link flags live in CMake

plugins/data-drawing/                   # the Tapestry plugin (workspace member)
├── tapestry.plugin.json                # main index.js · api "1" · contributions.surfaces ["datadrawing.canvas"]
├── index.js                            # CommonJS; activate(): registerSurface(...)  (NO "type":"module")
├── package.json                        # deps three/@types/three; scripts build (vite), test (vitest), dev (vite dev page)
└── surface/
    ├── index.html · src/dev-host.ts    # the plugin's own dev loop with a stub SurfaceHost
    ├── vite.config.ts                  # build.lib es · worker.format 'es' · copies sim/build-wasm/ddsim.{js,wasm}
    ├── src/main.ts                     # export default SurfaceModule { mount }
    ├── src/sim-host.ts · src/sim.worker.ts · src/ddsim-abi.ts (encoder, snapshot layout)
    ├── src/input.ts                    # the fence
    ├── src/stage/{scene.ts,nodes.ts,overlay.ts,colour.ts}
    ├── src/brushes.ts                  # presets, in-memory version table, "edit → new version"
    └── test/*.test.ts                  # vitest: golden hash via wasm in node; encoder round-trip; colour hash
```

### Pattern 1: Golden hash files are the harness

**What:** `native-release` builds run the synthetic stroke fixtures and write `tests/golden/<fixture>.sha256` (one line per checkpoint tick). Those files are committed. Every other configuration — `native-debug`, a second process run by CTest, UBSan build, the Wasm module under Vitest, and the Worker replay in the app — must reproduce them byte for byte.
**When to use:** From wave 1 (the no-op `step()` fixture hashes an empty world at ticks 0, 1, 60, 600).
**Why:** It turns "Debug vs Release, two processes, native vs Wasm, serialize/restore" into one comparison against one committed artefact; regenerating goldens is a deliberate, reviewed act.

### Pattern 2: Actions apply at the start of their stamped tick, before physics

**What:** The worker keeps `pending: Map<tick, Action[]>`; `stepTo()` does, per tick, `apply(all actions for tick t in arrival order)` then `dd_step()`. A sample stamped for a tick that already passed is a bug in the fence (assert in dev; in prod re-stamp to the current tick and log — but the re-stamped value is what gets recorded, so replay still matches live).
**Why:** PITFALLS pitfall 5; it is what makes the live optimistic sim identical to replay.

### Pattern 3: Fixed-timestep accumulator, whole ticks only, pause in the interface

```ts
// sim.worker.ts (wall clock is allowed here; it only decides HOW MANY step() calls happen)
let acc = 0, last = performance.now(), paused = false, ticksPerFrame = 1
function frame(now: number) {
  if (!paused) acc += Math.min(now - last, 250) * ticksPerFrame   // clamp: no spiral of death
  last = now
  while (acc >= TICK_MS) { applyPending(mod, sim, tick); mod._dd_step(sim); tick++; acc -= TICK_MS }
  publishSnapshot()                                                // between steps only
  setTimeout(frame, 0, performance.now())                          // or a rAF-driven 'tick' message from main
}
```
No fractional final step; `paused` is a message-settable flag now even though transport UI is Phase 3.

### Pattern 4: The `SimHost` interface is async and transport-agnostic

`interface SimHost { submit(action): void; currentTick(): number; onSnapshot(cb): () => void; pause(v: boolean): void; replayFromZero(actions): Promise<Uint8Array /*hash*/>; hash(): Promise<Uint8Array> }` with two transports: `WorkerTransport` (default) and `MainThreadTransport` (same Wasm module on the main thread, for the latency comparison and Vitest).

### Pattern 5: Plane frame captured once, positions stored in 3D

At pen-down the surface reads the fixed camera and writes `planeFrame = {origin, right, up}` (plane-local basis in world units, quantized to Q16.16) into the `StrokeBegin` action; samples are plane-local `(u, v)`; the sim computes `pos3 = origin + u·right + v·up`. The camera itself is never in any action.

### Anti-Patterns to Avoid

- **A `number` holding a 64-bit id or a Q32.32 raw value in TS** — exceeds 2^53; use `BigInt` or split into `(hi, lo)` / `(stroke, index)`.
- **Caching `Module.HEAPU8`** — invalid after growth; re-read each use.
- **Drawing from the heap directly** — copy between steps (Anti-pattern 6 in ARCHITECTURE.md).
- **`"type": "module"` in the plugin's package.json** — the host `require()`s `index.js`.
- **React handlers or `useState` in the input path** — dropped coalesced samples and latency.
- **Applying predicted events to the sim** — preview only.
- **A second smoothing filter in the frontend** — mass is the stabilizer.
- **`std::sort` on emission order, `unordered_*` anywhere, `std::vector<bool>`** in state — the last has no contiguous canonical bytes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 | Own hash | Vendored PicoSHA2 (kernel's exact pin) | Verified header, same digests as `.tree`, `shasum -a 256` verifiable |
| PRNG | Own LCG or `<random>` | xoshiro256** + splitmix64 reference C | `<random>` distributions are implementation-defined; reference code is 20 lines |
| Ray-plane hit, camera, instancing, lines | Own WebGL2 | three.js `Raycaster`, `PlaneGeometry`, `InstancedMesh`, `LineSegments` | Locked by CLAUDE.md; proven on this Electron in the spikes |
| Worker/wasm bundling | Manual file copying and URL juggling | Vite 5 `new Worker(new URL(...), {type:'module'})`, library mode `es`, `worker.format: 'es'` | Cited Vite docs; emits chunks with `import.meta.url` intact |
| Wasm glue | Hand-written `WebAssembly.instantiate` + imports | Emscripten `MODULARIZE`/`EXPORT_ES6` factory | Handles memory, stack, `libc` imports, growth |
| Pen sample rate | `pointerrawupdate` first | `pointermove` + `getCoalescedEvents()` | Coalesced gives the full rate without a raw handler that "cannot keep up" |
| Test runner / CTest glue | Custom scripts | doctest `doctest_discover_tests` (already vendored) | Every `TEST_CASE` becomes a CTest entry |

**Key insight:** every hand-rolled piece in this phase is one more code path that must be bit-identical native and Wasm; the fewer of them the better, and the ones that remain (`fx64`, `isqrt`, the byte walk) are the ones whose correctness is the product.

## Runtime State Inventory

Not applicable — greenfield phase with no rename/refactor/migration and nothing on disk (no `.tree` writing in Phase 1). Verified: `data-drawing/` contains only `.claude/`, `.planning/`, `data-drawing-brief.md`, `README.md` [VERIFIED: `ls -la`].

## Common Pitfalls

### Pitfall 1: The CANV-04 spike is skipped and the surface is built against an assumed host
**What goes wrong:** Waves 2-4 finish in the dev page, then the custom-scheme `import()`/Worker/wasm path fails on CORS, MIME, or origin rules in Electron 32 and the last wave stalls.
**Why it happens:** The scheme design above is [ASSUMED]; module workers from custom schemes have platform-specific rules.
**How to avoid:** Make the 30-line spike the first host task, run it in the real `electron-vite dev` build and in a packaged build (`loadFile`), and record `isSecureContext`, `crossOriginIsolated`, worker spawn, wasm instantiate.
**Warning signs:** "Failed to fetch dynamically imported module", "Refused to execute script because its MIME type", `SecurityError` on `new Worker`.

### Pitfall 2: `-fwrapv` set on one preset and not another
**What goes wrong:** Release (`-O2`) hash differs from Debug on a fixture with an overflow the tests never noticed.
**How to avoid:** Put `-fwrapv` on the `ddsim` target's `PUBLIC` compile options in CMake so every preset (and the Emscripten link) inherits it; the UBSan preset (`-fsanitize=undefined -fno-sanitize-recover=all`) must run the full fixture set, not a subset.

### Pitfall 3: Signed-shift and unsigned-cast subtleties in `mul_q32`
**What goes wrong:** A `>>` on an `int64_t` that was accidentally declared `uint64_t`, or a sign-extension miss in the cross terms, gives results that are wrong only for negative operands — invisible in tests that use positive values.
**How to avoid:** The `__int128` oracle test with seeded random pairs across all four sign combinations, plus the `INT64_MIN` edge cases. C++20 guarantees the arithmetic shift; the guarantee only helps if the operand type is actually signed.

### Pitfall 4: The eraser end paints or the mouse never paints
**What goes wrong:** A fence written as `buttons !== 0` lets the eraser (buttons 32) paint; a fence written as `pointerType === 'pen'` only, with the mouse setting on, never accepts the mouse.
**How to avoid:** `paintable = (pointerType === 'pen' || (settings.mouse && pointerType === 'mouse')) && (buttons & 1) === 1`; record `pressureSource = 1` for mouse strokes (pressure is 0.5 by spec).

### Pitfall 5: Multiple samples per tick collapse to one
**What goes wrong:** The worker stores samples keyed by tick and overwrites, losing pen fidelity at 200+ Hz on a 60 Hz sim.
**How to avoid:** `(tick, index)` is the key; the body rule sub-steps by `1/n`; the fixture set includes a stroke with 4 samples per tick and one with a 3-tick gap.

### Pitfall 6: Edits to a preset mutate old strokes
**What goes wrong:** The brush table is keyed by name and "edit" writes in place; replay of an old stroke uses the new mass.
**How to avoid:** Brush versions are append-only with monotonically increasing ids; the stroke stores the id; the test "edit brush after stroke 1, paint stroke 2, replay" checks stroke 1's node hashes are unchanged (success criterion 4).

### Pitfall 7: WebGL context leak through the surface layer
**What goes wrong:** Opening/closing the surface a few times leaves the canvas blank (context cap).
**How to avoid:** `dispose()` calls `renderer.setAnimationLoop(null)`, `renderer.dispose()`, `renderer.forceContextLoss()`, terminates the worker, removes listeners; the dev page runs a 20-cycle open/close test like spike 005.

### Pitfall 8: The Wasm build uses a different PicoSHA2 or a different action encoder than native
**What goes wrong:** Golden mismatch that looks like a numeric bug.
**How to avoid:** One `sim/` tree, one encoder in C++ (the TS encoder is tested against C++ by round-tripping bytes through `dd_apply` and comparing hashes to the CLI).

## Code Examples

### `fx64` core (native and Wasm identical)

```cpp
// include/ddsim/fx64.hpp — Q32.32 on int64_t; compile every preset with -fwrapv
struct fx64 {
    int64_t raw;
    static constexpr int64_t ONE = int64_t{1} << 32;
    fx64() = default;
    fx64(float) = delete; fx64(double) = delete;          // a float can never enter
    static constexpr fx64 from_int(int32_t i) { return fx64{int64_t{i} << 32}; }
    static constexpr fx64 from_raw(int64_t r) { return fx64{r}; }
    static constexpr fx64 from_q16(int32_t q) { return fx64{int64_t{q} << 16}; } // ABI widening
    friend fx64 operator+(fx64 a, fx64 b) { return {a.raw + b.raw}; }
    friend fx64 operator-(fx64 a, fx64 b) { return {a.raw - b.raw}; }
    friend fx64 operator*(fx64 a, fx64 b) { return {mul_q32(a.raw, b.raw)}; }   // see § mul_q32
    friend bool operator<(fx64 a, fx64 b) { return a.raw < b.raw; }
    int32_t floor_to_int() const { return static_cast<int32_t>(raw >> 32); }
};
```

### CI grep as a CTest test (SIM-01 build gate)

```cmake
# sim/CMakeLists.txt — fails `ctest` if a forbidden token appears in the sim target's sources
add_test(NAME ddsim_forbidden_tokens
  COMMAND ${CMAKE_COMMAND} -DROOT=${CMAKE_CURRENT_SOURCE_DIR} -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/forbidden_tokens.cmake)
# cmake/forbidden_tokens.cmake
file(GLOB_RECURSE SRCS ${ROOT}/include/*.hpp ${ROOT}/src/*.cpp ${ROOT}/wasm/*.cpp)   # NOT third_party, NOT tests
foreach(f ${SRCS})
  file(READ ${f} txt)
  if(txt MATCHES "(^|[^A-Za-z0-9_])(float|double)([^A-Za-z0-9_]|$)|<cmath>|<random>|unordered_")
    message(FATAL_ERROR "forbidden token in ${f}")
  endif()
endforeach()
```
Also make it a configure-time check (same script via `include()`) so `cmake -B` itself fails — "the build fails" per success criterion 5.

### Worker snapshot and the main-thread float conversion

```ts
// sim.worker.ts — after the last step of this frame
const ptr = mod._dd_nodes_ptr(sim), n = mod._dd_node_count(sim), stride = mod._dd_node_stride()
const nodes = mod.HEAPU8.slice(ptr, ptr + n * stride)                 // copy; HEAPU8 re-read every time
const body  = mod.HEAPU8.slice(mod._dd_body_ptr(sim), mod._dd_body_ptr(sim) + BODY_BYTES)
postMessage({ kind: 'snapshot', tick, n, nodes: nodes.buffer, body: body.buffer }, [nodes.buffer, body.buffer])

// stage/nodes.ts — main thread, floats allowed here
const dv = new DataView(msg.nodes)
for (let i = 0; i < msg.n; i++) {
  const o = i * stride
  const x = Number(dv.getBigInt64(o + 8, true)) / 4294967296        // Q32.32 → float, LE
  ...
  instanced.setMatrixAt(i, m.makeTranslation(x, y, z)); instanced.setColorAt(i, colourFor(brushId))
}
instanced.instanceMatrix.needsUpdate = true
```

### Deterministic colour from the brush description (CANV-03)

```ts
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(s)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
export function colourFor(description: string): THREE.Color {
  return new THREE.Color().setHSL((fnv1a32(description) % 360) / 360, 0.6, 0.5)
}
```

### The fence (input.ts) — pen-only, capture, coalesced, quantize once

```ts
canvas.style.touchAction = 'none'
canvas.addEventListener('pointerdown', (ev) => {
  if (!paintable(ev)) return                       // pen && buttons&1  (mouse only behind the setting)
  canvas.setPointerCapture(ev.pointerId)
  const plane = frameFromCamera(camera)            // once per stroke; quantized to Q16.16
  const stroke = simHost.beginStroke(brushVersionId, plane, simHost.currentTick(), pressureSourceOf(ev))
  pushSamples(stroke, ev.getCoalescedEvents?.() ?? [ev])
})
canvas.addEventListener('pointermove', (ev) => {
  const stroke = openStrokeFor(ev.pointerId); if (!stroke) return
  pushSamples(stroke, ev.getCoalescedEvents?.() ?? [ev])          // recorded
  preview.setTail(ev.getPredictedEvents?.() ?? [])                // never recorded
})
function pushSamples(stroke, events: PointerEvent[]) {
  const tick = simHost.currentTick()
  for (const s of events) {
    const hit = rayPlane(camera, stroke.plane, s.clientX, s.clientY); if (!hit) continue
    stroke.push({ tick, index: stroke.nextIndex(tick),
      u: Math.round(hit.u * 65536) | 0, v: Math.round(hit.v * 65536) | 0,
      pressure: Math.round(s.pressure * 65535),
      tiltX: Math.round(s.tiltX), tiltY: Math.round(s.tiltY), twist: Math.round(s.twist),
      flags: (s.tiltX || s.tiltY ? 1 : 0) | (s.twist ? 2 : 0) | (stroke.pressureSource << 2) })
  }
  simHost.submitSamples(stroke)                    // optimistic feed; identical bytes replay later
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `protocol.registerFileProtocol` etc. | `protocol.handle(scheme, handler)` returning a `Response` | Electron 25 (pre-v25 methods deprecated) [CITED: electron protocol docs] | The CANV-04 file server is one handler with MIME + CORS headers |
| `Module.HEAPU8` always on `Module` | Must be listed in `EXPORTED_RUNTIME_METHODS` (STRICT mode / on-demand export) | Emscripten 3.1.x–4.x [CITED: emscripten docs + search] | Add `HEAPU8,HEAP32` to the link flags or the worker breaks silently |
| `pointermove` only (rAF-aligned, 60/s) | `getCoalescedEvents()` (Chrome 58) + `getPredictedEvents()`/`pointerrawupdate` (Chrome 77) | 2017–2019 [VERIFIED: chromestatus] | Full pen rate is available in Chromium 128 without a native tablet SDK |
| Implementation-defined signed `>>` | Arithmetic right shift guaranteed | C++20 [CITED: cppreference] | `mul_q32` may rely on `>>` for sign-extension |
| Vite `?worker` suffix | `new Worker(new URL(..., import.meta.url), { type: 'module' })` "recommended" | Vite 4/5 [CITED: v5 docs] | Standard syntax bundles and works in the plugin's lib build |

**Deprecated/outdated:**
- The roadmap's phrase "raw WebGL2 like the Phase 2.3 thread stage": 2.3 uses three.js's `WebGLRenderer` [VERIFIED: `02.3-04-PLAN.md:173`].
- The STACK.md sentence "native modules cannot safely be loaded in workers" is about Node addons; the Wasm worker needs no Node at all and runs under `sandbox: true`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A privileged `standard`+`secure`+`corsEnabled` custom scheme lets the `file://`/`localhost` document `import()` a module, spawn a module Worker from it, and instantiate a `.wasm`, given `Access-Control-Allow-Origin: *` and correct MIME | CANV-04 proposal | The surface cannot be loaded as designed; fallback: host serves the surface from the renderer's own origin (dev server `/@fs/` in dev, a copied `plugins/` tree under `out/renderer` in prod) — uglier but same contract |
| A2 | `file://` origins cannot spawn Workers in Chromium (motivating the custom scheme) | CANV-04 | If wrong, the scheme is still the better design for origin/CORS reasons |
| A3 | Vite needs `/* @vite-ignore */` on the runtime-string `import()` | CANV-04 renderer change | Build warning only |
| A4 | Node 20 `require()` refuses an ESM `index.js` when `"type":"module"` is set | Plugin package layout | Plugin fails to load with a clear reason; fix is renaming to `index.cjs` |
| A5 | Hacker's Delight `mulhs` decomposition as transcribed in `mul_q32` | fx64 | Caught immediately by the `__int128` oracle test |
| A6 | Jury-condition stability region `0<c_t<2`, `0<k_t<4-2c_t` and the recommended clamps `k_t≤1`, `c_t≤1`; preset masses 1/4/16/64 with `K=1`, `ζ=0.5` | Brush body | A preset oscillates or feels wrong; tune constants (rule version bump) |
| A7 | 64-bit id layout 8/32/24 bits; Q16.16 `int32` plane coordinates across the ABI | Ids, ABI | Layout choice is free until Phase 2 writes it down; if 24 bits/stroke is too few, widen before the grammar |
| A8 | 16-bit pressure loses nothing for this pen (driver levels ≤ 8192); DOM `tiltX/Y`/`twist` are integer-valued | Quantization | Provisional by roadmap; the measurement task decides; Phase 2 freezes |
| A9 | `EMSDK` env var exported by `emsdk_env.sh`; ES6 glue locates `ddsim.wasm` via `import.meta.url` in Node and in a module Worker | Toolchain | Discovered on the first wasm build in wave 1 (no behaviour to blame) |
| A10 | 32 MiB initial memory / 1 MiB stack are sufficient so growth never triggers in Phase 1 | Toolchain | Growth invalidates cached views; design re-reads them anyway |
| A11 | `slice()` + transfer list is a zero-copy move of the fresh buffer | Worker snapshot | Performance only |
| A12 | Module scripts are fetched in CORS mode (hence `corsEnabled` + ACAO header) | CANV-04 | Same as A1 |
| A13 | WebGPU adapter is present under Electron 32 on this M4 | Renderer | `forceWebGL: true` fallback; check `about:gpu` |
| A14 | The Wacom/driver on this Mac reports through `NSEventSubtypeTabletPoint` (tilt/twist present, sign as in the builder) | Pen | Measurement task; tilt/twist are best-effort by requirement |
| A15 | FNV-1a trace hash and colour hash choices | Hash/colour | Cosmetic / debugging only |

## Open Questions

1. **Exact CANV-04 contract accepted by the Tapestry roadmap**
   - What we know: no surface mechanism exists; the SDK anticipates "an isolated custom web surface for complex editors"; the plugin host's isolation stance is "policy, not a sandbox".
   - What's unclear: whether the outer project wants same-realm `import()` (proposed) or an iframe from day one, and whether it will accept a privileged scheme.
   - Recommendation: raise the proposal above as an outer-roadmap item (a `2.x` insertion or a Phase 4 pull-forward), schedule the spike as its first task, and keep `SurfaceModule` free of shared-realm assumptions so an iframe can replace the transport later.

2. **Should the `addon` preset be built in Phase 1?**
   - What we know: CLAUDE.md lists it; the roadmap's wave 1 names only the `wasm` preset; goldens give the cross-check for free; SIM-05 (native-vs-Wasm CI test) is v2.
   - Recommendation: defer; document the cmake-js pattern (verified above) so it is a half-day when wanted.

3. **Pressure width, tilt sign, eraser `buttons` on the actual device** — resolved by the wave-4 measurement task; the values feed Phase 2.

4. **WebGPU availability under Electron 32** — `about:gpu` manual check; both three entry points are kept live.

5. **Where the stage layer opens from** (command palette entry, toolbar button, or a node type's view) — Phase 1 needs one entry point; a `CommandContribution` "datadrawing.open" that the host wires to `openSurface` is the smallest change and reuses an existing contribution type.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| CMake ≥ 3.24 | ddsim build | ✓ | 4.4.1 | — |
| Apple clang (C++20) | native preset | ✓ | 14.0.3 | — |
| `emcc` / emsdk 6.0.10 | wasm preset (SIM-03) | ✗ | — | **Install step in wave 1** (network; ~1 GB); until then waves 1-2 are native-only |
| Node | tooling, Vitest wasm test | ✓ | 20.20.2 | — |
| npm workspaces | plugin package | ✓ | 10.8.2 | — |
| Electron | dev build for pen measurement and surface | ✓ | 32.3.3 | — |
| electron-vite / Vite | app dev server; plugin surface build | ✓ | 2.3.0 / 5.4.21 | — |
| Vitest | TS tests | ✓ | 2.1.9 | — |
| three / @types/three | surface | ✗ (not installed) | 0.186.0 on npm | Install into the plugin package after the legitimacy checkpoint |
| UBSan (clang `-fsanitize=undefined`) | tests | ✓ (Apple clang) [ASSUMED] | — | Skip the UBSan preset, keep `-fwrapv` |
| `__int128` | native oracle test only | ✓ (arm64 clang) [ASSUMED] | — | Use a `double`-free long-multiplication oracle |
| Pressure pen / tablet | pen measurement, success criteria 1-2 | assumed present (PROJECT.md "a pressure pen or tablet is available") | Wacom driver ≥ 6.4.13 per CLAUDE.md | Mouse behind the setting for development only |
| WebGPU adapter | `WebGPURenderer` | unknown | — | `forceWebGL: true` |
| Tapestry host extension point (CANV-04) | last wave | ✗ (does not exist) | — | None acceptable per roadmap; plugin dev loop until it lands |

**Missing dependencies with no fallback:**
- The CANV-04 host extension point — external; gates the last wave only.

**Missing dependencies with fallback:**
- emsdk (install), three (install after checkpoint), WebGPU (WebGL 2 path).

## Validation Architecture

> `.planning/config.json` sets `workflow.nyquist_validation: false` [VERIFIED]; this section is included because the phase brief explicitly asked for it and success criterion 5 is a test matrix.

### Test Framework
| Property | Value |
|----------|-------|
| Framework (C++) | doctest v2.5.3 (vendored) under CTest via `doctest_discover_tests` |
| Framework (TS) | Vitest 2.1.9 (plugin package config, `environment: 'node'`) |
| Config file | `data-drawing/sim/CMakeLists.txt` + `CMakePresets.json`; `plugins/data-drawing/vitest.config.ts` — none exist yet (Wave 0) |
| Quick run command | `cmake --build --preset native-debug && ctest --preset native-debug -R 'fx64|determinism' --output-on-failure` |
| Full suite command | `ctest --preset native-debug && ctest --preset native-release && ctest --preset native-ubsan && npm test -w plugins/data-drawing` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SIM-01 | No forbidden tokens in sim target; `-fwrapv`; UBSan clean | build gate + unit | `ctest -R ddsim_forbidden_tokens`; `ctest --preset native-ubsan` | ❌ Wave 0 |
| SIM-01 | `fx64` matches `__int128` oracle; `isqrt` exact; PRNG reference vectors | unit | `ctest -R 'fx64_oracle|isqrt|rng'` | ❌ Wave 0 |
| SIM-02 | Two runs same SHA-256; `restore(serialize())` hashes identically; Debug = Release = second process = committed golden | unit + golden | `ctest -R 'determinism|roundtrip|golden'` (CTest runs `ddsim_replay` twice and diffs) | ❌ Wave 0 |
| SIM-03 | Wasm module replays fixtures to the committed goldens in Node; Worker replay equals live hash | integration | `npm test -w plugins/data-drawing -- wasm-golden`; dev-page "replay from zero" button asserts equality (manual trigger, automated compare) | ❌ Wave 0 |
| STRK-01 | Samples carry `(tick,index)`, integers only; encoder round-trips through `dd_apply` | unit | `npm test -- encoder`; `ctest -R action_codec` | ❌ |
| STRK-02 | Stability clamp rejects bad presets; heavy lags more than light (path length / lag metric on a synthetic curve); 1× vs 4× ticks-per-frame identical | unit | `ctest -R 'brush_body|tpf_invariance'` | ❌ |
| STRK-03 | Insert-a-stroke keeps other strokes' ids; ids never from a counter (no `next_id` symbol) | unit + grep | `ctest -R id_stability` | ❌ |
| STRK-04 | Edit creates a new version; old stroke replays to identical node hashes; ≥3 presets differ in description and mass | unit | `ctest -R brush_versions` | ❌ |
| STRK-06 | Tilt/twist fields present in sample and codec; zero when absent | unit | `npm test -- encoder` | ❌ |
| CANV-01 | Node z equals plane z for all nodes of a stroke; frame recorded per stroke | unit | `ctest -R plane_frame` | ❌ |
| CANV-02 | Fence accepts pen+buttons&1, rejects eraser (buttons 32), hover, touch; mouse only with setting; predicted never enters samples | unit (jsdom-free: pure function `paintable()`/`pushSamples` with fake events) | `npm test -- fence` | ❌ |
| CANV-02 | Coalesced rate, pressure range, tilt sign on this Mac | **manual** (measurement task) | logged numbers in the phase verification | — |
| CANV-03 | Colour hash deterministic; overlay shows pen, body, spring | unit + manual | `npm test -- colour`; visual check | ❌ |
| CANV-04 | Surface loads through `registerSurface` in Tapestry with no app edits outside the extension point; 20 open/close cycles leak no contexts | integration (outer app) + manual | outer app test (main-process `plugin-host` test for `registerSurface`); manual open/close cycle | ❌ (outer) |
| Feel (SC 1) | Heavy preset lags and carries momentum; light follows | **manual** | — | — |
| Latency (SC note) | Pen-to-ink with and without worker split | **manual measurement** | dev-page timing overlay | — |

### Sampling Rate
- **Per task commit:** `ctest --preset native-debug -R '<area>'` (< 10 s)
- **Per wave merge:** full suite command above (all presets + Vitest)
- **Phase gate:** full suite green, goldens unchanged (or a reviewed regeneration), measurement numbers recorded, CANV-04 surface mounted in Tapestry

### Wave 0 Gaps
- [ ] `data-drawing/sim/CMakeLists.txt`, `CMakePresets.json`, `cmake/forbidden_tokens.cmake` — build, presets, grep gate
- [ ] `data-drawing/sim/tests/main.cpp` (doctest main) and first cases `fx64_oracle`, `determinism_noop`, `roundtrip`
- [ ] `data-drawing/sim/tests/golden/` — first golden (`noop.sha256`) written by `native-release`
- [ ] `plugins/data-drawing/{package.json,vitest.config.ts,tapestry.plugin.json,index.js}`
- [ ] emsdk 6.0.10 installed and `wasm-release` preset configuring
- [ ] Outer: `plugin-host` unit test for `registerSurface` (mirrors existing `plugin-facade.test.ts` style [VERIFIED: file exists at `app/src/main/plugin-facade.test.ts`])

## Security Domain

`security_enforcement: true`, ASVS level 1 [VERIFIED: config.json].

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (local single-user app) |
| V3 Session Management | no | — |
| V4 Access Control | yes (host) | The custom-scheme handler only serves files inside `<pluginsDir>/<validPluginId>/` (reuse `isValidPluginName` + realpath containment, exactly like `resolvePluginDir` [VERIFIED: `plugin-host.ts:868-874`]); never serve outside `plugins/` |
| V5 Input Validation | yes | `dd_apply`/`dd_restore` reject malformed or out-of-range bytes (lengths, sample counts, brush ids, non-monotonic ticks) — reject, never clamp; TS encoder validates integer ranges before encoding |
| V6 Cryptography | yes (integrity only) | SHA-256 via vendored PicoSHA2 for state hashes — not a security boundary, but never hand-rolled |
| V14 Configuration | yes | Surface module runs same-realm; document that a plugin surface is trusted code (same trust level as `require()`d plugin mains today); no `bypassCSP`, no `allowServiceWorkers` on the scheme |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `tapestry-plugin://<id>/../..` | Information disclosure | Validate plugin id; resolve and `realpath`; require prefix match; 404 otherwise |
| Hostile action bytes (huge sample count, tick overflow) reaching `dd_apply` | DoS / tampering | Bound `count` per action and per stroke; checked arithmetic on ticks; reject |
| Wasm heap out-of-bounds from a bad `len` | Tampering | Length-check every pointer/len pair in the ABI wrapper before touching the heap |
| Surface module abusing `window.tapestry` (e.g., `plugins.disable`) | Elevation | Accepted for Phase 1 as "policy, not sandbox" (documented); iframe isolation later |
| Worker script loaded from an unexpected origin | Spoofing | Only `tapestry-plugin://` URLs derived from the registered `entry` are imported; no user-supplied URLs |

## Sources

### Primary (HIGH confidence — read or executed this session)
- Outer codebase: `sdk/src/contributions.ts`, `sdk/src/index.ts`, `app/src/main/plugin-host.ts`, `app/src/main/index.ts`, `app/src/preload/index.ts`, `app/src/renderer/components/TreeFrame.tsx`, `app/src/renderer/App.tsx` (lines 88-140), `app/src/renderer/global.d.ts` (grep), `app/src/renderer/index.html`, `app/electron.vite.config.ts`, `app/forge.config.ts`, `app/package.json`, `app/vitest.config.ts`, root `package.json`, `plugins/example-plugin/*`, `plugins/tapestry-notes/index.js` (registerNodeView), `app/native/CMakeLists.txt`, `app/native/addon.cpp` (head), `app/src/main/kernel-bridge.ts` (addon path), `tapestry/CMakeLists.txt`, `tapestry/kernel/Digest.{hpp,cpp}`, `tapestry/kernel/Ids.hpp`, `tapestry/kernel_tests/main.cpp`, `tapestry/docs/tree/FORMAT.md` (branch-tag lines), `tapestry/third_party/picosha2/picosha2.h` (grep), `.planning/phases/02.3-time-threads/02.3-04-PLAN.md`, `.planning/spikes/CONVENTIONS.md`, `.claude/skills/spike-findings-tapestry/SKILL.md` + `references/editor-and-app-integration.md`
- Machine probes: `which emcc`, `cmake --version`, `clang --version`, `node --version`, `npm --version`, `sw_vers`, `uname -m`, installed package versions via `require(.../package.json)`
- Registries/APIs: `npm view` (three, @types/three, @webgpu/types), `gsd-tools query package-legitimacy`, GitHub API (emscripten tag 6.0.10, latest release), chromestatus.com API (features 5765569655603200, 6041426311774208), HTTP 200 on `cmake/Modules/Platform/Emscripten.cmake`
- Project docs: `data-drawing/.planning/{PROJECT,REQUIREMENTS,ROADMAP,STATE}.md`, `research/{SUMMARY,STACK,ARCHITECTURE,PITFALLS,FEATURES}.md`, both `CLAUDE.md` files, `.planning/config.json`

### Secondary (MEDIUM confidence — official sources fetched this session)
- Chromium: `components/input/web_input_event_builders_mac.mm`, `content/app_shim_remote_cocoa/render_widget_host_view_cocoa.mm`, `third_party/blink/renderer/core/events/pointer_event_factory.cc` (raw.githubusercontent.com, main)
- W3C Pointer Events (w3c.github.io/pointerevents); MDN `getPredictedEvents`, MDN Secure Contexts
- Emscripten: settings reference, downloads page, Building-Projects (CMake), Interacting-with-code (HEAP views, EXPORTED_FUNCTIONS)
- Vite 5: guide/features (workers, wasm), config/worker-options, guide/build#library-mode
- Electron: api/protocol, tutorial/sandbox
- cppreference: operator_arithmetic (C++20 shifts)
- prng.di.unimi.it: xoshiro256starstar.c, splitmix64.c

### Tertiary (LOW confidence — search only or derived)
- Semi-implicit Euler stability region (own derivation; web search corroborates `ω·dt < 2`)
- Emscripten HEAP export default change (search summary; the settings-reference wording is the authority: list them in `EXPORTED_RUNTIME_METHODS`)
- Hacker's Delight `mulhs` (page unreachable; algorithm transcribed from memory, oracle-tested)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for versions and machine state (probed); MEDIUM for Emscripten flags (docs, not executed)
- CANV-04 codebase facts: HIGH (read); CANV-04 proposal: LOW until the spike runs
- Architecture: MEDIUM — builds on project research, all in-repo precedents verified
- Pen input: MEDIUM-HIGH — Chromium source and spec cited; device behaviour unmeasured
- Fixed-point details: MEDIUM — well-known algorithms with oracle tests specified; constants are proposals
- Pitfalls: MEDIUM

**Research date:** 2026-09-22
**Valid until:** 2026-10-22 for stack/toolchain facts (Emscripten and three move monthly); codebase facts valid until the outer repo changes `sdk/` or `plugin-host.ts`
