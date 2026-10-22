---
phase: 02-shell
plan: "04"
subsystem: ui
tags: [rust, egui, shell, screenshot, simulation-clock, persistence, egui_dock-removal]

# Dependency graph
requires:
  - phase: 02-shell
    provides: "02-03 Destination routing, Ide handoffs, and shell_input router (every tool reachable without the dock)"
provides:
  - shell::ShotSchedule, which fires TAPESTRY_SHOT once by wall-clock delay from App startup, from the graph or any hosted view
  - clock_step / Destination::runs_simulation_clock, so the simulation clock and catch-up run only while Simulation is the destination
  - shell::ShellState saved locally as shell.json (explorer mode, width, floating place, selection; files view folder; open editors) with safe defaults for missing or malformed JSON
  - shell::legacy_layout_place, which reads the old synced layout record one time as a fallback and never writes it
  - A dock-free app. egui_dock, DockState, Tabs/TabViewer, and Panes are removed; Tab variants and their Debug names stay
  - A File view header with the editor name and a close link while the buffer is saved
  - shell::workspace_overlay_rects, which puts the graph title below the partial-error line
affects: [02-shell verification, 03-canvas, shell persistence, agent screenshots]

# Actuals (#2632)
actuals:
  tokens: 12300
  tasks: 2
  commits: 4
commits: 4
plan_head_before: cb36c93eb1011a82dd9effcad27356b85c6e1067

# Tech tracking
tech-stack:
  added: []
  patterns: [wall-clock screenshot schedule independent of simulation ticks, pure clock_step gate keyed on Destination, local shell.json with serde(default) and fallible parse, read-only migration from a retired synced record]

key-files:
  created: [.planning/phases/02-shell/deferred-items.md]
  modified: [apps/canvas/src/main.rs, apps/canvas/src/shell.rs, apps/canvas/Cargo.toml, Cargo.lock]

key-decisions:
  - "TAPESTRY_SHOT is path:seconds of wall-clock time from App construction. It is split at the last colon, and the delay must be finite and between 0 and 86400 s. It fires once from any destination. TAPESTRY_VIEW is unchanged."
  - "While Simulation is hidden, clock_step returns None and run_clock returns before touching the clock, the playhead, or catch_up. Ide::begin_frame and terminal owners still run every frame."
  - "Local shell.json holds the explorer presentation, the files view folder, and open editors. Vault choice stays in its own vault.json (02-01). The synced layout record is never written again."
  - "When shell.json is missing or malformed, the app reads root, here, and File tabs from the legacy synced layout without changing it. On restart the window opens on the graph (D-02); the legacy maximized tab is no longer restored."
  - "With the dock gone, a saved editor is closed from its File view header, using the existing Ide::close. An editor with unsaved changes shows no close link."
  - "Destination::primary_tab existed only for the synced layout and is removed."

patterns-established:
  - "Lifecycle timing that tests must cover goes in pure helpers (ShotSchedule::take_due, clock_step) called from App, because App cannot be built in tests."

requirements-completed: [SHELL-01, SHELL-04, SHELL-05]
coverage:
  - id: D1
    description: "TAPESTRY_SHOT captures by wall-clock delay from the graph or any hosted view, without waiting for simulation ticks, then closes the app."
    requirement: SHELL-04
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline screenshot_routing"
        status: pass
      - kind: automated_ui
        ref: "TAPESTRY_SHOT=target/shell-graph.png:0.5 target/debug/tapestry-canvas (exited on its own about 3 s in, PNG written)"
        status: pass
      - kind: automated_ui
        ref: "TAPESTRY_FILL=Terminals TAPESTRY_SHOT=target/shell-terminal.png:0.5 target/debug/tapestry-canvas (exited on its own about 2 s in, PNG written)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The simulation clock advances only while Simulation is visible; hidden views do no clock or catch-up work."
    requirement: SHELL-05
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline screenshot_routing (hidden_simulation_does_no_clock_work, visible_simulation_advances_its_clock, fires_by_wall_clock_from_every_view)"
        status: pass
    human_judgment: true
    rationale: "The gate is unit-tested. Whether the playhead holds while hidden in the running app is listed for a host check (HUMAN-QUESTIONS #18)."
  - id: D3
    description: "Explorer presentation, files folder, and open editors are restored from local shell.json, with defaults for missing or malformed JSON. The synced legacy layout is only read."
    requirement: SHELL-01
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline shell (shell_state_*, shell_legacy_layout_is_read_without_change)"
        status: pass
    human_judgment: true
    rationale: "The restore wiring in App::reopen and save_layout reads and writes the real state folder and was not run with a live restart here (HUMAN-QUESTIONS #18)."
  - id: D4
    description: "egui_dock and every dock type are gone from the manifest and source. Tab Debug names, which are the marks pane keys, are unchanged."
    requirement: SHELL-04
    verification:
      - kind: other
        ref: "! rg -n 'egui_dock|DockState|DockArea|TabViewer|NodeIndex' apps/canvas/Cargo.toml apps/canvas/src"
        status: pass
      - kind: unit
        ref: "cargo test -p tapestry-canvas-app --offline tool_routing_keeps_tab_debug_identities_for_marks_and_fill"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-10-22
