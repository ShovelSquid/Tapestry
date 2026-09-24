# STATE — the driver's handoff between autonomous sessions

Read this fully at the start of every session, together with
`.planning/STATE.md`, which is GSD's record of phase and plan progress. This
file holds only what GSD doesn't: the pending checkpoint, work cut off mid-way,
the session log, and environment lessons.

## Current target

Phase 02.7: File Windows & Workspace Sandbox. It has 6 plans in 6 waves,
run strictly in order (CONTEXT D-17): 01, 02, 03, 04, 05, then 06.

- 01 — dogfood tracer: workspaces, file windows, sandboxed read_file and
  edit_file over MCP. Ends in `checkpoint:human-verify` (the live dogfood
  run with Claude Code connected).
- 02 — in-app chat panel on the Claude Code CLI (ChatEngine seam). Ends in
  `checkpoint:human-verify` (Kaelen chats in the panel).
- 03 — the per-chat "Allow shell (not sandboxed)" switch. Autonomous.
- 04 — full file tools, the refusal matrix, file locks and guards (this was
  numbered 02 before the chat plans were inserted). Autonomous.
- 05 — live watching and scale (this was 03). Autonomous.
- 06 — the API-key chat engine. It starts with a blocking-human package
  legitimacy check for @anthropic-ai/sdk, which also asks where to install:
  node_modules here is a symlink into ~/Tapestry. It is never auto-approved.

The checkpoints in 01, 02 and 06 need the human, so expect to write
autonomy/WAITING when each is reached.

## Checkpoint

02.7-01 Task 4, `checkpoint:human-verify` (blocking): the dogfood gate (D-11).
Tasks 1-3 are committed as c7c850e..4f7337c; the plan base is c80ff3b. The
how-to-verify steps are in autonomy/WAITING (gitignored). SUMMARY.md is not
written yet.

To resume, spawn a fresh gsd-executor continuation for 02.7-01 that starts at
Task 4 with the RESPONSE text as the user's response. On `approved` it writes
02.7-01-SUMMARY.md, which must cover: the tree location
`<userData>/workspaces/<name>-<hash8>.tree` (reversible); that agents cannot
read or write git-ignored paths; that outside edits appear only after a
relaunch until 02.7-05; the dev hot-reload caveat; and the dogfood result. It
then updates STATE/ROADMAP. If RESPONSE lists issues, fix them inside 02.7-01.

## In progress

(nothing)

## Log

(one line per session: date, wave or plan, commits, result)

- 2026-09-24 11:41: wave 1 (02.7-01). Tasks 1-3 committed as 6 commits
  (c7c850e..4f7337c); 23 files and 449 tests green, typecheck clean. Stopped
  at the Task 4 dogfood checkpoint and wrote WAITING.

## Learned

- The worktree shares `node_modules` with `~/Tapestry` by symlink.
  `app/native/build` was copied from agent-trees, and `app/out` is built
  locally with `npm --prefix app run build:js`.
- The baseline at branch point `af3fb88`: 18 test files, 411 tests passing,
  typecheck clean. After 02.7-01 Tasks 1-3: 23 files, 449 tests.
- `worktree.base-check` reports shouldDegrade=true here, so run executors
  sequentially with no isolation. Running `query dispatch-isolation --raw
  --phase 02.7 --force-isolation none` just before each Agent dispatch
  modifies the tracked `.gsd/dispatch-isolation-sentinel.json`; restore it
  with `git checkout --` before committing.
- A foreground gsd-executor for 02.7-01 Tasks 1-3 took about 15 minutes and
  250K tokens, and the idle watchdog did not trip.

## Blocked

(questions a human would have been asked, with the option taken)
