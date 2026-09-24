---
phase: 01-painting-with-the-pen
plan: 08
subsystem: surface-verification
tags: [replay-from-zero, sim-driver, main-thread-transport, worker-transport, latency, webgpu, webgl2, cycles, lifetime, vitest, dev-page, human-verify-deferred]

# Dependency graph
requires:
  - phase: 01-07
    provides: "the stage (createStage, backendInfo, idempotent dispose), NodeField, CursorOverlay, BrushTable/PRESETS, the TS stroke encoder, the Worker as stamping recorder, the dev page and window.__dd"
  - phase: 01-04
    provides: "the surface mounted in Tapestry through the CANV-04 SurfaceContribution over tapestry-plugin://, the blob-trampoline Worker spawn"
provides:
  - "sim-driver.ts: the single stepping / stamping / recording implementation shared by the Worker and the main-thread transport (accumulator fed the clock as an argument, whole ticks only, hash ring every 60 ticks, restore(log, tick), replayFromZero reporting firstDiffTick and never reconciling)"
  - "sim-host.ts: SimHost gains kind / onStrokeApplied / replayFromZero; WorkerTransport and MainThreadTransport behind one interface; createTransport with a RestorePoint so a transport switch is itself a replay of the log"
  - "sim.worker.ts: a thin message shell around SimDriver with a replay message"
  - "replay.ts: verifyReplay / formatReplayLine -> 'replay: MATCH (tick N, nodes M)' | 'replay: DIFF at tick K'"
  - "latency.ts: LatencyMeter (sent at t0, applied at tick T, painted at the first frame after a snapshot with tick > T), per-stroke p50 / p95 / max"
  - "main.ts panel lines: backend=<webgpu|webgl2> adapter=<...>, transport=<worker|main>, latency, replay, tick/nodes/hash; Verify replay button; main-thread transport checkbox"
  - "dev-host.ts / index.html: ?transport=main, ?webgl=1 passthrough, ?cycles=N harness printing 'cycles: mounted=<n> disposed=<n> lost=<n>'"
  - "test/replay.test.ts (6 cases) and test/latency.test.ts (3 cases): 90 plugin Vitest cases green"
affects: [phase-01-verification, phase-2-grammar, phase-3-timeline]

# Actuals (#2632) — chars/4 over the realized diff of the plan's code commit (git diff 2e390c6 971b871 = 94592 chars).
# commits: the plan's own commits since the ledger base, measured with
#   git log --oneline 2e390c6..HEAD --grep '(01-08)'  -> 1 (971b871) before this docs commit.
# The raw `git rev-list --count 2e390c6..HEAD` is 63 because merge 794eaae brought the main line
# (Phases 2.2 / 2.4 / 2.5 and quick tasks) and the autonomy driver commits in between; none of those belong to 01-08.
actuals:
  tokens: 23648
  tasks: 2
  commits: 1
plan_head_before: 2e390c66c0ab7e8ea00e15c3c98440037ac8242c

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One SimDriver module is the only place ticks are stepped, samples stamped and actions recorded; both transports import it, so there is exactly one recording implementation"
    - "The wall clock only decides how many whole ticks to run; it is passed into the accumulator as an argument and never reaches the encoder (ddsim-abi.ts has no performance.now / Date.now)"
    - "Replay-from-zero runs in a second dd_create(seed) instance, compares against a ring of live hashes taken every 60 ticks, reports the first differing tick, then destroys the instance; a DIFF is shown, never reconciled"
    - "Switching transports disposes the old host and replays the recorded log into the new one, so every switch is itself a replay"
    - "Latency is measured event -> painted frame on the main thread (performance.now, left of the fence, never recorded)"

