---
phase: quick-260924-glr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - app/src/renderer/layout/camera.ts
  - app/src/renderer/layout/camera.test.ts
  - app/src/renderer/components/Canvas.tsx
  - app/src/renderer/components/TreeFrame.tsx
  - app/src/renderer/components/NoteCard.tsx
  - app/src/renderer/components/VaultNoteCard.tsx
  - app/src/renderer/components/FallbackNodeView.tsx
  - app/src/renderer/components/ThreadCenterNode.tsx
  - app/src/renderer/components/FloatingToolbar.tsx
autonomous: true
quick_id: 260924-glr
requirements: [glr-R1, glr-R2, glr-R3, glr-R4, glr-R5, glr-R6, glr-R7, glr-R8]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Ctrl+wheel and trackpad pinch zoom ease (tau about 70 ms) toward a target computed against the TARGET camera, so a burst of notches stays anchored at the cursor, and the anchor stays under the cursor for the whole ease, not just at the end (glr-R1, glr-R3)"
    - "Pointer-drag pan and plain-wheel two-finger pan stay 1:1 under the hand and are never eased; pressing on the background stops any in-flight ease where it is drawn (glr-R3)"
    - "panToFrame, the only programmatic move today, flies eased (tau about 200 ms) to centre the frame (glr-R3)"
    - "Shift+wheel rolls about the cursor; Q and E roll 15 degrees about the viewport centre; 0 resets roll to exactly 0 about the viewport centre; all eased (tau about 80 ms); the keys do nothing while typing in ProseMirror, contenteditable, input, textarea or select, or with Cmd, Ctrl or Alt held (glr-R4)"
    - "About 150 ms after the last roll input, a target roll within 4 degrees of a multiple of 90 eases to that multiple; no snap while roll input continues or after the hand takes over with a pan (glr-R5)"
    - "At roll 0 the canvas is drawn exactly as before: the same CSS transform string, zoom limits, pan sensitivity and pinch/wheel split; the camera is never written to the tree or to settings (glr-R6)"
    - "Every screen-to-world conversion stays correct at non-zero roll: hit tests, double-click create, connection drawing, frame drag, note, vault-note, fallback and thread-centre drag, note resize from every edge, measured card sizes, and floating-toolbar placement (glr-R2, glr-R7)"
    - "The animation loop stops once the drawn camera reaches the target, so the page idles (glr-R1)"
  artifacts:
    - path: app/src/renderer/layout/camera.ts
      provides: "Pure camera module: Camera {panX, panY, zoom, roll}, transforms and their exact inverse, screen-delta-to-world, zoom/roll about a point, centreOn, frame-rate independent step, CameraRig (target + drawn + soft roll snap), CSS transform string, layout-size and element-local helpers"
      contains: "export class CameraRig"
    - path: app/src/renderer/layout/camera.test.ts
      provides: "Pins easing convergence independent of frame rate, log-space zoom, settle-and-stop, anchor fixed point against the target, rotation round trip, shortest-path roll, snap window, and roll-0 identity with the old formulas"
      contains: "describe('step'"
    - path: app/src/renderer/components/Canvas.tsx
      provides: "Thin integration: a CameraRig plus one rAF loop; every camera write goes through the rig; the render and all hit tests use the drawn camera"
      contains: "cameraTransformCss(view)"
    - path: app/src/renderer/components/TreeFrame.tsx
      provides: "Threads the drawn roll to every card that converts screen deltas"
      contains: "roll={roll}"
    - path: app/src/renderer/components/FloatingToolbar.tsx
      provides: "Toolbar placement that stays correct inside a rotated card"
      contains: "screenToElementLocal"
  key_links:
    - from: app/src/renderer/components/Canvas.tsx
      to: app/src/renderer/layout/camera.ts
      via: "the wheel handler calls rig.easeTo with zoomAbout (ctrl), rig.roll with rollDeltaFromWheel (shift), rig.direct with panBy (plain); the rAF loop calls rig.tick and setView; the container style calls cameraTransformCss"
      pattern: "rig\\.(easeTo|direct|roll|tick)"
    - from: app/src/renderer/components/Canvas.tsx pointerWorld
      to: app/src/renderer/layout/camera.ts screenToWorld
      via: "hit testing inverts the DRAWN camera (the view state) so a click lands where content appears"
      pattern: "screenToWorld\\(view"
    - from: app/src/renderer/components/TreeFrame.tsx
      to: "NoteCard, VaultNoteCard, FallbackNodeView, ThreadCenterNode, FloatingToolbar"
      via: "roll prop next to zoom; each drag, resize and measurement calls screenDeltaToWorld, layoutSize or screenToElementLocal"
      pattern: "screenDeltaToWorld\\("
