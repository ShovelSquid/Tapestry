---
spike: 003a
idea: thread-rendering
name: sharp-glyphs-sdf
type: comparison
validates: "Given instanced glyph quads, when the atlas holds SDF glyphs generated at runtime, then letters stay razor-sharp from 8 to 240 px at 60 fps with 78 k letters, and new glyphs (emoji, non-Latin) are added on first use"
verdict: PARTIAL
related: [002b, 003b, 001]
tags: [webgl, text, sdf, instancing, unicode]
---

# Spike 003a: Sharp Glyphs from a Runtime SDF Atlas (tiny-sdf)

## What This Validates
**Given** thread letters drawn as instanced quads from one atlas texture (the spike 002b design), in the repo's Electron on Kaelen's M4 MacBook Air,
**when** the atlas holds single-channel signed distance fields generated the first time each grapheme is typed, by `@mapbox/tiny-sdf` from the browser's own text rendering,
**then** letters stay razor-sharp from 8 to 240 px per em (Phase 2.3 D-19), CJK, Korean, Arabic, Devanagari and emoji all appear, never-seen glyphs can be added while typing without a frame hitch, and 1 h and 8 h continuous histories hold 60 fps.

## Research
- **Why a new atlas:** 002b's canvas bitmap blurs above ~48 px. Distance fields stay crisp under magnification because the shader thresholds a distance rather than stretching pixels (Red Blob Games, *Guide to SDF+MSDF Fonts*).
- **Shader:** signed distance in texels = (value − edge) × range; divide by texels per screen pixel from `fwidth(uv) × atlasSize`; alpha = clamp(distance + 0.5). One pixel of antialiasing at every zoom.
- **Candidates** (npm, 2026-09-15):

