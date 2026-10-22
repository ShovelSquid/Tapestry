# Codex startup instructions

At the start of a session in this repository, read the project guidance under
`.claude/` before acting:

- Read `.claude/CLAUDE.md` when it exists.
- Read `.claude/settings.json` for project hooks and coordination behavior.
- Read the relevant `.claude/skills/*/SKILL.md` for tasks those skills cover.

Follow applicable project guidance alongside these instructions. In particular,
this is a shared worktree: inspect current changes before editing, coordinate
through `tools/claims/claim` when touching shared files, and stage only the
paths belonging to your task.

Keep development moving when a task is blocked: record the blocker, leave its
protected files untouched, and continue with independent research, planning,
review, or implementation that does not depend on the blocked action. Never
change execution paths to bypass an approval or sandbox boundary. See
`.context/CONTINUOUS-GSD.md` for the unattended development setup.

GSD planning state lives in `.planning/`; consult its current state and the
applicable phase plan before doing GSD phase work. The GSD runtime is installed
at `~/.claude/gsd-core` and its workflows may reference that location.
