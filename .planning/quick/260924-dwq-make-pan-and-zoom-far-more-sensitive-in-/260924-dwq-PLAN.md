---
phase: quick-260924-dwq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - app/src/renderer/layout/wheel.ts
  - app/src/renderer/layout/wheel.test.ts
  - app/src/renderer/components/Canvas.tsx
autonomous: true
quick_id: 260924-dwq

estimate:
  tokens: 20000
  raw_tokens: 20000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "Ctrl+wheel or trackpad pinch still zooms, plain wheel/two-finger scroll still pans — the gesture-to-action mapping is unchanged (Kaelen's locked control scheme)"
    - "Zoom is exponential (Math.exp-based) rather than the old linear step, and the per-event rate is substantially higher than the old ZOOM_SPEED=0.001"
    - "Pinch deltas and ctrl+wheel-mouse deltas use two independently tuned zoom rates, not one shared rate"
    - "Plain-wheel/two-finger panning is ~1.6x more sensitive than before (deltaX/deltaY scaled by PAN_SENSITIVITY=1.6, not applied 1:1)"
    - "Wheel deltaMode (pixel/line/page) is normalized to a pixel-equivalent value before it drives either the zoom or the pan math"
    - "Zoom stays anchored at the pointer position (the existing ratio-based panX/panY reprojection is unchanged)"
    - "Zoom stays clamped to the existing MIN_ZOOM=0.1 / MAX_ZOOM=5 range"
  artifacts:
    - path: app/src/renderer/layout/wheel.ts
      provides: "Pure, DOM-free zoom/pan math: normalizeWheelDelta, isZoomPinchDelta, zoomFactor, clampZoom, panDelta, and the tuned rate/threshold constants"
      contains: "export function zoomFactor"
    - path: app/src/renderer/layout/wheel.test.ts
      provides: "Pins every exported function's behavior at concrete sample deltas, including the pinch-vs-wheel rate split and deltaMode normalization"
      contains: "isZoomPinchDelta"
    - path: app/src/renderer/components/Canvas.tsx
      provides: "The wheel handler's ctrlKey (zoom) and non-ctrlKey (pan) branches call into layout/wheel.ts instead of the old inline linear/1:1 math"
      contains: "from '../layout/wheel'"
  key_links:
    - from: app/src/renderer/components/Canvas.tsx
      to: app/src/renderer/layout/wheel.ts
      via: "handleWheel's ctrlKey branch calls normalizeWheelDelta, isZoomPinchDelta, zoomFactor, clampZoom; the else branch calls panDelta"
      pattern: "normalizeWheelDelta(e.deltaY, e.deltaMode)"
---

<objective>
Make canvas pan and zoom far more sensitive without changing which gesture does which: ctrl+wheel/trackpad-pinch still zooms (anchored at the pointer), plain wheel/two-finger scroll still pans. Zoom switches from a tiny linear step to an exponential one with substantially raised, independently-tuned rates for pinch vs. ctrl+held-mouse-wheel deltas; pan gets a 1.6x multiplier; deltaMode (line/page vs. pixel) is normalized before either math runs. The existing MIN_ZOOM/MAX_ZOOM clamp is kept unchanged, since raising sensitivity only changes how fast the 0.1-5 range is traversed, not whether it's reachable.

Purpose: Kaelen: "pan and zoom especially need a lot more sensitivity, you can barely zoom." Source: `.planning/todos/pending/2026-09-24-make-pan-and-zoom-far-more-sensitive.md`.

Output: A new pure math module (`layout/wheel.ts`) with a pinned test file, wired into `Canvas.tsx`'s existing wheel handler.