status: complete
---

# Phase 02 Plan 04: Shell Lifecycle and Dock Removal Summary

**`TAPESTRY_SHOT` now captures by wall-clock delay from any view, the simulation clock stops while Simulation is hidden, shell state is saved locally in `shell.json` instead of the synced dock layout, and `egui_dock` is removed from the app.**

## Performance

- **Duration:** about 8 min (started 2026-10-22T09:46:36Z, last task commit 09:54:26Z)
- **Tasks:** 2, both TDD, each with a RED and a GREEN commit
- **Files modified:** 4 (main.rs, shell.rs, Cargo.toml, Cargo.lock), plus 2 RED evidence JSON files and deferred-items.md

## Accomplishments

- **Screenshots (Task 1):** `ShotSchedule::parse` reads `path:seconds`. `take_due` fires once when `started.elapsed()` reaches the delay, whatever the destination. `take_shot` keeps its PNG write and viewport close. Before this, the shot waited on `timeline.tick()`, so it would hang once hidden views stopped the simulation clock.
- **Hidden simulation (Task 1):** `clock_step` returns `None` unless `Destination::runs_simulation_clock()` (Simulation only). `run_clock` then returns before advancing the clock, moving the playhead, catching up, or requesting a repaint.
- **Shell state (Task 2):** `ShellState` (`#[serde(default)]`) is written to `shell.json` only when it changes, every 3 s and on exit. Screenshot runs never write it. `App::reopen` loads it. Malformed or missing JSON gives defaults, and then the old synced `layout` record is read one time for the files folder and editors. Nothing writes `layout` anymore.
- **Dock removal (Task 2):** Removed the `egui_dock` dependency (65 lines out of Cargo.lock, all its own packages or serde edges from its `serde` feature), plus `default_layout`, `Tabs`/`TabViewer`, `Panes`, `shared_tab`/`local_tab`/`forget_rects`, `App::dock`, `panes_kept`, `take_panes`, `panes`, `keep_file_tab`, and `Destination::primary_tab`. `Tab` keeps every variant and Debug name, and drops only its serde derives.
- **Editor close (Task 2):** File views show `Ide::tab_title` (with the dirty dot) next to "back to the canvas", and a `close` link that calls `Ide::close` and returns to the graph. The link appears only when the buffer has no unsaved changes.

## Task Commits

1. **Task 1: Decouple screenshot scheduling from simulation time and gate hidden clock work**
   - RED `1a6b092` test(02-04): add failing screenshot routing and hidden clock tests
   - GREEN `b45e0a4` feat(02-04): schedule screenshots by wall clock and pause hidden simulation
2. **Task 2: Persist shell state separately and remove the old dock implementation**
   - RED `e560979` test(02-04): add failing shell state, legacy layout, and overlay tests
   - GREEN `b3b14f0` feat(02-04): persist shell state locally and remove the egui_dock shell

## Files Created/Modified

- `apps/canvas/src/shell.rs`: ShotSchedule, runs_simulation_clock, ShellState/SavedExplorer, LegacyPlace/legacy_layout_place, workspace_overlay_rects, a serde-able ExplorerMode, and the screenshot_routing and shell_state tests
- `apps/canvas/src/main.rs`: clock_step and the gated run_clock, wall-clock take_shot, local shell state reopen/save, File view header, dock code removed, screenshot_routing tests
- `apps/canvas/Cargo.toml`, `Cargo.lock`: egui_dock removed
- `.planning/phases/02-shell/deferred-items.md`: out-of-scope findings

## Verification

- `cargo test -p tapestry-canvas-app --offline screenshot_routing`: 7 passed
- `cargo test -p tapestry-canvas-app --offline shell`: 34 passed
- `cargo build -p tapestry-canvas-app --offline` and `cargo build --workspace --offline`: ok
- `rg -n 'egui_dock|DockState|DockArea|TabViewer|NodeIndex' apps/canvas/Cargo.toml apps/canvas/src`: no matches
- `cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline`: canvas 21, canvas-app 59 (2 ignored), vault unit 9, blocks 18, frontmatter 33, grammar 2, index 4, links 18, scan 5, store 20, tracer 1, watch 3. All passed.
- Both screenshot automations ran before and after dock removal. Each wrote its PNG and closed on its own in 2-3 s.
- Warnings: the expected `Tabs`, `Ide::tab_title`, and `Ide::close` dead-code warnings are gone. The only warnings left are `vault_host::Command::Rescan` and `VaultHost::request_rescan`, which were already there before this plan.

## TDD Gate Compliance

