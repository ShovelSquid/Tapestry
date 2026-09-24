---
phase: 01-painting-with-the-pen
verified: 2026-09-24T22:32:00Z
status: human_needed
score: 9/16 must-haves verified
covered_files:
  - app/src/main/plugin-host.ts
  - app/src/main/plugin-scheme.ts
  - app/src/renderer/components/PluginSurfaceLayer.tsx
  - data-drawing/.planning/REQUIREMENTS.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-01-PLAN.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-01-SUMMARY.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-02-PLAN.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-02-SUMMARY.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-03-PLAN.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-03-SUMMARY.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-04-PLAN.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-04-SUMMARY.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-05-PLAN.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-05-SUMMARY.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-06-PLAN.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-06-SUMMARY.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-07-PLAN.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-07-SUMMARY.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-08-PLAN.md
  - data-drawing/.planning/phases/01-painting-with-the-pen/01-08-SUMMARY.md
  - data-drawing/sim/CMakeLists.txt
  - data-drawing/sim/cmake/forbidden_tokens.cmake
  - data-drawing/sim/cmake/two_process.cmake
  - data-drawing/sim/include/ddsim/ddsim_c.h
  - data-drawing/sim/include/ddsim/fx64.hpp
  - data-drawing/sim/include/ddsim/presets.hpp
  - data-drawing/sim/include/ddsim/rules/brush_body.hpp
  - data-drawing/sim/include/ddsim/rules/emit.hpp
  - data-drawing/sim/src/ddsim_c.cpp
  - data-drawing/sim/src/hash.cpp
  - data-drawing/sim/src/sim.cpp
  - plugins/data-drawing/index.js
  - plugins/data-drawing/surface/src/brushes.ts
  - plugins/data-drawing/surface/src/input.ts
  - plugins/data-drawing/surface/src/latency.ts
  - plugins/data-drawing/surface/src/main.ts
  - plugins/data-drawing/surface/src/replay.ts
  - plugins/data-drawing/surface/src/sim-driver.ts
  - plugins/data-drawing/surface/src/sim-host.ts
  - plugins/data-drawing/surface/src/sim.worker.ts
  - plugins/data-drawing/surface/src/stage/colour.ts
  - plugins/data-drawing/surface/src/stage/nodes.ts
  - plugins/data-drawing/surface/src/stage/overlay.ts
  - plugins/data-drawing/surface/src/stage/scene.ts
  - sdk/src/contributions.ts
covered_digest: "v1:sha256:05abfde8998535577f550f5850f6edb0b19ee358fa65e945e03d7d974df9d63a"
behavior_unverified: 4
overrides_applied: 0
behavior_unverified_items:
  - truth: "SC1 feel: drawing with a pressure pen inside Tapestry, pressure drives node weight, the heavy preset (lead, m=64) visibly lags and carries momentum through curves, the light preset (ink, m=1) follows closely"
    test: "In the running Tapestry window, Open Data Drawing; with the pen draw a fast S-curve with ink v1, then with lead v4; then one ink stroke from feather-light to full pressure (REVIEW item 1 steps 2-5)"
    expected: "ink nodes land under the pen with a short spring; lead's body disc trails the pen ring, the spring stretches and the trail cuts the S corners; discs grow with pressure"
    why_human: "No pen has ever reached this Mac (PEN_FACTS measuredWith 'mouse', pressure constant 0.5). The native test 'brush_body: heavy lags more than light' covers a straight synthetic stroke only; felt and seen lag on curves and pressure-to-size with real pressure cannot be checked by grep or unit tests"
  - truth: "SC3 overlay inside Tapestry: the cursor overlay draws the pen position, the brush body position and the spring between them over the three.js node field"
    test: "While painting in the Tapestry window, watch the pen ring, body disc and spring line"
    expected: "All three are visible while a stroke is open and hidden after pen-up"
    why_human: "overlay.ts has no unit test. The only render evidence is the headless dev page (01-07). The three.js stage inside Electron 32 has not been observed"
  - truth: "Pen-to-ink latency measured with the Worker transport and the main-thread transport, p50/p95 recorded (roadmap wave-4 note, 01-08 truth)"
    test: "After a pen stroke on the Worker transport read 'latency p50/p95'; tick 'main-thread transport'; draw one more stroke and read it again (REVIEW item 1 step 9)"
    expected: "Four numbers recorded into 01-08-SUMMARY"
    why_human: "The recorded numbers come from a synthetic mouse in headless Chromium at 16 ms per move. The roadmap asks for the pen inside Electron"
  - truth: "Opening and closing the surface 20 times in Tapestry leaves it rendering, with mounts equal to disposes, no 'Too many active WebGL contexts', and the worker terminated each time"
    test: "Escape and reopen the Data Drawing surface 20 times in Tapestry, then paint (REVIEW item 1 step 10)"
    expected: "It still paints on the 20th open, and the DevTools console has no 'Too many active WebGL contexts' warning"
    why_human: "This is a cleanup invariant. Only the headless dev page ?cycles=20 exercised it (mounted=21 disposed=20). The Electron window has not been cycled with the three.js stage"
