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
   - If `autonomy/WAITING` exists, an older session stopped at a human
     gate. Move its text into `autonomy/REVIEW.md` as a new open item,
     delete WAITING, and resolve that gate as step 4 says.
   - If the tree is dirty, the previous session was cut off. Read the
     "In progress" section and any `wip:` commits, then either finish that
     work to green tests and commit it, or `git checkout -- . && git clean -fd`
     (never touching ignored files) and record why under "In progress".

2. **Act on the human's review answers.** If `autonomy/RESPONSE` exists,
   the human answered one or more items in `autonomy/REVIEW.md`. An
   `approved` closes the item. Issues are real bugs: fix them (inside the
   plan, or through GSD gap-closure plans) before starting a new wave, and
   never mark them approved. Record the answer on the item in REVIEW.md
   and delete RESPONSE.

3. **Execute the next wave.** Find the lowest wave that still has a plan
   without a `*-SUMMARY.md`, then invoke the skill
   `gsd-execute-phase` with args `<phase> --wave <N>`.
   - Do not pass `--auto`: it also chains into the next phase, and a
     session is one wave. Checkpoints are handled as step 4 says.
   - Skip plans marked parked in `autonomy/REVIEW.md`, and plans that
     depend on them.
   - Let GSD's executor agents do the work and make the atomic commits.
     Do not re-implement a plan inline.
   - A plan with commits but no SUMMARY is partly done: continue it from
     its first task without a commit, do not redo committed tasks.

4. **Never stop for a human gate; queue it and keep going (Kaelen,
   2026-09-24).** The loop runs until every plan of the phase is done.
   When the workflow reaches any checkpoint (`checkpoint:human-verify`,
   `checkpoint:decision`, `checkpoint:human-action`, a
   `gate="blocking-human"` task) or an AskUserQuestion, and when phase
   verification ends `human_needed`:
   - First do everything a machine can: the checkpoint's `what-built`
     preparation, builds, tests, and any part of its checks you can run.
   - `human-verify`: continue the plan with the response
     `approved (deferred to human review, see autonomy/REVIEW.md)`.
   - `decision`, blocking-human included: continue with the plan's
     Recommended option, or the most reversible one if none is marked.
   - `human-action` that truly needs hands, a device or credentials, or a
     package-legitimacy check before an install: do not fake it and never
     install the package. Mark the task parked in REVIEW.md, skip what
     depends on it, and go on with the next plan or wave that does not.
   - Append each one to `autonomy/REVIEW.md` (committed, newest last):
     phase, plan and task; what you assumed or chose; the exact steps for
     the human to check it, with commands; and what to undo if the answer
     is no. Tell the human to answer in `autonomy/RESPONSE`.
   - Never write `autonomy/WAITING`.

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

7. **Phase done.** When every plan that is not parked has a SUMMARY and
   phase verification has run (`passed`, or `human_needed` with its items
   added to REVIEW.md), create `autonomy/DONE` with a short summary that
   lists the open REVIEW.md items and parked plans, and commit it. The
   driver stops on that file. The next phase
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
- Do not ask questions; nobody will answer. Human gates go to autonomy/REVIEW.md
  and the work carries on.
  Everything else gets your best judgement, recorded under "Blocked".
- Keep autonomy/STATE.md under about 150 lines; collapse old log lines.
