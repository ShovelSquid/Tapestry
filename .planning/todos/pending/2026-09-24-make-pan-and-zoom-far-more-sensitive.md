---
created: 2026-09-24T16:42:39.988Z
title: Make pan and zoom far more sensitive
area: ui
severity: minor
files:
  - app/src/renderer/components/Canvas.tsx:169-171
  - app/src/renderer/components/Canvas.tsx:575-609
---

## Problem

Kaelen (2026-09-24): "pan and zoom especially need a lot more sensitivity, you can barely zoom."

Current behaviour, from `Canvas.tsx`:

- Zoom only happens on `wheel` events with `ctrlKey` set, which is how the browser reports a trackpad pinch. A plain mouse wheel or two-finger scroll always pans and never zooms.
- The zoom step is linear and tiny: `newZoom = prev.zoom * (1 + -deltaY * ZOOM_SPEED)` with `ZOOM_SPEED = 0.001`. A pinch event's `deltaY` is usually a few units, so each event changes the zoom by well under 1%.
- The zoom range is clamped to `MIN_ZOOM = 0.1` .. `MAX_ZOOM = 5`.
- Pan is 1:1 with `deltaX`/`deltaY`, with no multiplier and no handling of `deltaMode` (line vs pixel units from a mouse wheel).

## Solution

Suggested approach (quick task size):

- Make zoom exponential, `zoom * Math.exp(-deltaY * k)`, and raise the rate substantially; tune `k` separately for pinch (small deltas) and mouse wheel (large, line-mode deltas).
- Decide how a mouse-wheel user zooms: plain wheel zooms (the usual canvas-app convention) or a modifier such as Cmd/Ctrl+wheel. Check with Kaelen, since it changes what two-finger scroll does.
- Normalise `deltaMode` (lines to pixels) and consider a pan speed multiplier.
- Possibly add keyboard zoom (Cmd +/-/0) and widen the zoom range.
- Keep zooming anchored at the pointer, which the current code already does.
- Kaelen should try it in the running app before it is marked done; feel is the acceptance test, and unit tests can only pin the maths.
