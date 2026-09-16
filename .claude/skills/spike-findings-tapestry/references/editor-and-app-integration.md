# Editor and App Integration

Putting the real ProseMirror typer over a live thread, and the thread over the app's real canvas.

## Requirements

From the `thread-rendering` idea (MANIFEST.md):

- Letters are drawn from ProseMirror transaction steps, not key events, so typing, paste, undo and input methods all flow through one path, independent of the 300 ms save debounce (spike 004)
- Drawing a keystroke costs ~0.3 ms in the editor and lands within one frame at 40 keys/s over 8 h of history (spike 004)
- A large paste arrives as one transaction and lands as one cluster; it can cost a dropped frame only while its glyphs are new (spike 004)
- The thread is a full-window layer over the dimmed canvas, not a child of the canvas's transformed container, so CSS pan/zoom never touches it; the order is notes → scrim → thread → typer (spike 005, D-09)
- D-09's dimming is load-bearing, not decoration: glyphs are drawn near-white, so a thread over the undimmed cream canvas is invisible (spike 005)
- Closing a thread must call `renderer.dispose()` **and** `renderer.forceContextLoss()`; dispose alone holds the context until GC and a browser allows only a handful (spike 005)
- The app and anything drawing thread letters must share one ProseMirror instance; two copies make a schema built by one unreadable to the other (spike 005)
- Thread letters need a per-instance colour channel for D-21's author strands; the shared glyph shader currently hardcodes near-white with no colour uniform (spike 005)

## How to Build It

**Draw letters from `tr.steps`, not from key events.**
In `dispatchTransaction`, walk every step's slice, split its text into graphemes with `Intl.Segmenter`, and place each at the current thread time. One path then covers typing, paste, undo and input-method composition — and it stays independent of the editor's 300 ms save debounce (Phase 2 D-02). Drawing must never wait on saving.

**Mount the thread as a sibling layer over the dimmed canvas.**
`position: fixed`, its own stacking order, outside the canvas's transformed container — so the app's CSS pan/zoom never touches it. The order D-09 specifies is **notes → scrim → thread → typer**. Getting this wrong is silent: with the scrim above the thread, the GL layer (which clears transparent so the canvas shows through) drew near-white letters onto the canvas's cream `#F7F5F0` and vanished, while every counter cheerfully reported 62,474 glyphs loaded.

**Create the renderer when a thread opens; destroy it when it closes.**
```js
renderer.dispose();
renderer.forceContextLoss();   // both — dispose alone holds the context until GC
```
A browser allows only a handful of live contexts, and the Nth open silently stops drawing. With both calls, twenty open/close cycles gave **42 contexts created, 41 disposed, 0 unexpectedly lost**, still drawing afterwards, with memory flat. One context live at the end is correct.

**Keep React 18 StrictMode on.** Its deliberate mount → unmount → remount in development *is* the WebGL context-leak detector: if teardown is wrong, created and disposed diverge. The app already runs it.

**One ProseMirror instance, always.** Under a bundler, `resolve.dedupe` every `prosemirror-*` package plus `react`, `react-dom` and `orderedmap`.

**Measure input latency as input event → painted frame.** `beforeinput` fires before ProseMirror sees the key and its `timeStamp` shares the `performance.now()` time origin, so the chain is: input event → JS handler → transaction → glyph added → painted frame. Drive real input through the main process (`webContents.sendInputEvent`) so Chromium's own pipeline is included; clipboard shortcuts do not work that way — use `webContents.paste()`.

**Pair each transaction with the *newest* pending `beforeinput`,** counting and dropping the rest. `beforeinput` also fires for events that produce no document change, so a FIFO queue drifts silently: spike 004's first run reported a 12.4 ms median against an impossible 685 ms p95 for input that looked instant. Corrected, it reports 0 unpaired events and a max inside one frame.

## What to Avoid

- **Copying app components into a spike or a test harness.** That tests a replica — the one thing an integration check exists to rule out. Compile the real TSX in place with a Vite dev server (`server.fs.allow` the workspace) instead.
- **Bundling a second copy of ProseMirror.** Identical versions, two module instances, and `Uncaught RangeError: Schema is missing its top node type ('doc')`. Any thread plugin, worker or embedded editor shares the app's instance.
- **Attributing the app's own costs to the thread.** Spike 005's first benchmark showed a 116.6 ms worst frame while zooming with the thread open and had no canvas-only zoom row — so the thread looked guilty. The baseline showed **the app's own CSS-transform zoom drops 0.4 % of frames at a 50.0 ms worst frame with no thread on screen at all**, and the same zoom with the thread open was *better* (34.1 ms). Every stressed phase needs a matching baseline phase.
- **Letting an async scripted step's rejection go unreported.** Electron does not surface unhandled rejections as console messages, so the run idles silently until the timeout. Forward both `error` and `unhandledrejection` through `console.error`, and keep scripted timeouts short (~120 s) so a hang costs seconds to diagnose.
- **Assuming a white-on-transparent glyph layer is visible.** It is legible only because D-09 dims the canvas behind it. Either keep the dimming or choose an ink colour against the canvas.

## Constraints

- **ProseMirror versions matching `app/`:** view 1.42.3, state 1.4.4, model 1.25.11, transform 1.12.1, keymap 1.2.3, commands 1.7.2, history 1.5.0, schema-basic 1.2.4.
- **Measured latency** (real Chromium key events, browser-SDF glyphs): key → painted **8.7–9.1 ms median, 15.6–15.9 p95, 16.9 ms max** at 20 keys/s, and 7.4–8.3 ms median at 40 keys/s, over both an empty thread and 8 h of history (62 k letters). The browser-to-handler delay was at most 0.1 ms in every phase — the latency above is display timing, not lost time. Transaction apply is **0.30 ms median**.
- **A 2000-character paste applies in 2.6–3.2 ms as one cluster.** The single dropped frame ever recorded (33.4 ms, 1.1 %) was on a *cold* atlas; with the atlas warm the same paste dropped nothing. A programmatic paste records no `beforeinput`, so only the transaction's own work is timed.
- **In the real app:** 59.9 fps and 0 dropped frames in every phase — idle, pan, typing at 20/s — matching the canvas-only baseline, at 84–100 MB.
- **The app is an npm workspace.** `app/node_modules` is empty; electron, vite, react, react-dom, `@vitejs/plugin-react`, typescript and every ProseMirror package hoist to the repo root. Code that needs them adds no dependency and edits no `package.json`.
- **Chromium logs `SharedImageManager::ProduceOverlay … non-existent mailbox`** during rapid WebGL context churn (21 times over twenty open/close cycles). Nothing was lost and rendering survived, but the compositor dislikes it — worth remembering if thread opening is ever animated or previewed.
- **The glyph shader hardcodes `gl_FragColor = vec4(0.95, 0.96, 1.0, alpha)`** with no colour uniform and no per-instance colour channel. D-21's author strands need that channel added first.
- Untested: input-method composition by hand (spike 004 has an open verification checkpoint for Kaelen), a hand paste's end-to-end latency, the real kernel and IPC (spike 005 stubs `window.tapestry` and never commits), the app's actual security posture (`contextIsolation` and `sandbox` on, which the spike turns off for `ipcRenderer`), a thread placed at world coordinates inside the transformed container rather than as a full-window overlay, and 120 Hz displays.

## Origin

Synthesized from spikes: 004 (VALIDATED), 005 (VALIDATED).
Source files available in: `sources/004-typer-over-live-thread/`, `sources/005-thread-in-real-app/`
