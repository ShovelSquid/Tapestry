# STATE — the driver's handoff between autonomous sessions

Read this fully at the start of every session, together with
`.planning/STATE.md`, which is GSD's record of phase and plan progress. This
file holds only what GSD doesn't: the pending checkpoint, work cut off mid-way,
the session log, and environment lessons.

## Current target

Phase 02.7: File Windows & Workspace Sandbox. It has 3 plans in 3 waves:
01, then 02, then 03.

- Plan 01 ends in `checkpoint:human-verify`: the live dogfood run in the
  Tapestry app with Claude Code connected. The human must do it, so expect
  to write autonomy/WAITING when it is reached.

## Checkpoint

(none pending)

## In progress

(nothing)

## Log

(one line per session: date, wave or plan, commits, result)

## Learned

- The worktree shares `node_modules` with `~/Tapestry` by symlink.
  `app/native/build` was copied from agent-trees, and `app/out` is built
  locally with `npm --prefix app run build:js`.
- The baseline at branch point `af3fb88`: 18 test files, 411 tests passing,
  typecheck clean.

## Blocked

(questions a human would have been asked, with the option taken)
