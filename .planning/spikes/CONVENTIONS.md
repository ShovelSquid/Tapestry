# Spike Conventions

Patterns and stack choices established across spike sessions. New spikes follow these unless the question requires otherwise.

## Stack
- **Runtime:** the repo's Electron (`node_modules/.bin/electron`, 32.3.3 / Chromium 128), not a plain browser, so the GPU path and throttling match the app (Kaelen, 2026-09-15).
- **Rendering:** three.js 0.186.0, loaded as ES modules through an import map. No bundler.
- **Dependencies:** one shared `.planning/spikes/package.json` (three, troika-three-text, @mapbox/tiny-sdf, msdfgen-wasm, and the ProseMirror packages at the exact versions `app/` resolves); `node_modules` is gitignored. Run `cd .planning/spikes && npm install` once.
- **Glyphs:** thread letters come from `003-shared/glyph-layer.js` (dynamic 2048 px atlas, 64 px cells, 36 px em, 8 px distance range, instanced quads, one shader for SDF, MSDF and colour emoji). `003-shared/sdf-rasterizer.js` supplies browser-drawn SDF cells; a variant only provides `rasterize(grapheme)`.

## Structure
- `NNN-name/` holds `main.cjs` (Electron launcher), `index.html`, the page script and `README.md`. Comparison spikes share code in `NNN-shared/`. Later spikes may import an earlier `NNN-shared/` rather than copying measured code (004 uses 003's glyph layer and rasterizer).
- `results/` holds benchmark JSON (`bench-*.json`), screenshot logs and `results/shots/*.png`. Results are committed as evidence.
- When a page needs to fetch (fonts in workers, for example), the launcher serves `.planning/spikes` over `http://127.0.0.1:<random port>` from the Electron main process (see `002-shared/launch.cjs`).

## Patterns
- **Three modes per spike:** interactive (default), `--bench` (scripted benchmark, prints a table, writes JSON, quits) and `--shots` (scripted screenshots, full window resized to 1400 px plus device-resolution crops, quits).
- **Scripted runs open with `showInactive()` and ignore real input.** Otherwise keystrokes meant for another app land in the spike and change what's measured (spike 001).
- **Measure frame intervals from `requestAnimationFrame`**, reporting median fps, p95/p99 and the share of frames over 25 ms. **`gl.finish()` does not measure GPU time in Chromium** (spike 001).
- **Always screenshot and look before trusting a benchmark.** Spike 001's first benchmark measured a thread whose line was culled and whose history never reached the GPU.
- **Synthetic history:** seeded `mulberry32(7)` sessions of 2–15 min, 1–20 min away, typing bursts of 5–40 s at 3–8 keys/s. Loads are 1 h and 8 h continuous (1.73 M dots, 78 k letters).
- **Forward page errors** to the terminal (`console-message` level ≥ 2) and exit with a timeout.
- **Send scripted-run output to a file, never through a pipe.** `electron … | tail` buffers everything until the process exits, so a page that throws and then waits out the launcher's 600 s timeout looks like a silent hang (spike 003b).
- **Drive real input through the main process** for anything about latency: `ipcRenderer.invoke('send-input', events)` reaches `webContents.sendInputEvent`, so Chromium's own input pipeline is measured. Clipboard shortcuts don't work that way — use `ipcRenderer.invoke('edit-command', { command: 'paste' })` (spike 004).
- **Pair input events with the newest pending `beforeinput`,** not a FIFO queue: events that produce no document change make a queue drift and report stale timestamps (spike 004).
- **Letters are grapheme clusters** (`Intl.Segmenter`), so emoji, flags and combining marks count as one letter (spike 003).
- **Centre zoomed side views within a minute of the render origin,** or float32 positions wobble before the renderer is at fault (spikes 001, 003).

## Tools & Libraries
- **three.js 0.186.0 gotchas:**
  - If any update range exists, only the ranges are uploaded, so a full upload must block new ranges until the next render.
  - `ShaderMaterial` culls back faces, so billboards need `DoubleSide`.
  - A 1-D attribute aliased as `position` needs a manual `boundingSphere`.
- **troika-three-text 0.52.5:** fine for text runs. Don't use one `Text` per letter at scale (002a). The font URL must be absolute and fetchable from a worker.
- **@mapbox/tiny-sdf 2.2.0:** subclass it to force a DOM canvas, so the `FontFace` added to `document.fonts` is visible. Fast (~0.5 ms/glyph) and Unicode-complete, but its field comes from a raster, so edges ripple above ~120 px per em.
- **msdfgen-wasm 1.0.0:** `require` its `dist/cjs/index.js` by absolute path — the ESM build uses extensionless imports a browser can't resolve, and a directory require ignores `exports` when there's no `main`. `loadGlyphs` unloads previously loaded glyphs; bitmaps come back top-row-first. Generation costs ~8 ms per glyph, so it belongs off the main thread.
- **Fonts:** macOS Verdana served from `/System/Library/Fonts/Supplemental/Verdana.ttf`; never copied into the repo. For broad Unicode from a font file, Arial Unicode (`/System/Library/Fonts/Supplemental/Arial Unicode.ttf`) is the only single-file option — macOS ships CJK faces as `.ttc` collections, which msdfgen-wasm can't read.
- **The page reaches Node modules by absolute path.** Pages are served over HTTP, so `main.cjs` passes the spikes directory in `process.env.TAPESTRY_SPIKES_DIR` before requiring the launcher.
