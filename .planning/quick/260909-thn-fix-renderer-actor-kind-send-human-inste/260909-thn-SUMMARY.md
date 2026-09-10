---
phase: quick-260909-thn
plan: 01
subsystem: renderer
tags: [electron, renderer, kernel, ipc, actor-kind]
status: complete
quick_id: 260909-thn

requires: []
provides:
  - "Renderer kernel.submit calls that pass the kernel-accepted actor kind 'human'"
affects:
  - "Phase 02 feasibility gate (editable note plugin, spatial interaction) is unblocked for renderer commits"

tech-stack:
  added: []
  patterns:
    - "Renderer-originated commits are journaled as actor kind human, actor id local; main-process plugin-host commits remain system/tapestry"

key-files:
  created: []
  modified:
    - app/src/renderer/App.tsx

decisions:
  - "Kept actorKind typed as string across SDK/preload/bridge; introducing an ActorKind union is a wider follow-up, not part of this fix"

metrics:
  duration: "~3 minutes"
  completed: "2026-09-09"

actuals:
  tokens: 460
  tasks: 1
  commits: 1
plan_head_before: 4e2184a106e3c6a1b7ca28ed9397a7d59e847cb7
---

# Quick Task 260909-thn: Fix renderer actor kind (send human instead of user) Summary

All seven `window.tapestry.kernel.submit(...)` call sites in `app/src/renderer/App.tsx` now pass the literal `'human'` as the actor kind, so the C++ kernel's `isValidActorKind` (which accepts only `human | plugin | system`) no longer rejects renderer commits with `Kernel rejected: user local`.

## What Changed

- `app/src/renderer/App.tsx`: lines 203, 246, 293, 332, 393, 461, 541 changed from `'user',` to `'human',`. The actor id `'local'`, the message and the ops arguments are untouched. Diff is exactly 7 insertions / 7 deletions in one file.
- Main-process plugin host (`submit('system', 'tapestry', ...)`) untouched, as required.

## Verification

- `cd app && npx tsc --noEmit -p tsconfig.web.json` exits 0.
- Zero non-comment occurrences of `'user',` remain in App.tsx.
- Every line directly beneath a `kernel.submit(` call is `'human',` (grep reads lines 203, 246, 293, 332, 393, 461, 541).
- Human check (end-of-phase, not run here): create a note in `npm --prefix app run dev`; expect a live node and a `.tree` @commit naming the actor as `human local`.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | a9d4f8d | fix(quick-260909-thn): send actor kind human from renderer kernel.submit |

## Deviations from Plan

None - plan executed exactly as written.

## Follow-up Observation (not a task)

`actorKind` is declared as plain `string` in `sdk/src/index.ts`, `app/src/renderer/global.d.ts`, `app/src/preload/index.ts` and `app/src/main/kernel-bridge.ts`. A `'human' | 'plugin' | 'system'` union would have caught this at typecheck time; that is a cross-package change and belongs to the plugin-host/IPC hardening work.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: app/src/renderer/App.tsx
- FOUND: commit a9d4f8d