key-files:
  created:
    - plugins/data-drawing/surface/src/sim-driver.ts
    - plugins/data-drawing/surface/src/replay.ts
    - plugins/data-drawing/surface/src/latency.ts
    - plugins/data-drawing/surface/test/replay.test.ts
    - plugins/data-drawing/surface/test/latency.test.ts
  modified:
    - plugins/data-drawing/tsconfig.json
    - plugins/data-drawing/surface/src/sim-host.ts
    - plugins/data-drawing/surface/src/sim.worker.ts
    - plugins/data-drawing/surface/src/main.ts
    - plugins/data-drawing/surface/src/dev-host.ts
    - plugins/data-drawing/surface/src/input.ts
    - plugins/data-drawing/surface/index.html

key-decisions:
  - "sim-driver.ts added (the plan allowed it): one stepping/stamping/recording implementation shared by the Worker and MainThreadTransport"
  - "Task 2 (checkpoint:human-verify, gate blocking) approved-deferred under the autonomy protocol: the pen checks inside Tapestry are queued as item 1 in autonomy/REVIEW.md; the human's sheet will be appended to this SUMMARY"
  - "Only SIM-03 is marked complete after this plan: its truths (Worker Wasm through the flat C ABI, copies only, replay equality, source gates) are machine-verified; CANV-03, CANV-04 and STRK-02 stay open until the human's sheet confirms the Tapestry-window truths (feel, overlap order, mount through the launcher)"
  - "WebGPU is present in headless Chromium on this Mac (adapter 'apple metal-3'), so the default stays WebGPU with forceWebGL only via ?webgl=1; whether Electron 32 inside Tapestry also exposes it is step 1 of the human sheet"

patterns-established:
  - "Headless dev-page measurement: node <browser-automation>/browser.mjs http://localhost:<port>/?cycles=20 | ?webgl=1 | ?transport=main with a patchright script that drags the mouse, clicks Verify replay and reads the panel lines"

requirements-completed: [SIM-03]

coverage:
  - id: D1
    description: "Live equals replay: replaying the recorded log from tick zero in a fresh sim instance reproduces the live hash and node count at the current tick"
    requirement: SIM-03
    verification:
      - kind: unit
        ref: "plugins/data-drawing/surface/test/replay.test.ts (6 cases: MATCH at 300 and every multiple of 60; DIFF located (mutated action at tick 10 -> firstDiffTick 60); rejected action reported at its tick; restore equality incl. mid-stroke stamping; accumulator clamp)"
        status: pass
      - kind: automated_ui
        ref: "headless dev page, Verify replay after mouse strokes: MATCH (tick 437/440/438/439, nodes 924) on the first transport and MATCH (tick 913/908/909, nodes 1848) after a transport switch, on WebGPU and forced WebGL 2"
        status: pass
      - kind: manual_procedural
        ref: "autonomy/REVIEW.md item 1 step 8 (Verify replay inside Tapestry)"
        status: pending
    human_judgment: false
  - id: D2
    description: "Pen-to-ink latency measured with the Worker transport and the main-thread transport over the same interface, p50/p95 recorded"
    verification:
      - kind: automated_ui
        ref: "headless dev page, synthetic mouse, 61-sample strokes at 16 ms per move (table below)"
        status: pass
      - kind: manual_procedural
        ref: "autonomy/REVIEW.md item 1 step 9 (pen, inside Tapestry)"
        status: pending
    human_judgment: true
    rationale: "The roadmap asks for the pen inside the Electron window; the headless numbers measure the mechanism, not the pen"
  - id: D3
    description: "20 open/close cycles leave the surface rendering, mounts = disposes + 1, no 'Too many active WebGL contexts', worker terminated each time"
    verification:
      - kind: automated_ui
        ref: "headless dev page ?cycles=20: 'cycles: mounted=21 disposed=20 lost=0' (WebGPU) and 'lost=20' (?webgl=1, one forced loss per dispose); 1 canvas left; tick advancing 97 -> 157 after the final mount; zero console warnings"
        status: pass
      - kind: manual_procedural
        ref: "autonomy/REVIEW.md item 1 step 10 (20 opens inside Tapestry)"
        status: pending
    human_judgment: false
  - id: D4
    description: "Renderer backend and GPU adapter shown in the panel and recorded"
    verification:
      - kind: automated_ui
        ref: "headless dev page: 'backend=webgpu adapter=apple metal-3'; ?webgl=1: 'backend=webgl2 adapter=apple metal-3 (forced webgl)'"
        status: pass
      - kind: manual_procedural
        ref: "autonomy/REVIEW.md item 1 step 1 (backend line inside Tapestry / Electron 32)"
        status: pending
    human_judgment: false
  - id: D5
    description: "Surface code imports only three, its own files and @tapestry/sdk types; no Electron API, no SharedArrayBuffer, no window.tapestry; HEAPU8 used only for slice copies and the action-byte copy-in"
    requirement: SIM-03
    verification:
      - kind: other
        ref: "plan's negated grep gate clean; HEAPU8 hits: sim-driver.ts:168/171/394 slice, :382 set (copy-in), ddsim-abi.ts:57 type field; no performance.now / Date.now in ddsim-abi.ts; performance.now x3 in latency.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Feel inside Tapestry with the pen: pressure drives node size; lead lags with momentum; ink follows; overlapping strokes composite later-on-top; a brush edit creates v5 and leaves v1 strokes unchanged"
    requirement: [STRK-02, CANV-03, CANV-04]
    verification:
      - kind: manual_procedural
        ref: "autonomy/REVIEW.md item 1 steps 2-7"
        status: pending
    human_judgment: true
    rationale: "Phase success criteria 1 and 4 are about feel with a real pen in the Tapestry window; queued for Kaelen"

