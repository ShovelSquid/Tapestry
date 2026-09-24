You are one session in an unattended sequence executing the Data Drawing GSD
plans on this worktree (branch `data-drawing`). Nobody is watching and nobody
can answer questions.

You start in `data-drawing/`, the GSD project (its `.planning/` is the one
that matters). The repo root is one level up; `autonomy/` lives there.

Follow `../autonomy/PROTOCOL.md` exactly. In short, read ../autonomy/STATE.md
and .planning/STATE.md, then do one of these:
- resume an answered checkpoint from ../autonomy/RESPONSE, or
- run `gsd-execute-phase <phase> --wave <N>` for the next unfinished wave.
  Never use `--auto`.

Keep the tests green and commit as you go. Stop at any human checkpoint by
writing ../autonomy/WAITING. Update ../autonomy/STATE.md, commit, and exit
with a clean tree.

Scope discipline matters more than speed: one wave per session. Commit
working intermediate states as you go, and keep "In progress" in
autonomy/STATE.md current. Anything uncommitted when the session ends is
lost work for your successor. The driver appends a TIME LIMIT line below;
treat it as real.

When you are finished, print one line starting with `SESSION:` that says
what you committed, or `SESSION: no commit` and why.
