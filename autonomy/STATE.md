# STATE — the driver's handoff between autonomous sessions

Read this fully at the start of every session, together with
`.planning/STATE.md`, which is GSD's record of phase and plan progress. This
file holds only what GSD doesn't: the pending checkpoint, work cut off mid-way,
the session log, and environment lessons.

## Current target

Phase 02.7: File Windows & Workspace Sandbox. It has 7 plans in 7 waves,
run strictly in order (CONTEXT D-17, D-21): 01, 02, 03, 04, 05, 06, then 07.

- 01 — dogfood tracer: workspaces, file windows, sandboxed read_file and
  edit_file over MCP. Tasks 1-3 are done; it ends in `checkpoint:human-verify`
  (the live dogfood run with Claude Code connected), which is pending.
- 02 — connect-on-start for agents (D-20, its first task), then the in-app
  chat panel on the Claude Code CLI (ChatEngine seam), then Ask Claude… from
  the canvas, file cards and notes (D-19). Autonomous: its hands-on checks
  moved into 03's combined checkpoint.
- 03 — folders as subspaces (D-21): nested, collapsible, draggable folder
  frames. Ends in the combined `checkpoint:human-verify` for 02 and 03.
- 04 — the per-chat "Allow shell (not sandboxed)" switch. Autonomous.
- 05 — full file tools, the refusal matrix, file locks and guards.
  Autonomous.
- 06 — live watching and scale. Autonomous.
- 07 — the API-key chat engine. It starts with a blocking-human package
  legitimacy check for @anthropic-ai/sdk, which also asks where to install:
  node_modules here is a symlink into ~/Tapestry. It is never auto-approved.

Checkpoints in 01 and 03 were deferred to REVIEW.md. 07's blocking-human package check has to be parked, not faked.

## Checkpoint

(none pending) REVIEW.md holds item 1 (02.7-02/03 combined check) and item 2 (02.7-04 shell-switch
hands-on check), both deferred. The next wave is wave 5 (02.7-05, full file tools, refusals, locks).
Under PROTOCOL step 4, 07's package check gets parked in REVIEW.md, not approved.

## In progress

(nothing)

## Log

(one line per session: date, wave or plan, commits, result)

- 2026-09-24 11:41: wave 1 (02.7-01). Tasks 1-3 committed as 6 commits
  (c7c850e..4f7337c); 23 files and 449 tests green, typecheck clean. Stopped
  at the Task 4 dogfood checkpoint and wrote WAITING.
- 2026-09-24 12:31: resumed 02.7-01 Task 4 with RESPONSE `approved`.
  An executor wrote the SUMMARY and updated STATE/ROADMAP (a5de9ba); 449
  tests green, typecheck clean. 02.7-01 is complete. Wave 2 was left for the
  next session.
- 2026-09-24 12:34: wave 2 (02.7-02). One foreground executor, about 32 min
  and 360K tokens; 10 commits b249c3d..b9d34b2. 26 files and 499 tests green,
  typecheck clean. The executor ran the real `claude` once (a "reply ok" call,
  allowed by the plan) to record a fixture. Next is wave 3.
- 2026-09-24 13:08: wave 3 (02.7-03). One foreground executor, about 19 min
  and 290K tokens. Tasks 1 and 2 are in 5 commits (b9b0a4a..6a79054). 28 files
  and 516 tests pass, typecheck clean. Stopped at the combined Task 3
  checkpoint and wrote WAITING.
- 2026-09-24 15:15: resolved the 02.7-03 checkpoint with a deferred approval (no RESPONSE came),
  following PROTOCOL step 4. An executor wrote the SUMMARY and updated STATE/ROADMAP (5aa025f).
  516 tests pass and typecheck is clean. It's REVIEW item 1. Wave 4 is next.
- 2026-09-24 15:20: wave 4 (02.7-04). One foreground executor, about 10 min and 177K tokens;
  2401525, 4603701, 8b1cc76. 28 files and 534 tests pass, typecheck clean. The backstop hands-on
  check is queued as REVIEW item 2. Wave 5 is next.

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
- `gsd-tools` state advance-plan counts against 02.2's plan numbering
  (it wrote "9 of 16"). Check .planning/STATE.md's Current Position by hand
  after each plan.
- A foreground gsd-executor for 02.7-01 Tasks 1-3 took about 15 minutes and
  250K tokens, and the idle watchdog did not trip. The 02.7-02 executor ran
  32 minutes in the foreground without tripping it either: subagent events
  reach the stream-json log, so foreground executors are safe.
- After 02.7-02: 26 test files, 499 tests. After 02.7-03 Tasks 1 and 2: 28 files, 516.
  After 02.7-04: 28 files, 534.
- Executors must not launch the app before a checkpoint. On the first open,
  the app writes commits (such as the subspace arrangement) into the real
  workspace tree, and the human verifies those commits.

## Blocked

(questions a human would have been asked, with the option taken)

- 2026-09-24 12:31: the tree held an uncommitted dogfood leftover in
  yoho-so-lets-do-melodic-plum.md: line 2, a blank line, had become
  `## big beans`. It looked like a test edit, so I reverted it with
  `git checkout --`. Retype it if it was meant to stay.
