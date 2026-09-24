# STATE — the driver's handoff between autonomous sessions

Read this fully at the start of every session, together with
`.planning/STATE.md`, which is GSD's record of phase and plan progress. This
file holds only what GSD doesn't: the pending checkpoint, work cut off mid-way,
the session log, and environment lessons.

## Current target

Phase 2.6: Placement Edges & Forest Tree. It has 6 plans in 6 waves, run
strictly in order: 01, 02, 03, 04, 05, then 06.

- 01 — groundwork that writes no record: settings passthrough, pure
  drop-batch and Ctrl+Z routing helpers, registry seams. Autonomous.
- 02 — starts with a `checkpoint:decision gate="blocking-human"` (Task 1):
  the on-disk record shape (#17), the settings.json migration (#18), Ctrl+Z
  reach and new wording. It is a one-way door and is never auto-answered.
  Expect to write autonomy/WAITING here. Kaelen's answer to item 1.4
  (which placement keys are written) should take the 3D frame convention
  in `.planning/phases/02.6-placement-edges-forest-tree/02.6-3D-FRAMES.md`
  into account; point to it in WAITING.
- 03 — the app launches into the forest. Autonomous.
- 04 — membership and identity by header digest. Autonomous.
- 05 — Ctrl+Z after a drag as a compensating commit; system-signed fit.
  Autonomous.
- 06 — remaining launch cases, reader's guide `docs/tree/forest.md`,
  legacy writers removed, phase gate. Autonomous, but the phase gate may
  end `human_needed` (Kaelen's check on copied data): that goes to WAITING.

## Checkpoint

(none pending)

## In progress

(nothing)

## Log

(one line per session: date, wave or plan, commits, result)

- 2026-09-24 (interactive, not the driver): committed the 2.6 plans,
  merged phase-2-implementation-v1 at `96ac7f0` (`256fae7`), ported this
  driver from ws/windows. Auto checkpoints stay on (Kaelen's choice).

## Learned

- The worktree shares `node_modules` with `~/Tapestry` by symlink.
  `app/native/build` was built here with `npm --prefix app run build:native`
  (not copied: a copied CMake cache carries another tree's absolute paths).
- `workflow.auto_advance: true` is auto mode even without `--auto`: GSD
  approves `human-verify` checkpoints and picks the first option of
  decisions. Kaelen wants this on. Only `blocking-human` gates stop.
- The baseline after the merge (`256fae7`): 21 test files, 443 tests
  passing, typecheck clean. After quick 260924-glr (`e66b3a8`): 22 files,
  486 tests.

## Blocked

(questions a human would have been asked, with the option taken)
