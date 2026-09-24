---
spike: 001
idea: thread-rendering
name: thread-stream-load
type: standard
validates: "Given a WebGL thread in Electron, when it gains 60 dots/s plus a glyph per keystroke fast-forwarded to 1 h (216k dots) and 8 h, then it holds 60 fps with bounded memory, fading and distance collapse"
verdict: VALIDATED
related: [002a, 002b]
tags: [webgl, electron, performance, three]
---

# Spike 001: Thread Stream Load

## What This Validates
**Given** a WebGL thread running in the repo's Electron (32.3.3, Chromium 128) on Kaelen's Apple M4 MacBook Air (60 Hz, 2560×1664, device pixel ratio 2),
**when** the thread gains a dot 60 times a second while live, a glyph per keystroke and a dash at every time-out and time-in, with synthetic history of 1 h, 8 h (sessions with gaps) and 8 h continuous (1.73 M dots),
**then** it holds 60 fps in the live z-axis view and the side view (including a zoom sweep from the whole thread down to 8 s), memory stays bounded, old entries fade in the live view, and dots collapse into a line when they are denser than the pixels.

## Research
- **three.js 0.186.0** (npm latest, 2026-09-15). The WebGL2-only renderer converts GLSL1-style `ShaderMaterial` code to GLSL ES 3.0, so `fwidth` works without extensions. `BufferAttribute.addUpdateRange` gives partial uploads, so a live append sends only a few bytes per frame (see the upload trap below).
- **troika-three-text 0.52.5** is used by 002a, not here. This spike's glyphs use a canvas atlas so the load numbers aren't tied to a text library.
- **Precision:** float32 has about 7 significant digits. 8 h is 28,800 s, placed at 1.5 units/s = 43,200 units, while dots are 0.025 units apart. Plain float32 world positions would jitter, and `fract(t × 60)` would quantize at 1.7 M. Mitigations: times are stored as (hour block, offset within the hour) and positions computed relative to a moving origin; the dot pattern uses time since the start of its chunk (at most 10 min).

| Approach | How | Data grows with | Expected risk |
|---|---|---|---|
| **Procedural ribbon** | Sessions and gaps stored as chunks of 4 vertices; a fragment shader draws the 60 Hz dots and blends them into a line once `fwidth` shows they're denser than the pixels | Sessions (tens per 8 h) | Accurate appearance of dots through perspective; view-space billboarding along a line seen end-on |
| **Explicit points** | One GPU point per dot, 8 bytes each | Dots (1.73 M in 8 h continuous) | Vertex cost and overdraw in the side view; buffer size |
| DOM or SVG elements | One element per dot or glyph | Dots | Ruled out without building: hundreds of thousands of elements |

**Chosen:** build both GPU approaches and benchmark them head to head, since the answer decides the Phase 2.3 data model.

## How to Run
From the repo root:
```sh
cd .planning/spikes && npm install && cd ../..
node_modules/.bin/electron .planning/spikes/001-thread-stream-load/main.cjs           # interactive
node_modules/.bin/electron .planning/spikes/001-thread-stream-load/main.cjs --bench   # benchmark (~2.5 min), prints a table, writes results/bench-*.json
node_modules/.bin/electron .planning/spikes/001-thread-stream-load/main.cjs --shots   # 8 screenshots of the views to check by eye, results/shots/
```
Interactive keys: type to write · **Tab** switches between live and side view · wheel zooms and drag pans (side view) · **Ctrl+1–4** load empty / 1 h / 8 h / 8 h continuous · **Ctrl+M** switches procedural and points · **Export log** writes `results/interactive-*.json`. Scripted runs (`--bench`, `--shots`) open without focus and ignore real input.

## What to Expect
- **Live view:** the camera sits just ahead of now, looking back along the thread into depth. Round dots stream toward the camera, blend into a solid line further back, and fade out within 20 s. Typed letters float just above the line at the point they were typed. Stop typing for 5 s and a dash marks the time-out; the next key draws a time-in dash.
- **Side view:** the whole thread left (old) to right (new). Sessions are solid lines, gaps are faint dotted lines, dashes mark every time-out and time-in. Zoom in until the 60 Hz dots separate and letters appear.
- **Benchmark table:** fps, frame p95/p99, dropped-frame percentage, work time, private memory and GPU buffer size for each mode × load × view.

