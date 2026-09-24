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
