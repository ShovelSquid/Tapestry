# ws/mergin — working notes for Claude

**Where you are.** The git worktree at `/Users/kaelencook/Tapestrees/mergin`
on branch `ws/mergin`. This is the integration branch: the physics engine,
spatial canvas, time threads and file windows branches are merged here, and
new phases are built here. Stay in this worktree and on this branch. The
generated `.claude/CLAUDE.md` says work happens in `/Users/kaelencook/Tapestry`
on `phase-2-implementation-v1`; that does not apply here. `.planning/` in this
worktree is the live one, and GSD commands run against it.

The physics engine's own notes (mathspace invariants, its old autonomous
protocol) moved to `autonomy/physics-engine/CLAUDE.md`. They still apply to
any edit under `include/`, `src/`, `wasm/` and `tests/mathspace`.

## Current work

Phase 2.8, Agent Note Windows: in-app chat sessions become notes on the
canvas. Read `.planning/phases/02.8-agent-note-windows/02.8-CONTEXT.md`. The
source spec is `~/Tree/Connections/Spec - Agent Note Windows.md`.

## Unattended sessions

Sessions started by `autonomy/run.sh` follow `autonomy/PROTOCOL.md` and
`autonomy/PROMPT.md`: one GSD wave per session, human gates queued in
`autonomy/REVIEW.md`, handoff notes in `autonomy/STATE.md`. The folders under
`autonomy/` (`data-drawing/`, `physics-engine/`, `spatial-canvas/`,
`windows/`) are archives of the merged branches' drivers; don't run them.

## Build and test

```bash
npm --prefix app run build:js     # the MCP shim test spawns app/out/main/mcp.js
npm --prefix app run typecheck
npm --prefix app run test
npm --prefix app run dev          # the app, for hands-on checks
```

C++ engine and kernel: see `autonomy/physics-engine/CLAUDE.md`.

## Rules

- Tests never open real data: `~/Documents/we.tree`, `~/House Party`,
  `~/Tapestry`, `~/Tapestrees`. Use temp directories.
- No `float`, `double`, `<cmath>`, `<random>` or `unordered_` in `include/`,
  `src/`, `wasm/` (the configure-time gate enforces it).
- Rendering and view state never enter a tree or a hash.
- Commit messages follow the GSD style (`feat(02.8-01): …`) and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
