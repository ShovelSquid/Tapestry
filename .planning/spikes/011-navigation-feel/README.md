---
spike: 011
idea: thread-rendering
name: navigation-feel
type: standard
validates: "Given the side view of a long thread, when zooming from the whole thread to single dots with hover gravity and a date scrubber (D-17), then navigation feels like 'huge gaps broken up with small planets'"
verdict: VALIDATED
related: [001, 002b, 003a, 008]
tags: [webgl, navigation, ux, feel]
---

# Spike 011: Moving Through a Thread

## What This Validates

**Given** eight hours of thread — 64,552 letters across 27 sessions — seen from the side in the
repo's Electron on Kaelen's M4 MacBook Air,
**when** the view zooms from the whole thread down to a quarter of a second, pans, flies to a
session note, and is dragged through the date scrubber,
**then** it holds 60 fps and moving between sessions feels like Kaelen's description: "like space,
huge gaps broken up with small planets, but the gravity is enough to easily be able to navigate
between them."

This is a **feel** spike. The numbers only say navigation is not in the way; whether the gravity
is right is Kaelen's call, by hand.

## Research

- **Zoom is one number.** The camera is orthographic, looking at the line from the side, so the
  view is `span` — the seconds of thread across the window — from 8 hours down to 0.25 s. Pixels
  per em falls straight out of it, which is what says when letters become readable: spikes 002
  and 003 found them legible from about 8 px.
- **Screen-right is −z**, so time reads left to right, matching the thread concept's side view.
- **Session note size comes from how much was written in that session** (D-17: "more strongly for
  bigger notes"), and markers are drawn at a constant *screen* size so they stay visible as
  planets at every zoom rather than collapsing to nothing when zoomed out.
- **Gravity only while hovering** (D-17: "there is no pull while moving freely"): it is suppressed
  while dragging and during a fly. Pull is `(1 − distance/radius)² × weight` toward the note,
  applied as a per-frame fraction scaled by frame time so it behaves the same at any refresh rate.

## How to Run

From the repo root (after `cd .planning/spikes && npm install`):

```sh
node_modules/.bin/electron .planning/spikes/011-navigation-feel/main.cjs           # drag to pan, scroll to zoom, click a session to fly, drag the bar
node_modules/.bin/electron .planning/spikes/011-navigation-feel/main.cjs --shots   # five zoom levels
node_modules/.bin/electron .planning/spikes/011-navigation-feel/main.cjs --bench   # stills, zoom sweep, pan, flights, scrubber drag
```

`?hours=` changes the history length.

## What to Expect

At full zoom, 27 session markers strung along eight hours with the true gaps between them, and a
scrubber below carrying the same sessions with the visible window drawn on it. Scrolling zooms
about the pointer; letters become readable around 8 px per em and fill the screen at 448.
Hovering near a session note pulls the view gently toward it; clicking one flies there.

## Observability

The HUD reports fps, span, pixels per em, and whether gravity is pulling and from which session.
The readout under the scrubber says where the centre is and whether letters are above reading
size. `results/bench-*.json` holds every phase.

## Investigation Trail

1. **The page never evaluated on the first run.** `Failed to resolve module specifier "three"` —
   I wrote `index.html` without an import map. Spikes 002/003/004/007 all carry one; 008 does not
   need one because it imports nothing. Without it the module never runs, no instrumentation
   fires, and the launcher simply waits out its timeout — the same silent shape spike 003b
   recorded, from a different cause.
2. **The orientation was right first time**, which was not guaranteed: an orthographic side camera
   plus `setOrientation(Math.PI / 2)` could as easily have left the glyph quads edge-on and
   invisible, which is exactly how spike 005 failed. The 8-second frame reads
   ", and just make it easier to use. this is a" — left to right, as intended.
3. **The deepest zoom cross-confirms spike 007.** At 448 px per em a single letter fills the frame
   and is visibly lumpy — the browser-SDF rippling 003a measured, which 007's MSDF upgrade fixes.
   This spike uses the cheap rasterizer alone, so that is expected rather than a defect.
4. **The memory column is empty.** The probe was copied from spikes 005 and 007, which have their
   own launchers; 011 reuses `002-shared/launch.cjs`, which registers no `memory` handler. Caught
   by a `.catch`, so the run was unaffected — but the figures are simply absent. Memory is not this
   spike's question and 001–007 already bound it at 42–127 MB.

## Results

**Verdict: VALIDATED.** Every phase held 60 fps with no dropped frames.

8 h · 64,552 letters · 27 sessions

| Phase | Span | px/em | fps | p95 | worst frame | Dropped |
|---|---|---|---|---|---|---|
| still, whole thread | 8.00 h | 0.0 | 59.9 | 17.0 ms | 17.4 ms | 0 % |
| still, one hour | 1.00 h | 0.0 | 59.9 | 17.1 ms | 17.4 ms | 0 % |
| still, one minute | 1.0 min | 1.9 | 59.9 | 17.2 ms | 17.6 ms | 0 % |
| still, five seconds | 5.00 s | 22.4 | 59.9 | 17.1 ms | 17.7 ms | 0 % |
| still, single dots | 0.25 s | 448.0 | 59.9 | 17.3 ms | 17.6 ms | 0 % |
| zoom sweep, whole thread ↔ 0.25 s | — | — | 59.9 | 17.1 ms | 17.7 ms | 0 % |
| pan at a 60 s span | 1.0 min | 1.9 | 59.9 | 17.2 ms | 17.6 ms | 0 % |
| flying between five sessions | 45.00 s | 2.5 | 59.9 | 17.2 ms | 17.7 ms | 0 % |
| scrubber drag, whole history | 2.0 min | 0.9 | 59.9 | 17.2 ms | 17.6 ms | 0 % |

**Signal for the build (Phase 2.3):**
- **Zoom as a span in seconds, not a scale factor.** It makes the whole range one number, gives
  pixels-per-em directly, and makes "letters are readable here" a threshold rather than a feeling.
- **Draw session markers at a constant screen size**, weighted by how much was written. That is
  what makes the zoomed-out thread read as planets rather than an empty line.
- **Suppress gravity while the user is moving the view.** Pull that persists during a drag fights
  the hand; D-17 already says so, and it is the difference between helpful and possessed.
- **Scale gravity by frame time**, so a 120 Hz display does not pull twice as hard.
- **The scrubber carries the sessions**, not just a position: it is the only view where eight
  hours of gaps and sessions are visible at once, and it doubles as the map.
- **Not tested:** spike 001's procedural dot ribbon — this spike draws the line, the sessions and
  the letters, so the "single dots" view shows one large letter rather than the 60/s dots; gravity
  tuned by hand against Kaelen's judgement (the numbers here are a first guess: 140 px radius,
  0.22 pull); flying while the thread is live and growing; two authors' strands (D-21); and
  120 Hz displays.

### CHECKPOINT: Verification Required

**Spike 011: navigation feel**
**How to run:** `node_modules/.bin/electron .planning/spikes/011-navigation-feel/main.cjs`
**What to try:** scroll to zoom from the whole thread down to single letters; drag to pan; hover
near a session marker and feel the pull; click one to fly to it; drag the bar along the bottom.
**What to expect:** movement stays smooth throughout; the pull helps you land on a session
without fighting you when you are moving freely.

---

**→ Does the gravity feel right — too strong, too weak, or reaching too far?**
