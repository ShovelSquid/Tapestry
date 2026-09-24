# Glyph Rendering

How a letter gets onto the thread and stays readable from 8 px to 240 px per em. Four spikes compared four atlases; a fifth combined the two survivors.

## Requirements

From the `thread-rendering` idea (MANIFEST.md):

- Thread letters are instanced quads from one glyph atlas in a single draw call, never one text object per keystroke (spikes 002a/002b)
- Thread letters stay sharp at every zoom the side view offers (Kaelen, 2026-09-15, Phase 2.3 D-19), which means MSDF glyphs from font files; a raster-derived SDF ripples when magnified (spike 003)
- Glyph generation runs off the main thread: an MSDF glyph costs ~8 ms, up to 22.6 ms (spike 003b)
- Thread letters and the note typer use the same font files, or the same word looks like two typefaces (spike 003b)
- Letters are grapheme clusters, not code points; colour emoji are bitmap cells in the same atlas, flagged per letter (spike 003)
- Joining scripts (Arabic) can't be read along the line, because each letter sits at its own keystroke time; the text window carries them (spike 003)
- Thread letters show a browser-SDF cell immediately and swap to an MSDF cell generated in a worker ~15 ms later; the swap costs 0.1 ms and satisfies D-19 without MSDF generation ever touching a frame (spike 007)
- Replacing a glyph's cell means rewriting every instance that already drew it, because `write()` snapshots quad/uv/dist per instance rather than referencing the cache (spike 007)
- Placeholder cells are rasterized across frames, never inside the paste transaction: 2000 never-seen graphemes cost 268 ms synchronously, while the same paste of cached glyphs costs under 10 ms (spike 007)
- The 1024-cell atlas needs real paging, not LRU eviction: under thrash every MSDF cell is discarded and evicted letters vanish from the line (spike 007)

## How to Build It

**The design: one atlas texture, one instanced quad per letter, one draw call.**
Each instance carries position, quad metrics, a UV rect and a kind/edge/range triple — 56 bytes, or 3.4 MB of GPU buffers at 8 h. Cost is flat to at least 78 k letters. `sources/003-shared/glyph-layer.js` is the working implementation: a dynamic 2048 px RGBA atlas of 64 px cells at 36 px em with an 8 px distance range, mipmapped, maximum anisotropy, and **one shader that handles SDF, MSDF and colour-bitmap cells**, chosen per instance.

**The shader, for both field kinds:**
```
distance in texels = (sampled − edge) × range      // SDF: sampled = r,  edge = 1 − cutoff
                                                    // MSDF: sampled = median(rgb), edge = 0.5
texels per pixel   = fwidth(uv) × atlasSize
alpha              = clamp(distance / texelsPerPixel + 0.5)
```
That gives exactly one pixel of antialiasing at every zoom.

**Ship the hybrid: a cheap glyph now, a sharp glyph a moment later.**
On first sight of a grapheme, rasterize a browser-SDF cell with `@mapbox/tiny-sdf` (~0.5 ms) and draw it immediately. In parallel, queue the grapheme to a Web Worker running `msdfgen-wasm`; the MSDF cell comes back in 11–15 ms including transfer, and swapping it in costs **0.100 ms** at worst. The letter is never absent and is sharp within about a frame. This satisfies D-19 without 8 ms per glyph ever touching a frame. `sources/007-hybrid-glyph-worker/` has the fork with slot allocation, a per-grapheme instance list and `upgrade()`.

**Swapping a cell means rewriting instances.** `write()` *snapshots* a grapheme's quad, uv and dist into per-instance attributes — an instance holds a copy, not a reference to the cache. An MSDF cell has different metrics (`tw`, `th`, `x0`, `y0`, `advance`) and a different `dist` triple (kind 0 → 1, edge `1−cutoff` → 0.5), so upgrading rewrites every instance that already drew that grapheme. Measured, those rewrites cost ~1 ms *in total* across 2,496 replacements — it is cheap, it just has to exist. The same machinery is what atlas paging needs.

**Transfer pixels, don't clone them.** A cell is 16 KB; use a transferable.

**Letters are grapheme clusters** (`Intl.Segmenter`), so ZWJ sequences (👩‍👩‍👧) and flags (🇳🇿) are one letter. Colour emoji cannot be a distance field — they are ordinary colour bitmap cells in the same atlas with a per-instance kind flag.

## What to Avoid

