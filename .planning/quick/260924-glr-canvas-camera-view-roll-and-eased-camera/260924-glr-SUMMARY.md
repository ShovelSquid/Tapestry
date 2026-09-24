---
phase: quick-260924-glr
plan: 01
status: complete
subsystem: renderer/canvas
tags: [camera, roll, easing, canvas, navigation]
requires: []
provides:
  - "app/src/renderer/layout/camera.ts: the pure camera module (Camera, transforms, step, CameraRig)"
  - "Eased zoom, the panToFrame fly, roll (Shift+wheel, Q/E, 0) with a soft quarter-turn snap"
affects:
  - app/src/renderer/components/Canvas.tsx
  - app/src/renderer/components/TreeFrame.tsx
  - app/src/renderer/components/NoteCard.tsx
  - app/src/renderer/components/VaultNoteCard.tsx
  - app/src/renderer/components/FallbackNodeView.tsx
  - app/src/renderer/components/ThreadCenterNode.tsx
  - app/src/renderer/components/FloatingToolbar.tsx
tech-stack:
  added: []
  patterns:
    - "Target camera + drawn camera; frame-rate independent ease k = 1 - exp(-dt/tau) along the similarity geodesic"
    - "Direct manipulation (pointer pan, two-finger pan) never eased; one rAF loop that stops when settled"
key-files:
  created:
    - app/src/renderer/layout/camera.ts
    - app/src/renderer/layout/camera.test.ts
  modified:
    - app/src/renderer/components/Canvas.tsx
    - app/src/renderer/components/TreeFrame.tsx
    - app/src/renderer/components/NoteCard.tsx
    - app/src/renderer/components/VaultNoteCard.tsx
    - app/src/renderer/components/FallbackNodeView.tsx
    - app/src/renderer/components/ThreadCenterNode.tsx
    - app/src/renderer/components/FloatingToolbar.tsx
decisions:
  - "The ease moves along the similarity geodesic (M^k), not independent linear pan + log zoom, so the zoom anchor / roll centre stays fixed on screen for the whole ease; pure pans are still exactly linear"
  - "f = (1 - m^k)/(1 - m) is computed as expm1(kL)/expm1(L) with an accurate complex expm1, avoiding cancellation when m is close to 1"
  - "Roll snap lives in CameraRig (armed by roll(), disarmed by direct()/hold(), fires 150 ms after the last roll input)"
  - "Shift+two-finger scroll now rolls instead of panning sideways; trackpad rotate is not available in Chromium"
metrics:
  duration: "about 25 min"
  completed: 2026-09-24
  tasks: 3
  files: 9
estimate:
  tokens: 90000
  tasks: 3
actuals:
  tokens: 17700
  tasks: 3
  commits: 3
plan_head_before: dba163e92b10f0b2db79798ac608f7f2dee9c9af
---

# Quick 260924-glr Plan 01: Canvas camera roll and eased camera Summary

The canvas camera now has a roll and eased motion. A new pure module, `layout/camera.ts`, holds a target camera and a drawn camera that follows it. The drawn camera moves along the similarity geodesic at a frame-rate independent rate, with zoom exact in log space and roll along the shortest arc. Zoom (Ctrl+wheel and pinch) glides with tau 70 ms, anchored against the target. `panToFrame` flies with tau 200 ms. Roll comes from Shift+wheel (about the cursor) and from Q/E/0 (about the viewport centre), with tau 80 ms and a soft snap to a quarter turn. Pointer pans and two-finger pans stay 1:1. At roll 0 the canvas uses the old CSS string and the old formulas, bit for bit.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (tracer) | a31d44c | camera module with eased zoom and fly, direct pan |
| 2 | dfb5759 | roll with Shift+wheel, Q/E and 0, with a soft quarter-turn snap |
| 3 | e66b3a8 | cards and toolbar convert screen deltas through the rolled camera |

## What was built

- **camera.ts** (pure, with no React, DOM or IPC imports): `Camera {panX, panY, zoom, roll}`, `worldToScreen` and `screenToWorld` (exact inverses of each other, and exactly the old formulas at roll 0), `screenDeltaToWorld`, `panBy`, `zoomAbout` (the old anchored formula at every roll), `centerOn`, `rollAbout`, `rollTo`, `snapRoll`, `rollDeltaFromWheel`, `layoutSize`, `screenToElementLocal`, `cameraTransformCss`, `step`, and `CameraRig`. `CameraRig` offers `direct`, `hold`, `easeTo`, `roll`, `resetRoll` and `tick`, and handles the snap.
- **Canvas.tsx** is a thin integration. The view state is the drawn camera, and every camera write goes through the rig. One rAF loop runs `rig.tick` and stops when the tick returns false. Hit tests use `screenToWorld(view, ...)`. The frame drag uses `screenDeltaToWorld`. A background press calls `rig.hold()`, which stops any glide where it is drawn. There is a Shift+wheel roll branch, and a separate Q/E/0 keydown effect that is guarded against editable targets, `editingRef`, Cmd/Ctrl/Alt and `defaultPrevented`. `settleFrames`, `positionedRects`, the placement-correction effect and `handlePointerUp` are untouched, so the 02.6-03 merge stays easy.
- **TreeFrame** passes the drawn roll to every card. Card drags, NoteCard's resize, the measured sizes and FloatingToolbar's placement all use the camera helpers.