# Metrics
duration: 4min (continuation: re-verification, headless dev-page measurements, SUMMARY); Task 1 was committed earlier on 2026-09-24
completed: 2026-09-24
status: complete
---

# Phase 01 Plan 08: Replay From Zero, Two Transports, Latency and Lifetime — Summary

**The live Worker sim and a fresh replay of its recorded log agree hash-for-hash (Vitest in Node and Verify replay in the dev page, on both transports and both backends); a main-thread transport shares the Worker's one SimDriver behind the same SimHost interface; a pen-to-ink latency meter, a backend/adapter line and a `?cycles=N` lifetime harness are in the panel. Twenty mount/dispose cycles headless leave one canvas, still ticking, with no warnings. The pen checks inside Tapestry are queued for Kaelen and not yet answered.**

## Performance

- **Duration:** Task 1 committed earlier on 2026-09-24 (`971b871`); this continuation 2026-09-24T22:17:25Z to about 22:22Z
- **Tasks:** 2 (Task 1 auto, committed; Task 2 checkpoint:human-verify, approved-deferred)
- **Files modified:** 12 in `971b871` (5 created, 7 modified)

## Accomplishments

- SIM-03 / replay: `SimDriver.replayFromZero` builds a second `dd_create(seed)`, applies the log tick by tick, compares with the live hash ring every 60 ticks, reports `firstDiffTick`, destroys the instance. The Worker and the main-thread transport both run it. It never corrects the live state.
- Two transports: `WorkerTransport` (default) and `MainThreadTransport` (same `ddsim.mjs`, driven by `requestAnimationFrame`) implement one `SimHost`. The panel checkbox or `?transport=main` switches between them, and a switch replays the log into the new transport (`continued from tick 444, 193 actions replayed`).
- Latency: `LatencyMeter` stamps each sample when it is sent, binds it to the tick the host applied it at, and counts it as painted on the first frame after a snapshot past that tick. The panel shows p50, p95, max and n for the last stroke.
- Backend: the panel's first line comes from `stage.backendInfo()` plus the `navigator.gpu` adapter description (`@webgpu/types` added to `tsconfig.json`).
- Lifetime: `?cycles=N` mounts, waits for the stage, waits 250 ms, disposes, repeats N times, mounts once more and prints the counts.

