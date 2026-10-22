# Phase 2: Shell - Research

**Researched:** 2026-10-22
**Domain:** Native Rust/egui application shell, keyboard focus routing, filesystem-backed vault host
**Confidence:** HIGH for existing code/API findings; MEDIUM for new shell composition guidance

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** The graph workspace is the default main view. The explorer sits on the left, docked by default, lists vault folders and notes, and can be resized, closed, reopened, or dragged off the edge to float as its own window.
- **D-02:** The Phase 2 graph canvas is a blank, read-only stub with a minimal camera. Full note-card editing belongs to Phase 3.
- **D-03:** Keep the current `Tab` enum variants and their debug identities because persisted marks and layouts use `format!("{tab:?}")`; add or adapt shell concepts without renaming existing variants.

### Tool and palette lifecycle
- **D-04:** Cmd-K opens a fuzzy palette containing tools, notes, folders, and commands, including when a terminal has focus.
- **D-05:** Simulation (simulation canvas, brushes, and timeline) opens as one grouped Simulation view. Rules, Files, Terminals, Notes, and editor tabs remain separate full-window views. Esc returns to the graph workspace.
- **D-06:** Use one focus-aware input router for shell shortcuts. Preserve tool-specific input; the terminal exit chord is never forwarded to the PTY, and simulation shortcuts only run while Simulation is visible.

### Vault selection and application lifecycle
- **D-07:** Open any folder as a vault, remember the last selection across restart, and use repository `world/vault/` as the default, creating it when missing. Keep the simulation's existing `--world` setting separate from vault selection.
- **D-08:** The explorer or palette can select a note or folder and move the graph camera to it.
- **D-09:** Keep terminals alive while hidden, pause simulation clock work when the Simulation view is hidden, and decouple screenshot capture from simulation ticks so `TAPESTRY_VIEW`/`TAPESTRY_SHOT` automation works from any view.
- **D-10:** Keep vault filesystem work off the UI thread. The Phase 1 watcher receiver and periodic fallback rescan live on the serialized vault I/O path; publish refreshed scan/index state back to the shell.

### the agent's Discretion
- Internal type names and palette matching implementation, provided visible behavior follows the decisions above.
- How the explorer floats inside egui, provided it can be dragged away from the left dock and remains independently resizable and closable.
- Migration details for persisted dock layouts, provided existing tools, file tabs, marks keys, and user vault choice are preserved safely.
- Exact implementation and test split for the shared input router and the vault I/O thread.

### Deferred Ideas (OUT OF SCOPE)
- Full note-card creation, editing, movement, resize, connection drawing, and nested graph zoom are Phase 3.
- Provider search and source cards are Phase 4; proposals are Phase 5; the whole-vault graph and replay UI are Phase 6.
- No additional ideas were introduced during this autonomous context pass.
</user_constraints>

<phase_requirements>
## Phase Requirements

Requirement IDs and descriptions below are copied verbatim from the phase source. [VERIFIED: .planning/REQUIREMENTS.md:13, 30-35]

| ID | Description | Research Support |
|----|-------------|------------------|
| VAULT-01 | User can open any folder as a vault; the app remembers the last one and defaults to `world/vault/` (created if missing) | Use a separate persisted vault root and start the serialized host after canonicalizing/creating the root; leave `--world` and `Ide::serve_world` unchanged. |
| SHELL-01 | The main window is one infinite 2D canvas showing the vault; egui_dock is removed | Replace dock state with one shell host state and blank graph stub; retain the existing full-window `tab_ui` dispatch seam while deleting dock-specific types and dependency last. |
| SHELL-02 | An Obsidian-style explorer on the left lists folders (graphs) and notes; it can be resized by its edge, closed and reopened, and dragged off to float | Use one egui primitive with movable/resizable/close behavior and persisted rect/open state; egui `Window` directly supports floating, while `Panel` provides a true docked left edge. Resolve actual dock-to-float interaction by testing supported native egui behavior. |
| SHELL-03 | Cmd-K opens a fuzzy command palette listing every tool, note, folder and command | Build result entries from a stable tool registry plus the current `VaultIndex`; fuzzy-rank in-memory and return typed actions to `App`; filter Cmd-K's raw key/text events before the terminal drains them. |
| SHELL-04 | Every existing tool keeps working and opens full-window from the palette — Simulation (sim canvas + brushes + timeline + swarm), Rules, Files (spatial IDE), Terminals, Notes, editor tabs; highlight notes, tab notes and marks still work over any view | Preserve `tab_ui` arms and state owners; Simulation is a shell grouping over existing simulation tabs, not a renamed `Tab`; continue `ide.begin_frame`, highlight, tabnote, and marks lifecycle each frame. |
| SHELL-05 | Esc returns from a tool to the canvas through one input router with a defined precedence; terminals get an exit chord that is never sent to the PTY; sim keyboard shortcuts only fire while the sim is shown | Centralize shortcut checks and filter the terminal exit chord's raw key/text events before PTY ingestion; order Esc handling palette, focused field/tool, hosted view return, canvas gesture. Gate simulation keyboard and clock work on hosted Simulation state. |
| SHELL-06 | Selecting a note or folder in the explorer or palette flies the camera to it | Produce the same navigation action from both surfaces and update the shell camera's target from the immutable snapshot path; Phase 2 camera remains minimal/read-only. |
</phase_requirements>

