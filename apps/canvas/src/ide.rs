//! The spatial IDE: any folder as note cards on a surface you can pan and
//! zoom, folders as frames you step into, files opened as editor tabs.
//!
//! Any folder works: a world's rule notes, a Markdown vault, or Tapestry's
//! own source. Saving a rule file takes effect at once (the canvas rereads
//! `world/rules`); saving engine source asks for a rebuild, then a restart
//! into the new build.
//!
//! Where you put cards, and which folders you pin, are kept in
//! `~/.local/state/tapestry/` so they're there next time.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use eframe::egui;
use egui::{Align2, Color32, CornerRadius, FontId, Pos2, Rect, RichText, Sense, Stroke, Vec2, pos2, vec2};

use crate::term::Terminal;
use crate::{DOT, FAINT, INK, MUTED, SHEET, quiet_link, title};

const CARD: Vec2 = vec2(230.0, 150.0);
const TERM: Vec2 = vec2(500.0, 310.0);
/// How long a card takes to grow to fill the surface.
const GROW: f64 = 0.2;
const GAP: Vec2 = vec2(30.0, 30.0);
/// Never listed: build output, version control, dependencies.
const SKIP: [&str; 4] = ["target", ".git", "node_modules", "__pycache__"];
const LINK: Color32 = Color32::from_rgb(0x4a, 0x7f, 0xc1);

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Folder,
    Code(&'static str),
    Markdown,
    Rule,
    Text,
    Binary,
}

struct Entry {
    path: PathBuf,
    name: String,
    kind: Kind,
    preview: String,
    /// `[[wikilinks]]` in a Markdown note, by target name.
    links: Vec<String>,
    /// For a folder: how many things are in it.
    count: usize,
}

/// A file open for editing.
pub struct Buffer {
    pub text: String,
    saved: String,
}

impl Buffer {
    pub fn dirty(&self) -> bool {
        self.text != self.saved
    }
}

/// What fills the surface when a card is opened.
#[derive(Clone, PartialEq)]
enum Focus {
    File(PathBuf),
    Term(u64),
}

#[derive(Clone, PartialEq)]
enum BuildStatus {
    Running,
    Done,
    Failed,
}

struct Build {
    status: Arc<Mutex<(BuildStatus, String)>>,
}

pub struct Ide {
    root: PathBuf,
    /// The folder shown: `root` or somewhere inside it.
    here: PathBuf,
    /// The Tapestry engine's own source (this repository).
    engine: PathBuf,
    /// Folders kept one click away.
    pins: Vec<PathBuf>,
    path_input: String,
    entries: Vec<Entry>,
    listed_at: f64,
    /// Where each card sits on the surface.
    positions: HashMap<PathBuf, Vec2>,
    /// Cards the author moved by hand. Only these are remembered; the rest
    /// fall into a grid around them.
    placed: HashSet<PathBuf>,
    pan: Vec2,
    zoom: f32,
    pub buffers: BTreeMap<PathBuf, Buffer>,
    /// Files to open as tabs; the dock picks these up after drawing.
    pub open_requests: Vec<PathBuf>,
    engine_changed: bool,
    build: Option<Build>,
    /// Terminals, each living in the folder it was opened in.
    terminals: Vec<Terminal>,
    term_pos: HashMap<u64, Vec2>,
    next_term: u64,
    /// The terminal that has the keyboard.
    active_term: Option<u64>,
    /// Whether the active terminal was on screen last frame (if its pane is
    /// hidden, the keyboard goes back to the app).
    term_drawn: bool,
    term_visible: bool,
    /// An opened card filling the surface, and where it grew from.
    focus: Option<Focus>,
    focus_from: Rect,
    focus_at: f64,
    startup_term: Option<String>,
    /// The surface's size last frame, for placing things in view.
    view: Rect,
}