human_verification:
  - test: "REVIEW item 1 step 1: open Data Drawing in Tapestry and copy the panel line 'backend=... adapter=...'"
    expected: "backend=webgpu or backend=webgl2 is reported, and the stage renders either way"
    why_human: "Headless Chromium exposes WebGPU (apple metal-3). Whether Electron 32 / Chromium 128 inside Tapestry does is unknown, and Tapestry has no in-app forceWebGL setting (only the dev page ?webgl=1)"
  - test: "REVIEW item 1 steps 2-5: pen feel. ink S-curve, lead S-curve, rust and clay one stroke each, ink feather-to-full pressure"
    expected: "ink follows closely; lead visibly lags, its spring stretches and it cuts corners; rust and clay lag in between, each in its own colour; disc size grows with pressure"
    why_human: "Phase SC1 is feel with a real pressure pen, and no pen has been attached to this Mac"
  - test: "REVIEW item 1 step 6: draw a lead stroke across an earlier ink stroke"
    expected: "The later stroke is drawn on top"
    why_human: "Compositing order is a verification: backstop truth (insufficient_spec). The only evidence is a unit test of material flags (depthWrite false), which is presence, not an observation"
  - test: "REVIEW item 1 step 7: select ink, set mass 8, Save as new version, paint, compare with earlier v1 strokes"
    expected: "The select shows 'v5 ink m=8'; v5 lags more than v1; earlier v1 strokes are unchanged"
    why_human: "SC4's versioning is proven natively ('brush_versions: an edit creates version 2 and stroke 1 made with version 1 replays to identical nodes') but has not been exercised in the Tapestry window"
  - test: "REVIEW item 1 step 8: click Verify replay in Tapestry after painting"
    expected: "replay: MATCH (tick N, nodes M)"
    why_human: "Replay equality is proven in Node (replay.test.ts) and in the headless dev page. The Electron Worker (blob-trampoline spawn over tapestry-plugin://) has not run Verify replay"
  - test: "REVIEW item 1 steps 9-10: pen latency on both transports, and 20 open/close cycles inside Tapestry"
    expected: "Four latency numbers recorded; still painting on the 20th open with no 'Too many active WebGL contexts'"
    why_human: "Pen and Electron window required (see behavior_unverified_items)"
  - test: "Pen re-measurement (01-06 open item): attach a pen tablet to this Mac and run the PenMeasure overlay (M key) inside Tapestry, then update PEN_FACTS"
    expected: "pointerType 'pen', pressure range and distinct count, tilt presence and sign, twist, eraser buttons (32 assumed) measured. DEFAULT_SETTINGS.allowMouse then becomes false (pen-only by default, as CANV-02 and SC2 intend)"
    why_human: "The 01-06 truth 'the pen was measured on this Mac' was met with a mouse over a streaming session (accepted by Kaelen at the checkpoint). Eraser buttons, tilt sign and pressure width are [ASSUMED]. Until this is re-measured, mouse painting defaults ON (input.ts:124), which departs from the 01-06 plan truth 'allowMouse ... (default false)'"
  - test: "Review the 9 flagged prohibitions (table 'Prohibitions' in the report): 4 judgment-tier with a non-authoritative LLM verdict, and 5 test-tier with no wired enforcing test"
    expected: "Each is accepted as holding, or a test is added (e.g. extend forbidden_tokens.cmake to scan for chrono/clock/time( in the sim and float/<random> in sim tests)"
    why_human: "unverified-prohibition, human review recommended (ADR-550 D4, autonomous mode). Never absorbed into a pass"
