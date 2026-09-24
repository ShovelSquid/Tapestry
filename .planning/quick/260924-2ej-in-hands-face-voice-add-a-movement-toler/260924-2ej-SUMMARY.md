---
phase: quick-260924-2ej
plan: 01
subsystem: ui
tags: [three.js, mediapipe, scene3d, smoothing, jitter]

requires: []
provides:
  - Per-point dead-zone + EMA smoothing stage in scene3d.js's 3D point cloud, keyed per (landmark-set, slot-index, point-index)
  - Slot-disappearance reset so a hand/face/pose slot that reappears snaps to its fresh position instead of easing in from stale state
affects: [hands-face-voice]

actuals:
  tokens: 1361
  tasks: 1
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Closure-level Map keyed \"set:slot:index\" for per-point persistent smoothing state across animation frames"
    - "Dead-zone + EMA smoothing as a separate stateful step ahead of a pure per-point transform function"

key-files:
  created: []
  modified:
    - hands-face-voice/src/scene3d.js

key-decisions:
  - "Used un-tuned starting defaults (JITTER_TOLERANCE = 0.004, SMOOTHING_FACTOR = 0.35) per plan instruction, since this is a live diagnostic playground rather than a researched/tuned production value"
  - "Smoothed every point in each slot's full landmarks array (not just the drawn subset) so both point-cloud indices and connector-line indices index into already-smoothed data from one shared call"

patterns-established:
  - "Stateful smoothing lives entirely inside createScene3D's closure, isolated per scene instance, and normalizedTransform stays a pure one-argument function untouched by the smoothing step"

requirements-completed: []

coverage:
  - id: D1
    description: "Dead-zone + EMA smoothing suppresses sub-threshold jitter while still tracking real movement, and resets cleanly on slot disappearance/reappearance"
    verification:
      - kind: other
        ref: "node --check hands-face-voice/src/scene3d.js && grep -c for JITTER_TOLERANCE/SMOOTHING_FACTOR/smoothLandmarks/resetStaleSlots/smoothPoint"
        status: pass
    human_judgment: true
    rationale: "Visual jitter suppression and snap-on-reappear behavior require a live camera and human eyes on the 3D view; this sandbox has no camera hardware, matching the plan's deferred human-check note."

duration: 6min
completed: 2026-09-24
status: complete
---

# Phase quick-260924-2ej Plan 01: Dead-zone + EMA smoothing for the 3D landmark point cloud Summary

**Added a per-point dead-zone/EMA smoothing stage to scene3d.js, keyed per (hand/face/pose slot, point index), that suppresses sub-threshold jitter while easing real movement and snapping instantly when a slot disappears and reappears.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-09-24T08:49:00Z (approx.)
- **Completed:** 2026-09-24T08:55:00Z (approx.)
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `JITTER_TOLERANCE` (0.004) and `SMOOTHING_FACTOR` (0.35) named constants alongside the existing `SCENE_SCALE`/`HAND_COLORS`/`FACE_COLOR`/`POSE_COLOR` constants
- Added closure-level `smoothedPoints` Map, `prevSlotCounts` object, and `resetStaleSlots`/`smoothPoint`/`smoothLandmarks` functions inside `createScene3D`, persisting smoothing state across `update()` calls
- Wired all three per-frame `forEach` blocks (hands, face, pose) in `update()` to route raw landmarks through `smoothLandmarks(set, slot, landmarks)` before both the point-cloud (`cloud(...)`/`.map(normalizedTransform)`) and connector-line (`lines(...)`) rendering calls
- `resetStaleSlots` runs once per set per `update()` invocation, purging any smoothing state for slot indices that no longer exist, so a reappearing hand/face/pose slot renders at its real detected position on the first frame back rather than easing in from stale history
- `normalizedTransform` itself was left completely unchanged — it remains a pure one-argument function, only ever called on already-smoothed points

## Task Commits

Each task was committed atomically:

1. **Task 1: Add per-point dead-zone + EMA smoothing to the 3D point cloud, keyed per slot and reset on slot disappearance** - `d6ebf0c` (feat)

**Plan metadata:** committed separately by the orchestrator (docs commit not made by this executor per quick-task constraints)

## Files Created/Modified
- `hands-face-voice/src/scene3d.js` - Added JITTER_TOLERANCE/SMOOTHING_FACTOR constants, closure-level smoothedPoints Map + resetStaleSlots/smoothPoint/smoothLandmarks, and wired the hands/face/pose forEach blocks in update() to route through smoothing before normalizedTransform

## Decisions Made
- None beyond what the plan specified - followed plan as specified, including the plan's explicit choice of un-tuned starting-default constant values.

## Deviations from Plan

None - plan executed exactly as written. All four edits (constants, closure state/functions, reset calls, forEach wiring) were made precisely as specified in the plan's `<action>` block.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `scene3d.js` syntax verified via `node --check` (exits 0); all five new identifiers (`JITTER_TOLERANCE`, `SMOOTHING_FACTOR`, `smoothLandmarks`, `resetStaleSlots`, `smoothPoint`) confirmed present via `grep -c`.
- Human verification deferred to Kaelen per the plan: run `npx serve .` from `hands-face-voice/`, open the printed URL, start the camera, and confirm (1) held-still points no longer shimmer, (2) real movement still tracks smoothly, (3) a hand leaving/re-entering frame snaps to its fresh position rather than gliding in, (4) the same holds for face/pose dropout and return.
- No changes made to `hands-face.js`, `main.js`, or `index.html`, matching the plan's explicit out-of-scope list.

---
*Phase: quick-260924-2ej*
*Completed: 2026-09-24*

## Self-Check: PASSED

- FOUND: hands-face-voice/src/scene3d.js
- FOUND: d6ebf0c (commit exists in git log)
- FOUND: 260924-2ej-SUMMARY.md
