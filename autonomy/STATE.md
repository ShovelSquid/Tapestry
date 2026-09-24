# STATE — the driver's handoff between autonomous sessions

Read this fully at the start of every session, together with
`data-drawing/.planning/STATE.md`, which is GSD's record of phase and plan
progress. This file holds only what GSD doesn't: the pending checkpoint, work
cut off mid-way, the session log, and environment lessons.

## Current target

Phase 01: Painting with the Pen. 8 plans in 5 waves; waves 1-4 (01-01 to
01-07) are complete with SUMMARY files.

- 01-08 (wave 5) — inside Tapestry: replay-from-zero, main-thread transport,
  latency meter, cycles harness, backend report. Task 1 is committed
  (`971b871`) but has no SUMMARY. Task 2 is a blocking
  `checkpoint:human-verify`: feel, replay, latency, backend and 20-open
  lifetime checks with the pen inside the running Tapestry app.

Task 1's verify re-passed here on 2026-09-24 and Task 2's preparation is
done; the session is WAITING on the human (see Checkpoint).

After 01-08 is approved, finishing Phase 01 is its verification. Phase 2
(Readable Journal) has no plans and must not be started unattended.

## Checkpoint

Phase 01, plan 01-08, Task 2 (checkpoint:human-verify, blocking): feel,
replay, latency, backend and 20-open lifetime checks with the pen inside
Tapestry. WAITING written 2026-09-24 13:00 with the plan's how-to-verify
steps. On RESPONSE: resume 01-08 at Task 2 through the GSD execute workflow
with the RESPONSE text verbatim; the SUMMARY must include the human's sheet
verbatim, the cycles line and the transport latency comparison. Task 1's
dev-page observations (`?cycles=20`, `?transport=main`, Verify replay) were
not recorded in a SUMMARY by the Task 1 executor; the human's steps 8-10
cover the same ground inside Tapestry. If the app is not running when the
human answers, nothing needs rebuilding: all outputs are current.

## In progress

(nothing)

## Log

(one line per session: date, wave or plan, commits, result)

- 2026-09-24 12:56 — wave 5 / 01-08: re-ran Task 1 verify (native 75x3,
  plugin 90, app 443, gates clean), rebuilt Wasm and surface, started app
  dev in background, wrote WAITING for Task 2. Commit: this STATE only.

## Learned

- This worktree was created 2026-09-24 from the primary checkout, which had
  `data-drawing` checked out; ignored build outputs (node_modules,
  `data-drawing/sim/build`, `plugins/data-drawing/surface/wasm` and `dist`,
  `app/out`, `app/native/build`) were not carried over.
- `node_modules`, `app/node_modules` and `plugins/data-drawing/node_modules`
  are symlinks into `~/Tapestry` (installed while it was on data-drawing;
  it is on `main` now). Everything else was built fresh here.
- Baseline at `c322f2e`: sim 75/75 ctest on native-debug, native-release
  and native-ubsan; plugin 9 files, 90 tests; app 21 files, 443 tests;
  plugin and app typecheck clean; Wasm, surface and app builds green.
- `.planning/STATE.md` said "Stopped at: Completed 01-07" and 0% when this
  driver was ported, although 01-08 Task 1 had landed. Check its Current
  Position by hand after each plan.
- From ws/windows: if `worktree.base-check` reports shouldDegrade=true, run
  executors sequentially with no isolation. The dispatch-isolation query
  rewrites the tracked `.gsd/dispatch-isolation-sentinel.json` (repo root
  and `data-drawing/.gsd/`); restore it with `git checkout --` before
  committing.

## Blocked

(questions a human would have been asked, with the option taken)

- 2026-09-24: did Task 2's preparation directly instead of through
  `gsd-execute-phase 01 --wave 5`: Task 1 is committed and Task 2 is the
  checkpoint itself, so the orchestrator would only have reached the same
  gate. No code changed.
