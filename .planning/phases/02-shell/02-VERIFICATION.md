---
phase: 02-shell
verified: 2026-10-22T10:30:00Z
status: gaps_found
score: 9/11 must-haves verified
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/02-shell/02-01-PLAN.md
  - .planning/phases/02-shell/02-01-SUMMARY.md
  - .planning/phases/02-shell/02-02-PLAN.md
  - .planning/phases/02-shell/02-02-SUMMARY.md
  - .planning/phases/02-shell/02-03-PLAN.md
  - .planning/phases/02-shell/02-03-SUMMARY.md
  - .planning/phases/02-shell/02-04-PLAN.md
  - .planning/phases/02-shell/02-04-SUMMARY.md
  - apps/canvas/Cargo.toml
  - apps/canvas/src/ide.rs
  - apps/canvas/src/main.rs
  - apps/canvas/src/marks.rs
  - apps/canvas/src/notes.rs
  - apps/canvas/src/shell.rs
  - apps/canvas/src/shell_input.rs
  - apps/canvas/src/vault_host.rs
covered_digest: "v1:sha256:06f6764936909f66371fd98fa1cce3102d6f7becc99d5e8f1e163914afbb4509"
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "Selecting a note or folder in the explorer or palette moves the camera to it (ROADMAP SC2, second clause; SHELL-06)"
    status: failed
    reason: >-
      The shared navigation action is real and tested: explorer and palette both
      emit the same NavigationTarget, and GraphCamera::navigate resolves it to a
      world-space center and scale (shell.rs:281-398). But nothing reads that
      center or scale. The only read is the unit test at shell.rs:1576.
      shell::workspace (shell.rs:2062-2111) draws a fixed dot at
      canvas.center() and the focused item's title, whatever the target's
      position. Two notes at different world positions give the same picture
      apart from the title. No world-to-screen transform exists, so there is no
      camera to move. Centring without animation would be enough. A computed
      target that nothing uses is not. REQUIREMENTS.md marks SHELL-06
      [x] Complete, which is inaccurate. Reviewer IN-06 flagged the same thing.
    artifacts:
      - path: "apps/canvas/src/shell.rs"
        issue: "ResolvedNavigation.center/.scale are computed and stored in GraphCamera.focus but never used by workspace(); the renderer hardcodes canvas.center()"
    missing:
      - "Make workspace() place things through the camera: screen = canvas.center() + (world - focus.center) * focus.scale. At minimum, draw a marker for each indexed note (or folder region) at its placed position through that transform, so selecting a target visibly brings it to the centre and moves the rest."
      - "A test that two targets at different world positions produce different screen positions for the same world point (or that the target's world point maps to canvas.center())."
      - "Alternatively, accept via an override (below) and carry it to Phase 3. Phase 3's SCs cover a pan/zoom camera but do not explicitly wire explorer/palette selection to it, so add that to a Phase 3 SC if deferring."
behavior_unverified_items:
  - truth: "Terminals stay alive while hidden (ROADMAP SC4; plan 02-03 truth 'Existing App and Ide owners remain alive across view changes')"
    test: "Open Terminals from Cmd-K, start a long-running command (e.g. `ping localhost`), switch to the graph or Rules for 10+ s, then reopen Terminals."
    expected: "The same session is there, with output that kept arriving while it was hidden; no respawn."
    why_human: "Structurally sound: App.ide is never rebuilt, and each PTY's reader thread (term.rs:151-163) runs independently of drawing. But the only test (ide_handoffs_hidden_terminals_keep_session_owner) checks a local Arc that routing never touches, so it proves nothing about the Ide's sessions. Liveness across hide and show needs a real PTY."