## Summary

**Primary recommendation:** Keep `App` as the frame orchestrator, replace dock state with a small `Shell` state (`hosted tool`, palette, explorer, vault selection, minimal graph camera), filter shell-owned keyboard chords in the raw-input path before the PTY drains input, and put all `Store`/`Watch` interaction behind a serialized vault-host worker that publishes immutable `VaultIndex` snapshots. Use egui's own `Panel`, `Window`, and `Area`; do not add UI dependencies. [CITED: https://docs.rs/eframe/0.36.2/eframe/trait.App.html] [CITED: https://docs.rs/egui/0.36.2/egui/containers/panel/index.html] [CITED: https://docs.rs/egui/0.36.2/egui/containers/struct.Area.html]

The app already has full-window dispatch in `App.maximized` and `tab_ui`, plus living terminal, editor, notes, highlights, marks, and simulation state. The safest strangler path is to keep those owners and make palette selections set the hosted destination, then remove `egui_dock` only when all views and `ide.open_requests`/`reveal_files` transitions have shell equivalents. The existing `Tab` identity remains a persistence constraint. [VERIFIED: apps/canvas/src/main.rs:153-162, 321-338, 1688-1724]

Vault selection is separate from simulation `world_dir()` and `Ide::serve_world`. Start the host with the chosen root, let its single I/O worker own `Store`, `Watch`, receiver draining, fallback rescans and index rebuilds, and publish snapshots back to the UI. Phase 1 verification passed headless store/fallback behavior but reports native watcher delivery as unverified on the runner; keep fallback rescan and do not make native events the only refresh path. [VERIFIED: apps/canvas/src/main.rs:94-104, 389-409] [VERIFIED: crates/vault/src/store.rs:152-160, 216-235] [VERIFIED: crates/vault/src/watch.rs:1-3, 18-49] [CITED: .planning/phases/01-vault-model/01-VERIFICATION.md, “Native filesystem notification delivery”]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Workspace shell, palette, explorer and keyboard routing | Browser / Client | — | Native egui frame owns interaction and view composition. |
| Vault path selection and persistence | API / Backend | Database / Storage | App lifecycle validates and persists the selected root; filesystem root is external storage. |
| Vault scan, write serialization, watcher and index publication | Database / Storage | API / Backend | Filesystem I/O and Phase 1 model belong to one background host; App consumes published snapshots. |
| Existing tools and simulation lifecycle | Browser / Client | API / Backend | Existing `App` owns tools and timeline; shell routes visibility and shortcut eligibility. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `eframe` / `egui` | 0.36.2 | Native app frame, panels, floating windows, palette overlay and input | Already in the application; `eframe::App::ui` owns the frame and egui provides top-level panels, windows, and areas. [VERIFIED: apps/canvas/Cargo.toml:11-12] [CITED: https://docs.rs/eframe/latest/eframe/trait.App.html] [CITED: https://docs.rs/egui/latest/egui/containers/panel/index.html] |
| `tapestry-vault` | workspace path crate | Scanning, index, serialized writes, own-write suppression and watcher message types | Phase 1 already exports `Store`, `VaultCmd`, `Watch`, `WatchMsg`, `scan`, and `VaultIndex`; Phase 2 is explicitly the app-side host integration. [VERIFIED: crates/vault/src/lib.rs:15-30] |
| `notify-debouncer-full` | 0.7.0 | Debounced recursive vault filesystem events | Already used by Phase 1 watcher; debouncer coalesces related events and supports callback/channel delivery. [VERIFIED: crates/vault/Cargo.toml:11-12] [CITED: https://docs.rs/notify-debouncer-full/latest/notify_debouncer_full/] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `serde` / `serde_json` | 1.0.229 / 1.0.151 | Persist vault selection and shell UI state | Continue existing JSON state conventions; avoid persisting the removed `DockState`. [VERIFIED: apps/canvas/Cargo.toml:20-21] |
| `std::sync::mpsc` / `std::thread` | Rust standard library | Commands/events across UI and serialized I/O boundary | Keep UI callbacks limited to enqueueing commands and consuming published state. Phase 1 watcher already accepts `Sender<WatchMsg>`. [VERIFIED: crates/vault/src/watch.rs:5-7, 30-45] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native egui shell primitives | External component toolkit or custom renderer | Adds a second UI system and package surface without helping retain existing native views. Keep egui because the app is already egui and the UI spec forbids a separate component kit. [VERIFIED: apps/canvas/Cargo.toml:11-18] [CITED: .planning/phases/02-shell/02-UI-SPEC.md, “Design System”] |
| One serialized host for Store and Watch | Independent scan/write threads | Concurrent writers or scans can publish stale snapshots and race own-write classification; keep all vault state transitions serialized as D-10 requires. [VERIFIED: crates/vault/src/store.rs:1-2] [VERIFIED: crates/vault/src/watch.rs:1-3] |

**Installation:** No package installation is required for the recommended approach. The current manifests already provide egui/eframe, serialization, vault Store/Watch dependencies, and filesystem watcher support. [VERIFIED: apps/canvas/Cargo.toml:11-25] [VERIFIED: crates/vault/Cargo.toml:1-14]

## Architecture Patterns

### System Architecture Diagram

```text
Palette Cmd-K ─┐                      ┌─ hosted existing tool view
Explorer click ├─► Shell Action ─► App ├─ hosted Simulation composite
Canvas target ─┘                      └─ blank graph stub (default)
                                           │ snapshot + commands
                                    VaultHost handle
                                           │ mpsc
                                           ▼
                                  serialized I/O worker
                                  ├─ Store commands/writes
                                  ├─ Watch messages/classify
                                  ├─ periodic Store::rescan fallback
                                  ├─ scan + VaultIndex build
                                  └─ publish snapshot; request repaint
```

### Recommended Project Structure

```text
apps/canvas/src/
├── main.rs          # App lifecycle, existing tools, action routing
├── shell.rs         # hosted view, explorer/palette state and input router
├── vault_host.rs    # serialized Store/Watch worker and snapshot handoff
└── ...              # existing ide, notes, marks, terminal, simulation modules
```

The modules are recommendations, not existing paths. Keep shell and vault-host logic out of a large `main.rs` expansion where practical; Phase context explicitly calls for additive shell work and a precise test split in agent discretion. [CITED: .planning/phases/02-shell/02-CONTEXT.md, “the agent's Discretion” and “Established Patterns”]

### Pattern 1: View hosting without changing Tab identity

**What:** Keep existing `Tab` values and existing `tab_ui` rendering; use a separate shell destination to distinguish the default graph workspace from hosted tools. The `Tab` definition to preserve is:

```rust
enum Tab {
    Canvas,
    Brushes,
    Rules,
    Timeline,
    Files,
    Terminals,
    Notes,
    File(PathBuf),
}
```

This is quoted verbatim from the source definition. [VERIFIED: apps/canvas/src/main.rs:153-162]

**When to use:** Every palette tool action and every transition caused by `ide.open_requests` or `ide.reveal_files`.

**Example:**

```rust
// Recommended shell seam; keep existing Tab values as-is.
match shell.hosted_tool.as_mut() {
    Some(tab) => app.tab_ui(ui, tab),
    None => shell.graph_stub(ui, vault.snapshot()),
}
```

Suggested function names are illustrative and `[ASSUMED]`; the invariant is that changing view does not reconstruct or rename `Ide`, terminal, notebook, mark, or timeline owners. Those owners are fields of the current `App`, and the existing `tab_ui` routes into them. [VERIFIED: apps/canvas/src/main.rs:321-374, 1688-1724]

### Pattern 2: One focus-aware input router

**What:** Keep one shortcut policy, but split its timing across the eframe raw-input hook and the UI frame: identify global chords and remove their matching raw key/text events before the PTY handler can drain them, then apply the resulting shell action during `App::ui`. Extend the existing `raw_input_hook` and retain `marks.intercept`; filter shell-owned events before the current mark interception, then queue state transitions for the UI frame. Eframe documents `raw_input_hook` as a pre-egui input filter. `InputState::consume_key`/`consume_shortcut` is still useful for preventing egui widgets from reusing a press, but it does not remove `InputState.events`; the terminal drains that vector itself. Check more-specific modifier combinations first. [CITED: https://docs.rs/eframe/0.36.2/eframe/trait.App.html] [CITED: https://docs.rs/egui/0.36.2/egui/struct.InputState.html] [VERIFIED: apps/canvas/src/main.rs:1562-1566] [VERIFIED: apps/canvas/src/term.rs:311-352]

**Esc precedence:** palette open → close palette; focused text editor/terminal or tool-specific focus → let owner handle; hosted tool → return to graph; graph workspace → canvas-local cancel/selection behavior. Route terminal exit chord through the same handler and filter both key and associated text events before PTY input. Current simulation keyboard returns when egui wants keyboard input or a terminal is active, but otherwise handles Space, numbers, Delete/Backspace, Escape, arrows and Cmd-Z globally; make the new router authoritative rather than retaining a second global call. [VERIFIED: apps/canvas/src/main.rs:541-601] [VERIFIED: apps/canvas/src/ide.rs:1664-1677] [VERIFIED: apps/canvas/src/term.rs:313-352] [CITED: https://docs.rs/egui/0.36.2/egui/enum.Event.html]

### Pattern 3: Foreground palette and explorer composition

**What:** Add an `egui::Panel::left` before `CentralPanel`, keep `CentralPanel` last, and show a foreground `egui::Area` for Cmd-K results. `Panel` ordering is significant; `Area` with `Order::Foreground` is documented for popups that must remain above windows. [CITED: https://docs.rs/egui/latest/egui/containers/panel/index.html] [CITED: https://docs.rs/egui/latest/egui/containers/struct.Area.html] [CITED: https://docs.rs/egui/latest/egui/layers/enum.Order.html]

**Float requirement:** Implement the explorer as one stateful surface with two presentations: docked `Panel::left` by default, and a movable/resizable/closable `egui::Window` after dragging its explorer header away from the dock edge. Keep its tree selection and scroll state in the shared explorer model as it changes presentation; expose close/reopen through the visible close affordance and Cmd-\\ palette command. An egui `Window` is a floating window inside the app viewport, not another native OS window. Keep the palette as a foreground `Area`, not a second OS viewport. [CITED: https://docs.rs/egui/0.36.2/egui/containers/panel/struct.Panel.html] [CITED: https://docs.rs/egui/0.36.2/egui/containers/struct.Window.html] [CITED: https://docs.rs/egui/0.36.2/egui/containers/struct.Area.html] The app-level drag threshold/transition is a recommended implementation detail and needs a project UI check. `[ASSUMED]`

### Pattern 4: Serialized vault host and immutable snapshots

**What:** Create or canonicalize the root, open `Store`, scan and build an initial `VaultIndex`, then run one worker owning Store and Watch. Receive UI `VaultCmd`s and `WatchMsg`s in the same worker; on changed notes call `Store::classify`, on rescan/periodic fallback call `Store::rescan`, refresh scan/index, and publish a new `Arc<VaultIndex>`. The watcher callback should only send messages; no filesystem scan or note parsing should run on egui's frame thread. A worker can notify the UI via a cloned `egui::Context::request_repaint`. [VERIFIED: crates/vault/src/store.rs:152-160, 216-235] [VERIFIED: crates/vault/src/watch.rs:30-49] [VERIFIED: crates/vault/src/index.rs:68-78, 106-109] [CITED: https://docs.rs/eframe/latest/eframe/trait.App.html]

**Own-write rule:** Preserve the single Store path so hashes from Tapestry's own writes remain classified as own echoes and do not trigger external-change reload behavior. Do not replace the existing classifier with raw notify-event-kind assumptions; Phase 1 routes names and uses content/hash classification. [VERIFIED: crates/vault/src/store.rs:122-128, 238-240] [VERIFIED: crates/vault/src/watch.rs:78-115]

### Pattern 5: Vault root persistence separate from simulation world

Persist the selected vault root independently of `world_dir()` and the world path passed into `Ide::new`/`serve_world`; only the vault selection controls scan/index/store/watch. Start at repository `world/vault/`, creating the directory when absent, then reopen the last selected root on restart. For path changes, stop/drop the old watcher on the I/O owner, switch the Store root, produce a fresh snapshot, and retain the previous usable shell until that switch succeeds. The path and default are locked by the phase decision; JSON state persistence fits the existing app convention. [VERIFIED: apps/canvas/src/main.rs:94-104, 389-409] [VERIFIED: apps/canvas/src/ide.rs:122-130, 343-345] [CITED: .planning/phases/02-shell/02-CONTEXT.md:27] [CITED: https://docs.rs/eframe/latest/eframe/trait.Storage.html]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filesystem watching and event coalescing | A custom platform watcher or per-frame directory poll as the sole refresh path | Existing `Watch` and `notify-debouncer-full`; keep `Store::rescan` as fallback | Phase 1 already maps events to changed note paths/rescan/errors, while native delivery was not observed in the prior runner. [VERIFIED: crates/vault/src/watch.rs:1-3, 18-49] [CITED: https://docs.rs/notify-debouncer-full/latest/notify_debouncer_full/] |
| Note writes and own-write filtering | Direct `std::fs::write` from UI handlers or watcher callbacks | Existing `Store` and `VaultCmd` on the serialized worker | Store is documented as the one serialized writer and writes by fresh-read splice/atomic replacement; it also classifies changes. [VERIFIED: crates/vault/src/store.rs:1-2, 19-60, 122-160] |
| Fuzzy matching | New matcher dependency for initial tool/note/folder palette | Small in-memory subsequence scorer or existing project matching helper | Phase 2 discretion allows matching implementation; current dependency set needs no new package for a command list and current index. `[ASSUMED]` specific scorer choice; profile if vault scale shows it insufficient. |

## Common Pitfalls

### Pitfall 1: Palette shortcut is swallowed by terminal input

**What goes wrong:** Cmd-K is forwarded to the PTY, or terminal focus blocks the palette. **Why:** `Ide::terminal_active()` makes app keyboard handling return early, and `term.take_input` drains `InputState.events` directly, sending text and key presses to the PTY. egui key consumption does not remove those raw events. **How to avoid:** In `raw_input_hook`, detect the shell chord, record the pending shell action, and filter its key and related text events from `RawInput.events`; apply the pending action in `App::ui`. Use `consume_key` as an additional egui-level consumed marker where needed. **Warning signs:** Terminal prints `k`, palette opens only after blur, or key event is duplicated. [VERIFIED: apps/canvas/src/main.rs:541-545, 1562-1566, 1579-1585] [VERIFIED: apps/canvas/src/term.rs:311-352] [CITED: https://docs.rs/eframe/0.36.2/eframe/trait.App.html] [CITED: https://docs.rs/egui/0.36.2/egui/enum.Event.html]

### Pitfall 2: Shell shortcuts leak into text fields or the wrong tool

**What goes wrong:** Typing a digit, deleting text, or pressing Space mutates the simulation. **Why:** Existing simulation shortcut dispatch is frame-global when focus is not captured. **How to avoid:** One router checks egui keyboard intent and active tool; simulation bindings run only while Simulation is visible, with specific modifiers consumed once. **Warning signs:** Repro occurs while canvas, editor, or terminal is active. [VERIFIED: apps/canvas/src/main.rs:541-594] [CITED: https://docs.rs/egui/latest/egui/struct.InputState.html]

### Pitfall 3: Hidden view state is reconstructed or disabled

**What goes wrong:** Terminals exit on view change or tool state resets; simulation keeps consuming clock work hidden; screenshot automation waits forever. **Why:** Tool state is held in `App`/`Ide`, while current `run_clock` and `take_shot` run at frame end and shot timing depends on timeline ticks. **How to avoid:** Hide views without dropping owners; call `ide.begin_frame` unconditionally; gate `run_clock` on Simulation visibility; trigger `TAPESTRY_SHOT` independently of hidden simulation time. **Warning signs:** terminal session loss, timeline advancing hidden, or `TAPESTRY_SHOT` hangs when graph is shown. [VERIFIED: apps/canvas/src/main.rs:321-374, 1579, 1670-1671, 1727-1752]

### Pitfall 4: Dock persistence or debug marks break after replacing egui_dock

**What goes wrong:** Startup deserialization fails, file tabs disappear, or marks no longer resolve. **Why:** Persisted dock state encodes `Tab`, file tabs, maximized view, root/here; marks key panes using `format!("{tab:?}")`. **How to avoid:** Preserve exact `Tab` variants and debug names; migrate/ignore old layout data safely while keeping vault selection and file buffers; do not delete old synced keys via a broad sync write unless migration explicitly handles them. **Warning signs:** malformed layout resets, dirty file tab lost, or existing mark pane key changes. [VERIFIED: apps/canvas/src/main.rs:153-162, 261-267, 464-489, 1691-1696] [VERIFIED: apps/canvas/src/ide.rs:147-150]

### Pitfall 5: Filesystem work blocks frames or watcher echo causes refresh loops

**What goes wrong:** Explorer stutters on large vaults, stale index overwrites current state, or an app write is treated as outside modification. **Why:** Scanning and indexing are filesystem/CPU work; notify messages can represent either app writes or outside edits. **How to avoid:** Keep scan, classify, rescan and index rebuild on serialized worker; publish immutable snapshots and request repaint; use `Store::classify` hash identity after each Watch message and maintain periodic fallback. **Warning signs:** frame latency rises with vault size, worker race, duplicate reload, or editor loses dirty state. [VERIFIED: crates/vault/src/store.rs:216-235, 238-240] [VERIFIED: crates/vault/src/watch.rs:1-3] [CITED: https://docs.rs/eframe/latest/eframe/trait.App.html]

## Code Examples

Verified API pattern for a top-level left panel and central workspace; add floating windows after top-level panels and keep central panel last. [CITED: https://docs.rs/egui/latest/egui/containers/panel/index.html]

```rust
egui::Panel::left("explorer")
    .resizable(true)
    .show(ui, |ui| explorer.ui(ui));

egui::CentralPanel::default().show(ui, |ui| workspace.ui(ui));
```

For the command palette, use the documented foreground layer. Consume the shortcut in the router before tool input handlers; `consume_key` returns true only once for the matching press. [CITED: https://docs.rs/egui/latest/egui/containers/struct.Area.html] [CITED: https://docs.rs/egui/latest/egui/struct.InputState.html]

```rust
// Recommended shared seam; route_shortcuts is project code to add.
fn raw_input_hook(&mut self, ctx: &egui::Context, raw: &mut egui::RawInput) {
    let routed = self.shell.route_shortcuts(ctx, &raw.events, self.ide.terminal_active());
    raw.events.retain(|event| !routed.filters(event));
    self.pending_shell_actions.extend(routed.actions);
}

// Apply queued shell actions during App::ui, before tool dispatch.
if self.shell.palette_open {
    egui::Area::new("command-palette".into())
        .order(egui::Order::Foreground)
        .show(ctx, |ui| self.shell.palette_ui(ui));
}
```

The router/action helper names above are a design skeleton, not existing APIs. `[ASSUMED]` `raw_input_hook` can filter pre-egui events; filtering must account for both `Event::Key` and `Event::Text`, since the terminal consumes both variants. [CITED: https://docs.rs/eframe/0.36.2/eframe/trait.App.html] [CITED: https://docs.rs/egui/0.36.2/egui/enum.Event.html]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust built-in test harness / Cargo |
| Config file | Workspace Cargo manifests |
| Quick run command | `cargo test -p tapestry-canvas-app --offline` |
| Full suite command | `cargo test -p tapestry-canvas -p tapestry-canvas-app -p tapestry-vault --offline` |

Existing app UI code has no dedicated UI-test framework; vault has integration tests under `crates/vault/tests/`. Add focused pure tests for input precedence/action mapping and vault-root persistence/default/path switch behavior; test tool smoke routing through extracted action/state functions, and use screenshot automation for the shell and explorer. Avoid writing tests around egui rendering internals. [VERIFIED: apps/canvas/Cargo.toml:1-25] [VERIFIED: crates/vault/tests/scan.rs, crates/vault/tests/watch.rs, crates/vault/tests/store.rs] `[ASSUMED]` package test command is a fast/valid target; environment has Cargo 1.99 and Rust 1.99. [VERIFIED: local `cargo --version`, `rustc --version` output 2026-10-22]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VAULT-01 | Default/create vault folder, choose arbitrary folder, reopen last selected path without touching separate `--world` setting | unit + integration | `cargo test -p tapestry-canvas-app --offline vault_selection` | ❌ Add phase test |
| SHELL-01 | Default graph route and removal of `egui_dock` dependency/import/source references | unit + build | `cargo test -p tapestry-canvas-app --offline shell` and `cargo build -p tapestry-canvas-app --offline` | ❌ Add shell state test |
| SHELL-02 | Explorer visibility, close/reopen, resize and drag/floating behavior | manual screenshot/UI check | `TAPESTRY_SHOT=<path>:<seconds> cargo run -p tapestry-canvas-app --offline` | ❌ Human-observable UI check |
| SHELL-03 | Palette content, fuzzy matching and Cmd-K while terminal owns focus | unit + manual UI | `cargo test -p tapestry-canvas-app --offline palette` | ❌ Add pure matcher/action test |
| SHELL-04 | Every hosted destination routes to its existing renderer; state/tool side effects persist; screenshots work from all routes | unit + smoke/screenshot | `cargo test -p tapestry-canvas-app --offline tool_routing`; `TAPESTRY_SHOT=<path>:<seconds> cargo run -p tapestry-canvas-app --offline` | ❌ Add routing test |
| SHELL-05 | Esc precedence, terminal exit chord filtering, simulation shortcuts only in Simulation | unit | `cargo test -p tapestry-canvas-app --offline input_router` | ❌ Add precedence test |
| SHELL-06 | Explorer and palette selection target same note/folder camera navigation | unit | `cargo test -p tapestry-canvas-app --offline navigation_action` | ❌ Add action test |

### Wave 0 Gaps

- [ ] Add pure shell tests for shortcut precedence and destination action routing.
- [ ] Add vault-selection tests for default path creation, persistence/reopen, invalid/unreadable path behavior, and independence from `--world`.
- [ ] Add a worker-level test or injectable worker loop harness proving Watch messages and periodic rescan refresh a published snapshot and own writes are not reclassified as external.
- [ ] Add nonblocking screenshot/UI check for explorer close/reopen, resize/float, Cmd-K with terminal focus, and screenshot from non-Simulation view.

## Security Domain

`security_enforcement` is enabled with ASVS level 1. The source values are `"security_enforcement": true,` and `"security_asvs_level": 1,`. ASVS is a web-application control standard; apply relevant categories as a local-file desktop threat checklist, not a claim of web authentication/session requirements. [VERIFIED: .planning/config.json:47-48] [CITED: https://asvs.owasp.org/]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No app sign-in or user identity boundary in this phase. |
| V3 Session Management | no | No network session/cookie layer in the native shell. |
| V4 Access Control | yes | Respect OS access control; do not elevate privileges; surface unreadable root errors while retaining the previous snapshot. |
| V5 Input Validation, Sanitization and Encoding | yes | Validate/canonicalize the selected root and note-relative paths; route note mutations only through `Store`, which rejects malformed paths and symlink writes. [VERIFIED: crates/vault/src/store.rs:130-149, 163-177] |
| V6 Stored Cryptography | no | No secret or cryptographic storage feature is in scope. |

### Known Threat Patterns for a native filesystem app

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User-selected path escapes or unexpectedly resolves through symlinks | Tampering / Elevation | Canonicalize root, enforce relative note paths, retain Store's symlink protections, never construct a note path from unchecked UI text. [VERIFIED: crates/vault/src/store.rs:130-149, 163-177] |
| External edits race app writes | Tampering | Serialize all Store operations and watcher classification on one worker; use Store hash/conflict behavior. [VERIFIED: crates/vault/src/store.rs:152-160, 216-240] |
| Exit chord reaches shell/PTy command input | Elevation | Filter the chord's key/text events before `term.take_input`; test terminal-active path. [VERIFIED: apps/canvas/src/ide.rs:1664-1677] [VERIFIED: apps/canvas/src/term.rs:311-352] |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust/Cargo | Build and phase checks | ✓ | rustc 1.99.0 / cargo 1.99.0 | — |
| egui/eframe | Existing native UI | ✓ | 0.36.2 locked in Cargo manifests/lockfile | — |
| notify filesystem backend | Runtime watcher | Present in dependency tree; host delivery not validated by Phase 1 runner | notify 8.2.0 / notify-debouncer-full 0.7.0 | `Store::rescan` periodic fallback |

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Local app state includes `synced.json`, `marks.jsonl`, and `window.json`; the synced layout value is currently read/written under the exact key `"layout"`, and pane marks use `format!("{tab:?}")`. The app state root is produced by `state_dir()` from `$XDG_STATE_HOME` or `$HOME/.local/state`, then `tapestry`. [VERIFIED: apps/canvas/src/sync.rs:45-46, 98-105] [VERIFIED: apps/canvas/src/main.rs:251-254, 455-489, 511-526, 1691-1696] [VERIFIED: apps/canvas/src/marks.rs:14, 513-515] [VERIFIED: apps/canvas/src/ide.rs:2088-2094] | Keep existing marks identities and user vault choice. Store new shell geometry/open state and selected vault separately; leave the old `"layout"` key untouched/inert rather than writing a replacement shape under that key. This is a local persisted-state migration, not a vault data migration. |
| Live service config | `Synced` is documented as synced with known Tapestry servers using `/api/shared`; the local `layout` value can therefore be mirrored to service state. The actual remote server's saved value was not inspected. [VERIFIED: apps/canvas/src/sync.rs:1-4] | Do not reuse or delete `layout` in the new shell. Keep the app's syncing reader tolerant of the legacy key; no server schema change is indicated by this phase. Remote copy cleanup is unverified and not required for the local shell to ignore the old record. |
| OS-registered state | No Phase 2 shell registration path was found in the app sources inspected; the current window geometry is loaded from app state `window.json`. [VERIFIED: apps/canvas/src/main.rs:251-254] | No registration update identified. OS-global registrations were not inspected; if the app is externally registered by a launcher, that registration is outside the shell state migration. `[ASSUMED]` |
| Secrets / env vars | The current app uses `HOME` / `XDG_STATE_HOME` to derive state root and `TAPESTRY_VIEW`, `TAPESTRY_SHOT`, and `--world` for current view/screenshot/simulation behavior; no vault-selection setting exists in the read startup path. [VERIFIED: apps/canvas/src/ide.rs:2088-2094] [VERIFIED: apps/canvas/src/main.rs:94-104, 426-442] | Add remembered vault root to local app state; do not repurpose `--world` or screenshot/view environment variables. No secret migration was found in the inspected repo sources; external launch/CI environment was not inspected. `[ASSUMED]` |
| Build artifacts / installed packages | No shell package rename is part of this phase; `tapestry-canvas-app` remains the Cargo package and the app binary is still built from `apps/canvas/src/main.rs`. [VERIFIED: apps/canvas/Cargo.toml:1-10] | Rebuild normal Cargo targets. No external installed artifact migration was found in the inspected repo sources. `[ASSUMED]` |

## Project Constraints (from AGENTS.md)

- Read `.claude/CLAUDE.md`, `.claude/settings.json`, and relevant project skills before acting; loaded for this research. [VERIFIED: AGENTS.md:3-8]
- Shared worktree: inspect current changes before editing, coordinate through `tools/claims/claim`, and stage only task-owned paths. [VERIFIED: AGENTS.md:10-13]
- When an operation is blocked, record the blocker, leave protected files untouched, and continue independent work; do not bypass approval or sandbox boundaries. [VERIFIED: AGENTS.md:15-19]
- GSD work must consult `.planning/` state and the applicable phase plan/context. [VERIFIED: AGENTS.md:21-23]
- Project guidance says do not add blocking-human or human-verification checkpoints; its exact follow-up path is `.context/HUMAN-QUESTIONS.md`. [VERIFIED: .claude/CLAUDE.md:12-14]
- Do not stage unrelated user/session changes. Current worktree contains unrelated staged world notes and untracked session files; leave them untouched. [VERIFIED: `git status --short`, 2026-10-22]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A small in-memory subsequence scorer is sufficient for the expected Phase 2 palette result count. | Don't Hand-Roll | Large vaults or fuzzy ranking quality may require a vetted matcher later. |
| A2 | The app-level drag threshold and Panel-to-Window transition will feel like the specified detach interaction. | Pattern 3 | The interaction may need adjustment after the native UI check. |
| A3 | The `route_shortcuts`, `filters`, `actions`, and pending-action skeleton maps cleanly onto egui raw-input events and the existing `App` fields. | Code Examples | The planner may need to adjust helper/state boundaries to preserve focus and PTY semantics. |
| A4 | No external secret/env configuration or installed shell package embeds a value that needs migration. | Runtime State Inventory | Deployment/launcher state outside the repository might require updating if it contains a vault path or app identity. |

## Open Questions

1. **Explorer docking and floating in egui:** Does the recommended panel-header drag threshold make the dock-to-float interaction discoverable and predictable? Keep one explorer state and validate the transition with a native UI check.
2. **Terminal exit chord:** The phase decisions require a terminal exit chord but do not name its key combination. Choose an unobtrusive chord in the plan and verify it is removed before `take_input`.
3. **Vault-host command responsiveness:** The exact channel/message loop and snapshot synchronization primitive are discretion areas. Keep one Store owner and publish whole immutable snapshots; select bounded channel behavior based on whether UI command backpressure can be handled without blocking a frame.

## Sources

### Primary (HIGH confidence)
- `apps/canvas/src/main.rs`, `apps/canvas/src/ide.rs` — current frame, tool dispatch, keyboard, screenshot, terminal and IDE lifecycle.
- `crates/vault/src/lib.rs`, `store.rs`, `watch.rs`, `scan.rs`, `index.rs` — Phase 1 exported APIs and host integration contract.
- `.planning/phases/02-shell/02-CONTEXT.md`, `02-UI-SPEC.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — locked design and acceptance criteria.
- `.planning/phases/01-vault-model/01-VERIFICATION.md` — verified headless/fallback behavior and native watcher limitation.

### Secondary (MEDIUM confidence)
- [egui panel docs](https://docs.rs/egui/latest/egui/containers/panel/index.html) — panel ordering and central panel placement.
- [egui Window docs](https://docs.rs/egui/0.36.2/egui/containers/struct.Window.html) — movable/resizable/closable egui floating window behavior; clarifies that this is not a separate native OS window.
- [egui Area docs](https://docs.rs/egui/latest/egui/containers/struct.Area.html), [egui layer ordering](https://docs.rs/egui/latest/egui/layers/enum.Order.html) — foreground palette overlay.
- [egui InputState docs](https://docs.rs/egui/latest/egui/struct.InputState.html) — consuming keys/shortcuts and modifier match behavior.
- [eframe App docs](https://docs.rs/eframe/latest/eframe/trait.App.html), [eframe Storage docs](https://docs.rs/eframe/latest/eframe/trait.Storage.html) — repaint wakeup and persistence capabilities.
- [notify-debouncer-full docs](https://docs.rs/notify-debouncer-full/latest/notify_debouncer_full/) — debounce and watcher integration pattern.
- [OWASP ASVS](https://asvs.owasp.org/) — current standard scope/version; mapping above is tailored to this local desktop phase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — manifest and lockfile already resolve the shell/runtime packages; no packages added.
- Architecture: HIGH — existing app and vault seams were opened directly; new module boundaries are recommendations.
- Pitfalls: HIGH — terminal routing, global simulation shortcuts, hidden clock/screenshot dependencies and persistence keys are directly visible in source.
- egui interaction detail: MEDIUM — official API docs confirm primitives; exact drag-to-float interaction needs a project UI check.

**Research date:** 2026-10-22
**Valid until:** 2026-11-21 (stable Rust/egui APIs; recheck docs if dependencies change)
