//! The Phase 2 read-only graph workspace.

use eframe::egui;
use std::path::PathBuf;

use crate::vault_host::{VaultStatus, VaultView};

const PAPER: egui::Color32 = egui::Color32::from_rgb(0xfa, 0xf9, 0xf5);
const FAINT: egui::Color32 = egui::Color32::from_rgb(0x68, 0x6a, 0x66);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExplorerRow {
    Folder { key: String, label: String },
    Note { key: String, label: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExplorerMode {
    Closed,
    Docked,
    Floating,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExplorerAction {
    OpenVault(PathBuf),
    Select(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExplorerPresentation {
    Loading,
    Error,
    Partial,
    Empty,
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaletteGroup {
    Simulation,
    Tools,
    Notes,
    Folders,
    Commands,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaletteAction {
    OpenSimulation,
    OpenRules,
    OpenFiles,
    OpenTerminals,
    OpenNotes,
    OpenEditor(PathBuf),
    Navigate(NavigationTarget),
    OpenVault,
    OpenExplorer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationKind {
    Note,
    Folder,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NavigationTarget {
    pub kind: NavigationKind,
    pub key: String,
}

impl NavigationTarget {
    pub fn new(kind: NavigationKind, key: &str) -> Self {
        Self {
            kind,
            key: tapestry_vault::index::key(key),
        }
    }
}

pub fn explorer_navigation_target(
    _view: &VaultView,
    _row: &ExplorerRow,
) -> Option<NavigationTarget> {
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaletteEntry {
    pub label: String,
    pub full_path: Option<String>,
    pub group: PaletteGroup,
    pub action: PaletteAction,
}

#[derive(Debug, Clone, Default)]
pub struct PaletteState {
    pub open: bool,
    pub query: String,
    pub selected: usize,
    pub focus_query: bool,
}

pub fn fuzzy_rank(query: &str, entries: &[PaletteEntry]) -> Vec<usize> {
    let query: Vec<char> = query
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    let mut scored: Vec<(usize, i32)> = entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            if query.is_empty() {
                return Some((index, 0));
            }
            let mut candidates = vec![entry.label.as_str()];
            if let Some(path) = entry.full_path.as_deref() {
                candidates.push(path);
            }
            candidates
                .into_iter()
                .filter_map(|candidate| fuzzy_score(&query, candidate).map(|score| (index, score)))
                .max_by_key(|(_, score)| *score)
        })
        .collect();
    scored.sort_by(|(a_index, a_score), (b_index, b_score)| {
        group_order(entries[*a_index].group)
            .cmp(&group_order(entries[*b_index].group))
            .then_with(|| b_score.cmp(a_score))
            .then_with(|| a_index.cmp(b_index))
    });
    scored.into_iter().map(|(index, _)| index).collect()
}

fn fuzzy_score(query: &[char], candidate: &str) -> Option<i32> {
    let chars: Vec<char> = candidate.chars().flat_map(char::to_lowercase).collect();
    let mut next = 0;
    let mut score = 0;
    let mut previous = None;
    for wanted in query {
        let found = chars[next..].iter().position(|ch| ch == wanted)? + next;
        score += 10;
        if previous.is_some_and(|prev| found == prev + 1) {
            score += 8;
        }
        if found == 0 || !chars[found - 1].is_alphanumeric() {
            score += 6;
        }
        if found == next {
            score += 2;
        }
        previous = Some(found);
        next = found + 1;
    }
    Some(score - (chars.len() as i32 / 20))
}

pub fn palette_entries(view: &VaultView, editor_tabs: &[PathBuf]) -> Vec<PaletteEntry> {
    let mut entries = vec![
        palette_entry(
            "Simulation",
            PaletteGroup::Simulation,
            PaletteAction::OpenSimulation,
        ),
        palette_entry("Rules", PaletteGroup::Tools, PaletteAction::OpenRules),
        palette_entry("Files", PaletteGroup::Tools, PaletteAction::OpenFiles),
        palette_entry(
            "Terminals",
            PaletteGroup::Tools,
            PaletteAction::OpenTerminals,
        ),
        palette_entry("Notes", PaletteGroup::Tools, PaletteAction::OpenNotes),
        palette_entry(
            "Open vault…",
            PaletteGroup::Commands,
            PaletteAction::OpenVault,
        ),
        palette_entry(
            "Open explorer",
            PaletteGroup::Commands,
            PaletteAction::OpenExplorer,
        ),
    ];
    entries.extend(editor_tabs.iter().map(|path| {
        PaletteEntry {
            label: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Untitled")
                .to_owned(),
            full_path: Some(path.display().to_string()),
            group: PaletteGroup::Notes,
            action: PaletteAction::OpenEditor(path.clone()),
        }
    }));
    if let Some(snapshot) = &view.snapshot {
        entries.extend(snapshot.index.notes.keys().map(|key| {
            let label = key
                .rsplit('/')
                .next()
                .unwrap_or(key)
                .strip_suffix(".md")
                .unwrap_or(key.rsplit('/').next().unwrap_or(key));
            PaletteEntry {
                label: label.to_owned(),
                full_path: Some(snapshot.root.join(key).display().to_string()),
                group: PaletteGroup::Notes,
                action: PaletteAction::Navigate(NavigationTarget::new(NavigationKind::Note, key)),
            }
        }));
        entries.extend(
            snapshot
                .index
                .folders
                .keys()
                .filter(|key| !key.is_empty())
                .map(|key| PaletteEntry {
                    label: key.rsplit('/').next().unwrap_or(key).to_owned(),
                    full_path: Some(snapshot.root.join(key).display().to_string()),
                    group: PaletteGroup::Folders,
                    action: PaletteAction::Navigate(NavigationTarget::new(
                        NavigationKind::Folder,
                        key,
                    )),
                }),
        );
    }
    entries
}

fn palette_entry(label: &str, group: PaletteGroup, action: PaletteAction) -> PaletteEntry {
    PaletteEntry {
        label: label.into(),
        full_path: None,
        group,
        action,
    }
}

pub fn palette(
    ctx: &egui::Context,
    state: &mut PaletteState,
    entries: &[PaletteEntry],
) -> Option<PaletteAction> {
    if !state.open {
        return None;
    }
    let matches = fuzzy_rank(&state.query, entries);
    if matches.is_empty() {
        state.selected = 0;
    } else {
        state.selected = state.selected.min(matches.len() - 1);
    }
    let mut chosen = None;
    egui::Area::new(egui::Id::new("command-palette"))
        .order(egui::Order::Foreground)
        .anchor(egui::Align2::CENTER_TOP, egui::vec2(0.0, 72.0))
        .show(ctx, |ui| {
            egui::Frame::popup(ui.style()).show(ui, |ui| {
                ui.set_min_width(520.0);
                ui.label(egui::RichText::new("Command palette").font(crate::title(20.0)));
                let query = ui.add_sized(
                    [ui.available_width(), 40.0],
                    egui::TextEdit::singleline(&mut state.query)
                        .hint_text("Search tools, notes, folders, and commands…"),
                );
                if state.focus_query {
                    query.request_focus();
                    state.focus_query = false;
                }
                let (up, down, enter, escape) = ui.input(|input| {
                    (
                        input.key_pressed(egui::Key::ArrowUp),
                        input.key_pressed(egui::Key::ArrowDown),
                        input.key_pressed(egui::Key::Enter),
                        input.key_pressed(egui::Key::Escape),
                    )
                });
                if escape {
                    state.open = false;
                }
                if !matches.is_empty() {
                    if down {
                        state.selected = (state.selected + 1).min(matches.len() - 1);
                    }
                    if up {
                        state.selected = state.selected.saturating_sub(1);
                    }
                    if enter {
                        chosen = Some(entries[matches[state.selected]].action.clone());
                        state.open = false;
                    }
                }
                ui.separator();
                if matches.is_empty() {
                    ui.label("No matches. Try a different search.");
                } else {
                    egui::ScrollArea::vertical()
                        .max_height(420.0)
                        .show(ui, |ui| {
                            let mut last_group = None;
                            for (position, entry_index) in matches.iter().enumerate() {
                                let entry = &entries[*entry_index];
                                if last_group != Some(entry.group) {
                                    last_group = Some(entry.group);
                                    ui.add_space(8.0);
                                    ui.label(
                                        egui::RichText::new(group_label(entry.group))
                                            .size(12.0)
                                            .color(FAINT),
                                    );
                                }
                                let detail = entry.full_path.as_deref().unwrap_or("");
                                let label = if detail.is_empty() {
                                    entry.label.clone()
                                } else {
                                    format!("{}    {detail}", entry.label)
                                };
                                let response = ui
                                    .selectable_label(position == state.selected, label)
                                    .on_hover_text(detail);
                                if response.clicked() {
                                    chosen = Some(entry.action.clone());
                                    state.open = false;
                                }
                            }
                        });
                }
            });
        });
    chosen
}

fn group_label(group: PaletteGroup) -> &'static str {
    match group {
        PaletteGroup::Simulation => "Simulation",
        PaletteGroup::Tools => "Tools",
        PaletteGroup::Notes => "Notes",
        PaletteGroup::Folders => "Folders",
        PaletteGroup::Commands => "Commands",
    }
}

fn group_order(group: PaletteGroup) -> u8 {
    match group {
        PaletteGroup::Simulation => 0,
        PaletteGroup::Tools => 1,
        PaletteGroup::Notes => 2,
        PaletteGroup::Folders => 3,
        PaletteGroup::Commands => 4,
    }
}

#[derive(Debug, Clone)]
pub struct ExplorerState {
    pub mode: ExplorerMode,
    pub width: f32,
    pub selected: Option<String>,
    pub path: String,
    pub path_dirty: bool,
    pub command_error: Option<String>,
    pub focus_path: bool,
    pub floating_pos: Option<egui::Pos2>,
}

impl Default for ExplorerState {
    fn default() -> Self {
        Self {
            mode: ExplorerMode::Docked,
            width: 264.0,
            selected: None,
            path: String::new(),
            path_dirty: false,
            command_error: None,
            focus_path: false,
            floating_pos: None,
        }
    }
}

impl ExplorerState {
    pub fn close(&mut self) {
        self.mode = ExplorerMode::Closed;
    }

    pub fn reopen(&mut self) {
        if self.mode == ExplorerMode::Closed {
            self.mode = ExplorerMode::Docked;
        }
    }

    pub fn resize(&mut self, width: f32) {
        self.width = width.clamp(200.0, 480.0);
    }

    pub fn float(&mut self, at: egui::Pos2) {
        self.mode = ExplorerMode::Floating;
        self.floating_pos = Some(at);
    }
}

pub fn explorer_rows(view: &VaultView) -> Vec<ExplorerRow> {
    let Some(snapshot) = &view.snapshot else {
        return Vec::new();
    };
    let mut folders: Vec<_> = snapshot
        .index
        .folders
        .keys()
        .filter(|rel| !rel.is_empty())
        .map(|rel| ExplorerRow::Folder {
            key: rel.clone(),
            label: rel.rsplit('/').next().unwrap_or(rel).to_owned(),
        })
        .collect();
    let mut notes: Vec<_> = snapshot
        .index
        .notes
        .keys()
        .map(|rel| ExplorerRow::Note {
            key: rel.clone(),
            label: rel
                .rsplit('/')
                .next()
                .unwrap_or(rel)
                .strip_suffix(".md")
                .unwrap_or(rel.rsplit('/').next().unwrap_or(rel))
                .to_owned(),
        })
        .collect();
    let sort = |a: &ExplorerRow, b: &ExplorerRow| {
        let (a_label, a_key) = row_parts(a);
        let (b_label, b_key) = row_parts(b);
        (a_label.to_lowercase(), a_key).cmp(&(b_label.to_lowercase(), b_key))
    };
    folders.sort_by(sort);
    notes.sort_by(sort);
    folders.extend(notes);
    folders
}

pub fn explorer_presentation(view: &VaultView) -> ExplorerPresentation {
    match (&view.status, view.snapshot.as_ref()) {
        (VaultStatus::Loading, None) => ExplorerPresentation::Loading,
        (VaultStatus::Error(_), None) => ExplorerPresentation::Error,
        (VaultStatus::Error(_), Some(_)) => ExplorerPresentation::Partial,
        (_, Some(snapshot)) if snapshot.index.notes.is_empty() => ExplorerPresentation::Empty,
        (_, Some(_)) => ExplorerPresentation::Ready,
        _ => ExplorerPresentation::Loading,
    }
}

fn row_parts(row: &ExplorerRow) -> (&str, &str) {
    match row {
        ExplorerRow::Folder { key, label } | ExplorerRow::Note { key, label } => (label, key),
    }
}

pub fn explorer(
    ui: &mut egui::Ui,
    state: &mut ExplorerState,
    view: &VaultView,
) -> Option<ExplorerAction> {
    if state.path_dirty
        && view
            .snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.root == PathBuf::from(&state.path))
    {
        state.path_dirty = false;
        state.command_error = None;
    }
    if !state.path_dirty {
        if let Some(snapshot) = &view.snapshot {
            state.path = snapshot.root.display().to_string();
        }
    }
    let mut action = None;
    match state.mode {
        ExplorerMode::Closed => {}
        ExplorerMode::Docked => {
            let response = egui::Panel::left("vault-explorer")
                .frame(egui::Frame::NONE.fill(crate::SHEET))
                .resizable(true)
                .default_size(state.width)
                .size_range(200.0..=480.0)
                .show(ui, |ui| {
                    let (header, header_response) = ui.allocate_exact_size(
                        egui::vec2(ui.available_width(), 36.0),
                        egui::Sense::drag(),
                    );
                    ui.painter().text(
                        header.left_center() + egui::vec2(12.0, 0.0),
                        egui::Align2::LEFT_CENTER,
                        "Explorer",
                        egui::FontId::proportional(20.0),
                        crate::INK,
                    );
                    let close = ui.put(
                        egui::Rect::from_min_size(
                            header.right_top() - egui::vec2(36.0, 0.0),
                            egui::vec2(36.0, 36.0),
                        ),
                        egui::Button::new("×").frame(false),
                    );
                    if close.clicked() {
                        state.close();
                    }
                    ui.separator();
                    action = explorer_contents(ui, state, view);
                    if header_response.dragged() && header_response.drag_delta().length() >= 28.0 {
                        let at = ui.ctx().pointer_interact_pos().unwrap_or(header.center());
                        state.float(at - egui::vec2(132.0, 18.0));
                    }
                });
            state.resize(response.response.rect.width());
        }
        ExplorerMode::Floating => {
            let mut open = true;
            let mut window = egui::Window::new("Explorer")
                .id(egui::Id::new("vault-explorer-floating"))
                .default_width(state.width)
                .resizable(true)
                .open(&mut open);
            if let Some(pos) = state.floating_pos {
                window = window.current_pos(pos);
            }
            if let Some(inner) = window.show(ui.ctx(), |ui| explorer_contents(ui, state, view)) {
                action = inner.inner.flatten();
                state.resize(inner.response.rect.width());
                state.floating_pos = Some(inner.response.rect.min);
            }
            if !open {
                state.close();
            }
        }
    }
    action
}

fn explorer_contents(
    ui: &mut egui::Ui,
    state: &mut ExplorerState,
    view: &VaultView,
) -> Option<ExplorerAction> {
    let mut action = None;
    ui.add_space(8.0);
    ui.horizontal(|ui| {
        ui.add_space(12.0);
        let response = ui.add_sized(
            [(ui.available_width() - 24.0).max(0.0), 28.0],
            egui::TextEdit::singleline(&mut state.path)
                .hint_text("Choose a folder to open as a vault"),
        );
        state.path_dirty |= response.changed();
        if state.focus_path {
            response.request_focus();
            state.focus_path = false;
        }
    });
    ui.horizontal(|ui| {
        ui.add_space(12.0);
        if ui.button("Open vault").clicked() && !state.path.trim().is_empty() {
            action = Some(ExplorerAction::OpenVault(PathBuf::from(state.path.trim())));
        }
    });
    ui.add_space(8.0);
    if let VaultStatus::Error(error) = &view.status {
        ui.label(egui::RichText::new(error).size(12.0).color(FAINT));
    }
    if let Some(error) = &state.command_error {
        ui.label(egui::RichText::new(error).size(12.0).color(FAINT));
    }
    match explorer_presentation(view) {
        ExplorerPresentation::Loading => {
            ui.label(
                egui::RichText::new("Loading vault…")
                    .size(14.0)
                    .color(FAINT),
            );
            return action;
        }
        ExplorerPresentation::Error => {
            ui.label(
                egui::RichText::new("Couldn’t open this folder. Check that it exists and is readable, then choose another folder.")
                    .size(14.0)
                    .color(FAINT),
            );
            return action;
        }
        ExplorerPresentation::Partial
        | ExplorerPresentation::Empty
        | ExplorerPresentation::Ready => {}
    }
    let rows = explorer_rows(view);
    if rows.is_empty() {
        ui.add_space(12.0);
        ui.label(egui::RichText::new("This vault is empty").size(20.0));
        ui.label(egui::RichText::new("Open a folder with Markdown notes, or add notes to this folder and they will appear here.").size(14.0).color(FAINT));
        return action;
    }
    egui::ScrollArea::vertical()
        .id_salt("vault-explorer-rows")
        .show(ui, |ui| {
            for row in rows {
                let (key, label, is_folder) = match row {
                    ExplorerRow::Folder { key, label } => (key, label, true),
                    ExplorerRow::Note { key, label } => (key, label, false),
                };
                let full_path = key.clone();
                let response = ui
                    .selectable_label(
                        state.selected.as_deref() == Some(&key),
                        format!("{}  {label}", if is_folder { "▸" } else { "▫" }),
                    )
                    .on_hover_text(full_path);
                if response.clicked() {
                    state.selected = Some(key.clone());
                    action = Some(ExplorerAction::Select(key));
                }
            }
        });
    action
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_host::VaultSnapshot;
    use tapestry_vault::index::VaultIndex;
    use tapestry_vault::scan::{NoteStatus, Scan, ScannedNote};

    #[test]
    fn explorer_rows_lists_indexed_folders_before_notes() {
        let index = VaultIndex::build(&Scan {
            root: "/vault".into(),
            folders: vec!["".into(), "z-folder".into(), "a-folder".into()],
            notes: vec![ScannedNote {
                rel: "notes/readme.md".into(),
                text: None,
                status: NoteStatus::NotUtf8,
                len: 4,
                mtime_ms: None,
                birth_ms: None,
                hash: 0,
            }],
            skipped: Vec::new(),
            truncated: false,
        });
        let view = VaultView {
            status: VaultStatus::Ready,
            snapshot: Some(VaultSnapshot {
                root: "/vault".into(),
                index: std::sync::Arc::new(index),
            }),
        };
        assert_eq!(
            explorer_rows(&view),
            vec![
                ExplorerRow::Folder {
                    key: "a-folder".into(),
                    label: "a-folder".into()
                },
                ExplorerRow::Folder {
                    key: "z-folder".into(),
                    label: "z-folder".into()
                },
                ExplorerRow::Note {
                    key: "notes/readme.md".into(),
                    label: "readme".into()
                },
            ]
        );
    }

    #[test]
    fn explorer_distinguishes_loading_empty_partial_and_error_states() {
        let loading = VaultView {
            status: VaultStatus::Loading,
            snapshot: None,
        };
        let error = VaultView {
            status: VaultStatus::Error("unreadable".into()),
            snapshot: None,
        };
        let empty = VaultView {
            status: VaultStatus::Ready,
            snapshot: Some(VaultSnapshot {
                root: "/vault".into(),
                index: std::sync::Arc::new(VaultIndex::default()),
            }),
        };
        let partial = VaultView {
            status: VaultStatus::Error("some files unreadable".into()),
            snapshot: empty.snapshot.clone(),
        };
        assert_eq!(
            explorer_presentation(&loading),
            ExplorerPresentation::Loading
        );
        assert_eq!(explorer_presentation(&empty), ExplorerPresentation::Empty);
        assert_eq!(
            explorer_presentation(&partial),
            ExplorerPresentation::Partial
        );
        assert_eq!(explorer_presentation(&error), ExplorerPresentation::Error);
    }

    #[test]
    fn explorer_state_keeps_selection_and_width_across_close_float_and_reopen() {
        let mut state = ExplorerState::default();
        state.selected = Some("notes/a.md".into());
        state.resize(336.0);
        state.float(egui::pos2(40.0, 72.0));
        state.close();
        assert_eq!(state.mode, ExplorerMode::Closed);
        state.reopen();
        assert_eq!(state.mode, ExplorerMode::Docked);
        assert_eq!(state.width, 336.0);
        assert_eq!(state.selected.as_deref(), Some("notes/a.md"));
    }

    #[test]
    fn fuzzy_palette_ranks_matching_labels_and_paths_deterministically() {
        let entries = vec![
            PaletteEntry {
                label: "Open vault…".into(),
                full_path: None,
                group: PaletteGroup::Commands,
                action: PaletteAction::OpenVault,
            },
            PaletteEntry {
                label: "Open explorer".into(),
                full_path: None,
                group: PaletteGroup::Commands,
                action: PaletteAction::OpenExplorer,
            },
            PaletteEntry {
                label: "Notebook".into(),
                full_path: Some("research/Notebook.md".into()),
                group: PaletteGroup::Notes,
                action: PaletteAction::Navigate(NavigationTarget::new(
                    NavigationKind::Note,
                    "research/Notebook.md",
                )),
            },
        ];
        assert_eq!(fuzzy_rank("opv", &entries), vec![0]);
        assert_eq!(fuzzy_rank("notebook", &entries), vec![2]);
        assert_eq!(fuzzy_rank("RESEARCH", &entries), vec![2]);
        assert!(fuzzy_rank("zzz", &entries).is_empty());
    }

    #[test]
    fn palette_tool_and_command_entries_remain_available_while_vault_loads() {
        let view = VaultView {
            status: VaultStatus::Loading,
            snapshot: None,
        };
        let entries = palette_entries(&view, &[]);
        assert!(entries.iter().any(|entry| entry.label == "Simulation"));
        assert!(entries.iter().any(|entry| entry.label == "Rules"));
        assert!(entries.iter().any(|entry| entry.label == "Open vault…"));
        assert!(entries.iter().any(|entry| entry.label == "Open explorer"));
    }

    #[test]
    fn palette_entries_include_duplicate_notes_folders_tabs_and_typed_destinations() {
        let index = VaultIndex::build(&Scan {
            root: "/vault".into(),
            folders: vec!["".into(), "research".into(), "research/child".into()],
            notes: vec![
                scanned("research/Notebook.md"),
                scanned("research/child/Notebook.md"),
            ],
            skipped: Vec::new(),
            truncated: false,
        });
        let view = VaultView {
            status: VaultStatus::Ready,
            snapshot: Some(VaultSnapshot {
                root: "/vault".into(),
                index: std::sync::Arc::new(index),
            }),
        };
        let entries = palette_entries(&view, &[PathBuf::from("/vault/drafts/open.md")]);
        let notes: Vec<_> = entries
            .iter()
            .filter(|entry| entry.label == "Notebook")
            .collect();
        assert_eq!(notes.len(), 2);
        assert_ne!(notes[0].full_path, notes[1].full_path);
        let matches = fuzzy_rank("child", &entries);
        assert!(matches.iter().any(|index| matches!(
            &entries[*index].action,
            PaletteAction::Navigate(target) if target.key == "research/child/notebook.md"
        )));
        let actions: Vec<_> = entries.iter().map(|entry| &entry.action).collect();
        for action in [
            PaletteAction::OpenSimulation,
            PaletteAction::OpenRules,
            PaletteAction::OpenFiles,
            PaletteAction::OpenTerminals,
            PaletteAction::OpenNotes,
            PaletteAction::OpenEditor(PathBuf::from("/vault/drafts/open.md")),
            PaletteAction::Navigate(NavigationTarget::new(
                NavigationKind::Note,
                "research/Notebook.md",
            )),
            PaletteAction::Navigate(NavigationTarget::new(
                NavigationKind::Folder,
                "research/child",
            )),
            PaletteAction::OpenVault,
            PaletteAction::OpenExplorer,
        ] {
            assert!(actions.contains(&&action));
        }
    }

    #[test]
    fn navigation_action_is_shared_by_explorer_and_palette_for_notes_and_folders() {
        let index = VaultIndex::build(&Scan {
            root: "/vault".into(),
            folders: vec!["".into(), "Research".into()],
            notes: vec![scanned("Research/Notebook.md")],
            skipped: Vec::new(),
            truncated: false,
        });
        let view = VaultView {
            status: VaultStatus::Ready,
            snapshot: Some(VaultSnapshot {
                root: "/vault".into(),
                index: std::sync::Arc::new(index),
            }),
        };
        let rows = explorer_rows(&view);
        let entries = palette_entries(&view, &[]);
        for (kind, key) in [
            (NavigationKind::Note, "Research/Notebook.md"),
            (NavigationKind::Folder, "Research"),
        ] {
            let expected = NavigationTarget::new(kind, key);
            let row = rows
                .iter()
                .find(|row| match (row, kind) {
                    (ExplorerRow::Note { key: row_key, .. }, NavigationKind::Note)
                    | (ExplorerRow::Folder { key: row_key, .. }, NavigationKind::Folder) => {
                        row_key == key
                    }
                    _ => false,
                })
                .unwrap();
            let from_explorer = explorer_navigation_target(&view, row);
            let from_palette = entries.iter().find_map(|entry| {
                (entry.action == PaletteAction::Navigate(expected.clone()))
                    .then_some(expected.clone())
            });
            assert_eq!(from_explorer, from_palette);
            assert_eq!(from_explorer, Some(expected));
        }
    }

    fn scanned(rel: &str) -> ScannedNote {
        ScannedNote {
            rel: rel.into(),
            text: Some(String::new()),
            status: NoteStatus::Ok,
            len: 0,
            mtime_ms: None,
            birth_ms: None,
            hash: 0,
        }
    }
}

pub fn workspace(ui: &mut egui::Ui, view: &VaultView) {
    egui::CentralPanel::default()
        .frame(egui::Frame::NONE.fill(PAPER))
        .show(ui, |ui| {
            let canvas = ui.max_rect();
            ui.painter().rect_filled(canvas, 0, PAPER);
            match &view.status {
                VaultStatus::Loading if view.snapshot.is_none() => {
                    ui.painter().text(
                        canvas.center(),
                        egui::Align2::CENTER_CENTER,
                        "Loading vault…",
                        egui::FontId::proportional(14.0),
                        FAINT,
                    );
                }
                VaultStatus::Error(_) if view.snapshot.is_none() => {
                    ui.painter().text(
                        canvas.center(),
                        egui::Align2::CENTER_CENTER,
                        "Couldn’t open this folder. Check that it exists and is readable, then choose another folder.",
                        egui::FontId::proportional(14.0),
                        FAINT,
                    );
                }
                VaultStatus::Error(_) => {
                    ui.painter().text(
                        canvas.left_top() + egui::vec2(16.0, 16.0),
                        egui::Align2::LEFT_TOP,
                        "Couldn’t open this folder. Check that it exists and is readable, then choose another folder.",
                        egui::FontId::proportional(12.0),
                        FAINT,
                    );
                }
                VaultStatus::Loading | VaultStatus::Ready => {}
            }
        });
}
