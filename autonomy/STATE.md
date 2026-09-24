# STATE — the driver's handoff between autonomous sessions

Read this fully at the start of every session, together with
`data-drawing/.planning/STATE.md`, which is GSD's record of phase and plan
progress. This file holds only what GSD doesn't: the pending checkpoint, work
cut off mid-way, the session log, and environment lessons.

## Current target

Phase 01: Painting with the Pen. All 8 plans have SUMMARY files. 01-08 Task 2
(pen checks inside Tapestry) was approved-deferred per PROTOCOL step 4 and is
REVIEW.md item 1. Phase verification ran: `human_needed` (01-VERIFICATION.md,
01-UAT.md); its extra human items are REVIEW.md items 2 and 3. `autonomy/DONE`
is written. Phase 2 (Readable Journal) must not be planned unattended.

## Checkpoint

None pending. Human answers to REVIEW.md items 1-3 arrive in autonomy/RESPONSE.
On item 1: paste the human's sheet verbatim into 01-08-SUMMARY.md's PENDING
section and update 01-UAT.md; on "approved", mark CANV-03, CANV-04, STRK-02
complete in REQUIREMENTS.md; on issues, gap-closure via
`gsd-plan-phase 01 --gaps` then `gsd-execute-phase 01 --gaps-only`.

## In progress

(nothing)

## Log

(one line per session: date, wave or plan, commits, result)

- 2026-09-24 12:56 — wave 5 / 01-08: re-ran Task 1 verify (native 75x3,
  plugin 90, app 443, gates clean), rebuilt Wasm and surface, started app
  dev in background, wrote WAITING for Task 2. Commit: this STATE only.
- 2026-09-24 15:15 — wave 5 / 01-08: resumed Task 2 as approved-deferred;
  executor re-ran suites (native 75x3, plugin 90, app 443) plus headless
  dev-page checks, wrote SUMMARY (`85a2f06`); phase verification
  human_needed (`test(01)` commit), REVIEW items 1-3 queued, DONE written.

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

- The Agent isolation guard hook requires `isolation="worktree"` unless
  the sentinel is forced to none first:
  `gsd-tools query dispatch-isolation --raw --phase 01 --force-isolation none`
  (base-check degrades here); restore the sentinel file before committing.
- Config has `verifier_enabled: false`; verification was run anyway since
  PROTOCOL step 7 requires it.

## Blocked

(questions a human would have been asked, with the option taken)

- 2026-09-24: did Task 2's preparation directly instead of through
  `gsd-execute-phase 01 --wave 5`: Task 1 is committed and Task 2 is the
  checkpoint itself, so the orchestrator would only have reached the same
  gate. No code changed.
