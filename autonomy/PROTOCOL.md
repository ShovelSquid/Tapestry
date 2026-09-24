# Autonomous protocol (data-drawing)

Sessions are started by `autonomy/run.sh` with nobody watching. Each session
executes **one GSD wave** of the current phase, then exits. The session's
working directory is `data-drawing/`, the GSD project: the plans are the map
(`data-drawing/.planning/phases/<phase>/*-PLAN.md`), GSD's
`data-drawing/.planning/STATE.md` plus the SUMMARY files record what is done,
and `autonomy/STATE.md` (at the repo root) is the driver's own handoff notes.
The machinery was ported from `ws/windows`.

Paths below are from the repo root (`git rev-parse --show-toplevel`) unless
they start with `.planning/`, which means `data-drawing/.planning/`.

## Paths in the plans

The plans were written when this branch lived in the primary checkout, so
their `read_first` and `verify` lines use `/Users/kaelencook/Tapestry/...`.
That checkout is now on `main` and is off limits. Read every such path as
this worktree's root (`/Users/kaelencook/Tapestrees/data-drawing/...`) and
run every such command here.

## Each session

1. **Orient.** Run `git status` and `git log --oneline -8`. Read
   `autonomy/STATE.md`, then `.planning/STATE.md` (its `current_phase` is
   the phase to work on).
   - `autonomy/STOP` is the operator's gentle stop, handled by the driver
     between sessions. Never create, delete or commit it.
   - If `autonomy/WAITING` exists, a human has not answered yet: print
     `SESSION: no commit, still WAITING` and exit.
   - If the tree is dirty, the previous session was cut off. Read the
     "In progress" section and any `wip:` commits, then either finish that
     work to green tests and commit it, or `git checkout -- . && git clean -fd`
     (never touching ignored files) and record why under "In progress".

2. **Resume a checkpoint if one was answered.** If `autonomy/RESPONSE`
   exists, the human answered the checkpoint recorded in autonomy/STATE.md
   under "Checkpoint". Continue that plan through the GSD execute workflow,
   passing the RESPONSE text verbatim as the user's response, e.g.
   `approved` or a list of issues. Delete `autonomy/RESPONSE` once the
   continuation has taken it. Issues in RESPONSE are real bugs: fix them
   inside that plan, or let GSD create gap-closure plans. Never mark them
   approved.

3. **Execute the next wave.** Find the lowest wave that still has a plan
   without a `*-SUMMARY.md`, then invoke the skill
   `gsd-execute-phase` with args `<phase> --wave <N>`.
   - **Never pass `--auto`.** Auto mode approves human checkpoints on its
     own, and the checkpoints in these plans are the human's to pass,
     especially the pen feel checks.
   - Let GSD's executor agents do the work and make the atomic commits.
     Do not re-implement a plan inline.
   - A plan with commits but no SUMMARY is partly done: continue it from
     its first task without a commit, do not redo committed tasks.

4. **Stop at any human gate.** A `checkpoint:human-verify`,
   `checkpoint:decision` or `checkpoint:human-action`, a phase verification
   that ends `human_needed`, or any AskUserQuestion that the workflow would
   raise all mean the human decides. Do not answer it yourself.
   - Do the checkpoint's `what-built` preparation first (builds, tests,
     starting the app in the background) so the human can start at once.
   - Write `autonomy/WAITING`, which is gitignored, in plain words: phase,
     plan and task; exactly what to do (the checkpoint's how-to-verify
     steps, with commands); what to check; and how to answer (the
     checkpoint's resume-signal).
   - End WAITING with: *"When done, write your answer (`approved`, or the
     issues you saw) into `autonomy/RESPONSE`, delete this file, and rerun
     `autonomy/run.sh`."*
   - Record the same checkpoint under "Checkpoint" in autonomy/STATE.md, so
     the next session knows which plan and task to resume.
   - Commit STATE.md and exit.

5. **Tests stay green.** Run what your change touches, and fix what you
   broke:
   - Sim (`data-drawing/sim/`): from `data-drawing/sim`,
     `cmake --preset <p> && cmake --build --preset <p> && ctest --preset <p>`
     for `native-debug`, `native-release` and `native-ubsan`; then
     `npm --prefix plugins/data-drawing run sim:wasm` (emsdk 6.0.10 at
     `~/emsdk`) so the surface tests use the new Wasm.
   - Plugin (`plugins/data-drawing/`): `npm --prefix plugins/data-drawing
     run typecheck`, `... test` and `... run build`.
   - App (`app/`): `npm --prefix app run build:js` (the shim test spawns
     `app/out/main/mcp.js`), then `npm --prefix app run typecheck` and
     `npm --prefix app run test`.
   If you are more than about an hour into one plan, commit the working
   part as `wip:` and write the rest under "In progress".

6. **Hand off.** Update `autonomy/STATE.md`:
   - "In progress" is either empty or concrete enough to resume cold.
   - "Log" gets one line per session: date, wave or plan, commits, result.
   - "Learned" records anything surprising about the environment.
   - "Blocked" records questions a human would have been asked, with the
     option you took.

   Commit it separately as `autonomy: <one line>`.

7. **Phase done.** When `gsd-execute-phase` reports the phase complete and
   verified (not `human_needed`), create `autonomy/DONE` with a short
   summary and commit it. The driver stops on that file. The next phase
   (Phase 2, Readable Journal) has no plans yet, and its planning opens the
   sample-block grammar, a one-way door to be judged with Kaelen, so never
   plan or start it unattended.

8. **Exit.** Print one line starting with `SESSION:` that says what you
   committed, or `SESSION: no commit` and why. Never leave a dirty tree.

## Rules

- Stay on branch `data-drawing` in this worktree. Never switch, create or
  rename branches, and never `cd` into another worktree or the primary
  checkout at `~/Tapestry`.
- Never push; the driver pushes after a committing session. Never
  force-push. Never rewrite published history.
- Tests must never open real data: `~/Documents/we.tree`, `~/House Party`,
  `~/Tapestry`, `~/Tapestrees`. Use temp directories.
- Commit messages follow the repo's GSD style (`feat(01-08): …`,
  `docs(01-08): …`) and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not ask questions; nobody will answer. Human gates go to WAITING.
  Everything else gets your best judgement, recorded under "Blocked".
- Keep autonomy/STATE.md under about 150 lines; collapse old log lines.
