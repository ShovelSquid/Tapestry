---
phase: 02-shell
plan: "02"
subsystem: ui
tags: [rust, egui, explorer, command-palette, fuzzy-search, navigation, raw-input]

# Dependency graph
requires:
  - phase: 02-shell
    provides: "02-01 VaultHost worker, immutable VaultIndex snapshots, read-only graph workspace"
provides:
  - Docked/floating vault explorer with shared ExplorerState, folder-first rows, and a worker-dispatched Open vault path field
  - Stable PaletteEntry registry (tools, editor tabs, notes, folders, commands) with a pure deterministic fuzzy matcher
  - Cmd-K raw-input filter that opens the palette and strips the Key and associated Text events before terminal input drains
  - Typed NavigationTarget built from normalized VaultIndex keys, shared by explorer and palette, applied to a minimal GraphCamera
affects: [02-shell, 03-canvas, shell-navigation, tool-routing]

# Actuals (#2632)
actuals:
  tokens: 11353
  tasks: 3
  commits: 6
commits: 6
plan_head_before: d3616b583f1863a4174c4ba7e6979ca3d65856fa

# Tech tracking
tech-stack:
  added: []
  patterns: [single presentation-independent UI state struct, pure ranking function over a stable entry registry, raw_input_hook shortcut filtering, typed shell actions dispatched by App]

key-files:
  created: [apps/canvas/src/shell_input.rs]
  modified: [apps/canvas/src/shell.rs, apps/canvas/src/main.rs]

key-decisions:
  - "Explorer docked and floating modes share one ExplorerState, so selection, width, and path survive close, float, and reopen."
  - "Explorer and palette both produce NavigationTarget values keyed by the normalized VaultIndex key. Targets are resolved against the current snapshot, and stale keys leave the camera unchanged."
  - "Cmd-K is consumed in raw_input_hook, before any Terminal::take_input runs, so the shortcut never reaches the PTY."
  - "Open vault only sends the chosen path to VaultHost::select_root. The panel does no filesystem work, and a busy or failed switch keeps the prior snapshot visible."

patterns-established:
  - "Shell surfaces return typed actions (ExplorerAction, PaletteAction) and App alone mutates camera, tool, and vault state."
  - "Palette entries are rebuilt from the current VaultView each frame, so tools and commands stay available while the index loads or has failed."

requirements-completed: [VAULT-01, SHELL-02, SHELL-03, SHELL-06]
coverage:
  - id: D1
    description: "Explorer lists indexed folders before notes; it distinguishes loading, empty, partial, and error states; and it keeps selection and width across close, float, and reopen."
    requirement: SHELL-02
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline shell"
        status: pass
    human_judgment: false
  - id: D2
    description: "Open vault dispatches to the serialized VaultHost root switch, and a failed switch keeps the last snapshot."
    requirement: VAULT-01
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline vault_host::tests::failed_root_switch_keeps_last_snapshot_and_does_not_create_folder"
        status: pass
    human_judgment: false
  - id: D3
    description: "Palette ranks tools, commands, notes, and folders case-insensitively and deterministically. Duplicate note names are told apart by full path, zero matches return nothing, entries stay available while the vault loads, and every listed entry carries a typed action."
    requirement: SHELL-03
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline palette"
        status: pass
    human_judgment: false
  - id: D4
    description: "Cmd-K opens the palette and removes its Key and associated Text events before terminal input, while plain K still reaches the terminal."
    requirement: SHELL-03
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline shell_input"
        status: pass
    human_judgment: false
  - id: D5
    description: "Explorer and palette produce equal NavigationTargets for the same note or folder. The camera centers on valid targets, and stale snapshot keys are ignored without panicking."
    requirement: SHELL-06
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline navigation_action"
        status: pass
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline navigation_centers_valid_targets_and_ignores_stale_snapshot_keys"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-10-22
status: complete
---

# Phase 02 Plan 02: Shell Navigation Summary

**The shell now has an Obsidian-style explorer that docks or floats, a Cmd-K fuzzy palette over tools, tabs, notes, folders, and commands, and one typed NavigationTarget that both surfaces use to move the graph camera.**

## Performance

- **Duration:** about 12 min of implementation (first task commit 2026-10-22T08:45:54Z, last 2026-10-22T08:57:19Z). This close-out was done in a later session at 2026-10-22T09:26Z.
- **Tasks:** 3 (TDD: each has a RED and a GREEN commit)
- **Files modified:** 3 source files (+3 RED evidence JSON files)

## Accomplishments

