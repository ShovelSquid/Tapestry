# REVIEW — human checks the unattended sessions queued instead of stopping

Answer any item by writing into `autonomy/RESPONSE` (for example
`item 2: approved`, or the issues you saw); the next session acts on it.

## Open

### 1. Phase 01, plan 01-08, Task 2: pen checks inside Tapestry (approved-deferred 2026-09-24)

Resolved per PROTOCOL step 4: 01-08 continued with `approved (deferred to human review, see autonomy/REVIEW.md)`
and its SUMMARY was written (`85a2f06`), with the human sheet marked PENDING. Headless machine evidence recorded in
`data-drawing/.planning/phases/01-painting-with-the-pen/01-08-SUMMARY.md`: `backend=webgpu adapter=apple metal-3`,
`cycles: mounted=21 disposed=20 lost=0`, `replay: MATCH` on both transports, synthetic-mouse latency Worker p50≈16.5
p95≈17 ms vs main-thread p50≈17 p95≈34 ms. Phase verification (`01-VERIFICATION.md`, human_needed) and `01-UAT.md`
carry the same checks. If your answer is not "approved": list the issues; the next session plans gap closure, and
CANV-03, CANV-04 and STRK-02 stay open in REQUIREMENTS.md. Your sheet goes verbatim into 01-08-SUMMARY.md.

Original WAITING text:

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

### 2. Phase 01 verification: pen re-measurement and the mouse default (queued 2026-09-24)

Verification (`01-VERIFICATION.md`) found `plugins/data-drawing/surface/src/input.ts:124` sets
`DEFAULT_SETTINGS.allowMouse` from PEN_FACTS, which was measured with a mouse over streaming, so mouse painting is
ON by default; the 01-06 plan says default false. You accepted this at the 01-06 checkpoint. Nothing was changed.
To check: attach the pen tablet to this Mac, open Data Drawing in Tapestry, press M for the PenMeasure overlay,
draw with the pen and the eraser end, and update PEN_FACTS (pointerType `pen`, pressure range/levels, tilt sign,
twist, eraser buttons). Then `allowMouse` defaults to false. Answer "approved" to keep it as is until then, or ask
for a gap-closure plan.

### 3. Phase 01 verification: nine flagged prohibitions (queued 2026-09-24)

See the "Prohibitions" table in `data-drawing/.planning/phases/01-painting-with-the-pen/01-VERIFICATION.md`. None is
broken by grep, but five have no enforcing test (e.g. no wall clock in the sim; no float/`<random>` in sim tests;
the renderer never special-cases a plugin id) and four rest on judgment. Answer "approved" to accept them, or name
the ones that need a test (e.g. extend `forbidden_tokens.cmake` to scan for chrono/clock/time( in the sim).
Nothing to undo.