## Investigation Trail
1. **First benchmark** (`results/bench-2026-09-15T10-24-45-670Z.json`, **invalid, kept as a record**): procedural held 60 fps everywhere; explicit points dropped to 20 fps at 8 h and 10–15 fps at 8 h continuous. "Work time" read 0.1–0.4 ms in every row, even at 100 ms frames.
2. **Work time is not GPU time.** `gl.finish()` does not wait for the GPU in Chromium: WebGL commands go to a separate GPU process. Frame intervals from `requestAnimationFrame` are the only trustworthy measure. Every conclusion below uses frame intervals.
3. **Screenshots showed nothing was drawn.** A frame rate says nothing about appearance, so a `--shots` mode captured 8 views. The procedural line was missing from all of them: `ShaderMaterial` culls back faces by default, and the ribbon's winding is clockwise from the side view. **Procedural's 60 fps had been measured with the line culled before rasterization.** Fix: `side: THREE.DoubleSide`. The ribbon is a camera-facing billboard, so its winding depends on the view.
4. **Two screenshots were in the wrong view.** The window took focus when it opened, so keystrokes meant for another app (a Tab) went into the spike and toggled the view. Fix: scripted runs open with `showInactive()` and ignore real input.
5. **Only live thread showed; the history was invisible.** In three.js, when an attribute has any update ranges, only those ranges are uploaded. The bulk load requested a full upload, but the next frame extended the live chunk and added a range, so the full upload was silently dropped. Letters escaped because typing doesn't touch them every frame. Explicit points append almost every frame, so **their history never reached the GPU in run 1 either**: the first points slowdown could have been 1.7 M points stacked at time 0. Fix: an attribute waiting for a full upload takes no ranges until the next render has uploaded it.
6. **Round dots.** Dots were rectangles because the shader only shaped them along the thread. They are now measured in pixels along and across the ribbon.
7. **Screenshots after the fixes** (`results/shots/`) show correct rendering at 8 h: round dots at the live head blending into a solid line with depth and fading, the full 8 h line in the side view, sessions / gaps / dashes at 40 min, and **dots at 8 h evenly spaced exactly like dots near t = 0** (`e` vs `f`). So hour-block storage plus a moving origin holds precision.
8. **Second benchmark** on corrected code (`results/bench-2026-09-15T10-37-10-858Z.json`): same verdict with valid data (table below). The points slowdown is real.
9. **Why points fail.** In the side-sweep, points recover to 60 fps once zoomed in. There the same 1.73 M vertices run, but most points are off screen. The cost is rasterization and overdraw (hundreds of thousands of ≥2 px points stacked on the same pixels near the vanishing point and in the zoomed-out side view), not vertex count. That is inherent to one-point-per-dot; the procedural shader instead touches each screen pixel once.

## Results
**Verdict: VALIDATED** for the procedural ribbon. **Explicit points are invalidated** as a design beyond about 1 h.

Second benchmark (frame intervals, 4 s per row after 1 s warm-up, typing at 5 keys/s throughout):

| Mode | Load | Live view | Side, whole thread | Side, zoom sweep | GPU buffers | Private memory |
|---|---|---|---|---|---|---|
| procedural | empty / 1 h | 59.9 fps, 0 % dropped | 59.9, 0 % | 59.9, 0 % | ≤0.1 MB | 45–48 MB |
| procedural | 8 h (812 k dots) | 59.9, 0 % | 59.9, 0 % | 59.9, 0 % | 0.4 MB | 53–54 MB |
| procedural | 8 h continuous (1.73 M dots, 78 k glyphs) | 59.9, 0 % | 59.9, 0 % | 59.9, 0 % | 0.9 MB | 46–55 MB |
| points | 1 h | 59.9, 0 % | 59.9, 0 % | 59.9, 0 % | 0.8 MB | 45–46 MB |
| points | 8 h | **20.3, 100 %** | **20.0, 98 %** | 59.9 median, 7 % dropped | 6.6 MB | 51–53 MB |
| points | 8 h continuous | **10.0, 100 %** | **15.0, 100 %** | 59.9 median, 8 % dropped | 14.1 MB | 65 MB |

Frame p95 for every procedural row is 17.6–17.8 ms (vsync at 16.7 ms); no procedural row dropped a frame.

**Signal for the build (Phase 2.3):**
- **Store sessions and keystrokes, never dots.** The thread's persistent data is sessions (start, end) and keystrokes (time, character, actor). Dots are drawn from time × speed. That also matches Tapestry's replay rule: rendering comes from recorded inputs.
- **Draw dots procedurally** in a fragment shader with `fwidth`-based collapse into a line. Cost stays flat from 0 to 8 h.
- **Floating origin plus hour-block times** are required for multi-hour threads on float32 GPUs.
- **Glyphs as instanced quads** cost nothing measurable at 78 k. Legibility is 002's question: side-view letters were too small to read at 14 px.
- **Gotchas the real build must handle:**
  - three.js silently drops a full upload when any update range exists.
  - `ShaderMaterial` culls back faces, so billboards need `DoubleSide`.
  - `gl.finish()` does not measure GPU time in Chromium.
  - A 1-D attribute aliased as `position` needs a manual bounding sphere.
  - Scripted Electron windows steal focus.
- **Not tested here:** typing into a DOM editor over the thread (spike 003), redrawing from saved keystrokes (004), 120 Hz ProMotion displays, older integrated GPUs, and threads longer than 8 h.
