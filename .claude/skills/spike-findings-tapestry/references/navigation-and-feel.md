# Navigation and Feel

Moving through eight hours of thread: zoom, session markers, hover gravity, and the date scrubber.

## Requirements

From the `thread-rendering` idea (MANIFEST.md):

- Zoom is a span in seconds across the window, not a scale factor, so pixels-per-em falls out of it and "letters are readable here" is a threshold (spike 011)
- Session markers are drawn at a constant screen size, weighted by how much was written in them; that is what makes a zoomed-out thread read as planets rather than an empty line (spike 011)
- Gravity is suppressed while the user is moving the view and scaled by frame time, so it never fights the hand and does not pull twice as hard at 120 Hz (spike 011)
- The date scrubber carries the sessions themselves, not just a position: it is the only view where hours of gaps and sessions are visible at once (spike 011)

## How to Build It

**Zoom is one number: `span`, the seconds of thread across the window** — 8 hours down to 0.25 s. The camera is orthographic, looking at the line from the side. Pixels per em falls straight out of the span, which turns "letters are readable here" into a threshold rather than a feeling: spikes 002 and 003 found letters legible from about **8 px per em**. Screen-right is **−z**, so time reads left to right, matching the thread concept's side view.

**Session markers at a constant *screen* size, weighted by how much was written in that session** (D-17: "more strongly for bigger notes"). Constant screen size is what keeps them visible as planets at every zoom instead of collapsing into nothing when zoomed out.

**Gravity, only while hovering:**
```
pull = (1 − distance / radius)² × weight     toward the session note
```
applied as a per-frame fraction **scaled by frame time**, so it behaves identically at any refresh rate and a 120 Hz display does not pull twice as hard. Suppress it entirely while dragging and during a fly — D-17 says "there is no pull while moving freely", and that suppression is the difference between helpful and possessed.

**The scrubber carries the sessions themselves,** with the visible window drawn on it. It is the only view where eight hours of gaps and sessions are legible at once, so it doubles as the map.

First-guess values, not yet tuned: **140 px radius, 0.22 pull.**

## What to Avoid

- **Zoom as a scale factor.** It hides the one number that matters and makes readability a judgement call.
- **Session markers scaled in world space.** They vanish at the zoom level where they are most needed.
- **Gravity that persists during a drag.** It fights the hand.
- **Gravity applied per frame without scaling by frame time.** It doubles in strength on a 120 Hz display.
- **A page with bare import specifiers and no import map.** `Failed to resolve module specifier "three"` — the module never evaluates, no instrumentation fires, and the launcher simply waits out its timeout. It looks exactly like a hang. (Spike 008 needs no import map only because it imports nothing.)
- **Copying a probe between spikes with different launchers.** Spike 011 reused `002-shared/launch.cjs`, which registers no `memory` handler, so its memory column is simply absent — caught by a `.catch`, so the run was unaffected, but the figures never existed.

## Constraints

Measured at 8 h · 64,552 letters · 27 sessions — **59.9 fps and 0 % dropped frames in every phase**:

| Phase | Span | px/em | p95 | worst frame |
|---|---|---|---|---|
| still, whole thread | 8.00 h | 0.0 | 17.0 ms | 17.4 ms |
| still, one minute | 1.0 min | 1.9 | 17.2 ms | 17.6 ms |
| still, five seconds | 5.00 s | 22.4 | 17.1 ms | 17.7 ms |
| still, single dots | 0.25 s | 448.0 | 17.3 ms | 17.6 ms |
| zoom sweep, whole thread ↔ 0.25 s | — | — | 17.1 ms | 17.7 ms |
| pan at a 60 s span | 1.0 min | 1.9 | 17.2 ms | 17.6 ms |
| flying between five sessions | 45.00 s | 2.5 | 17.2 ms | 17.7 ms |
| scrubber drag, whole history | 2.0 min | 0.9 | 17.2 ms | 17.6 ms |

- **The numbers only say navigation is not in the way.** Whether the gravity is right is Kaelen's call by hand — spike 011 carries an open verification checkpoint.
- At 448 px per em a single letter fills the frame and is visibly lumpy. That is the browser-SDF rippling spike 003a measured, which the MSDF upgrade in spike 007 fixes; spike 011 uses the cheap rasterizer alone.
- An orthographic side camera needs `setOrientation(Math.PI / 2)` for the glyph quads; getting it wrong leaves them edge-on and invisible, which is how spike 005 failed.
- Untested: the procedural dot ribbon from spike 001 in this view (spike 011 draws the line, the sessions and the letters, so "single dots" shows one large letter rather than the 60/s dots), gravity tuned against Kaelen's judgement, flying while the thread is live and growing, two authors' strands (D-21), and 120 Hz displays.

## Origin

Synthesized from spike: 011 (VALIDATED).
Source files available in: `sources/011-navigation-feel/`