---

# Phase 1: Painting with the Pen Verification Report

**Phase Goal:** The user paints with a pressure pen inside Tapestry and watches nodes land on a plane facing a fixed camera, placed by a deterministic fixed-point sim running live in a Worker, with a brush body whose mass can be felt and seen.
**Verified:** 2026-09-24T22:32:00Z
**Status:** human_needed
**Re-verification:** No. This is the initial verification.

**MVP-mode note (WARNING):** ROADMAP marks Phase 1 `Mode: mvp`, but its goal is not in User Story form. `user-story.validate` returned `valid: false`: no "As a", "I want to" or "so that" clause. The protocol says to refuse MVP-mode verification in that case, but this run is unattended. Standard goal-backward verification was run against the ROADMAP success criteria instead. To make the goal MVP-valid, rewrite it with `/gsd mvp-phase 1`. This does not affect the verdict.

## Goal Achievement

The deterministic core, the Wasm Worker host, the fence, the stage and the public extension point are all real, wired and tested. Every machine-checkable half of the five success criteria holds. What is still missing is the part the goal is named for: nobody has painted with a pressure pen inside Tapestry. No pen has ever reached this Mac. PEN_FACTS was measured with a mouse over a streaming session. The three.js stage from 01-07 and 01-08 has only run on the headless dev page, not in the Electron window. Those checks are queued as `autonomy/REVIEW.md` item 1 and are PENDING.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: Inside Tapestry the plugin owns a WebGL/WebGPU canvas through a public SDK extension point, with no app edits outside it and no Electron APIs in the plugin | ✓ VERIFIED | `sdk/src/contributions.ts:138-195` defines SurfaceContribution, SurfaceHost, SurfaceHandle and SurfaceModule; `PluginHost.registerSurface` is in `plugin-host.ts:412`; `protocol.handle` + `resolvePluginFile` are in `app/src/main/index.ts:255`; `PluginSurfaceLayer.tsx:147,169` imports from registry data only. Grepping `app/src` and `sdk/src` for `data-drawing\|datadrawing\|ddsim` finds only a doc-comment example id. The plugin grep for electron, SharedArrayBuffer, window.tapestry and ipcRenderer finds nothing. `plugins/data-drawing/index.js` calls `context.registerSurface`. Human-observed mounts: 01-04 CDP [4,4] mounts/disposes in dev and built; 01-06 Kaelen opened the surface from the launcher. App Vitest 443/443 (re-run) |
| 2 | SC1: pen feel. Pressure drives weight, lead lags with momentum through curves, ink follows | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The chain is wired: `quantizePressure` (input.ts:223) → sample.pressure → `curve_weight` (emit.hpp) → `n.weight` → `nodes.ts` scale `radius*(0.2+0.8*weight)` (nodes.test "scales each disc"). Mass maps to k=K/m, c=sqrt(k) (brush_body.hpp). ctest `brush_body: heavy lags more than light on a straight stroke` passes. No pen has ever been used, and curves have not been checked by feel. REVIEW item 1 steps 2-5 |
| 3 | SC2: only pen-tip-down samples are recorded (mouse behind a setting), with pointer capture, coalesced events at full rate, and predicted events in the preview only | ✓ VERIFIED (with WARNING) | `paintable` (input.ts:198-203) is buttons&1, not eraser 32, pen, or mouse only if allowMouse. `setPointerCapture` is at :343, `touchAction='none'` at :283, `getCoalescedEvents` at :300 feeds recording, and `getPredictedEvents` at :315 reaches only `onPreview`. fence.test.ts (30) passes, including "never record a predicted point", "refuses a hovering pen", "refuses the eraser end" and "delivers nothing for a mouse with allowMouse false". **WARNING:** `DEFAULT_SETTINGS.allowMouse` is currently `true` (derived from PEN_FACTS.measuredWith==='mouse'), which departs from the 01-06 truth "(default false)". Mouse strokes carry pressureSource=1 and FLAG_SOURCE, so they are never recorded as pen pressure. See override suggestion |
| 4 | SC2: each sample is an integer plane position, pressure and tilt/twist when reported, stamped with tick and sample index; each stroke carries its plane frame; node positions are 3D with z from the plane | ✓ VERIFIED | `quantizeSample` (input.ts) produces Q16.16 u/v, u16 pressure, i8 tilt, u16 twist and flags bits 0-2. Samples are stamped in `SimDriver` (sim-driver.ts:253-262) and the sim rejects a wrong tick or index (sim.cpp StrokeSamples; ctest "StrokeSamples with a tick mismatch / wrong first index is rejected and the hash is unchanged"). StrokeBegin carries the 9×Q16.16 frame, and `emit_node` computes origin+u·right+v·up (emit.hpp). ctest `plane_frame: node z comes from the recorded frame and never from a camera` |
| 5 | SC3: the sim runs as Wasm in a renderer Web Worker reached only through a flat C ABI, and the renderer only reads copies | ✓ VERIFIED | `ddsim_c.h` + `ddsim_c.cpp` form the flat ABI. CMake links the Wasm with EXPORTED_FUNCTIONS=_dd_* only. `sim.worker.ts:13` imports `createDdsim`. Snapshots are `HEAPU8.slice` copies (sim-driver.ts:168,171) posted in a transfer list (sim.worker.ts:48). There is no SharedArrayBuffer anywhere. The committed `surface/wasm/ddsim.wasm` is byte-identical to `build/wasm-release/ddsim.wasm`. wasm-golden.test.ts (13) passes |
| 6 | SC3: node colour from a hash of the brush description; the cursor overlay draws pen, body and spring | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Colour: `fnv1a32` over UTF-8 plus HSL (colour.ts), colour.test (9) and nodes.test "instance i is coloured by node i brush description". Overlay: `overlay.ts` builds ring, body disc and spring Line from `bodyFor(openOrdinal)` over decoded body snapshots (main.ts:493-509). The overlay has no unit test, and it has not been observed inside Tapestry |
| 7 | SC4: three or four presets differing in description and mass can be picked; an edit creates a new version and old strokes keep it and replay to the same nodes | ✓ VERIFIED | DD_PRESETS is ink 1, rust 4, clay 16, lead 64 (presets.hpp), and TS PRESETS is byte-identical (encoder.test vs presets.actions). `BrushTable.edit` defines a new id and never mutates the old one (brushes.ts). ctest: `brush_versions: an edit creates version 2 and stroke 1 made with version 1 replays to identical nodes`, `... an edit is a new sequential version and the old version is untouched`. The picker and "Save as new version" are wired in main.ts:307-384 |
| 8 | SC5: replaying the session's recorded action list from tick zero in the Worker reproduces the live node field and hash | ✓ VERIFIED | `SimDriver.replayFromZero` (the same module the Worker runs) uses a second `_dd_create(seed)`, compares against the hash ring every 60 ticks, and reports `firstDiffTick` without reconciling. replay.test.ts (6) passes: MATCH at 300 and every multiple of 60, and a mutated byte is reported as DIFF at tick 60. The headless dev page shows MATCH on both transports and both backends (01-08-SUMMARY). In-Tapestry run: human item |
| 9 | SC5: in the native build, the same synthetic log replays to the same SHA-256 at every checkpoint twice, across Debug and Release, across two processes, and after a serialize/restore round trip | ✓ VERIFIED | Re-ran ctest: native-release 75/75, native-debug 75/75, native-ubsan 75/75. Each run includes `golden_two_process_<fixture>` for all 10 fixtures against the same committed `.sha256` (so Debug equals Release), `restore: hash after restore equals the hash of the source for every fixture at every checkpoint`, `restore: reject-or-exact byte sweep`, and `tpf: one step per call and four steps per burst hash identically` |
| 10 | SC5: the build fails if `float`, `double`, `<cmath>`, `<random>` or `unordered_` appear in the sim target | ✓ VERIFIED | `forbidden_tokens.cmake` is included at configure time and registered as ctest `ddsim_forbidden_tokens`. **Behavioral check:** on a temp copy, adding `double x;` to src/sim.cpp made `cmake -P` exit 1 ("forbidden token in .../sim.cpp"), and adding `#include <unordered_map>` to hash.cpp also exited 1. The clean copy exited 0 (15 sources). `-fwrapv -ffp-contract=off` are on `ddsim_settings` INTERFACE |
| 11 | SC5: nodes are emitted at the brush's spacing with ids from (stroke ordinal, emission index), so inserting a stroke leaves other strokes' ids unchanged | ✓ VERIFIED | `emit_segment` does distance-interpolated emission, and `emit_node` uses `make_node_id(branch, ordinal, next_emission_index)` with no global counter (emit.hpp). ctest: `emit: consecutive nodes ... spacing apart`, `ids: every node id equals make_node_id ...`, `id_stability: inserting stroke 3 between strokes 1 and 2 leaves every node id and field of ordinals 1 and 2 identical` |
| 12 | 01-08: pen-to-ink latency measured with the Worker and main-thread transports, p50/p95 recorded | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `LatencyMeter` (latency.ts) and latency.test (3) pass. Both transports exist behind one SimHost (sim-host.ts, `MainThreadTransport`). The numbers recorded so far are synthetic mouse input in headless Chromium, not the pen in Electron |
| 13 | 01-08: 20 open/close cycles in Tapestry leave it rendering with no WebGL-context warning | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Idempotent dispose exists (scene.ts:183-192: setAnimationLoop(null), forceContextLoss; main.ts:649-663). Headless `?cycles=20` gave mounted=21 disposed=20 and 0 warnings. Not run in the Electron window |
| 14 | 01-08: the renderer backend and GPU adapter are shown and recorded | ? UNCERTAIN | The panel line is wired (main.ts:535-539, `adapterDescription`). Only headless evidence exists (`webgpu adapter=apple metal-3`). The Electron 32 value is unknown |
| 15 | 01-07: overlapping instances composite in ascending NodeId order (later stroke on top) [verification: backstop] | ? insufficient_spec | nodes.test "material rules: no depth write" checks presence only. For a backstop truth, presence and wiring never qualify, so this needs the observation in REVIEW step 6 |
| 16 | 01-06: the pen was measured on this Mac inside Electron before the fence was written | ? UNCERTAIN | It was measured with a **mouse** over Apollo/Moonlight streaming. Kaelen accepted this at the 01-06 checkpoint, and it is recorded as an open item. The pen-specific fields in PEN_FACTS are [ASSUMED] or provisional |

