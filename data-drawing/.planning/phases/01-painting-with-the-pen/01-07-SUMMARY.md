---
phase: 01-painting-with-the-pen
plan: 07
subsystem: surface-render
tags: [three.js, webgpu, webgl2, instanced-mesh, fnv1a, cursor-overlay, brush-presets, brush-versions, stroke-encoder, worker-recorder, tick-stamping, vitest, dev-page]

# Dependency graph
requires:
  - phase: 01-01
    provides: "SimHost / WorkerTransport, sim.worker.ts at 60 Hz, ddsim-abi.ts (DefineBrush encoder, strides), the Vite dev page and window.__dd"
  - phase: 01-05
    provides: "the stroke grammar (StrokeBegin 56 B, 24-byte samples, StrokeEnd 12 B), DD_PRESETS raw values, action_writer.hpp as the one C++ encoder, the presets / one-stroke goldens, dd_body_ptr listing active strokes, StrokeEnd flushing the end tick's samples"
  - phase: 01-06
    provides: "PenFence (coalesced recorded, predicted preview-only, quantized once), FIXED_CAMERA, plane.ts (DEFAULT_PLANE, frameToQ16, rayPlane), the blob-trampoline Worker spawn, DEFAULT_SETTINGS.allowMouse = true while PEN_FACTS was measured with a mouse"
provides:
  - "three@0.186.0, @types/three@0.186.0, @webgpu/types@0.1.74 installed with exact pins into plugins/data-drawing after Kaelen's legitimacy approval"
  - "stage/scene.ts createStage: one WebGPURenderer (three/webgpu) per surface with a forceWebGL switch (?webgl=1), PerspectiveCamera from FIXED_CAMERA (createFixedCamera), plane at z = 0 with a 10-unit grid, NodeField + CursorOverlay, setAnimationLoop render loop, resize, backendInfo(), idempotent dispose in the spike order (setAnimationLoop(null) -> traverse dispose -> renderer.dispose() -> context loss -> canvas.remove()), webglcontextlost/restored listeners"
  - "stage/nodes.ts NodeField: InstancedMesh of CircleGeometry(1, 24) with MeshBasicMaterial (no depth write, transparent 0.9), capacity 4096 growing to the next power of two >= count, snapshot order preserved (never sorted), size = radius x (0.2 + 0.8 x weight), colour per brush description"
  - "stage/colour.ts fnv1a32 (Math.imul, unsigned, over UTF-8 bytes) and colourFor (hue = h mod 360 / 360, s 0.6, l 0.5); fnv1a32('ink') = 0xa0e98faf"
  - "stage/overlay.ts CursorOverlay: pen ring, body disc (current brush colour and radius), spring Line, predicted-tail polyline; hidden when no stroke is open; plane-local -> world through origin + u right + v up"
  - "ddsim-abi.ts: strokeIdOf / ordinalOf / branchOf (bigint ids), encodeStrokeBegin / encodeStrokeSamples / encodeStrokeEnd byte-identical to action_writer.hpp, pure stampSamples(state, tick, samples) -> { samples, state }, q32ToFloat, lazy decodeNodes / decodeBodies accessors"
  - "brushes.ts: PRESETS (ink 1 / rust 4 / clay 16 / lead 64 as the exact Q32.32 raw of DD_PRESETS) and BrushTable (define / edit / get / select; append-only; edit creates a NEW version id and selects it)"
  - "sim.worker.ts as the stroke recorder: beginStroke / samples / endStroke stamped with dd_tick() at arrival, indices from stampSamples, applied immediately, logged only on DD_OK, stamp state committed only on DD_OK, rejections posted with the ordinal"
  - "sim-host.ts: SimHost.beginStroke / pushSamples / endStroke (fire-and-forget), StrokeBeginSpec, DdError.ordinal, strokeApplied message"
  - "main.ts: brush panel (select of versions labelled v<id> <description> m=<mass>, edit form, Save as new version, mouse painting, pause) over the three.js stage; PenFence wired fence -> SimHost -> Worker -> snapshot -> node field / overlay; refuses pen-down while paused; attachMeasure() for the pen re-measurement"
  - "Tests: colour (9), camera-parity (4), nodes (7), encoder (8) — 81 Vitest cases green"
affects: [01-08, phase-2-grammar, phase-2-settle, phase-3-timeline]

# Actuals (#2632) — chars/4 over the realized diff (git diff 66a3659..HEAD, package-lock.json excluded), not a harness token count.
actuals:
  tokens: 23051
  tasks: 3
  commits: 2