human_verification:
  - test: "HUMAN-QUESTIONS #15 / #19a: drag the docked Explorer header slowly off the left edge; then resize, close (x), and reopen it via Cmd-K 'Open explorer' and Cmd-\\"
    expected: "It floats once the total drag passes ~28 px, the floating window can be moved, resized, and closed, and it reopens docked"
    why_human: "drag_floats_explorer and the state transitions are unit-tested; native egui drag and Window current_pos handling are not rendered (non-blocking)"
  - test: "HUMAN-QUESTIONS #16: focus a terminal, press Cmd-K, type a query, then Cmd-Shift-W from Terminals; check the Esc order (palette, opened card in Files, hosted view, graph cancel)"
    expected: "No k/w or query text reaches the PTY; Esc follows the locked precedence"
    why_human: "The filter and router are pure functions with passing tests; real winit key or IME event shapes are not exercised (non-blocking)"
  - test: "HUMAN-QUESTIONS #18: restart round trip of shell.json (explorer mode, width, position, selection, files folder, editors) and the sim playhead not moving while hidden"
    expected: "The shell comes back as left; the playhead holds while Simulation is hidden"
    why_human: "Serde round trip and clock_step are tested; a real quit and relaunch is not (non-blocking)"
  - test: "HUMAN-QUESTIONS #19b-e: palette scroll-to-selection, palette clicks over a terminal or marks, Enter in the vault field, a bad path keeps the old vault refreshing"
    expected: "As described in #19"
    why_human: "Logic covered by tests; native rendering and focus not exercised (non-blocking)"
  - test: "Terminal liveness while hidden (see behavior_unverified_items)"
    expected: "Session persists and keeps output"
    why_human: "Needs a real PTY across view changes"
---

# Phase 2: Shell Verification Report