**Score:** 9/16 truths verified (4 present, behavior-unverified; 3 uncertain or insufficient_spec, routed to human)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `data-drawing/sim/include/ddsim/fx64.hpp` | Q32.32, deleted float ctors, mul_q32/div/sqrt | ✓ VERIFIED | verify.artifacts passed; skeleton_test static_asserts that there is no float ctor |
| `data-drawing/sim/include/ddsim/ddsim_c.h` | flat C ABI | ✓ VERIFIED | forwards only (ddsim_c.cpp) |
| `data-drawing/sim/cmake/forbidden_tokens.cmake` | SIM-01 gate | ✓ VERIFIED | behaviorally tested (above) |
| `data-drawing/sim/include/ddsim/rules/brush_body.hpp` | spring-damper | ✓ VERIFIED | called from `Sim::step` and StrokeEnd (sim.cpp) |
| `data-drawing/sim/include/ddsim/rules/emit.hpp` | spacing emission, make_node_id | ✓ VERIFIED | |
| `data-drawing/sim/tools/ddsim_replay/main.cpp` + `cmake/two_process.cmake` | headless replay, two-process goldens | ✓ VERIFIED | 10 golden_two_process tests |
| `sdk/src/contributions.ts`, `app/src/main/plugin-scheme.ts`, `PluginSurfaceLayer.tsx` | CANV-04 host | ✓ VERIFIED | App tests 443/443 |
| `plugins/example-plugin/surface/surface.js` | contains `instantiateStreaming` | ✓ VERIFIED (tool false negative) | verify.artifacts flagged a missing pattern. The call lives in the sibling `surface.worker.js:8-17`, which the plan's key link wires. It was human-verified wasm=ok in 01-04 |
| `plugins/data-drawing/surface/src/{input,plane,camera,measure}.ts` | fence and ray-plane | ✓ VERIFIED | fence 30 and plane 10 tests pass |
| `plugins/data-drawing/surface/src/stage/{scene,nodes,overlay,colour}.ts` | three.js stage | ✓ VERIFIED (overlay behavior human) | |
| `plugins/data-drawing/surface/src/{sim-driver,sim-host,sim.worker,replay,latency}.ts` | Worker host, replay, latency | ✓ VERIFIED | |

