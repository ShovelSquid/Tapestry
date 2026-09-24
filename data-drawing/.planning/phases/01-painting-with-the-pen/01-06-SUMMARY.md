---
phase: 01-painting-with-the-pen
plan: 06
subsystem: surface-input
tags: [pointer-events, pointer-capture, coalesced-events, predicted-events, quantization, q16.16, ray-plane, fixed-camera, pen-measurement, registerSurface, tapestry-plugin, blob-worker, vitest]

# Dependency graph
requires:
  - phase: 01-01
    provides: "surface skeleton (main.ts, dev-host.ts, sim-host.ts WorkerTransport, Vite lib build), plugin manifest and index.js"
  - phase: 01-02
    provides: "CANV-04 host extension point: SurfaceContribution / registerSurface, SurfaceHost / SurfaceModule types, PluginSurfaceLayer importing surface/dist over tapestry-plugin://"
  - phase: 01-04
    provides: "the Surfaces launcher, the tapestry-plugin:// fact sheet, and the blob-trampoline decision for scheme-hosted module Workers"
  - phase: 01-05
    provides: "the 24-byte Sample wire record (u16 pressure, i32 Q16.16 u/v, i8 tilt, u16 twist, flags bits 0-2), DD_PRESSURE_MAX = 65535, the 9 x i32 Q16.16 plane frame in StrokeBegin"
provides:
  - "The Data Drawing surface registered through the public extension point (tapestry.plugin.json contributions.surfaces + context.registerSurface id datadrawing.canvas, entry surface/dist/surface.js, placement stage) and mounting inside Tapestry from the Surfaces launcher; main.ts imports only SDK types (host-types.ts deleted)"
  - "camera.ts FIXED_CAMERA (position (0,0,120), target origin, up +y, fov 40) — never recorded"
  - "plane.ts PlaneFrame / DEFAULT_PLANE / frameToQ16 (9 x i32 Q16.16 in StrokeBegin order) / rayPlane (pure float ray-plane hit returning plane-local (u, v), null on miss); centre maps to (0, 0), edges pinned at 69.88 / 43.68 within 1e-3"
  - "measure.ts PenMeasure overlay: native listeners incl. pointerrawupdate, capture, touch-action none; MeasureSummary JSON to the overlay <pre> and console.log('[dd-measure]') only"
  - "input.ts: PEN_FACTS (the 2026-09-24 measurement, verbatim, with provisional / [ASSUMED] status), PRESSURE_MAX / FLAG_* / ERASER_BUTTONS mirroring ddsim state.hpp, Settings + DEFAULT_SETTINGS, RawSample, paintable, pressureSourceOf, quantizeSample (the one float-to-integer boundary), PenFence (native listeners, capture, coalesced recorded, predicted preview-only, one stroke at a time, no timestamp read)"
  - "sim-host.ts spawns the Worker through the same-origin blob trampoline (worker-spawn.ts) so the sim ticks inside Tapestry over tapestry-plugin://"
  - "Tests: plane.test.ts (10 cases) and fence.test.ts (30 cases, synthetic pen path with a FakeCanvas, no jsdom)"
affects: [01-07, 01-08, phase-2-grammar, pen-re-measurement]

# Actuals (#2632) — chars/4 over the realized diff (git diff ceadc4b..HEAD), not a harness token count.
actuals:
  tokens: 17003
  tasks: 3
  commits: 2
plan_head_before: ceadc4bb895fc017b630da7e091e91a3f2729350

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Quantize once at the fence: floats live in camera.ts / plane.ts / measure.ts; input.ts is the only place a browser float becomes a recorded integer, and RawSample has exactly the seven integer fields the sim's Sample record carries (tick/index stamped by the Worker)"
    - "Coalesced recorded, predicted preview-only: getCoalescedEvents() feeds onSamples, getPredictedEvents() feeds onPreview with float points that never touch RawSample"
    - "Measured facts as constants: PEN_FACTS tags every field [MEASURED] or [ASSUMED]; the default mouse setting is derived from PEN_FACTS.measuredWith so a re-measurement with a pen flips the fence back to pen-only without a code change elsewhere"
    - "Structural canvas interface (FenceCanvas) so the fence is tested against a FakeCanvas with plain-object events and HTMLCanvasElement satisfies it in production"
    - "Same-origin blob trampoline for scheme-hosted module Workers (from the 01-04 decision) with the blob URL revoked on first message / error and on dispose"

