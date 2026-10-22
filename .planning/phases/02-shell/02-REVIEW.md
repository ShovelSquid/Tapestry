---
phase: 02-shell
reviewed: 2026-10-22T12:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - apps/canvas/src/main.rs
  - apps/canvas/src/shell.rs
  - apps/canvas/src/shell_input.rs
  - apps/canvas/src/vault_host.rs
  - apps/canvas/src/ide.rs
  - apps/canvas/Cargo.toml
findings:
  critical: 2
  warning: 14
  info: 9
  total: 25
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-10-22T12:00:00Z
**Depth:** standard (phase 2 diff `183a045^..HEAD`, plus direct callers in ide.rs, marks.rs, notes.rs, term.rs, and crates/vault store/scan)
**Files Reviewed:** 6
**Status:** issues_found

## Summary

The reviewed code covers the new shell modules (`shell.rs`, `shell_input.rs`, `vault_host.rs`), the `main.rs` rewiring that replaces egui_dock, the `cfg(test)` `state_dir()` change in `ide.rs`, and the manifest change. `cargo check` passes. The only compiler warnings are the dead `Command::Rescan` and `request_rescan`. No egui_dock types remain.

The pure helpers are tested and mostly correct: chord filtering, Esc precedence, `clock_step`, `ShotSchedule`, and the `ShellState` serde round trip. The defects are in the stateful glue that the tests don't reach:

- **Vault worker:** a failed folder switch leaves the vault host with no Store and no watcher, so the vault it keeps showing never refreshes again (CR-01). Error status never clears (WR-01). Folder-only changes are never picked up (WR-02).
- **Explorer float:** the drag-to-float gesture compares a per-frame delta against 28 px, so a normal drag never floats the explorer (CR-02).
- **State persistence:** `TAPESTRY_FRESH` now overwrites `shell.json` (WR-04). Non-atomic writes plus "parse failure means use the default" can reset the user's vault choice (WR-05). A remembered vault that is missing has no fallback to the default (WR-03).
- **Input routing:** an opened Files card makes Esc do nothing in the Terminals view (WR-06). Rule and note card editing isn't covered by `tool_claims_escape` (WR-07). Clicks on the palette fall through to terminal activation and to marks (WR-09).

The test-isolation fix (a122d1e) works for unit tests. Its remaining gaps are listed under Info.

## Critical Issues

### CR-01: A failed vault switch drops the live Store and watcher; the snapshot it keeps showing never refreshes again

**File:** `apps/canvas/src/vault_host.rs:192-212` (and the guard at 235)
**Issue:** On `Command::SelectRoot` the worker sets `active = None` *before* trying `open_vault`. If the new path fails (a typo, a missing folder, an unreadable folder), `active` stays `None`. The code then calls `publish_error_keep_snapshot`, so the UI keeps showing the old vault's rows (`ExplorerPresentation::Partial`). But:

- the old `Watch` has been dropped,
- the `if let Some(active) = active.as_mut()` block at line 235 is skipped on every later loop, so neither the watcher drain nor the 60 s fallback rescan runs,
- `Command::Rescan` is ignored.

From then until the next successful switch or a restart, outside changes to the vault on screen are never shown. That breaks the phase goal that outside changes refresh the view (D-10). It also leaves no `Store` for Phase 3 writes. A one-character typo in the folder field is enough to trigger it. The test `failed_root_switch_keeps_last_snapshot_and_does_not_create_folder` only checks that the snapshot pointer survives, not that refresh continues. The code comment says dropping first keeps things serialized, but both watchers live on the same worker thread, so swapping after a successful open is just as serialized.
**Fix:** Open the replacement first, and swap only when the open succeeds. Drain watcher messages from the old root after the swap:
```rust
Ok(Command::SelectRoot { path, create_if_missing }) => {
    match open_vault(&path, create_if_missing, &watch_tx) {
        Ok((replacement, snapshot)) => {
            active = Some(replacement); // drops the old Watch here
            while watch_rx.try_recv().is_ok() {} // old-root paths
            remember_root(&active.as_ref().unwrap().root);
            publish(&published, VaultStatus::Ready, Some(snapshot));
        }
        Err(error) => publish_error_keep_snapshot(&published, error), // old vault stays live
    }
    ctx.request_repaint();
    last_rescan = Instant::now();
}
```
Add a test: after a failed switch, write a note to the original root and assert that a later snapshot contains it.

### CR-02: Drag-to-float compares a per-frame drag delta against 28 px, so a normal drag never floats the explorer

