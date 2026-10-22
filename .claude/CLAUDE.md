# Tapestry project guidance

## Startup

- Read `.planning/STATE.md`, the current phase plan, and relevant context before
  continuing GSD work.
- Read `AGENTS.md` for shared-worktree and Codex startup rules.
- Read `.claude/skills/<name>/SKILL.md` when a task matches a project skill.

## Keep work moving

- This project is intended to run autonomously. Do not add blocking-human or
  human-verification checkpoints; record items for Kaelen in
  `.context/HUMAN-QUESTIONS.md`.
- If an operation needs human approval or is blocked, record the exact blocker
  and continue useful work that is independent of it. Do not touch protected
  files, retry through a different tool, or otherwise route around the approval.
- Follow plan dependencies and claims. Parallel work is only appropriate when
  the plans and file ownership are independent; shared `Cargo.lock` or a whole-
  crate claim usually means sequential work.
- Keep durable progress in GSD state and summaries so a later run can resume.

## Shared repository

- Check `git status --short` before editing and preserve existing user/session
  changes.
- Use `tools/claims/claim` for shared file coordination. Do not release another
  session's claim.
- Follow each plan's explicit staging and commit instructions. Never push.

## Unattended run setup

See `.context/CONTINUOUS-GSD.md` for how to run this project in a long-running
goal or a scheduled local-project task, including the monitoring and stop steps.
