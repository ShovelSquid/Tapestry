---
spike: 003b
idea: thread-rendering
name: sharp-glyphs-msdf
type: comparison
validates: "Same as 003a with an MSDF atlas (plus bitmap fallback for colour emoji)"
verdict: WINNER
related: [003a, 002b, 001]
tags: [webgl, text, msdf, instancing, wasm, unicode]
---

# Spike 003b: Sharp Glyphs from a Runtime MSDF Atlas (msdfgen-wasm)

## What This Validates
**Given** the same instanced glyph quads, atlas and shader as 003a, in the repo's Electron on Kaelen's M4 MacBook Air,
**when** the atlas holds multi-channel signed distance fields generated the first time each grapheme is typed, by `msdfgen-wasm` from font files (Verdana, falling back to Arial Unicode),
**then** letters stay razor-sharp from 8 to 240 px per em (Phase 2.3 D-19), other scripts and emoji appear, never-seen glyphs can be added while typing without a frame hitch, and 1 h and 8 h continuous histories hold 60 fps.

## Research
- **Why MSDF:** a single-channel field rounds corners, because one distance per texel can't describe two edges meeting. MSDF stores three distances and takes their median, which reconstructs sharp corners (Chlumsky; Red Blob Games, *Guide to SDF+MSDF Fonts*).
- **Shader:** identical to 003a except the sampled value is `median(rgb)`, with edge 0.5 and range 8 texels. Both kinds live in one draw call, chosen per instance.
- **`msdfgen-wasm` 1.0.0** (a WebAssembly build of Chlumsky's msdfgen with Skia preprocessing), read from its source:
  - `loadGlyphs(codes)` **unloads previously loaded glyphs**, so this spike loads one glyph at a time and keeps only the finished cell.
  - `computeGlpyhMsdfData(glyph, { size, range })` maps em space to pixels as `(shape + translate) × scale`; `generateBitmap` returns RGBA with the **top row first**.
  - Its ESM build imports extensionless paths (`./Msdfgen`), which a browser can't resolve, and a directory `require` ignores `exports` when the package has no `main`. The page loads `dist/cjs/index.js` by absolute path through Electron's `require`.
- **Fonts:** Verdana has no CJK, Korean, Arabic or Devanagari, so Arial Unicode (23 MB, the only single-file system font with broad coverage) is the fallback. `.ttc` collections, which is what macOS ships for Hiragino and PingFang, are not supported.
- **Colour emoji** use the same colour-bitmap path as 003a.
- **Settings** match 003a exactly: em 36 px in 64 px cells, range 8 px, 2048 px atlas, mipmaps, maximum anisotropy.

## How to Run
From the repo root (after `cd .planning/spikes && npm install`):
```sh
node_modules/.bin/electron .planning/spikes/003b-sharp-glyphs-msdf/main.cjs                    # interactive; same keys as 003a
node_modules/.bin/electron .planning/spikes/003b-sharp-glyphs-msdf/main.cjs --shots            # 11 views → results/shots/
node_modules/.bin/electron .planning/spikes/003b-sharp-glyphs-msdf/main.cjs --bench            # 1 h and 8 h continuous, including the new-glyph hitch test
node_modules/.bin/electron .planning/spikes/003b-sharp-glyphs-msdf/main.cjs --shots --no-preprocess  # skip msdfgen's Skia preprocessing, to price it
node_modules/.bin/electron .planning/spikes/003-shared/compare.cjs                              # side by side with 003a
```
`main.cjs` passes the spikes directory to the page in `TAPESTRY_SPIKES_DIR`, because a page served over HTTP can't resolve Node modules by relative path.

## What to Expect
The same scene as 003a. At 240 px per em, "W" has straight edges and true corners, and "を" has clean curves. CJK glyphs look different from 003a's, because these come from Arial Unicode rather than the browser's Hiragino fallback.

## Investigation Trail
1. **First run hung.** The page threw immediately and the window sat until the launcher's 600 s timeout, and `| tail` held all output until exit, so nothing was visible. Re-running with output to a file showed `Cannot find module …/node_modules/msdfgen-wasm`: a directory require ignores `exports`, and the package has no `main`. Fixed by requiring `dist/cjs/index.js`. **Scripted spike runs now log to a file, never through a pipe that buffers.**
2. **Sharpness:** at 240 px, "W" has perfectly straight diagonals and crisp corners where 003a ripples, and "を" is clean. At 8–48 px the two are indistinguishable. **This is what D-19 asked for.**
3. **Cost:** rasterizing averaged 7.7–8.1 ms per glyph, against 0.53 ms for 003a. Building a 1 h history (476 glyphs) took 3.68 s against 0.26 s.
4. **Where the time goes** (timing added per stage): generating the bitmap is essentially all of it — 3.58 s of the 3.68 s build — while loading glyph outlines and kerning cost about 0.16 ms each.
5. **Preprocessing is not the cause.** With `--no-preprocess` (`results/shots-2026-09-15T20-14-08-267Z.json`), glyph loading dropped from 74 ms to 21 ms in total and generation was unchanged at 3.70 s. The cost is msdfgen itself in this WebAssembly build. Preprocessing stays on: it fixes overlapping contours.
6. **Live typing survives it anyway.** 16 never-seen Hangul syllables at 4 per second each took 8–11 ms, and no frame exceeded 18.8 ms, because the work lands between frames inside a 16.7 ms budget. **The worst glyph took 22.6 ms**, which would drop a frame, and an input method committing several new characters at once was not tested.
7. **Unicode:** Korean, Arabic and Devanagari all resolve through Arial Unicode. **The Devanagari cluster "स्ते" renders as "स" only** — msdfgen draws one glyph per code point with no shaping, so 003a (which shapes whole graphemes through the browser) is better here. Arabic shows isolated forms in both, because each letter sits at its own keystroke time.
8. **Emoji:** 👩‍👩‍👧 and 🇳🇿 each draw as one glyph through the colour-bitmap path, confirmed in an enlarged crop.
9. **CJK glyphs don't match 003a's.** Arial Unicode's shapes differ from the browser's Hiragino fallback, so thread letters would not match the DOM text window unless both use the same font files.

## Results
**Verdict: WINNER** of 003 for sharpness, at a real cost in glyph generation time and memory.

Benchmark (`results/bench-2026-09-15T20-12-45-804Z.json`; frame intervals, 4 s per row after 1 s warm-up, typing throughout):

| Load | Views (live, oblique, side 16 px, sweep 4→240 px) | New glyphs live (16 in 4 s) | Build | Atlas cells | Rasterize avg / max | Private memory |
|---|---|---|---|---|---|---|
| 1 h (4.4 k letters) | 59.9 fps, p95 18.6–18.7 ms, 0 % dropped | 59.9 fps, max frame 18.8 ms | 3.68 s (476 glyphs) | 475 → 491 | 7.7 / 22.6 ms | 125–127 MB |
| 8 h continuous (62 k drawn letters) | 59.9 fps, p95 18.6–18.7 ms, 0 % dropped | 59.9 fps, max frame 18.7 ms | 1.63 s (203 new glyphs; atlas kept from 1 h) | 678 → 694 | 8.1 / 22.6 ms | 122–125 MB |

A cold 8 h build would cost about 679 × 8 ms ≈ 5.4 s, which the recorded 5.35 s of total generation time confirms.

### Head-to-head: 003a (browser SDF) vs 003b (MSDF from font files)
| | 003a tiny-sdf | 003b msdfgen-wasm |
|---|---|---|
| 8–48 px | ✓ | ✓, indistinguishable |
| 120–240 px | ⚠ crisp but rippled edges, rounded corners | **✓ straight edges, true corners** |
| Rasterize per glyph | **✓ 0.53 ms** | ✗ 7.7–8.1 ms (max 22.6) |
| Build 1 h / cold 8 h | **✓ 0.26 s / ~0.4 s** | ✗ 3.7 s / ~5.4 s |
| Private memory | **✓ 71–79 MB** | ⚠ 122–127 MB |
| fps at 1 h and 8 h | ✓ 59.9, 0 dropped | ✓ 59.9, 0 dropped |
| Font fallback | **✓ whatever the browser has** | ⚠ single-file fonts only; no `.ttc` |
| Shaped clusters (Devanagari) | **✓ correct** | ✗ first code point only |
| Matches the DOM text window | **✓ same fonts** | ⚠ only if both use the same font files |
| Emoji | ✓ colour bitmap | ✓ colour bitmap |

**Signal for the build (Phase 2.3):**
- **Draw thread letters as MSDF glyphs from font files** in the instanced-quad design from 002b. That satisfies D-19 at every zoom the side view offers.
- **Generate glyphs off the main thread.** 8 ms typical and 22 ms worst case is too close to a frame. msdfgen-wasm runs in a web worker; the atlas copy itself costs 0.03–0.22 ms on the main thread and is not the problem.
- **Keep the browser-SDF path (003a) as the fallback** for what font files can't do: shaped clusters, scripts the bundled fonts lack, and a cell that appears in 0.5 ms while the MSDF one is still generating. The swap is untested.
- **Ship the fonts the editor uses.** Thread letters and the DOM text window must come from the same font files, or the same word looks like two different typefaces.
- **A glyph cache belongs in the app, not in each session.** The 8 h build cost almost nothing here because the 1 h atlas was still warm.
- **Not tested:** an input method committing several new glyphs in one frame, threads with more than 1024 distinct glyphs (atlas paging), slower machines, and 120 Hz displays.