impl Ide {
    pub fn new(engine: PathBuf) -> Self {
        let positions = load_positions();
        let placed = positions.keys().cloned().collect();
        let mut pins = load_pins();
        if pins.is_empty() {
            pins.push(engine.clone());
        }
        let root = pins[0].clone();
        Self {
            here: root.clone(),
            path_input: root.display().to_string(),
            root,
            engine,
            pins,
            entries: Vec::new(),
            listed_at: f64::NEG_INFINITY,
            positions,
            placed,
            pan: vec2(24.0, 24.0),
            zoom: 1.0,
            buffers: BTreeMap::new(),
            open_requests: Vec::new(),
            engine_changed: false,
            build: None,
            terminals: Vec::new(),
            term_pos: HashMap::new(),
            next_term: 1,
            active_term: None,
            term_drawn: false,
            term_visible: false,
            focus: None,
            focus_from: Rect::NOTHING,
            focus_at: 0.0,
            startup_term: std::env::var("TAPESTRY_TERM").ok(),
            view: Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 700.0)),
        }
    }

    /// Call once per frame before anything reads the keyboard.
    pub fn begin_frame(&mut self) {
        self.term_visible = std::mem::take(&mut self.term_drawn);
    }

    /// A card is open, filling the surface.
    pub fn has_focus(&self) -> bool {
        self.focus.is_some()
    }

    /// A terminal has the keyboard: the app's own shortcuts stand aside.
    pub fn terminal_active(&self) -> bool {
        self.active_term.is_some() && self.term_visible
    }

    fn spawn_terminal(&mut self, ctx: &egui::Context) {
        let id = self.next_term;
        match Terminal::spawn(id, &self.here, ctx) {
            Ok(t) => {
                self.next_term += 1;
                // In the middle of what's in view, a little offset from any
                // terminal already there.
                let view = self.view.size() / 2.0 - self.pan;
                let nudge = self
                    .terminals
                    .iter()
                    .filter(|t| t.cwd == self.here)
                    .count() as f32
                    * 28.0;
                let pos = view / self.zoom - TERM / 2.0 + Vec2::splat(nudge);
                self.term_pos.insert(id, pos);
                self.terminals.push(t);
                self.active_term = Some(id);
            }
            Err(e) => eprintln!("couldn't start a terminal: {e}"),
        }
    }

    fn close_terminal(&mut self, id: u64) {
        self.terminals.retain(|t| t.id != id);
        if self.active_term == Some(id) {
            self.active_term = None;
        }
        if self.focus == Some(Focus::Term(id)) {
            self.focus = None;
        }
    }

    fn grow(&mut self, focus: Focus, from: Rect, now: f64) {
        if let Focus::Term(id) = focus {
            self.active_term = Some(id);
        }
        self.focus = Some(focus);
        self.focus_from = from;
        self.focus_at = now;
    }

    fn open_folder(&mut self, dir: PathBuf) {
        let dir = dir.canonicalize().unwrap_or(dir);
        if dir.is_dir() {
            self.path_input = dir.display().to_string();
            self.root = dir.clone();
            self.go(dir);
        }
    }

    /// Step into (or out to) a folder under the root.
    fn go(&mut self, dir: PathBuf) {
        self.focus = None;
        self.active_term = None;
        self.here = dir;
        self.listed_at = f64::NEG_INFINITY;
        self.pan = vec2(24.0, 24.0);
    }

    fn relist(&mut self, now: f64) {
        if now - self.listed_at < 2.0 {
            return;
        }
        self.listed_at = now;
        let mut entries = Vec::new();
        if let Ok(read) = std::fs::read_dir(&self.here) {
            for e in read.flatten() {
                let path = e.path();
                let name = e.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') || SKIP.contains(&name.as_str()) {
                    continue;
                }
                entries.push(read_entry(path, name));
            }
        }
        entries.sort_by(|a, b| {
            (a.kind != Kind::Folder, a.name.to_lowercase())
                .cmp(&(b.kind != Kind::Folder, b.name.to_lowercase()))
        });
        self.entries = entries;
    }

    /// The files surface.
    pub fn files_ui(&mut self, ui: &mut egui::Ui) {
        let now = ui.input(|i| i.time);
        self.relist(now);
        self.header(ui);
        ui.add_space(6.0);
        self.surface(ui);
        // `TAPESTRY_TERM="<command>"`: open a terminal running it (for checks).
        if let Some(cmd) = self.startup_term.take() {
            self.spawn_terminal(ui.ctx());
            if let Some(t) = self.terminals.last_mut() {
                t.send(format!("{cmd}\r").as_bytes());
                let id = t.id;
                if std::env::var_os("TAPESTRY_TERM_GROW").is_some() {
                    self.grow(Focus::Term(id), Rect::NOTHING, 0.0);
                }
            }
        }
    }

    fn header(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.add_space(8.0);
            // Where we are: the root, then each folder stepped into.
            let mut crumbs = vec![self.root.clone()];
            if let Ok(rel) = self.here.strip_prefix(&self.root) {
                let mut at = self.root.clone();
                for c in rel.components() {
                    at = at.join(c);
                    crumbs.push(at.clone());
                }
            }
            for (i, crumb) in crumbs.iter().enumerate() {
                if i > 0 {
                    ui.label(RichText::new("/").color(FAINT));
                }
                let name = crumb
                    .file_name()
                    .map_or("/".into(), |n| n.to_string_lossy().into_owned());
                let last = i + 1 == crumbs.len() && self.focus.is_none();
                if quiet_link(ui, &name, last).clicked() && !last {
                    self.go(crumb.clone());
                }
            }
            if let Some(focus) = &self.focus {
                ui.label(RichText::new("/").color(FAINT));
                let name = match focus {
                    Focus::File(p) => p
                        .file_name()
                        .map_or(String::new(), |n| n.to_string_lossy().into_owned()),
                    Focus::Term(id) => format!("terminal {id}"),
                };
                quiet_link(ui, &name, true);
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.add_space(8.0);
                if quiet_link(ui, "+ terminal", false).clicked() {
                    self.spawn_terminal(ui.ctx());
                }
                ui.add_space(12.0);
                let pinned = self.pins.contains(&self.here);
                if quiet_link(ui, if pinned { "unpin" } else { "pin" }, false).clicked() {
                    if pinned {
                        self.pins.retain(|p| *p != self.here);
                    } else {
                        self.pins.push(self.here.clone());
                    }
                    save_pins(&self.pins);
                }
            });
        });
        // Pinned folders, one click away.
        ui.horizontal_wrapped(|ui| {
            ui.add_space(8.0);
            ui.label(RichText::new("pinned").color(FAINT).size(14.0));
            for pin in self.pins.clone() {
                let name = pin
                    .file_name()
                    .map_or("/".into(), |n| n.to_string_lossy().into_owned());
                let here = self.root == pin;
                let link = quiet_link(ui, &name, here).on_hover_text(pin.display().to_string());
                if link.clicked() && !here {
                    self.open_folder(pin);
                }
            }
        });
        ui.horizontal(|ui| {
            ui.add_space(8.0);
            let field = ui.add(
                egui::TextEdit::singleline(&mut self.path_input)
                    .hint_text("open any folder…")
                    .desired_width((ui.available_width() - 80.0).max(120.0))
                    .font(FontId::monospace(12.0)),
            );
            let enter = field.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
            if quiet_link(ui, "open", false).clicked() || enter {
                let dir = PathBuf::from(expand_home(self.path_input.trim()));
                self.open_folder(dir);
            }
        });
        self.build_bar(ui);
    }

    fn build_bar(&mut self, ui: &mut egui::Ui) {
        let status = self
            .build
            .as_ref()
            .map(|b| b.status.lock().unwrap().clone());
        if !self.engine_changed && status.is_none() {
            return;
        }
        ui.horizontal(|ui| {
            ui.add_space(8.0);
            match &status {
                None => {
                    ui.label(
                        RichText::new("Tapestry's own source changed.")
                            .color(DOT)
                            .size(15.0),
                    );
                    if quiet_link(ui, "rebuild", true).clicked() {
                        self.start_build();
                    }
                }
                Some((BuildStatus::Running, log)) => {
                    ui.spinner();
                    let last = log.lines().last().unwrap_or("building…");
                    ui.label(RichText::new(last).color(MUTED).size(13.0));
                    ui.ctx().request_repaint();
                }
                Some((BuildStatus::Failed, log)) => {
                    ui.label(RichText::new("The build failed.").color(DOT).size(15.0));
                    if quiet_link(ui, "rebuild", true).clicked() {
                        self.start_build();
                    }
                    let first_error = log
                        .lines()
                        .find(|l| l.starts_with("error"))
                        .unwrap_or("see the terminal");
                    ui.label(RichText::new(first_error).color(MUTED).size(13.0));
                }
                Some((BuildStatus::Done, _)) => {
                    ui.label(RichText::new("Built.").size(15.0));
                    if quiet_link(ui, "restart into it", true).clicked() {
                        restart(ui.ctx());
                    }
                }
            }
        });
    }

    fn start_build(&mut self) {
        let status = Arc::new(Mutex::new((BuildStatus::Running, String::new())));
        let shared = status.clone();
        let dir = self.engine.clone();
        let release = std::env::current_exe()
            .map(|p| p.components().any(|c| c.as_os_str() == "release"))
            .unwrap_or(false);
        std::thread::spawn(move || {
            let mut cmd = std::process::Command::new("cargo");
            cmd.current_dir(&dir)
                .args(["build", "-p", "tapestry-canvas-app"])
                .stderr(std::process::Stdio::piped());
            if release {
                cmd.arg("--release");
            }
            if let Some(home) = std::env::var_os("HOME") {
                let cargo_bin = Path::new(&home).join(".cargo/bin");
                let path = std::env::var_os("PATH").unwrap_or_default();
                let mut paths = vec![cargo_bin];
                paths.extend(std::env::split_paths(&path));
                cmd.env("PATH", std::env::join_paths(paths).unwrap_or(path));
            }
            let result = cmd.spawn().and_then(|mut child| {
                use std::io::BufRead;
                if let Some(err) = child.stderr.take() {
                    for line in std::io::BufReader::new(err).lines().map_while(Result::ok) {
                        let mut s = shared.lock().unwrap();
                        s.1.push_str(&line);
                        s.1.push('\n');
                    }
                }
                child.wait()
            });
            let ok = result.is_ok_and(|s| s.success());
            shared.lock().unwrap().0 = if ok {
                BuildStatus::Done
            } else {
                BuildStatus::Failed
            };
        });
        self.build = Some(Build { status });
        self.engine_changed = false;
    }

    fn surface(&mut self, ui: &mut egui::Ui) {
        let rect = ui.available_rect_before_wrap();
        let response = ui.allocate_rect(rect, Sense::click_and_drag());
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, CornerRadius::same(10), Color32::from_rgb(0xef, 0xed, 0xe7));

        self.view = rect;
        let now = ui.input(|i| i.time);
        if self.focus.is_some() {
            self.focused(ui, rect, now);
            return;
        }
        if response.clicked() {
            self.active_term = None;
        }

        // Where this folder's terminals sit; scrolling over one scrolls
        // its history rather than zooming.
        let z = self.zoom;
        let term_rects: Vec<(u64, Rect)> = self
            .terminals
            .iter()
            .filter(|t| t.cwd == self.here)
            .map(|t| {
                let pos = self.term_pos.get(&t.id).copied().unwrap_or_default();
                (t.id, Rect::from_min_size(rect.min + self.pan + pos * z, TERM * z))
            })
            .collect();
        let over_term = response
            .hover_pos()
            .or(ui.input(|i| i.pointer.hover_pos()))
            .and_then(|p| term_rects.iter().find(|(_, r)| r.contains(p)).map(|t| t.0));

        // Pan by dragging the background, zoom with the wheel.
        if response.dragged() {
            self.pan += response.drag_delta();
        }
        if let Some(id) = over_term {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            if scroll != 0.0
                && let Some(t) = self.terminals.iter_mut().find(|t| t.id == id)
            {
                t.scroll((scroll / 8.0).round() as i32);
            }
        } else if let Some(p) = response.hover_pos() {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            if scroll != 0.0 {
                let old = self.zoom;
                self.zoom = (self.zoom * (scroll * 0.002).exp()).clamp(0.35, 2.5);
                // Keep the point under the pointer where it is.
                let at = p - rect.min - self.pan;
                self.pan -= at * (self.zoom / old - 1.0);
            }
        }

        let cols = ((rect.width() - 24.0) / ((CARD.x + GAP.x) * self.zoom))
            .floor()
            .max(1.0) as usize;
        // Cards nobody has moved fall into a grid, skipping spots that a
        // moved card already covers.
        let taken: Vec<Vec2> = self
            .entries
            .iter()
            .filter(|e| self.placed.contains(&e.path))
            .map(|e| self.positions[&e.path])
            .collect();
        let mut slot = 0;
        for e in &self.entries {
            if self.positions.contains_key(&e.path) {
                continue;
            }
            let pos = loop {
                let p = vec2(
                    (slot % cols) as f32 * (CARD.x + GAP.x),
                    (slot / cols) as f32 * (CARD.y + GAP.y),
                );
                slot += 1;
                let clear = taken
                    .iter()
                    .all(|t| (t.x - p.x).abs() >= CARD.x || (t.y - p.y).abs() >= CARD.y);
                if clear {
                    break p;
                }
            };
            self.positions.insert(e.path.clone(), pos);
        }
        let z = self.zoom;
        let place = |pos: Vec2| Rect::from_min_size(rect.min + self.pan + pos * z, CARD * z);
        let rects: Vec<Rect> = self
            .entries
            .iter()
            .map(|e| place(self.positions[&e.path]))
            .collect();

        // Links first, under the cards: blue ink, as in the sketches.
        let by_name: HashMap<String, usize> = self
            .entries
            .iter()
            .enumerate()
            .map(|(i, e)| (stem(&e.name).to_lowercase(), i))
            .collect();
        for (i, e) in self.entries.iter().enumerate() {
            for target in &e.links {
                if let Some(&j) = by_name.get(&target.to_lowercase())
                    && j != i
                {
                    let (a, b) = (rects[i].center(), rects[j].center());
                    let mid = pos2((a.x + b.x) / 2.0, a.y.min(b.y) - 30.0 * z);
                    let curve = egui::epaint::QuadraticBezierShape::from_points_stroke(
                        [a, mid, b],
                        false,
                        Color32::TRANSPARENT,
                        Stroke::new(1.3, LINK),
                    );
                    painter.add(curve);
                }
            }
        }

        let mut enter = None;
        let mut open = None;
        let mut moved = None;
        let mut dropped = false;
        for (i, e) in self.entries.iter().enumerate() {
            let r = rects[i];
            if !r.intersects(rect) {
                continue;
            }
            let resp = ui.interact(r, ui.id().with(("card", &e.path)), Sense::click_and_drag());
            if resp.dragged() {
                moved = Some((e.path.clone(), resp.drag_delta() / z));
            }
            dropped |= resp.drag_stopped();
            if resp.double_clicked() {
                match e.kind {
                    Kind::Folder => enter = Some(e.path.clone()),
                    Kind::Binary => {}
                    _ => open = Some((e.path.clone(), r)),
                }
            }
            if resp.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }
            draw_card(&painter, e, r, z, resp.hovered(), self.buffers.contains_key(&e.path));
        }
        if let Some((path, d)) = moved
            && let Some(p) = self.positions.get_mut(&path)
        {
            *p += d;
            self.placed.insert(path);
        }
        if dropped {
            save_positions(&self.positions, &self.placed);
        }
        if let Some(dir) = enter {
            self.go(dir);
        }
        if let Some((path, from)) = open
            && self.load(&path)
        {
            self.grow(Focus::File(path), from, now);
        }

        self.terminal_cards(ui, &painter, rect, &term_rects, now);

        if self.entries.is_empty() && term_rects.is_empty() {
            painter.text(
                rect.center(),
                Align2::CENTER_CENTER,
                "Nothing here.",
                FontId::proportional(20.0),
                FAINT,
            );
        }
        painter.text(
            rect.left_bottom() + vec2(12.0, -10.0),
            Align2::LEFT_BOTTOM,
            "double-click a folder to step in, a file or terminal to fill the view · drag to move · scroll to zoom",
            FontId::proportional(13.0),
            FAINT,
        );
    }

    /// Read a file into a buffer, unless it's open already.
    fn load(&mut self, path: &Path) -> bool {
        if self.buffers.contains_key(path) {
            return true;
        }
        let Ok(text) = std::fs::read_to_string(path) else {
            return false;
        };
        self.buffers.insert(
            path.to_path_buf(),
            Buffer {
                saved: text.clone(),
                text,
            },
        );
        true
    }

    /// Open a file filling the files surface, as a double-click does.
    pub fn show(&mut self, path: PathBuf) {
        if self.load(&path) {
            self.grow(Focus::File(path), Rect::NOTHING, 0.0);
        }
    }

    fn terminal_cards(
        &mut self,
        ui: &mut egui::Ui,
        painter: &egui::Painter,
        surface: Rect,
        rects: &[(u64, Rect)],
        now: f64,
    ) {
        let z = self.zoom;
        let mut close = None;
        let mut grow = None;
        for &(id, r) in rects {
            if !r.intersects(surface) {
                continue;
            }
            let resp = ui.interact(r, ui.id().with(("term", id)), Sense::click_and_drag());
            let x = Rect::from_center_size(r.right_top() + vec2(-16.0, 16.0) * z, Vec2::splat(18.0 * z));
            let x_resp = ui.interact(x, ui.id().with(("term-close", id)), Sense::click());
            if x_resp.clicked() {
                close = Some(id);
            }
            if resp.clicked() {
                self.active_term = Some(id);
            }
            if resp.double_clicked() {
                grow = Some((id, r));
            }
            if resp.dragged()
                && let Some(p) = self.term_pos.get_mut(&id)
            {
                *p += resp.drag_delta() / z;
            }
            let active = self.active_term == Some(id);
            let Some(t) = self.terminals.iter_mut().find(|t| t.id == id) else {
                continue;
            };
            let body = card_frame(painter, r, z, &t.title(), active);
            painter.text(
                x.center(),
                Align2::CENTER_CENTER,
                "×",
                FontId::proportional(16.0 * z),
                if x_resp.hovered() { INK } else { FAINT },
            );
            t.draw(ui, &painter.with_clip_rect(body.intersect(surface)), body, 11.0 * z, active);
            if active {
                self.term_drawn = true;
                t.take_input(ui);
            }
        }
        if let Some(id) = close {
            self.close_terminal(id);
        }
        if let Some((id, r)) = grow {
            self.grow(Focus::Term(id), r, now);
        }
    }

    /// An opened card, grown to fill the surface.
    fn focused(&mut self, ui: &mut egui::Ui, surface: Rect, now: f64) {
        let Some(focus) = self.focus.clone() else {
            return;
        };
        let target = surface.shrink(10.0);
        let t = ((now - self.focus_at) / GROW).clamp(0.0, 1.0) as f32;
        let ease = 1.0 - (1.0 - t).powi(3);
        let from = if self.focus_from == Rect::NOTHING {
            target
        } else {
            self.focus_from
        };
        let r = Rect::from_min_max(
            from.min.lerp(target.min, ease),
            from.max.lerp(target.max, ease),
        );
        let painter = ui.painter_at(surface);
        let name = match &focus {
            Focus::File(p) => p
                .file_name()
                .map_or(String::new(), |n| n.to_string_lossy().into_owned()),
            Focus::Term(id) => self
                .terminals
                .iter()
                .find(|t| t.id == *id)
                .map_or("terminal".into(), |t| t.title()),
        };
        let body = card_frame(&painter, r, 1.0, &name, true);
        if t < 1.0 {
            ui.ctx().request_repaint();
            return;
        }

        // Links on the title row: back to the folder, and for a file, out
        // into a tab of its own.
        let row = Rect::from_min_max(
            pos2(r.right() - 260.0, r.top() + 8.0),
            pos2(r.right() - 14.0, body.top() - 10.0),
        );
        let mut back = false;
        let mut own_tab = false;
        ui.scope_builder(egui::UiBuilder::new().max_rect(row), |ui| {
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                back = quiet_link(ui, "back", false).clicked();
                if matches!(focus, Focus::File(_)) {
                    ui.add_space(10.0);
                    own_tab = quiet_link(ui, "own tab", false).clicked();
                }
            });
        });
        match &focus {
            Focus::File(path) => {
                if ui.input(|i| i.key_pressed(egui::Key::Escape)) {
                    back = true;
                }
                ui.scope_builder(egui::UiBuilder::new().max_rect(body), |ui| {
                    self.editor(ui, path, false);
                });
                if own_tab {
                    self.open_requests.push(path.clone());
                    back = true;
                }
            }
            Focus::Term(id) => {
                self.active_term = Some(*id);
                if let Some(term) = self.terminals.iter_mut().find(|t| t.id == *id) {
                    term.draw(ui, &painter.with_clip_rect(body), body, 13.0, true);
                    self.term_drawn = true;
                    let over = ui.input(|i| i.pointer.hover_pos()).is_some_and(|p| body.contains(p));
                    let scroll = ui.input(|i| i.smooth_scroll_delta.y);
                    if over && scroll != 0.0 {
                        term.scroll((scroll / 8.0).round() as i32);
                    }
                    term.take_input(ui);
                } else {
                    back = true;
                }
            }
        }
        if back {
            if matches!(focus, Focus::Term(_)) {
                self.active_term = None;
            }
            self.focus = None;
        }
    }

    /// An open file in a tab of its own.
    pub fn editor_ui(&mut self, ui: &mut egui::Ui, path: &Path) {
        self.editor(ui, path, true);
    }

    /// A header with save (and the path, if asked), then the text.
    fn editor(&mut self, ui: &mut egui::Ui, path: &Path, show_path: bool) {
        // Rust source or a manifest in Tapestry's own repository: saving it
        // means the program itself needs building again.
        let in_engine = path.starts_with(&self.engine)
            && (path.extension().is_some_and(|e| e == "rs")
                || path.file_name().is_some_and(|n| n == "Cargo.toml"));
        let Some(buf) = self.buffers.get_mut(path) else {
            ui.label("This file isn't open any more.");
            return;
        };
        let mut save = false;
        ui.horizontal(|ui| {
            ui.add_space(8.0);
            let shown = path
                .strip_prefix(&self.root)
                .unwrap_or(path)
                .display()
                .to_string();
            if show_path {
                ui.label(RichText::new(shown).font(FontId::monospace(12.0)).color(MUTED));
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.add_space(8.0);
                if buf.dirty() {
                    if quiet_link(ui, "save", true).clicked() {
                        save = true;
                    }
                    if quiet_link(ui, "revert", false).clicked() {
                        buf.text = buf.saved.clone();
                    }
                } else {
                    ui.label(RichText::new("saved").color(FAINT).size(14.0));
                }
            });
        });
        if ui.input(|i| i.modifiers.command && i.key_pressed(egui::Key::S)) && buf.dirty() {
            save = true;
        }
        let lang = match path.extension().and_then(|e| e.to_str()) {
            Some("rs") => "rs",
            Some("toml") => "toml",
            Some("py") => "py",
            Some("c" | "h" | "cpp" | "hpp") => "cpp",
            _ => "",
        };
        let theme = egui_extras::syntax_highlighting::CodeTheme::light(13.0);
        let mut layouter = |ui: &egui::Ui, text: &dyn egui::TextBuffer, wrap: f32| {
            let mut job = if lang.is_empty() {
                egui::text::LayoutJob::simple(
                    text.as_str().to_owned(),
                    FontId::monospace(13.0),
                    INK,
                    wrap,
                )
            } else {
                egui_extras::syntax_highlighting::highlight(
                    ui.ctx(),
                    ui.style(),
                    &theme,
                    text.as_str(),
                    lang,
                )
            };
            // Code scrolls sideways; prose wraps.
            job.wrap.max_width = if lang.is_empty() { wrap } else { f32::INFINITY };
            ui.fonts_mut(|f| f.layout_job(job))
        };
        egui::ScrollArea::both().auto_shrink(false).show(ui, |ui| {
            ui.add(
                egui::TextEdit::multiline(&mut buf.text)
                    .code_editor()
                    .desired_width(f32::INFINITY)
                    .frame(egui::Frame::NONE)
                    .layouter(&mut layouter),
            );
        });
        if save {
            match std::fs::write(path, &buf.text) {
                Ok(()) => {
                    buf.saved = buf.text.clone();
                    self.listed_at = f64::NEG_INFINITY;
                    if in_engine {
                        self.engine_changed = true;
                    }
                }
                Err(e) => eprintln!("couldn't save {}: {e}", path.display()),
            }
        }
    }

    pub fn tab_title(&self, path: &Path) -> String {
        let name = path
            .file_name()
            .map_or(String::new(), |n| n.to_string_lossy().into_owned());
        match self.buffers.get(path) {
            Some(b) if b.dirty() => format!("{name} ●"),
            _ => name,
        }
    }

    pub fn close(&mut self, path: &Path) {
        self.buffers.remove(path);
    }
}

