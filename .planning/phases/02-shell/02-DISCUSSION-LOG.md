# Phase 2: Shell - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log records the autonomous defaults selected.

**Date:** 2026-10-22
**Phase:** 2-shell
**Areas discussed:** Workspace shell and explorer, tool and palette lifecycle, vault selection and persistence, input and background behavior

---

## Workspace shell and explorer

| Option | Description | Selected |
|--------|-------------|----------|
| Left docked panel with resize/close/float | Obsidian-style explorer, left by default and draggable away to float | ✓ |
| Fixed sidebar | Cannot float or close | |
| Palette-only navigation | No explorer panel | |

**Agent's auto choice:** First option, carrying forward Kaelen's locked decision and HUMAN-QUESTIONS item 7.

## Tool and palette lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Temporary full-window views with Esc return | Cmd-K palette opens tools; Simulation groups simulation canvas, brushes, and timeline | ✓ |
| Keep dock tabs | Existing dock remains primary navigation | |
| Open separate OS windows | Every tool gets its own native window | |

**Agent's auto choice:** First option, carrying forward Kaelen's locked decision and HUMAN-QUESTIONS item 8.

## Vault selection and persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Default `world/vault/` plus folder picker and remembered path | Open any folder and restore the last vault on restart | ✓ |
| Repository world only | Reuse `--world` as the vault | |
| Ask every launch | Do not persist selection | |

**Agent's auto choice:** First option, per the locked Phase 2 requirement; keep simulation `--world` separate.

## Input and background behavior

| Option | Description | Selected |
|--------|-------------|----------|
| One focus-aware shell router and preserve hidden tool lifecycle | Esc returns to workspace, shell shortcuts do not corrupt terminal or simulation input, hidden terminals live, hidden sim clock pauses | ✓ |
| Let each tool handle all shortcuts | No shared precedence | |
| Stop all tools while hidden | Hidden tool processes and clocks stop | |

**Agent's auto choice:** First option, directly matching Phase 2 acceptance criteria and the locked autonomy/screenshot requirements.

## the agent's Discretion

- Internal palette matching and shell type names.
- egui implementation details for a draggable floating explorer.
- Safe persisted-layout migration and exact background I/O thread structure.

## Deferred Ideas

- Phase 3 graph editing and nested graphs; Phase 4 search; Phase 5 proposals; Phase 6 tree and replay UI.