## Task Commits

1. **Task 1: Replay-from-zero verification, main-thread transport, latency meter, cycles harness, backend report**: `971b871` (feat)
2. **Task 2: Feel, replay, latency, backend and lifetime verification inside Tapestry with the pen**: no code commit. Approved-deferred (see below)

**Plan metadata:** the final `docs(01-08)` commit.

## Human verification sheet (Task 2): PENDING

> **PENDING.** Task 2 is a `checkpoint:human-verify` (gate `blocking`). It was approved-deferred under the autonomy protocol. The response recorded for this run was, verbatim:
>
> `approved (deferred to human review, see autonomy/REVIEW.md)`
>
> Kaelen has **not** done the pen checks yet. The 11 steps are queued as **item 1 in `autonomy/REVIEW.md`**, with the expected results and how to answer. When Kaelen answers, his sheet goes into this section verbatim: the backend/adapter line, steps 2, 3, 5, 6 and 7, the replay line, the four latency numbers and "20 opens OK". It then decides CANV-03, CANV-04 and STRK-02.

What is still open for Kaelen (nothing below has been observed with the pen or inside the Electron window):

| Step | Needs | Machine proxy already recorded |
|---|---|---|
| 1 backend/adapter inside Tapestry (Electron 32) | the panel line in the Tapestry window | headless Chromium: `backend=webgpu adapter=apple metal-3` |
| 2 / 3 / 4 ink vs lead vs rust/clay feel | the pen | 01-07 headless lead gap 14.2 / 12.4 / 11.6 units; ink dead-beat |
| 5 pressure -> disc size | the pen (the mouse gives a constant 0.5) | none |
| 6 overlap: later stroke on top | eyes | 01-07 unit test of the material rules (no depth write) |
| 7 edit -> v5, v1 strokes unchanged | the Tapestry window | 01-07 dev page: v5 created, v1..v4 unchanged |
| 8 Verify replay inside Tapestry | the Tapestry window | dev page MATCH on both transports and both backends (below) |
| 9 four latency numbers with the pen | the pen | headless mouse numbers (below) |
| 10 20 opens in Tapestry, no "Too many active WebGL contexts" | the Tapestry window | dev page `?cycles=20` (below) |

## Cycles line

**Inside Tapestry: PENDING (human, step 10).** Measured on the dev page, headless Chromium through patchright on this Mac, `http://localhost:5188/?cycles=20`:

| Backend | Line | After the final mount |
|---|---|---|
| WebGPU (default) | `cycles: mounted=21 disposed=20 lost=0` | 1 canvas; tick 97 -> 157 over 1 s (still running); state line `tick=157 nodes=0 hash=5d84a718…`; 0 console errors or warnings; 0 failed requests |
| WebGL 2 (`?webgl=1`) | `cycles: mounted=21 disposed=20 lost=20` | 1 canvas; tick 97 -> 157; 0 console errors or warnings (so no "Too many active WebGL contexts"); 0 failed requests |

`lost=0` on WebGPU is expected: that backend fires no `webglcontextlost`. `lost=20` on WebGL 2 means each dispose forced exactly one context loss through `WEBGL_lose_context`.

## Transport latency comparison

**With the pen inside Tapestry: PENDING (human, step 9).** Measured on the dev page, headless Chromium, **synthetic mouse**: one `mouse.move` every 16 ms, 61 samples per stroke, three strokes per transport. Each line is the panel's `(last stroke)` value after that stroke. These numbers measure the pipeline (event -> tick -> snapshot -> painted frame) under a 60 Hz tick and a headless compositor. They do not measure pen-to-ink latency on screen.

