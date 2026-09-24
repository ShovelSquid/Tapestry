---
phase: quick-260924-1gd
plan: 01
subsystem: hands-face-voice
tags: [mediapipe, pose-landmarker, three.js, spike-hands-face-voice]
status: complete

requires:
  - phase: "spike-012/013 (hands-face-voice-input)"
    provides: "hands-face.js (HandLandmarker + FaceLandmarker VIDEO-mode pipeline), scene3d.js (Three.js point-cloud viewer), main.js's generic onLandmarks passthrough"
provides:
  - "PoseLandmarker (pose_landmarker_lite) as a third MediaPipe model, detected every frame alongside HandLandmarker and FaceLandmarker"
  - "handsNormalized and poseLandmarksList forwarded through onLandmarks, alongside the unchanged handsWorld and faceLandmarksList"
  - "scene3d.js's shared normalizedTransform() drawing hands, face and pose from one per-frame normalized coordinate system, replacing HAND_SCALE/HAND_OFFSETS_X/FACE_SCALE"
  - "2D overlay pose skeleton (green, #34d399) and a pose count in the metrics line"
affects: ["any future gesture/pointing logic built on top of this playground's hand-face relative position"]

actuals:
  tokens: 1982
  tasks: 2
  commits: 2
  plan_head_before: 69b102a9f09e98527ff0706e18a2057f9426a915

tech-stack:
  added: []
  patterns:
    - "Shared normalized-frame transform: one normalizedTransform(p) function reused across hand, face and pose clouds instead of a per-model metric-world transform with fixed spacing offsets"

key-files:
  modified:
    - hands-face-voice/src/hands-face.js
    - hands-face-voice/src/scene3d.js

key-decisions:
  - "Pose world landmarks (metric, hip-centered) are deliberately not forwarded — normalized landmarks already give one shared per-frame coordinate system across all three models, and mixing hip-centered pose world landmarks with hand-centered hand world landmarks would reintroduce the no-shared-origin problem this task removes (COVERAGE.md)"
  - "numPoses: 1 set explicitly, matching this file's existing style of stating numHands/numFaces explicitly even where it equals the default"
  - "scene3d.js's top-of-file comment now states plainly this is a normalized-frame visual anchor, not a metric 3D fusion — comparable relative x/y position and z depth ordering, not physically-scaled absolute distances"

requirements-completed: []
---

# Quick Task 260924-1gd: Wire Hand-Face Relative Position + Pose Anchor — Summary

Real hand-face relative position now flows through the live hands-face-voice
playground: `hands-face.js` forwards the normalized per-hand landmarks it
already computed for the 2D overlay (previously dropped before the
`onLandmarks` callback), and a third MediaPipe model, `PoseLandmarker`, runs
every frame alongside `HandLandmarker`/`FaceLandmarker` to anchor hands and
face to a body skeleton. `scene3d.js` now draws all three point clouds through
one shared `normalizedTransform()`, replacing the fixed `HAND_OFFSETS_X`/
`FACE_SCALE` spacing hack that existed purely to keep clouds from overlapping.

## What Changed

**`hands-face.js`** (Task 1, commit `797dc1d`):
- Added `PoseLandmarker` to the existing `@mediapipe/tasks-vision@0.10.17`
  import and a `POSE_MODEL` constant pointing at
  `pose_landmarker_lite/float16/1/pose_landmarker_lite.task`.
- Created `poseLandmarker` via `PoseLandmarker.createFromOptions` with
  `numPoses: 1` explicit, reusing the same `vision` `FilesetResolver`
  instance as the hand/face landmarkers.
- `frame()` now calls `poseLandmarker.detectForVideo(video, now)` into
  `poseResult` every frame, right after the existing hand/face detection
  calls.
- Added a pose drawing loop (green `#34d399`, `POSE_CONNECTIONS` +
  landmarks) inside the existing `ctx.save()`/`ctx.restore()` block, after
  the face drawing loop.
- Extended the metrics line to `hands: N    faces: N    poses: N    fps: N`.
- Extended the `onLandmarks?.({...})` payload with two new keys —
  `handsNormalized: handResult.landmarks ?? []` and `poseLandmarksList:
  poseResult.landmarks ?? []` — leaving `handsWorld` and `faceLandmarksList`
  untouched.
- Added `poseLandmarker.close();` to `stop()`.

**`scene3d.js`** (Task 2, commit `6d7ee79`):
- Rewrote the top-of-file comment to describe the shared normalized-frame
  approach honestly, replacing the stale "no real relative position" claim,
  and explicitly disclaiming that this is a visual anchor, not a metric 3D
  fusion.