**File:** `apps/canvas/src/shell.rs:944-947`
**Issue:** `header_response.drag_delta()` is the delta since the last frame (egui 0.36 `Response::drag_delta`: "how many points were we dragged in since last frame?"). The check `drag_delta().length() >= 28.0` needs the pointer to move 28 px within one frame, about 1700 px/s at 60 fps. A normal drag of the header never reaches that, so the explorer can't be dragged off to float. That is SHELL-02 and D-01, and SHELL-02 is marked complete. No palette command or button floats the explorer, so in practice this mode can only be reached with a fast flick, or by hand-editing `shell.json`.
**Fix:** Use the total drag since the press, or the pointer leaving the panel:
```rust
if header_response.dragged()
    && header_response.total_drag_delta().is_some_and(|d| d.length() >= 28.0)
{
    let at = ui.ctx().pointer_interact_pos().unwrap_or(header.center());
    state.float(at - egui::vec2(132.0, 18.0));
}
```
Also consider adding a "Float explorer" palette command, so the mode can be reached from the keyboard.

## Warnings

### WR-01: Vault error status sticks after a transient rescan failure

**File:** `apps/canvas/src/vault_host.rs:305-327, 342-346`
**Issue:** `refresh_if_changed` publishes `VaultStatus::Error` when `store.rescan()` fails. `stat_tree` returns early with `?` on `symlink_metadata` (crates/vault/src/scan.rs:251), so a file renamed or deleted mid-walk is enough; editors do this on every atomic save. A later successful rescan that finds no changes never sets the status back to `Ready`, because `publish` runs only when there is a change. The workspace and explorer then show "Couldn't open this folder…" over a working vault until some note changes. The error path also doesn't call `ctx.request_repaint()`, because the generation is unchanged.
**Fix:** When `rescan()` succeeds and the status is `Error`, set it back to `Ready` and request a repaint, for example `publish(published, VaultStatus::Ready, None)` when `!changed && status is Error`. Request a repaint whenever the status changes, not only when the snapshot pointer changes.

### WR-02: Folder-only changes are never picked up

**File:** `apps/canvas/src/vault_host.rs:226-256, 305-309`
**Issue:** Both refresh triggers only see notes:

- The watcher sends only `.md` paths (`watch.rs` `rel_md`).
- `classify` returns `Unchanged` for directories.
- `Store::rescan` diffs `stat_tree`, which records only note files (scan.rs:250).

So creating, renaming, or deleting an empty folder outside the app never rebuilds the snapshot. The explorer and palette list folders from `index.folders`, so a new folder never appears and a deleted one stays listed and navigable until restart or an unrelated note change.
**Fix:** On the fallback interval, and on `WatchMsg::Rescan`, rebuild the snapshot unconditionally (or compare the folder sets of a fresh `scan`). Alternatively, have the watcher forward directory create and remove events as a `Rescan`.

### WR-03: A remembered vault that is missing has no fallback to the default

**File:** `apps/canvas/src/vault_host.rs:54-64, 176-187`
**Issue:** `start` uses the remembered root whenever `vault.json` parses, with `create_if_missing = false`. If that folder is gone, the app opens with no snapshot and only the error copy. It never tries `world/vault`. This is the state every developer's real `vault.json` was left in by the tests before a122d1e (HUMAN-QUESTIONS #17). That commit stops further damage but doesn't repair it, and nothing in the app recovers. D-07 makes `world/vault` the default.
**Fix:** If opening the remembered root fails at startup, keep the error message but fall back to `default_root` with `create_if_missing = true`. Don't overwrite `vault.json` unless the user picks a folder (or overwrite only after a successful default open, as now).

### WR-04: `TAPESTRY_FRESH` runs now overwrite the user's `shell.json`

**File:** `apps/canvas/src/main.rs:374-377, 411-419`
**Issue:** `reopen()` returns early on `fresh_start()`, and `shell_saved` starts as `""`. The first `save_layout` (about 3 s in) finds `text != self.shell_saved` and writes the default `ShellState`, which replaces the saved explorer mode, width, files folder, and open-editor list. Screenshot runs are protected by `self.shot.is_some()`, but `TAPESTRY_FRESH` alone is not. The old dock code set `panes_kept = self.panes()` in `reopen` and wrote only when something changed, so a fresh start never wrote the layout. This is a regression in "never clobber user state".
**Fix:** In `reopen`, prime the baseline before the early return, so only real changes are written:
```rust
fn reopen(&mut self) {
    if fresh_start() {
        self.shell_saved = self.shell_snapshot_text(); // capture of the default state
        return;
    }
    ...
    self.shell_saved = self.shell_snapshot_text();
}
```
Alternatively, skip writing `shell.json` entirely when `TAPESTRY_FRESH` is set.

