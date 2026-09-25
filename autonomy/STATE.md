# STATE — the driver's handoff between autonomous sessions

Read this fully at the start of every session, together with
`.planning/STATE.md`, which is GSD's record of phase and plan progress. This
file holds only what GSD doesn't: work cut off mid-way, the session log, and
environment lessons.

## Current target

Phase 2.8: Agent Note Windows (`.planning/phases/02.8-agent-note-windows/`).
Decisions are in `02.8-CONTEXT.md`, from Kaelen's spec at
`~/Tree/Connections/Spec - Agent Note Windows.md`. Run its waves in order.

02.7-07 (the API-key engine) is PARKED on a human package approval
(REVIEW item 5). Do not run it, and do not let 2.8 depend on it: 2.8's forks
use transcript replay, which works on the Claude Code CLI engine.

## In progress

(nothing)

## Log

(one line per session: date, wave or plan, commits, result)

## Learned

- `node_modules` at the root and `app/native/build` are real directories in
  this worktree. Build `app/out` with `npm --prefix app run build:js`.
- Baseline on 2026-09-25 before 2.8: 71 test files, 1132 tests passing,
  typecheck clean.
- From ws/windows: `worktree.base-check` may report shouldDegrade=true, so
  run executors sequentially with no isolation. Running `query
  dispatch-isolation` modifies the tracked `.gsd/dispatch-isolation-sentinel.json`;
  restore it with `git checkout --` before committing.
- From ws/windows: `gsd-tools state advance-plan` has miscounted plan numbers
  across phases. Check .planning/STATE.md's Current Position by hand after
  each plan.
- From ws/windows: foreground gsd-executors of 15-30 minutes do not trip the
  idle watchdog; subagent events reach the stream-json log.
- Executors must not launch the app before a checkpoint. On first open the
  app can write commits into real trees, and the human verifies those.

## Blocked

(questions a human would have been asked, with the option taken)
