# autonomy/ on ws/mergin

Each source worktree ran its own unattended driver (`run.sh`, `watch.py`) with
its own `PROMPT.md`, `STATE.md`, `REVIEW.md` and `DONE`. On this integration
branch they are kept side by side, one folder per source branch, so nothing a
driver recorded is lost:

- `data-drawing/` — Data Drawing phase 01 (8/8 plans; human checks queued in REVIEW.md)
- `physics-engine/` — mathspace, all seven plan phases done headlessly
- `spatial-canvas/` — Phase 2.6 Placement Edges & Forest Tree (10/10; human_needed)
- `windows/` — Phase 2.7 File Windows & Workspace Sandbox (6/7; 02.7-07 parked)

`ws/02.3-time-threads` ran without a driver. To run a driver here again, copy
one folder's `run.sh`, `watch.py` and `PROTOCOL.md` up to this directory and
write a fresh `PROMPT.md` naming `ws/mergin`.

## ws/ui

On `ws/ui` (worktree `~/Tapestrees/ui`), the top-level `autonomy/` is a live
driver again. It works through the plans in `~/Tree/Design` marked
`status: ready for autonomy`; see `PROTOCOL.md`. The per-branch folders
above are history.
