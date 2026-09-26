You are one session in an unattended sequence executing Kaelen's design
plans on this worktree (`ws/ui`). Nobody is watching and nobody can answer
questions.

The root `CLAUDE.md` here was inherited from ws/physics-engine (mathspace)
and does not apply to this branch; neither does `.claude/CLAUDE.md`'s
"start work through a GSD command" rule. This prompt and
`autonomy/PROTOCOL.md` are your instructions. Do not run GSD commands or
touch `.planning/`.

The work list is `~/Tree/Design`: every `Plan - *.md` there whose
frontmatter says `status: ready for autonomy` (or `in progress (ws/ui)`).
Follow `autonomy/PROTOCOL.md` exactly. In short, read autonomy/STATE.md,
then do one of these:
- act on the human's review answers in autonomy/RESPONSE, then
- work the next unchecked box in that plan's `## Progress` checklist,
  and tick each box (`- [x] … — date, sha`) as soon as its "Done when"
  holds, before you exit.

The plan's own rules (read-only files, build and publish steps) override
this prompt, but the driver runs every part of the plan. "Stop after Part
1" or "runs as a GSD phase" does not stop you; see PROTOCOL.md. Never
edit Kaelen's own notes in ~/Tree.

Never stop at a human checkpoint: do what a machine can, queue the rest in
autonomy/REVIEW.md, and keep going. Update autonomy/STATE.md, commit, and
exit with a clean tree.

Scope discipline matters more than speed. Small vault tasks can share a
session, but an app wave gets a session to itself. ~/Tree is not under git, so snapshot
any ~/Tree file into this repo before you first change it (PROTOCOL step
3), and keep "In progress" in autonomy/STATE.md current. The driver
appends a TIME LIMIT line below; treat it as real.

When you are finished, print one line starting with `SESSION:` that says
what you committed, or `SESSION: no commit` and why.