### WR-05: Non-atomic state writes plus "parse failure means default" can reset the user's vault choice

**File:** `apps/canvas/src/vault_host.rs:136-146`, `apps/canvas/src/ide.rs:2105-2111`, `apps/canvas/src/main.rs:378-381`
**Issue:** `save_state` uses `std::fs::write` (truncate, then write). `shell.json` is rewritten every 3 s specifically to survive a crash or kill, and `vault.json` is rewritten on every vault open from the worker thread. A kill during the write leaves a truncated file:

- For `vault.json`, `remembered_root()` returns `None`. The next start opens `world/vault`, then `remember_root` overwrites the user's real choice with the default.
- For `shell.json`, the app falls back to the *legacy* synced layout, which may be months old, restores those editors and folders, and then overwrites.

**Fix:** Write to `name.tmp` in the same directory and then `rename` over the target, which is atomic on POSIX. In `remembered_root`, tell "missing" apart from "unreadable or malformed". For malformed, don't overwrite with the default; log it and leave the file alone.

### WR-06: An opened Files card makes Esc do nothing in the Terminals view

**File:** `apps/canvas/src/main.rs:453-469`
**Issue:** `owner_claims_keyboard` is true when `self.ide.has_focus() && destination is Files | Terminals`. `Ide::focus` (an opened file or terminal card) is drawn only by `files_ui` (`ide.rs:926`); `terminals_ui` never draws it or reads Esc. Example: open a terminal card (`open_terminal` calls `grow` and reveals Files), leave with Cmd-Shift-W, then go to Terminals from the palette. In Terminals, every Esc routes to `EscapeRoute::Owner` and nobody handles it, so Esc never returns to the graph, and marks undo is blocked too. `TAPESTRY_OPEN` (`main.rs:68`, `ide.show`) also sets `focus` at startup, which creates the same state.
**Fix:** Count `has_focus()` only for `Destination::Files`, the one view that draws the focused card:
```rust
|| (self.ide.has_focus() && self.destination == shell::Destination::Files)
```

### WR-07: `tool_claims_escape` doesn't cover rule or note card editing, though its doc says it does

**File:** `apps/canvas/src/main.rs:467-468`, `apps/canvas/src/shell_input.rs:93-95`
**Issue:** The `KeyFocus` doc lists "an open file card, a rule being written" as tool Esc claims, but only `Simulation && selected.is_some()` is wired. Rule cards (`main.rs:893-905`) and note cards (`notes.rs:265-268`) put themselves down on Esc. When a card is in editing mode but its TextEdit doesn't have keyboard focus (after a click inside the card that doesn't close it), Esc routes to `ReturnToGraph` and is consumed. The card stays in editing mode, hidden, and the precedence "focused tool handler before return from hosted tool" (UI-SPEC) is broken.
**Fix:** Expose editing state, for example `self.rule_editing.is_some()` and `self.notebook.is_editing()`, and set `tool_claims_escape` for `Destination::Rules` and `Destination::Notes` while a card is being edited.

### WR-08: Palette selection goes stale across query changes and isn't kept visible

**File:** `apps/canvas/src/shell.rs:551-556, 585-596, 601-630`; `apps/canvas/src/main.rs:439-444`
**Issue:**
- `state.selected` is only clamped, never reset when the query changes. After moving down a few rows and then typing, Enter opens the Nth match instead of the best one.
- The query and selection also survive close and reopen (`apply_chords` sets only `open` and `focus_query`), so Cmd-K reopens filtered to the last search.
- Arrow navigation never calls `scroll_to_me`, so the selected row can move outside the 420 px `ScrollArea`. The UI-SPEC requires that result rows "keep selection visible".

**Fix:** Track the last query and set `selected = 0` when it changes. Clear `query` and `selected` when opening from Cmd-K. Call `response.scroll_to_me(None)` on the selected row when it changed this frame.

### WR-09: Clicks on the palette (and floating explorer) reach terminals and marks underneath

**File:** `apps/canvas/src/main.rs:1557-1600`; `apps/canvas/src/ide.rs:293-311`; `apps/canvas/src/marks.rs:117-175`
**Issue:** While the palette is open only *keyboard* events are withheld. Two other consumers still see the click:

- `Ide::begin_frame` sets `active_term` from any primary press inside last frame's terminal hit rect, with no check for overlays. Clicking a palette row that sits over a terminal card makes that terminal active, and once the palette closes, typing goes to that PTY.
- `marks.intercept` runs in `raw_input_hook`. The palette and floating-explorer rects are never passed to `marks.keep_clear`, so with marks in "anywhere" or Alt mode a click on a palette row starts a mark. Marks also swallow Esc when `picked` or `anywhere` is set, so with a picked mark the first Esc doesn't close the palette, which breaks the locked "palette first" precedence.

**Fix:** Pass the palette `Area` rect (and the floating explorer rect) to `marks.keep_clear` each frame. Skip terminal activation in `begin_frame` when the press lands on a foreground layer, using `ctx.layer_id_at(pos)` and checking the order. In `marks.intercept`, leave Esc alone while the palette is open.

### WR-10: `TAPESTRY_OPEN` now opens its file into a hidden view

**File:** `apps/canvas/src/main.rs:66-69`
**Issue:** `app.ide.show(path)` opens the file as a focused card in the Files surface. With the dock, Files was visible in the default layout. Now `destination` stays `Graph`, so the requested file isn't shown and only leaves the stray `Ide::focus` described in WR-06. This regresses an existing automation hook.
**Fix:** After `show`, set `app.destination = shell::Destination::Files` (or `File(path)` when the buffer loaded), unless `TAPESTRY_FILL` set something else.

### WR-11: The vault folder field doesn't expand `~`, resolves relative paths against the process cwd, and can stay "dirty" for good

**File:** `apps/canvas/src/shell.rs:897-910, 996-998`
**Issue:** `PathBuf::from(state.path.trim())` is sent as typed:
- `~/notes` fails with the generic error, even though `ide.rs` already has `expand_home` for its own path field.
- A relative path such as `notes` resolves against whatever directory the app was launched from.
- `path_dirty` is cleared only when `snapshot.root == PathBuf::from(&state.path)`, and the root is canonicalized. So a successful open through a symlink (`/tmp/...` vs `/private/tmp/...`) or a path with `..` leaves the field dirty forever. It then stops following later vault switches, and the stale typed text stays.

**Fix:** Expand `~` (reuse `ide::expand_home`) and reject relative paths with a clear message. Clear `path_dirty` when the host reports `Ready` after this frame's `OpenVault`, for example by remembering the requested path and comparing against `canonicalize()` of it, rather than comparing strings.

### WR-12: A dead vault worker is reported as "busy" and never surfaced

**File:** `apps/canvas/src/vault_host.rs:115-122`; `apps/canvas/src/main.rs:1582-1591`
**Issue:** `select_root` turns both `TrySendError::Full` and `TrySendError::Disconnected` into `Err(path)`, and the UI always shows "Vault switch is busy. Try opening the folder again in a moment." If the worker thread panics, for example inside `Store`, `scan`, or `VaultIndex::build`, every later attempt says "busy". `view()` keeps returning the last published state, so the shell looks loaded but never refreshes. Nothing watches the thread.
**Fix:** Return a typed error that tells `Full` and `Disconnected` apart. On `Disconnected`, publish `VaultStatus::Error("The vault worker stopped…")`, and optionally restart the worker. Wrap the worker loop with `catch_unwind` (or check `JoinHandle::is_finished()` in `view()`) so a panic shows up as an error status.

### WR-13: Explorer keyboard contract is incomplete: no Cmd-\ toggle and no Enter to open a vault

**File:** `apps/canvas/src/shell_input.rs:21-39`; `apps/canvas/src/shell.rs:981-999`
**Issue:**
- 02-CONTEXT says the explorer closes and reopens "by Cmd-\\ or palette". Only the palette path exists, and it can only reopen, never close.
- The UI-SPEC requires keyboard operation for folder selection. The palette's "Open vault…" focuses the path field, but pressing Enter in it does nothing; only a click on "Open vault" submits.

**Fix:** Add a Cmd-Backslash chord to `filter_shell_chords` that toggles `explorer.mode`. In `explorer_contents`, also submit when `response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter))`.

### WR-14: The test state folder covers only unit tests; screenshot automation still writes the real `vault.json`

**File:** `apps/canvas/src/ide.rs:2088-2102`; `apps/canvas/src/vault_host.rs:176-182`
**Issue:** The `cfg(test)` `state_dir()` protects `cargo test`. But the verification runs listed in the 02-04 summary use `TAPESTRY_SHOT=... target/debug/tapestry-canvas`, a non-test build. `VaultHost::start` runs there unconditionally and calls `remember_root` on every successful open. That contradicts the stated rule that "screenshot runs never write" state. In a worktree, a shot run with no remembered root writes that worktree's compile-time `world/vault` path into the shared `~/.local/state/tapestry/vault.json`.
**Fix:** Pass a "persist" flag into `VaultHost::start`, false when `fresh_start()`, and skip `remember_root` when it is false. Alternatively, let tests and automation point at a state folder through an env var such as `TAPESTRY_STATE_DIR`.

