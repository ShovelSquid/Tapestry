---
status: complete
phase: quick-260924-dwq
plan: 01
title: "Exponential zoom (pinch/wheel rate split) and 1.6x pan sensitivity, deltaMode-normalized"
key-files:
  created:
    - app/src/renderer/layout/wheel.ts
    - app/src/renderer/layout/wheel.test.ts
  modified:
    - app/src/renderer/components/Canvas.tsx
decisions: []
---

# Quick Task 260924-dwq: Make pan and zoom far more sensitive — Summary

Canvas pan/zoom now runs through a new pure math module (`layout/wheel.ts`): zoom switched
from a tiny linear step (`ZOOM_SPEED = 0.001`) to an exponential formula (`Math.exp`) with two
independently tuned rates — `ZOOM_RATE_PINCH = 0.035` for trackpad pinch deltas and
`ZOOM_RATE_WHEEL = 0.0022` for ctrl+held mouse-wheel deltas, chosen by delta magnitude via
`isZoomPinchDelta` since no device-type signal exists on a `WheelEvent`; pan gets a
`PAN_SENSITIVITY = 1.6` multiplier; and `deltaMode` (pixel/line/page) is normalized to a
pixel-equivalent value before either math runs. The gesture-to-action mapping (ctrl+wheel/pinch
= zoom, plain wheel/two-finger = pan) and the pointer-anchored zoom reprojection are unchanged.

## Deviations from Plan

None — plan executed exactly as written. Both tasks matched the plan's exact function
signatures, constants, and test cases with no auto-fixes needed.

## Commits

- `bc19e01`: feat(quick-260924-dwq): add pure zoom/pan math module with exponential zoom and pan multiplier
- `a146b7f`: feat(quick-260924-dwq): wire Canvas wheel handler to exponential zoom and 1.6x pan sensitivity

## Manual Verification Required (not skippable)

**This is a UI feel change. The math tests below only pin the arithmetic in isolation — they
cannot confirm the new sensitivity actually feels right in the running app.**

**Kaelen must open the running app and try:**
1. **Ctrl+wheel or trackpad pinch** on the canvas — confirm zoom moves noticeably faster than
   before, still centers under the pointer, and still stops at the existing 0.1x-5x range.
2. **Plain wheel scroll or two-finger trackpad pan** on the canvas — confirm panning feels ~1.6x
   faster than before.

Until this manual check happens, this task is not considered fully done per the plan's
`<success_criteria>`.

## Automated Verification (passed)

- `npm --prefix app run test -- src/renderer/layout/wheel.test.ts` — 10/10 tests passed (deltaMode
  normalization for all three modes, pinch/wheel rate divergence and relative sensitivity, clamp
  boundaries, pan multiplier).
- `npm --prefix app run typecheck` — exits 0, no errors.

## Self-Check: PASSED

- `app/src/renderer/layout/wheel.ts` — FOUND
- `app/src/renderer/layout/wheel.test.ts` — FOUND
- `app/src/renderer/components/Canvas.tsx` — modified, verified via `git diff`
- Commit `bc19e01` — FOUND in `git log`
- Commit `a146b7f` — FOUND in `git log`