plan_head_before: 66a36592b1ea9ab24f80ae8c69aeee2828474a2b

# Tech tracking
tech-stack:
  added:
    - "three 0.186.0 (exact pin; three/webgpu WebGPURenderer with automatic WebGL 2 fallback and a forceWebGL switch)"
    - "@types/three 0.186.0, @webgpu/types 0.1.74 (dev, exact pins; @webgpu/types not yet in tsconfig types — nothing references navigator.gpu typed members)"
  patterns:
    - "One renderer per surface, disposed in the spike order and idempotent; the new three Renderer has no forceContextLoss, so the WebGL backend's context is released through getContext().getExtension('WEBGL_lose_context').loseContext()"
    - "Built-in materials only (MeshBasicMaterial, LineBasicMaterial): WebGPU and WebGL 2 draw the same picture; no compute, no storage buffers"
    - "Q32.32 becomes a float on the main thread only, through Number(BigInt) / 2^32 inside the lazy snapshot accessors; the node field walks the snapshot in the sim's ascending-NodeId order and never sorts"
    - "The Worker is the recorder: stamping is a pure function whose resulting state is committed only when the sim answered DD_OK, so one rejected batch cannot cascade into DD_ERR_SAMPLE_ORDER for the rest of the tick"
    - "Brush presets carry the exact raw integers the C++ table holds; floats are for display (fromQ32) and for user edits (toQ32 once); untouched fields of an edit copy the base's raw value"
    - "Fire-and-forget stroke messages keyed by ordinal; request/response only for defineBrush, hash and log"

key-files:
  created:
    - plugins/data-drawing/surface/src/stage/scene.ts
    - plugins/data-drawing/surface/src/stage/nodes.ts
    - plugins/data-drawing/surface/src/stage/overlay.ts
    - plugins/data-drawing/surface/src/stage/colour.ts
    - plugins/data-drawing/surface/src/brushes.ts
    - plugins/data-drawing/surface/test/colour.test.ts
    - plugins/data-drawing/surface/test/camera-parity.test.ts
    - plugins/data-drawing/surface/test/nodes.test.ts
    - plugins/data-drawing/surface/test/encoder.test.ts
  modified:
    - plugins/data-drawing/package.json
    - package-lock.json
    - plugins/data-drawing/surface/src/ddsim-abi.ts
    - plugins/data-drawing/surface/src/sim-host.ts
    - plugins/data-drawing/surface/src/sim.worker.ts
    - plugins/data-drawing/surface/src/main.ts
    - plugins/data-drawing/surface/src/dev-host.ts

key-decisions:
  - "PRESETS are the exact Q32.32 raw integers of DD_PRESETS, not floats: the plan's claim that 0.75/0.9/1.1/1.3 and 0.5/0.45/0.4/0.35 'round back to the same raw' is false for clay's radius (1.1 * 2^32 rounds to 4724464026, C++ holds 4724464025) and lead's spacing (0.35 -> 1503238554 vs 1503238553) because the C++ constants were truncated; the encoder test against presets.actions would have failed, so the table mirrors the bytes by construction and floats exist only for display and edits"
  - "forceWebGL comes from the dev page's ?webgl=1 only: the SDK SurfaceHost (API 1) has no settings field, so there is no host-provided setting to read; 01-08 records the backend the Tapestry window reports and adds a setting only if WebGPU is missing there"
  - "The Worker commits stamping state only on DD_OK: stampSamples is pure and returns the next state; a rejected batch (e.g. DD_MAX_SAMPLES_PER_TICK) leaves the indices where the sim's pending list left them, so the next batch on that tick is numbered correctly instead of cascading into DD_ERR_SAMPLE_ORDER"
  - "PenMeasure no longer sits on the stage (two capturing listeners on one canvas would fight); MountedSurface.attachMeasure() attaches the overlay to the stage canvas on demand for the 01-06 pen re-measurement open item"
  - "The new three Renderer has no forceContextLoss: the WebGL 2 backend's context is released through WEBGL_lose_context on getContext(); the WebGPU backend releases through renderer.dispose(); dispose twice in the dev page leaves zero canvases and throws nothing"
  - "CANV-01, CANV-02, STRK-01 and STRK-04 marked complete after this plan; CANV-03 held by the shared-ID gate because 01-08 also declares it (the compositing-order truth is a backstop the 01-08 checkpoint answers)"

