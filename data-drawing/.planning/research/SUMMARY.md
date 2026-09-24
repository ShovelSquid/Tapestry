# Project Research Summary

**Project:** Data Drawing
**Domain:** Deterministic fixed-point 3D particle simulation with a pressure-pen painting frontend, journaled through Tapestry's `.tree` kernel and hosted as a Tapestry plugin in an Electron/TypeScript renderer on macOS Apple silicon
**Researched:** 2026-09-22
**Confidence:** MEDIUM

## Executive Summary

Data Drawing is a drawing program whose marks are nodes, not pixels, on a living canvas whose time can be paused, scrubbed and reversed. The systems it most resembles are not drawing apps but deterministic-replay engines (RTS lockstep, GGPO rollback, Factorio replays, Drawpile's command log): an append-only action log is the only source of change, a simulation that is a pure function of (seed, rule versions, actions, tick) derives all state, and a view layer reads that state and never writes it. Tapestry's kernel already supplies the first layer (SHA-256 chained commits stamped with a tick, replay to any commit, readable `.tree`). This milestone builds the other two: a C++20 fixed-point sim module `ddsim` with zero dependencies, and a painting plugin that records raw pen samples as tick-stamped stroke actions and shows the node field through a deterministic placeholder renderer. No product surveyed combines a command log, a tick-simulated canvas and a human-readable file; that combination is the differentiator, and the drawing-program table stakes (pressure curve, coalesced input, stabilization, eraser, undo, transport) exist so the differentiator ships inside something that feels like a drawing program.

The four researchers converged on the load-bearing decisions. One C++20 source is built twice: natively (CTest, a `ddreplay` hash oracle CLI) and to WebAssembly (the live sim in a Web Worker inside the renderer), which works because Wasm integer arithmetic is fully specified and the sim contains no floats. The spring-damper brush body lives inside the sim, integrating tick-quantized raw samples in fixed point, so "mass" is a versioned property of the material and old strokes replay with their original feel. Node ids derive from `(stroke ordinal, emission index)`, never from a counter, so Tapestry Phase 3 branches can share them without renumbering. Kernel `advance` commits are coalesced (before each stroke and on pause/close), never one per tick. Scrubbing replays from tick zero with an ephemeral in-RAM keyframe ring; persistent snapshots and branching are Phase 3's job. Two things are outside this project's control and must be raised now: no Tapestry plugin can ship a WebGL/WebGPU surface today (`TreeFrame.tsx` resolves node views from a compiled-in map), and Tapestry Phase 3's "numeric compatibility envelope" wording must be tightened to "identical or invalid" for Data Drawing worlds.

The key risks are all of the "cannot be retrofitted" kind: a float leaking into the authoritative path through quantization, projection or a `real` in `.tree`; undefined-behaviour overflow or unordered containers making native and Wasm hashes diverge; counter-allocated ids; frontend smoothing recorded instead of raw samples; and Chromium's pen pipeline dropping or misreporting samples on this Mac. Mitigation is structural, not disciplinary: a determinism harness (per-tick hashes across Debug/Release, two processes, native vs Wasm) exists before any behaviour does; a CI grep bans `float`, `double`, `<cmath>`, `<random>` and `unordered_` from the sim target; a single quantization function at the input boundary writes integers into the action; and the actual pen on the actual Mac is verified in the first weeks, not in the painting phase.

## Key Findings

### Recommended Stack

The sim core is a dependency-free C++20 static library using an in-house `fx64` Q32.32 type on `int64_t` with a portable four-partial-product multiply (so native and Wasm execute the same instruction sequence; `__int128` and `fpm` are test oracles only), xoshiro256** seeded via splitmix64 with per-entity derived streams, integer `isqrt`, no trig (store directions as vectors), `-fwrapv` everywhere and UBSan in tests. State hashing walks a canonical little-endian byte layout: SHA-256 (the kernel's vendored PicoSHA2) at commit and checkpoint boundaries so a person can verify with `shasum`, and a fast 64-bit hash in a per-tick trace mode for bisecting divergence. The same source builds through three CMake presets: `native` (Apple clang, doctest, `ddreplay`), `wasm` (Emscripten 6.0.10, `-sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker,node`, flat `extern "C"` ABI) and `addon` (cmake-js 8 + node-addon-api 8.9, for Node-side cross-checks and a future `utilityProcess` host). Emscripten is not installed on this Mac (Apple clang 14 has no wasm32 target) and must be pinned in `CMakePresets.json`; a toolchain version is a "pinned version" in the core value sense.

The renderer side stays inside the app's existing pipeline (electron-vite 2 / Vite 5, Vitest 2.1.9, TypeScript 5.9). Pen input is W3C Pointer Events only: Chromium's macOS builder maps NSEvent tablet data to `pressure`, `tiltX/Y`, `twist` and `tangentialPressure` (verified in source), `getCoalescedEvents()` recovers the full sample rate, and `getPredictedEvents()` feeds the preview tail only. For the stage, STACK recommends three.js r186 `WebGPURenderer` (automatic WebGL 2 fallback) and ARCHITECTURE recommends raw WebGL2 like the Phase 2.3 thread stage. Recommendation: **three.js**, because orbit controls, plane raycasting, `TransformControls` for moving the plane and instanced points are exactly what it ships and the milestone-1 placeholder must not depend on compute or storage buffers anyway; reconsider raw WebGL2 only if the host surface extension point constrains bundle size. Electron 32 (Chromium 128) supports everything needed but is out of Electron's support window; note an upgrade for the Tapestry roadmap, not this project.

**Core technologies:**
- C++20 `ddsim` static library with in-house `fx64` Q32.32: authoritative state and rules; integer-only C++ is the one language that compiles bit-identically to a native addon and to Wasm
- CMake >= 3.24 presets `native | wasm | addon` from one source: CTest and the `ddreplay` oracle natively, the live sim as Wasm in a renderer Web Worker
- Emscripten 6.0.10 (pinned, not yet installed): Wasm build; Wasm integer semantics are fully specified, so the golden-hash test proves native ≡ Wasm
- xoshiro256** + splitmix64, PicoSHA2, doctest v2.5.3: PRNG, hash and tests, all already vendored or public domain; `<random>` is banned because distributions are implementation-defined
- three.js 0.186 (`three/webgpu`, WebGL 2 fallback) + `@types/three` in lockstep: orbit camera, camera-facing plane raycast, instanced placeholder renderer
- Pointer Events L3 in Chromium, no native tablet addon: pressure, tilt, coalesced events; quantized once at the plugin boundary into integers
- Kernel SDK `kernel.submit` with the existing `AdvanceOp`: no new verb, no new value type; the plugin owns node types `datadrawing/stroke@1`, `brush@1`, `canvas@1`, `checkpoint@1`

### Expected Features

Every process-recording product surveyed records either video (Procreate, Krita Recorder, Rebelle) or commands without a simulation tick (Drawpile). Data Drawing borrows the feel layer from drawing apps, the time layer from simulation tools, and the meaning layer from paint-with-words research, and is the only one to combine a command log, a deterministic tick-simulated canvas and a human-readable file. Undo is the hardest table stake: milestone-1 undo is a recorded *retract* action (history intact, no log truncation); true branch-at-tick undo arrives with Phase 3.

**Must have (table stakes):**
- Pressure drives stroke weight with a pressure curve stored as a brush-version parameter (raw pressure recorded; curve applied in the sim so replay does not depend on machine settings)
- Tilt captured and recorded when available (best-effort; no rule depends on it until verified on this Mac)
- Coalesced high-rate sampling via `getCoalescedEvents()`; predicted events preview-only, never recorded
- Stabilization = the spring-damper brush body in the sim, plus a pulled-string dead zone and finish-line on pen-up; one model, exposed as brush parameters, no menu of algorithms
- Radius, spacing/density, brush picker with three or four presets differing in description and mass
- Eraser as a recorded remove-nodes action (needs stable ids); undo as a recorded retract action
- Orbit camera, camera-facing painting plane that can be moved; smoothing distances in plane units with a documented zoom rule
- Immediate feedback from a deterministic placeholder renderer with a cursor showing pen position, brush body position and the spring between them (makes mass legible)
- Transport: play, pause, step, speed as ticks-per-frame (never FPS capping), reverse as decreasing scrub target, scrubber with stroke markers
- Read-only stroke inspector (description, tick, brush version, weight, velocity)
- Save/open through the kernel; a person can identify each stroke, description, tick and branch in the `.tree` without the plugin

**Should have (competitive):**
- Free-text brush description as the mark's durable payload (a hash-to-color placeholder gives it a visual now; the model render is milestone 5)
- Versioned, immutable brush definitions; editing creates a new version, old strokes keep theirs
- Mass-driven feel from the material itself (heavy lags and carries momentum; smoke does not)
- Bit-identical replay with per-checkpoint hash verification and a first-divergent-tick diff tool
- Living canvas with one data-driven material rule (weight settling), scrubbable in both directions
- 3D node space with a recorded per-stroke plane frame; camera is never recorded

**Defer (v2+):**
- Snapshot-accelerated scrubbing, branch-at-tick undo, "edit the past forks a branch" (Tapestry Phase 3)
- Edit actions on existing marks, rebind strokes to a newer brush version, user-editable pressure curve UI, tilt-driven parameters, time-lapse export from replay (v1.x)
- Groups/instancing/bindings, data-driven material library, model render with regional prompting, tile tree and procedural spawning, math/SDF/generator brushes (brief milestones 3 to 7)
- Anti-features: raster layers, video recording, wall-clock frontend smoothing, float or GPU-parallel sim, per-node state in `.tree`, destructive undo, brush edits that mutate old strokes, live collaboration

### Architecture Approach

Three strictly separated layers with a **deterministic fence** between input capture and the action builder: left of the fence (renderer) floats, wall clocks and pointer timing are fine; right of it the sim sees only integers already written into a recorded action. The sim is a pure C++20 module with no knowledge of Tapestry, Electron or the DOM, reached through a flat C ABI; the same bytes go to the live Wasm instance and to the journal, so the live view is an optimistic computation of what replay will produce, and any disagreement with the native oracle is a bug report with a tick number, not data loss. The action is the raw sampled pen path plus brush version and plane frame; nodes are emitted along the brush body's integrated path at spacing multiples, so node count is not known at record time and per-node state is never committed. Two stroke codecs (TS in the plugin, C++ in `ddreplay`) decode one golden `.tree` fixture; the sample-block grammar is a one-way door into an append-only journal and must be checkpointed with Kaelen before the first real commit. State is POD struct-of-arrays so `serialize()`, `restore()` and `hash()` share one canonical byte walk and a keyframe is a cheap copy today and a Phase 3 snapshot tomorrow.

**Major components:**
1. **Sim core** (`data-drawing/sim`) — `fx64`, ids, RNG, brush table, brush body, node arrays, versioned rules (`BrushBody`, `Emit`, `Settle`), `apply/step/hash/serialize/restore`, sleeping nodes, trace mode; built native and Wasm
2. **Stroke codec** (`plugins/data-drawing/shared` + C++ mirror) — sim actions ↔ `.tree` ops; one `stroke@1` node per stroke with a readable `samples` text block, one `brush@1` node per brush version
3. **Plugin main side** (`plugins/data-drawing/index.js`) — registers node types and commands, commits coalesced `advance` + stroke proposals via `KernelAPI.submit`, reconstructs the ordered action list on open, predicts the stroke ordinal from `getNextIds()` and treats a mismatch as a hard error
4. **Sim host** (renderer TS, Web Worker) — loads the Wasm sim, fixed-timestep accumulator draining whole ticks only (no fractional final step), tick-stamps actions, exposes read-only typed-array views copied between steps, replays for scrubbing; interface async-shaped from day one
5. **Painting surface** (renderer) — orbit camera, camera-facing plane frame captured once at pen-down, native (non-React) pointer listener with capture and `touch-action: none`, ray-plane unproject and quantize once, placeholder instanced renderer, cursor overlay, timeline controls
6. **`ddreplay` CLI** (`sim/tools`) — opens a `.tree` through the kernel library, replays natively, verifies checkpoint hashes, bisects to the first divergent tick; the CI oracle the Wasm build must match
7. **Tapestry kernel** (exists, unchanged) — ordering, tick monotonicity, ids, durability, SHA-256 chain, readability fallback

### Critical Pitfalls

1. **A float leaks into the authoritative path through a side door** (quantization, projection, a `real` in `.tree`, TS `number` above 2^53, a brush constant written as `0.1`) — one quantization function at the boundary writes integers into the action; plane-local coordinates and plane pose recorded as fixed-point ints; `.tree` sim quantities are `int` with the Q-format declared once; CI grep fails on `float|double|<cmath>` in `sim/src`
2. **Fixed-point that is deterministic but wrong or undefined** (overflow wraps, signed overflow is UB so `-O2` diverges from `-O0`, truncation vs arithmetic-shift rounding drift, libm-backed `sqrt`) — range analysis picks Q32.32; portable widening multiply; `-fwrapv` plus UBSan; one documented rounding rule; fixed-iteration integer sqrt; per-tick hashes compared across Debug/Release, `-O0`/`-O2`, two processes and native vs Wasm
3. **Ordering and randomness nondeterminism no numeric policy can fix** (`unordered_*`, `std::sort` on ties, pointer keys, threads, `<random>` distributions, one global stream) — every iterated collection is a vector in stable id order; `stable_sort` ending in id; no threads this milestone; own PRNG with per-entity streams derived from `(seed, purpose, id)`; renderer jitter never touches a sim stream
4. **Time leaks and the tick contract** (frame cadence steering the sim, `advance 1` per tick, a live-vs-recorded one-tick race) — actions apply at the start of their stamped tick before physics; samples carry `(tick, index)`; `step()` takes no arguments; advance lazily before a stroke and on pause/close; live hash must equal replayed hash at every commit boundary
5. **Committing derived state, or committing smoothed input instead of raw** — only strokes and brushes are committed; raw quantized samples in one text block per stroke; feel lives in the versioned brush body; a golden `data-drawing` example `.tree` regenerated byte-for-byte in the readability suite
6. **Counter-allocated ids that renumber on the first fork** — `NodeId = {stroke ordinal (branch-tagged), emission index}`; high bits reserved for Phase 3's branch tag now; a test replays two logs differing by one inserted stroke and checks shared ids survive
7. **Chromium's pen pipeline drops or misreports samples** (frame-aligned `pointermove`, mouse pressure 0.5, hover painting, palm touches, Electron/Wacom history) — coalesced events on a native listener, paint only on `pointerType === 'pen'` and `buttons & 1`, pointer capture, a `pressure_source` flag, and measure the real device early

## Implications for Roadmap

The four research files disagree on build order only at the edges: PITFALLS wants a numeric foundation first, ARCHITECTURE wants a sim skeleton plus determinism harness first, STACK wants emsdk and the preset trio from day one. These are the same phase. The numeric type is useless without the state, hash and harness that test it; the harness is meaningless without the type; and the native ≡ Wasm proof is cheapest to establish on a no-op skeleton, before any behaviour exists to blame when it fails. So Phase 1 is all three at once. Everything after follows the dependency chain: behaviour on top of the harness, the journal grammar before any UI can pressure it, the host surface gap and Wasm host before the painting surface can exist, the timeline last because it only makes sense once there is something to scrub.

### Phase 1: Numeric Foundation and Determinism Harness
**Rationale:** Every "cannot be retrofitted" pitfall is prevented here or never. Establishing the three-preset build and native ≡ Wasm on a skeleton costs a day now and weeks later.
**Delivers:** `fx64` Q32.32 with deleted float constructors and portable mulhi; `Ids` with reserved branch-tag bits; `Rng` with per-entity streams; POD `State` (trivially copyable, static-asserted); no-op `step()`; canonical `serialize/restore/hash` (SHA-256 at boundaries, fast 64-bit trace mode); CMake presets `native | wasm | addon`; emsdk 6.0.10 installed and pinned; doctest suite: two runs same hash, 100 replays, snapshot round-trip, Debug vs Release, two processes, native vs Wasm on the skeleton; CI grep banning `float|double|<cmath>|<random>|unordered_`; `fx64` cross-checked against `fpm` as oracle; sim version, fx format id, RNG version and tick-hz defined as pinned constants. Side task with zero dependencies: **pen verification spike** on this Mac in the Electron dev build (pressure range, tilt presence and sign, `pointerType`, coalesced rate, eraser end, `pointerrawupdate`, `isSecureContext`), numbers written down for Phase 5.
**Addresses:** Foundation for bit-identical replay (FEATURES P1 "fixed-point node model + tick", "deterministic replay + hash").
**Avoids:** Pitfalls 1, 2, 4, 12 (float leak, fixed-point UB, randomness, numeric contract).

### Phase 2: Sim Behaviour — Actions, Brush Body, Emission, One Material
**Rationale:** With the harness in place, behaviour can be added rule by rule with golden hashes catching any regression. Settling is sim-only and cheap; putting it here (rather than last, as ARCHITECTURE suggests) means `ddreplay` and the timeline have something alive to show from the moment they exist, and rule versioning is exercised before the grammar is frozen.
**Delivers:** `DefineBrush` and `Stroke{brush, planeFrame, samples[]}` actions with `.tick`; tick-scheduled samples consumed in order with documented sub-steps; semi-implicit Euler spring-damper brush body with stiffness/damping per tick clamped to the stable region and asserted in the brush validator; spacing-based node emission with `(stroke, index)` ids; pressure curve, radius, spacing as brush-version parameters; dead zone and bounded finish-line on pen-up; sleeping nodes; a versioned data-driven `Settle` rule; measured headless ticks-per-second at a representative node count; golden-hash fixtures of synthetic strokes; insert-a-stroke id-stability test; identical geometry at 1x and 4x ticks-per-frame.
**Uses:** `ddsim` native build, doctest.
**Implements:** Sim core rules; Patterns 3, 4, 5 (emission as pure function, stable ids, feel in the sim).
**Avoids:** Pitfalls 3, 7, 10 (ordering, identity, brush stability).

### Phase 3: Journal Codec, Advance Policy and `ddreplay`
**Rationale:** The sample-block grammar is a one-way door into an append-only journal. It must be judged on real files, with Kaelen, before UI pressure shapes it, and the sim/kernel seam must be proven with no UI in the loop.
**Delivers:** node types `datadrawing/stroke@1`, `brush@1`, `canvas@1` (seed, tick-hz, sim/fx/RNG version pins as properties, since the SDK cannot emit `x-` lines), `checkpoint@1`; readable `samples` text block grammar (one sample per line, integer fields, magnitudes below 2^53); TS codec and C++ codec against one golden fixture; two-commit stroke pipeline (`advance Δ` then stroke with `tick int` and `sim.hash text`) and advance-on-pause/close; bounds on `advance n` and samples per stroke in the reader; `ddreplay` CLI reading a `.tree` through the kernel library, verifying checkpoint hashes and bisecting to the first divergent tick; a `data-drawing` example added to Tapestry's `readability` suite; a note filed into Tapestry Phase 3 planning to tighten the numeric envelope to "identical or invalid".
**Addresses:** "Stroke action schema via kernel", "readable `.tree` fallback", hash-diff tool.
**Avoids:** Pitfalls 5, 6, 12 (time leaks, derived state, numeric contract).

### Phase 4: Wasm Sim Host and Tapestry Renderer Surface Extension
**Rationale:** The painting surface cannot exist until a plugin can own a canvas in the renderer, and building UI on a Wasm sim that silently diverges from the oracle would waste the milestone. This phase contains the one item outside this project's control; raise it with the Tapestry roadmap at the start of the project, not when Phase 4 begins.
**Delivers:** flat C ABI (`dd_create/apply/step/hash/serialize/positions_ptr`); Wasm build loaded in a Web Worker with transferred `ArrayBuffer` snapshots (no `SharedArrayBuffer`); `SimHost` TS wrapper with async interface, fixed-timestep accumulator draining whole ticks with a clamp, pause and ticks-per-frame; Vitest native-vs-Wasm hash cross-check on the golden fixtures via the `addon` preset; **Tapestry host extension point** for a plugin renderer surface bundle (the "isolated custom web surface for complex editors" already anticipated in Tapestry's SDK table), or as a flagged interim the surface compiled into the app like `NoteCard`; `about:gpu` check that WebGPU/Metal is available under Electron 32.
**Uses:** Emscripten, cmake-js addon, Vite worker bundling, electron-vite.
**Implements:** Pattern 6 (one source, two builds; renderer runs the live sim); Pattern 2 (fixed timestep, double-buffered read).
**Avoids:** Anti-patterns 3 and 6 (fractional final step, reading mid-step memory); Electron-specific APIs in the plugin.

### Phase 5: Painting Surface
**Rationale:** Everything the user touches, built on a proven sim, a frozen grammar and a real host surface. Pen facts from the Phase 1 spike become requirements here.
**Delivers:** three.js stage with orbit camera and movable camera-facing plane; plane frame captured once at pen-down and recorded in fixed point; native pointer listener with `setPointerCapture`, `touch-action: none`, pen-only painting behind a mouse setting, `buttons & 1`, coalesced events recorded, predicted events preview-only; quantize-and-tick-stamp at the fence; optimistic feed to the live sim; commit pipeline with ordinal prediction check; deterministic placeholder instanced renderer colored from a hash of the brush description; cursor overlay of pen, brush body and spring; brush picker with presets, size slider; eraser as a recorded remove action; undo as a recorded retract action; read-only inspector; measured pen-to-ink latency with and without the worker split.
**Uses:** three.js r186, Pointer Events, SDK contributions.
**Implements:** Painting surface component; Pattern 1 (tick-stamped actions behind the fence).
**Avoids:** Pitfalls 9, 10, 11 (pen pipeline, visible brush body, render never feeds the sim).

### Phase 6: Timeline and Reopen Verification
**Rationale:** Scrubbing is the proof that "the file is the truth" and needs strokes, a living material and a renderer to be meaningful. Its performance work (sleeping, keyframe ring) is sim-side and was designed in during Phase 2.
**Delivers:** play/pause/step, speed as ticks-per-frame, reverse as decreasing scrub target, scrubber with stroke markers, scrub by replay-from-zero plus an ephemeral in-memory keyframe ring keyed by `(branch, tick, versions)` and verified against from-zero hashes (never written to disk); reopen-time replay verifying every checkpoint hash in the Wasm build; painting while scrubbed off-head blocked with a visible cue, ticks-per-frame reset to 1 on pen-down; measured scrub latency and reverse frame rate on a recorded 10-minute session; save/reopen of a settled world reproduces the settled state.
**Addresses:** Transport and scrubber, living canvas, bit-identical replay across save/reopen.
**Avoids:** Pitfall 8 (scrub with no cache); UX pitfalls around off-head painting and speed changing feel.

### Phase Ordering Rationale

- **Harness before behaviour, behaviour before format, format before UI.** Each pitfall that "cannot be retrofitted" (floats, UB, ordering, ids, grammar) is prevented in the phase where its artifact is first created, and the phase after verifies it.
- **Phases 1 to 3 are headless and native-first.** They prove the core value ("same file, seed, pinned versions, same hash") with `ddreplay` and CTest before Electron, Wasm or a pen enters the picture; `ddreplay` is also what Phase 3 of Tapestry will consume.
- **The Wasm build and the native ≡ Wasm test are established on the Phase 1 skeleton** so toolchain problems surface with no behaviour to confuse them, and re-run as a gate on every later phase.
- **The two external dependencies are surfaced at the start**, even though they are consumed in Phase 4 and later: the host renderer surface extension point (Tapestry roadmap) and the Phase 3 numeric envelope wording. The pen spike is likewise pulled forward to Phase 1 because it is cheap, blocks several table stakes, and its failure modes (electron#7815) would change Phase 5's design.
- **Settling moves into Phase 2** (from ARCHITECTURE's step 7) because it is sim-only, exercises rule versioning early, and gives Phases 3 to 6 a living world to verify against.
- **Eraser, undo and inspector sit in Phase 5**, not a separate phase: they are thin over stable ids and the placeholder renderer, and the retract-action undo shapes the action schema, which must be settled by Phase 3.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3:** the kernel's `FORMAT.md`, `Kernel.hpp` commit-tick semantics, `readability` suite conventions and the Phase 2.3 `thread.log` grammar must be read closely; the grammar is irreversible and needs a discussion checkpoint with Kaelen.
- **Phase 4:** the Tapestry host surface extension point is unbuilt and cross-project; needs codebase research into `TreeFrame.tsx`, `plugin-host.ts`, preload/IPC and the SDK contribution model, plus verification of Vite worker/`.wasm` bundling under electron-vite 2 and whether `crossOriginIsolated` is reachable (LOW confidence).
- **Phase 5:** three LOW-confidence items from STACK (eraser-end detection, real pen-to-ink latency in a sandboxed renderer, `pointerrawupdate` under Electron 32) and the Wacom-in-Electron history; Phase 1's spike answers most of it, but three.js `WebGPURenderer` inside Electron 32 and the plane/orbit interaction design still need verification.

Phases with standard patterns (skip research-phase):
- **Phase 1:** fixed-point, PRNG, canonical hashing and determinism harnesses are thoroughly documented (Box2D, Gaffer, Factorio) and STACK already resolved the version and design choices.
- **Phase 2:** spring-damper with symplectic Euler, distance-based emission and sleeping are well-trodden; the pitfalls file already specifies the stability bounds and tests.
- **Phase 6:** fixed-timestep transport and replay-from-keyframe scrubbing follow established game-engine patterns; the risks are performance measurements, not unknowns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Versions verified against npm and GitHub releases (HIGH); Chromium tablet mapping read from source (HIGH); runtime behaviour on this Mac (latency, eraser, `pointerrawupdate`, WebGPU adapter under Electron 32) untested (LOW) |
| Features | MEDIUM | Every product claim cross-checked against vendor docs; no HIGH-tier provider available; Corel Painter control names and current Chromium-on-macOS pen `pointerType` behaviour are LOW |
| Architecture | MEDIUM | Everything about the Tapestry kernel, SDK and app read directly from source (HIGH); domain patterns rest on four agreeing primary sources but are web-sourced (rated LOW by the seam); `crossOriginIsolated` under Electron unverified |
| Pitfalls | MEDIUM | Local-codebase facts HIGH; numeric-determinism and Chromium-input claims cross-checked (MEDIUM); nothing tested on this Mac yet |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Pen on this Mac in Electron:** pressure range, tilt sign, `pointerType` for the Wacom, coalesced sample rate, eraser end, `pointerrawupdate`, driver permissions. Run the spike in Phase 1; record numbers in the phase verification; Phase 5 requirements cite them.
- **Host renderer surface extension point:** does not exist; needs a Tapestry-side plan or a flagged interim. Raise with the Tapestry roadmap at project start; Phase 4 cannot be planned without the answer.
- **Tapestry Phase 3 numeric envelope:** PROJECT.md flags the conflict; file the "identical or invalid" note during Phase 3 of this project and confirm Phase 3's snapshot key includes the plugin's sim hash and version pins.
- **Renderer choice (three.js vs raw WebGL2):** researchers split; recommendation is three.js, confirm in Phase 5 discussion against the host surface constraints and the 2.3 stage precedent.
- **Sim placement (worker vs renderer main thread):** STACK says worker from the first non-spike cut, ARCHITECTURE says main thread first behind an async interface. Recommendation: async `SimHost` from day one, worker by the end of Phase 4; main thread only for the initial spike.
- **Tick rate:** 60 Hz recommended (matches display and Phase 2.3 cadence); PITFALLS notes a rate dividing the pen cadence may be preferable. Decide deliberately in Phase 2 and record it in the `canvas@1` node; changing it later is a new world.
- **Pressure quantization width:** 12-bit (ARCHITECTURE) vs 16-bit (STACK/PITFALLS); pick one in Phase 3 with the grammar, sized to what the driver delivers.
- **Emscripten `__int128` and per-tick SHA-256 cost:** both mitigated by design (portable mulhi, fast trace hash) but neither measured; Phase 1 harness should record ticks-per-second native and Wasm.
- **Electron 32 out of support:** not this project's call; note for the Tapestry roadmap and rebuild the addon with cmake-js if the app upgrades.

## Sources

### Primary (HIGH confidence)
- Tapestry codebase, read directly: `tapestry/kernel/Kernel.hpp`, `Ops.hpp`, `World.hpp`, `Ids.hpp`, `Time.hpp`, `Value.hpp`, `Digest.hpp`; `tapestry/docs/tree/FORMAT.md`; `sdk/src/index.ts`, `contributions.ts`; `app/native/addon.cpp`, `app/src/main/index.ts`, `kernel-bridge.ts`, `plugin-host.ts`; `app/src/renderer/components/TreeFrame.tsx`; `.planning/phases/02.3-time-threads/*`; `semantic-world/*`; `.planning/ROADMAP.md`, `REQUIREMENTS.md`
- npm registry and GitHub releases (2026-09-22): electron, three, @types/three, node-addon-api, cmake-js, @webgpu/types, electron-vite, vite, typescript, vitest, Emscripten 6.0.10, doctest v2.5.3, fpm v1.1.0, BLAKE3 1.8.7
- Chromium `components/input/web_input_event_builders_mac.mm` (tablet pressure/tilt/twist mapping); three.js r186 `WebGPURenderer.js`; `fpm` `fixed.hpp`/`math.hpp`; WebAssembly core spec numerics; Chrome WebGPU release notes; Vigna/Blackman xoshiro reference
- Machine facts: Apple M4, macOS 26.6.2, Node 20.20.2, CMake 4.4.1, Apple clang 14.0.3 (no wasm32), no emcc

### Secondary (MEDIUM confidence)
- Deterministic replay patterns: Gaffer On Games (lockstep, fix your timestep, floating-point determinism), SnapNet netcode parts 1 and 2, Factorio FFF-47 and desync wiki, Box2D v3 determinism notes, Bruce Dawson, Jakub Tomsu fixed timestep
- Drawing-program feel: Krita manual (freehand brush stabilizer, dynamic brush mass/drag, particle engine, recorder), Procreate handbook (brush studio, pressure curve, time-lapse), Lazy Nezumi smoothing, Clip Studio vector layers, Concepts, Blender Grease Pencil
- Simulation and time tools: Rebelle 8 manual and about page, Adobe Fresco live brushes, Corel Painter particle brushes, Drawpile wiki/FAQ/recording indexes, Houdini caching docs, Powder Toy hotkeys, Affinity history
- Chromium pen input: aligned input events, MDN `getCoalescedEvents` / `pointerrawupdate`, Nolan Lawson input handling, Nutrient coalesced events, Bugzilla 1822714, electron#7815, W3C pointer-events list, Wacom support articles (driver 6.4.13, macOS 26 pen-click bug)
- Electron: process model, utilityProcess, multithreading docs; electron#41763 (WebGPU adapter), electron#31789 (SAB under `loadFile`); chromium graphics-dev thread on Mac low-latency canvas
- Paint-with-words: NVIDIA Canvas GauGAN2 blog, eDiff-I, SpaText, paint-with-words-sd
- Diffusion reproducibility: Hugging Face diffusers reproducibility and MPS docs, pytorch#84516, #97236, diffusers#292
- `<random>` distributions implementation-defined: Arthur O'Dwyer, MSVC docs

### Tertiary (LOW confidence)
- Eraser-end detection, pen-to-ink latency and `pointerrawupdate` under Electron 32 on macOS — not verified; Phase 1 spike
- `crossOriginIsolated` / `SharedArrayBuffer` availability under Electron's custom protocol — unverified; design avoids SAB
- Electron `protocol` docs as the single source for `file://` being a secure context — check `window.isSecureContext`
- Corel Painter individual particle control names — training memory; NVIDIA Canvas current status — FAQ unreachable
- Falling-sand game determinism/rewind — no source; treated as absent

---
*Research completed: 2026-09-22*
*Ready for roadmap: yes*
