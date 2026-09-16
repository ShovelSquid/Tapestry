---
spike: 005
idea: thread-rendering
name: thread-in-real-app
type: standard
validates: "Given the app's own React canvas with real NoteCards, when a WebGL thread layer and the typer open over it with the canvas dimmed (D-09), then the thread holds 60 fps, the canvas stays pannable and editable, and opening/closing the thread leaks no GL context"
verdict: PENDING
related: [001, 003a, 004]
tags: [electron, react, webgl, integration, vite]
---

# Spike 005: The Thread Inside the Real App

## What This Validates

**Given** the app's actual renderer components — `app/src/renderer/components/Canvas.tsx`,
`NoteCard.tsx` and `App.css`, imported from the source tree rather than copied — running in
the repo's Electron on Kaelen's M4 MacBook Air,
**when** a WebGL thread layer and the ProseMirror typer open over a canvas of real notes, with
the canvas dimmed behind them (D-09), and the canvas is panned, zoomed and typed into,
**then** the thread holds 60 fps, the notes stay interactive, and opening and closing the
thread releases every WebGL context it took.

Spikes 001–004 all ran in a clean-room page: a bare dark window whose only content was the
thread. This is the first spike that puts the thread inside the application it is for. Nothing
in `app/` is modified — the page supplies the props `App.tsx` would normally supply, so the
components run exactly as they ship.

## Research

- **The app is an npm workspace.** `app/node_modules` is empty; `react`, `react-dom`, `vite`,
  `@vitejs/plugin-react`, `electron` and every ProseMirror package are hoisted to the repo
  root. So this spike needs no install and edits no `package.json` — which also keeps it clear
  of Phase 2.2's plans, which change `app/package.json` while another session executes them.