patterns-established:
  - "Stage contract for 01-08: createStage(container, { forceWebGL, onFrame, onContextRestored }) -> Stage { renderer, canvas, camera, scene, plane, nodes, overlay, resize, backendInfo, dispose }; mount() returns { sim, brushes, stage, fence, settings, attachMeasure, dispose }"
  - "Painting protocol: onBegin -> beginStroke({ ordinal, brushVersionId, frameQ16, pressureSource }); onSamples -> pushSamples(ordinal, RawSample[]); onEnd -> endStroke(ordinal); the Worker stamps start_tick / (tick, index) / end_tick with its current tick"

requirements-completed: [CANV-01, CANV-02, STRK-04, STRK-01]

coverage:
  - id: D1
    description: "Package legitimacy: three@0.186.0, @types/three@0.186.0 and @webgpu/types@0.1.74 confirmed on npmjs.com by a human before the exact-pinned install into plugins/data-drawing"
    verification:
      - kind: manual_procedural
        ref: "Task 1 checkpoint (gate blocking-human) resolved by Kaelen: 'approved: three, @types/three, @webgpu/types'; npm ls three -> three@0.186.0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The stage: one WebGPURenderer per surface with a forceWebGL switch, fixed camera from FIXED_CAMERA, plane at z = 0, InstancedMesh node field, cursor overlay; dispose stops the loop, disposes geometry/materials, disposes the renderer, forces the context loss, removes the canvas, and is a no-op on the second call"
    requirement: CANV-03
    verification:
      - kind: unit
        ref: "plugins/data-drawing/surface/test/camera-parity.test.ts (three PerspectiveCamera vs rayPlane at 15 NDC/viewport points, |du|,|dv| < 1e-6)"
        status: pass
      - kind: automated_ui
        ref: "headless dev page (browser-automation, patchright): backend webgpu; handle.dispose() twice -> canvasesLeft 0, surfaceChildren 0, no exception; zero console errors"
        status: pass
      - kind: other
        ref: "grep gates: from 'three/webgpu' once; setAnimationLoop(null) at line 183 < renderer.dispose() at 187; forceContextLoss present; no ShaderMaterial in stage/*.ts; no sort( in nodes.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Node colour from fnv1a32 over the UTF-8 bytes of the brush description (Math.imul, unsigned; 'ink' != 'ink '; NFC != NFD); size = radius x (0.2 + 0.8 x weight)"
    requirement: CANV-03
    verification:
      - kind: unit
        ref: "plugins/data-drawing/surface/test/colour.test.ts (fnv1a32('') = 0x811c9dc5, fnv1a32('ink') = 0xa0e98faf, fnv1a32('a') = 0xe40c292c); nodes.test.ts#scales each disc by brush radius x (0.2 + 0.8 x weight)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Node field boundary, empty, ordering, precision: 0 nodes -> count 0 no throw; 5000 nodes -> capacity 8192, all drawn, instance 0 and 4999 at the decoded positions; instance i coloured by node i's brush in snapshot order; Q32.32 -> float only via Number(BigInt) / 2^32 on the main thread"
    requirement: CANV-03
    verification:
      - kind: unit
        ref: "plugins/data-drawing/surface/test/nodes.test.ts (7 cases)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Cursor overlay draws the pen ring, the body disc and the spring while a stroke is open and hides them after pen-up; the predicted tail is preview-only"
    requirement: CANV-03
    verification:
      - kind: automated_ui
        ref: "headless dev page: mid-stroke overlay visible flags [ring, body, spring, preview] = [true, true, true, false] (no predicted events from a synthetic mouse); after pointer up all false; grep: getPredictedEvents absent from main.ts / sim-host.ts / sim.worker.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Two nodes at identical positions are both drawn and overlapping instances composite in ascending NodeId order (later stroke on top) because the node material writes no depth"
    requirement: CANV-03
    verification:
      - kind: unit
        ref: "nodes.test.ts#uses the material rules: no depth write, transparent, built-in material (the mechanism, not the picture)"
        status: pass
    human_judgment: true
    rationale: "Compositing order is a visual property (plan: verification backstop); the 01-08 checkpoint looks at overlapping strokes in Tapestry"
  - id: D7
    description: "Brush picker with the four presets mirrored byte for byte from DD_PRESETS; editing creates a NEW version through DefineBrush and selects it; earlier versions stay and are never mutated"
    requirement: STRK-04
    verification:
      - kind: unit
        ref: "plugins/data-drawing/surface/test/encoder.test.ts#(1) encodeDefineBrush(PRESETS[i], i + 1) equals presets.actions at ticks 0..3; (1b) masses 1/4/16/64"
        status: pass
      - kind: automated_ui
        ref: "headless dev page: select shows v1 ink m=1 .. v4 lead m=64; 'Save as new version' with description 'lead (heavier)' mass 80 -> option 'v5 lead (heavier) m=80' selected; brushes.versions keeps v1..v4 unchanged"
        status: pass
      - kind: other
        ref: "grep -n 'versions\\[' brushes.ts | grep -v 'push\\|length' -> nothing (append-only)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Painting in the dev page with the mouse: pen-down captures the plane frame once into StrokeBegin, coalesced samples flow PenFence -> SimHost.pushSamples -> Worker (stamped tick/index at record time, applied, logged), nodes appear on the plane in the next snapshot"
    requirement: STRK-01
    verification:
      - kind: automated_ui
        ref: "headless dev page: 41 mouse samples -> 148 nodes 0.5 apart; log has DefineBrush x5, StrokeBegin x3, StrokeSamples x83, StrokeEnd x3 with non-decreasing ticks; stroke 1 samples stamped (27,0) (28,0) (31,0) ... ; painting refused while paused (code path)"
        status: pass
      - kind: unit
        ref: "encoder.test.ts#(4) stampSamples indices 0,1,2 then 0 after the tick moved on; (4c) a stamped stroke applied through the Wasm module is accepted"
        status: pass
    human_judgment: false
  - id: D9
    description: "The TS encoder is byte-identical to the C++ one: the TS-built one-stroke log equals one-stroke.actions line by line and replays through the Wasm module to one-stroke.sha256 at ticks 10, 70, 130, 600"
    requirement: STRK-01
    verification:
      - kind: integration
        ref: "plugins/data-drawing/surface/test/encoder.test.ts#(2) and #(3)"
        status: pass
    human_judgment: false
  - id: D10
    description: "Pen input over the fence is recorded only from coalesced events with the mouse behind the setting; the dev page's 'mouse painting' checkbox binds Settings.allowMouse (default true while PEN_FACTS is a mouse measurement)"
    requirement: CANV-02
    verification:
      - kind: automated_ui
        ref: "headless dev page: mouse strokes recorded with pressureSource 1 ('stroke 1 open (brush v1, mouse)'); fence.test.ts (30) unchanged and green"
        status: pass
    human_judgment: false
  - id: D11
    description: "Node positions come from the recorded plane frame (StrokeBegin carries frameToQ16(DEFAULT_PLANE)); the camera is never recorded; the three.js camera and rayPlane agree"
    requirement: CANV-01
    verification:
      - kind: unit
        ref: "camera-parity.test.ts; encoder.test.ts#(2) StrokeBegin bytes carry the 9 x i32 frame"
        status: pass
    human_judgment: false
  - id: D12
    description: "Brush feel: with lead (mass 64) the body visibly trails the pointer; with ink (mass 1) it sits on it"
    requirement: STRK-04
    verification:
      - kind: automated_ui
        ref: "headless dev page: lead drag gap ring-to-body 14.2 / 12.4 / 11.6 units at steps 10 / 20 / 30; ink ring == body (dead-beat, as 01-05 measured)"
        status: pass
    human_judgment: true
    rationale: "The numbers prove the lag exists; whether it feels right with a pen is what 01-08's checkpoint asks Kaelen"

