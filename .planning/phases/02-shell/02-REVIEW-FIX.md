---
phase: 02-shell
fixed_at: 2026-10-22T00:00:00Z
review_path: .planning/phases/02-shell/02-REVIEW.md
iteration: 1
findings_in_scope: 16
fixed: 16
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-10-22
**Source review:** .planning/phases/02-shell/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 16 (CR-01, CR-02, WR-01 to WR-14; fix scope critical_warning)
- Fixed: 16
- Skipped: 0
- Every fix has its own commit and a regression test in the module it changes.

## Verification

- **Where it ran:** in the main checkout at `/Users/kaelencook/Tapestrees/core` on branch `ws/core`. No isolated worktree was used: the orchestrator's shared-tree rules said to commit here with explicit pathspecs. Anyone can reproduce these numbers from this tree.
- `cargo build --workspace --offline`: passes. The only warnings are the two that were already there (dead `Command::Rescan` and `request_rescan`, IN-01, out of scope).
- `cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline`: all pass. The tapestry-canvas-app count is 81 passed, 2 ignored; it was 59 passed, 2 ignored before the fixes. Three repeat runs of tapestry-canvas-app also passed, so the timing-based worker tests are not flaky.
- Every commit was checked with `git show --stat HEAD`. Together the commits touch only `apps/canvas/src/{ide,main,marks,notes,shell,shell_input,vault_host}.rs`. Nothing else in the index was committed, including the other session's staged `world/notes` files.

## Fixed Issues

### CR-01: A failed vault switch drops the live Store and watcher

**Files modified:** `apps/canvas/src/vault_host.rs`
**Commit:** e58c4e3
**Applied fix:** `SelectRoot` now opens the replacement first and swaps `active` only if the open succeeds. A failed switch leaves the current Store and watcher running. After a successful swap, the paths the old watcher had queued are drained (this also covers IN-03).
**Test:** `failed_root_switch_keeps_the_original_vault_refreshing`. It makes a switch fail, writes a note to the original root, and checks that a later snapshot contains it.

### CR-02: Drag-to-float compared a per-frame delta against 28 px

**Files modified:** `apps/canvas/src/shell.rs`
**Commit:** 8765f11
**Applied fix:** The float check is now the pure helper `drag_floats_explorer(total_drag_delta())`. It compares the total drag since the press against `FLOAT_DRAG_DISTANCE`. The suggested "Float explorer" palette command was not added; the review only said to consider it.
**Test:** `explorer_floats_after_a_slow_drag_adds_up_to_the_distance`, which uses a 2 px-per-frame drag.

### WR-01: Vault error status stuck after a transient rescan failure

**Files modified:** `apps/canvas/src/vault_host.rs`
**Commit:** c13960f
**Applied fix:** When a rescan succeeds but finds no note change, an `Error` status is set back to `Ready`. The repaint check compares (snapshot identity, status), so a status change alone now repaints.
**Test:** `a_working_rescan_clears_an_earlier_rescan_error`. It removes the root, rescans, gets an error, recreates the root, rescans again, and checks for `Ready`.

### WR-02: Folder-only changes were never picked up

**Files modified:** `apps/canvas/src/vault_host.rs`
**Commit:** 1a5e5f0
**Applied fix:** When `Store::rescan` reports no note change, the worker now compares the vault's folder set against the published index and rebuilds the snapshot if they differ. This happens on every rescan path: `WatchMsg::Rescan`, the fallback interval, and `Command::Rescan`. The folder walk reads metadata only (`scan_with` with `max_note_bytes: 0`). The watcher already forwards directory events as `Rescan`.
**Test:** `folder_only_changes_publish_fresh_snapshots` creates and then removes an empty folder.

### WR-03: A missing remembered vault had no fallback to the default

**Files modified:** `apps/canvas/src/vault_host.rs`
**Commit:** 3d70eed
**Applied fix:** A new `Startup` value and `startup_choice` decide what opens at startup. If the remembered root fails to open, the worker opens `world/vault` (created if missing) and shows the original error plus "Showing the default vault instead." The fallback is not remembered, so `vault.json` keeps the user's choice until they pick a folder (per D-07).
**Tests:** `startup_prefers_the_remembered_vault_and_falls_back_to_the_default` and `missing_remembered_vault_opens_the_default_with_the_error`.

