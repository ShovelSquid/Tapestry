# Spike Conventions

Patterns and stack choices established across spike sessions. New spikes follow these unless the question requires otherwise.

## Stack
- **Runtime:** the repo's Electron (`node_modules/.bin/electron`, 32.3.3 / Chromium 128), not a plain browser, so the GPU path and throttling match the app (Kaelen, 2026-09-15).
- **The repo is an npm workspace.** `app/node_modules` is empty and everything hoists to the repo root: electron, electron-vite, vite, react, react-dom, `@vitejs/plugin-react`, typescript and every ProseMirror package the app depends on. A spike that needs them adds no dependency and edits no `package.json` (spike 005).
- **Rendering:** three.js 0.186.0, loaded as ES modules through an import map. No bundler — *except* for a spike that must load the app's own TSX, which no browser can run unchanged; spike 005 runs a spike-local Vite dev server from the root install for exactly that, and copying the components instead would test a replica rather than the app.
- **Dependencies:** one shared `.planning/spikes/package.json` (three, troika-three-text, @mapbox/tiny-sdf, msdfgen-wasm, and the ProseMirror packages at the exact versions `app/` resolves); `node_modules` is gitignored. Run `cd .planning/spikes && npm install` once.
- **The kernel needs no Electron.** `require('app/native/build/Release/tapestry_addon.node')` loads under plain Node and exposes `TapestryAddon.create(path, world)` / `.open(path)` plus `submit`, `getNode(s)`, `getEdges`, `status`, `replayUpTo`, `getLastSeq`, `getHistoryIndex`, `close`. A storage spike drives the real `.tree` writer and reader rather than imitating them (spike 006).
- **Glyphs:** thread letters come from `003-shared/glyph-layer.js` (dynamic 2048 px atlas, 64 px cells, 36 px em, 8 px distance range, instanced quads, one shader for SDF, MSDF and colour emoji). `003-shared/sdf-rasterizer.js` supplies browser-drawn SDF cells; a variant only provides `rasterize(grapheme)`.