## Info

### IN-01: `Command::Rescan` and `request_rescan` are dead in the binary

**File:** `apps/canvas/src/vault_host.rs:41, 124-126, 213-221`
**Issue:** These are the two compiler warnings in the bin build; they are used only by tests (also noted in deferred-items.md).
**Fix:** Mark them `#[cfg(test)]`, or wire them to a "Rescan vault" palette command.

### IN-02: The test state folder is shared by every test in the process and never removed

**File:** `apps/canvas/src/ide.rs:2097-2102`
**Issue:** `tapestry-test-state-<pid>` is shared by all parallel tests in the process, so `vault.json` and `marks.jsonl` writes race each other, and the folder is left in the temp directory after every run. It is harmless today because no test reads it back, but a future round-trip test will be flaky.
**Fix:** Use a per-test folder (a thread-local override, or inject the state directory into `VaultHost::start_with`). Clean it up in tests that write.

### IN-03: Watcher messages from the old root are not drained after a vault switch

**File:** `apps/canvas/src/vault_host.rs:196-211, 228-234`
**Issue:** Paths queued by the dropped watcher are classified against the new `Store`. A missing path returns `Change::Removed`, which forces a needless full rebuild. It is harmless but wasteful. This is covered by the CR-01 fix.
**Fix:** Drain `watch_rx` right after swapping `active`.

### IN-04: Graph camera focus and explorer selection survive a vault switch

**File:** `apps/canvas/src/main.rs:1580-1595`; `apps/canvas/src/shell.rs:278-291`
**Issue:** After a switch, or after the focused note is deleted, `graph_camera.focus` still draws the old title, and `explorer.selected` still holds a key from the old vault.
**Fix:** When `snapshot.root` changes, or the target no longer resolves, clear `graph_camera.focus` and `explorer.selected`.

### IN-05: Explorer tooltips show the relative key, and duplicate note names can't be told apart

**File:** `apps/canvas/src/shell.rs:1043-1049, 835-873`
**Issue:** `full_path` is just `key`. The list is flat (folders, then every note in the vault), so `research/Notebook.md` and `research/child/Notebook.md` both read as "Notebook". The UI-SPEC asks for full paths when names collide.
**Fix:** Use `snapshot.root.join(key)` for the tooltip, and add the parent folder to the label when names collide.

### IN-06: `ResolvedNavigation.center` and `scale` are never used

**File:** `apps/canvas/src/shell.rs:270-276, 1785-1833`
**Issue:** `workspace` draws a dot at `canvas.center()` and the title; the computed camera target is ignored. SHELL-06 ("flies the camera to it") is only a stub. This is acceptable under D-02, but the requirement is marked complete.
**Fix:** Note it as a Phase 3 carry-over in the verification artifact.

### IN-07: The palette's `ide.show` fallback can't be reached, and it changes state when it runs

**File:** `apps/canvas/src/main.rs:1650-1658`
**Issue:** Palette editor entries are built from `ide.buffers` in the same frame, so `!contains_key` never happens. If it ever did, `show()` would also `grow` a Files card and set `Ide::focus` (see WR-06).
**Fix:** Drop the branch, or use `ide.reopen(&path)`, which only loads.

### IN-08: Cmd-K and Cmd-Shift-W use `modifiers.command`, which is Ctrl off macOS

**File:** `apps/canvas/src/shell_input.rs:33-36`
**Issue:** On Linux, which `state_dir` supports through XDG, Ctrl-K (readline kill-line) and Ctrl-Shift-W would be taken from terminals and editors. Cmd-Alt-K and Cmd-Ctrl-K also open the palette.
**Fix:** Use `modifiers.mac_cmd` on macOS, or require `!modifiers.alt && !modifiers.ctrl` alongside `command` there.

### IN-09: The default vault path is fixed at compile time

**File:** `apps/canvas/src/main.rs:307-310`
**Issue:** `env!("CARGO_MANIFEST_DIR")/../../world/vault` is not canonicalized, and it points into whichever worktree built the binary. `create_dir_all` will create it there, even when the binary is run from elsewhere. This matches the existing `world_dir()` pattern but has a bigger effect, because the path ends up in the shared `vault.json`.
**Fix:** Canonicalize it, and consider resolving it relative to `world_dir()`'s parent or the executable.

---

_Reviewed: 2026-10-22T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