fn read_entry(path: PathBuf, name: String) -> Entry {
    if path.is_dir() {
        let mut inside: Vec<String> = std::fs::read_dir(&path).map_or(Vec::new(), |r| {
            r.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| !n.starts_with('.') && !SKIP.contains(&n.as_str()))
                .collect()
        });
        inside.sort_by_key(|n| n.to_lowercase());
        let count = inside.len();
        return Entry {
            path,
            name,
            kind: Kind::Folder,
            preview: inside.into_iter().take(6).collect::<Vec<_>>().join("\n"),
            links: Vec::new(),
            count,
        };
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let text = std::fs::metadata(&path)
        .ok()
        .filter(|m| m.len() < 2_000_000)
        .and_then(|_| std::fs::read(&path).ok())
        .and_then(|b| String::from_utf8(b).ok());
    let kind = match (ext.as_str(), &text) {
        (_, None) => Kind::Binary,
        ("md" | "markdown", _) => Kind::Markdown,
        ("tree", _) => Kind::Rule,
        ("rs", _) => Kind::Code("rust"),
        ("toml", _) => Kind::Code("toml"),
        ("py", _) => Kind::Code("python"),
        ("wgsl", _) => Kind::Code("wgsl"),
        ("js" | "ts" | "json" | "c" | "cpp" | "h" | "hpp" | "sh", _) => Kind::Code("code"),
        _ => Kind::Text,
    };
    let text = text.unwrap_or_default();
    let preview: String = text.lines().take(14).collect::<Vec<_>>().join("\n");
    let links = if kind == Kind::Markdown {
        wikilinks(&text)
    } else {
        Vec::new()
    };
    Entry {
        path,
        name,
        kind,
        preview,
        links,
        count: 0,
    }
}