key-files:
  created:
    - plugins/data-drawing/surface/src/camera.ts
    - plugins/data-drawing/surface/src/plane.ts
    - plugins/data-drawing/surface/src/measure.ts
    - plugins/data-drawing/surface/src/input.ts
    - plugins/data-drawing/surface/src/worker-spawn.ts
    - plugins/data-drawing/surface/test/plane.test.ts
    - plugins/data-drawing/surface/test/fence.test.ts
  modified:
    - plugins/data-drawing/index.js
    - plugins/data-drawing/tapestry.plugin.json
    - plugins/data-drawing/tsconfig.json
    - plugins/data-drawing/surface/src/main.ts
    - plugins/data-drawing/surface/src/dev-host.ts
    - plugins/data-drawing/surface/src/sim-host.ts
    - plugins/data-drawing/surface/src/sim.worker.ts
    - plugins/data-drawing/surface/vite.config.ts
  deleted:
    - plugins/data-drawing/surface/src/host-types.ts

key-decisions:
  - "Mouse measurement accepted for PEN_FACTS (Kaelen, Task 2 checkpoint): this Mac is reachable only over an Apollo/Moonlight streaming session, so every pointer is a plain mouse and no tablet is attached; the 2026-09-24 mouse JSON is recorded verbatim, pen-specific fields are provisional, W3C/RESEARCH expectations are tagged [ASSUMED], and a pen re-measurement is an open item"
  - "DEFAULT_SETTINGS.allowMouse = (PEN_FACTS.measuredWith === 'mouse'): the fence stays pen-only by design, but the mouse is accepted by default while the measurement was made with a mouse so 01-07/01-08 can paint over the stream"
  - "paintable refuses any buttons with the eraser bit (32) set, not just bit 0 clear: buttons 33 cannot paint even if a driver set both bits"
  - "Tilt mapping is identity: no tilt was ever seen, so there is no measured sign to correct; the negation rule is documented in quantizeSample for the re-measurement"
  - "sim-host.ts adopts the 01-04 blob trampoline via worker-spawn.ts (the alternative — serving the worker from the renderer origin — was rejected in 01-04)"

patterns-established:
  - "Fence contract for 01-07: PenFence.attach(canvas, { viewport, frame, settings, callbacks }) -> detach; callbacks.onBegin(pressureSource, frame) / onSamples(RawSample[]) / onEnd() / onPreview(points)"
  - "Surface mounts identically from the plugin dev page and from Tapestry (same dist/, same SDK SurfaceHost shape)"

requirements-completed: [STRK-06]