### WR-04: `TAPESTRY_FRESH` runs overwrote `shell.json`

**Files modified:** `apps/canvas/src/main.rs`
**Commit:** dc1a578
**Applied fix:** The new `shell_write_due(fresh, text, saved)` never allows a `shell.json` write on fresh or screenshot runs. A normal `reopen` now sets the baseline to the state it restored, so only real changes are written.
**Test:** `fresh_runs_never_write_the_saved_shell`.

### WR-05: Non-atomic state writes, and parse failure treated as "use the default"

**Files modified:** `apps/canvas/src/ide.rs`, `apps/canvas/src/vault_host.rs`, `apps/canvas/src/shell.rs`, `apps/canvas/src/main.rs`
**Commit:** e69efaf
**Applied fix:**
- `save_state` now goes through `write_atomic`: it writes a temp file in the same folder and renames it over the target.
- `vault.json` reads now return `Missing`, `Root`, or `Unusable`. If it is `Unusable`, the default vault opens but is never written over the file.
- `shell.json` reads now return `Saved`, `Missing`, or `Unusable` (`read_saved_shell`). If it is `Unusable`, the app starts from the default shell. The legacy synced layout is used only when the file is actually missing.

**Tests:** `state_writes_replace_the_file_whole_and_leave_no_temporary`, `vault_json_missing_is_told_apart_from_malformed`, and `shell_json_missing_is_told_apart_from_malformed`.

### WR-06: An opened Files card made Esc do nothing in Terminals

**Files modified:** `apps/canvas/src/main.rs`, `apps/canvas/src/shell_input.rs`
**Commit:** 92d4385
**Applied fix:** The new `opened_card_claims_keyboard` lets an opened card claim the keyboard only while the destination is `Files`, the one view that draws the card.
**Test:** `input_router_opened_card_claims_esc_only_where_it_is_drawn`.

### WR-07: `tool_claims_escape` didn't cover rule or note card editing

**Files modified:** `apps/canvas/src/main.rs`, `apps/canvas/src/shell_input.rs`, `apps/canvas/src/notes.rs`
**Commit:** 032ce3c
**Applied fix:** A new `ToolEscape` struct feeds the new `tool_claims_escape` function. The tool claims Esc in Simulation (picked keyframe), Rules (`editing.is_some()`), and Notes (new `Notes::is_editing()`), and only while that tool's view is showing.
**Test:** `input_router_open_rule_and_note_cards_take_esc_before_leaving`.

### WR-08: Palette selection went stale across query changes and wasn't kept visible

**Files modified:** `apps/canvas/src/shell.rs`, `apps/canvas/src/main.rs`
**Commit:** bd0b644
**Applied fix:**
- `PaletteState::sync_selection` goes back to the first row when the query changes (it tracks `selected_for`) and keeps the selection within the result count.
- Cmd-K now calls `open_fresh()`, which clears the query and the selection.
- When arrow keys move the selection, the selected row calls `scroll_to_me`.

**Test:** `palette_selection_starts_over_for_a_new_query_and_a_fresh_open`.

### WR-09: Clicks on the palette and floating explorer reached terminals and marks underneath

**Files modified:** `apps/canvas/src/main.rs`, `apps/canvas/src/shell.rs`, `apps/canvas/src/ide.rs`, `apps/canvas/src/marks.rs`
**Commit:** 4f64259
**Applied fix:**
- `Ide::begin_frame` no longer changes the active terminal when the press lands on a non-background layer. It checks with `ctx.layer_id_at` and the new `press_reaches_panes`.
- The palette and floating-explorer areas are passed to `marks.keep_clear` every frame through the new `shell::overlay_rects`.
- `Marks` has a new `palette_open` flag, set in `raw_input_hook`. While it is set, marks leave Esc alone, so Esc closes the palette first.

**Tests:** `presses_on_overlays_never_pick_the_terminal_beneath`, `open_palette_gets_esc_before_drawing_anywhere`, and `presses_on_kept_clear_overlays_never_start_a_mark`.
**Note:** Marks still keep clear of areas using rects from earlier frames (lag already present in `marks.rs`), so a click in the first frame or two after the palette opens may not be covered.

### WR-10: `TAPESTRY_OPEN` opened its file into a hidden view