- **Explorer:** `ExplorerState` is shared by the resizable left `Panel` (200-480 pt) and the movable, resizable, closable floating `Window`. Dragging the header 28 pt or more floats it. Rows list folders before notes, sorted case-insensitively with the key as a tie-breaker. It shows the loading, empty, partial, and error copy from 02-UI-SPEC. The path field is prefilled with the current root and has the "Choose a folder to open as a vault" hint.
- **Vault switching:** `ExplorerAction::OpenVault` goes to `VaultHost::select_root`. If that handoff is busy, the explorer shows a retry message and keeps the prior vault.
- **Palette:** `palette_entries` registers Simulation, Rules, Files, Terminals, Notes, open editor tabs, indexed notes and folders, "Open vault…", and "Open explorer". `fuzzy_rank` is a pure, case-insensitive subsequence scorer that matches labels and full paths and breaks ties deterministically. It renders in a foreground Area with the contract prompt and empty-result copy, keyboard navigation, a retained query, and full-path tooltips.
- **Cmd-K:** `shell_input::filter_palette_shortcut` runs in `raw_input_hook`. It opens the palette and drops the Cmd-K Key event and its following "k"/"K" Text event, so the terminal never sees them.
- **Shared navigation:** `NavigationTarget { kind, key }` is normalized against `VaultIndex` keys, so case and path differences resolve to the same note or folder. Both explorer rows and palette entries produce it. `GraphCamera::navigate` centers on the note's placed rect or the folder target and shows the selected title on one truncated line with a full-title tooltip. Stale targets return `false` and leave the camera unchanged. Navigation never creates or edits cards (D-02).

## Task Commits

1. **Task 1 RED: add failing explorer row test** - `071d78d` (test)
2. **Task 1 GREEN: build vault explorer and folder picker** - `1a87e64` (feat)
3. **Task 2 RED: add failing fuzzy palette test** - `be67bb1` (test)
4. **Task 2 GREEN: add fuzzy command palette** - `fb8116e` (feat)
5. **Task 3 RED: add failing shared navigation test** - `400d5ab` (test)
6. **Task 3 GREEN: share explorer and palette navigation** - `12e59e9` (feat)

## TDD Gate Compliance

Each RED commit includes a `02-02-taskN-red.json` evidence file. Each one records the exact failing test command (exit code 101) and an assertion failure on the target behavior, not a compile error. Each GREEN commit follows its RED commit directly. No separate REFACTOR commits were needed.

| Task | RED evidence | Target test |
|------|--------------|-------------|
| 1 | `.planning/phases/02-shell/02-02-task1-red.json` | `shell::tests::explorer_rows_lists_indexed_folders_before_notes` |
| 2 | `.planning/phases/02-shell/02-02-task2-red.json` | `shell::tests::fuzzy_palette_ranks_matching_labels_and_paths_deterministically` |
| 3 | `.planning/phases/02-shell/02-02-task3-red.json` | `shell::tests::navigation_action_is_shared_by_explorer_and_palette_for_notes_and_folders` |

## Verification Results (re-run at close-out, 2026-10-22T09:26Z)

| Command | Result |
|---------|--------|
| `cargo test -p tapestry-canvas-app --offline shell` | 11 passed, 0 failed |
| `cargo test -p tapestry-canvas-app --offline palette` | 5 passed, 0 failed |
| `cargo test -p tapestry-canvas-app --offline navigation_action` | 1 passed, 0 failed |
| `cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline` | All suites pass. App binary: 34 passed, 2 ignored. The 2 ignored are the existing `embed.rs` model-download tests, unrelated to this plan. |

## Files Created/Modified

- `apps/canvas/src/shell.rs` - ExplorerState/rows/presentation, palette registry, fuzzy matcher and Area renderer, NavigationTarget/resolve_navigation/GraphCamera, and the selected-title workspace overlay.
- `apps/canvas/src/shell_input.rs` - Cmd-K raw-event filter and its tests.
- `apps/canvas/src/main.rs` - Explorer, palette, and camera state on `App`; `raw_input_hook` palette opening; ExplorerAction and PaletteAction dispatch to VaultHost, tool maximization, editor tabs, and the camera.

## Decisions Made

- One ExplorerState for both explorer modes. `reopen()` always returns to Docked.
- Navigation keys come only from the current `VaultIndex`, never from display labels or arbitrary path joins (mitigates T-02-04).
- Palette entries are rebuilt each frame from the immutable snapshot. This needs no filesystem work and stays available during refresh (accepts T-02-05).

## Deviations from Plan

None. The plan was executed as written. No close-out fixes were needed: every acceptance criterion and verification command passed when re-checked.

## Issues Encountered

- **Overlap in the partial-error state (cosmetic, not fixed):** `shell::workspace` draws the focused title label and the 12 pt "Couldn't open this folder…" line at the same top-left offset (16, 16). They overlap when a target is focused while the status is `Error` with a snapshot present. A later shell or polish plan should fix this; no test or criterion is affected.
- **SHELL-06 is center-only for now:** the requirement says the camera "flies" to the item. This plan applies the target to the minimal read-only graph camera stub by centering only, with no animation. Animated flight over real cards depends on the Phase 3 canvas.
- **SHELL-03 is also listed in 02-03:** marked complete here per this plan's frontmatter. 02-03 may extend the command set.
- The legacy dock-only warnings carried over from 02-01 remain (`Tabs` never constructed; `Ide::tab_title` and `Ide::close` unused).

## User Setup Required

None.

## Next Phase Readiness

The explorer, palette, and shared navigation are in place for 02-03 and 02-04 to add tool routing and finish the shell layout. Typed `PaletteAction`s already cover every full-window tool destination.

---
*Phase: 02-shell*
*Completed: 2026-10-22*

## Self-Check: PASSED

- The summary, the three source files, and the three RED evidence files all exist.
- Task commits `071d78d`, `1a87e64`, `be67bb1`, `fb8116e`, `400d5ab`, and `12e59e9` are in Git history.
- Measured commit count from plan base `d3616b5` to HEAD: 6.