Scope check (single source: the quick-task description above):
- "keep the current control scheme (ctrl+wheel/pinch = zoom, plain wheel/two-finger = pan)" -> Task 2 leaves the `if (e.ctrlKey)` gate untouched. COVERED.
- "switch to exponential zoom, raise the rate substantially, tune separately for pinch vs any mouse-wheel-reported ctrl+wheel deltas" -> Task 1 (`zoomFactor`, `isZoomPinchDelta`, `ZOOM_RATE_PINCH`/`ZOOM_RATE_WHEEL`), wired in Task 2. COVERED.
- "Pan needs to be about 60% more sensitive (increase the pan multiplier ~1.6x)" -> Task 1 (`PAN_SENSITIVITY = 1.6`, `panDelta`), wired in Task 2. COVERED.
- "Normalize deltaMode (line vs pixel) if relevant" -> Task 1 (`normalizeWheelDelta`), applied to both zoom and pan deltas in Task 2. COVERED.
- "Keep zoom anchored at the pointer" -> Task 2 leaves the existing ratio-based `pointerX`/`pointerY` reprojection untouched. COVERED.
- "Keep the existing MIN_ZOOM/MAX_ZOOM clamp unless it now blocks the increased sensitivity from being usable" -> Task 2 keeps `MIN_ZOOM`/`MAX_ZOOM` as-is; documented rationale in Task 2's action (sensitivity changes traversal speed, not range). COVERED.
- "this needs a manual feel-check" -> flagged in Task 2's `<done>` and in `<success_criteria>` below. COVERED (not skippable — no automated substitute exists for gesture feel).
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@app/src/renderer/components/Canvas.tsx
@app/src/renderer/layout/frames.ts
@app/src/renderer/layout/frames.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure zoom/pan math module — exponential zoom, deltaMode normalization, pan multiplier</name>
  <files>app/src/renderer/layout/wheel.ts, app/src/renderer/layout/wheel.test.ts</files>
  <precondition>
    `npm --prefix app run test -- src/renderer/layout/frames.test.ts` passes on the current tree —
    confirms vitest's node environment already runs a pure, DOM-free module test in `layout/` (the
    exact pattern `wheel.ts`/`wheel.test.ts` will follow) before any new file is added.
  </precondition>
  <read_first>
    - app/src/renderer/layout/frames.ts (module header/export style: plain pure functions and named
      constants, no React/DOM imports — the shape wheel.ts must match)
    - app/src/renderer/layout/frames.test.ts lines 1-27 (vitest `describe`/`it`/`expect` import style
      and the file-header comment convention: state WHY the cases were chosen, not just what they check)
    - app/src/renderer/components/Canvas.tsx lines 169-171 (today's `MIN_ZOOM = 0.1`, `MAX_ZOOM = 5`,
      `ZOOM_SPEED = 0.001` — `ZOOM_SPEED` is being replaced; `MIN_ZOOM`/`MAX_ZOOM` stay in Canvas.tsx
      unchanged and are only passed as arguments into the new `clampZoom`)
    - app/src/renderer/components/Canvas.tsx lines 576-609 (today's wheel handler this module's
      exports will replace math for: the linear `newZoom = prev.zoom * (1 + delta)` in the `ctrlKey`
      branch, and the 1:1 `panX: prev.panX - e.deltaX` in the else branch)
  </read_first>
  <behavior>
    New module `app/src/renderer/layout/wheel.ts`, pure functions/constants only, zero React/DOM
    imports (importable under vitest's `node` environment exactly like `frames.ts`):

    - `PIXELS_PER_LINE = 16` and `normalizeWheelDelta(delta: number, deltaMode: number): number`:
      deltaMode 0 (`DOM_DELTA_PIXEL`, what Chromium/Electron reports for both trackpad and mouse
      wheel in practice) returns `delta` unchanged; deltaMode 1 (`DOM_DELTA_LINE`) returns
      `delta * PIXELS_PER_LINE`; deltaMode 2 (`DOM_DELTA_PAGE`, not expected to occur in Electron)
      returns `delta * 800` as a defensive fallback.
    - `PINCH_DELTA_THRESHOLD = 25` and `isZoomPinchDelta(normalizedDeltaY: number): boolean`
      returning `Math.abs(normalizedDeltaY) < PINCH_DELTA_THRESHOLD`. A trackpad pinch tick reports a
      small deltaY (roughly 1-10); a physical mouse wheel notch with Ctrl held reports a much larger
      one (roughly 50-120+) — this is the "tune separately for pinch vs ctrl+wheel" split, decided
      from the event's own magnitude since no synchronous device-type signal exists on a WheelEvent.
    - `ZOOM_RATE_PINCH = 0.035` and `ZOOM_RATE_WHEEL = 0.0022` — two independently tuned exponential
      rates, both far more aggressive than the old linear `ZOOM_SPEED = 0.001`.
    - `zoomFactor(normalizedDeltaY: number, isPinch: boolean): number` returning
      `Math.exp(-normalizedDeltaY * (isPinch ? ZOOM_RATE_PINCH : ZOOM_RATE_WHEEL))`.
    - `clampZoom(zoom: number, min: number, max: number): number` returning
      `Math.min(max, Math.max(min, zoom))` — same shape as Canvas.tsx's existing inline clamp,
      extracted here so it is covered by this file's tests.
    - `PAN_SENSITIVITY = 1.6` and `panDelta(rawDelta: number, deltaMode: number): number` returning
      `normalizeWheelDelta(rawDelta, deltaMode) * PAN_SENSITIVITY`.

    Test cases to pin in `wheel.test.ts` (write these against the signatures above before or
    alongside the implementation; run vitest and confirm every case below holds):
    - `normalizeWheelDelta(10, 0)` is `10` and `normalizeWheelDelta(-5, 0)` is `-5` (pixel mode
      passthrough, including a negative value).
    - `normalizeWheelDelta(3, 1)` is `48` (line mode: `3 * PIXELS_PER_LINE`).
    - `normalizeWheelDelta(2, 2)` is `1600` (page mode fallback: `2 * 800`).
    - `isZoomPinchDelta(5)` and `isZoomPinchDelta(24)` are `true`; `isZoomPinchDelta(25)` and
      `isZoomPinchDelta(100)` are `false` (boundary is `<`, not `<=`).
    - `zoomFactor(5, true)` equals `Math.exp(-5 * 0.035)` and `zoomFactor(5, false)` equals
      `Math.exp(-5 * 0.0022)`, and the two results are different — proving pinch and wheel use
      distinct rates for the same input delta.
    - For the same magnitude, the pinch factor deviates from `1` by more than the wheel factor does
      (`Math.abs(1 - zoomFactor(20, true)) > Math.abs(1 - zoomFactor(20, false))`) — proving pinch is
      the more sensitive of the two, not just different.
    - `clampZoom(0.05, 0.1, 5)` is `0.1`, `clampZoom(10, 0.1, 5)` is `5`, `clampZoom(2, 0.1, 5)` is
      `2` (below-min, above-max, and in-range passthrough).
    - `panDelta(10, 0)` is `16` (`10 * 1.6`) and `panDelta(2, 1)` is `51.2`
      (`2 * PIXELS_PER_LINE * 1.6`).
  </behavior>
  <action>
    Create `app/src/renderer/layout/wheel.ts` per the behavior block above, matching
    `layout/frames.ts`'s style: a short header comment explaining what the module is for and why the
    pinch/wheel split and deltaMode normalization exist (mirror the "why these cases matter" voice of
    `frames.test.ts`'s header), then the named constants and pure functions, each with a one-line
    doc comment. No import of React, Canvas.tsx, or any DOM type.

    Create `app/src/renderer/layout/wheel.test.ts` using the same `import { describe, expect, it }
    from 'vitest'` style as `frames.test.ts`, with one `describe` block per exported function and one
    `it` per case listed in the behavior block above (exact numeric assertions, not just
    truthy/falsy checks).

    Do not touch Canvas.tsx in this task — wiring is Task 2, so this module's correctness is provable
    in isolation first.
  </action>
  <verify>
    <automated>cd /Users/kaelencook/Tapestry && npm --prefix app run test -- src/renderer/layout/wheel.test.ts</automated>
  </verify>
  <done>
    `wheel.ts` exports `normalizeWheelDelta`, `isZoomPinchDelta`, `zoomFactor`, `clampZoom`,
    `panDelta`, and the named rate/threshold constants; `wheel.test.ts` passes with every case in the
    behavior block above asserted, including the pinch-vs-wheel rate divergence and all three
    deltaMode branches.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire Canvas.tsx's wheel handler to the new math</name>
  <files>app/src/renderer/components/Canvas.tsx</files>
  <read_first>
    - app/src/renderer/components/Canvas.tsx lines 165-171 (constants block: `MIN_ZOOM`, `MAX_ZOOM`,
      `ZOOM_SPEED` — this task deletes `ZOOM_SPEED` only)
    - app/src/renderer/components/Canvas.tsx lines 30-41 (the existing `import ... from '../layout/frames'`
      block — the new `import ... from '../layout/wheel'` goes alongside it)
    - app/src/renderer/components/Canvas.tsx lines 576-609 (`handleWheel`: the `ctrlKey` branch's
      pointer-anchored zoom math to replace the formula inside, and the else branch's 1:1 pan to
      replace)
  </read_first>
  <action>
    In `Canvas.tsx`: add `import { clampZoom, isZoomPinchDelta, normalizeWheelDelta, panDelta,
    zoomFactor } from '../layout/wheel'` next to the existing `../layout/frames` import. Delete the
    `ZOOM_SPEED = 0.001` constant (superseded); leave `MIN_ZOOM = 0.1` and `MAX_ZOOM = 5` exactly as
    they are — raising sensitivity changes how fast the 0.1-5 range is traversed, not whether every
    value in it stays reachable, so the existing clamp does not need to move.

    In `handleWheel`'s `ctrlKey` branch: compute `const normalizedDeltaY =
    normalizeWheelDelta(e.deltaY, e.deltaMode)` before the `setView` call. Inside `setView`, replace
    `const delta = -e.deltaY * ZOOM_SPEED` and `const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM,
    prev.zoom * (1 + delta)))` with a single `const newZoom = clampZoom(prev.zoom *
    zoomFactor(normalizedDeltaY, isZoomPinchDelta(normalizedDeltaY)), MIN_ZOOM, MAX_ZOOM)`. Leave the
    `rect`/`pointerX`/`pointerY` lookup above `setView` and the `ratio`/`panX`/`panY` reprojection
    below it completely unchanged — that is the pointer-anchoring the task must not disturb.

    In `handleWheel`'s `else` (pan) branch: replace `panX: prev.panX - e.deltaX, panY: prev.panY -
    e.deltaY` with `panX: prev.panX - panDelta(e.deltaX, e.deltaMode), panY: prev.panY -
    panDelta(e.deltaY, e.deltaMode)`.

    Do not touch the `if (e.ctrlKey)` condition itself, `e.preventDefault()`, the listener
    registration, or anything outside `handleWheel` — Kaelen confirmed the control scheme (which
    gesture zooms vs. pans) is not changing, only the sensitivity of each.
  </action>
  <verify>
    <automated>cd /Users/kaelencook/Tapestry && npm --prefix app run typecheck</automated>
    <automated>cd /Users/kaelencook/Tapestry && npm --prefix app run test -- src/renderer/layout/wheel.test.ts</automated>
  </verify>
  <done>
    `handleWheel`'s `ctrlKey` branch computes zoom via `zoomFactor`/`isZoomPinchDelta`/`clampZoom` and
    still reprojects `panX`/`panY` around the pointer exactly as before; the else branch scales both
    deltas through `panDelta` (deltaMode-normalized, x1.6); `ZOOM_SPEED` no longer exists in
    Canvas.tsx; `npm --prefix app run typecheck` exits 0. This is a UI feel change with no automated
    substitute for the gesture itself — automated verify above only pins the underlying math (Task 1)
    and confirms the wiring compiles; Kaelen still needs to try pan and zoom in the running app before
    this is considered actually done, and the SUMMARY must say so explicitly.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

No new trust boundary is introduced. This plan only changes two arithmetic formulas (zoom rate, pan
multiplier) and a deltaMode normalization step inside an existing renderer-local wheel-event handler.
The renderer process already fully controls this code path; no new input source, IPC channel, or
external data crosses in.

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-q260924dwq-01 | Denial of Service | `handleWheel` zoom math | low | accept | A malformed or extreme `deltaY` (e.g. from a compromised renderer) could only push `prev.zoom * zoomFactor(...)` toward 0 or +Infinity; `clampZoom` bounds every result to the existing `MIN_ZOOM`/`MAX_ZOOM` (0.1-5) before it is applied, exactly as the pre-existing inline clamp did, so no extreme delta can leave the view unrecoverable |
| T-q260924dwq-SC | Tampering | npm/pip/cargo installs | low | accept | No packages are installed by this plan (two new files plus a three-file edit, using the existing vitest/tsc toolchain already in app/package.json); the package legitimacy gate does not apply |
</threat_model>

<verification>
- Automated: `npm --prefix app run test -- src/renderer/layout/wheel.test.ts` passes (Task 1's math is
  pinned at concrete sample deltas: deltaMode normalization for all three modes, the pinch/wheel rate
  split, clamp boundaries, and the pan multiplier).
- Automated: `npm --prefix app run typecheck` exits 0 (Task 2's wiring compiles against the new
  module's exported types).
- Manual (not automatable, required before this is truly done): Kaelen opens the running app and
  tries ctrl+wheel/pinch zoom and plain wheel/two-finger pan on the canvas. Expected feel: zoom moves
  noticeably faster than before at both a trackpad pinch and a ctrl+held mouse wheel, pan feels
  faster, zoom still centers under the pointer, and zoom still stops at the existing minimum/maximum.
</verification>

<success_criteria>
- The gesture-to-action mapping is unchanged: ctrl+wheel/pinch zooms, plain wheel/two-finger scroll pans.
- Zoom uses the exponential formula with the pinch/wheel rate split; pan is scaled by 1.6x; deltaMode
  is normalized before either.
- Zoom stays anchored at the pointer and clamped to the existing 0.1-5 range.
- `npm --prefix app run test -- src/renderer/layout/wheel.test.ts` and `npm --prefix app run
  typecheck` both pass.
- SUMMARY.md explicitly flags that Kaelen must feel-check pan and zoom in the running app — this is a
  UI feel change and the math tests cannot substitute for that.
</success_criteria>

<output>
Create SUMMARY.md at
`.planning/quick/260924-dwq-make-pan-and-zoom-far-more-sensitive-in-/260924-dwq-SUMMARY.md` when done,
including an explicit note that Kaelen needs to manually try pan/zoom in the running app to confirm
the new sensitivity feels right.
</output>