## The geodesic-step refinement

This was accepted by the orchestrator. Easing pan linearly next to a log-space zoom lets the zoom anchor drift during the ease, by hundreds of pixels on a burst. So `step()` treats each camera as a complex similarity `a*w + b` and applies `M^k`, the k-th power of the relative move from drawn to target. When only pan differs, this reduces exactly to a linear ease. When zoom or roll also differ, the fixed point of M stays fixed on screen for the whole ease: that is the cursor anchor or the rotation centre. The test "holds the zoom anchor fixed on screen for the whole ease" pins it at roll 37 to within 0.5 px on every frame. Because every step moves the same fraction along the same curve, the ease is frame-rate independent: 60 Hz, 120 Hz and irregular frame times agree to 1e-6.

## Tests

- Baseline: 21 files, 443 tests. Final: **22 files, 486 tests** (+1 file, +43 tests, all in `camera.test.ts`).
- Gates, all green after every task: `npm --prefix app run build:js`, `npm --prefix app run typecheck` and `npm --prefix app run test`.
- Plan verification: `git diff --name-only HEAD~3 -- app/src/main app/src/preload` is empty, so the camera is never persisted. `camera.ts` has no `window.tapestry`. Each commit's `git show --stat` lists only files the plan names, and never `.gsd/`.
- The tests are pure math and never touch any world, vault or userData.

## Known limits (glr-R7)

1. At non-zero roll, measured card sizes come from `offsetWidth` and `offsetHeight`, which are rounded to whole px. That can shift frame bounds and connection-line centres by under 1 px. At roll 0 the fractional measurement is unchanged.
2. ProseMirror's `coordsAtPos` returns axis-aligned rects under rotation. So the toolbar anchors on the corner of the rotated selection-start box rather than its true top, and can be off by up to one glyph box.
3. Text hit testing inside a rotated editor (caret placement, drag-select, and `passage-plugin`'s `posAtCoords` hover) relies on Chromium's transform-aware hit testing. There is no Tapestry math there to fix, but it is unverified under roll, so it is in the hand check below.
4. Card drags and resizes still use the zoom and roll captured when the drag starts. A drag begun during a camera ease (at most about 3 tau, 200 to 600 ms) can slide slightly relative to the pointer until the ease settles. This is the same as pinching during a drag today.
5. These were checked and are unaffected: PluginSurfaceLayer is a full-window layer outside the transformed container. ConnectionLine and frame-local coordinates are world-space inside the container. FrameHeader's counter-scale depends only on zoom. There are no drop handlers in the renderer.

Also, Shift plus a two-finger scroll used to pan sideways, and now it rolls. The design names this gesture. Chromium on macOS exposes no trackpad rotate gesture (`gesturechange` exists only in Safari), so trackpad rotate is not available.

## Deviations from Plan

None. The plan was executed as written. Two small implementation choices stay within the plan's contracts:
- `step` computes `f = (1 - m^k)/(1 - m)` through an accurate complex `expm1` ratio, with `f = k` only when m is exactly 1, rather than applying the plan's `|1 - m| < 1e-12` cutoff. This avoids losing precision when m is near 1. The behaviour is the same.
- `CameraRig.direct` ignores a change that would make either camera non-finite. This is the same guard as `easeTo`, and supports T-glr-01.

## For Kaelen to try

Auto mode was on, so this is pending for end-of-phase verification. Run `npm --prefix app run dev` and open a world with notes in two trees.

- (a) Ctrl+wheel or pinch. The zoom glides, and the point under the cursor stays put during and after the glide, including on a fast burst.
- (b) Drag the background, and pan with two fingers. Both should be 1:1, with no lag.
- (c) Add a tree. The view should fly to it.
- (d) Shift+wheel rolls about the cursor. Q and E turn 15 degrees about the centre, and 0 returns to level. Release within about 4 degrees of level or of a quarter turn, and it should settle there. Hold Shift+wheel slowly near 0: it should never snap while you are still turning.
- (e) At about 30 degrees of roll, try each of these: drag a note, resize a note from its left and top edges, drag a frame header, draw a connection, double-click to create a note, and select text to raise the toolbar. Each should land under the pointer. Also check caret placement and drag-select inside a rolled note (known limit 3).
- (f) Type q, e and 0 into a note and into a frame-name input. The text should appear and nothing should roll.
- (g) At roll 0, everything should look and feel as before, apart from the glide.

## Self-Check: PASSED

- FOUND: app/src/renderer/layout/camera.ts, app/src/renderer/layout/camera.test.ts
- FOUND commits: a31d44c, dfb5759, e66b3a8