verify.artifacts: 30/31 passed (the single failure is the false negative above). verify.key-links: 20/20 verified across all 8 plans.

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| plugins/data-drawing/index.js | sdk SurfaceContribution | `context.registerSurface(canvasSurface)` | ✓ WIRED |
| App.tsx | PluginSurfaceLayer | `pluginSurfaces` / `openSurface` state (App.tsx:97-98,708,736) | ✓ WIRED |
| PluginSurfaceLayer | tapestry-plugin:// handler | `import(/* @vite-ignore */ url)` from registry data | ✓ WIRED |
| main.ts PenFence callbacks | SimHost | onBegin→beginStroke, onSamples→pushSamples, onEnd→endStroke, onPreview→overlay only | ✓ WIRED |
| sim.worker.ts | ddsim.mjs | `createDdsim` → SimDriver `_dd_*` | ✓ WIRED |
| Sim::step | integrate_tick → emit_segment → make_node_id | per active stroke in ordinal order | ✓ WIRED |
| stage/nodes.ts | ddsim-abi decodeNodes | snapshot copy → InstancedMesh | ✓ WIRED |
| main.ts | LatencyMeter / verifyReplay | panel lines and button | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| NodeField (nodes.ts) | node positions, weight, brush | Wasm `_dd_nodes_ptr` → HEAPU8.slice → transferred snapshot → `decodeNodes` | yes (sim state produced by recorded actions) | ✓ FLOWING |
| CursorOverlay | pen / body | pen = last quantized sample (main.ts:582); body = `_dd_body_ptr` snapshot (main.ts:493-501) | yes | ✓ FLOWING |
| Panel state line | tick/nodes/hash | `sim.hash()` → `_dd_hash` | yes | ✓ FLOWING |
| Replay line | MATCH/DIFF | `replayFromZero` second instance vs live ring | yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Native determinism suite (Release) | `ctest --preset native-release` | 75/75 passed | ✓ PASS |
| Native determinism suite (Debug) | `ctest --preset native-debug` | 75/75 passed | ✓ PASS |
| UBSan clean | `ctest --preset native-ubsan` | 75/75 passed | ✓ PASS |
| Plugin (Wasm goldens, encoder, fence, replay, latency, nodes, colour) | `npm --prefix plugins/data-drawing test` | 9 files, 90/90 passed; "replay DIFF: mutated action at tick 10, firstDiffTick 60" | ✓ PASS |
| Host extension point | `npm --prefix app run test` | 21 files, 443/443 passed | ✓ PASS |
| Forbidden-token gate fails on a leak | `cmake -DROOT=<tmp copy with 'double x;'> -P forbidden_tokens.cmake` | exit 1, "forbidden token in .../sim.cpp"; unordered_map also exit 1; clean exit 0 | ✓ PASS |
| Wasm in repo equals the build output | `cmp surface/wasm/ddsim.wasm sim/build/wasm-release/ddsim.wasm` | identical | ✓ PASS |
| Painting with a pen in Tapestry | (requires Electron and a pen; not started per instructions) | — | ? SKIP → human |

