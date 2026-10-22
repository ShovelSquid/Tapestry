# Phase 2: Shell - Pattern Map

**Mapped:** 2026-10-22  
**Files analyzed:** 4 primary integration files; exact new shell module split is not fixed yet  
**Analogs found:** 4 / 4

This phase introduces shell-owned state and host code, but the exact file list is not locked by CONTEXT/RESEARCH. The assignments below identify likely modules by responsibility; keep the existing `App` integration points until implementation tasks decide whether to extract them.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/canvas/src/main.rs` (modify) | app controller / route | request-response, event-driven | `apps/canvas/src/main.rs` (`App::ui`, `tab_ui`) | exact |
| `apps/canvas/src/shell.rs` (likely new) | UI component / state | request-response, event-driven | `apps/canvas/src/main.rs` (`tab_ui`) and `apps/canvas/src/ide.rs` (`files_ui`) | role-match |
| `apps/canvas/src/vault_host.rs` (likely new) | service / worker | file-I/O, event-driven, command-response | `crates/vault/src/watch.rs` + `store.rs`; app worker style in `apps/canvas/src/translate.rs` | role-match |
| `apps/canvas/src/main.rs` or shell module (vault selection/persistence) | config / state utility | file-I/O, request-response | `apps/canvas/src/ide.rs` state persistence and `main.rs::Panes` | role-match |

## Pattern Assignments

### `apps/canvas/src/main.rs` (app controller, request-response/event-driven)

**Analog:** `apps/canvas/src/main.rs`, tracked source (`git ls-files` confirmed).

**App frame and integration seam** (`apps/canvas/src/main.rs:1562-1585`):

```rust
impl eframe::App for App {
    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        let (tool, radius) = (self.tool(), self.radius);
        self.marks.intercept(raw, tool, radius);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.ide.begin_frame(ui.ctx());
        self.take_synced();
        self.marks.begin_frame();
        let selected = self.ide.term_selection();
        self.highlights
            .begin_frame(ui.ctx(), selected.as_ref(), self.ide.terminal_active());
        self.keyboard(ui);
        // Compose top bar and active shell/tool view here.
    }
}
```

Keep the app frame as the composition root: frame-start integrations and global overlays stay active across every route. `ide.begin_frame` must remain unconditional so terminal state, sync, and focus are updated even while a view is hidden.

**View dispatch and mark identity** (`apps/canvas/src/main.rs:1689-1724`):

```rust
fn tab_ui(&mut self, ui: &mut egui::Ui, tab: &mut Tab) {
    let label = match &*tab {
        Tab::File(p) => p.display().to_string(),
        t => format!("{t:?}").to_lowercase(),
    };
    self.marks.pane(format!("{tab:?}"), ui.max_rect(), label);
    match tab {
        Tab::Canvas => self.canvas(ui),
        Tab::Brushes => self.palette(ui),
        Tab::Rules => self.notes(ui),
        Tab::Timeline => self.timeline_bar(ui),
        Tab::Files => self.ide.files_ui(ui),
        Tab::Terminals => self.ide.terminals_ui(ui),
        Tab::Notes => self.notebook.ui(ui),
        Tab::File(path) => self.ide.editor_ui(ui, path),
    }
}
```

Preserve every `Tab` variant and its `Debug` identity (`main.rs:153-161`); layout serialization and marks use those names (`main.rs:253-267`, `ide.rs:147-150`). Simulation's hosted destination combines Canvas, Brushes, and Timeline while preserving these existing renderers/state owners. Keep highlights/marks above route content as currently composed in `main.rs:1634-1668`.

**Input guard and precedence source** (`apps/canvas/src/main.rs:541-594`):

```rust
fn keyboard(&mut self, ui: &egui::Ui) {
    if ui.ctx().egui_wants_keyboard_input() || self.ide.terminal_active() {
        return;
    }
    // Existing simulation bindings are handled only after this guard.
    ui.input(|i| {
        if i.key_pressed(egui::Key::Space) { self.playing = !self.playing; }
        if i.key_pressed(egui::Key::Escape) { self.selected = None; }
        // brush, timeline, and edit bindings follow
    });
}
```

This is a useful guard pattern for simulation-specific keys, but the new global router must precede this early return so Cmd-K works with terminal/text focus. For Cmd-K/terminal exit chords, inspect and filter `RawInput.events` in `raw_input_hook` before the existing `marks.intercept` path; terminal code consumes raw key/text events independently of egui's consumed-key marker.

**Clock and screenshot boundary** (`main.rs:606-623`, `1727-1753`):

```rust
if self.playing && self.timeline.caught_up() {
    self.clock += ui.input(|i| i.stable_dt).min(0.1);
    // advance simulation ticks
}
self.timeline.catch_up(Some(deadline));
```

Gate this work to the Simulation destination when hidden. `take_shot` currently waits for `timeline.tick() >= at` (`main.rs:1727-1734`), so replace the tick dependency with an elapsed/frame-time trigger while preserving the screenshot event capture, PNG write, and viewport close behavior (`1735-1753`).

### `apps/canvas/src/shell.rs` (likely shell component/state, request-response)

**Analog:** `apps/canvas/src/main.rs::tab_ui` for routing and `apps/canvas/src/ide.rs::files_ui` for navigation UI; both tracked sources.

**Explorer listing pattern** (`ide.rs:698-729`):

```rust
fn relist(&mut self, now: f64) {
    if now - self.listed_at < 2.0 { return; }
    self.listed_at = now;
    let mut entries = Vec::new();
    if let Ok(read) = std::fs::read_dir(&self.here) {
        for e in read.flatten() {
            let path = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || SKIP.contains(&name.as_str()) { continue; }
            entries.push(read_entry(path, name));
        }
    }
    entries.sort_by(|a,b| (a.kind != Kind::Folder, a.name.to_lowercase())
        .cmp(&(b.kind != Kind::Folder, b.name.to_lowercase())));
    self.entries = entries;
}
```

Reuse `VaultIndex` snapshot contents for the new explorer rather than this direct filesystem polling. Match its folder-first/case-insensitive ordering and existing quiet-link styling; the index's sorted maps expose folders and notes. Selection should emit one shell navigation action consumed identically by explorer and palette, with folder/note camera semantics owned by the graph workspace.

Use egui-native `Panel`/`Window`/`Area` as specified in `02-UI-SPEC.md`; current code establishes panels in `App::ui` (`main.rs:1587+`) but does not contain detachable explorer behavior. The Panel-to-Window drag transition is new and remains an implementation/UI-check boundary, not a pattern already solved in source.

### `apps/canvas/src/vault_host.rs` (likely worker/service, file-I/O and event-driven)

**Analog:** `crates/vault/src/store.rs` + `watch.rs`, and `apps/canvas/src/translate.rs`; all tracked (`git ls-files` verified).

**Store ownership / serialization** (`store.rs:152-167, 216-240`):

```rust
pub struct Store { root: PathBuf, /* writer and change-classification state */ }

