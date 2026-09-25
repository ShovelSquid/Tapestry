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