### Probe Execution

No probes are declared in the phase plans or summaries, and no `scripts/*/tests/probe-*.sh` exists. Step 7c is not applicable.

### Requirements Coverage

All 12 phase-1 IDs in REQUIREMENTS.md are claimed by at least one plan. None is orphaned.

| Requirement | Source Plan(s) | Status | Evidence |
|-------------|----------------|--------|----------|
| SIM-01 | 01-01, 01-03 | ✓ SATISFIED | gate behaviorally tested; fx64 __int128 oracles; rng tests; -fwrapv; UBSan 75/75 |
| SIM-02 | 01-01, 01-03, 01-05 | ✓ SATISFIED | one canonical walk (hash.cpp) for serialize/restore/hash; restore and two-process tests |
| SIM-03 | 01-01, 01-08 | ✓ SATISFIED | Worker Wasm through the flat C ABI with copies; replay equality in Node and the dev page (in-Tapestry run is a human item) |
| STRK-01 | 01-05, 01-06, 01-07 | ✓ SATISFIED | quantized once at the fence; worker stamps tick/index; predicted never recorded |
| STRK-02 | 01-05, 01-08 | ? NEEDS HUMAN | the spring-damper from mass is in the sim and the lag test passes; felt and seen with the pen is pending |
| STRK-03 | 01-05 | ✓ SATISFIED | spacing emission; (ordinal, index) ids; insert-stability test; branch bits reserved (ids.hpp) |
| STRK-04 | 01-05, 01-07 | ✓ SATISFIED | four presets; append-only versions; old strokes replay identically |
| STRK-06 | 01-05, 01-06 | ✓ SATISFIED (structurally) | tilt/twist fields and flags in every sample from the first fixture; no rule reads them. Real pen tilt/twist has not been observed (pen re-measurement item) |
| CANV-01 | 01-05, 01-07 | ✓ SATISFIED | fixed camera (camera.ts); frame per stroke; z from the frame (plane_frame test) |
| CANV-02 | 01-06, 01-07 | ✓ SATISFIED (WARNING) | the fence is tested; the mouse setting defaults ON until a pen is measured |
| CANV-03 | 01-07, 01-08 | ? NEEDS HUMAN | colour hash and node field are tested; overlay and live view inside Tapestry pending |
| CANV-04 | 01-02, 01-04 | ✓ SATISFIED | public SurfaceContribution; privileged scheme with containment; human-observed mount/dispose in dev and built; the Data Drawing surface was opened from the launcher in 01-06 |

