# STATE — the driver's handoff between autonomous sessions (ws/ui)

Read this fully at the start of every session. The work list itself is the
`status:` lines of `~/Tree/Design/Plan - *.md` (see PROTOCOL.md). This file
holds what those don't: work cut off mid-way, the session log, and
environment lessons.

## Current target

`~/Tree/Design/Plan - Line Lab v2.md`, worked from its `## Progress`
checklist:
- Part 1 (tasks 1-8): the Line Lab tuning page
  (`Design/Line Lab/line-lab.src.html`) and `Spec - Notes, Lines and
  Motion.md`, ending in a publish to the existing Line Lab artifact and a
  Plugin Map update. It can take one session or a few.
- Part 2 (waves 0-8): the note look built into `app/` on this branch, one
  wave per session, without GSD. Five ⚠ gates for Kaelen are listed in the
  plan; take the reversible option and queue each in REVIEW.md.

## Plans

(one line per finished or parked plan: date, plan, result, REVIEW items)

## In progress

(empty) Wave 2 is done (REVIEW #5). Next session: **Part 2, Wave 3 (the format bar
and note settings)**. Start with `git merge ws/mergin`. The `f` and settings
buttons go top-right on a selected note (Line Lab `drawNote`: pencil circles at
(w-62, 22) and (w-28, 22), r 13, `wobbleScale` 0.35); `f` expands into the
`f i b u ✱` pill replacing `FloatingToolbar`. Underline and strikethrough stay
disabled (gate 1). Screenshots: `autonomy/checks/line-lab-v2/wave2-*.js` show how
to get notes on screen.

## Blocked

- Wave 0 "no visual change except the pencil colour": nothing draws in
  pencil until wave 2, so the pencil token is defined but unused and the
  app is pixel-identical. The `editor/schema.ts` text-colour palette keeps
  its hex because it's `.tree` data. Both in REVIEW #3.

- Line Lab publish needs the Artifact tool, which unattended sessions don't
  have. Queued as REVIEW #1; Task 8 stays unticked (parked) until approved.
- Particle direction ("in the direction of change") read literally: specks
  fly along Δv from the corners facing it. Queued in REVIEW #2.

## Learned

- The worktree had no node_modules; `npm install` at the root (real
  install, not the shared symlink) took a few minutes and built the addon.
- App screenshots: `autonomy/checks/line-lab-v2/app-shot.cjs`. Notes get on
  screen through `window.tapestry` (setUserName, trees.create, kernel.submit,
  then reload); see `wave2-setup.js`. Main only accepts `.tree` paths under
  home, and finds plugins beside `app.getAppPath()`, which the script points
  at `app/` (otherwise every note shows as "unavailable").
- macOS has no `timeout`; background long commands instead.

- ~/Tree is not a git repo; `autonomy/snapshots/` is the only undo for it.
- Tuned look values: Kaelen's JSON in `~/Tree/Design/Index First Pass Notes.md`
  is the source of truth (1 px line, 1.4 px wobble, 2 waves at 0.35, 670 ms grow).
  If it and the plan's table differ, the notes win.
- Branch forked from ws/mergin at 07aeaa4 on 2026-09-25.
- The plan's pre-driver text is snapshotted at
  `autonomy/snapshots/line-lab-v2/Design/Plan - Line Lab v2.md`. It was
  taken right before the Progress checklist was added.
- Kaelen may edit a plan while a session runs. Re-read it (or diff it
  against the snapshot) before ticking boxes.
- Headless Chrome doesn't tick `requestAnimationFrame` under
  `--virtual-time-budget`. Test pages must shim it with a timer; see
  `autonomy/checks/line-lab-v2/`.
- No Artifact tool in unattended sessions, so publish steps go to REVIEW.
- Standalone renderer checks: bundle with the root `node_modules/.bin/esbuild`
  and run in Electron via `cd app && npx electron <script>`. A shown window
  with `backgroundThrottling: false` ticks rAF at a real 60 fps (see ink-bench).

## Log

- 2026-09-25 01:27: Line Lab v2 Part 1 tasks 1-7b done and ticked; Task 8
  built, screenshotted, Plugin Map updated, publish parked (REVIEW #1).
  Commits d76dd62, cf584e4, 771250f. Kaelen edited the plan mid-session
  (added Task 7b, static weight); picked up and done.
- 2026-09-25 10:03: Line Lab v2 Part 2 Wave 0 done and ticked (token pass,
  look/values.ts, look/motion.ts + tests; 1148 tests green; screenshot
  pixel-identical to 379c07f). Commits 70f1436, cc76bb7. REVIEW #3 queued.
- 2026-09-25 13:12: Line Lab v2 Part 2 Wave 1 done and ticked (look/ink.ts,
  <InkLine>, 16 tests, 1164 green; the Electron bench holds 60 fps with 200 notes
  and 3 selected). Commit aa12cda. REVIEW #4 queued.
- 2026-09-25 13:50: Line Lab v2 Part 2 Wave 2 done and ticked (NoteInk, bloom,
  CornerCluster, NoteCard restyle; 10 tests, 1174 green; side-by-side with sketches
  0-2). Commits f31d66c, a1094a8. REVIEW #5 queued.