| Run | Transport | Stroke 1 p50 / p95 / max | Stroke 2 | Stroke 3 |
|---|---|---|---|---|
| WebGPU, start Worker | worker | 16.6 / 17.2 / 23.8 ms | 16.8 / 17.5 / 30.7 | 16.7 / 17.4 / 32.2 |
| same page, switched | main | 17.0 / 34.5 / 48.5 | 17.0 / 34.0 / 35.5 | 17.1 / 34.9 / 35.6 |
| WebGL 2, start Worker | worker | 16.4 / 17.0 / 24.7 | 16.5 / 17.3 / 30.9 | 16.6 / 17.1 / 30.6 |
| same page, switched | main | 17.0 / 35.5 / 45.5 | 17.0 / 34.5 / 35.4 | 17.0 / 34.7 / 35.3 |
| WebGPU, `?transport=main` from load | main | 16.8 / 33.6 / 34.4 | 16.8 / 17.1 / 30.4 | 16.8 / 17.1 / 31.0 |
| same page, switched | worker | 16.7 / 17.5 / 30.1 | 16.7 / 17.7 / 30.6 | 16.8 / 17.3 / 30.6 |

(An earlier exploratory run gave Worker 16.4 / 16.9 / 19.7, 16.5 / 17.3 / 30.6 and 16.6 / 17.2 / 29.8.)

Reading: p50 is about one frame (~16.7 ms) on both transports. Worker p95 stays at about 17 ms. After a switch to the main thread, p95 roughly doubles to about 34-35 ms, which means some samples miss a frame. When the page starts on the main thread, only the first stroke shows that. This is a headless mouse measurement. The pen numbers inside Tapestry decide the question.

## Verification record

Re-run at HEAD `55b6a4f` (Task 1 code unchanged since `971b871`), 2026-09-24T22:17Z:

- `npm --prefix plugins/data-drawing run typecheck`: clean
- `npm --prefix plugins/data-drawing test`: **9 files / 90 tests passed**, including `replay.test.ts` (6) and `latency.test.ts` (3). stdout: `replay DIFF: mutated action at tick 10, firstDiffTick 60` (the acceptance bound is <= tick + 60 = 70)
- `npm --prefix plugins/data-drawing run build`: built (`dist/surface.js` 1,690 kB, `ddsim.wasm` 55 kB, worker chunk 22 kB)
- Source gates: the negated `SharedArrayBuffer|from 'electron'|window.tapestry` grep (comment lines excluded) found nothing. `MainThreadTransport` is at sim-host.ts:368 and `replayFromZero` at sim.worker.ts:137. `performance.now` appears 3 times in latency.ts and nowhere in ddsim-abi.ts. `cycles` is in dev-host.ts. The only non-copy `HEAPU8` use is the action-byte copy-in.
- Native: `ctest` native-debug **75/75**, native-release **75/75**, native-ubsan **75/75**
- App: `npm --prefix app test` **21 files / 443 tests passed**
- Dev-page acceptance (Task 1): `?cycles=20` printed `cycles: mounted=21 disposed=20 lost=<n>` and the page kept drawing. `?transport=main` painted with the mouse and the panel showed `transport=main`. Verify replay after mouse strokes showed `replay: MATCH (tick N, nodes M)` on every run. The Electron app was not started in this run.

## Files Created/Modified

- `plugins/data-drawing/surface/src/sim-driver.ts` (created): `SimDriver`, the shared accumulator, recorder, hash ring, `restore`, `replayFromZero`
- `plugins/data-drawing/surface/src/replay.ts` (created): `verifyReplay`, `formatReplayLine`
- `plugins/data-drawing/surface/src/latency.ts` (created): `LatencyMeter`, `formatLatencyLine`
- `plugins/data-drawing/surface/src/sim-host.ts`: `WorkerTransport`, `MainThreadTransport`, `createTransport`, `RestorePoint`, `replayFromZero` on `SimHost`
- `plugins/data-drawing/surface/src/sim.worker.ts`: thin shell over `SimDriver`, `replay` message
- `plugins/data-drawing/surface/src/main.ts`: panel lines, Verify replay, transport checkbox, adapter lookup
- `plugins/data-drawing/surface/src/dev-host.ts`, `surface/index.html`: `?cycles=N`, `?transport=main`, `?webgl=1`, the `#cycles` readout
- `plugins/data-drawing/surface/src/input.ts`: a trailing comment reworded so the plan's source gate stays literal
- `plugins/data-drawing/tsconfig.json`: `@webgpu/types` in `types`
- `plugins/data-drawing/surface/test/replay.test.ts`, `test/latency.test.ts` (created)