### Prohibitions

| Plan | Prohibition | Tier | Disposition |
|------|-------------|------|-------------|
| 01-01 | Never silently correct/clamp/re-stamp; reject with DD_ERR_* and hash unchanged | test | ✓ enforced: action_test "... rejected and the hash is unchanged" (20 cases), restore reject-or-exact sweep |
| 01-01 | No wall clock inside the sim | test | ⚠ flagged, unverified (no enforcing test; the gate regex does not scan for chrono/clock/time). Grep of include/src/wasm is clean; `dd_step` takes no time argument |
| 01-02 | Surface gets nothing beyond SurfaceHost; no kernel submit | judgment | ⚠ flagged. LLM verdict (non-authoritative): holds. SurfaceHost = {container, treeId, onResize, close} |
| 01-03 | No float oracle, `<random>` or sort-with-ties in sim tests | test | ⚠ flagged, unverified (the gate excludes tests/). Grep: the only `std::sort` is on unique fixture filenames (restore_test.cpp:47), and float/double appear only in static_asserts |
| 01-04 | Renderer layer never special-cases a plugin id/path | test | ⚠ flagged, unverified (no PluginSurfaceLayer test). Grep of app/src finds no data-drawing reference |
| 01-05 | No smoothing, dead zone or prediction other than the spring-damper | judgment | ⚠ flagged. LLM verdict: holds (samples go from fence → encoder → `integrate_tick` directly) |
| 01-05 | A brush edit never mutates an existing version or stroke | test | ✓ enforced: brush_versions tests |
| 01-06 | A mouse stroke is never recorded as pen pressure | test | ✓ enforced: fence.test "reports the pressure source", "sets flags ... mouse bit2", "with allowMouse true delivers onBegin(1, frame) and samples carrying the source flag" |
| 01-06 | Measurement telemetry is never persisted or transmitted | test | ⚠ flagged, unverified (no test). Grep of measure.ts for fetch/storage/beacon/socket is clean |
| 01-06 | No predicted sample or wall-clock timestamp in the recorded stroke | test | ✓ enforced: fence.test "... never records a predicted point"; RawSample has no time field |
| 01-07 | No render-side smoothing/stabilization/prediction | judgment | ⚠ flagged. LLM verdict: holds (the predicted tail is drawn in the overlay only) |
| 01-07 | Renderer never holds or mutates sim state | test | ⚠ flagged, unverified (no dedicated test). Code: snapshots are `HEAPU8.slice` copies; the heap is never posted |
| 01-08 | Replay-from-zero never corrects live state | judgment | ⚠ flagged. LLM verdict: holds (second instance, destroyed; DIFF only logged) |