# Metrics
duration: 16min
completed: 2026-09-24
status: complete
---

# Phase 01 Plan 07: The Stage, Brushes, Encoder and Recorder — Painting in the Dev Page Summary

**A person now paints in the plugin's dev page and sees nodes land on the plane: a three.js WebGPU stage (WebGL 2 fallback) with a fixed camera, an instanced node field coloured by an FNV-1a hash of the brush description and sized by pressure, a pen/body/spring overlay, four versioned presets whose bytes equal `DD_PRESETS`, an edit form that only ever creates a new version, a TS stroke encoder proven byte-identical to the C++ one against the goldens, and a Worker that stamps every sample with the tick it was applied at.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-09-24T08:18:45Z
- **Completed:** 2026-09-24T08:35:11Z
- **Tasks:** 3 (Task 1 was the package-legitimacy checkpoint, pre-resolved by Kaelen before this executor was spawned)
- **Files modified:** 16 (9 created, 7 modified)

## Accomplishments

- CANV-03 (surface): `stage/scene.ts` owns one `WebGPURenderer` per surface (`three/webgpu`, `forceWebGL` from `?webgl=1`), the `PerspectiveCamera` from `FIXED_CAMERA`, the plane at z = 0 with a 10-unit grid, the `NodeField` and the `CursorOverlay`; `dispose()` runs `setAnimationLoop(null)` -> traverse dispose -> `renderer.dispose()` -> context loss -> `canvas.remove()` and is a no-op on the second call (proved headless: two calls, zero canvases left, no exception). Nodes are coloured by `fnv1a32` over the description's UTF-8 bytes and scaled by `radius x (0.2 + 0.8 x weight)`; the overlay draws the pen ring, the body disc in the brush colour and the spring, hidden when no stroke is open.
- STRK-04 (surface): `PRESETS` carry the exact raw Q32.32 of `DD_PRESETS` (see Deviations), `BrushTable.edit` builds a new spec and defines it as the next id; the dev page's select shows `v1 ink m=1 .. v4 lead m=64`, "Save as new version" produced `v5 lead (heavier) m=80` and selected it while v1..v4 stayed as they were.
- STRK-01 / CANV-01 / CANV-02 (surface): `PenFence` -> `SimHost.beginStroke / pushSamples / endStroke` -> the Worker stamps `start_tick`, `(tick, index)` and `end_tick` with its current tick, encodes, applies, and logs only on `DD_OK`; nodes appear in the next snapshot; predicted points reach the overlay only. `encodeStrokeBegin/Samples/End` reproduce `one-stroke.actions` line by line and the TS-built log replays in Wasm to `one-stroke.sha256` at 10 / 70 / 130 / 600.
- 81 Vitest cases green (plane 10, fence 30, wasm-golden 13, colour 9, camera-parity 4, nodes 7, encoder 8); typecheck and build green; `dist/surface.js` bundles three (1.67 MB, local app loaded from disk).

