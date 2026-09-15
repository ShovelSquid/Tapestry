# Spike Conventions

Patterns and stack choices established across spike sessions. New spikes follow these unless the question requires otherwise.

## Stack
- **Runtime:** the repo's Electron (`node_modules/.bin/electron`, 32.3.3 / Chromium 128), not a plain browser, so the GPU path and throttling match the app (Kaelen, 2026-09-15).
- **Rendering:** three.js 0.186.0, loaded as ES modules through an import map. No bundler.
- **Dependencies:** one shared `.planning/spikes/package.json` (three, troika-three-text); `node_modules` is gitignored. Run `cd .planning/spikes && npm install` once.

## Structure
- `NNN-name/` holds `main.cjs` (Electron launcher), `index.html`, the page script and `README.md`. Comparison spikes share code in `NNN-shared/`.
- `results/` holds benchmark JSON (`bench-*.json`), screenshot logs and `results/shots/*.png`. Results are committed as evidence.
- When a page needs to fetch (fonts in workers, for example), the launcher serves `.planning/spikes` over `http://127.0.0.1:<random port>` from the Electron main process (see `002-shared/launch.cjs`).

## Patterns
- **Three modes per spike:** interactive (default), `--bench` (scripted benchmark, prints a table, writes JSON, quits) and `--shots` (scripted screenshots, full window resized to 1400 px plus device-resolution crops, quits).
- **Scripted runs open with `showInactive()` and ignore real input.** Otherwise keystrokes meant for another app land in the spike and change what's measured (spike 001).
- **Measure frame intervals from `requestAnimationFrame`**, reporting median fps, p95/p99 and the share of frames over 25 ms. **`gl.finish()` does not measure GPU time in Chromium** (spike 001).
- **Always screenshot and look before trusting a benchmark.** Spike 001's first benchmark measured a thread whose line was culled and whose history never reached the GPU.
- **Synthetic history:** seeded `mulberry32(7)` sessions of 2–15 min, 1–20 min away, typing bursts of 5–40 s at 3–8 keys/s. Loads are 1 h and 8 h continuous (1.73 M dots, 78 k letters).
- **Forward page errors** to the terminal (`console-message` level ≥ 2) and exit with a timeout.

## Tools & Libraries
- **three.js 0.186.0 gotchas:**
  - If any update range exists, only the ranges are uploaded, so a full upload must block new ranges until the next render.
  - `ShaderMaterial` culls back faces, so billboards need `DoubleSide`.
  - A 1-D attribute aliased as `position` needs a manual `boundingSphere`.
- **troika-three-text 0.52.5:** fine for text runs. Don't use one `Text` per letter at scale (002a). The font URL must be absolute and fetchable from a worker.
- **Fonts:** macOS Verdana served from `/System/Library/Fonts/Supplemental/Verdana.ttf`; never copied into the repo.