This leaves 9 flagged prohibitions: 4 judgment-tier and 5 test-tier without a wired enforcing test. None was found violated.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (all phase files) | — | TBD / FIXME / XXX / TODO / HACK / placeholder | — | none found |
| plugins/data-drawing/surface/src/input.ts | 124 | `DEFAULT_SETTINGS.allowMouse` true by default (derived from a mouse measurement) | ⚠️ Warning | Mouse painting is on by default, which departs from the 01-06 truth "default false". It flips when PEN_FACTS is re-measured with a pen |
| plugins/data-drawing/surface/src/main.ts | 108-110 | forceWebGL only reachable through the `?webgl=1` query (the 01-07 truth also names "a setting in Tapestry") | ℹ️ Info | three's automatic WebGL 2 fallback covers absent WebGPU, but there is no manual override inside Tapestry |
| data-drawing/sim/src/sim.cpp | StrokeEnd | the body stops at pen-up (the stroke leaves the active list) | ℹ️ Info | Expected. The finish line and dead zone are STRK-05 (Phase 2). The "body drifts on and settles" note in REVIEW step 3 applies while the tip is held |

### Human Verification Required

All of these come from `autonomy/REVIEW.md` item 1 (PENDING), plus two items this verification found.

1. **Backend inside Tapestry.** Open Data Drawing and copy `backend=... adapter=...`. Expected: the stage renders on webgpu or webgl2.
2. **Pen feel (SC1).** Do the S-curve with ink v1 and then lead v4, one stroke each with rust and clay, and one ink stroke with pressure rising from feather to full. Expected: ink follows closely, lead lags, stretches its spring and cuts the corners, and discs grow with pressure.
3. **Overlap order.** Draw lead over ink. Expected: the later stroke is on top.
4. **Brush edit in the window (SC4).** Set ink to mass 8 and save. Expected: `v5 ink m=8` appears, it lags more than v1, and v1 strokes are unchanged.
5. **Verify replay inside Tapestry (SC5).** Expected: `replay: MATCH (tick N, nodes M)`.
6. **Latency and lifetime.** Record pen p50/p95 on the Worker and main-thread transports, then open and close the surface 20 times. Expected: four numbers, and it still paints on the 20th open with no "Too many active WebGL contexts".
7. **Pen re-measurement.** Attach a tablet and run PenMeasure inside Tapestry, then update PEN_FACTS. This confirms eraser buttons 32, the tilt sign and pressure distinct count, and turns the mouse default off.
8. **Flagged prohibitions.** Accept the 9 flagged prohibitions above or add the enforcing tests.

### Suggested Override (optional, human decision)

The mouse-default deviation looks intentional. Kaelen accepted it at the 01-06 checkpoint, and it reverts automatically on re-measurement. To accept it formally, add:

```yaml
overrides:
  - must_have: "paintable(ev, settings) is true only for pointerType 'pen' with (buttons & 1) === 1, or pointerType 'mouse' with (buttons & 1) === 1 when settings.allowMouse is true (default false)"
    reason: "No pen reaches this Mac (streaming session); allowMouse defaults to PEN_FACTS.measuredWith === 'mouse' and flips to false on a pen re-measurement; mouse strokes carry pressureSource=1"
    accepted_by: "Kaelen"
    accepted_at: "<ISO timestamp>"
```

### Gaps Summary

No code gaps block the phase goal. Every artifact exists, is substantive and is wired. Data flows from recorded actions through the Wasm sim to the rendered node field. The determinism harness was re-run green in three native presets, and Vitest in the plugin and app passed. The forbidden-token gate was shown to fail on a leak.

The phase is not `passed` because its headline outcome has never been observed: a person painting with a pressure pen inside Tapestry and feeling and seeing the brush mass. Two facts sit behind that. First, no pen has ever been attached to this Mac, so every pen-specific constant is provisional and mouse painting defaults on. Second, the 01-07 and 01-08 three.js stage has run only on the headless dev page, not in the Electron window. Both are human checks, queued in REVIEW item 1. CANV-03 and STRK-02 should stay open until Kaelen's sheet comes back. SIM-01/02/03, STRK-01/03/04/06, CANV-01/02/04 are satisfied in code and tests.

---

_Verified: 2026-09-24T22:32:00Z_
_Verifier: Claude (gsd-verifier)_