## Task Commits

1. **Task 1: Package legitimacy checkpoint** — no commit (resolved by Kaelen; record below)
2. **Task 2: Install three.js and build the stage** — `3515d14` (feat)
3. **Task 3: Brush presets and versioning, TS encoder vs C++ goldens, Worker recorder, live painting** — `0f08fc5` (feat)

**Plan metadata:** see the final `docs(01-07)` commit.

## Task 1 record: package legitimacy (gate blocking-human)

The orchestrator presented the checkpoint to Kaelen with the registry facts and received, verbatim:

> approved: three, @types/three, @webgpu/types

Registry facts presented (npm view, 2026-09-24): `three` latest 0.186.0, repository github.com/mrdoob/three.js; `@types/three` latest 0.186.0 from DefinitelyTyped; `@webgpu/types` latest 0.1.74, repository github.com/gpuweb/types; none deprecated. The install then ran with exact pins from the workspace root (`npm install -w plugins/data-drawing --save-exact three@0.186.0` and `--save-exact -D @types/three@0.186.0 @webgpu/types@0.1.74`); npm printed no lifecycle-script output (RESEARCH verified no postinstall). `npm ls three @types/three @webgpu/types`:

```
tapestry-workspace@ /Users/kaelencook/Tapestry
└─┬ @tapestry/plugin-data-drawing@0.1.0 -> ./plugins/data-drawing
  ├── @types/three@0.186.0
  ├── @webgpu/types@0.1.74
  └── three@0.186.0
```

`plugins/data-drawing/package.json` pins `"three": "0.186.0"`, `"@types/three": "0.186.0"`, `"@webgpu/types": "0.1.74"` (no carets). `@webgpu/types` is installed but not yet in `tsconfig.json` `types` — nothing references `navigator.gpu` typed members; 01-08 adds it when it does.

## Frozen values

- `fnv1a32('') = 0x811c9dc5`, `fnv1a32('ink') = 0xa0e98faf`, `fnv1a32('a') = 0xe40c292c` (the FNV test vector).
- `PRESETS` raw: ink `(4294967296, 3221225472, 2147483648)`, rust `(17179869184, 3865470566, 1932735283)`, clay `(68719476736, 4724464025, 1717986918)`, lead `(274877906944, 5583457485, 1503238553)` — mass, radius, spacing.

## Dev-page painting observation (Task 3 acceptance)

`npm --prefix plugins/data-drawing run sim:wasm && npm --prefix plugins/data-drawing run dev`, driven headless (browser-automation skill, patchright Chromium) with a synthetic **mouse** — no pen is attached to this Mac (01-06). Zero console errors or warnings, zero failed requests, `backend webgpu` (headless Chromium here exposes WebGPU; `?webgl=1` is the fallback switch and was not needed).

