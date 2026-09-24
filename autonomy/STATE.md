# STATE — the driver's handoff between autonomous sessions

Read this fully at the start of every session, together with
`.planning/STATE.md`, which is GSD's record of phase and plan progress. This
file holds only what GSD doesn't: the pending checkpoint, work cut off mid-way,
the session log, and environment lessons.

## Current target

(Fill this in before the first run on a new branch: the phase, its plans and
waves, and which plans end in a human checkpoint.)

## Checkpoint

(none)

## In progress

(nothing)

## Log

(one line per session: date, wave or plan, commits, result)

## Learned

(carried over from the ws/windows runs; check they still hold here)

- Worktrees share `node_modules` with `~/Tapestry` by symlink. `app/out` is
  built locally with `npm --prefix app run build:js`.
- If `worktree.base-check` reports shouldDegrade=true, run executors
  sequentially with no isolation. `query dispatch-isolation ...
  --force-isolation none` modifies the tracked
  `.gsd/dispatch-isolation-sentinel.json`; restore it with `git checkout --`
  before committing.
- `gsd-tools state advance-plan` can count against another phase's plan
  numbering. Check .planning/STATE.md's Current Position by hand after each
  plan.

## Blocked

(questions a human would have been asked, with the option taken)