- **A bundler is unavoidable here, and it is a deviation from CONVENTIONS** ("three.js … loaded
  as ES modules through an import map. No bundler."). The app is written in TSX and no browser
  loads it unchanged. The alternative — copying the components into the spike — would test a
  replica, which is the one thing this spike exists to rule out. Vite's dev server compiles the
  real files in place.

| Approach | Mechanism | Pros | Cons | Status |
|---|---|---|---|---|
| **Spike-local Vite dev server** | `createServer` from the root install, `server.fs.allow` the workspace | Compiles the app's real TSX unchanged; no install; fast reload | First spike with a bundler | **Chosen** |
| Copy components into the spike | Duplicate Canvas/NoteCard as plain JS | Keeps the import-map convention | Tests a replica, not the app | Rejected |
| Add a thread layer inside `app/` | Patch the real renderer | Most faithful | Collides with the executor running in `app/` | Rejected |

- **React 18 StrictMode is kept on**, exactly as `app/src/renderer/main.tsx` has it. StrictMode
  deliberately mounts, unmounts and remounts every component once in development, which is
  precisely the WebGL-context leak detector this spike wants: if the cleanup is wrong, contexts
  created and disposed diverge. ([React](https://react.dev/reference/react/StrictMode),
  [react-three-fiber discussion](https://github.com/pmndrs/react-three-fiber/discussions/723))
- **`server.fs.allow`** is what lets a Vite root serve source from outside itself; the repo
  being a workspace means the root is found automatically.
  ([Vite server options](https://vite.dev/config/server-options))

## How to Run

From the repo root:

```sh
node_modules/.bin/electron .planning/spikes/005-thread-in-real-app/main.cjs           # interactive: Ctrl+T opens/closes the thread, drag to pan, pinch to zoom, double-click for a note
node_modules/.bin/electron .planning/spikes/005-thread-in-real-app/main.cjs --shots   # canvas-only and thread-open screenshots
node_modules/.bin/electron .planning/spikes/005-thread-in-real-app/main.cjs --bench   # baseline, thread open, pan, zoom, typing, and twenty open/close cycles
```

No `npm install` is needed for this spike beyond the one CONVENTIONS already describes
(`cd .planning/spikes && npm install`), because react and vite come from the workspace root.

## What to Expect

The app's real canvas with twelve notes, in its own typography and colours. Ctrl+T dims the
canvas and runs the thread into the distance beneath a dark typer panel; typing puts letters on
the line. The HUD reports frame rate and the running count of WebGL contexts created, disposed,
deliberately released and unexpectedly lost.

## Observability

The HUD carries live fps, p95 frame time, glyph and atlas counts, and GL context accounting.
`contexts.forced` counts the context losses this code causes on purpose when a thread closes;
`contexts.lost` counts only unexpected ones — the number that means a leak, since a browser
allows only a handful of live contexts and the Nth open silently stops drawing once exceeded.
`--bench` writes every phase to `results/bench-*.json`; `--shots` writes `results/shots-*.json`
alongside the screenshots.

## Investigation Trail

1. **`app/node_modules` is empty**, which first looked like the app could not be launched at
   all. It is an npm workspace: everything is hoisted to the repo root, including the
   `node_modules/.bin/electron` every earlier spike's README already invokes.
2. **The first run hung for over 400 s and printed nothing.** The launcher sat out its 600 s
   timeout — spike 003b's failure mode, but with the log empty rather than buffered. Added
   `error` and `unhandledrejection` forwarding through `console.error` (which the launcher
   already relays at level ≥ 2), a guard that waits for React to mount before the scripted
   runner drives it, and a much shorter scripted timeout. **An async scripted step that throws
   becomes an unhandled rejection, and Electron does not surface those as console messages.**
3. **The real cause was two copies of ProseMirror.** `Uncaught RangeError: Schema is missing
   its top node type ('doc')`. The app's components resolve `prosemirror-*` upward to the
   workspace root; this spike's modules resolve the same packages to
   `.planning/spikes/node_modules`. Identical versions, two module instances — and a schema
   built by one instance is unreadable to the other. Fixed with `resolve.dedupe` over every
   ProseMirror package plus react, react-dom and `orderedmap`.
4. **Then the notes rendered perfectly and the thread was invisible** — one faint diagonal and a
   single glyph smudge, while every counter reported 62,474 glyphs loaded. This is spike 001's
   trap exactly: geometry present, nothing on screen, frame rate meaningless.
5. **The first hypothesis was wrong.** Glyph quads left edge-on to the camera would look like
   this, so `setOrientation` was the suspect — but `glyph-layer.js` already defaults `uTheta` to
   `Math.PI`, the live-camera orientation. Checking beat assuming.
6. **The cause was CSS layering, and it was mine.** `#thread-gl` sat at `z-index: 0` with the
   dim scrim above it at `z-index: 1`, so the scrim covered the thread instead of sitting behind
   it — and because the GL layer clears transparent so the canvas shows through, the glyph
   shader was drawing **white letters onto the canvas's cream `#F7F5F0`**. Spike 004 never hit
   this because it clears to `#0d0f14`. D-09 states the correct order outright: the canvas dims
   *behind* the line. Restacked as notes → scrim → thread → typer.
7. **Verified against known-good evidence rather than judgement.** The corrected frame still
   looked wrong to the eye — a tight diagonal clump of letters rather than a line running away
   into depth. Spike 004 uses the same camera, speed, scene and glyph layer, and its committed
   screenshot shows the same picture: same streak, same position, same faint axis to the corner,
   62,486 glyphs against this spike's 62,474 and atlas 662 against 663. **The render is correct;
   that clump is what the live view looks like at this camera distance and glyph scale.**

## Results

**Verdict: VALIDATED.** The thread costs nothing measurable inside the app's real canvas, the
notes stay interactive, and opening and closing a thread releases every context it took.

Benchmark (`results/bench-2026-09-16T04-24-42-713Z.json`; frame intervals, 4 s per row, real
Chromium input through `sendInputEvent`):

| Phase | fps | p95 | worst frame | dropped | private memory | GL created/disposed/lost |
|---|---|---|---|---|---|---|
| canvas-only idle | 59.9 | 17.3 ms | 17.7 ms | 0 % | 99 MB | 0/0/0 |
| canvas-only pan | 59.9 | 17.2 ms | 17.7 ms | 0 % | 99 MB | 0/0/0 |
| canvas-only zoom | 59.9 | 17.2 ms | **50.0 ms** | **0.4 %** | 99 MB | 0/0/0 |
| thread open, idle | 59.9 | 17.3 ms | 17.7 ms | 0 % | 100 MB | 2/1/0 |
| thread open, pan | 59.9 | 17.3 ms | 17.6 ms | 0 % | 100 MB | 2/1/0 |
| thread open, zoom | 59.9 | 17.3 ms | **34.1 ms** | **0.4 %** | 99 MB | 2/1/0 |
| thread open, typing 20/s | 59.9 | 17.1 ms | 17.6 ms | 0 % | 84 MB | 2/1/0 |
| after 20 open/close cycles | 59.9 | 17.4 ms | 17.7 ms | 0 % | 90 MB | 44/43/0 |

**Twenty open/close cycles: 42 contexts created, 41 disposed, 0 unexpectedly lost, still
drawing afterwards, 62,431 glyphs rebuilt.** One context is live at the end, which is correct.

**The zoom hitch is the app's, not the thread's.** The first benchmark measured a 116.6 ms worst
frame and 1.3 % drops during zoom and had no canvas-only zoom row to compare against — so the
thread looked guilty. Adding that baseline showed the app's own CSS-transform zoom drops **0.4 %
of frames at a 50.0 ms worst frame with no thread on screen at all**, and the same zoom with the
thread open was *better* (34.1 ms, 0.4 %). The 116.6 ms figure was a one-off first-time
compositor stall. **Every thread-open phase should have a matching baseline phase, or the app's
pre-existing costs get attributed to the thread.**

**Chromium logs `SharedImageManager::ProduceOverlay … non-existent mailbox` and `Invalid
mailbox`** — 21 times in this run — during rapid WebGL context churn. Nothing lost a context and
rendering survived, but the compositor clearly dislikes creating and destroying contexts twenty
times in a few seconds. A real app opens threads far more slowly; worth remembering if thread
opening is ever animated or previewed.

**Signal for the build (Phase 2.3):**
- **Mount the thread as a sibling layer over the dimmed canvas**, not inside the canvas's
  transformed container: the WebGL layer is `position: fixed` with its own stacking order, so
  the app's CSS pan/zoom never touches it. Order is notes → scrim → thread → typer (D-09).
- **Create the renderer when a thread opens and destroy it when it closes**, with
  `renderer.dispose()` *and* `renderer.forceContextLoss()`. dispose alone leaves the context
  alive until GC, and a browser allows only a handful — the Nth open would silently stop drawing.
  With both, twenty cycles leak nothing and memory does not grow.
- **React 18 StrictMode is safe** and is worth keeping: its deliberate double mount is what
  proves the teardown works. The app already runs it.
- **One ProseMirror instance, always.** Two copies of `prosemirror-model` make a schema built by
  one unreadable to the other (`Schema is missing its top node type ('doc')`). Any thread plugin,
  worker or embedded editor must share the app's instance, not bundle its own.
- **The app's zoom already drops ~0.4 % of frames.** If 2.3 wants a perfectly smooth zoom, that
  is a pre-existing canvas fix, independent of threads.
- **Not tested:** the real kernel and IPC (this page stubs `window.tapestry` and never commits),
  a real `.tree` world, the app's actual security posture (`contextIsolation` and `sandbox` on,
  which this spike turns off for `ipcRenderer`), placing a thread at world coordinates inside the
  transformed container rather than as a full-window overlay, and 120 Hz displays.

### Findings already fixed by evidence

- **The glyph shader hardcodes its colour**: `gl_FragColor = vec4(0.95, 0.96, 1.0, alpha)`,
  with no colour uniform and no per-instance colour channel. D-21 needs each author's letters in
  their own colour, so the shared glyph layer needs a per-instance colour attribute before two
  strands can be told apart. Not a blocker for 005; a concrete requirement for 010 and the build.
- **A transparent GL layer over a light canvas needs a dark backdrop** for white glyphs, or an
  ink colour chosen against the canvas. D-09's dimming is what makes the current scheme legible,
  which means the dimming is load-bearing, not decoration.