**Phase Goal:** The app opens on one infinite canvas showing the vault with an Obsidian-style explorer and a Cmd-K palette, every existing tool still works full-window, and egui_dock is gone.
**Verified:** 2026-10-22T10:30:00Z
**Status:** gaps_found
**Re-verification:** No (initial verification)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: Launching shows a single canvas of the vault with no dock panes. `egui_dock` is absent from Cargo.toml and source. The vault defaults to `world/vault/` (created if missing), any folder can be opened, and the last one is reopened after restart. | ✓ VERIFIED | `grep -rn 'egui_dock\|DockState\|DockArea\|egui-dock'` over *.rs, *.toml, and Cargo.lock finds nothing. The screenshot `target/verify-graph.png` shows the top bar, docked Explorer, and blank workspace, with no dock panes. `world/vault` did not exist before my first run and was created by it, so create-if-missing is observed. Open-any-folder goes through `VaultHost::select_root`, which the switch tests exercise. Remembered-root logic is tested by `startup_prefers_the_remembered_vault_and_falls_back_to_the_default`, `vault_json_missing_is_told_apart_from_malformed`, and `missing_remembered_vault_opens_the_default_with_the_error`; the second screenshot shows the remembered (deleted) root failing and the default opening with the error. The canvas is a blank read-only stub by locked decision D-02 and the ROADMAP planning notes. There is no write-then-read round-trip test of `vault.json` (info only; the writer's `{"root":…}` format matches the tested reader). |
| 2 | SC2a: The explorer lists folders (graphs) and notes on the left, can be resized by its edge, closed and reopened, and dragged off to float. | ✓ VERIFIED (native drag in human verification) | `explorer_rows` lists folders, then notes; `egui::Panel::left(...).resizable(true).size_range(200..=480)`; the × button calls `state.close()`; reopen works through the palette `OpenExplorer` and Cmd-\\ (`route_explorer_toggle`). Float uses `drag_floats_explorer(total_drag_delta())`, so the CR-02 fix is real. Floating mode is an `egui::Window` that can be resized and closed. Tests: `explorer_rows_lists_indexed_folders_before_notes`, `explorer_state_keeps_selection_and_width_across_close_float_and_reopen`, `explorer_floats_after_a_slow_drag_adds_up_to_the_distance`, `cmd_backslash_toggles_the_explorer_and_never_types`. |
| 3 | SC2b / SHELL-06: Selecting a note or folder in the explorer or palette moves the camera to it. | ✗ FAILED | Both surfaces emit the same `Navigate(NavigationTarget)` (tested), and `GraphCamera::navigate` stores a resolved world `center` and `scale`. **Nothing reads `center` or `scale`**; the only use is the test at shell.rs:1576. `workspace()` draws a dot at `canvas.center()` plus the title, whatever the target is. No camera transform exists. See gaps. |
| 4 | SC3: Cmd-K opens a fuzzy palette listing every tool, note, folder and command, and opens while a terminal has focus. | ✓ VERIFIED | `palette_entries` covers Simulation, Rules, Files, Terminals, Notes, "Open vault…", "Open explorer", open editors, every indexed note, and every folder. `fuzzy_rank` is tested. `raw_input_hook` runs `filter_shell_chords` before egui or any terminal sees the events. Tests: `input_router_cmd_k_with_terminal_focus_opens_palette_before_pty_input`, `cmd_k_opens_palette_and_removes_key_and_text_before_terminal_input`, `plain_k_remains_available_to_the_terminal`, `palette_entries_include_duplicate_notes_folders_tabs_and_typed_destinations`. |
| 5 | SC4: Simulation (canvas, brushes, timeline), Rules, Files, Terminals, Notes and editor tabs open full-window from the palette. Highlight notes, tab notes and marks still work. Screenshots can be captured from any view. | ✓ VERIFIED | I took screenshots from Graph, Simulation, Rules, Files, Terminals, and Notes (`target/verify-*.png`). All closed by themselves, and each showed its tool full-window with "back to the canvas". Simulation groups brushes on the left, the canvas, and the timeline along the bottom. `highlights.show`, `tabnote.show`, and `marks.show` run after the view in every frame. Tests: `tool_routing_palette_actions_open_every_full_window_destination`, `tool_routing_simulation_groups_canvas_brushes_and_timeline`, `tool_routing_keeps_tab_debug_identities_for_marks_and_fill`, `screenshot_routing_fires_by_wall_clock_from_every_view`. |
| 6 | SC4 / 02-03: Terminals stay alive while hidden, and the App and Ide owners persist across view changes. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `App.ide` is never rebuilt on a destination change. The PTY reader thread (term.rs:151-163) feeds the vt100 parser whether or not the view is drawn. The only test, `ide_handoffs_hidden_terminals_keep_session_owner`, checks an `Arc` that routing never touches, so it is tautological. Routed to human verification. |
| 7 | SC5: Esc returns to the canvas through one router with defined precedence; the terminal exit chord never reaches the PTY; sim shortcuts fire only while the sim is shown. | ✓ VERIFIED | `route_escape` handles, in order: palette, then owner or tool, then return from a hosted view, then graph cancel. `filter_shell_chords` always removes Cmd-Shift-W and its text. `simulation_keys_active` gates Space, digits, Delete, Cmd-Z, arrows, and Home. Tests (all pass): `input_router_escape_follows_the_locked_precedence`, `input_router_exit_chord_is_filtered_in_both_event_forms`, `input_router_simulation_bindings_fire_only_while_simulation_is_hosted`, `input_router_open_rule_and_note_cards_take_esc_before_leaving`, `input_router_opened_card_claims_esc_only_where_it_is_drawn`. |
| 8 | 02-01: Watch, Store classification, rescans, and index rebuilds run on one worker; the UI reads immutable snapshots without waiting. | ✓ VERIFIED | `VaultHost` sends commands with `try_send` on a bounded channel, and `view()` clones an Arc snapshot. All filesystem work runs on the `tapestry-vault` thread. Tests: `watcher_message_refreshes_through_the_worker_store`, `periodic_fallback_rescan_publishes_external_changes`, `external_change_and_removal_publish_fresh_snapshots`, `own_write_hash_classification_does_not_request_refresh`, `folder_only_changes_publish_fresh_snapshots`. |
| 9 | 02-04: The simulation clock advances only while Simulation is visible, and screenshots don't wait for sim ticks. | ✓ VERIFIED | `clock_step` returns None unless the destination is Simulation. `ShotSchedule` uses the wall clock. Tests: `screenshot_routing_hidden_simulation_does_no_clock_work`, `screenshot_routing_visible_simulation_advances_its_clock`, `screenshot_routing_only_the_simulation_view_runs_its_clock`. The screenshots fired from non-sim views. |
| 10 | 02-04: No dock state or dependency remains, and the legacy layout and Tab-derived mark keys stay safe. | ✓ VERIFIED | `legacy_layout_place` only reads, and `shell.json` is separate from the legacy record. `Tab` variants are unchanged, and `format!("{tab:?}")` pane keys are still used in `tab_ui` and `hosted_view`. Tests: `shell_legacy_layout_is_read_without_change`, `shell_state_never_carries_the_legacy_layout_or_vault_choice`, `tool_routing_keeps_tab_debug_identities_for_marks_and_fill`. |
| 11 | All 16 code-review findings (CR-01, CR-02, WR-01 to WR-14) are actually fixed. | ✓ VERIFIED | I read each fix in the code. CR-01: open first, swap on success (vault_host.rs SelectRoot arm). CR-02: `total_drag_delta`. WR-01: `clear_error`. WR-02: `folders_changed`. WR-03: `Startup.fallback`. WR-04: `shell_write_due`. WR-05: `write_atomic` and the `Remembered`/`SavedShell` tri-state. WR-06: `opened_card_claims_keyboard`. WR-07: `ToolEscape`. WR-08: `sync_selection`, `open_fresh`, `scroll_to_me`. WR-09: `press_reaches_panes`, `overlay_rects`, `marks.palette_open`. WR-10: `opened_file_destination`. WR-11: `vault_path_from_field` and settle tickets. WR-12: `SelectError` and `is_finished`. WR-13: Cmd-\\ chord and Enter submit. WR-14: the `persist` flag. Each fix has a passing regression test. Screenshot runs left `~/.local/state/tapestry/*` byte- and mtime-identical (compared with stat before and after 7 runs). One interaction issue is listed under Anti-Patterns (the WR-01 clear hides the WR-03 notice). |

**Score:** 9/11 truths verified (1 failed, 1 present but behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/canvas/src/vault_host.rs` | Serialized vault worker, selection, snapshots | ✓ VERIFIED | 997 lines; wired from `App::new`; 14 tests |
| `apps/canvas/src/shell.rs` | Destinations, explorer, palette, navigation, shell state, workspace | ⚠️ PARTIAL | Substantive and wired, but `workspace()` ignores the camera target (gap 1) |
| `apps/canvas/src/shell_input.rs` | Chord filter, Esc router, sim key gate | ✓ VERIFIED | 485 lines; used in `raw_input_hook` and `keyboard` |
| `apps/canvas/src/main.rs` | Startup wiring, hosted views, raw input hook, clock and screenshot | ✓ VERIFIED | `VaultHost::start`, `hosted_view`, `raw_input_hook`, `run_clock` gating, `take_shot` every frame |
| `apps/canvas/Cargo.toml` | No egui_dock | ✓ VERIFIED | Absent from the manifest and Cargo.lock |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| main.rs | vault_host.rs | Startup opens the selected root; frames poll without blocking | ✓ WIRED | `VaultHost::start(...)` in `App::new`; `view()` and `settled()` each frame |
| vault_host.rs | shell.rs | Published snapshots drive explorer, palette, and workspace | ✓ WIRED | `explorer(ui, …, &view)`, `palette_entries(&view…)`, `workspace(ui, &view, …)` |
| shell.rs explorer | vault_host.rs | Open vault queues a root switch | ✓ WIRED | `ExplorerAction::OpenVault` leads to `select_root` and a ticket |
| main.rs | shell_input.rs | Cmd-K and exit chord filtered in raw input before terminals | ✓ WIRED | `raw_input_hook` calls `filter_shell_chords` |
| Explorer and palette | Graph workspace camera | Same NavigationTarget | ⚠️ PARTIAL | Both reach `graph_camera.navigate`, but the camera's center and scale never reach rendering |
| Destination | run_clock / take_shot | Sim visibility controls the clock; shots from any view | ✓ WIRED | `clock_step(&self.destination, …)`; `take_shot` runs unconditionally |
| Tab Debug identity | marks.rs | Stable pane keys | ✓ WIRED | `self.marks.pane(format!("{tab:?}"), …)` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| Explorer rows | `view.snapshot.index` | `scan::scan` and `VaultIndex::build` on the worker | Yes (folders and notes from disk) | ✓ FLOWING |
| Palette entries | same snapshot plus `ide.buffers` | as above | Yes | ✓ FLOWING |
| Workspace focus | `GraphCamera.focus.center/scale` | `resolve_navigation` from the index | Computed, never rendered | ✗ DISCONNECTED (title only flows) |
| Vault status | `VaultView.status` | worker `publish` | Yes (screenshot 2 shows a real error string) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Workspace builds | `cargo build --workspace --offline` | exit 0; 2 known dead-code warnings (IN-01) | ✓ PASS |
| Phase test suite (run once) | `cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline` | canvas 21, canvas-app 81 passed / 2 ignored (embed model), vault 9+18+33+2+4+18+5+20+1+3; 0 failed | ✓ PASS |
| Graph screenshot | `TAPESTRY_SHOT=target/verify-graph.png:0.5 target/debug/tapestry-canvas` | PNG written, app self-closed; Explorer docked, no dock panes | ✓ PASS |
| Hosted-view screenshots | `TAPESTRY_FILL={Simulation,Rules,Files,Terminals,Notes} TAPESTRY_SHOT=…` | All five written and self-closed; each tool full-window | ✓ PASS |
| Screenshot runs don't write state | `stat` of `~/.local/state/tapestry/*` before and after | identical | ✓ PASS |
| Remembered-root fallback | 2nd graph screenshot (with `world/vault` present) | Shows "Could not open vault folder …tapestry-switch-source…: No such file… Showing the default vault instead." | ✓ PASS |

### Probe Execution

No probes declared; no `scripts/*/tests/probe-*.sh` for this phase. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| VAULT-01 | 02-01, 02-02 | Open any folder as a vault; remember the last; default `world/vault/` (created) | ✓ SATISFIED | Truth 1; vault_host tests; screenshots |
| SHELL-01 | 02-01, 02-04 | One infinite 2D canvas showing the vault; egui_dock removed | ✓ SATISFIED | Truth 1. The canvas is a blank stub per D-02 and ROADMAP planning notes; pan/zoom is Phase 3 CANV-01 |
| SHELL-02 | 02-02 | Explorer: list, resize, close/reopen, float | ✓ SATISFIED | Truth 2 (native drag in human verification) |
| SHELL-03 | 02-02, 02-03 | Cmd-K fuzzy palette of tools, notes, folders, commands | ✓ SATISFIED | Truth 4 |
| SHELL-04 | 02-03, 02-04 | Every tool full-window; highlights, tab notes, marks still work | ✓ SATISFIED | Truth 5 (terminal liveness: truth 6, behavior-unverified) |
| SHELL-05 | 02-03, 02-04 | Esc router precedence; exit chord never to PTY; sim keys only in sim | ✓ SATISFIED | Truth 7 |
| SHELL-06 | 02-02 | Selecting a note or folder flies the camera to it | ✗ BLOCKED | Truth 3. REQUIREMENTS.md shows `[x]` / "Complete", which the code does not support |

No orphaned requirements: REQUIREMENTS.md maps exactly VAULT-01 and SHELL-01 to SHELL-06 to Phase 2, and all appear in plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| apps/canvas/src/shell.rs | 281-286, 2062-2080 | Computed `center`/`scale` never consumed; renderer hardcodes `canvas.center()` | 🛑 Blocker | SHELL-06 / SC2b not met (gap 1) |
| apps/canvas/src/vault_host.rs | 494-498, 535-541 | WR-01's `clear_error` also clears WR-03's startup fallback notice ("…Showing the default vault instead.") on the first successful rescan | ⚠️ Warning | Seen directly. On the first screenshot run, creating `world/vault` produced a watcher Rescan, and the notice was gone by 0.5 s. On the second run (folder already there) it showed. Normally it clears at the latest on the 60 s fallback rescan, so the user loses the only sign that their remembered vault is missing. The WR-03 test reads the status right away and doesn't catch this. Fix: keep a sticky "fallback" notice apart from rescan errors. |
| apps/canvas/src/shell.rs | 1793-1808 | `ide_handoffs_hidden_terminals_keep_session_owner` asserts on a local Arc that routing never touches | ⚠️ Warning | The test gives no evidence for terminal liveness (truth 6) |
| apps/canvas/src/vault_host.rs | 42, 251 | Dead `Command::Rescan` / `request_rescan` (IN-01) | ℹ️ Info | 2 compiler warnings |
| apps/canvas/src/main.rs | 529, 1644 | Camera focus and explorer selection survive a vault switch (IN-04) | ℹ️ Info | Stale title after a switch |
| apps/canvas/src/shell_input.rs | 33-40 | `modifiers.command` is Ctrl off macOS (IN-08) | ℹ️ Info | On Linux, Ctrl-K and Ctrl-Shift-W are taken from terminals |
| apps/canvas/src/main.rs | 318-319 | Default vault path is fixed at compile time and not canonicalized (IN-09) | ℹ️ Info | Points into whichever worktree built the binary |

No TBD, FIXME, XXX, TODO, HACK, `todo!`, or `unimplemented!` markers in any phase-modified file.

### Human Verification Required (non-blocking, end-of-phase)

These are recorded for Kaelen in `.context/HUMAN-QUESTIONS.md` #15, #16, #18, #19. Each is backed by passing logic tests, so none is the only evidence for a must-have, except terminal liveness (truth 6), which has no real test.

1. **Explorer drag-to-float, resize, close, reopen** (#15, #19a). Test: drag the header slowly about 30 px off the edge. Expected: it floats, can be moved, resized, and closed, and reopens with Cmd-\\ and the palette.
2. **Terminal focus and chords** (#16). Test: with a focused terminal, press Cmd-K, type, press Cmd-Shift-W, and go through the Esc order. Expected: nothing reaches the PTY, and Esc follows the precedence.
3. **Restart round trip** (#18). Test: float, resize, and select, then quit and relaunch. Expected: the same shell comes back, and the playhead holds while Simulation is hidden.
4. **Review-fix interactions** (#19b-e). Test: as listed. Expected: as listed.
5. **Terminal liveness while hidden** (truth 6). Test: run `ping localhost`, hide Terminals for 10 s, then reopen. Expected: same session, with continued output.

### Gaps Summary

One blocker: SHELL-06 and the camera clause of SC2. Selection is fully plumbed: both surfaces emit the same target, the target resolves against the live index, and stale keys are ignored. But the phase stops at storing the resolved world position. The workspace draws nothing in world space, so there is no camera, and selecting a note only changes a label. REQUIREMENTS.md marks SHELL-06 Complete, and that claim is false. The ROADMAP planning note ("read-only stub with a minimal camera; Phase 3 replaces it") supports a crude camera, not one that has no effect. Phase 3's success criteria add pan/zoom but do not say that explorer and palette selection drives it, so this is not filtered as deferred.

The fix is small: draw indexed notes (or folder regions) through a `world → screen` transform centred on `focus.center` at `focus.scale`, and add one numeric test.

**If Kaelen accepts the stub as is**, add to this file's frontmatter:

```yaml
overrides:
  - must_have: "Selecting a note or folder in the explorer or palette moves the camera to it"
    reason: "Phase 2 canvas is a blank read-only stub (D-02); navigation target is resolved and stored, rendering through it is carried to Phase 3's camera spike"
    accepted_by: "Kaelen"
    accepted_at: "<ISO timestamp>"
```

and add "explorer/palette selection centres the Phase 3 camera on the target" to a Phase 3 success criterion so the item is not lost.

Everything else in the phase goal holds. egui_dock is gone. The shell opens on the graph workspace with a docked explorer. Every tool opens full-window, as the six screenshots taken here show. The input router, chord filtering, sim-key gating, clock gating, wall-clock screenshots, and shell persistence are tested. All 16 review fixes are real and covered by regressions. Phase 1's vault suite still passes with no regressions.

---

_Verified: 2026-10-22T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