impl Store {
    pub fn open(root: &Path) -> std::io::Result<Store> {
        let root = root.canonicalize()?;
        // establish stats/journal state
        Ok(Store { root, /* initialized fields */ })
    }
    pub fn rescan(&mut self) -> std::io::Result<Vec<(String, Change)>> { /* ... */ }
    pub fn classify(&mut self, rel: &str) -> Change { /* hash identifies own/external writes */ }
}
```

Worker must be the sole owner of `Store` and `Watch`; funnel UI `VaultCmd`, watcher `WatchMsg`, and periodic fallback ticks through that one loop. On `Changed(paths)`, call `classify` and refresh only for `External`/`Removed`; on `Rescan` and fallback interval, call `rescan`. Rebuild via `scan::scan` then `VaultIndex::build`, publish immutable `Arc<VaultIndex>` snapshots. Preserve `OwnEcho` suppression; do not infer external edits from notify event kinds.

**Watcher callback** (`watch.rs:30-49, 78-115`):

```rust
pub fn start(root: &Path, tx: Sender<WatchMsg>) -> Result<Watch, notify::Error> {
    let root = root.canonicalize()?;
    let handler_root = root.clone();
    let mut debouncer = new_debouncer_opt(DEBOUNCE, None, move |result| {
        for message in route(&handler_root, result) {
            let _ = tx.send(message);
        }
    }, NoCache::new(), notify::Config::default())?;
    debouncer.watch(&root, RecursiveMode::Recursive)?;
    Ok(Watch { root, _debouncer: debouncer })
}
```

The callback only sends messages. `Watch::start` canonicalizes root; `route` filters Markdown paths/ignored names and produces rescan requests for directory/unknown events. Scanning and parsing remain on the serialized worker, never in egui callbacks.

**UI-to-worker response pattern** (`translate.rs:64, 120-143, 244-251`):

```rust
pending: Option<(String, mpsc::Receiver<Reply>)>,
// frame polls nonblocking:
match rx.try_recv() {
    Ok(reply) => { /* apply result if still current */ }
    Err(mpsc::TryRecvError::Empty) => {}
    Err(mpsc::TryRecvError::Disconnected) => self.pending = None,
}
// worker completion wakes UI:
std::thread::spawn(move || {
    let reply = work();
    let _ = tx.send(reply);
    ctx.request_repaint();
});
```

For a long-lived vault worker, prefer persistent command/message channels over spawning per request. Poll available snapshots/messages without blocking inside `App::ui`; call `request_repaint` after worker publication. Keep the old usable snapshot until a requested vault root is opened, scanned, and its watcher successfully established.

### Vault root persistence (likely shell/app state utility)

**Analogs:** `apps/canvas/src/main.rs::Panes` and `save_layout` (`main.rs:261-267, 507-520`); `apps/canvas/src/ide.rs::state_dir/save_state` (`ide.rs:2089-2108`).

```rust
#[derive(serde::Serialize, serde::Deserialize)]
struct Panes {
    dock: DockState<Tab>,
    maximized: Option<Tab>,
    root: String,
    here: String,
}
// save_layout serializes state, compares with prior value, then persists only on change.
```

Continue the serde JSON + state-directory convention for the selected vault path; validate/canonicalize/create the default `world/vault/` before opening the host. Store this selection independently from `world_dir()` and `Ide::serve_world` (`main.rs:389-410`, `ide.rs:342-345`), which continue to serve the simulation's `--world` setting. A path switch belongs on the host worker so dropping the prior watcher and opening the replacement root are serialized.

## Shared Patterns

### Frame composition and persistent tool owners

**Source:** `apps/canvas/src/main.rs:1568-1585`, `1689-1724` and `apps/canvas/src/ide.rs:289-313`.  
**Apply to:** shell routing and every hosted destination.  
Keep `App`/`Ide` as owners of tool state. Route visibility without reconstructing tools; run `Ide::begin_frame` each frame, preserve marks pane IDs, and keep highlights/marks over all views.

### Background work and UI wakeup

**Source:** `apps/canvas/src/translate.rs:120-143,244-251`; worker pattern also appears in `ide.rs:347-420`.  
**Apply to:** vault scan/index/watch path.  
Use channels and nonblocking UI polling; worker notifies `egui::Context::request_repaint`. Do not scan filesystem in explorer render callbacks.

### Vault change identity

**Source:** `crates/vault/src/store.rs:216-267` and `crates/vault/src/watch.rs:1-3,78-115`.  
**Apply to:** every vault mutation and outside-change refresh.  
All writes and watcher classification share one `Store`; only external/removed classifications refresh visible data. `OwnEcho` and `Unchanged` do not create duplicate refresh behavior.

## No Analog Found

| File/behavior | Reason |
|---------------|--------|
| Detachable docked-to-floating explorer behavior | No existing detachable native egui panel/window transition in tracked app sources; implement using egui primitives and verify the specified interaction. |
| Focus-independent Cmd-K event filtering before terminal PTY forwarding | Existing `App::keyboard` explicitly stands aside for active terminals; no shell-global pre-PTy router exists. Use `raw_input_hook` as the seam and test both Key and Text event filtering. |
| Full serialized vault host combining UI commands, watcher receiver, fallback rescan, and immutable snapshots | Phase 1 deliberately leaves receiver ownership to Phase 2; compose the existing Store/Watch APIs and app worker/channel pattern. |

## Implementation Boundaries

- Keep full card editing, note creation/movement/resizing, connections, and nested graphs in Phase 3. Phase 2 workspace is a blank read-only graph stub with only camera navigation.
- Keep provider search, proposed links, and whole-vault/replay views for Phases 4–6.
- Do not remove `Tab` identities/debug names, marks/highlights, note/terminal owners, per-folder camera storage, dirty editor buffers, or independent `--world` behavior during the dock replacement.
- Remove `egui_dock` only after the replacement shell has routes for all current tool destinations and file tabs; preserve old persisted dock data safely or migrate it deliberately.
- Explorer drag-to-float interaction has no direct code analog and must meet the locked behavior without making the explorer's tree/selection state depend on its current egui presentation.
- Keep filesystem reads, scans, indexing, writes, and watcher classification off the egui frame thread.
- Decouple screenshot trigger from simulation ticks so `TAPESTRY_SHOT` works from every destination; `TAPESTRY_VIEW` remains the canvas camera setting.

## Metadata

**Analog search scope:** `apps/canvas/src/`, `crates/vault/src/`, app and vault manifests.  
**Tracked analogs:** all paths above verified by `git ls-files`.  
**Pattern extraction date:** 2026-10-22
