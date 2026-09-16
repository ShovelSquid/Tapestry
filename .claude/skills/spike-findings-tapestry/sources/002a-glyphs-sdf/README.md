---
spike: 002a
idea: thread-rendering
name: glyphs-sdf
type: comparison
validates: "Given letters along the thread, when drawn with an SDF glyph atlas (troika-three-text) along the z-axis and from the side, then text is crisp at all zooms"
verdict: INVALIDATED
related: [001, 002b]
tags: [webgl, text, sdf, troika]
---

# Spike 002a: Glyphs as SDF Text (troika-three-text)

## What This Validates
**Given** the thread's keystroke letters (Verdana, 0.12 world units per em) placed one per keystroke along the thread in the repo's Electron on Kaelen's M4 MacBook Air,
**when** drawn with troika-three-text: one `Text` per keystroke, batched into a single `BatchedText` draw call, with SDF glyphs at the default 64 px,
**then** letters are crisp and legible in the live view, an oblique view and side views from 8 to 120 px per em, while holding 60 fps with 1 h (4.8 k letters) and 8 h continuous (78 k letters) of history.

## Research
- **troika-three-text 0.52.5** (npm latest, 2026-09-15), needing three ≥0.125.
  - Supports `.ttf`, `.otf` and `.woff`, not `.woff2`. Without a `font`, Roboto loads from the Google Fonts CDN.
  - Fonts load with `XMLHttpRequest` inside a web worker. The unicode-font-resolver CDN is used only for characters the font lacks.
  - `sdfGlyphSize` defaults to 64 (power of two). `gpuAccelerateSDF` defaults to true.
  - `preloadFont({ font, characters }, callback)` pre-generates glyph SDFs.
  - `BatchedText` (not in the README; read from source) batches child `Text` objects into one draw call, packing per-member data into a float texture. Needs WebGL2.
- troika is designed for runs of text. Placing each letter at its own time means one `Text` per keystroke. That design question is what this spike tests.

| Approach | Tool | Pros | Cons |
|---|---|---|---|
| **SDF text, one Text per keystroke, BatchedText** | troika-three-text | Crisp at any magnification; real font shaping; one draw call | One JS object, typesetting result and geometry per letter |
| One Text per word or burst | troika-three-text | Far fewer objects | Letters can't sit at their own keystroke times |
| Canvas atlas + instanced quads | none (002b) | One instance per letter, tiny memory | Blurs when magnified past the atlas resolution |

## How to Run
From the repo root (after `cd .planning/spikes && npm install`):
```sh
node_modules/.bin/electron .planning/spikes/002a-glyphs-sdf/main.cjs                          # interactive: type, 1–8 views, S sweep, L 1 h / 8 h
node_modules/.bin/electron .planning/spikes/002a-glyphs-sdf/main.cjs --shots                  # 8 views → results/shots/{view}.png and {view}-crop.png
node_modules/.bin/electron .planning/spikes/002a-glyphs-sdf/main.cjs --bench [--no-typing]    # 1 h and 8 h continuous benchmark
node_modules/.bin/electron .planning/spikes/002-shared/compare.cjs                             # side-by-side with 002b
```
The shared harness (`002-shared/`) serves `.planning/spikes` over local HTTP and exposes macOS Verdana at `/font/verdana.ttf`. Both variants use identical letters, font, size and cameras.

## What to Expect
Crisp white Verdana letters above a grey thread line. In the live view they recede into depth. In the oblique view they're seen at an angle. In side views they read left to right, spaced by keystroke timing.

## Investigation Trail
1. **Local HTTP instead of `file://`.** troika fetches the font from inside a web worker, so the spikes are served from `http://127.0.0.1` by the Electron main process.
2. **Font URL must be absolute.** troika resolves the font URL inside a `blob:` worker, where a relative path like `/font/verdana.ttf` has no base URL. Fixed with `new URL('/font/verdana.ttf', location.href).href`.
3. **Screenshots (1 h):**
   - **Live:** crisp, including the nearest letters.
   - **Oblique:** crisp at an angle.
   - **Side, 8–24 px:** legible and nearly identical to 002b.
   - **Side, 48 and 120 px:** edges stay razor-sharp; this is SDF's real advantage.
   - The first 120 px crop was empty because the side view centred on a keystroke that was a space. The harness now centres on a visible letter; the full 120 px screenshot showed the letters.
4. **Benchmark with typing (5 keys/s):**
   - **1 h:** 60 fps, 0 dropped, 0.2 s build.
   - **8 h continuous:** builds in 2.7 s but renders at **4.3 fps** (p95 250 ms, every frame late), with **850 MB** private memory.
5. **Was it the typing?** Each keystroke adds a `BatchedText` member, which could repack the whole member texture. Re-ran with `--no-typing`: 8 h continuous still **5.5 fps** (p95 183 ms) and **848 MB**. So the cost is steady state: `BatchedText` processes all 78 k members every frame. Typing makes it worse (5.5 → 4.3 fps) but isn't the cause.
6. **Memory even at 1 h:** 140 MB private, against 43 MB for 002b drawing the same 4.8 k letters. That's the per-`Text` overhead: a JS object, typesetting data and geometry for each letter.

## Results
**Verdict: INVALIDATED** for the thread. It gives the best letter quality, but it fails at thread scale.

| Load | View | fps | Dropped | Build | Private memory |
|---|---|---|---|---|---|
| 1 h (4.8 k letters) | live / oblique / side 16 px / sweep | 59.9 | 0 % | 0.2 s | 140–145 MB |
| 8 h continuous (78 k), typing on | all views | **4.0–4.3** | 100 % | 2.7 s | **836–864 MB** |
| 8 h continuous (78 k), typing off | all views | **5.5** | 100 % | 2.7 s | **805–848 MB** |

**Head-to-head with 002b:** quality is equal from 8 to 24 px and SDF is clearly sharper at 48 px and above. Cost differs by orders of magnitude at 8 h. Details are in `../002b-glyphs-canvas-atlas/README.md`.

**Signal for the build:**
- Don't draw thread letters as one text object per keystroke with troika or any similar library.
- troika is still a good fit for ordinary text runs elsewhere, such as labels or a reading panel.
- If the thread needs SDF sharpness, the path is SDF or MSDF glyphs inside the same instanced-quad design as 002b. That's one texture and one instance per letter.
- **Not tested:** an MSDF atlas with instanced quads, and troika with a custom per-glyph position shader.