- Added `PoseLandmarker` to the existing tasks-vision import.
- Replaced the `HAND_SCALE`/`HAND_OFFSETS_X`/`FACE_SCALE` constants with a
  single `SCENE_SCALE = 0.6` (the value already proven visible for the face
  cloud, now shared by every cloud) plus `POSE_COLOR = 0x34d399`.
- Added a module-level `normalizedTransform(p)` — the same math the face
  branch already used with `FACE_SCALE`, now factored out once and reused
  for hands, face and pose.
- Rewrote `update({ handsNormalized, faceLandmarksList, poseLandmarksList })`:
  hands now iterate `handsNormalized` (not `handsWorld`) through
  `normalizedTransform`, face uses the same shared transform instead of its
  own inline closure, and a new pose block draws a cloud + `POSE_CONNECTIONS`
  skeleton, also through `normalizedTransform`.
- `cloud()`, `lines()`, camera/grid/controls setup, and `render()`/
  `onResize()` were left untouched.

`main.js` and `index.html` were not modified, as the plan's non-goal states:
`main.js`'s `onLandmarks: (landmarks) => scene3D.update(landmarks)`
passthrough is generic and needed no edit, and `index.html`'s `#metrics` div
renders whatever text `hands-face.js` writes into it.

## Verification

**Automated (both `<verify>` blocks from the plan, run and passing):**
```
node --check hands-face-voice/src/hands-face.js && grep -q "PoseLandmarker" ... && echo OK
node --check hands-face-voice/src/scene3d.js && grep -q "PoseLandmarker" ... && echo OK
```
Both printed `OK`. `grep -n "HAND_SCALE\|HAND_OFFSETS_X\|FACE_SCALE"` on
`scene3d.js` finds only the intentional mention inside the rewritten
top-of-file comment — no leftover constant declarations or references.

**Automated browser check (beyond the plan's stated automated verify, this
sandbox has no camera device):** served the playground with `npx serve .` and
loaded it headless via the `browser-automation` skill.
- Page load: `console errors/warnings (0)`, `requests failed (0)`, title
  correct. Because `main.js` statically imports `createScene3D` from
  `scene3d.js` and `startHandsAndFace` from `hands-face.js`, and ES module
  named imports throw a `SyntaxError` at evaluation time if the imported name
  doesn't exist on the target module, a clean page load with zero console
  errors also confirms `PoseLandmarker` is a real, correctly-spelled export
  of `@mediapipe/tasks-vision@0.10.17` — not just that the two edited files
  parse in isolation (which `node --check` already covered).
- Clicked "Start camera (hands + face)": `createScene3D` (which now builds
  `normalizedTransform` and imports `PoseLandmarker`) ran without error, and
  `startHandsAndFace` (which now creates `poseLandmarker` via
  `PoseLandmarker.createFromOptions`) began executing before failing at
  `getUserMedia` with `Permission denied` — the expected failure point in a
  headless sandbox with no webcam, not a bug in this plan's changes.

**Not run — deferred to human, as the plan itself states no automated
browser test exists for this no-build-step playground:** the live pose
count in the metrics line, the green pose skeleton drawn over a real body in
the 2D overlay, and the 3D panel showing hand/face/pose point clouds in real
relative position. This sandbox has no camera hardware, so `getUserMedia`
cannot succeed here regardless of code correctness — a human with a webcam
must run `npx serve .` from `hands-face-voice/`, open the printed
`localhost` URL, click "Start camera (hands + face)", and confirm the three
manual-verification bullets in the plan's `<verification>` section.

## Deviations from Plan

None — plan executed exactly as written. Both tasks matched their `<action>`
blocks and `<done>` criteria without requiring any Rule 1-3 auto-fixes.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources
were introduced.

## Threat Flags

None beyond what the plan's own threat model already covers (T-1gd-01
through T-1gd-03, all `accept`-disposed, same CDN origins and local-only
frame handling as the pre-existing hand/face code). No new network endpoint,
auth path, or trust-boundary schema change was introduced.

## Self-Check: PASSED

- `hands-face-voice/src/hands-face.js` — FOUND (modified, committed `797dc1d`)
- `hands-face-voice/src/scene3d.js` — FOUND (modified, committed `6d7ee79`)
- commit `797dc1d` — FOUND in `git log`
- commit `6d7ee79` — FOUND in `git log`
- `git status --short hands-face-voice/` — empty (nothing left uncommitted)
- `hands-face-voice/src/main.js` and `hands-face-voice/index.html` —
  confirmed unmodified (`git status --short` shows no changes to either)