/// `[[Target]]`, `[[Target|shown]]`, `[[Target#heading]]` → `Target`.
fn wikilinks(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("[[") {
        rest = &rest[i + 2..];
        let Some(j) = rest.find("]]") else { break };
        let inner = &rest[..j];
        let target = inner.split(['|', '#']).next().unwrap_or("").trim();
        if !target.is_empty() && !out.iter().any(|t: &String| t == target) {
            out.push(target.to_owned());
        }
        rest = &rest[j + 2..];
    }
    out
}

fn stem(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(s, _)| s)
}

fn draw_card(painter: &egui::Painter, e: &Entry, r: Rect, z: f32, hot: bool, open: bool) {
    if e.kind == Kind::Folder {
        // A folder is a frame you step into: a second sheet behind it.
        painter.rect(
            r.translate(vec2(6.0, -6.0) * z),
            CornerRadius::same((12.0 * z) as u8),
            Color32::from_rgb(0xf6, 0xf4, 0xee),
            Stroke::new(1.0, MUTED),
            egui::StrokeKind::Inside,
        );
    }
    let (fill, stroke) = match e.kind {
        Kind::Folder => (Color32::from_rgb(0xf6, 0xf4, 0xee), MUTED),
        _ => (SHEET, if hot { INK } else { MUTED }),
    };
    painter.rect(
        r,
        CornerRadius::same((12.0 * z) as u8),
        fill,
        Stroke::new(if hot { 1.6 } else { 1.2 }, stroke),
        egui::StrokeKind::Inside,
    );
    let pad = 12.0 * z;
    let clip = painter.with_clip_rect(r.shrink(2.0));
    let heading = match e.kind {
        Kind::Rule => e
            .preview
            .lines()
            .find_map(|l| l.trim().strip_prefix('#'))
            .map_or(e.name.clone(), |t| t.trim().to_owned()),
        _ => e.name.clone(),
    };
    let title_font = match e.kind {
        Kind::Code(_) | Kind::Text | Kind::Binary => FontId::monospace(13.0 * z),
        _ => title(17.0 * z),
    };
    let head = clip.layout_no_wrap(heading, title_font, INK);
    let head_h = head.size().y;
    clip.galley(r.min + vec2(pad, pad), head, INK);
    let y = r.top() + pad + head_h + 4.0 * z;
    clip.line_segment(
        [pos2(r.left() + pad, y), pos2(r.right() - pad, y)],
        Stroke::new(1.0, INK),
    );
    if open {
        clip.circle_filled(pos2(r.right() - pad, r.top() + pad + head_h / 2.0), 3.5 * z, LINK);
    }

    let body_at = pos2(r.left() + pad, y + 6.0 * z);
    let width = r.width() - pad * 2.0;
    let (body, font, color) = match e.kind {
        Kind::Folder => {
            let more = e.count.saturating_sub(6);
            let mut list = e.preview.clone();
            if more > 0 {
                list.push_str(&format!("\n… and {more} more"));
            }
            if list.is_empty() {
                list = "empty".to_owned();
            }
            (list, FontId::proportional(13.0 * z), FAINT)
        }
        Kind::Binary => (
            "not text".to_owned(),
            FontId::proportional(14.0 * z),
            FAINT,
        ),
        Kind::Markdown | Kind::Rule => {
            let prose: Vec<&str> = e
                .preview
                .lines()
                .filter(|l| !l.trim_start().starts_with('#'))
                .collect();
            (
                prose.join("\n").trim().to_owned(),
                FontId::proportional(13.0 * z),
                MUTED,
            )
        }
        Kind::Code(lang) => (
            e.preview.clone(),
            FontId::monospace(10.5 * z),
            if lang == "rust" { MUTED } else { FAINT },
        ),
        Kind::Text => (e.preview.clone(), FontId::monospace(10.5 * z), MUTED),
    };
    let galley = clip.layout(body, font, color, width);
    clip.galley(body_at, galley, color);
}