**Files modified:** `apps/canvas/src/main.rs`, `apps/canvas/src/shell.rs`
**Commit:** a8f787d
**Applied fix:** After `ide.show`, the window switches to `Destination::Files`, the view that draws the opened card. It stays put if `TAPESTRY_FILL` named a valid view (new `opened_file_destination`).
**Test:** `tapestry_open_shows_the_files_view_unless_fill_chose_one`.

### WR-11: The vault field didn't expand `~`, resolved relative paths against the cwd, and could stay dirty for good

**Files modified:** `apps/canvas/src/shell.rs`, `apps/canvas/src/main.rs`, `apps/canvas/src/ide.rs`, `apps/canvas/src/vault_host.rs`
**Commit:** 178fa2c
**Applied fix:**
- The new `vault_path_from_field` expands `~` and `~/…` using `ide::expand_home`, which is now `pub(crate)`. It refuses relative paths with a message.
- `VaultHost::select_root` returns a ticket. A new `settled()` counter is incremented after each switch's result is published.
- `ExplorerState::settle_open` clears `path_dirty` only when the field's own switch has finished and the status is `Ready`. A failed switch keeps the typed text so it can be corrected. This replaces the string compare against the canonical root.
- The UI reads `settled` before `view`, so it never pairs a new settled count with an older view.

**Tests:** `vault_field_expands_home_and_refuses_relative_paths` and `vault_field_follows_the_vault_once_its_switch_settles`. The existing failed-switch test now also waits on the ticket.

### WR-12: A dead vault worker was reported as "busy"

**Files modified:** `apps/canvas/src/vault_host.rs`, `apps/canvas/src/main.rs`
**Commit:** b4a8231
**Applied fix:**
- `select_root` now returns `SelectError::Busy` or `SelectError::Stopped`, and the UI shows a different message for each.
- `VaultHost` keeps the worker's `JoinHandle`. Once the thread has finished, `view()` reports an error over the last snapshot ("The vault worker stopped…"). It reads through a poisoned lock.
- The worker is not restarted automatically; the review listed that as optional.

**Test:** `a_stopped_worker_is_reported_not_called_busy`, using a test-only `Command::Panic`.

### WR-13: Explorer keyboard contract was incomplete (no Cmd-\ toggle, no Enter to open)

**Files modified:** `apps/canvas/src/shell_input.rs`, `apps/canvas/src/main.rs`, `apps/canvas/src/shell.rs`
**Commit:** ed97d28
**Applied fix:**
- Cmd-\ is now a shell chord. Like Cmd-K, it is removed from raw input with its typed text before any terminal sees it.
- On the graph, Cmd-\ closes the explorer, or reopens it docked if it was closed.
- From a hosted view, where the explorer isn't drawn, Cmd-\ returns to the graph with the explorer open, the same as the palette's "Open explorer" (new `route_explorer_toggle`).
- Pressing Enter in the vault path field opens the folder, the same as the button.

**Test:** `cmd_backslash_toggles_the_explorer_and_never_types`.
**Choice made:** what Cmd-\ does from a hosted view is a judgement call. It follows the palette's existing "Open explorer" routing and doesn't conflict with D-01 or 02-CONTEXT.

### WR-14: Screenshot and fresh runs still wrote the real `vault.json`

**Files modified:** `apps/canvas/src/vault_host.rs`, `apps/canvas/src/main.rs`
**Commit:** 58ab3b0
**Applied fix:** `VaultHost::start(default_root, persist, ctx)` gets `persist = !fresh_start()`. `Startup` carries the flag, and both the initial `remember_root` and the one after a successful switch check it. The tests' `start_with` never persists either, which also removes the test-side `vault.json` races from IN-02.
**Test:** `fresh_and_screenshot_runs_never_remember_a_vault`. A non-persisting host opens a vault and switches to another, and the test checks that no `vault.json` appears in the test state folder.

## Notes for follow-up (not blocking)

- These need an interactive check in the running app, because unit tests cover only the pure helpers: CR-02 (dragging the header), WR-08 (scrolling the palette), WR-09 (clicking palette rows over a terminal with marks set to anywhere), and WR-13 (Cmd-\ and Enter).
- Info findings IN-01 to IN-09 were out of scope (`fix_scope: critical_warning`). The CR-01, WR-14, and WR-03/WR-05 fixes also cover IN-03, part of IN-02, and the default-path fallback behind HUMAN-QUESTIONS #17.

---

_Fixed: 2026-10-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