| Step | Observed |
|---|---|
| Load | `status sim v1 at 60 Hz in a module Worker`, `backend webgpu`, select enabled with `v1 ink m=1`, `v2 rust m=4`, `v3 clay m=16`, `v4 lead m=64`; hash `a91b32f0…` at tick 0 with the four presets defined (log: `DefineBrush@0` x4) |
| postMessage cost | 100 posts of a 4-sample `RawSample[]` batch: **0.002 ms per post** — far under the plan's 1 ms bar, so the array is posted as-is (no packed layout) |
| Stroke 1, ink, 400 px horizontal drag in 40 steps | `stroke 1 open (brush v1, mouse)` -> 41 coalesced samples -> **148 nodes**; first five instance translations x = -36.94, -36.44, -35.94, -35.44, -34.94 (0.5 apart = ink spacing), scale 0.45 = 0.75 x (0.2 + 0.8 x 0.5) at the mouse's constant pressure 0.5; instance colour (0.80, 0.20, 0.29) = colourFor('ink') |
| Overlay mid-stroke | visible [ring, body, spring, preview] = [true, true, true, false]; ring at (36.94, 0.03), body at the same point — the mass-1 body is dead-beat (01-05) |
| After pointer up | all four overlay parts hidden; `stroke 1 ended · 41 samples` |
| Stroke 2, lead (v4), faster drag | body trails the ring: gap **14.2 units at step 10, 12.4 at 20, 11.6 at 30**, body and spring visible; `stroke 2 ended · 31 samples` |
| Save as new version | description `lead (heavier)`, mass 80 -> select gains `v5 lead (heavier) m=80` and selects it; `brushes.versions` = v1..v5 with v1..v4 unchanged (radius/spacing read back as 0.9/0.45, 1.1/0.4, 1.3/0.35 within Q32.32 resolution) |
| Stroke 3 with v5 | 11 samples; final `nodes 402`, tick 256 |
| `__dd.sim.log()` | 94 entries: DefineBrush x5, StrokeBegin x3, StrokeSamples x83, StrokeEnd x3; ticks **non-decreasing**; first entries `DefineBrush@0 x4, StrokeBegin@27, StrokeSamples@27, @28, @31 …`, last `StrokeSamples@237, StrokeEnd@238`; stroke 1's sample stamps `(27,0) (28,0) (31,0) (32,0) (35,0) …` — one coalesced sample per synthetic move, index 0 on each new tick |
| Probe: samples for an ordinal with no begin | `rejected: DD_ERR_STROKE_STATE (code 7, action kind 3, stroke 999999)` shown in the panel (never silent) |
| `handle.dispose()` twice | no throw; 0 canvases, 0 children left in `#surface` |

Screenshot (scratchpad `paint.png`, viewed): the panel on top, the dark plane with the grid below, a pink row of ink discs, a thicker blue row of lead discs, and the short `lead (heavier)` stroke — exactly the three drags.

