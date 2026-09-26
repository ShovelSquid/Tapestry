# Line Lab v2 behaviour check

Headless check for Part 1 tasks 1, 2, 4, 5 and 6 of `Plan - Line Lab v2`.
`mk.py` wraps `~/Tree/Design/Line Lab/line-lab.src.html` into a test page
with a debug hook (`window.__ll`), a no-op `setPointerCapture` and a
timer-driven `requestAnimationFrame`. Headless Chrome doesn't tick rAF
under `--virtual-time-budget`. `test.js` drives synthetic pointer events and
prints its results into `<pre id="result">`. The hook exists only in the
test page, never in the published file.

    python3 mk.py test.js /tmp/h.html
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
      --disable-gpu --window-size=1280,1400 --virtual-time-budget=20000 \
      --dump-dom file:///tmp/h.html | sed -n '/id="result"/,/<\/pre>/p'

Result on 2026-09-25: defaults show Kaelen's values; the red dot eases back
at most 0.094 per frame; the light drains to the exit point; the pencil band
goes 971 → 682 (early grow) → 1 → 0 pixels as the blue takes over; particles:
start 2, steady 0, gentle curve 0, sharp turn 2 toward (-0.7, 0.7).

## Part 2 app screenshots (`app-shot.cjs`)

`electron autonomy/checks/line-lab-v2/app-shot.cjs <out.png>` (from the repo
root, after `npm --prefix app run build:js`) launches the built app with
`TAPESTRY_USER_DATA_DIR` and `TAPESTRY_SPACE_DIR` pointed at a fresh scratch
folder under `~/Library/Caches/tapestry-shots/` (main only accepts `.tree`
paths under home), removed on exit, so it never opens real data. It points
main's app path at `app/` so the plugins load. `SHOT_SCRIPT` runs JS in the renderer
before the capture (wave 0 used it to click "Save my name").

- `app-wave0-2026-09-25.png`: wave 0 after the token pass. Pixel-identical
  to the same state built from 379c07f (the commit before wave 0).

- Wave 2: `SHOT_SCRIPT="$(cat wave2-setup.js)" SHOT_AFTER_RELOAD="$(cat wave2-pose.js)"`
  makes a scratch tree with three notes (through `window.tapestry`), reloads,
  selects one and hovers another. `wave2-pose-mid.js` with `SHOT_SETTLE_MS=150`
  catches a selection mid-grow and the red dot hovered.
  `app-wave2-2026-09-25.png`, `app-wave2-midgrow-2026-09-25.png`, and
  `wave2-side-by-side-2026-09-25.png` (sketches 0-2 above, the app below).

- Wave 3: `SHOT_SCRIPT="$(cat wave3-setup.js)" SHOT_AFTER_RELOAD="$(cat wave3-pose.js)"`
  edits "Formatting", selects "some", presses `b` in the pill and reads the body
  back from the kernel (`savedBold: true`). Prefix the pose with
  `window.__POSE__='settings';` to select "Settings" and flip it instead.
  `app-wave3-pill-2026-09-25.png`, `app-wave3-settings-2026-09-25.png`, and
  `wave3-side-by-side-2026-09-25.png` (sketch 3, the pill, the settings face).

- Wave 4: `SHOT_SCRIPT="$(cat wave4-setup.js)" SHOT_AFTER_RELOAD="window.__POSE__='drag';$(cat wave4-pose.js)"`
  makes Source → Target, and Left → knot "because" → Right. Poses: `rest`, `drag`
  (the live line and its dot), `land` (with `SHOT_SETTLE_MS=60`, mid green flash),
  and `reopen` (prefix the setup with `window.__STILL__=1;` for motion off): lands
  Source → Right, deselects, records every connection path, reloads and compares
  (`same: true` on 2026-09-25). `app-shot.cjs` now runs a pose a second time when it
  returns `"reload":true`. `app-wave4-{rest,drag,land}-2026-09-25.png` and
  `wave4-side-by-side-2026-09-25.png` (sketch 4, drag, land, rest).

- Wave 5: `SHOT_SCRIPT="$(cat wave5-setup.js)" SHOT_AFTER_RELOAD="$(cat wave5-pose.js)"` makes Garden
  (a container, 704 px wide with its contents) holding Beds (260) and Tap (120), plus Seeds (260) at the top
  level connected to Garden. The pose zooms out with Ctrl+wheel from 100% to the canvas's 10% floor, logging
  every change of form. On 2026-09-25: `monotonic: true` (only note → circle → dot), each handoff at the right
  width (Tap circle at 110 px, dot at 27 px; Seeds/Beds circle at 108 px; Garden circle at 102 px; Seeds dot at
  26 px), and 23 samples with the old form fading out over the new (the crossfade). Then it zooms back to ~29%
  and clicks Seeds' circle (`selectedCircle: true`). Prefix `window.__DBL__=1;` to double-click Beds' circle:
  zoom 29% → 392%, Beds a note again. `app-wave5-forms-2026-09-25.png`,
  `app-wave5-after-dblclick-2026-09-25.png` and `wave5-side-by-side-2026-09-25.png` (Line Lab's circle
  form at 30%, the app at 29%). `wave5-ref.js` is the Line Lab pose (`python3 mk.py wave5-ref.js …`).

- Wave 6: `SHOT_SCRIPT="$(cat wave2-setup.js)" SHOT_AFTER_RELOAD="$(cat wave6-pose.js)" SHOT_SETTLE_MS=60`
  drags, riffles and bobs with motion on, then with the Motion panel's "All off", and prints
  what moved. `app-shot.cjs` now turns off background throttling (a hidden window clamps
  timers to 1 s) and takes `SHOT_TIMEOUT_MS`. Result on 2026-09-25: on, 3 specks,
  rifle 0.62 px, text 0.22 px, both settled; all off, 0 specks, no nudge, **0 animation
  frames** over the whole sequence. `app-wave6-2026-09-25.png` shows the panel open.

- Wave 7 (entering a note): `SHOT_SCRIPT="$(cat wave5-setup.js)" SHOT_AFTER_RELOAD="$(cat wave7-pose.js)"`
  zooms out until "Beds" is a circle, double-clicks it, samples every frame in, then Escape and every
  frame out. Result on 2026-09-25: in 44 → 1020 px and out 1020 → 44 px, both monotonic; 0 frames with
  any form crossfade on any note; 0 frames with the circle and the card both drawn; frame time median
  16.7 ms, p95 ≤ 16.8 ms, none over 25 ms. `window.__TRACE__=1` adds the per-frame zoom:width trace.
  `wave7-card.js` double-clicks a full card at 100% (enters to 392%, no note created) and Escape
  returns to 100%. `wave7-flight-2026-09-25.png`: four runs captured at 0, ~90, ~200 ms and 1.5 s
  (`__MODE__='mid'` with `SHOT_SETTLE_MS`). No sketch exists for entering; the frames were checked
  against spec §7.

- Wave 8 (the screenshot set): `wave8-shoot-all.sh [outdir]` retakes every pose above against the current
  build (10 shots). The side-by-sides with Kaelen's sketches (sketch on the left) are in `wave8/` and in
  `~/Tree/Design/UI Build Review/`, embedded by `~/Tree/Design/UI Build Review.md`. All ten poses passed on
  2026-09-25, after the ws/mergin merge.
