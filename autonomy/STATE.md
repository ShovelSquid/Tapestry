# STATE — the driver's handoff between autonomous sessions

Read this fully at the start of every session, together with
`.planning/STATE.md`, which is GSD's record of phase and plan progress. This
file holds only what GSD doesn't: work cut off mid-way, the session log, and
environment lessons.

## Current target

Phase 2.8: Agent Note Windows (`.planning/phases/02.8-agent-note-windows/`).
Decisions are in `02.8-CONTEXT.md`, from Kaelen's spec at
`~/Tree/Connections/Spec - Agent Note Windows.md`. It has 9 plans in 9 waves,
strictly linear (02.8-01 .. 02.8-09); the plan check passed after one
revision. 02.8-01 Task 1 and 02.8-07 Task 1 are `checkpoint:decision` gates
on how sessions and forks are stored: take the Recommended option and queue
it in REVIEW.md citing D-07/D-18, as each plan says. 02.8-09 runs the phase
gate and collects the hands-on checks.

02.7-07 (the API-key engine) is PARKED on a human package approval
(REVIEW item 5). Do not run it, and do not let 2.8 depend on it: 2.8's forks
use transcript replay, which works on the Claude Code CLI engine.

## After the ws/ui merge (2026-09-25)

ws/ui (Line Lab v2: ink lines, note restyle, format bar, zoom collapse,
motion, multi-select) was merged after 2.8 was planned. Plans cite line
numbers in App.css, App.tsx, Canvas.tsx, NoteCard.tsx and TreeFrame.tsx that
may have moved: find the code by name, not line. The 2.8 UI-SPEC predates the
restyle. Where its colours or borders disagree with the current App.css
tokens (for example `--tap-accent`) or the `look/` components, match the
current code and note it in the SUMMARY. ws/ui's driver is archived in
`autonomy/ui/` with its own open REVIEW items (1-12).

## In progress

(nothing)

## Log

(one line per session: date, wave or plan, commits, result)

- 2026-09-25 (interactive, not a driver session): Phase 2.8 inserted and
  planned; driver ported; App.css brace lost in the 2.3 merge fixed (8bb2614).
  71 files / 1132 tests green before 2.8. Next: wave 1 (02.8-01).
- 2026-09-25 18:08 session: wave 1, 02.8-01 done (ce9b091 REVIEW item 6
  = Task 1 option a; 67ffce6, edb7802 code; 36f0bf7 SUMMARY). 84 files /
  1272 tests green. Hands-on checks queued as REVIEW item 7. Next: wave 2
  (02.8-02).
- 2026-09-25 18:25 session: wave 2, 02.8-02 done (9c0e01f, 4f6305a, 5ea9299
  code; 77ecdc8 SUMMARY). 84 files / 1292 tests green. No checkpoints.
  Journal grows by the note's whole body + ~342 B per turn (~3.5 MB at 100
  turns). Next: wave 3 (02.8-03).
- 2026-09-25 18:36 session: wave 3, 02.8-03 done (34e32c9, 232d2e1,
  f1050d3, 5f18a3a code; fb88861 SUMMARY). 86 files / 1313 tests green.
  Hands-on checks and the executor's choices queued as REVIEW item 8.
  Executor took ~14 min. Next: wave 4 (02.8-04).
- 2026-09-25 18:52 session: wave 4, 02.8-04 done (c44a1c4, f2db616, 9fbca78
  code; 5175e1f SUMMARY). 87 files / 1356 tests green. No checkpoints;
  executor's choices and hands-on checks queued as REVIEW item 9. Executor
  took ~9 min. Next: wave 5 (02.8-05), which must pass the turn count to
  `initialStatus`.
- 2026-09-25 19:02 session: wave 5, 02.8-05 done (2fb4c29, 63d5323, bc0b145
  code; c2cb37e SUMMARY; 540657a state). 87 files / 1370 tests green. No
  checkpoints; choices and hands-on checks queued as REVIEW item 10.
  Executor took ~9 min. Next: wave 6 (02.8-06: Done fade, jiggle/flash,
  badge animation, raising the card, edge arrows).
- 2026-09-25 19:12 session: wave 6, 02.8-06 done (22bcb96, 6f046cd,
  87f5410, 2f36924, 8c66272 code; f9fb0df SUMMARY; state commit). 88 files /
  1430 tests green. No checkpoints; choices and hands-on checks queued as
  REVIEW item 11. Executor took ~16 min. Next: wave 7 (02.8-07: its Task 1
  is a checkpoint:decision on fork storage; take Recommended, cite D-18).
  02.8-08 must call `markNewSession` for forks.

## Learned

- `node_modules` at the root and `app/native/build` are real directories in
  this worktree. Build `app/out` with `npm --prefix app run build:js`.
- Baseline on 2026-09-25 before 2.8: 71 test files, 1132 tests passing,
  typecheck clean. After merging ws/ui: 82 files, 1237 tests.
- From ws/windows: `worktree.base-check` may report shouldDegrade=true, so
  run executors sequentially with no isolation. Running `query
  dispatch-isolation` modifies the tracked `.gsd/dispatch-isolation-sentinel.json`;
  restore it with `git checkout --` before committing.
- From ws/windows: `gsd-tools state advance-plan` has miscounted plan numbers
  across phases. Check .planning/STATE.md's Current Position by hand after
  each plan.
- From ws/windows: foreground gsd-executors of 15-30 minutes do not trip the
  idle watchdog; subagent events reach the stream-json log.
- Resolving a plan's opening checkpoint:decision before spawning (REVIEW
  item written by the driver, executor told the answer) worked cleanly for
  02.8-01; the executor took ~16 min.
- Executors must not launch the app before a checkpoint. On first open the
  app can write commits into real trees, and the human verifies those.

## Blocked

(questions a human would have been asked, with the option taken)

- 02.8-01 Task 1 session-note format: option a (REVIEW item 6).
- 02.8-02 (executor's calls, in its SUMMARY): a failed engine start is now
  recorded as a turn (`Error (crashed): …`) rather than thrown to the window;
  deleting a chat leaves its agent token in agents.json until the name is
  reissued (process and config file are gone; the plan asks no revocation).
- 02.8-03 (executor's calls, REVIEW item 8): Ask Claude… on a card goes to
  the next free spot; card delete stays top-right; resize only right/bottom.
- 02.8-04 (executor's calls, REVIEW item 9): Needs you clears only on a
  user message; lastStatus stores full text; old chats never learn
  set_status; live transcript hides set_status rows.
- 02.8-05 (executor's calls, REVIEW item 10): "New chat" comes from the
  header, not `initialStatus`; clicking clears Done/Failed; open panel does
  not clear a later Done; 2px border shifts content 1px.
- 02.8-06 (executor's calls, REVIEW item 11): settled Done keeps a 2px grey
  border; send raises the card; Needs you also jiggles; arrows under the
  selection bar; added `panelOpen` to the chat context.