## Structure
- `NNN-name/` holds `main.cjs` (Electron launcher), `index.html`, the page script and `README.md`. Comparison spikes share code in `NNN-shared/`. Later spikes may import an earlier `NNN-shared/` rather than copying measured code (004 and 011 use 003's glyph layer and rasterizer).
- **Import a shared module only where it is reusable.** `003-shared/scene.js` calls `window.require('electron')` at module scope, so it cannot load under plain Node — spike 006 copies its seeded generator instead and says so. `glyph-layer.js` and `sdf-rasterizer.js` are pure browser code and import cleanly anywhere.
- **Fork rather than widen** when a spike needs a shared module's internals: spike 007 forked `glyph-layer.js` into `hybrid-glyph-layer.js`, because changing the shared one would change measured code that the 003 verdicts rest on.
- `results/` holds benchmark JSON (`bench-*.json`), screenshot logs and `results/shots/*.png`. Results are committed as evidence.
- Most spikes launch through `002-shared/launch.cjs`, which serves `.planning/spikes` over `http://127.0.0.1:<random port>` and provides `capture`, `write-result`, `send-input`, `edit-command` and `set-clipboard`. **It has no `memory` handler** — a spike that wants process memory needs its own launcher (005, 007).

## Patterns
- **Three modes per spike:** interactive (default), `--bench` (scripted benchmark, prints a table, writes JSON, quits) and `--shots` (scripted screenshots, quits).
- **Scripted runs open with `showInactive()` and ignore real input.** Otherwise keystrokes meant for another app land in the spike and change what's measured (spike 001).
- **Measure frame intervals from `requestAnimationFrame`**, reporting median fps, p95/p99 and the share of frames over 25 ms. **`gl.finish()` does not measure GPU time in Chromium** (spike 001).
- **Always screenshot and look before trusting a benchmark.** Spike 001's first benchmark measured a thread whose line was culled and whose history never reached the GPU; spike 005's first frame reported 62,474 glyphs with nothing on screen. A frame rate says nothing about appearance.
- **Every stressed phase needs a matching baseline phase.** Spike 005 measured a 116 ms stall while zooming with the thread open and had no canvas-only zoom to compare it against; the baseline showed the app's own zoom drops the same 0.4 % of frames with no thread on screen at all.
- **Synthetic history:** seeded `mulberry32(7)` sessions of 2–15 min, 1–20 min away, typing bursts of 5–40 s at 3–8 keys/s. Loads are 1 h and 8 h continuous (1.73 M dots, 78 k letters).
- **Forward page errors *and* unhandled rejections** to the terminal. The launcher relays `console-message` at level ≥ 2, so the page reports through `console.error` — but an async scripted step that throws becomes an unhandled rejection, which Electron does **not** surface as a console message, and the run then idles silently until the timeout (spike 005).
- **A page that imports bare specifiers needs an import map.** Without one the module never evaluates, no instrumentation fires, and the launcher waits out its timeout looking like a hang (spike 011).
- **Keep the scripted timeout short** (about 120 s) so a hang costs seconds to diagnose; raise it only for work that genuinely needs it, such as a benchmark that rebuilds an 8 h history twenty times (spikes 005, 007).
- **Send scripted-run output to a file, never through a pipe.** `electron … | tail` buffers everything until the process exits, so a page that throws and then waits out the launcher's timeout looks like a silent hang (spike 003b).
- **Drive real input through the main process** for anything about latency: `ipcRenderer.invoke('send-input', events)` reaches `webContents.sendInputEvent`, so Chromium's own input pipeline is measured. Clipboard shortcuts don't work that way — use `ipcRenderer.invoke('edit-command', { command: 'paste' })` (spike 004).
- **Pair input events with the newest pending `beforeinput`,** not a FIFO queue: events that produce no document change make a queue drift and report stale timestamps (spike 004).
- **`capturePage(rect)` takes CSS pixels, not device pixels.** A rect starting past the window's height clamps to a sliver at the bottom edge (spike 007).
- **Space scripted keystrokes when a shot must show separate letters.** Letters sit where they were typed, so the delay between keystrokes *is* the gap along the line: at SPEED 1.5, keys typed as fast as `sendInputEvent` allows land 0.015 world units apart and pile into a blob, while a 700 ms gap puts them 1.05 units apart — wider than the ~0.7 units visible at 240 px per em (spike 007).
- **Hold an async pipeline rather than racing it** when a "before" state must be photographed. Spike 007's worker returns a glyph in ~11 ms, so a before/after screenshot taken 120 ms apart photographed the same state twice.
- **Letters are grapheme clusters** (`Intl.Segmenter`), so emoji, flags and combining marks count as one letter (spike 003).
- **Centre zoomed side views within a minute of the render origin,** or float32 positions wobble before the renderer is at fault (spikes 001, 003).
- **Centre a zoomed side view on a specific glyph**, not on a span's midpoint: past about 120 px per em the gap between letters can exceed the visible width, and the camera lands in empty space (spikes 003, 007).

## Tools & Libraries
- **three.js 0.186.0 gotchas:**
  - If any update range exists, only the ranges are uploaded, so a full upload must block new ranges until the next render.
  - `ShaderMaterial` culls back faces, so billboards need `DoubleSide`.
  - A 1-D attribute aliased as `position` needs a manual `boundingSphere`.
  - `write()` in the glyph layer **snapshots** a grapheme's quad, uv and dist into per-instance attributes. Replacing a cell therefore means rewriting every instance that already drew it (spike 007).
- **troika-three-text 0.52.5:** fine for text runs. Don't use one `Text` per letter at scale (002a). The font URL must be absolute and fetchable from a worker.
- **@mapbox/tiny-sdf 2.2.0:** subclass it to force a DOM canvas, so the `FontFace` added to `document.fonts` is visible. Fast (~0.5 ms/glyph) and Unicode-complete, but its field comes from a raster, so edges ripple above ~120 px per em.
- **msdfgen-wasm 1.0.0:** `require` its `dist/cjs/index.js` by absolute path — the ESM build uses extensionless imports a browser can't resolve, and a directory require ignores `exports` when there's no `main`. `loadGlyphs` unloads previously loaded glyphs; bitmaps come back top-row-first. Generation costs ~8 ms per glyph, so it belongs in a Web Worker — which needs `nodeIntegrationInWorker: true` and `sandbox: false`; Electron's own modules are unavailable there, but `fs` and `path` are all it needs (spike 007).
- **One ProseMirror instance, always.** Two copies of `prosemirror-model` make a schema built by one unreadable to the other (`Schema is missing its top node type ('doc')`). Under a bundler, `resolve.dedupe` every ProseMirror package plus react, react-dom and `orderedmap` (spike 005).
- **Fonts:** macOS Verdana served from `/System/Library/Fonts/Supplemental/Verdana.ttf`; never copied into the repo. For broad Unicode from a font file, Arial Unicode (`/System/Library/Fonts/Supplemental/Arial Unicode.ttf`) is the only single-file option — macOS ships CJK faces as `.ttc` collections, which msdfgen-wasm can't read.
- **The page reaches Node modules by absolute path.** Pages are served over HTTP, so `main.cjs` passes the spikes directory in `process.env.TAPESTRY_SPIKES_DIR` before requiring the launcher.