/// A Line Lab card: sheet, title, rule under it. Returns the body's rect.
fn card_frame(painter: &egui::Painter, r: Rect, z: f32, heading: &str, strong: bool) -> Rect {
    painter.rect(
        r,
        CornerRadius::same((12.0 * z).min(14.0) as u8),
        SHEET,
        Stroke::new(if strong { 1.6 } else { 1.2 }, if strong { INK } else { MUTED }),
        egui::StrokeKind::Inside,
    );
    let pad = 12.0 * z;
    let head = painter.layout_no_wrap(heading.to_owned(), title(17.0 * z), INK);
    let h = head.size().y;
    painter
        .with_clip_rect(r.shrink(2.0))
        .galley(r.min + vec2(pad, pad), head, INK);
    let y = r.top() + pad + h + 4.0 * z;
    painter.line_segment(
        [pos2(r.left() + pad, y), pos2(r.right() - pad, y)],
        Stroke::new(1.0, INK),
    );
    Rect::from_min_max(pos2(r.left() + pad, y + 6.0 * z), r.max - vec2(pad, pad))
}

/// `~/.local/state/tapestry` (or under `$XDG_STATE_HOME`).
fn state_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| Path::new(&h).join(".local/state")))?;
    Some(base.join("tapestry"))
}

/// `cards.tsv`: one moved card per line, `x<TAB>y<TAB>path`.
fn load_positions() -> HashMap<PathBuf, Vec2> {
    let Some(text) = state_dir().and_then(|d| std::fs::read_to_string(d.join("cards.tsv")).ok())
    else {
        return HashMap::new();
    };
    text.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let x = parts.next()?.parse().ok()?;
            let y = parts.next()?.parse().ok()?;
            Some((PathBuf::from(parts.next()?), vec2(x, y)))
        })
        .collect()
}

