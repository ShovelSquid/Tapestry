---
phase: quick-260924-0ii
plan: 01
subsystem: main/commands (lock model)
tags: [locks, layout, agents, permissions, tdd]
status: complete
requires: [02.4 lock model]
provides: [layout lock aspect (lock.layout, lock.layout.allow) for Phase 2.5 place]
affects: [Phase 2.5 SpatialCommands.place (02.5-04)]
tech-stack:
  added: []
  patterns: [aspect-generic resolver, type-level red via expectTypeOf and tsc]
key-files:
  created: []
  modified:
    - app/src/main/commands/locks.ts
    - app/src/main/commands/locks.test.ts
decisions:
  - "Q-03: layout gets no default-policy constant and no LockPolicy field, because text has none. Only delete has a switch (NON_AGENT_NOTES_DELETE_LOCKED), and AGENT_NOTES_OPEN_TO_AGENTS covers every aspect"
  - "Layout refusal sentence is `<note> layout is locked by <owner>`; Phase 2.5-04 Task 1 should record it"
metrics:
  duration: ~10 min
  completed: 2026-09-24
plan_head_before: 093f430
actuals:
  tokens: 4000
  tasks: 2
  commits: 3
---

# Quick 260924-0ii: Layout as a third lock aspect Summary

`LockAspect` now includes `'layout'`, with keys `lock.layout` and `lock.layout.allow`. Layout resolves exactly as text does: notes that no agent created are locked to their creator, agent notes are open to agents, malformed values fail closed, and the allow list is honoured. No existing command is gated on it.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (red) | 4cceebb | test(quick-260924-0ii): pin layout as a third lock aspect mirroring text (red) |
| 1 (green) | da4014b | feat(quick-260924-0ii): add layout as a third lock aspect with text's defaults |
| 2 | 4d78287 | test(quick-260924-0ii): prove no NoteCommands path is gated on lock.layout |

## What changed

- **locks.ts:** the union is now `'text' | 'delete' | 'layout'`, and its doc comment names `rank` as the only deferred aspect. The module header lists three aspects and names `lock.layout` / `lock.layout.allow` literally, which 02.5-04's precondition grep relies on. It also says that no command checks layout yet and that Phase 2.5 `place` is the first caller. A note next to the constants records the Q-03 resolution, and a comment above the delete branch in `resolveLock` says that text and layout share the unconditional default. The union is the only executable line that changed. `LockPolicy` and `DEFAULT_LOCK_POLICY` are unchanged.
- **locks.test.ts:** adds a new `layout aspect (pure)` describe block with 15 tests: type pin, keys, non-agent and agent defaults, and a parity sweep that checks 6 creators × 4 policies × 7 fixtures against text. It also covers explicit and malformed values, refusal text, owner and prefix matching, allow lists, WR-01, D-10 and independence in both directions. Two real-kernel tests were added inside `locks through NoteCommands`: "a lock.layout alone gates no existing command" and "lock.layout open on a person's note opens neither text nor delete". The only edits outside the new blocks are the two import additions (`expectTypeOf` and `type LockAspect`).

## TDD Gate Compliance

- **RED (4cceebb):** `npx tsc --noEmit -p tsconfig.node.json` exited 2 with **35 errors, all in locks.test.ts**: 34 TS2345 (a `'layout'` argument is not a `LockAspect`) and 1 TS2344 (the `expectTypeOf` pin). vitest passed 60/60 at runtime, as expected, because the resolver is aspect-generic. That runtime pass also confirms the resolver already mirrors text for any non-delete aspect.
- **GREEN (da4014b):** the node typecheck exits 0, and locks.test.ts passes 60/60 (45 at the base).
- **Guard (4d78287):** both kernel tests passed on their first run. No command is layout-sensitive.

## Verification (final)

- `npx vitest run` (app): **16 files, 241 passed, 0 failed** (224 at the base; locks.test.ts went from 45 to 62).
- `npx tsc --noEmit -p .`: exit 0. This is a solution-style config (`files: []` plus references), so it checks **zero files** and is kept only as Kaelen's gate.
- `npx tsc --noEmit -p tsconfig.node.json`: exit 0. `npx tsc --noEmit -p tsconfig.web.json`: exit 0. These two are the effective typecheck.
- Scope gate: `git diff --name-only 093f430 -- app plugins packages tapestry` lists exactly `app/src/main/commands/locks.test.ts` and `app/src/main/commands/locks.ts`. notes.ts, schemas.ts and agent-tools.ts are untouched (Q-04).

## Decisions

- **Q-03 resolution:** no new constant and no new `LockPolicy` field. Text's non-agent default is the unconditional `lockedToCreator` fall-through in `resolveLock`, not a named constant. Only delete has one (`NON_AGENT_NOTES_DELETE_LOCKED`, 02.4 D-05), and `AGENT_NOTES_OPEN_TO_AGENTS` (02.4 D-06) applies to every aspect. Mirroring text therefore means layout has no toggle. The locks.ts comment says that adding one later is a change of one constant plus one field.
- **Refusal sentence:** a layout check produces `<note> layout is locked by <owner>`, with a blank owner shown as `(unknown)`. For example, `checkLock('n1', {}, human user.kaelen, plugin agent.claude, 'layout')` returns `n1 layout is locked by user.kaelen`. Phase 2.5-04 Task 1 should record this sentence.

## Note for Phase 2.5-04 (not edited here)

Q-02 locks the layout of notes created by `plugin obsidian.bridge` and by every other non-agent plugin to their creator. For example, a vault note refuses an agent with `<note> layout is locked by obsidian.bridge`. 02.5-04's working assumption ("open otherwise") and its Task 3 D-13 vault fixture ("written by a non-human actor, so open by default") therefore need adapting in that plan's Task 1. The fixture must either be created by an agent actor or carry `lock.layout` set to `open`. The 02.5 plan lives in another worktree and was not touched.

## Deviations from Plan

None. The plan was executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: app/src/main/commands/locks.ts (the union line matches `'text' | 'delete' | 'layout'`; `lock.layout` present)
- FOUND: app/src/main/commands/locks.test.ts (`layout aspect`, `gates no existing command` and `opens neither text nor delete` each present)
- FOUND commits: 4cceebb, da4014b, 4d78287 (3 commits since 093f430, each containing only its intended file)