- **One text object per keystroke.** Invalidated. troika-three-text gives the best letter quality and fails at thread scale: 4.0–5.5 fps and **850 MB** at 78 k letters, and 140 MB even at 4.8 k. `BatchedText` processes all 78 k members every frame — turning typing off only moved it from 4.3 to 5.5 fps, so it is steady-state cost, not update cost. troika remains a good fit for ordinary text *runs* elsewhere, such as labels or a reading panel.
- **A plain canvas bitmap atlas, if the side view zooms far.** 60 fps and 42–50 MB at 78 k letters — excellent — but each 128 px cell holds ~79 px per em, so it is soft at 48 px and visibly blurred at 120 px. Fine up to ~24 px, where it is indistinguishable from SDF.
- **A browser-derived SDF alone.** Its field is computed from a 36 px antialiased raster, so the outline carries the raster's stair-steps into the distance values: at 120–240 px straight edges ripple in a regular wave and corners round off. Fails D-19 on its own.
- **MSDF alone, on the main thread.** 7.7–8.1 ms per glyph typical, **22.6 ms worst** — which drops a frame. A cold 8 h build is ~5.4 s. It also cannot shape clusters (Devanagari "स्ते" renders as "स" only) and cannot reach fonts the system ships as `.ttc` collections.
- **Rasterizing placeholders inside the paste transaction.** 2000 never-seen graphemes cost **268 ms synchronously**, because ProseMirror delivers the whole paste in one transaction and every letter is placed before the next paint. The identical paste of *cached* glyphs costs under 10 ms. The cost is first use, not paste size. Place the instances immediately with a blank cell and fill cells over the following frames.
- **LRU eviction as the paging policy.** Its own cost is negligible (14 ms of scanning across 2,496 evictions) but under pressure it *thrashes*: MSDF cells were driven to **zero**, discarding everything the worker had sharpened, and an evicted letter disappears from the line entirely. A thread written in CJK passes 1024 distinct glyphs quickly. Candidates instead: a second atlas page (an array texture or a second draw call), a larger atlas, or evicting only cells with no visible instances.
- **An unbounded worker queue.** It reached **8.5 s of backlog**, because every new glyph queues a request. Prioritise graphemes actually on screen; drop requests for graphemes whose cell has since been evicted.
- **Assuming a screenshot pair proves a swap.** Spike 007's first before/after captures were identical — the worker returns in ~11 ms and the "before" shot was taken at +120 ms. *Hold* upgrade requests and release them deliberately. A timing race is not evidence.
- **Reading a magnified side view by centring on a span's midpoint.** Past ~120 px per em the gap between two letters can exceed the visible width and the camera lands in empty space. Centre on a specific glyph. (Spike 002a's first 120 px crop was empty because it centred on a space.)

## Constraints

| | browser SDF (`@mapbox/tiny-sdf` 2.2.0) | MSDF (`msdfgen-wasm` 1.0.0) |
|---|---|---|
| 8–48 px | ✓ | ✓, indistinguishable |
| 120–240 px | ⚠ crisp but rippled, rounded corners | **✓ straight edges, true corners** |
| Per glyph | **0.53 ms** (avg) | 7.7–8.1 ms, **max 22.6 ms** |
| Build 1 h / cold 8 h | **0.26 s / ~0.4 s** | 3.7 s / ~5.4 s |
| Private memory | **71–79 MB** | 122–127 MB |
| Font fallback | **✓ whatever the browser has** | ⚠ single-file fonts only, no `.ttc` |
| Shaped clusters | **✓ correct** | ✗ first code point only |

- **`@mapbox/tiny-sdf` 2.2.0:** subclass it to force a DOM canvas, so the `FontFace` added to `document.fonts` is visible. The first glyph needing a fallback font costs a one-off ~106 ms while the browser loads that font; every other glyph is ~0.5 ms.
- **`msdfgen-wasm` 1.0.0:** `require` its `dist/cjs/index.js` **by absolute path** — the ESM build imports extensionless paths a browser cannot resolve, and a directory `require` ignores `exports` when the package has no `main`. `loadGlyphs(codes)` *unloads* previously loaded glyphs, so load one at a time and keep the finished cell. `generateBitmap` returns RGBA **top row first**. Skia preprocessing is not the cost (generation is unchanged with `--no-preprocess`) and it fixes overlapping contours, so keep it on.
- **The worker needs `nodeIntegrationInWorker: true` and `sandbox: false`.** Electron's own modules are unavailable inside a worker; `fs` and `path` are all msdfgen-wasm needs.
- **Fonts:** macOS Verdana at `/System/Library/Fonts/Supplemental/Verdana.ttf`, never copied into the repo. For broad Unicode from a file, Arial Unicode (`/System/Library/Fonts/Supplemental/Arial Unicode.ttf`, 23 MB) is the only single-file option — macOS ships CJK faces as `.ttc` collections, which msdfgen-wasm cannot read. Arial Unicode's CJK shapes differ from the browser's Hiragino fallback, which is exactly why thread letters and the text window must draw from the same files.
- **A glyph cache belongs to the application, not to a session** — spike 003b's 8 h build cost almost nothing only because the 1 h atlas was still warm.
- **Arabic and other joining scripts cannot be read along the line** at all, in any variant: each letter sits at its own keystroke time, so they appear in isolated forms in typing order. The DOM text window carries them.
- Untested: a second atlas page, prioritised or cancellable worker requests, colour emoji under eviction (they have no sharper version to request), an input method committing several new glyphs in one frame, the hybrid inside the real app, and 120 Hz displays.

## Origin

Synthesized from spikes: 002a (INVALIDATED), 002b (WINNER of 002), 003a (PARTIAL), 003b (WINNER of 003), 007 (PARTIAL).
Source files available in: `sources/002a-glyphs-sdf/`, `sources/002b-glyphs-canvas-atlas/`, `sources/003-shared/`, `sources/003a-sharp-glyphs-sdf/`, `sources/003b-sharp-glyphs-msdf/`, `sources/007-hybrid-glyph-worker/`
