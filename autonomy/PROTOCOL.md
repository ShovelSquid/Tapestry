# Autonomous protocol (ws/ui)

Sessions are started by `autonomy/run.sh` with nobody watching. Each session
advances **one Design plan** (or part of one), then exits. The machinery is
copied from `ws/windows`. The difference is that the work list is not GSD.
It is the plan files in `~/Tree/Design`, Kaelen's design folder in the Tree
vault.

## The work list

- A plan is any `~/Tree/Design/Plan - *.md` whose YAML frontmatter has
  `status: ready for autonomy` or `status: in progress (ws/ui)`.
- Order: `in progress (ws/ui)` first, then the oldest `created:` date, then
  the filename.
- Anything else, whether `draft`, `done …`, `parked …` or a missing status,
  is not yours. Specs (`Spec - *.md`) are inputs, not plans; edit them only
  where a plan's task says to.
- The plan's own "Rules for the session running this" section wins over
  this protocol wherever the two differ. That covers read-only files, build
  and publish steps, the one screenshot, and "stop at the end, don't start
  app work".

## Each session

1. **Orient.** Run `git status` and `git log --oneline -8`. Read
   `autonomy/STATE.md`, then list the plans:
   `grep -H '^status:' ~/Tree/Design/Plan\ -\ *.md`.
   - `autonomy/STOP` is the operator's gentle stop, handled by the driver
     between sessions. Never create, delete or commit it.
   - If the tree is dirty, the previous session was cut off. Read the
     "In progress" section and any `wip:` commits, then either finish that
     work and commit it, or `git checkout -- . && git clean -fd` (never
     touching ignored files) and record why under "In progress".

2. **Act on the human's review answers.** If `autonomy/RESPONSE` exists,
   the human answered one or more items in `autonomy/REVIEW.md`. An
   `approved` closes the item. Issues are real bugs: fix them before you
   start new work, and never mark them approved. Record the answer on the
   item in REVIEW.md and delete RESPONSE.

3. **Work the plan.** Take the first plan on the work list.
   - When you start a plan, change its frontmatter `status:` line to
     `status: in progress (ws/ui)`. That line is the only edit you make
     to the plan file.
   - **Snapshot before editing ~/Tree.** ~/Tree is not under git. Before
     you first change any file under `~/Tree` in this session, copy it to
     `autonomy/snapshots/<plan slug>/<path relative to ~/Tree>`, keeping a
     copy that already exists, since that is the pre-plan original.
     Commit the snapshot before editing. This is the undo.
   - Work the tasks in order. After each task, record it under "In
     progress" in STATE.md (task number, files touched, what is left) and
     commit that together with any repo changes.
   - Work that belongs in the app (`app/`, `src/`, …) happens only when a
     plan's task asks for it, on this branch. Before committing anything
     under `app/`, run `npm --prefix app run build:js`, then
     `npm --prefix app run typecheck` and `npm --prefix app run test`.
     Fix what you broke. Node deps: `npm install` at the repo root.
   - Publishing through the Artifact tool is allowed when a plan's task
     says to publish. Use exactly the URL the plan gives, read it first, and
     never create a new artifact that the plan did not ask for.

4. **Never stop for a human gate; queue it and keep going.** When a task
   needs eyes, hands, a device, credentials or Kaelen's taste:
   - First do everything a machine can: builds, the plan's screenshot, and
     any check you can run headless.
   - Taste or look checks: make your best call, finish the task, and queue
     the check.
   - Something truly impossible without a human, such as credentials or a
     package legitimacy check before an install: do not fake it and never
     install the package. Park that task, skip what depends on it, and
     carry on.
   - Append each one to `autonomy/REVIEW.md` (committed, newest last):
     the plan and task, what you chose, the exact steps for the human to
     check it, and what to undo (the snapshot path) if the answer is no.
     Tell the human to answer in `autonomy/RESPONSE`.

5. **Plan done.** When every task of the plan is done or parked, do the
   plan's own report step, then change its `status:` line to
   `status: done (ws/ui, <YYYY-MM-DD>)`, or to
   `status: parked (ws/ui, <YYYY-MM-DD>) — see autonomy/REVIEW.md` if a task
   is parked. Add a line under "Plans" in STATE.md.

6. **Hand off.** Update `autonomy/STATE.md`:
   - "In progress" is either empty or concrete enough to resume cold.
   - "Log" gets one line per session: date, plan and tasks, commits, result.
   - "Learned" records anything surprising about the environment.
   - "Blocked" records questions a human would have been asked, with the
     option you took.

   Commit it separately as `autonomy: <one line>`.

7. **Nothing left.** When no plan is ready or in progress, create
   `autonomy/DONE` listing the plans finished since the last DONE and
   the open REVIEW.md items, then commit it. The driver stops on that
   file. Kaelen marks new plans `ready for autonomy` and deletes DONE to
   continue.

8. **Exit.** Print one line starting with `SESSION:` that says what you
   committed, or `SESSION: no commit` and why. Never leave a dirty tree.

## Rules

- Stay on branch `ws/ui` in this worktree. Never switch, create or rename
  branches, and never `cd` into another worktree or the primary checkout at
  `~/Tapestry`.
- In `~/Tree`, touch only the files your plan names, and the plan's own
  status line. Never edit Kaelen's notes: the plan lists them as read-only,
  and so are `Dump.md`, `Index … Notes.md` and any image. Never delete
  anything in ~/Tree.
- Never push; the driver pushes after a committing session. Never
  force-push. Never rewrite published history.
- Tests must never open real data: `~/Documents/we.tree`, `~/House Party`,
  `~/Tapestry`, `~/Tapestrees`. Use temp directories.
- Commit messages: `design(<plan slug>): …` for plan work,
  `autonomy: …` for driver state. End every message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not ask questions; nobody will answer. Human gates go to
  autonomy/REVIEW.md and the work carries on. Everything else gets your
  best judgement, recorded under "Blocked".
- Keep autonomy/STATE.md under about 150 lines; collapse old log lines.