**What only a human can judge** (01-08's checkpoint): whether the lead body's lag feels right with a real pen, and the compositing of overlapping strokes.

## Verification record

- Task 2 `<automated>`: `npm ls three | grep -F three@0.186.0` ✓; typecheck ✓; Vitest 6 files / 73 tests ✓; build ✓. Acceptance greps: exact pins ✓; `from 'three/webgpu'` once ✓; `setAnimationLoop(null)` (183) before `renderer.dispose()` (187) ✓; `forceContextLoss` present ✓; no `ShaderMaterial` in `stage/*.ts` ✓ (a header comment was reworded to keep the grep clean); no `sort(` in nodes.ts ✓; `getBigInt64` in ddsim-abi.ts ✓; `capacity === 8192` asserted ✓.
- Task 3 `<automated>`: typecheck ✓; Vitest 7 files / 81 tests ✓ (`encoder.test.ts` listed, cases (1)–(4) plus (1b), (4b), (4c) and the id packing case); build ✓; `stampSamples` grep prints 4 lines across ddsim-abi.ts and sim.worker.ts ✓. Acceptance: `export const PRESETS` once with ink/rust/clay/lead and masses 1/4/16/64 ✓; no assignment into `versions[...]` ✓; `getPredictedEvents` absent from main.ts / sim-host.ts / sim.worker.ts ✓; dev-page observation above ✓.
- Plan-level: human approval recorded with exact pins ✓; all Vitest files green ✓; dev-page painting observation recorded ✓.

## Files Created/Modified

- `plugins/data-drawing/surface/src/stage/scene.ts` - `createStage`, `createFixedCamera`, `Stage`, `StageOptions`, constants
- `plugins/data-drawing/surface/src/stage/nodes.ts` - `NodeField`, `BrushLookup`, `INITIAL_CAPACITY`
- `plugins/data-drawing/surface/src/stage/overlay.ts` - `CursorOverlay`, `PlanePoint`, `PREVIEW_CAPACITY`
- `plugins/data-drawing/surface/src/stage/colour.ts` - `fnv1a32`, `colourFor`
- `plugins/data-drawing/surface/src/brushes.ts` - `PRESETS`, `BrushTable`, `BrushVersion`, `BrushPatch`
- `plugins/data-drawing/surface/src/ddsim-abi.ts` - stroke ids, stroke encoders, `stampSamples`, `q32ToFloat`, lazy `decodeNodes` / `decodeBodies` (the eager `NodeView[]` form is gone; nothing used it)
- `plugins/data-drawing/surface/src/sim-host.ts` - `StrokeBeginSpec`, `beginStroke` / `pushSamples` / `endStroke`, `DdError.ordinal`, `strokeApplied`
- `plugins/data-drawing/surface/src/sim.worker.ts` - the stamping recorder for kinds 2, 3, 4
- `plugins/data-drawing/surface/src/main.ts` - stage + brush panel + fence wiring; `MountedSurface { sim, brushes, stage, fence, settings, attachMeasure }`
- `plugins/data-drawing/surface/src/dev-host.ts` - `window.__dd = { host, sim, brushes, stage, handle }`
- `plugins/data-drawing/package.json`, `package-lock.json` - the three exact pins
- `plugins/data-drawing/surface/test/{colour,camera-parity,nodes,encoder}.test.ts` - 28 new cases

## Decisions Made

See `key-decisions` in the frontmatter: raw presets; `?webgl=1` only; stamp state committed on DD_OK; PenMeasure moved behind `attachMeasure()`; WEBGL_lose_context for the WebGL backend; requirement marking.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's spec] PRESETS as exact raw Q32.32, not floats**
- **Found during:** Task 3 (before writing brushes.ts; checked with `Math.round(x * 2^32)`)
- **Issue:** The interfaces block says the presets are "expressed as floats that round back to the same raw" — clay's radius 1.1 rounds to 4724464026 (C++ 4724464025) and lead's spacing 0.35 to 1503238554 (C++ 1503238553); the C++ constants were truncated, so the encoder test against `presets.actions` would have failed on two of four presets.
- **Fix:** `PRESETS` hold bigint raw values copied from `DD_PRESETS`; `BrushVersion` carries the float readings (`fromQ32`) beside `raw`, and `edit` copies untouched fields from `raw`.
- **Files modified:** `brushes.ts`
- **Verification:** `encoder.test.ts#(1)` equals all four `presets.actions` lines.
- **Committed in:** `0f08fc5`

**2. [Rule 2 - Correctness] Stamping state committed only on DD_OK**
- **Found during:** Task 3
- **Issue:** The plan keeps `stamp[ordinal] = { tick, nextIndex }` mutated before apply; after one rejected batch (e.g. the per-tick limit) every later batch on that tick would carry indices the sim's pending list never saw and be rejected with `DD_ERR_SAMPLE_ORDER` — data loss cascading from one rejection.
- **Fix:** `stampSamples` is pure and returns `{ samples, state }`; the worker sets the state only after `DD_OK`.
- **Files modified:** `ddsim-abi.ts`, `sim.worker.ts`
- **Verification:** `encoder.test.ts#(4)`, `(4b)` (purity), `(4c)` (accepted by the Wasm sim).
- **Committed in:** `0f08fc5`

**3. [Rule 3 - Blocking] `dev-host.ts` updated (not in the plan's file list)**
- **Found during:** Task 3
- **Issue:** `MountedSurface` no longer exposes `measure` (PenMeasure cannot share the canvas with the fence — both capture pointers), so `dev-host.ts` failed typecheck; the console also needs the brushes and stage.
- **Fix:** `window.__dd = { host, sim, brushes, stage, handle }`; `handle.attachMeasure()` re-attaches the measurement overlay on demand for the 01-06 open item.
- **Files modified:** `dev-host.ts`, `main.ts`
- **Committed in:** `0f08fc5`

**4. [Rule 2 - Correctness] Context loss on the WebGL backend without `forceContextLoss`**
- **Found during:** Task 2 (reading `@types/three` `Renderer.d.ts`: no `forceContextLoss`, `dispose(): Promise<void>`, `getContext(): unknown`)
- **Issue:** The plan guards `forceContextLoss` with `typeof … === 'function'`; on the new Renderer it is never a function, so the WebGL 2 path would hold its context until GC (RESEARCH pitfall 7).
- **Fix:** When the backend is WebGL 2, `getContext().getExtension('WEBGL_lose_context')?.loseContext()`; WebGPU releases through `renderer.dispose()`.
- **Files modified:** `stage/scene.ts`
- **Committed in:** `3515d14`

**5. [Rule 2 - Correctness] The edit form patches only the fields the user changed**
- **Found during:** Task 3 (screenshot showed radius `1.300000` / spacing `0.349999`)
- **Issue:** Sending all four fields re-quantized untouched raw values from a rounded float (0.35 -> 1503238554 instead of the base's 1503238553), so "edit the mass" would silently change the spacing bytes too.
- **Fix:** Readings shown rounded to 6 decimals; a field enters the patch only when it differs from the shown base value; untouched fields copy `base.raw`.
- **Files modified:** `main.ts`
- **Committed in:** `0f08fc5`

### Design choices within the plan's contract (not deviations from must-haves)

- `forceWebGL` reads `?webgl=1` only — `SurfaceHost` (SDK API 1) has no settings field (checked `sdk/src/contributions.ts`), so the "host-provided setting" does not exist yet.
- `BrushVersionSpec` stays the single type from `ddsim-abi.ts` (`curve: readonly number[]`) instead of a second `Uint16Array(17)` variant with the same name; `BrushTable.get` is a `Map` lookup (the node field calls it per node per frame).
- `decodeNodes` / `decodeBodies` return lazy accessors (the plan's interfaces block) and the eager `NodeView[]` shape is removed; nothing imported it.
- A `strokeApplied` outbound message (ordinal, kind, tick, sample count) accompanies the plan's `rejected` so a later status line can count recorded samples; the transport ignores it for now.
- The plane mesh sits at z = -0.02 and the grid at z = -0.01 so nodes at z = 0 never z-fight with them (node positions come from the sim unchanged).
- `nodes.test.ts` compares instance colours to `colourFor` per channel within 1e-6 (instance colours are Float32).
- The scene.ts header comment no longer names `ShaderMaterial` so the plan's `grep` gate stays literal.

---

**Total deviations:** 5 auto-fixed (1 bug in the plan's spec, 3 correctness, 1 blocking). **Impact on plan:** every must-have holds; deviation 1 is what makes the presets truth true at all; 2 and 5 prevent silent data changes; no scope added beyond the `attachMeasure()` hook.

## Issues Encountered

- The frozen `fnv1a32('ink')` value was first written as a placeholder and then computed with the reference loop before the test ran (`0xa0e98faf`); the FNV test vector `'a' -> 0xe40c292c` pins the algorithm independently.
- patchright evaluates in an isolated world (as 01-01 noted), so the dev-page checks inject `<script>` tags that write JSON into `document.body.dataset` and read it back.
- Headless Chromium on this Mac exposed WebGPU, so the WebGL 2 fallback was not exercised end to end here; the `?webgl=1` switch and the `WEBGL_lose_context` path are code-reviewed, not run. 01-08 records the backend inside Tapestry.

## Known Stubs

None. Every panel value is wired to the sim or the brush table; the overlay's preview polyline is empty with a mouse because Chromium delivers no predicted events for a synthetic mouse (PEN_FACTS saw up to 10 per move over the stream).

## Threat Flags

None new. T-07-SC: human approval + exact pins + `npm ls` recorded above. T-07-01: `stampSamples` is pure and unit-tested; only `DD_OK` actions enter the log; rejections are posted with the ordinal and shown in the panel. T-07-04: `BrushTable` only appends (grep gate clean); the sim rejects non-sequential ids.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 01-08 mounts this surface in Tapestry unchanged (same `dist/`, same `mount(host)`), records `backendInfo()` in the Tapestry window, and asks Kaelen about feel (lead vs ink) and overlapping-stroke compositing; it may add `"@webgpu/types"` to `tsconfig.json` `types` if it touches `navigator.gpu`.
- Open from the dev page: `npm --prefix plugins/data-drawing run sim:wasm && npm --prefix plugins/data-drawing run dev`, then http://localhost:5173/ (mouse painting is on by default; `?webgl=1` forces WebGL 2; `__dd.sim.log()`, `__dd.brushes.versions`, `(await __dd.stage).backendInfo()` in the console).
- CANV-03 stays unchecked until 01-08 finishes (shared-ID gate).

---
*Phase: 01-painting-with-the-pen*
*Completed: 2026-09-24*

## Self-Check: PASSED

All 9 created files exist on disk (plus `dist/surface.js` from the build); commits `3515d14` and `0f08fc5` are in history; `git rev-list --count 66a3659..HEAD` = 2 with code changes, matching `actuals.commits`; the plan's `<verification>` items and every task's acceptance criteria were re-run above.
