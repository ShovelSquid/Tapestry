# Thread Geometry and Load

How the thread line itself is stored and drawn, and why it costs the same at eight hours as at zero.

## Requirements

From the `thread-rendering` idea (MANIFEST.md):

- Runs in Electron (the repo's Electron 32.3.3 / Chromium 128), not a plain browser (Kaelen, 2026-09-15)
- Holds 60 fps on Kaelen's machine (Apple M4 MacBook Air, 60 Hz built-in display, 2560×1664, DPR 2)
- Thread data is sessions and keystrokes, never per-dot records; dots are drawn procedurally from time × speed (spike 001)
- Multi-hour threads use hour-block times and a moving render origin to stay precise on float32 GPUs (spike 001)

## How to Build It

**Store sessions and keystrokes. Never store dots.**
The persistent record is sessions (start, end) and keystrokes (time, grapheme, actor). The 60 Hz dots are *derived* — drawn from time × speed in a shader. This is not only a performance choice: it is what makes the thread obey Tapestry's replay rule, that rendering comes from recorded inputs rather than from stored pixels.

**Draw the line as a procedural ribbon, not as points.**
Each session or gap is a chunk of 4 vertices — a camera-facing billboard. A fragment shader draws the 60 Hz dots inside it, and blends them into a solid line once `fwidth` shows they are denser than the pixels. Data grows with *sessions* (tens per 8 h), not with dots (1.73 M per 8 h).

```
dots per chunk ← time since the start of that chunk (≤ 10 min, so fract() never quantizes)
collapse       ← fwidth(dotCoord) vs dot spacing → blend to a line
dot shape      ← measured in pixels both along and across the ribbon (else dots are rectangles)
```

**Precision: hour blocks plus a moving origin.**
float32 carries ~7 significant digits. Eight hours is 28,800 s; at 1.5 units/s that is 43,200 units while dots sit 0.025 units apart — plain float32 world positions jitter, and `fract(t × 60)` quantizes around 1.7 M. Store times as (hour block, offset within the hour) and compute positions relative to a render origin that moves with the view. Verified: dots at t = 8 h are spaced exactly as dots at t = 0 (`001/results/shots/e` vs `f`).

**Measure frame intervals from `requestAnimationFrame`.** Median fps, p95/p99, and the share of frames over 25 ms. Benchmark rows run 4 s each after a 1 s warm-up.

## What to Avoid

- **One GPU point per dot.** Invalidated beyond about 1 h. At 8 h continuous it renders at 10–15 fps. The cost is *rasterization and overdraw*, not vertex count — hundreds of thousands of ≥2 px points stack on the same pixels near the vanishing point. Zooming in restores 60 fps precisely because most points leave the screen. This is inherent to the design; the procedural shader instead touches each screen pixel once.
- **One DOM or SVG element per dot.** Ruled out without building.
- **Trusting `gl.finish()` as a GPU timer.** It does not wait for the GPU in Chromium — WebGL commands go to a separate process. Spike 001's first benchmark reported 0.1–0.4 ms of "work" on 100 ms frames.
- **Trusting a frame rate without a screenshot.** Spike 001's first run measured 60 fps on a line that was being culled before rasterization, over a history that had never reached the GPU. Both numbers were meaningless and both looked healthy.
- **Letting a `ShaderMaterial` billboard keep default culling.** It culls back faces, and a camera-facing ribbon's winding flips with the view. Use `side: THREE.DoubleSide`.
- **Requesting a full buffer upload while any update range exists.** three.js uploads *only* the ranges when ranges are present, and silently drops the full upload. A bulk history load followed by one live keystroke means the history never reaches the GPU. An attribute awaiting a full upload must refuse new ranges until a render has uploaded it.
- **Letting a scripted Electron window take focus.** Keystrokes meant for another application land in the spike and change what is measured. Open with `showInactive()` and ignore real input during scripted runs.

## Constraints

- Verified on three.js **0.186.0** (WebGL2-only renderer; converts GLSL1-style `ShaderMaterial` source to GLSL ES 3.0, so `fwidth` needs no extension).
- A 1-D attribute aliased as `position` needs a manually supplied `boundingSphere`.
- Measured ceiling: **8 h continuous = 1.73 M dots + 78 k glyphs at 59.9 fps, 0 % dropped, 0.9 MB of GPU buffers, 46–55 MB private memory.** Every procedural row has a p95 of 17.6–17.8 ms against a 16.7 ms vsync.
- Untested: threads longer than 8 h, 120 Hz ProMotion displays, older integrated GPUs.

## Origin

Synthesized from spike: 001 (VALIDATED — procedural ribbon; explicit points INVALIDATED).
Source files available in: `sources/001-thread-stream-load/`
