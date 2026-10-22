# Phase 2: Shell - Context

**Gathered:** 2026-10-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the dock-centered application shell with a single main workspace: a blank infinite graph-canvas stub, a left Obsidian-style explorer, and a Cmd-K command palette. Keep every existing tool available as a temporary full-window view, remove `egui_dock`, and add persistent selection of any vault folder with `world/vault/` as the default. Wire the Phase 1 `Store` and `Watch` into the app's serialized I/O path so outside changes refresh the view while Tapestry's own writes remain suppressed. Phase 3 replaces the graph-canvas stub with full card editing and nested graph behavior.

</domain>

<decisions>
## Implementation Decisions

### Workspace shell and explorer
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product requirements and locked direction
- `.context/canvas-research-brief.md` — Kaelen's locked product decisions D-01 through D-11; do not replace them.
- `.context/HUMAN-QUESTIONS.md` — chosen explorer interaction and Simulation palette grouping defaults (items 7–8).
- `.planning/PROJECT.md` — product scope, autonomy, Rust/egui constraints, and persistent project decisions.
- `.planning/REQUIREMENTS.md` — Phase 2 SHELL and VAULT requirements and traceability.
- `.planning/ROADMAP.md` — Phase 2 acceptance criteria and implementation order; Phase 3 boundary.
- `.planning/phases/01-vault-model/01-CONTEXT.md` — vault and watcher contract; Phase 2 owns app-side host integration.
- `.planning/phases/01-vault-model/01-VERIFICATION.md` — native watcher and actual Obsidian behavior remain nonblocking follow-ups; do not claim they were validated here.
- `AGENTS.md` and `.claude/CLAUDE.md` — shared-tree, autonomous workflow, and startup instructions.

### Existing application integration points
- `apps/canvas/src/main.rs` — `App`, existing `Tab` identities, maximized view, keyboard dispatch, `tab_ui`, `run_clock`, and screenshot lifecycle.
- `apps/canvas/src/ide.rs` — existing folder/file navigation, pins, `files_ui`, editor, terminal management, state persistence, and folder camera movement.
- `apps/canvas/Cargo.toml` — existing egui/eframe, egui_dock, vault, terminal, and serialization dependencies.
- `crates/vault/src/store.rs`, `crates/vault/src/watch.rs`, and `crates/vault/src/scan.rs` — Store commands, watcher messages, and scan/index refresh interfaces.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `App.maximized` and `tab_ui` already present one tool full-window; this is the strangler path for replacing dock views.
- `ide::Ide` already navigates arbitrary roots, folders, files, editor buffers, and terminals; `files_ui`, pins, and `return_to` are likely reusable explorer and vault-selection pieces.
- `App::take_shot` and the `TAPESTRY_SHOT`/`TAPESTRY_VIEW` environment hooks provide screenshot infrastructure that currently shares app UI lifecycle with the simulation.
- `tapestry_vault::{Store, Watch, WatchMsg, scan, VaultIndex}` provides the headless data and event layer for the Phase 2 host.

### Established Patterns
- `App` is the central egui frame owner and dispatches tools through `tab_ui`; keep main changes additive and isolate shell behavior where practical.
- Persistent UI layout is serialized through `ide.synced` and currently stores `DockState<Tab>`; `Tab` debug names are also used as stable marks pane keys.
- Terminals are owned by `Ide`; hiding their view must not drop their process/session.
- UI filesystem and network work must not block the egui frame; the project uses background threads for long-running work.

### Integration Points
- `App::new`, `reopen`, and `save_layout` determine startup mode and persisted workspace state.
- `App::keyboard`, `eframe::App::ui`, and `tab_ui` are the current input and view-routing seams.
- `ide::files_ui`, `ide::place`, `ide::return_to`, and per-folder camera state connect explorer selection to graph navigation.
- App startup currently calls `world_dir()` and initializes rules/notes from `world`; vault root selection must be a separate persisted setting.
- Remove `egui_dock` only after the replacement shell and every tool route are live.

</code_context>

<specifics>
## Specific Ideas

- Explorer behavior should feel like Obsidian: docked left by default, resize by its edge, close/reopen by Cmd-\\ or palette, and drag away to float.
- Simulation, Brushes, and Timeline belong together under “Simulation”; Rules, Files, Terminals, Notes, and editor tabs are separate palette destinations.
- Keep the app's current simulation world (`--world`) independent from the newly remembered Markdown vault.

</specifics>

<deferred>
## Deferred Ideas

- Full note-card creation, editing, movement, resize, connection drawing, and nested graph zoom are Phase 3.
- Provider search and source cards are Phase 4; proposals are Phase 5; the whole-vault graph and replay UI are Phase 6.
- No additional ideas were introduced during this autonomous context pass.

</deferred>

---

*Phase: 2-Shell*
*Context gathered: 2026-10-22*