---

<objective>
Give the 2D canvas camera a roll and eased motion, per 02.6-3D-FRAMES.md section 4 "Navigation" ("The camera rolls, and up is not forced" and "The camera eases toward its target", Kaelen, 2026-09-24).

Input moves a target camera. A drawn camera follows it with frame-rate independent exponential smoothing, and the screen always shows the drawn camera. Direct manipulation is never eased. The camera logic lives in a new pure module, app/src/renderer/layout/camera.ts, and Canvas.tsx stays a thin integration, because phase 2.6 plan 03 edits Canvas.tsx next (its imports, positionedRects, settleFrames, the placement-correction effect and handlePointerUp). This plan does not touch settleFrames, positionedRects, the placement-correction effect or handlePointerUp, so that merge stays easy.

Purpose: this is the 2D, forward-compatible step 3 of section 5 in 02.6-3D-FRAMES.md. View history, fly-to-by-name and zoom-to-fit will be built on this camera later. They are not in this plan.

Output: camera.ts and camera.test.ts; Canvas.tsx wired to a CameraRig; the drawn roll threaded through TreeFrame to every card that turns screen deltas into world deltas.

One refinement to requirement 1, called out for Kaelen (it follows the design's own line "Zoom stays anchored at the cursor"). If pan eased linearly while zoom eased separately in log space, the zoom anchor would drift during the ease. The drift grows with the anchor's on-screen distance from the world origin and reaches hundreds of pixels on a burst. So step() moves pan along the similarity geodesic between the drawn and target transforms. When only pan differs, that is exactly a linear ease. When zoom or roll also differ, the point both transforms share, which is the cursor anchor or the rotation centre, stays fixed on screen for the whole ease. Zoom still eases exactly in log space, and roll exactly along the shortest arc. It stays frame-rate independent because each step moves the same fraction along the same curve. The tests pin all of this.

Scope check against the quick-task requirements (glr-R1 to glr-R8 are items 1 to 8 of the task description):
- glr-R1: pure camera module, target and drawn, step with k = 1 - exp(-dt/tau), log zoom, shortest-path roll, settle thresholds, snap-and-stop. Task 1. COVERED.
- glr-R2: transform translate(pan) rotate(roll) scale(zoom) with origin 0 0; screenToWorld and worldToScreen on the drawn camera with an exact inverse; screen-delta-to-world helper. Task 1, with the helper used in Tasks 1 and 3. COVERED.
- glr-R3: easing rules. Pointer and wheel pan direct (tau 0). Wheel and pinch zoom tau 70 ms, anchored against the target. panToFrame fly tau 200 ms. Roll tau 80 ms. Tasks 1 and 2. COVERED.
- glr-R4: roll input. Shift+wheel about the cursor at 0.25 degrees per px; Q/E in 15-degree steps; 0 resets; editable-focus guard; trackpad rotate documented as not available in Chromium and skipped. Task 2. COVERED.
- glr-R5: soft snap within 4 degrees of a quarter turn after 150 ms idle, never while turning. Task 2. COVERED.
- glr-R6: view state only; roll 0 pixel-identical. Task 1 (CSS string and formula-identity tests) and the verification gate. COVERED.
- glr-R7: every screen-to-world consumer stays roll-correct. Canvas in Task 1; cards, dims and toolbar in Task 3. The known limits are listed in Task 3 instead of being left silently wrong. COVERED.
- glr-R8: the camera.test.ts cases listed, plus the three-command gate. Tasks 1 to 3 and the verification section. COVERED.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.planning/phases/02.6-placement-edges-forest-tree/02.6-3D-FRAMES.md
@.claude/skills/spike-findings-tapestry/references/navigation-and-feel.md
@app/src/renderer/components/Canvas.tsx
@app/src/renderer/layout/wheel.ts
@app/src/renderer/layout/wheel.test.ts

Working tree: /Users/kaelencook/Tapestrees/spatial-canvas on branch ws/spatial-canvas. Stay on this branch and in this directory.

Commit hygiene: the tree is shared, and .gsd/dispatch-isolation-sentinel.json is already modified and is not yours. Stage only the explicit paths in files_modified, never `git add -A`, and check `git show --stat HEAD` after each commit.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1 (tracer): camera module with target/drawn easing, wired end to end through Canvas for eased zoom, direct pan and the panToFrame fly</name>
  <files>app/src/renderer/layout/camera.ts, app/src/renderer/layout/camera.test.ts, app/src/renderer/components/Canvas.tsx</files>
  <precondition>`npm --prefix app run test` passes on the current tree (baseline 21 files / 443 tests), so every later failure belongs to this task.</precondition>
  <read_first>
    - app/src/renderer/layout/wheel.ts: module header style (why, not just what), pure exports, and `clampZoom`, which camera.ts imports rather than duplicates
    - app/src/renderer/layout/wheel.test.ts lines 1-20: vitest import style and the header comment explaining why the cases were chosen
    - app/src/renderer/components/Canvas.tsx lines 134-165 (the coordinate helpers this task replaces), 234-240 (view state and pan refs), 339-381 (panToFrame, pointerWorld), 482-532 (handlePointerDown, handlePointerMove), 576-614 (wheel effect), 719-727 (containerStyle)
    - .planning/phases/02.6-placement-edges-forest-tree/02.6-3D-FRAMES.md section 4, the bullet "The camera eases toward its target"
  </read_first>
  <behavior>
    camera.test.ts, written first and seen failing (RED), then made to pass:
    - Roll-0 identity (glr-R6). cameraTransformCss({panX: 12.5, panY: -3, zoom: 1.25, roll: 0}) is exactly 'translate(12.5px, -3px) scale(1.25)', today's string. With roll 30 it is exactly 'translate(12.5px, -3px) rotate(30deg) scale(1.25)'.
    - At roll 0, screenToWorld returns exactly (sx - panX) / zoom and (sy - panY) / zoom (toBe, not toBeCloseTo), zoomAbout returns exactly today's pan (sx - ratio * (sx - panX)) and clamped zoom, and centerOn returns exactly viewportW / 2 - wx * zoom.
    - CSS direction pin: at roll 90, zoom 1 and pan 0, worldToScreen(1, 0) is (0, 1) within 1e-12. Positive roll is clockwise on screen, like CSS rotate.
    - Round trip: for rolls {0, 37, -120, 180} and zooms {0.1, 1, 4.2}, worldToScreen(screenToWorld(p)) returns p within 1e-9.
    - screenDeltaToWorld(dx, dy, zoom, roll) equals screenToWorld(p + d) - screenToWorld(p) within 1e-9 at roll 37, and exactly dx / zoom at roll 0.
    - Zoom anchor against the target: zoomAbout keeps the world point under (sx, sy) fixed within 1e-9 at roll 0 and roll 37, including when the zoom clamps at min or max. Three successive zoomAbout calls on the same target leave the same world point under the cursor, so a burst does not drift.
    - normalizeRoll maps to (-180, 180] and returns values already in range unchanged, bit for bit. shortestRollDelta(170, -170) is 20, and shortestRollDelta(-170, 170) is -20.
    - step, log space: drawn zoom 1, target zoom 4, and dt = tau * ln 2 (so k = 0.5) gives zoom 2 within 1e-12, not 2.5.
    - step, pure translation (same zoom and roll) is linear: pan is pan0 + k * (pan1 - pan0) within 1e-9.
    - step, frame-rate independence: the same drawn-to-target ease with pan, zoom and roll all different, run for 100 ms at 60 Hz, at 120 Hz, and at irregular dts that sum to 100 ms, gives drawn cameras equal within 1e-6.
    - step, anchor held during the ease: from a camera at roll 37, zoomAbout the target around (sx, sy). At every intermediate 60 Hz frame, worldToScreen(drawn, anchorWorld) stays within 0.5 px of (sx, sy).
    - step, settle and stop: tau 0 returns the target with settled true. dt 0 leaves drawn unchanged. A 5000 px fly at tau 200 ms and 60 Hz reports settled within 3 simulated seconds, and the settled camera toEquals the target exactly.
    - CameraRig: direct(change) applies change to both target and drawn. hold() sets target to drawn. easeTo whose result has a non-finite field (NaN or Infinity) leaves the target unchanged. tick returns false once settled, and later ticks leave drawn unchanged. direct() during an ease shifts both cameras and keeps the ease going.
  </behavior>
  <action>
    Create app/src/renderer/layout/camera.ts as a pure module with no React and no DOM imports, runnable under vitest's node environment. It imports clampZoom from './wheel'. Its header comment explains why: input moves a target and the screen shows a drawn camera; direct manipulation is never eased because lag under the hand feels like the app fighting you (spike 011); the geodesic step keeps the zoom anchor fixed during an ease; the camera is view state only (glr-R6); at roll 0 the output is today's.

    Exports, per glr-R1 and glr-R2:
    - interface Camera { panX, panY, zoom, roll }. roll is in degrees, normalised to (-180, 180], and positive is clockwise on screen. IDENTITY_CAMERA is {0, 0, 1, 0}.
    - Constants ZOOM_TAU_MS = 70, FLY_TAU_MS = 200, ROLL_TAU_MS = 80, SETTLE_PAN_PX = 0.5, SETTLE_ZOOM_REL = 5e-4 (0.5 px at 1000 px from the anchor, the "small relative epsilon" option of glr-R1), and SETTLE_ROLL_DEG = 0.05.
    - normalizeRoll(deg). Values already in (-180, 180] come back untouched so that exact values stay exact. Anything else wraps, and -180 maps to 180. shortestRollDelta(from, to) is normalizeRoll(to - from).
    - The transform is screen = R(roll) * (world * zoom) + pan, with R = [cos, -sin; sin, cos]. worldToScreen(cam, wx, wy) and screenToWorld(cam, sx, sy) take viewport-relative screen coordinates; the caller subtracts the viewport rect's left and top. screenToWorld subtracts pan, rotates by -roll and divides by zoom. screenDeltaToWorld(dx, dy, zoom, roll) does the same without pan.
    - panBy(cam, dx, dy). zoomAbout(cam, factor, sx, sy, minZoom, maxZoom): new zoom = clampZoom(zoom * factor), ratio = new / old, pan' = s - ratio * (s - pan). The rotation cancels out, so this is today's formula. centerOn(cam, wx, wy, viewportW, viewportH): pan = viewport centre - R(roll) * (w * zoom).
    - cameraTransformCss(cam). When roll is 0 it returns exactly the string Canvas builds today, `translate(Xpx, Ypx) scale(Z)`. Otherwise it returns `translate(Xpx, Ypx) rotate(Rdeg) scale(Z)`. Used with transform-origin 0 0.
    - isFiniteCamera(cam).
    - step(drawn, target, dtMs, tauMs) returns { camera, settled }. When tauMs is 0 or less, or drawn is not finite, return a copy of target with settled true. Otherwise k = 1 - exp(-dtMs / tauMs). Treat each transform as a complex similarity a*w + b with a = zoom * e^(i*roll) and b = panX + i*panY. Let zr = target.zoom / drawn.zoom and let dθ be the shortestRollDelta in radians. Then m = zr * e^(i*dθ), m^k = zr^k * e^(i*k*dθ), and c = b_target - m * b_drawn. f = (1 - m^k) / (1 - m) as a complex division, or f = k when |1 - m| < 1e-12. New zoom = drawn.zoom * zr^k (log space). New roll = normalizeRoll(drawn.roll + k * dθ in degrees) (shortest arc). New b = m^k * b_drawn + f * c. Afterwards, if |Δpan| < SETTLE_PAN_PX and |target.zoom / new.zoom - 1| < SETTLE_ZOOM_REL and |shortestRollDelta| < SETTLE_ROLL_DEG, return a copy of target with settled true.
    - class CameraRig, constructed from an initial Camera, with readable target and drawn and a current tau. direct(change) applies change to target and to drawn (glr-R3, tau 0). hold() sets target to a copy of drawn, which is a grab stopping any ease. easeTo(change, tauMs) replaces target with change(target) only when the result isFiniteCamera, and records tauMs; the most recent eased input's tau wins. tick(nowMs, dtMs) runs step with the current tau, stores the result as drawn, and returns true while another frame is needed. A settled getter reports drawn equal to target. Task 2 extends the rig, so keep its fields private but extendable, and leave a clear place in tick for the snap check.

    Canvas.tsx integration (thin; do not touch handlePointerUp, settleFrames, positionedRects or the placement-correction effect):
    - Delete the two exported coordinate helpers in the "Coordinate helpers" section (no other file imports them; verified with grep). Update the file header to say that pan, zoom and roll live in ../layout/camera and that the screen shows the drawn camera.
    - Replace the view state's local three-field interface with Camera. The view state becomes the drawn camera, useState<Camera>(IDENTITY_CAMERA). Create the rig once with useState(() => new CameraRig(IDENTITY_CAMERA)). Add rafRef and lastFrameRef. Add a stable showDrawn callback that calls setView with a copy of rig.drawn. Add a stable kick callback: if no frame is scheduled, set lastFrameRef to performance.now() and request a frame; each frame computes dt = max(0, now - lastFrameRef), calls rig.tick(now, dt), calls setView with a copy of rig.drawn, and schedules the next frame only when tick returned true, otherwise it clears rafRef to 0. An unmount effect cancels the frame and zeroes rafRef, which also covers the StrictMode remount.
    - panToFrame: rig.easeTo(c => centerOn(c, rect midpoint x, rect midpoint y, clientWidth, clientHeight), FLY_TAU_MS), then kick() (glr-R3 fly). Update its doc comment.
    - pointerWorld: screenToWorld(view, clientX - rect.left, clientY - rect.top), using the drawn camera per the design line "hit-testing uses the drawn camera". Depend on view.
    - handlePointerDown, background pan: call rig.hold(), then record the pointer's client position in a ref as the last pan point. It replaces panStartRef's stored pan.
    - handlePointerMove: the frame drag converts (clientX - startX, clientY - startY) with screenDeltaToWorld(..., view.zoom, view.roll) and keeps the existing more-than-2-world-units moved test on the converted delta. The background pan calls rig.direct(c => panBy(c, the delta since the last pan point)), updates the last pan point, then calls showDrawn(). Deps use view.zoom and view.roll.
    - Wheel effect. The ctrlKey branch calls rig.easeTo(c => zoomAbout(c, zoomFactor(normalized deltaY, isZoomPinchDelta(normalized deltaY)), pointerX, pointerY, MIN_ZOOM, MAX_ZOOM), ZOOM_TAU_MS), then kick(). The anchor is computed against the target (glr-R3), and wheel.ts is unchanged. The else branch calls rig.direct(c => panBy(c, -panDelta(e.deltaX, e.deltaMode), -panDelta(e.deltaY, e.deltaMode))), then showDrawn(). The effect deps are [rig, kick, showDrawn], which are stable, so it still binds once. Drop the now-unused clampZoom import (noUnusedLocals).
    - containerStyle.transform = cameraTransformCss(view). TreeFrame still receives zoom={view.zoom}; Task 3 adds roll.

    Commit: feat(quick-260924-glr): camera module with eased zoom and fly, direct pan
  </action>
  <verify>
    <automated>npm --prefix app run test -- src/renderer/layout/camera.test.ts && npm --prefix app run typecheck && grep -c "cameraTransformCss(view)" app/src/renderer/components/Canvas.tsx && test "$(grep -vE '^\s*(//|\*)' app/src/renderer/components/Canvas.tsx | grep -cE '\) / view\.zoom|^export function (screenToWorld|worldToScreen)')" = "0"</automated>
  </verify>
  <done>camera.test.ts passes every Task 1 behaviour case and the typecheck is clean. In Canvas.tsx, every camera write goes through the rig, rendering uses cameraTransformCss(view), hit tests use screenToWorld on the drawn camera, the frame drag uses screenDeltaToWorld, and the rAF loop stops when tick returns false. Committed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: roll input (Shift+wheel about the cursor, Q/E, 0) with the soft quarter-turn snap</name>
  <files>app/src/renderer/layout/camera.ts, app/src/renderer/layout/camera.test.ts, app/src/renderer/components/Canvas.tsx</files>
  <read_first>
    - app/src/renderer/layout/camera.ts and camera.test.ts as Task 1 left them (CameraRig's tick and the easeTo validation path)
    - app/src/renderer/components/Canvas.tsx: the wheel effect as Task 1 left it, and the existing Delete keydown effect around the "Keyboard Delete/Backspace" section. It guards with editingRef. The new handler adds a focus check because App.tsx's keydown uses document.activeElement.closest('.ProseMirror').
    - app/src/renderer/App.tsx lines 654-678 (the existing editable-focus detection pattern)
  </read_first>
  <behavior>
    Added to camera.test.ts:
    - rollAbout(cam, delta, sx, sy) keeps the world point under (sx, sy) fixed within 1e-9. Applying +90 then -90 returns the original camera within 1e-9. rollTo(cam, 0, sx, sy) sets roll toBe(0) exactly.
    - step takes the shortest path: drawn roll 170 and target -170 give a first-step roll in (170, 180] or [-180, -170), and the whole ease covers 20 degrees, not 340.
    - snapRoll: 3 gives 0, -4 gives 0 (the window is inclusive), 4.01 gives null, 88 gives 90, -92 gives -90, 178 gives 180, -177 gives 180, and 45 gives null.
    - rollDeltaFromWheel(deltaX, deltaY, deltaMode) uses the dominant axis, because macOS turns Shift+mouse-wheel into deltaX. deltaY 100 in pixel mode gives 25 degrees, deltaX 100 with deltaY 0 gives 25, and line mode is normalised through normalizeWheelDelta.
    - Rig soft snap. rig.roll(3, sx, sy, 0) followed by tick at t = 100 leaves the target roll at 3. Tick at t = 160 sets the target roll to exactly 0, and tick keeps returning true while a snap is pending, even if already settled. rig.roll to 10 degrees never snaps. Roll input every 50 ms from t = 0 to 400 never snaps before t = 400 + 150. A direct() or hold() at t = 50 cancels the pending snap. rig.resetRoll(sx, sy) eases the target roll to exactly 0 and arms no snap.
    - layoutSize(fake element, zoom, roll). At roll 0 it returns exactly the getBoundingClientRect size divided by zoom, which is today's measurement. At roll 30 it returns offsetWidth and offsetHeight.
    - screenToElementLocal(point, aabbTopLeft, layoutSize, zoom, roll). At roll 0 it returns exactly ((px - left) / zoom, (py - top) / zoom). At rolls {30, 135, -60, 180}, build an element at a world rect under a camera, take its axis-aligned bounds from the four corners via worldToScreen, map a local point to the screen, and the helper recovers the local point within 1e-6.
  </behavior>
  <action>
    Extend camera.ts per glr-R4 and glr-R5:
    - Constants ROLL_DEG_PER_PX = 0.25, ROLL_KEY_STEP_DEG = 15, ROLL_SNAP_WINDOW_DEG = 4 and ROLL_SNAP_IDLE_MS = 150.
    - rollAbout(cam, deltaDeg, sx, sy): roll' = normalizeRoll(roll + delta) and pan' = s + R(delta) * (pan - s).
    - rollTo(cam, rollDeg, sx, sy): rollAbout by shortestRollDelta, then set roll to exactly normalizeRoll(rollDeg).
    - snapRoll(roll): the nearest multiple of 90, normalised, when within ROLL_SNAP_WINDOW_DEG inclusive; otherwise null.
    - rollDeltaFromWheel(deltaX, deltaY, deltaMode): the dominant axis through normalizeWheelDelta from './wheel', times ROLL_DEG_PER_PX. Positive deltaY is clockwise.
    - layoutSize(el, zoom, roll), where el is structurally typed { getBoundingClientRect(): { width, height }, offsetWidth, offsetHeight } so the module stays DOM-free. At roll 0 it returns the bounding size divided by zoom, keeping today's fractional measurement bit for bit. At any other roll the bounding box is the rotated card's axis-aligned hull, so it returns offsetWidth and offsetHeight, the layout size in local px, rounded to whole px. The doc comment says so.
    - screenToElementLocal(point, aabb {left, top}, size {width, height}, zoom, roll). At roll 0 it is the existing formula. Otherwise, rotate the scaled corner offsets (w*zoom, 0), (0, h*zoom) and (w*zoom, h*zoom) by roll, place the element's local origin at aabb minus the per-axis minimum of {0, those offsets}, and return R(-roll) * (point - origin) / zoom.
    - CameraRig.roll(deltaDeg, sx, sy, nowMs): easeTo(c => rollAbout(c, delta, sx, sy), ROLL_TAU_MS), computed against the target, then record nowMs as the last roll input and (sx, sy) as the snap anchor. CameraRig.resetRoll(sx, sy): easeTo(c => rollTo(c, 0, sx, sy), ROLL_TAU_MS), with no snap armed. In tick, if a roll input is pending and nowMs - last >= ROLL_SNAP_IDLE_MS, clear it; then, if snapRoll(target.roll) is non-null and differs from target.roll, easeTo rollTo(snap, anchor) with ROLL_TAU_MS. tick returns true while a snap is pending. direct() and hold() clear a pending snap, following spike 011: no pull while the hand is moving.

    Canvas.tsx:
    - Wheel effect: between the ctrlKey branch and the plain-pan branch, add a shiftKey branch that calls rig.roll(rollDeltaFromWheel(e.deltaX, e.deltaY, e.deltaMode), e.clientX - rect.left, e.clientY - rect.top, performance.now()), then kick(). The ctrlKey pinch still wins. Shift plus two-finger scroll used to pan sideways and now rolls, which is the gesture the design names. Add a comment that Chromium on macOS exposes no trackpad rotate gesture (WebKit's gesturechange event exists only in Safari), so trackpad rotate is not available and roll comes from Shift+wheel, Q/E and 0 (glr-R4).
    - A new keydown effect, separate from the Delete handler. Return early when e.defaultPrevented is set, when e.metaKey, e.ctrlKey or e.altKey is held (Cmd+Q and Cmd+0 belong to the app menu), when editingRef is set, or when a module-level isTypingTarget(e.target) is true: e.target is an HTMLElement that isContentEditable or has closest('.ProseMirror, input, textarea, select, [contenteditable]'). For e.key lower-cased: 'q' calls rig.roll(-ROLL_KEY_STEP_DEG, cx, cy, performance.now()), 'e' calls rig.roll(+ROLL_KEY_STEP_DEG, ...), and '0' calls rig.resetRoll(cx, cy). cx and cy are half the viewport's clientWidth and clientHeight. For those keys, call preventDefault and then kick().

    Commit: feat(quick-260924-glr): roll the canvas with Shift+wheel, Q/E and 0, with a soft quarter-turn snap
  </action>
  <verify>
    <automated>npm --prefix app run test -- src/renderer/layout/camera.test.ts && npm --prefix app run typecheck && grep -cE "rig\.roll\(|rig\.resetRoll\(" app/src/renderer/components/Canvas.tsx</automated>
  </verify>
  <done>All roll, snap, layoutSize and screenToElementLocal cases pass. Shift+wheel rolls about the cursor, Q/E step 15 degrees, 0 resets exactly, and all three are ignored while typing or with modifiers. The soft snap fires only after 150 ms without roll input. Typecheck clean. Committed.</done>
</task>

<task type="auto">
  <name>Task 3: every card drag, resize, measurement and toolbar stays under the pointer at any roll</name>
  <files>app/src/renderer/components/Canvas.tsx, app/src/renderer/components/TreeFrame.tsx, app/src/renderer/components/NoteCard.tsx, app/src/renderer/components/VaultNoteCard.tsx, app/src/renderer/components/FallbackNodeView.tsx, app/src/renderer/components/ThreadCenterNode.tsx, app/src/renderer/components/FloatingToolbar.tsx</files>
  <read_first>
    - app/src/renderer/components/TreeFrame.tsx lines 155-200 (props) and every `zoom={zoom}` site (about 260, 381, 445, 470, 495 and 530; FrameHeader is one of them)
    - app/src/renderer/components/NoteCard.tsx lines 290-298 (dims), 355-490 (drag and resize), and about 642 (FloatingToolbar)
    - app/src/renderer/components/VaultNoteCard.tsx lines 85-131; FallbackNodeView.tsx lines 180-215; ThreadCenterNode.tsx lines 125-160 and about 211
    - app/src/renderer/components/FloatingToolbar.tsx lines 35-120
  </read_first>
  <action>
    Seven files are more than the usual five, and that is deliberate. They form one mechanical change: thread the drawn roll and swap each screen-to-local conversion for a helper from ../layout/camera. Splitting it would commit a tree where some cards track the pointer under roll and others do not (glr-R7).
    - Canvas.tsx: pass roll={view.roll} to TreeFrame. That is the only Canvas change in this task.
    - TreeFrame.tsx: add a required roll: number prop next to zoom, with a doc comment (the drawn camera roll, in degrees, which cards need to turn screen deltas into world deltas). Pass roll={roll} to ThreadCenterNode, VaultNoteCard, NoteCard and FallbackNodeView. FrameHeader does not get it: its counter-scale depends only on zoom.
    - In NoteCard, VaultNoteCard, FallbackNodeView and ThreadCenterNode, add an optional roll prop defaulting to 0, with a doc comment. Replace each pair of screen deltas divided by zoom with a single screenDeltaToWorld(dx, dy, zoom, roll) call: the drag in all four, plus NoteCard's resize move. The left and top resize rules then work in local axes unchanged. Replace each getBoundingClientRect-divided-by-zoom size read with layoutSize(element, zoom, roll): the dims registration in all four, plus NoteCard's resize-start fallback width and height. Add roll to every useCallback and useEffect dependency list that already lists zoom. Do not leave the old expressions in comments; the verify grep counts non-comment lines only, but keep them out anyway.
    - NoteCard and ThreadCenterNode: pass roll={roll} to FloatingToolbar.
    - FloatingToolbar.tsx: add roll?: number (default 0) and extend the zoom doc comment to cover it. In update(), compute the local point with screenToElementLocal({ x: (start.left + end.left) / 2, y: start.top }, containerRect, { width: container.offsetWidth, height: container.offsetHeight }, scale, roll). Then set top to local.y - TOOLBAR_OFFSET and left to local.x. Add roll to the effect deps. At roll 0 this is exactly today's arithmetic.

    Known limits, stated here and to be repeated in the SUMMARY rather than left silently wrong (glr-R7):
    1. At non-zero roll, measured card sizes come from offsetWidth and offsetHeight, which are rounded to whole px. That can shift frame bounds and connection-line centres by under 1 px. At roll 0 the fractional measurement is unchanged.
    2. ProseMirror's coordsAtPos returns axis-aligned rects under rotation, so the toolbar's anchor is the corner of the rotated selection-start box rather than its true top. Placement is off by at most one glyph box.
    3. Text hit testing inside a rotated editor (caret placement, drag-select, and passage-plugin's posAtCoords hover) relies on Chromium's transform-aware hit testing. There is no Tapestry math to fix there, but it is unverified under roll, so it goes to Kaelen's hand check.
    4. Card drags and resizes keep today's pattern of using the zoom and roll captured when the drag starts. A drag begun during a camera ease (at most about 3 tau, 200 to 600 ms) can slide slightly relative to the pointer until the ease settles. This is the same as pinching during a drag today.
    5. Unaffected, and checked: PluginSurfaceLayer is a full-window layer outside the transformed container; ConnectionLine and frame-local coordinates are world-space inside the container; FrameHeader's counter-scale depends only on zoom; there are no drop handlers in the renderer.

    Commit: feat(quick-260924-glr): cards and toolbar convert screen deltas through the rolled camera
  </action>
  <verify>
    <automated>npm --prefix app run build:js && npm --prefix app run typecheck && npm --prefix app run test && test "$(cat app/src/renderer/components/NoteCard.tsx app/src/renderer/components/VaultNoteCard.tsx app/src/renderer/components/FallbackNodeView.tsx app/src/renderer/components/ThreadCenterNode.tsx | grep -vE '^\s*(//|\*)' | grep -cE 'client[XY] - [^)]*\) / zoom|(width|height) / zoom')" = "0" && grep -c "screenToElementLocal" app/src/renderer/components/FloatingToolbar.tsx && grep -c "roll={roll}" app/src/renderer/components/TreeFrame.tsx</automated>
    <human-check>`npm --prefix app run dev`, open a world with notes in two trees. (a) Ctrl+wheel or pinch: zoom glides and the point under the cursor stays put during and after, including on a fast burst. (b) Drag the background and two-finger pan: 1:1, no lag. (c) Add a tree: the view flies to it. (d) Shift+wheel rolls about the cursor; Q/E turn 15 degrees about the centre; 0 returns to level; release within about 4 degrees of level or a quarter turn and it settles there; hold Shift+wheel slowly near 0 and it never snaps while turning. (e) At about 30 degrees of roll: drag a note, resize a note from its left and top edges, drag a frame header, draw a connection, double-click to create a note, and select text to raise the toolbar. Each lands under the pointer. (f) Type q, e and 0 into a note and into a frame-name input: text appears and nothing rolls. (g) At roll 0 everything looks and feels as before, apart from the glide.</human-check>
  </verify>
  <done>At any roll, every card drag and resize, every measured size and the floating toolbar use the camera helpers. The full gate is green: build:js, typecheck, and test at 22 files with more than the 443 baseline tests. The five known limits are recorded in the SUMMARY. Committed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| OS input to renderer view state | Wheel and keyboard events (untrusted magnitudes and keys) drive the camera. Nothing crosses to main, preload, the kernel, the tree or settings. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-glr-01 | D (Denial of service) | camera.ts step / CameraRig and the Canvas rAF loop | medium | mitigate | A non-finite wheel delta (a NaN zoom) would never meet the settle test and would spin rAF forever. CameraRig.easeTo rejects non-finite targets, step snaps a non-finite drawn camera to the target, and the loop schedules another frame only while tick returns true. Tests pin the NaN rejection and the settle within 3 s. |
| T-glr-02 | T (Tampering) | Canvas keydown roll handler | medium | mitigate | Q/E/0 must not hijack typing or app shortcuts. The handler returns before preventDefault for editable targets (ProseMirror, contenteditable, input, textarea, select), while editingRef is set, when Cmd, Ctrl or Alt is held, and when the event is already defaultPrevented. |
| T-glr-03 | I (Information disclosure) | camera state | low | accept | The camera is view state only (glr-R6). This plan changes no file under app/src/main or app/src/preload, and camera.ts has no IPC or storage import, so nothing about the view is written to the tree or settings. |
</threat_model>

<verification>
- `npm --prefix app run build:js`, `npm --prefix app run typecheck` and `npm --prefix app run test` are all green, with 22 test files and more than 443 tests (glr-R8).
- `git diff --name-only HEAD~3 -- app/src/main app/src/preload` is empty: the camera is never persisted (glr-R6).
- `grep -n "window.tapestry" app/src/renderer/layout/camera.ts` is empty: the module is pure.
- `git show --stat HEAD~2 HEAD~1 HEAD` lists only the files_modified paths, and never .gsd/.
</verification>

<success_criteria>
- Zoom (wheel and pinch), the panToFrame fly and roll all glide toward a target and stop animating once settled. Pointer-drag and two-finger pans stay 1:1.
- Roll works by Shift+wheel, Q/E and 0, with a soft snap to a quarter turn that never fights the hand.
- At any roll, every pointer interaction on the canvas lands where the content is drawn. At roll 0 the canvas is identical to today.
- camera.ts carries the logic; Canvas.tsx changes stay a thin integration clear of the regions plan 02.6-03 edits.
- Kaelen's hand check (Task 3 human-check) is recorded in the SUMMARY as pending for end-of-phase verification.
</success_criteria>

<output>
Create `.planning/quick/260924-glr-canvas-camera-view-roll-and-eased-camera/260924-glr-SUMMARY.md` when done. Include the geodesic-step refinement, the five known limits from Task 3, the test count delta, and the pending human-check.
</output>
