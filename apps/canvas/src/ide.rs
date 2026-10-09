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
use std::time::Instant;

use eframe::egui;
use egui::{Align2, Color32, CornerRadius, FontId, Pos2, Rect, RichText, Sense, Stroke, Vec2, pos2, vec2};

use crate::server::{Remote, Server};
use crate::term::Terminal;
use crate::{DOT, FAINT, INK, MUTED, SHEET, quiet_link, title};

const CARD: Vec2 = vec2(230.0, 150.0);
const TERM: Vec2 = vec2(500.0, 310.0);
/// The app's own terminals (no server) are numbered from here, apart from
/// the server's.
const LOCAL_TERMS: u64 = 1 << 40;

/// The server's terminals, and when it was asked.
type Listed = (Instant, Vec<Remote>);
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
    /// How far each file card's text is scrolled, in unzoomed points.
    card_scroll: HashMap<PathBuf, f32>,
    pub buffers: BTreeMap<PathBuf, Buffer>,
    /// Files to open as tabs; the dock picks these up after drawing.
    pub open_requests: Vec<PathBuf>,
    engine_changed: bool,
    build: Option<Build>,
    /// Terminals, each living in the folder it was opened in.
    terminals: Vec<Terminal>,
    /// tapestry-server, once found, and what it last said it keeps. Found
    /// and asked off the UI thread; see `watch_server`.
    server: Arc<Mutex<Option<Arc<Server>>>>,
    remote: Arc<Mutex<Option<Listed>>>,
    watching_server: bool,
    /// When each terminal got its card: a list asked for before then
    /// doesn't know it yet.
    carded: HashMap<u64, Instant>,
    /// The world folder, for the server to serve its notes.
    world: Arc<Mutex<Option<PathBuf>>>,
    term_pos: HashMap<u64, Vec2>,
    next_term: u64,
    /// The terminal that has the keyboard: the last one clicked, until
    /// something else is.
    active_term: Option<u64>,
    /// Whether the active terminal was on screen last frame (if its pane is
    /// hidden, the keyboard goes back to the app).
    term_drawn: bool,
    term_visible: bool,
    /// Where terminals were drawn this frame and last, to tell whether a
    /// click landed on one.
    term_hits: Vec<(u64, Rect)>,
    last_term_hits: Vec<(u64, Rect)>,
    /// The folder each terminal sits in while it isn't at a file.
    term_home: HashMap<u64, PathBuf>,
    /// Terminals that stay where they're put instead of moving to the files
    /// they read and edit.
    stay: HashSet<u64>,
    /// Terminals drawn in this folder last frame, so one arriving appears at
    /// its card rather than gliding in from wherever it was.
    term_here: HashSet<u64>,
    /// The terminal the files view follows from folder to folder, and the
    /// file it was last shown at.
    pub watching: Option<u64>,
    watched_at: Option<PathBuf>,
    /// A terminal's trail being scrubbed: it shows where it was then.
    scrub: Option<(u64, f64)>,
    /// A card to bring into view once it's laid out, and the pan gliding there.
    reveal: Option<PathBuf>,
    pan_to: Option<Vec2>,
    /// Asks the window to show the files pane.
    pub reveal_files: bool,
    /// The file whose editor has the keyboard this frame, as shown.
    pub editing: Option<String>,
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
            card_scroll: HashMap::new(),
            buffers: BTreeMap::new(),
            open_requests: Vec::new(),
            engine_changed: false,
            build: None,
            terminals: Vec::new(),
            server: Arc::default(),
            remote: Arc::default(),
            watching_server: false,
            carded: HashMap::new(),
            world: Arc::default(),
            term_pos: HashMap::new(),
            // The app's own terminals are numbered apart from the server's.
            next_term: LOCAL_TERMS,
            active_term: None,
            term_drawn: false,
            term_visible: false,
            term_hits: Vec::new(),
            last_term_hits: Vec::new(),
            term_home: HashMap::new(),
            stay: HashSet::new(),
            term_here: HashSet::new(),
            watching: None,
            watched_at: None,
            scrub: None,
            reveal: None,
            pan_to: None,
            reveal_files: false,
            editing: None,
            focus: None,
            focus_from: Rect::NOTHING,
            focus_at: 0.0,
            startup_term: std::env::var("TAPESTRY_TERM").ok(),
            view: Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 700.0)),
        }
    }

    /// Call once per frame before anything reads the keyboard.
    ///
    /// A click decides where keys go: on a terminal, to it; anywhere else
    /// (the timeline, the canvas, an editor), back to the app.
    pub fn begin_frame(&mut self, ctx: &egui::Context) {
        self.sync_terminals(ctx);
        self.term_visible = std::mem::take(&mut self.term_drawn);
        self.editing = None;
        self.last_term_hits = std::mem::take(&mut self.term_hits);
        let press = ctx.input(|i| {
            i.pointer
                .any_pressed()
                .then(|| i.pointer.press_origin())
                .flatten()
        });
        if let Some(p) = press {
            self.active_term = self
                .last_term_hits
                .iter()
                .rev()
                .find(|(_, r)| r.contains(p))
                .map(|t| t.0);
        }
    }

    /// A card is open, filling the surface.
    pub fn has_focus(&self) -> bool {
        self.focus.is_some()
    }

    /// Text selected in a terminal on screen, for highlighting.
    pub fn term_selection(&self) -> Option<crate::highlight::Direct> {
        self.terminals
            .iter()
            .filter(|t| self.last_term_hits.iter().any(|h| h.0 == t.id))
            .find_map(|t| {
                let (text, anchor) = t.selection()?;
                Some(crate::highlight::Direct {
                    text,
                    source: t.trail.lock().unwrap().claude.as_ref().map_or(t.title(), |c| {
                        format!("claude · {}", c.name)
                    }),
                    anchor,
                })
            })
    }

    /// A terminal has the keyboard: the app's own shortcuts stand aside.
    pub fn terminal_active(&self) -> bool {
        self.active_term.is_some() && self.term_visible
    }

    /// Serve `world`'s notes from the server too, once one is found.
    pub fn serve_world(&mut self, world: PathBuf) {
        *self.world.lock().unwrap() = Some(world);
    }

    /// Look for tapestry-server, and keep asking it what terminals it
    /// keeps, once a second, off the UI thread.
    fn watch_server(&self, ctx: &egui::Context) {
        let (server, remote, world, ctx) = (self.server.clone(), self.remote.clone(), self.world.clone(), ctx.clone());
        std::thread::spawn(move || {
            loop {
                let found = server.lock().unwrap().clone();
                match found {
                    None => {
                        if let Some(s) = Server::find() {
                            if s.local
                                && let Some(w) = world.lock().unwrap().as_ref()
                            {
                                s.set_world(w);
                            }
                            *server.lock().unwrap() = Some(Arc::new(s));
                            continue;
                        }
                        std::thread::sleep(std::time::Duration::from_secs(5));
                    }
                    Some(s) => {
                        let asked = Instant::now();
                        if let Some(list) = s.list() {
                            *remote.lock().unwrap() = Some((asked, list));
                            ctx.request_repaint();
                        }
                        std::thread::sleep(std::time::Duration::from_secs(1));
                    }
                }
            }
        });
    }

    /// Match the cards to the server's terminals: one opened elsewhere (on
    /// the phone, say) gets a card here, and one closed elsewhere loses its.
    fn sync_terminals(&mut self, ctx: &egui::Context) {
        if !self.watching_server {
            self.watching_server = true;
            self.watch_server(ctx);
        }
        let Some(server) = self.server.lock().unwrap().clone() else { return };
        let Some((asked, list)) = self.remote.lock().unwrap().take() else { return };
        let gone: Vec<u64> = self
            .terminals
            .iter()
            .filter(|t| t.id < LOCAL_TERMS && !list.iter().any(|r| r.id == t.id))
            .filter(|t| self.carded.get(&t.id).is_none_or(|&at| at < asked))
            .map(|t| t.id)
            .collect();
        for id in gone {
            self.drop_terminal(id);
        }
        for r in list {
            if !self.terminals.iter().any(|t| t.id == r.id) {
                let home = r.cwd.canonicalize().unwrap_or_else(|_| r.cwd.clone());
                let t = Terminal::attach(&server, Remote { cwd: home.clone(), ..r }, ctx);
                self.add_terminal(t, home, false);
            }
        }
    }

    fn spawn_terminal(&mut self, ctx: &egui::Context) {
        let server = self.server.lock().unwrap().clone();
        let made = match &server {
            Some(server) => server.create(&self.here).map(|r| Terminal::attach(server, r, ctx)),
            None => Terminal::spawn(self.next_term, &self.here, ctx).inspect(|_| self.next_term += 1),
        };
        match made {
            Ok(t) => {
                let home = self.here.clone();
                self.add_terminal(t, home, true);
            }
            Err(e) => eprintln!("couldn't start a terminal: {e}"),
        }
    }

    /// Put a terminal's card in `home`: in the middle of what's in view, a
    /// little offset from any terminal already there.
    fn add_terminal(&mut self, t: Terminal, home: PathBuf, active: bool) {
        let id = t.id;
        let view = self.view.size() / 2.0 - self.pan;
        let nudge = self.terminals.iter().filter(|t| t.cwd == home).count() as f32 * 28.0;
        let pos = view / self.zoom - TERM / 2.0 + Vec2::splat(nudge);
        self.term_pos.entry(id).or_insert(pos);
        self.term_home.insert(id, home);
        self.carded.insert(id, Instant::now());
        self.terminals.push(t);
        if active {
            self.active_term = Some(id);
        }
    }

    /// × on a card: the terminal ends, here and on every device.
    fn close_terminal(&mut self, id: u64) {
        if let Some(t) = self.terminals.iter_mut().find(|t| t.id == id) {
            t.close();
        }
        self.drop_terminal(id);
    }

    fn drop_terminal(&mut self, id: u64) {
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
        self.follow();
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
        let anchored = self.place_terminals(ui, rect);

        // Where this folder's terminals sit; scrolling over one scrolls
        // its history rather than zooming.
        let z = self.zoom;
        let term_rects: Vec<(u64, Rect)> = anchored
            .iter()
            .map(|(id, _)| {
                let pos = self.term_pos.get(id).copied().unwrap_or_default();
                (*id, Rect::from_min_size(rect.min + self.pan + pos * z, TERM * z))
            })
            .collect();
        let over_term = response
            .hover_pos()
            .or(ui.input(|i| i.pointer.hover_pos()))
            .and_then(|p| term_rects.iter().find(|(_, r)| r.contains(p)).map(|t| t.0));

        // Cards are drawn in order, so the last one under the pointer is on top.
        let pointer = ui.input(|i| i.pointer.hover_pos()).filter(|p| rect.contains(*p));
        let over_card = pointer.filter(|_| over_term.is_none()).and_then(|p| {
            self.entries.iter().rev().find(|e| {
                let at = self.positions.get(&e.path).copied().unwrap_or(Vec2::INFINITY);
                Rect::from_min_size(rect.min + self.pan + at * z, CARD * z).contains(p)
            })
        });

        // Pan by dragging the background; zoom with the wheel there, or by
        // pinching (or Cmd+wheel) anywhere.
        if response.dragged() {
            self.pan += response.drag_delta();
            self.pan_to = None;
        }
        let pinch = ui.input(|i| i.zoom_delta());
        if pinch != 1.0
            && let Some(p) = pointer
        {
            self.zoom_at(p - rect.min, pinch);
        } else if let Some(e) = over_card {
            // Over a file card, the wheel reads down through the file.
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            if scroll != 0.0 && e.kind != Kind::Folder {
                *self.card_scroll.entry(e.path.clone()).or_default() -= scroll / z;
            }
        } else if let Some(id) = over_term {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            if scroll != 0.0
                && let Some(t) = self.terminals.iter_mut().find(|t| t.id == id)
            {
                t.wheel(scroll, ui.input(|i| i.pointer.hover_pos()));
            }
        } else if let Some(p) = response.hover_pos() {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            if scroll != 0.0 {
                self.zoom_at(p - rect.min, (scroll * 0.002).exp());
            }
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
            let hot = ui.rect_contains_pointer(r);
            let scroll = self.card_scroll.entry(e.path.clone()).or_default();
            let body = draw_card(&painter, e, r, z, hot, self.buffers.contains_key(&e.path), scroll);
            // The title moves the card; the text below it selects, like any text.
            let head = Rect::from_min_max(r.min, pos2(r.right(), body.window.top()));
            let resp = ui.interact(head, ui.id().with(("card", &e.path)), Sense::click_and_drag());
            let text = ui.interact(body.window, ui.id().with(("card-text", &e.path)), Sense::click_and_drag());
            if resp.dragged() {
                moved = Some((e.path.clone(), resp.drag_delta() / z));
            }
            dropped |= resp.drag_stopped();
            if resp.double_clicked() || text.double_clicked() {
                match e.kind {
                    Kind::Folder => enter = Some(e.path.clone()),
                    Kind::Binary => {}
                    _ => open = Some((e.path.clone(), r)),
                }
            }
            if resp.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
            } else if text.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::Text);
            }
            let mut clip = ui.new_child(egui::UiBuilder::new().max_rect(body.window));
            clip.set_clip_rect(body.window);
            egui::text_selection::LabelSelectionState::label_text_selection(
                &clip,
                &text,
                body.at,
                body.galley,
                body.color,
                Stroke::NONE,
            );
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

        // A terminal at a card is tied to it by a thread of blue ink.
        for ((_, card), (_, t)) in anchored.iter().zip(&term_rects) {
            let Some(i) = card.as_ref().and_then(|c| self.entries.iter().position(|e| e.path == *c)) else {
                continue;
            };
            let c = rects[i];
            painter.rect_stroke(
                c,
                CornerRadius::same((12.0 * z) as u8),
                Stroke::new(2.0, LINK),
                egui::StrokeKind::Outside,
            );
            let (a, b) = (c.right_center(), pos2(t.left(), t.top() + 24.0 * z));
            painter.line_segment([a, b], Stroke::new(1.5, LINK));
            painter.circle_filled(a, 3.5 * z, LINK);
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
            "double-click a folder to step in, a file or terminal to fill the view · drag a title to move, its text to select · scroll a card to read it, elsewhere to zoom · pinch to zoom",
            FontId::proportional(13.0),
            FAINT,
        );
    }

    /// The file a terminal is at (where it was, while its trail is being
    /// scrubbed), unless it stays put.
    fn term_file(&self, t: &Terminal) -> Option<PathBuf> {
        if self.stay.contains(&t.id) {
            return None;
        }
        let trail = t.trail.lock().unwrap();
        let visit = match self.scrub {
            Some((id, at)) if id == t.id => trail.at(at),
            _ => trail.last(),
        };
        visit.map(|v| v.path.clone())
    }

    /// The card in this folder standing for `file`: the file's own, or the
    /// folder's it's somewhere inside.
    fn card_for(&self, file: &Path) -> Option<PathBuf> {
        let first = file.strip_prefix(&self.here).ok()?.components().next()?;
        let path = self.here.join(first);
        self.entries.iter().any(|e| e.path == path).then_some(path)
    }

    /// Move each terminal toward the card of the file it's at, and say which
    /// are in this folder and at which card.
    fn place_terminals(&mut self, ui: &egui::Ui, rect: Rect) -> Vec<(u64, Option<PathBuf>)> {
        let dt = ui.input(|i| i.stable_dt).min(0.1);
        let ease = 1.0 - (-dt * 7.0).exp();
        let mut here = Vec::new();
        let mut per_card: HashMap<PathBuf, f32> = HashMap::new();
        for t in &self.terminals {
            let card = self.term_file(t).and_then(|f| self.card_for(&f));
            match &card {
                Some(c) => {
                    // Beside the card, stacked if several are at it.
                    let n = per_card.entry(c.clone()).or_default();
                    let target = self.positions[c] + vec2(CARD.x + 40.0, 0.0) + Vec2::splat(*n * 28.0);
                    *n += 1.0;
                    let pos = self.term_pos.entry(t.id).or_insert(target);
                    if !self.term_here.contains(&t.id) {
                        *pos = target;
                    }
                    let gap = target - *pos;
                    *pos += gap * ease;
                    if gap.length() > 0.5 {
                        ui.ctx().request_repaint();
                    }
                }
                None if self.term_home.get(&t.id) != Some(&self.here) => continue,
                None => {}
            }
            here.push((t.id, card));
        }
        self.term_here = here.iter().map(|t| t.0).collect();

        // A card asked for: glide so it and the terminal beside it are in view.
        if let Some(path) = self.reveal.take() {
            match self.card_for(&path).and_then(|c| self.positions.get(&c)) {
                Some(&pos) => {
                    let middle = pos + vec2(CARD.x + 40.0 + TERM.x, TERM.y) / 2.0;
                    self.pan_to = Some(rect.size() / 2.0 - middle * self.zoom);
                }
                // Not listed yet: try next frame.
                None if self.entries.is_empty() => self.reveal = Some(path),
                None => {}
            }
        }
        if let Some(to) = self.pan_to {
            let gap = to - self.pan;
            self.pan += gap * ease;
            if gap.length() < 0.5 {
                self.pan_to = None;
            }
            ui.ctx().request_repaint();
        }
        here
    }

    /// Keep the view on the followed (or scrubbed) terminal: when it moves
    /// to a file in another folder, go there.
    fn follow(&mut self) {
        let id = self.scrub.map(|s| s.0).or(self.watching);
        let Some(t) = id.and_then(|id| self.terminals.iter().find(|t| t.id == id)) else {
            self.watching = None;
            return;
        };
        let file = self.term_file(t);
        if self.focus.is_some() || file == self.watched_at {
            return;
        }
        self.watched_at = file.clone();
        if let Some(f) = file {
            self.show_file(&f);
        }
    }

    /// Go to the folder a file is in and bring its card into view.
    fn show_file(&mut self, file: &Path) {
        let Some(dir) = file.parent() else { return };
        if dir != self.here {
            let active = self.active_term;
            if dir.starts_with(&self.root) {
                self.go(dir.to_path_buf());
            } else {
                self.open_folder(dir.to_path_buf());
            }
            self.active_term = active;
        }
        self.reveal = Some(file.to_path_buf());
    }

    /// Fill the files view with a terminal, in the folder where it is.
    fn open_terminal(&mut self, id: u64, now: f64) {
        let Some(t) = self.terminals.iter().find(|t| t.id == id) else {
            return;
        };
        let dir = match self.term_file(t) {
            Some(f) => f.parent().map(Path::to_path_buf),
            None => self.term_home.get(&id).cloned(),
        };
        if let Some(dir) = dir
            && dir != self.here
        {
            self.go(dir);
        }
        self.grow(Focus::Term(id), Rect::NOTHING, now);
        self.reveal_files = true;
    }

    /// The terminals pane: each terminal, where it is, and where it's been.
    pub fn terminals_ui(&mut self, ui: &mut egui::Ui) {
        let now = ui.input(|i| i.time);
        let wall = crate::trail::now();
        let root = self.root.clone();
        ui.add_space(14.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new("Terminals").font(title(22.0)));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if quiet_link(ui, "+ terminal", false).clicked() {
                    self.spawn_terminal(ui.ctx());
                    self.reveal_files = true;
                }
            });
        });
        ui.label(
            RichText::new("Each one goes to the files it reads and edits.")
                .color(FAINT)
                .size(15.0),
        );
        ui.add_space(12.0);
        if self.terminals.is_empty() {
            ui.label(RichText::new("None open.").color(FAINT).size(15.0));
        }
        let mut open = None;
        let mut show = None;
        let mut scrub = None;
        let mut scrubbing = false;
        for t in &self.terminals {
            let id = t.id;
            let (claude, visits) = {
                let tr = t.trail.lock().unwrap();
                (tr.claude.clone(), tr.visits.clone())
            };
            let following = self.watching == Some(id);
            let stays = self.stay.contains(&id);
            let card = egui::Frame::new()
                .fill(SHEET)
                .stroke(Stroke::new(1.5, if following { INK } else { MUTED }))
                .corner_radius(CornerRadius::same(14))
                .inner_margin(egui::Margin::symmetric(16, 12));
            let inner = ui.scope_builder(egui::UiBuilder::new().sense(Sense::click()), |ui| {
                card.show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        let name = match &claude {
                            Some(c) if !c.name.is_empty() => format!("claude · {}", c.name),
                            Some(_) => "claude".to_owned(),
                            None => t.title(),
                        };
                        ui.label(RichText::new(name).font(title(19.0)));
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if quiet_link(ui, "open", false).clicked() {
                                open = Some(id);
                            }
                            let label = if following { "following" } else { "follow" };
                            if quiet_link(ui, label, following).clicked() {
                                self.watching = if following { None } else { Some(id) };
                                self.watched_at = None;
                                self.reveal_files = true;
                            }
                            if let Some(c) = &claude {
                                ui.label(RichText::new(&c.status).color(FAINT).size(14.0));
                            }
                        });
                    });
                    let r = ui.max_rect();
                    let y = ui.cursor().top() + 2.0;
                    ui.painter().line_segment(
                        [pos2(r.left(), y), pos2(r.right(), y)],
                        Stroke::new(1.2, INK),
                    );
                    ui.add_space(8.0);

                    // Where it is now.
                    match visits.last() {
                        Some(v) => {
                            let line = format!(
                                "{} {} · {} ago",
                                touched(v.touch),
                                shown_path(&root, &v.path),
                                ago(wall - v.at)
                            );
                            ui.label(RichText::new(line).size(15.0));
                        }
                        None => {
                            ui.label(
                                RichText::new("hasn't touched a file yet")
                                    .color(FAINT)
                                    .size(15.0),
                            );
                        }
                    }

                    // Its trail: one dot per file, in time. Drag along it to
                    // see where it was; click a dot to go to that file.
                    if !visits.is_empty() {
                        ui.add_space(6.0);
                        let (strip, resp) = ui.allocate_exact_size(
                            vec2(ui.available_width(), 26.0),
                            Sense::click_and_drag(),
                        );
                        let t0 = visits[0].at.min(t.started);
                        let t1 = wall.max(t0 + 60.0);
                        let x_of = |at: f64| {
                            strip.left() + ((at - t0) / (t1 - t0)) as f32 * strip.width()
                        };
                        let at_x = |x: f32| {
                            t0 + ((x - strip.left()) / strip.width()).clamp(0.0, 1.0) as f64 * (t1 - t0)
                        };
                        let p = ui.painter();
                        let mid = strip.center().y;
                        p.line_segment(
                            [pos2(strip.left(), mid), pos2(strip.right(), mid)],
                            Stroke::new(1.0, crate::RULE_LINE),
                        );
                        let pointer = resp.hover_pos();
                        let near = pointer.and_then(|q| {
                            visits
                                .iter()
                                .min_by(|a, b| {
                                    (x_of(a.at) - q.x).abs().total_cmp(&(x_of(b.at) - q.x).abs())
                                })
                                .filter(|v| (x_of(v.at) - q.x).abs() < 8.0)
                        });
                        for v in &visits {
                            let (r, c) = match v.touch {
                                crate::trail::Touch::Edit => (4.5, DOT),
                                crate::trail::Touch::Read => (3.5, LINK),
                                crate::trail::Touch::Open => (3.5, MUTED),
                            };
                            let hot = near.is_some_and(|n| std::ptr::eq(n, v));
                            p.circle_filled(pos2(x_of(v.at), mid), if hot { r + 1.5 } else { r }, c);
                        }
                        let marker = match self.scrub {
                            Some((sid, at)) if sid == id => at,
                            _ => wall,
                        };
                        let x = x_of(marker).min(strip.right());
                        p.line_segment(
                            [pos2(x, strip.top()), pos2(x, strip.bottom())],
                            Stroke::new(1.5, INK),
                        );
                        if let Some(v) = near {
                            resp.clone().on_hover_text(format!(
                                "{} {}\n{} ago",
                                touched(v.touch),
                                shown_path(&root, &v.path),
                                ago(wall - v.at)
                            ));
                        }
                        if resp.dragged()
                            && let Some(q) = resp.interact_pointer_pos()
                        {
                            scrub = Some((id, at_x(q.x)));
                            scrubbing = true;
                        } else if resp.clicked()
                            && let Some(v) = near
                        {
                            show = Some(v.path.clone());
                        }
                    }

                    // The last few files, newest first.
                    ui.add_space(4.0);
                    for v in visits.iter().rev().skip(1).take(4) {
                        let line = format!("{} {}", touched(v.touch), shown_path(&root, &v.path));
                        let link = ui.add(
                            egui::Label::new(RichText::new(line).color(FAINT).size(13.0))
                                .sense(Sense::click()),
                        );
                        if link.hovered() {
                            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                        }
                        if link.clicked() {
                            show = Some(v.path.clone());
                        }
                    }
                    ui.add_space(4.0);
                    let label = if stays { "stays put · let it move" } else { "moves to its files · keep it put" };
                    if quiet_link(ui, label, false).clicked() {
                        if stays {
                            self.stay.remove(&id);
                        } else {
                            self.stay.insert(id);
                            self.term_home.insert(id, self.here.clone());
                        }
                    }
                });
            });
            if inner.response.double_clicked() {
                open = Some(id);
            }
            ui.add_space(14.0);
        }
        // Scrubbing lasts while the button is held.
        if scrubbing {
            self.scrub = scrub;
            self.reveal_files = true;
        } else if self.scrub.is_some() {
            self.scrub = None;
            self.watched_at = None;
        }
        if let Some(path) = show {
            self.show_file(&path);
            self.reveal_files = true;
        }
        if let Some(id) = open {
            self.open_terminal(id, now);
        }
    }

    /// Zoom by `factor`, keeping the point `at` (from the surface's corner)
    /// where it is.
    fn zoom_at(&mut self, at: Vec2, factor: f32) {
        let old = self.zoom;
        self.zoom = (self.zoom * factor).clamp(0.35, 2.5);
        self.pan -= (at - self.pan) * (self.zoom / old - 1.0);
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
            if resp.double_clicked() {
                grow = Some((id, r));
            }
            let selecting = self
                .terminals
                .iter_mut()
                .find(|t| t.id == id)
                .is_some_and(|t| t.select_with(ui, &resp));
            // Dragging the title moves the card; dragging the screen selects.
            if resp.dragged()
                && !selecting
                && let Some(p) = self.term_pos.get_mut(&id)
            {
                // Moved by hand, it stays where it's put.
                *p += resp.drag_delta() / z;
                self.stay.insert(id);
                self.term_home.insert(id, self.here.clone());
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
            self.term_hits.push((id, r.intersect(surface)));
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
                let active = self.active_term == Some(*id);
                let resp = ui.interact(body, ui.id().with(("term-open", *id)), Sense::click_and_drag());
                if let Some(term) = self.terminals.iter_mut().find(|t| t.id == *id) {
                    term.select_with(ui, &resp);
                    term.draw(ui, &painter.with_clip_rect(body), body, 13.0, active);
                    self.term_hits.push((*id, r));
                    let over = ui.input(|i| i.pointer.hover_pos()).is_some_and(|p| body.contains(p));
                    let scroll = ui.input(|i| i.smooth_scroll_delta.y);
                    if over && scroll != 0.0 {
                        term.wheel(scroll, ui.input(|i| i.pointer.hover_pos()));
                    }
                    if active {
                        self.term_drawn = true;
                        term.take_input(ui);
                    }
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
        let comment = crate::edit::comment_for(path);
        let id = ui.make_persistent_id(("editor", path));
        egui::ScrollArea::both().auto_shrink(false).show(ui, |ui| {
            crate::edit::keys(ui, id, &mut buf.text, comment);
            ui.add(
                egui::TextEdit::multiline(&mut buf.text)
                    .id(id)
                    .code_editor()
                    .desired_width(f32::INFINITY)
                    .frame(egui::Frame::NONE)
                    .layouter(&mut layouter),
            );
        });
        if ui.memory(|m| m.has_focus(id)) {
            self.editing = Some(shown_path(&self.root, path));
        }
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

/// A path as short as it can be: from the folder open, or from home.
fn shown_path(root: &Path, path: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(root) {
        return rel.display().to_string();
    }
    match std::env::var_os("HOME").map(PathBuf::from) {
        Some(home) if path.starts_with(&home) => {
            format!("~/{}", path.strip_prefix(&home).unwrap_or(path).display())
        }
        _ => path.display().to_string(),
    }
}

fn touched(t: crate::trail::Touch) -> &'static str {
    match t {
        crate::trail::Touch::Edit => "edited",
        crate::trail::Touch::Read => "read",
        crate::trail::Touch::Open => "opened",
    }
}

fn ago(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    match s {
        0..60 => format!("{s}s"),
        60..3600 => format!("{}m", s / 60),
        3600..86400 => format!("{}h", s / 3600),
        _ => format!("{}d", s / 86400),
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
    // Enough to scroll through on the card.
    let preview: String = text.lines().take(2000).collect::<Vec<_>>().join("\n");
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

fn draw_card(
    painter: &egui::Painter,
    e: &Entry,
    r: Rect,
    z: f32,
    hot: bool,
    open: bool,
    scroll: &mut f32,
) -> CardBody {
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
    // The text below the rule scrolls; the heading stays.
    let window = Rect::from_min_max(pos2(r.left(), y + 1.0), r.max - vec2(0.0, pad / 2.0));
    let room = (r.bottom() - pad / 2.0 - body_at.y) / z;
    *scroll = scroll.clamp(0.0, (galley.size().y / z - room).max(0.0));
    CardBody {
        galley,
        at: body_at - vec2(0.0, *scroll * z),
        window: window.intersect(painter.clip_rect()),
        color,
    }
}

/// A card's text, laid out, for the caller to draw as selectable text.
struct CardBody {
    galley: Arc<egui::Galley>,
    at: Pos2,
    /// Where it shows: below the title, inside the card.
    window: Rect,
    color: Color32,
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
pub(crate) fn state_dir() -> Option<PathBuf> {
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