| Approach | Tool | Pros | Cons | Status |
|---|---|---|---|---|
| **SDF from browser text** | `@mapbox/tiny-sdf` 2.2.0 | Any glyph the browser can draw: macOS font fallback and cluster shaping for free; tiny; per glyph | One channel rounds corners; quality bound to the raster size | **This spike** |
| SDF on the GPU from vector paths | `webgl-sdf-generator` 1.1.1 (troika's) | Very fast | Needs glyph outlines from a font file, so no automatic fallback | Not built |
| MSDF from font files | `msdfgen-wasm` 1.0.0 | Sharp corners | Font files only; heavier | 003b |
| MSDF atlas in a worker | `@zappar/msdf-generator` 1.2.4 | Polished | Generates a whole atlas at once | Not built |

- **Colour emoji** can't be a distance field. Both 003 variants draw them as ordinary colour bitmap cells in the same atlas, with a per-instance kind flag.
- **Settings:** em 36 px inside 64 px cells, radius and buffer 8 px, cutoff 0.25, 2048 px RGBA atlas (1024 cells), mipmaps and maximum anisotropy.

## How to Run
From the repo root (after `cd .planning/spikes && npm install`):
```sh
node_modules/.bin/electron .planning/spikes/003a-sharp-glyphs-sdf/main.cjs            # interactive: type in any script (IME, emoji picker), Ctrl+1–9/0 views, Ctrl+S sweep 4→240 px, Ctrl+L 1 h / 8 h
node_modules/.bin/electron .planning/spikes/003a-sharp-glyphs-sdf/main.cjs --shots    # 11 views → results/shots/{view}.png and {view}-crop.png
node_modules/.bin/electron .planning/spikes/003a-sharp-glyphs-sdf/main.cjs --bench    # 1 h and 8 h continuous, including a never-seen-glyph hitch test
node_modules/.bin/electron .planning/spikes/003-shared/compare.cjs                    # side by side with 003b
```
Code shared with 003b lives in `../003-shared/`: `glyph-layer.js` (dynamic atlas, instanced quads, one shader for SDF, MSDF and colour) and `scene.js` (002's scene extended with graphemes, CJK history, a Latin and Unicode showcase at the end of each load, views to 240 px, and the hitch test). The launcher is `../002-shared/launch.cjs`, unchanged.

## What to Expect
White Verdana letters above a grey thread line. Side views centre on "W" and "を". At 16–48 px the letters look like good screen text. At 120 and 240 px the edges are crisp, with no blur, but straight edges visibly ripple and corners are rounded.

## Investigation Trail
1. **First shots:** at 48 px, clean Latin and CJK (the CJK comes from the browser's fallback font). At 240 px the crop landed between "n" and "y", so side views were re-centred on "W" (diagonals and corners) and "を" (curves).
2. **240 px on "W":** crisp edges, but the long diagonals ripple in a regular wave and the corners are round. At 120 px the ripple is still visible. The distance field is computed from a 36 px antialiased raster (Felzenszwalb–Huttenlocher transform over coverage), so the outline carries the raster's stair-steps into the distance values. Magnifying the field magnifies that error. **Not razor-sharp.**
3. **Precision:** side views sit within a minute of the render origin, so float32 positions are exact at 240 px per em. Spike 001's floating origin still applies to real threads, where the view can be hours from the head.
4. **Unicode, whole line at 16 px** (view added after the first run): Japanese, Chinese, Korean, Arabic, Devanagari and "café" all render. The Devanagari cluster "स्ते" is shaped correctly because the browser draws the whole grapheme. **Arabic letters appear in isolated forms, left to right in typing order.** That comes from placing each keystroke at its own time, and it affects 003b too.
5. **Emoji:** in an enlarged crop, 👩‍👩‍👧 draws as one glyph (Apple's silhouette family tile) and 🇳🇿 as one flag. So Intl.Segmenter graphemes plus the colour-bitmap path handle ZWJ sequences and flags.
6. **Benchmark** (typing 5.5 keys/s throughout): 60 fps everywhere. A 250 ms stream of never-seen Hangul (16 new glyphs, each rasterized inside the frame) never pushed a frame past 18.8 ms.
7. **One 106 ms rasterize** per run, always the first glyph needing a fallback font. The browser loads that font on first use. Every other glyph took about 0.5 ms.

## Results
**Verdict: PARTIAL.** Performance, Unicode coverage and live glyph growth are excellent. **Sharpness at 120–240 px fails D-19**: edges ripple and corners are rounded.

Benchmark (`results/bench-2026-09-15T20-10-28-624Z.json`; frame intervals, 4 s per row after 1 s warm-up):

| Load | Views (live, oblique, side 16 px, sweep 4→240 px) | New glyphs live (16 in 4 s) | Build | Atlas cells | Rasterize avg / max | Private memory |
|---|---|---|---|---|---|---|
| 1 h (4.4 k letters) | 59.9 fps, p95 18.6–18.7 ms, 0 % dropped | 59.9 fps, max frame 18.7 ms | 0.26 s (476 glyphs) | 475 → 491 | 0.53 / 106 ms (first fallback glyph) | 71–74 MB |
| 8 h continuous (62 k drawn letters, 78 k keystrokes) | 59.9 fps, p95 18.6–18.7 ms, 0 % dropped | 59.9 fps, max frame 18.8 ms | 0.07 s (203 new glyphs; atlas kept from 1 h) | 678 → 694 | 0.48 / 106 ms | 78–79 MB |

Instances cost 56 bytes each (position, quad, UV rect, kind/edge/range): 3.4 MB of GPU buffers at 8 h.

**Signal for the build:**
- Browser-drawn SDF is the right tool wherever **fonts, fallback and shaping must match the DOM text window**, and for anything font files can't cover: multi-code-point clusters, and scripts missing from the bundled fonts.
- It is **not enough on its own for D-19**. Magnified letters need MSDF (003b).
- A cheap browser-SDF cell appears in about 0.5 ms, so it can be drawn immediately while a sharper MSDF cell is generated elsewhere. That hybrid is untested.
- **Arabic and other joining scripts can't be read on the line** when letters sit at their own keystroke times. Readable text for those scripts belongs in the text window.