fn save_positions(positions: &HashMap<PathBuf, Vec2>, placed: &HashSet<PathBuf>) {
    let Some(dir) = state_dir() else { return };
    let mut lines: Vec<String> = placed
        .iter()
        .filter_map(|p| {
            let v = positions.get(p)?;
            Some(format!("{}\t{}\t{}", v.x, v.y, p.display()))
        })
        .collect();
    lines.sort();
    let _ = std::fs::create_dir_all(&dir);
    if let Err(e) = std::fs::write(dir.join("cards.tsv"), lines.join("\n") + "\n") {
        eprintln!("couldn't remember card positions: {e}");
    }
}

/// `pins.txt`: one pinned folder per line.
fn load_pins() -> Vec<PathBuf> {
    state_dir()
        .and_then(|d| std::fs::read_to_string(d.join("pins.txt")).ok())
        .map(|t| {
            t.lines()
                .filter(|l| !l.trim().is_empty())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default()
}

fn save_pins(pins: &[PathBuf]) {
    let Some(dir) = state_dir() else { return };
    let text: String = pins.iter().map(|p| format!("{}\n", p.display())).collect();
    let _ = std::fs::create_dir_all(&dir);
    if let Err(e) = std::fs::write(dir.join("pins.txt"), text) {
        eprintln!("couldn't remember pins: {e}");
    }
}

fn expand_home(p: &str) -> String {
    match (p.strip_prefix("~/"), std::env::var("HOME")) {
        (Some(rest), Ok(home)) => format!("{home}/{rest}"),
        _ => p.to_owned(),
    }
}

/// Start the freshly built program with the same arguments, then close.
fn restart(ctx: &egui::Context) {
    if let Ok(exe) = std::env::current_exe() {
        let args: Vec<String> = std::env::args().skip(1).collect();
        if std::process::Command::new(exe).args(args).spawn().is_ok() {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
    }
}
