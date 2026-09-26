# autonomy/ on ws/mergin

The live driver for this branch is at this level: `run.sh`, `watch.py`,
`PROTOCOL.md`, `PROMPT.md`, `STATE.md` and `REVIEW.md`. It was ported from
`windows/` and runs one GSD wave per session. The current target is in
`STATE.md`.

    autonomy/run.sh            # run until autonomy/DONE
    autonomy/watch.py          # watch it from another terminal
    touch autonomy/STOP        # stop after the current session

Each source worktree ran its own driver before it was merged. Those are
kept side by side, one folder per source branch, as archives. Don't run them:

- `data-drawing/`: Data Drawing phase 01 (8/8 plans; human checks queued in REVIEW.md)
- `physics-engine/`: mathspace, all seven plan phases done headlessly; its CLAUDE.md is here too
- `spatial-canvas/`: Phase 2.6 Placement Edges & Forest Tree (10/10; human_needed)
- `windows/`: Phase 2.7 File Windows & Workspace Sandbox (6/7; 02.7-07 parked, now item 5 in ../REVIEW.md)

- `ui/`: ws/ui's Design-plan driver (Line Lab v2 built; its REVIEW.md items 1-12 are open)

`ws/02.3-time-threads` ran without a driver.
