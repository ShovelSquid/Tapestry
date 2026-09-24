# REVIEW — human checks the unattended sessions queued instead of stopping

Answer any item by writing into `autonomy/RESPONSE` (for example
`item 2: approved`, or the issues you saw); the next session acts on it.

## Open

### 1. Moved from autonomy/WAITING (not yet resolved; the next session resolves it per PROTOCOL step 4)

WAITING: Phase 01 (Painting with the Pen), plan 01-08, Task 2
checkpoint:human-verify (blocking): feel, replay, latency, backend and lifetime inside Tapestry with the pen

Ready as of 2026-09-24 13:00:
- Wasm rebuilt, surface built, all suites green: native-debug/release/ubsan ctest 75/75 each,
  plugin Vitest 90/90, app Vitest 443/443, typecheck and source gates clean.
- Tapestry is running from this worktree (`npm --prefix app run dev`, log in /tmp/dd-app-dev.log).
  If the window is gone, restart it from the repo root with:
    npm --prefix plugins/data-drawing run build && npm --prefix app run dev

Do this with the pressure pen in the running Tapestry window (a mouse works too, but the pen feel is the point;
note which you used):
 1. Click "Open Data Drawing". Copy the panel's first line: `backend=... adapter=...`.
    (backend=webgl2 with adapter=n/a means WebGPU is absent under Electron 32 here; that is a finding, not a failure.)
 2. Preset `ink` (v1): draw a fast S-curve. Expected: nodes land close under the pen; the body disc stays near the
    pen ring; the spring line is short.
 3. Preset `lead` (v4): the same S-curve at the same speed. Expected: the body disc visibly trails the pen ring, the
    spring stretches, the node trail cuts the corners of the S; after you stop, the body drifts on and settles.
 4. Presets `rust` (v2) and `clay` (v3): one stroke each. Expected: lag between ink and lead; each has its own colour.
 5. Pressure: with `ink`, one stroke from feather-light to full pressure. Expected: discs grow from small to full.
 6. Overlap: draw a `lead` stroke across an earlier `ink` stroke. Expected: the later stroke is on top.
 7. Edit a brush: select `ink`, set mass to 8, click "Save as new version". Expected: the select shows `v5 ink m=8`;
    v5 lags more than v1; earlier v1 strokes are unchanged.
 8. Click "Verify replay". Expected: `replay: MATCH (tick N, nodes M)`.
 9. After your last stroke with the Worker transport read `latency p50=<a> p95=<b>`. Tick "main-thread transport",
    draw one more stroke, read `p50=<c> p95=<d>`. Copy all four numbers.
10. Close the surface (Escape) and reopen it, 20 times. Expected: it still paints on the 20th open, and DevTools
    Console has no warning containing "Too many active WebGL contexts".
11. Optional: M still toggles the measurement overlay.

How to answer: paste the backend/adapter line; one sentence each for steps 2, 3, 5, 6, 7 ("as expected" or what
differed); the replay line; the four latency numbers; "20 opens OK" or the failure. Write "approved" if steps 2, 3,
7 and 8 matched expectations (phase success criteria 1, 4 and 5); otherwise list the issues.

When done, write your answer (`approved`, or the issues you saw) into `autonomy/RESPONSE`, delete this file, and rerun `autonomy/run.sh`.