Both tasks have a `test(02-04)` RED commit before the `feat(02-04)` GREEN commit. RED evidence is in `02-04-task1-red.json` and `02-04-task2-red.json`, and both check as `RED_EVIDENCE_OK`. Task 1 RED: 6 of 7 failed on assertions. `visible_simulation_advances_its_clock` passed against the existing behavior and stays as a regression guard. Task 2 RED: 5 failed on assertions. `shell_state_never_carries_the_legacy_layout_or_vault_choice` passed because the stub struct already had the final shape, and it stays as a structural guard. No refactor commit was needed.

## Decisions Made

See `key-decisions` in the frontmatter. In short: screenshots run on wall-clock time from startup; hidden Simulation does no clock work; shell presentation is saved locally in `shell.json`, separate from `vault.json`; the legacy synced layout is read once as a fallback and never written; restart opens on the graph.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Workspace title drew over the partial-error line (HUMAN-QUESTIONS #16)**
- **Found during:** Task 2, carried over from 02-02/02-03
- **Issue:** `shell::workspace` drew the selected note's title and the partial-error line at the same `canvas.left_top() + (16, 16)`.
- **Fix:** `workspace_overlay_rects` puts the error line first and the title 8 px below it. Without an error, the title keeps its spot.
- **Files modified:** apps/canvas/src/shell.rs
- **Verification:** `shell_workspace_title_and_partial_error_do_not_overlap`
- **Committed in:** e560979 (test), b3b14f0 (fix)

**2. [Rule 2 - Missing functionality] Closing an editor after dock removal**
- **Found during:** Task 2
- **Issue:** Editors could only be closed through the dock's tab close button. Without it, open buffers would pile up in Cmd-K, and they would also be saved to `shell.json` and reopened forever.
- **Fix:** File view header with `Ide::tab_title` and a `close` link (`Ide::close`, then back to the graph), shown only when the buffer is saved so unsaved changes are never dropped. This also clears the expected `tab_title`/`close` dead-code warnings without editing ide.rs.
- **Files modified:** apps/canvas/src/main.rs
- **Verification:** build has no warnings for them. The click path is not tested automatically (HUMAN-QUESTIONS #18).
- **Committed in:** b3b14f0

**3. [Rule 2 - Missing functionality] Files folder and open editors restore moved into shell.json**
- **Found during:** Task 2
- **Issue:** The synced dock layout used to restore the files view folder and open editor tabs. Dropping it without a replacement would lose both on restart.
- **Fix:** `ShellState` also stores `files_root`, `files_here`, and `editors`. The first run without `shell.json` reads them from the legacy record without writing it.
- **Files modified:** apps/canvas/src/shell.rs, apps/canvas/src/main.rs
- **Verification:** `shell_state_restores_saved_explorer_presentation_and_place`, `shell_legacy_layout_is_read_without_change`
- **Committed in:** b3b14f0

---

**Total deviations:** 3 auto-fixed (1 bug, 2 missing functionality)
**Impact on plan:** All keep existing user-visible behavior that the dock used to provide. No new dependencies.

## Issues Encountered

- **Tests overwrite the user's real vault choice (out of scope, logged).** After the full test run, the graph screenshot showed "Could not open vault folder …/tapestry-switch-source-…". A 02-01 `vault_host` worker test saves its temp root to the real `~/.local/state/tapestry/vault.json` through `ide::state_dir()`. This plan's test run did that at 02:52:44, and earlier runs probably did too. The file is in `vault_host.rs`, which this plan doesn't own, so it was not fixed. I left the user's `vault.json` as is and did not guess the earlier value. Logged in `deferred-items.md` and `.context/HUMAN-QUESTIONS.md` #17.
- **Restart behavior change:** the legacy `maximized` tab no longer reopens a hosted view at startup. The app opens on the graph per D-02, and `TAPESTRY_FILL` still works.

## Known Stubs

None added. The graph workspace stays the intended Phase 2 read-only stub from 02-01.

## Threat Flags

None. T-02-09 is mitigated: `ShellState::from_json` parses fallibly with `serde(default)`, out-of-range widths and non-finite positions are clamped or dropped, and the legacy record is read through `&serde_json::Value` and never written. T-02-10 is accepted and bounded: delays must be finite and at most 86400 s.

## Next Phase Readiness

Phase 2's four plans are done and the phase is ready for verification. Host checks are in HUMAN-QUESTIONS #15, #16, and #18. Fix the vault_host test pollution (#17) before relying on test runs in a live user environment.

## Self-Check: PASSED

- FOUND: apps/canvas/src/main.rs, apps/canvas/src/shell.rs, apps/canvas/Cargo.toml, Cargo.lock
- FOUND: .planning/phases/02-shell/02-04-task1-red.json, 02-04-task2-red.json, deferred-items.md
- FOUND commits: 1a6b092, b45e0a4, e560979, b3b14f0

---
*Phase: 02-shell*
*Completed: 2026-10-22*