coverage:
  - id: D1
    description: "Data Drawing surface registered through registerSurface and mounting inside Tapestry from the Surfaces launcher; main.ts imports only SDK types"
    requirement: CANV-04
    verification:
      - kind: integration
        ref: "npm --prefix app test -- src/main/plugin-host.test.ts (plugin loads with contributions.surfaces)"
        status: pass
      - kind: manual_procedural
        ref: "Task 2 checkpoint: Kaelen opened Data Drawing in the running Tapestry window and drew on the stage"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pen measured on this Mac inside the Electron dev build before the fence was written; numbers recorded in PEN_FACTS and this SUMMARY"
    requirement: CANV-02
    verification:
      - kind: manual_procedural
        ref: "Task 2 checkpoint JSON (below) — measured with a MOUSE over a streaming session"
        status: pass
    human_judgment: true
    rationale: "The measurement was made with a mouse, not a pen; pen-specific fields are provisional and the re-measurement with a pen attached to the Mac is an open item a human must perform"
  - id: D3
    description: "paintable / pressureSourceOf boundary: pen tip down or mouse behind the setting; hover, eraser end (32 and 33), touch and other buttons refused"
    requirement: CANV-02
    verification:
      - kind: unit
        ref: "plugins/data-drawing/surface/test/fence.test.ts#paintable"
        status: pass
    human_judgment: false
  - id: D4
    description: "quantizeSample: u/v i32 Q16.16, pressure u16 (0 -> 0, 1 -> 65535, 0.5 -> 32768), tilt i8 -90..90, twist u16 0..359, flags bit0 tilt / bit1 twist / bit2 mouse; NaN and out-of-range clamped (T-06-01)"
    requirement: STRK-06
    verification:
      - kind: unit
        ref: "plugins/data-drawing/surface/test/fence.test.ts#quantizeSample"
        status: pass
    human_judgment: false
  - id: D5
    description: "PenFence: native listeners, touch-action none, capture on down, coalesced samples recorded in order, predicted points preview-only and never recorded, one stroke at a time, touch ignored during a pen stroke, onEnd once on up/cancel/lostpointercapture/detach, frame captured once as a copy, rays that miss skipped"
    requirement: STRK-01
    verification:
      - kind: unit
        ref: "plugins/data-drawing/surface/test/fence.test.ts#PenFence"
        status: pass
    human_judgment: false
  - id: D6
    description: "rayPlane against FIXED_CAMERA: centre (0,0), right edge u = 69.88, top edge v = 43.68 (1e-3), parallel plane scales by distance, edge-on plane null, frameToQ16(DEFAULT_PLANE) = [0,0,0,65536,0,0,0,65536,0]"
    requirement: CANV-01
    verification:
      - kind: unit
        ref: "plugins/data-drawing/surface/test/plane.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "Measurement telemetry never leaves the machine: measure.ts contains no fetch(, localStorage or XMLHttpRequest (T-06-02)"
    verification:
      - kind: other
        ref: "grep -n 'fetch(\\|localStorage\\|XMLHttpRequest' plugins/data-drawing/surface/src/measure.ts prints nothing"
        status: pass
    human_judgment: false

# Metrics
duration: 46min
completed: 2026-09-24
status: complete
---

# Phase 01 Plan 06: Surface in Tapestry, Pen Measured, Deterministic Fence Summary

**The Data Drawing surface mounts inside Tapestry through registerSurface, the pointer was measured on this Mac (with a mouse over a streaming session — pen fields provisional), and input.ts is now the one float-to-integer boundary: pen-tip-only (mouse behind a setting), pointer capture, coalesced samples recorded, predicted points preview-only, ray-plane unprojection against the fixed camera and Q16.16 / u16 / i8 / u16 quantization once.**

## Performance

- **Duration:** 46 min (including the Task 2 human checkpoint)
- **Started:** 2026-09-24T07:20:23Z
- **Completed:** 2026-09-24T08:07:12Z
- **Tasks:** 3 (Task 2 was the human-verify checkpoint, resolved by Kaelen)
- **Files modified:** 16 (7 created, 8 modified, 1 deleted)

## Accomplishments

- Surface registered in the manifest and `index.js` (`datadrawing.canvas`, `surface/dist/surface.js`, placement `stage`); `main.ts` imports `SurfaceHost` / `SurfaceModule` / `SurfaceHandle` from `@tapestry/sdk` (type-only, `host-types.ts` deleted); the app's plugin-host test loads it and Kaelen opened it from the Surfaces launcher.
- `camera.ts` + `plane.ts`: pure ray-plane math against the fixed camera with the plane frame encoded exactly as StrokeBegin expects; 10 tests pin the numbers.
- `measure.ts`: `PenMeasure` overlay (toggled with M, on by default) accumulating pointer types, pressure range / distinct count, tilt sign, twist, eraser buttons, coalesced and `pointerrawupdate` rates, predicted counts, secure context, cross-origin isolation, WebGPU; output to the `<pre>` and `[dd-measure]` console line only.
- The sim ticks at 60 Hz inside Tapestry: `sim-host.ts` spawns the module Worker through the same-origin blob trampoline (`worker-spawn.ts`), the worker resolves its `.wasm` against its own `import.meta.url`, and Vite emits relative asset URLs (`base: './'`).
- `input.ts`: `PEN_FACTS`, the quantization constants, `paintable`, `pressureSourceOf`, `quantizeSample`, `PenFence`; 30 tests drive the pen path synthetically.

## Task Commits

1. **Task 1: Camera and plane math, the pen measurement overlay, and the surface mounted in Tapestry** - `5461220` (feat)
2. **Task 2: Measure the pen on this Mac inside Tapestry** - checkpoint, no commit (resolved by Kaelen; JSON below)
3. **Task 3: The deterministic fence — input.ts with the measured constants, and its tests** - `05af9db` (feat)

**Plan metadata:** see the final docs commit.

## Files Created/Modified

- `plugins/data-drawing/surface/src/camera.ts` - `FIXED_CAMERA` constants; never recorded
- `plugins/data-drawing/surface/src/plane.ts` - `PlaneFrame`, `DEFAULT_PLANE`, `Q16_ONE`, `frameToQ16`, `rayPlane`
- `plugins/data-drawing/surface/src/measure.ts` - `PenMeasure`, `MeasureSummary` (with the extra `samples` field)
- `plugins/data-drawing/surface/src/input.ts` - `PEN_FACTS`, `PRESSURE_MAX`, `FLAG_TILT/TWIST/SOURCE`, `ERASER_BUTTONS`, `Settings`, `DEFAULT_SETTINGS`, `RawSample`, `PointerEventLike`, `FenceCallbacks`, `FenceDeps`, `FenceCanvas`, `paintable`, `pressureSourceOf`, `quantizeSample`, `PenFence`
- `plugins/data-drawing/surface/src/worker-spawn.ts` - `spawnSameOriginModuleWorker` (blob trampoline)
- `plugins/data-drawing/surface/src/main.ts` - SDK type imports, measurement stage + overlay, `MountedSurface.measure`
- `plugins/data-drawing/surface/src/dev-host.ts` - implements the SDK `SurfaceHost` (incl. dpr in `onResize`), exposes `__dd.measure`
- `plugins/data-drawing/surface/src/sim-host.ts` - Worker spawned through the trampoline using the `./sim.worker?worker&url` chunk URL
- `plugins/data-drawing/surface/src/sim.worker.ts` - `.wasm` URL resolved absolute against its own `import.meta.url`
- `plugins/data-drawing/surface/vite.config.ts` - `base: './'`
- `plugins/data-drawing/index.js` - `context.registerSurface({...})`
- `plugins/data-drawing/tapestry.plugin.json` - `"surfaces": ["datadrawing.canvas"]`
- `plugins/data-drawing/tsconfig.json` - `paths` for `@tapestry/sdk`
- `plugins/data-drawing/surface/test/plane.test.ts` - 10 cases
- `plugins/data-drawing/surface/test/fence.test.ts` - 30 cases
- `plugins/data-drawing/surface/src/host-types.ts` - deleted (intentional; replaced by the SDK types)

## The Measurement (Task 2, verbatim)

Measured 2026-09-24 in the Tapestry dev build (Electron 32 / Chromium 128) by Kaelen. **This Mac is reachable only through a game-streaming session (Apollo / Moonlight from a PC), so every input arrives as a plain mouse; no pen tablet is attached to the Mac.** Wacom driver 6.4.13-4 is installed (verified) but macOS detects no tablet. Kaelen explicitly chose to accept the mouse measurement now and record a pen re-measurement as an open item.

Pen model: none attached (input via streaming client). Driver: Wacom 6.4.13-4 present but idle.

```json
{
  "pointerTypesOnDown": ["mouse"],
  "isPrimary": [true],
  "pressure": { "min": 0.5, "max": 0.5, "distinct": 1 },
  "tilt": { "seen": false, "xSign": 0, "ySign": 0, "maxAbs": 0 },
  "twist": { "seen": false, "max": 0 },
  "eraserButtons": null,
  "coalescedPerSecond": 216,
  "predictedPerMove": { "min": 0, "max": 10 },
  "rawUpdatePerSecond": 250,
  "isSecureContext": true,
  "crossOriginIsolated": false,
  "gpu": true,
  "strokes": 4,
  "samples": 605
}
```

What the mouse measurement does establish: coalesced delivery well above 60 Hz (216/s) through the streaming client, `pointerrawupdate` firing (~250/s) in the `tapestry-plugin://` document (so it is a secure context), `crossOriginIsolated` false (transferred `ArrayBuffer` snapshots stay the design), `navigator.gpu` present, predicted events up to 10 per move, and the W3C no-sensor pressure value 0.5 while a button is down.

What it could not establish (PROVISIONAL until a pen is attached): pressure range and distinct-value count (Phase 2 picks the 12- vs 16-bit width from that), tilt presence and sign, twist, and the eraser end's `buttons`.

## The Final PEN_FACTS

```ts
export const PEN_FACTS = {
  measuredOn: '2026-09-24',              // [MEASURED]
  measuredWith: 'mouse',                 // [MEASURED] pointerTypesOnDown was ["mouse"]
  penModel: 'none attached (input via Apollo/Moonlight streaming client)',
  driverVersion: 'Wacom 6.4.13-4 installed, no tablet detected',
  isPrimary: true,                       // [MEASURED]
  pressureMin: 0.5,                      // [MEASURED]
  pressureMax: 0.5,                      // [MEASURED] PROVISIONAL
  pressureDistinct: 1,                   // [MEASURED] PROVISIONAL
  tiltSeen: false,                       // [MEASURED] PROVISIONAL
  tiltXSign: 0,                          // [MEASURED] identity mapping kept
  tiltYSign: 0,                          // [MEASURED] identity mapping kept
  tiltMaxAbs: 0,                         // [MEASURED]
  twistSeen: false,                      // [MEASURED] PROVISIONAL
  twistMax: 0,                           // [MEASURED]
  eraserButtons: null,                   // [MEASURED] PROVISIONAL; the fence uses ERASER_BUTTONS = 32
  coalescedPerSecond: 216,               // [MEASURED]
  predictedPerMoveMin: 0,                // [MEASURED]
  predictedPerMoveMax: 10,               // [MEASURED]
  rawUpdatePerSecond: 250,               // [MEASURED]
  isSecureContext: true,                 // [MEASURED]
  crossOriginIsolated: false,            // [MEASURED]
  gpu: true,                             // [MEASURED]
  strokes: 4,                            // [MEASURED]
  samples: 605,                          // [MEASURED]
  expectedTiltXSignRightward: 1,         // [ASSUMED] W3C / RESEARCH
  expectedTiltYSignTopward: -1,          // [ASSUMED] W3C: tiltY > 0 is toward the user
  expectedEraserButtons: 32,             // [ASSUMED] W3C button 5 / buttons 32
} as const
```

Fence constants that the measurement could not supply and that the fence therefore takes from RESEARCH / W3C, tagged `[ASSUMED]` so the re-measurement can confirm them: `ERASER_BUTTONS = 32`, tilt mapping identity (expected `tiltX > 0` for a rightward tilt, `tiltY < 0` for a top-ward tilt), `PRESSURE_MAX = 65535` (mirror of `DD_PRESSURE_MAX`, provisional until Phase 2).

## Decisions Made

- **Mouse measurement accepted** (Kaelen, Task 2 checkpoint) — see above. The alternative (halting until a pen is attached) would have blocked 01-07 and 01-08 with no way for Kaelen to paint over the stream.
- **`DEFAULT_SETTINGS.allowMouse` derives from `PEN_FACTS.measuredWith`** — pen-only by design, mouse on by default only while the measurement was made with a mouse; a pen re-measurement flips the default back without touching the fence.
- **The eraser bit is refused explicitly**: `paintable` requires `(buttons & 1) === 1` and `(buttons & 32) === 0`, so `buttons 33` cannot paint (the plan's test) even though Blink never sets bit 0 for the eraser end.
- **Tilt mapping is identity** (the plan's rule for "tilt never seen"); the negation instruction is written in `quantizeSample`'s comment for the re-measurement.
- **`FenceCanvas` is a structural interface** so `fence.test.ts` runs with a `FakeCanvas` in the Node environment; `HTMLCanvasElement` satisfies it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worker spawned through a same-origin blob trampoline**
- **Found during:** Task 1 (surface mounted in Tapestry)
- **Issue:** Chromium refuses `new Worker('tapestry-plugin://...')` from the renderer document (worker scripts must be same-origin), so the sim never started inside Tapestry.
- **Fix:** `worker-spawn.ts` `spawnSameOriginModuleWorker` creates a `blob:` module whose only statement statically imports the host-validated `./sim.worker?worker&url` chunk URL; the blob URL is revoked on first message / error and on dispose. This is the 01-04 decision applied to `sim-host.ts` as that decision required.
- **Files modified:** `sim-host.ts`, `worker-spawn.ts`
- **Verification:** sim ticks at 60 Hz inside Tapestry over CDP; zero console errors
- **Committed in:** 5461220

**2. [Rule 3 - Blocking] Vite `base: './'`**
- **Found during:** Task 1
- **Issue:** the worker chunk URL was emitted root-absolute, which does not resolve under `tapestry-plugin://`.
- **Fix:** `vite.config.ts` gained `base: './'`.
- **Files modified:** `surface/vite.config.ts`
- **Committed in:** 5461220

**3. [Rule 1 - Bug] Worker resolves the `.wasm` URL against its own `import.meta.url`**
- **Found during:** Task 1
- **Issue:** a blob-spawned worker's base URL is `blob:`, so a relative `.wasm` path failed to load.
- **Fix:** `sim.worker.ts` builds the absolute `.wasm` URL from `import.meta.url` of the worker chunk.
- **Files modified:** `sim.worker.ts`
- **Committed in:** 5461220

**4. [Rule 2 - Missing Critical] Measurement overlay usability**
- **Found during:** Task 1
- **Issue:** the overlay `<pre>` sat on the stage, so a pointerdown on the JSON started a stroke and the JSON could not be selected; `[dd-measure]` logged on every sample flooded the console; `pressure.distinct` had no sample count for context.
- **Fix:** `PenMeasure` ignores pointerdowns whose target is not the stage element itself; `[dd-measure]` is logged only at stroke ends (the overlay re-renders per frame silently); `MeasureSummary` carries an extra `samples` field.
- **Files modified:** `measure.ts`, `main.ts`
- **Committed in:** 5461220

**5. [Rule 2 - Missing Critical] `MountedSurface.measure` and the dev host implementing the SDK `SurfaceHost`**
- **Found during:** Task 1
- **Issue:** the plan said dev-host.ts is "unchanged"; but with `host-types.ts` deleted, `dev-host.ts` had to implement the SDK `SurfaceHost` (whose `onResize` callback carries dpr), and the console needed `__dd.measure.summary()` to read the JSON when the overlay is hidden.
- **Fix:** `MountedSurface` exposes `measure`; `dev-host.ts` implements `SurfaceHost` including dpr.
- **Files modified:** `main.ts`, `dev-host.ts`
- **Committed in:** 5461220

**6. [Rule 2 - Missing Critical] Mouse accepted by default until a pen is measured**
- **Found during:** Task 3 (after the Task 2 resolution)
- **Issue:** the plan's `Settings` default is `{ allowMouse: false }`; with input arriving only as a mouse over the streaming session, that default would leave 01-07 / 01-08 with nothing to paint with.
- **Fix:** `DEFAULT_SETTINGS = { allowMouse: PEN_FACTS.measuredWith === 'mouse' }` — currently `true`, flips to `false` when `PEN_FACTS` is re-measured with a pen. `paintable` itself is unchanged (mouse only behind the setting; the plan's tests pass explicit settings). Every mouse stroke still carries `pressureSource = 1` in `onBegin` and `FLAG_SOURCE` in every sample, so the prohibition ("never record a mouse stroke as though it carried pen pressure") holds.
- **Files modified:** `input.ts`, `fence.test.ts` (a test pins the derivation)
- **Committed in:** 05af9db

---

**Total deviations:** 6 auto-fixed (3 blocking, 1 bug, 2 missing critical)
**Impact on plan:** Deviations 1-3 are the 01-04 blob decision landing in the real surface — required for the sim to run inside Tapestry at all. 4-5 are measurement ergonomics. 6 is the direct consequence of the checkpoint resolution and is reversible by re-measurement.

## Issues Encountered

- **No pen reachable**: the Task 2 checkpoint expected a Wacom pen; the Mac is driven through Apollo/Moonlight and no tablet is attached, so the measurement is a mouse measurement. Resolved by Kaelen's explicit acceptance; tracked as the open item below.
- The plan's `timeStamp` grep gate flagged a `/** ... */` doc comment on one line (the regex excludes only `//` and `*`-led lines); reworded to "timestamp". No code reads `event.timeStamp`.
- One test expectation was wrong on first run (`Infinity` pressure expected to clamp to 65535; the fence treats every non-finite pressure as 0 per T-06-01). The test was corrected to the intended behaviour; the code was right.

## Open Items

- **Pen re-measurement**: `PEN_FACTS` was measured with a mouse over streaming on 2026-09-24; re-measure with a pen tablet attached to the Mac (or on a future Windows build) and update the fence constants — pressure range / distinct count (Phase 2 width decision), tilt presence and sign (apply the negation rule in `quantizeSample` if `tiltX < 0` for a rightward tilt), twist, eraser `buttons` (confirm 32) — then `DEFAULT_SETTINGS.allowMouse` flips back to `false` automatically. Recorded in `.planning/WINDOWS.md` (kind `unmet-truth`).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: code-execution-surface | plugins/data-drawing/surface/src/worker-spawn.ts | The document executes a `blob:` module Worker whose only statement statically imports the host-validated worker chunk URL (not in the plan's threat model; the blob content is a constant string built from a URL the host already validated, and the URL is revoked on first message / error and on dispose) |

## Known Stubs

None in the UI sense. The provisional `PEN_FACTS` fields are real measurements of the wrong device, not placeholders that flow to rendering; they are tracked as the open item above.

## User Setup Required

None - no external service configuration required. (A pen tablet attached to the Mac is what the open item needs.)

## Next Phase Readiness

- 01-07 can attach `PenFence` to its three.js canvas: `attach(canvas, { viewport, frame, settings: () => DEFAULT_SETTINGS, callbacks })`, stamp `(tick, index)` in the Worker, and feed `onPreview` points to the transient tail. `DEFAULT_SETTINGS.allowMouse` is `true`, so painting works over the stream.
- CANV-02 and STRK-01 stay held for 01-07 (shared-ID gate); STRK-06 is marked complete here (tilt and twist captured with presence flags at the fence, recorded by the 01-05 grammar; hardware confirmation pending the open item).
- Phase 2's 12- vs 16-bit pressure decision cannot be made from this measurement (`pressureDistinct = 1`); it needs the pen re-measurement.

---
*Phase: 01-painting-with-the-pen*
*Completed: 2026-09-24*

## Self-Check: PASSED

Files camera.ts, plane.ts, measure.ts, input.ts, worker-spawn.ts, plane.test.ts, fence.test.ts and dist/surface.js exist; host-types.ts is gone as intended; commits 5461220 and 05af9db exist on data-drawing.