## Decisions Made

See `key-decisions` in the frontmatter: the shared `sim-driver.ts`, the deferred Task 2, SIM-03 as the only requirement marked, and WebGPU kept as the default.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `input.ts` comment reworded (not in the plan's file list)**
- **Found during:** Task 1
- **Issue:** A trailing comment in `input.ts` matched the plan's negated source-gate grep, which excludes only lines that start with a comment.
- **Fix:** Reworded the comment. No code changed.
- **Committed in:** `971b871`

**2. [Plan-allowed addition] `sim-driver.ts` and `test/latency.test.ts` created**
- The plan says to create `sim-driver.ts` if a shared driver is used and to say so here. `latency.test.ts` pins the painted rule and the per-stroke stats.
- **Committed in:** `971b871`

### Process deviation

**3. Task 2 approved-deferred, not answered.** The checkpoint is `gate="blocking"`, so auto-mode may approve it. Under the autonomy protocol it was approved-deferred and queued as `autonomy/REVIEW.md` item 1. The Task 1 executor did not record the Task 1 dev-page observations in a SUMMARY. This continuation ran them headless (above) so they are no longer missing.

---

**Total deviations:** 2 auto-fixed or plan-allowed, 1 process deferral. **Impact:** every machine-checkable must-have holds. The Tapestry-window and pen truths (feel, pressure, overlap, the 20 opens inside Tapestry, pen latency, the Electron backend) wait for the human.

## Issues Encountered

- The dev page's checkboxes have no accessible names, so the headless script picks the transport switch as the third `input[type=checkbox]` in `#surface`. Adding labels would make it scriptable by name. That is cosmetic and out of scope.
- Headless Chromium exposes WebGPU on this Mac. Electron 32 (Chromium 128) inside Tapestry may differ, which is step 1 of the human sheet.

## Known Stubs

None. Every panel line is wired: backend, adapter, transport, latency, replay and tick/nodes/hash.

## Threat Flags

None new. T-08-01: replay touches only the worker's own log, a DIFF is reported and never reconciled, and the second instance is destroyed (`_dd_destroy`). T-08-02: 20 cycles headless left one canvas and zero warnings, and on WebGL 2 each dispose forced one context loss. T-08-04: the source gates are clean.

## User Setup Required

The pen verification. Answer item 1 in `autonomy/REVIEW.md` by writing to `autonomy/RESPONSE`. To start Tapestry from the repo root: `npm --prefix plugins/data-drawing run build && npm --prefix app run dev`, then "Open Data Drawing".

## Next Phase Readiness

- Phase 01 verification can run now. It should report `human_needed` for success criteria 1 and 4 (feel with the pen, the brush edit in Tapestry) and for the Tapestry-window halves of 3 and 5, until Kaelen answers REVIEW item 1.
- CANV-03, CANV-04 and STRK-02 stay unchecked in REQUIREMENTS.md until then.

---
*Phase: 01-painting-with-the-pen*
*Completed: 2026-09-24 (human verification pending)*

## Self-Check: PASSED

All 5 created and 7 modified code files exist; `971b871` is in history; `git log --oneline 2e390c6..HEAD --grep "(01-08)"` = 1 before this docs commit, matching `actuals.commits`; typecheck, Vitest 90/90, build, source gates, ctest 75/75 x3 and app Vitest 443/443 were re-run above. Human verification (Task 2) is PENDING and is not claimed.
