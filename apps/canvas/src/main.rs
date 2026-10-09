//! Paint with particles that keep living; switch rule notes on and watch.
//!
//! Everything you do is a keyframe on the timeline below the canvas. Scrub
//! back and the canvas replays to that moment; paint there and the future
//! replays around what you added.

mod edit;
mod highlight;
mod ide;
mod marks;
mod notes;
mod server;
mod sync;
mod tabnote;
mod term;
mod trail;
mod translate;

use std::path::PathBuf;
use std::sync::Arc;

use eframe::egui;
use egui::{
    Align2, Color32, CornerRadius, FontFamily, FontId, Mesh, Pos2, Rect, RichText, Sense, Shape,
    Stroke, TextureHandle, Vec2, pos2, vec2,
};
use egui_dock::tab_viewer::OnCloseResponse;
use egui_dock::{DockArea, DockState, NodeIndex, TabViewer};
use tapestry_canvas::{
    Body, Brush, DT, HEIGHT, KeyId, MadeBy, Material, Mimic, Particle, Rulebook, SEGS,
    TICKS_PER_SECOND, Tick, Timeline, WIDTH,
};

// The palette of data.pewdiepie.com: warm paper, near-black ink, quiet greys.
const PAPER: Color32 = Color32::from_rgb(0xfa, 0xf9, 0xf5);
const SHEET: Color32 = Color32::from_rgb(0xff, 0xfe, 0xfb);
const INK: Color32 = Color32::from_rgb(0x16, 0x19, 0x1b);
const MUTED: Color32 = Color32::from_rgb(0x4b, 0x4e, 0x4b);
const FAINT: Color32 = Color32::from_rgb(0x68, 0x6a, 0x66);
const RULE_LINE: Color32 = Color32::from_rgb(0xe4, 0xe1, 0xd9);
// The red dot from the Line Lab sketches.
const DOT: Color32 = Color32::from_rgb(0xe8, 0x49, 0x2a);

fn main() -> eframe::Result {
    let saved = (!fresh_start()).then(Window::load).flatten();
    let mut viewport = egui::ViewportBuilder::default()
        .with_title("Tapestry canvas")
        .with_inner_size(saved.as_ref().map_or([1480.0, 920.0], |l| l.size));
    if let Some(at) = saved.as_ref().and_then(|l| l.at) {
        viewport = viewport.with_position(at);
    }
    let options = eframe::NativeOptions {
        viewport,
        ..Default::default()
    };
    let demo = std::env::args().any(|a| a == "--demo");
    eframe::run_native(
        "Tapestry canvas",
        options,
        Box::new(move |cc| {
            let mut app = App::new(cc);
            app.reopen();
            // `TAPESTRY_OPEN=<file>` opens a file in the files pane at startup.
            if let Ok(path) = std::env::var("TAPESTRY_OPEN") {
                app.ide.show(PathBuf::from(path));
            }
            if demo {
                paint_demo(&mut app.timeline);
            }
            // `TAPESTRY_EDIT=<note>` opens that rule note for editing.
            if let Ok(name) = std::env::var("TAPESTRY_EDIT") {
                app.edit_note(&name);
            }
            Ok(Box::new(app))
        }),
    )
}

/// The world folder: `--world <dir>`, else `world/` in this repository.
fn world_dir() -> std::path::PathBuf {
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--world")
        && let Some(dir) = args.get(i + 1)
    {
        return dir.into();
    }
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../world");
    dir.canonicalize().unwrap_or(dir)
}

/// A scene to start from: an ink cup with water poured in, a row of trees
/// that fire reaches once "Fire spreads to trees" is switched on, and a
/// handful of mimics.
fn paint_demo(t: &mut Timeline) {
    use glam::Vec2;
    fn stroke(t: &mut Timeline, brush: Brush, radius: f32, points: &[(f32, f32)]) {
        let p = |i: usize| Vec2::new(points[i].0, points[i].1);
        let id = t.begin_stroke(brush, radius, p(0));
        for i in 1..points.len() {
            for k in 1..=24 {
                t.extend_stroke(id, p(i - 1).lerp(p(i), k as f32 / 24.0));
            }
        }
        t.end_stroke(id);
    }
    stroke(t, Brush::Ink, 5.0, &[(170.0, 520.0), (205.0, 770.0), (475.0, 770.0), (510.0, 520.0)]);
    stroke(t, Brush::Ink, 4.0, &[(620.0, 905.0), (1480.0, 905.0)]);
    stroke(t, Brush::Tree, 7.0, &[(690.0, 900.0), (1420.0, 900.0)]);
    t.seek(30);
    stroke(t, Brush::Water, 10.0, &[(250.0, 300.0), (430.0, 330.0), (260.0, 360.0)]);
    t.seek(90);
    stroke(t, Brush::Fire, 6.0, &[(680.0, 880.0), (700.0, 850.0)]);
    t.seek(150);
    t.set_rule("fire-spreads-to-trees", true);
    for (x, y) in [(900.0, 260.0), (980.0, 330.0), (1060.0, 240.0), (1140.0, 340.0), (1220.0, 260.0), (1010.0, 450.0), (1170.0, 470.0)] {
        stroke(t, Brush::Mimic, 8.0, &[(x, y)]);
    }
    t.seek(0);
}

/// A keyframe being dragged along the timeline.
struct Drag {
    id: KeyId,
    /// Pointer x minus the keyframe's x when grabbed.
    grab: f32,
    to: Tick,
}

/// The panes of the window. Each can be dragged, split, resized, torn off
/// into its own window, or double-clicked to fill the window.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
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

fn default_layout() -> DockState<Tab> {
    let mut dock = DockState::new(vec![Tab::Canvas]);
    let s = dock.main_surface_mut();
    let [top, _] = s.split_below(NodeIndex::root(), 0.8, vec![Tab::Timeline]);
    let [middle, right] = s.split_right(top, 0.76, vec![Tab::Rules, Tab::Files]);
    s.split_below(right, 0.62, vec![Tab::Terminals]);
    s.split_below(right, 0.7, vec![Tab::Notes]);
    s.split_left(middle, 0.11, vec![Tab::Brushes]);
    dock
}

struct Tabs<'a> {
    app: &'a mut App,
}

impl TabViewer for Tabs<'_> {
    type Tab = Tab;

    fn id(&mut self, tab: &mut Tab) -> egui::Id {
        egui::Id::new(format!("{tab:?}"))
    }

    fn title(&mut self, tab: &mut Tab) -> egui::WidgetText {
        let name = match tab {
            Tab::Canvas => "canvas".to_owned(),
            Tab::Brushes => "brushes".to_owned(),
            Tab::Rules => "rules".to_owned(),
            Tab::Timeline => "timeline".to_owned(),
            Tab::Files => "files".to_owned(),
            Tab::Terminals => "terminals".to_owned(),
            Tab::Notes => "notes".to_owned(),
            Tab::File(p) => self.app.ide.tab_title(p),
        };
        RichText::new(name).size(15.0).into()
    }

    fn ui(&mut self, ui: &mut egui::Ui, tab: &mut Tab) {
        self.app.tab_ui(ui, tab);
    }

    fn is_closeable(&self, tab: &Tab) -> bool {
        matches!(tab, Tab::File(_))
    }

    fn on_close(&mut self, tab: &mut Tab) -> OnCloseResponse {
        if let Tab::File(p) = tab {
            self.app.ide.close(p);
        }
        OnCloseResponse::Close
    }

    fn on_tab_button(&mut self, tab: &mut Tab, response: &egui::Response) {
        if response.double_clicked() {
            self.app.maximized = Some(tab.clone());
        }
    }

    fn context_menu(&mut self, ui: &mut egui::Ui, tab: &mut Tab, _: egui_dock::NodePath) {
        if ui.button("fill the window").clicked() {
            self.app.maximized = Some(tab.clone());
            ui.close();
        }
    }

    fn scroll_bars(&self, tab: &Tab) -> [bool; 2] {
        match tab {
            Tab::Notes => [false, true],
            Tab::Rules | Tab::Brushes | Tab::Terminals => [false, true],
            _ => [false, false],
        }
    }
}

/// Start from the default window: `TAPESTRY_FRESH`, or a screenshot run,
/// which starts from the same window every time.
fn fresh_start() -> bool {
    std::env::var_os("TAPESTRY_FRESH").is_some() || std::env::var_os("TAPESTRY_SHOT").is_some()
}

/// Where the window sat, on this computer only: `window.json` in the state
/// folder.
#[derive(serde::Serialize, serde::Deserialize)]
struct Window {
    size: [f32; 2],
    at: Option<[f32; 2]>,
}

impl Window {
    fn load() -> Option<Self> {
        let text = std::fs::read_to_string(ide::state_dir()?.join("window.json")).ok()?;
        serde_json::from_str(&text).ok()
    }
}

/// The panes as they were left and the folder the files pane showed, the
/// same on every computer (`layout` in the synced state). Paths in it are
/// as another computer would find them.
#[derive(serde::Serialize, serde::Deserialize)]
struct Panes {
    dock: DockState<Tab>,
    maximized: Option<Tab>,
    root: String,
    here: String,
}

/// A tab as another computer would find it, and back.
fn shared_tab(tab: &Tab) -> Tab {
    match tab {
        Tab::File(p) => Tab::File(sync::key_of(p).into()),
        t => t.clone(),
    }
}

fn local_tab(tab: &Tab) -> Tab {
    match tab {
        Tab::File(p) => Tab::File(sync::path_of(&p.to_string_lossy())),
        t => t.clone(),
    }
}

/// Where each pane sat on this screen is worked out again on the next; leave
/// it out, so a bigger or smaller screen isn't a change.
fn forget_rects(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Object(o) => {
            for (k, v) in o.iter_mut() {
                if k == "rect" || k == "viewport" {
                    *v = serde_json::json!({ "min": { "x": 0.0, "y": 0.0 }, "max": { "x": 0.0, "y": 0.0 } });
                } else {
                    forget_rects(v);
                }
            }
        }
        serde_json::Value::Array(a) => a.iter_mut().for_each(forget_rects),
        _ => {}
    }
}

/// How often the layout is written down while the window is open, so a
/// crash or a kill loses little of it.
const LAYOUT_EVERY: f64 = 3.0;

/// A rule note open for editing. It saves itself as you write.
struct Editing {
    name: String,
    text: String,
    /// The text as last written to disk.
    saved: String,
    /// When the text last changed, to save once typing pauses.
    changed_at: f64,
    /// Give the editor the keyboard on its first frame.
    focus: bool,
}

/// How long typing pauses before a note saves itself.
const AUTOSAVE: f64 = 0.4;

struct App {
    timeline: Timeline,
    /// Taken out while it's drawn, since the tabs borrow the app.
    dock: Option<DockState<Tab>>,
    /// A pane filling the whole window, if one does.
    maximized: Option<Tab>,
    ide: ide::Ide,
    /// The notes pane: writing that isn't rules.
    notebook: notes::Notes,
    highlights: highlight::Highlights,
    /// Brush marks drawn over any pane.
    marks: marks::Marks,
    /// Notes pulled out of the green select brush's tab.
    tabnote: tabnote::TabNote,
    /// The green select brush is chosen instead of `brush`.
    selecting: bool,
    /// The world folder: rule notes live in `rules/` inside it.
    world: std::path::PathBuf,
    editing: Option<Editing>,
    /// Turns the open note's prose into rule lines as it's written.
    translator: Option<translate::Translator>,
    last_poll: f64,
    brush: Brush,
    radius: f32,
    playing: bool,
    clock: f32,
    painting: Option<(KeyId, egui::Vec2)>,
    /// The keyframe picked on the timeline. What it made stays bright.
    selected: Option<KeyId>,
    drag: Option<Drag>,
    /// `TAPESTRY_SHOT=path:seconds` saves the window at that canvas time
    /// and quits, so the canvas can be checked without a person.
    shot: Option<(String, Tick, bool)>,
    hard: TextureHandle,
    soft: TextureHandle,
    /// The window's size and place last frame, and `window.json` as last
    /// written.
    window: (egui::Vec2, Option<Pos2>),
    window_saved: String,
    layout_at: f64,
    /// The panes as last kept or taken from another computer: only a change
    /// from these is kept.
    panes_kept: Option<serde_json::Value>,
}

/// Time per frame spent working out the canvas. When a scene costs more,
/// it plays in slow motion rather than freezing the window.
const BUDGET: std::time::Duration = std::time::Duration::from_millis(12);

impl App {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        install_fonts(&cc.egui_ctx);
        let mut visuals = egui::Visuals::light();
        visuals.panel_fill = PAPER;
        visuals.window_fill = PAPER;
        visuals.override_text_color = Some(INK);
        cc.egui_ctx.set_visuals(visuals);
        let world = world_dir();
        let rules = Rulebook::load(&world.join("rules")).unwrap_or_else(|e| {
            eprintln!("no rules in {}: {e}", world.display());
            Rulebook::default()
        });
        let engine = world.parent().map_or(world.clone(), |p| p.to_path_buf());
        Self {
            timeline: Timeline::new(rules),
            dock: Some(default_layout()),
            // `TAPESTRY_FILL=files` (or canvas, rules…) opens with that pane
            // filling the window.
            maximized: std::env::var("TAPESTRY_FILL").ok().and_then(|name| {
                [Tab::Canvas, Tab::Brushes, Tab::Rules, Tab::Timeline, Tab::Files, Tab::Terminals, Tab::Notes]
                    .into_iter()
                    .find(|t| format!("{t:?}").eq_ignore_ascii_case(&name))
            }),
            ide: {
                let mut ide = ide::Ide::new(engine);
                ide.serve_world(world.clone());
                ide
            },
            notebook: notes::Notes::new(&world),
            highlights: highlight::Highlights::new(&cc.egui_ctx),
            marks: marks::Marks::new(),
            tabnote: tabnote::TabNote::default(),
            selecting: false,
            world,
            editing: None,
            translator: None,
            last_poll: 0.0,
            brush: Brush::Ink,
            radius: 5.0,
            playing: true,
            clock: 0.0,
            painting: None,
            selected: None,
            drag: None,
            shot: std::env::var("TAPESTRY_SHOT").ok().and_then(|v| {
                let (path, secs) = v.rsplit_once(':')?;
                let secs: f32 = secs.parse().ok()?;
                Some((path.to_owned(), (secs * TICKS_PER_SECOND as f32) as Tick, false))
            }),
            hard: dot_texture(&cc.egui_ctx, "hard", 0.72),
            soft: dot_texture(&cc.egui_ctx, "soft", 0.0),
            window: (vec2(1480.0, 920.0), None),
            window_saved: String::new(),
            layout_at: 0.0,
            panes_kept: None,
        }
    }

    /// Put the panes back as they were left, here or on another computer.
    fn reopen(&mut self) {
        if !fresh_start()
            && let Some(v) = self.ide.synced.get("layout")
        {
            self.take_panes(v);
        }
        self.panes_kept = self.panes();
    }

    /// Lay the panes out as `v` says. File tabs whose files aren't on this
    /// computer close.
    fn take_panes(&mut self, v: serde_json::Value) {
        let Ok(panes) = serde_json::from_value::<Panes>(v) else { return };
        let mut dock = panes.dock.filter_map_tabs(|t| Some(local_tab(t)));
        dock.retain_tabs(|tab| match tab {
            Tab::File(p) => self.ide.reopen(p),
            _ => true,
        });
        // A file with unsaved changes keeps its tab.
        for (path, buf) in &self.ide.buffers {
            let tab = Tab::File(path.clone());
            if buf.dirty() && dock.find_tab(&tab).is_none() {
                dock.push_to_first_leaf(tab);
            }
        }
        if dock.iter_all_tabs().next().is_some() {
            self.dock = Some(dock);
        }
        // `TAPESTRY_FILL` still wins at the start.
        if self.panes_kept.is_some() || self.maximized.is_none() {
            self.maximized = panes.maximized.map(|t| local_tab(&t)).filter(|t| match t {
                Tab::File(p) => self.ide.buffers.contains_key(p),
                _ => true,
            });
        }
        self.ide.return_to(sync::path_of(&panes.root), sync::path_of(&panes.here));
    }

    /// The panes as another computer would take them.
    fn panes(&self) -> Option<serde_json::Value> {
        let dock = self.dock.as_ref()?.filter_map_tabs(|t| Some(shared_tab(t)));
        let (root, here) = self.ide.place();
        let mut v = serde_json::to_value(Panes {
            dock,
            maximized: self.maximized.as_ref().map(shared_tab),
            root: sync::key_of(&root),
            here: sync::key_of(&here),
        })
        .ok()?;
        forget_rects(&mut v);
        Some(v)
    }

    /// Keep what changed: the panes, the folder's camera, the window.
    fn save_layout(&mut self) {
        if self.shot.is_some() {
            return;
        }
        if let Some(v) = self.panes()
            && self.panes_kept.as_ref() != Some(&v)
        {
            self.ide.synced.set("layout", v.clone());
            self.panes_kept = Some(v);
        }
        self.ide.remember_view();
        self.ide.synced.write();
        let (size, at) = self.window;
        let window = Window { size: size.into(), at: at.map(Into::into) };
        if let Ok(text) = serde_json::to_string(&window)
            && text != self.window_saved
        {
            ide::save_state("window.json", &text);
            self.window_saved = text;
        }
    }

    /// Take up what another computer changed.
    fn take_synced(&mut self) {
        let keys = self.ide.take_synced();
        if self.shot.is_none()
            && keys.iter().any(|k| k == "layout")
            && let Some(v) = self.ide.synced.get("layout")
        {
            self.take_panes(v);
            self.panes_kept = self.panes();
        }
    }

    fn keyboard(&mut self, ui: &egui::Ui) {
        // A terminal with the keyboard gets every key, Space and Ctrl+Z too.
        if ui.ctx().egui_wants_keyboard_input() || self.ide.terminal_active() {
            return;
        }
        let idle = self.painting.is_none() && self.drag.is_none();
        ui.input(|i| {
            if i.key_pressed(egui::Key::Space) {
                self.playing = !self.playing;
            }
            if i.modifiers.command && i.key_pressed(egui::Key::Z) && idle && !self.marks.undo() {
                self.timeline.undo();
            }
            if (i.key_pressed(egui::Key::Delete) || i.key_pressed(egui::Key::Backspace))
                && idle
                && let Some(id) = self.selected.take()
            {
                self.timeline.remove(id);
            }
            if i.key_pressed(egui::Key::Escape) {
                self.selected = None;
            }
            for (n, key) in [
                egui::Key::Num1,
                egui::Key::Num2,
                egui::Key::Num3,
                egui::Key::Num4,
                egui::Key::Num5,
                egui::Key::Num6,
            ]
            .into_iter()
            .enumerate()
            {
                if i.key_pressed(key) {
                    self.brush = Brush::ALL[n];
                    self.selecting = false;
                }
            }
            if i.key_pressed(egui::Key::Num7) {
                self.choose_select();
            }
            if !self.playing && idle {
                let t = self.timeline.playhead();
                if i.key_pressed(egui::Key::ArrowRight) {
                    self.timeline.set_playhead(t + 1);
                }
                if i.key_pressed(egui::Key::ArrowLeft) {
                    self.timeline.set_playhead(t.saturating_sub(1));
                }
            }
            if i.key_pressed(egui::Key::Home) && idle {
                self.timeline.set_playhead(0);
            }
        });
        // A deleted or undone keyframe can't stay selected.
        if let Some(id) = self.selected
            && self.timeline.key(id).is_none()
        {
            self.selected = None;
        }
    }

    /// Advance the playhead with real time (only once the canvas has caught
    /// up, so a heavy scene slows down instead of falling behind), then work
    /// the canvas out toward it within the frame's budget.
    fn run_clock(&mut self, ui: &egui::Ui) {
        let deadline = std::time::Instant::now() + BUDGET;
        if self.playing && self.timeline.caught_up() {
            self.clock += ui.input(|i| i.stable_dt).min(0.1);
            let ticks = (self.clock / DT) as Tick;
            if ticks > 0 {
                self.clock -= ticks as f32 * DT;
                let ticks = ticks.min(2);
                self.timeline
                    .set_playhead(self.timeline.playhead() + ticks);
            }
        } else {
            self.clock = 0.0;
        }
        self.timeline.catch_up(Some(deadline));
        if self.playing || !self.timeline.caught_up() {
            ui.ctx().request_repaint();
        }
    }

    fn top_bar(&mut self, ui: &mut egui::Ui) {
        ui.add_space(14.0);
        ui.horizontal(|ui| {
            ui.add_space(24.0);
            ui.label(RichText::new("Tapestry").font(title(24.0)));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.add_space(24.0);
                if quiet_link(ui, "draw anywhere", self.marks.anywhere).clicked() {
                    self.marks.anywhere = !self.marks.anywhere;
                }
                ui.add_space(16.0);
                let s = self.timeline.state();
                ui.label(
                    RichText::new(format!("{} particles", s.particles.len()))
                        .color(FAINT)
                        .size(16.0),
                );
                if !self.timeline.caught_up() {
                    ui.add_space(16.0);
                    ui.label(RichText::new("catching up…").color(DOT).size(16.0));
                }
            });
        });
        ui.add_space(8.0);
    }

    fn palette(&mut self, ui: &mut egui::Ui) {
        ui.add_space(16.0);
        let rows = Brush::ALL.into_iter().map(Some).chain([None]);
        for (n, brush) in rows.enumerate() {
            let chosen = match brush {
                Some(b) => !self.selecting && self.brush == b,
                None => self.selecting,
            };
            let (rect, response) = ui.allocate_exact_size(vec2(118.0, 40.0), Sense::click());
            let p = ui.painter();
            let c = pos2(rect.left() + 28.0, rect.center().y);
            p.circle_filled(c, 11.0, brush.map_or(marks::SELECT, swatch));
            if chosen {
                p.circle_stroke(c, 15.0, Stroke::new(1.5, INK));
            }
            let color = if chosen || response.hovered() {
                INK
            } else {
                FAINT
            };
            p.text(
                pos2(c.x + 24.0, c.y),
                Align2::LEFT_CENTER,
                brush.map_or("select", Brush::name),
                FontId::proportional(20.0),
                color,
            );
            p.text(
                pos2(rect.right() - 4.0, c.y),
                Align2::RIGHT_CENTER,
                (n + 1).to_string(),
                FontId::proportional(13.0),
                RULE_LINE,
            );
            if response.clicked() {
                match brush {
                    Some(b) => {
                        self.brush = b;
                        self.selecting = false;
                    }
                    None => self.choose_select(),
                }
            }
        }
        ui.add_space(16.0);
        ui.horizontal(|ui| {
            ui.add_space(16.0);
            if quiet_link(ui, "draw anywhere", self.marks.anywhere).clicked() {
                self.marks.anywhere = !self.marks.anywhere;
            }
        });
        ui.horizontal_wrapped(|ui| {
            ui.add_space(16.0);
            ui.label(
                RichText::new("or hold Option and drag, on any pane. Esc stops.")
                    .color(FAINT)
                    .size(14.0),
            );
        });
        if self.marks.any() {
            ui.horizontal(|ui| {
                ui.add_space(16.0);
                if quiet_link(ui, "clear marks", false).clicked() {
                    self.marks.clear();
                }
            });
        }
        ui.add_space(24.0);
        ui.horizontal(|ui| {
            ui.add_space(16.0);
            ui.label(RichText::new("size").color(FAINT).size(17.0));
        });
        ui.horizontal(|ui| {
            ui.add_space(16.0);
            if quiet_link(ui, "−", false).clicked() {
                self.radius = (self.radius - 1.0).max(2.0);
            }
            ui.label(RichText::new(format!("{:.0}", self.radius)).size(18.0));
            if quiet_link(ui, "+", false).clicked() {
                self.radius = (self.radius + 1.0).min(24.0);
            }
        });
        ui.add_space(24.0);
        ui.horizontal_wrapped(|ui| {
            ui.add_space(16.0);
            ui.label(
                RichText::new("scroll on the canvas to resize")
                    .color(FAINT)
                    .size(14.0),
            );
        });
    }

    /// The green brush selects anywhere, so choosing it draws anywhere.
    fn choose_select(&mut self) {
        self.selecting = true;
        self.marks.anywhere = true;
    }

    fn tool(&self) -> marks::Tool {
        if self.selecting {
            marks::Tool::Select
        } else {
            marks::Tool::Paint(self.brush)
        }
    }

    fn notes(&mut self, ui: &mut egui::Ui) {
        ui.add_space(14.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new("Rules").font(title(22.0)));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if quiet_link(ui, "+ new rule", false).clicked() {
                    self.new_rule();
                }
            });
        });
        ui.label(
            RichText::new("Nothing acts on anything else until a note says how.")
                .color(FAINT)
                .size(15.0),
        );
        ui.label(
            RichText::new(format!("{}", self.world.join("rules").display()))
                .color(RULE_LINE)
                .size(12.0),
        );
        ui.add_space(12.0);
        let notes = self.timeline.rules().notes.clone();
        for note in &notes {
            let on = self.timeline.rule_on(&note.name);
            let editing = self.editing.as_ref().is_some_and(|e| e.name == note.name);
            let now = ui.input(|i| i.time);
            let card = egui::Frame::new()
                .fill(SHEET)
                .stroke(Stroke::new(1.5, if on { INK } else { MUTED }))
                .corner_radius(CornerRadius::same(14))
                .inner_margin(egui::Margin::symmetric(16, 12))
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.label(RichText::new(&note.title).font(title(19.0)));
                    let r = ui.max_rect();
                    let y = ui.cursor().top() + 2.0;
                    ui.painter().line_segment(
                        [pos2(r.left(), y), pos2(r.right(), y)],
                        Stroke::new(1.2, INK),
                    );
                    ui.add_space(8.0);
                    if editing && let Some(ed) = &mut self.editing {
                        if let Some(tr) = &mut self.translator
                            && tr.frame(&mut ed.text, now, ui.ctx())
                        {
                            ed.changed_at = now;
                        }
                        let id = ui.make_persistent_id(("rule-editor", &note.name));
                        edit::keys(ui, id, &mut ed.text, Some("//"));
                        let response = ui.add(
                            egui::TextEdit::multiline(&mut ed.text)
                                .id(id)
                                .font(FontId::monospace(13.0))
                                .desired_width(f32::INFINITY)
                                .desired_rows(6)
                                .frame(egui::Frame::NONE),
                        );
                        if response.changed() {
                            ed.changed_at = now;
                        }
                        if ed.focus {
                            response.request_focus();
                            ed.focus = false;
                        }
                        if let Some(tr) = &mut self.translator {
                            tr.show(ui, &ed.text);
                        }
                        return;
                    }
                    if !note.text.is_empty() {
                        ui.label(RichText::new(&note.text).size(16.0));
                        ui.add_space(4.0);
                    }
                    for b in &note.basics {
                        ui.label(RichText::new(b.to_string()).color(FAINT).size(13.0));
                    }
                    for problem in &note.problems {
                        ui.label(
                            RichText::new(format!("line {}: {}", problem.line, problem.message))
                                .color(DOT)
                                .size(13.0),
                        );
                    }
                    if note.inert() {
                        let color = if on { DOT } else { FAINT };
                        ui.label(
                            RichText::new("does nothing: nothing here says what to do yet")
                                .color(color)
                                .size(14.0),
                        );
                    }
                });
            // The red dot on the card's corner is its switch.
            let corner = card.response.rect.left_top() + vec2(4.0, 4.0);
            let dot_rect = Rect::from_center_size(corner, vec2(26.0, 26.0));
            if editing {
                // Escape, or a click anywhere off the card, puts it down.
                let off = ui.input(|i| {
                    i.key_pressed(egui::Key::Escape)
                        || (i.pointer.primary_pressed()
                            && i.pointer
                                .interact_pos()
                                .is_some_and(|p| !card.response.rect.contains(p)))
                });
                if off {
                    self.stop_editing();
                } else {
                    self.autosave(now);
                }
            } else {
                // Click a card to write in it.
                let click = ui.interact(
                    card.response.rect,
                    ui.id().with(("rule-card", &note.name)),
                    Sense::click(),
                );
                if click.hovered() && !dot_rect.contains(click.hover_pos().unwrap_or(corner)) {
                    ui.ctx().set_cursor_icon(egui::CursorIcon::Text);
                }
                if click.clicked()
                    && !click.interact_pointer_pos().is_some_and(|p| dot_rect.contains(p))
                {
                    self.edit_note(&note.name);
                }
            }
            let dot = ui.interact(
                dot_rect,
                ui.id().with(("rule-dot", &note.name)),
                Sense::click(),
            );
            let p = ui.painter();
            if on {
                p.circle_filled(corner, 10.0, DOT);
            } else {
                p.circle_filled(corner, 10.0, SHEET);
                p.circle_stroke(corner, 10.0, Stroke::new(1.5, MUTED));
            }
            if dot.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }
            if dot.clicked() && self.painting.is_none() && self.timeline.caught_up() {
                self.timeline.set_rule(&note.name, !on);
            }
            ui.add_space(14.0);
        }
    }

    fn rule_path(&self, name: &str) -> std::path::PathBuf {
        self.world.join("rules").join(format!("{name}.tree"))
    }

    fn edit_note(&mut self, name: &str) {
        self.stop_editing();
        if let Some(note) = self.timeline.rules().get(name) {
            self.translator = Some(translate::Translator::new(&note.source));
            self.editing = Some(Editing {
                name: note.name.clone(),
                text: note.source.clone(),
                saved: note.source.clone(),
                changed_at: 0.0,
                focus: true,
            });
        }
    }

    /// Write the open note if it has changed and typing has paused.
    fn autosave(&mut self, now: f64) {
        let Some(ed) = &self.editing else { return };
        if ed.text == ed.saved {
            return;
        }
        // The app repaints at least every half second, so this comes round.
        if now - ed.changed_at < AUTOSAVE {
            return;
        }
        self.save_open_note();
    }

    fn save_open_note(&mut self) {
        let Some(ed) = &mut self.editing else { return };
        if ed.text == ed.saved {
            return;
        }
        let path = self.world.join("rules").join(format!("{}.tree", ed.name));
        match std::fs::write(&path, &ed.text) {
            Ok(()) => ed.saved = ed.text.clone(),
            Err(e) => eprintln!("couldn't save {}: {e}", path.display()),
        }
        self.reload_rules();
    }

    /// Save the open note and put it down.
    fn stop_editing(&mut self) {
        if self.editing.is_none() {
            return;
        }
        self.save_open_note();
        self.editing = None;
        self.translator = None;
        self.reload_rules();
    }

    /// Read `world/rules` again. Unchanged notes change nothing; a changed
    /// one replays the canvas under it. The note being edited runs as its
    /// draft does, so the canvas answers rule lines as they're written; only
    /// its rule lines count, so typing prose doesn't replay anything.
    fn reload_rules(&mut self) {
        match Rulebook::load(&self.world.join("rules")) {
            Ok(mut rules) => {
                if let Some(ed) = &mut self.editing
                    && let Some(i) = rules.index(&ed.name)
                {
                    // Changed on disk (by Claude in a terminal, say) while
                    // open but untouched here since: take the new version.
                    let disk = &rules.notes[i].source;
                    if *disk != ed.saved && ed.text == ed.saved {
                        ed.text = disk.clone();
                        ed.saved = disk.clone();
                    }
                    let draft = tapestry_canvas::RuleNote::parse(&ed.name, &ed.text);
                    rules.notes[i].basics = draft.basics;
                    rules.notes[i].problems = draft.problems;
                }
                self.timeline.set_rules(rules);
            }
            Err(e) => eprintln!("couldn't read rules: {e}"),
        }
    }

    fn new_rule(&mut self) {
        let dir = self.world.join("rules");
        let _ = std::fs::create_dir_all(&dir);
        let name = (1..)
            .map(|n| format!("untitled-{n}"))
            .find(|n| !self.rule_path(n).exists())
            .unwrap();
        if std::fs::write(self.rule_path(&name), translate::NEW_NOTE).is_ok() {
            self.reload_rules();
            self.edit_note(&name);
        }
    }

    /// Play controls, then one lane per brush and one for rule notes.
    /// Click a keyframe to pick it, drag it to move it, delete to remove it.
    /// Anywhere else on the lanes scrubs.
    fn timeline_bar(&mut self, ui: &mut egui::Ui) {
        const LANE: f32 = 15.0;
        const LABELS: f32 = 64.0;
        let lanes = Brush::ALL.len() + 1;
        let now = self.timeline.playhead();
        let end = (self.timeline.last_key_tick() + 5 * TICKS_PER_SECOND)
            .max(now + 2 * TICKS_PER_SECOND)
            .max(20 * TICKS_PER_SECOND);
        let end = end.div_ceil(5 * TICKS_PER_SECOND) * 5 * TICKS_PER_SECOND;

        ui.add_space(10.0);
        ui.horizontal(|ui| {
            ui.add_space(24.0);
            ui.vertical(|ui| {
                ui.set_width(120.0);
                let label = if self.playing { "pause" } else { "play" };
                if quiet_link(ui, label, true).clicked() {
                    self.playing = !self.playing;
                }
                ui.label(
                    RichText::new(format!("{:.2} s", now as f32 / TICKS_PER_SECOND as f32))
                        .size(18.0)
                        .color(MUTED),
                );
            });

            let width = ui.available_width() - 24.0;
            let height = lanes as f32 * LANE + 20.0;
            let (rect, response) =
                ui.allocate_exact_size(vec2(width, height), Sense::click_and_drag());
            let track = Rect::from_min_max(
                pos2(rect.left() + LABELS, rect.top()),
                pos2(rect.right(), rect.top() + lanes as f32 * LANE),
            );
            let x_of = |t: Tick| track.left() + t as f32 / end as f32 * track.width();
            let tick_at = |x: f32| {
                let f = ((x - track.left()) / track.width()).clamp(0.0, 1.0);
                (f * end as f32).round() as Tick
            };
            let lane_of = |body: &Body| match body {
                Body::Stroke(s) => Brush::ALL.iter().position(|b| *b == s.brush).unwrap(),
                Body::Rule { .. } => Brush::ALL.len(),
            };
            let y_of = |lane: usize| track.top() + (lane as f32 + 0.5) * LANE;

            // Hit boxes: a stroke covers the time it was painted over.
            let marks: Vec<(KeyId, Rect)> = self
                .timeline
                .keys()
                .map(|k| {
                    let x0 = x_of(k.tick);
                    let x1 = x_of(k.tick + self.timeline.span(k.id)).max(x0);
                    let y = y_of(lane_of(&k.body));
                    (
                        k.id,
                        Rect::from_min_max(pos2(x0 - 6.0, y - 6.0), pos2(x1 + 6.0, y + 6.0)),
                    )
                })
                .collect();
            let pointer = ui.input(|i| i.pointer.interact_pos());
            let hit = |p: Pos2| marks.iter().rev().find(|(_, r)| r.contains(p)).map(|m| m.0);
            let hovered = response.hover_pos().and_then(hit);
            let busy = self.painting.is_some();

            let origin = ui.input(|i| i.pointer.press_origin());
            if response.drag_started()
                && !busy
                && let Some(p) = origin
                && let Some(id) = hit(p)
            {
                let tick = self.timeline.key(id).map_or(0, |k| k.tick);
                self.selected = Some(id);
                self.drag = Some(Drag {
                    id,
                    grab: p.x - x_of(tick),
                    to: tick,
                });
            }
            if let Some(drag) = &mut self.drag {
                if let Some(p) = pointer {
                    drag.to = tick_at(p.x - drag.grab);
                }
                if response.drag_stopped() || !response.dragged() {
                    let (id, to) = (drag.id, drag.to);
                    self.drag = None;
                    self.timeline.move_key(id, to);
                }
            } else if response.clicked() && !busy {
                self.selected = pointer.and_then(hit);
                if self.selected.is_none()
                    && let Some(p) = pointer
                {
                    self.timeline.set_playhead(tick_at(p.x));
                    self.playing = false;
                }
            } else if response.dragged() && !busy && let Some(p) = pointer {
                self.timeline.set_playhead(tick_at(p.x));
                self.playing = false;
            }
            if hovered.is_some() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::Grab);
            }

            let p = ui.painter();
            for (lane, name) in Brush::ALL
                .iter()
                .map(|b| b.name())
                .chain(["rules"])
                .enumerate()
            {
                let y = y_of(lane);
                p.text(
                    pos2(rect.left(), y),
                    Align2::LEFT_CENTER,
                    name,
                    FontId::proportional(12.0),
                    FAINT,
                );
                p.line_segment(
                    [pos2(track.left(), y), pos2(track.right(), y)],
                    Stroke::new(1.0, RULE_LINE),
                );
            }
            let axis = track.bottom() + 2.0;
            for s in (0..=end).step_by(5 * TICKS_PER_SECOND as usize) {
                let x = x_of(s);
                p.line_segment(
                    [pos2(x, track.top()), pos2(x, axis + 3.0)],
                    Stroke::new(1.0, RULE_LINE),
                );
                p.text(
                    pos2(x, axis + 4.0),
                    Align2::CENTER_TOP,
                    format!("{}", s / TICKS_PER_SECOND),
                    FontId::proportional(11.0),
                    FAINT,
                );
            }

            for k in self.timeline.keys() {
                let dragged = self.drag.as_ref().filter(|d| d.id == k.id);
                let tick = dragged.map_or(k.tick, |d| d.to);
                let x0 = x_of(tick);
                let x1 = x_of(tick + self.timeline.span(k.id)).max(x0);
                let y = y_of(lane_of(&k.body));
                let picked = self.selected == Some(k.id);
                let hot = picked || hovered == Some(k.id);
                if dragged.is_some() && tick != k.tick {
                    // Where it was, until it's let go.
                    p.circle_stroke(pos2(x_of(k.tick), y), 4.0, Stroke::new(1.0, FAINT));
                }
                match &k.body {
                    Body::Stroke(st) => {
                        let color = swatch(st.brush);
                        if x1 - x0 > 1.0 {
                            p.line_segment(
                                [pos2(x0, y), pos2(x1, y)],
                                Stroke::new(4.0, color.gamma_multiply(0.6)),
                            );
                        }
                        p.circle_filled(pos2(x0, y), if hot { 5.5 } else { 4.0 }, color);
                    }
                    Body::Rule { on, .. } => {
                        let r = if hot { 6.5 } else { 5.0 };
                        let c = pos2(x0, y);
                        let pts = vec![
                            c + vec2(0.0, -r),
                            c + vec2(r, 0.0),
                            c + vec2(0.0, r),
                            c + vec2(-r, 0.0),
                        ];
                        let fill = if *on { DOT } else { PAPER };
                        p.add(Shape::convex_polygon(pts, fill, Stroke::new(1.2, DOT)));
                    }
                }
                if picked {
                    p.circle_stroke(pos2(x0, y), 8.5, Stroke::new(1.2, INK));
                }
            }

            let x = x_of(now);
            p.line_segment(
                [pos2(x, track.top() - 4.0), pos2(x, axis)],
                Stroke::new(1.5, INK),
            );
            p.circle_filled(pos2(x, track.top() - 4.0), 3.0, INK);
            if !self.timeline.caught_up() {
                // How far the canvas has been worked out so far.
                let shown = x_of(self.timeline.tick());
                p.line_segment(
                    [pos2(shown, track.top()), pos2(shown, axis)],
                    Stroke::new(1.0, DOT),
                );
            }
        });

        // What the picked (or hovered) keyframe is, in words.
        let about = self.selected.or(self.drag.as_ref().map(|d| d.id));
        let line = about.and_then(|id| self.timeline.key(id)).map(|k| {
            let at = k.tick as f32 / TICKS_PER_SECOND as f32;
            let what = match &k.body {
                Body::Stroke(s) => format!("{} stroke at {at:.2} s", s.brush.name()),
                Body::Rule { rule, on } => format!(
                    "“{}” switched {} at {at:.2} s",
                    self.timeline
                        .rules()
                        .get(rule)
                        .map_or(format!("{rule} (no such note)"), |n| n.title.clone()),
                    if *on { "on" } else { "off" }
                ),
            };
            format!("{what}  ·  drag to move, delete to remove, esc to let go")
        });
        ui.horizontal(|ui| {
            ui.add_space(24.0 + 120.0 + 64.0 + 8.0);
            ui.label(
                RichText::new(line.unwrap_or_default())
                    .size(14.0)
                    .color(MUTED),
            );
        });
        ui.add_space(6.0);
    }

    fn canvas(&mut self, ui: &mut egui::Ui) {
        let avail = ui.available_rect_before_wrap().shrink2(vec2(12.0, 6.0));
        let scale = (avail.width() / WIDTH).min(avail.height() / HEIGHT);
        let size = vec2(WIDTH, HEIGHT) * scale;
        let sheet = Rect::from_center_size(avail.center(), size);
        let to_screen = |p: glam::Vec2| sheet.min + vec2(p.x, p.y) * scale;
        let to_world = |p: Pos2| {
            let v = (p - sheet.min) / scale;
            glam::Vec2::new(v.x, v.y)
        };

        let response = ui.allocate_rect(sheet, Sense::drag());
        let pointer = response.hover_pos();
        self.marks.sheet(sheet);

        if response.hovered() {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            if scroll != 0.0 {
                self.radius = (self.radius * (scroll * 0.004).exp()).clamp(2.0, 24.0);
            }
            ui.ctx().set_cursor_icon(egui::CursorIcon::Crosshair);
        }

        // Painting: one keyframe per stroke, grown while the button is held.
        if response.drag_started_by(egui::PointerButton::Primary)
            && !self.selecting
            && let Some(p) = response.interact_pointer_pos()
        {
            self.selected = None;
            self.marks.fresh = false;
            let id = self
                .timeline
                .begin_stroke(self.brush, self.radius, to_world(p));
            self.painting = Some((id, p.to_vec2()));
        }
        if let Some((id, last)) = self.painting {
            if response.dragged_by(egui::PointerButton::Primary) {
                if let Some(p) = response.interact_pointer_pos()
                    && (self.playing || (p.to_vec2() - last).length() > 0.75)
                {
                    self.timeline.extend_stroke(id, to_world(p));
                    self.painting = Some((id, p.to_vec2()));
                }
            } else {
                self.timeline.end_stroke(id);
                self.painting = None;
            }
        }

        let painter = ui.painter_at(sheet);
        painter.rect(
            sheet,
            CornerRadius::same(10),
            SHEET,
            Stroke::new(1.0, RULE_LINE),
            egui::StrokeKind::Inside,
        );

        let state = self.timeline.state();
        // With a keyframe picked, what it made stands out: a stroke's own
        // particles, or everything a rule note's switch converted.
        let focus = self
            .selected
            .and_then(|id| self.timeline.key(id))
            .map(|k| match k.body {
                Body::Stroke(_) => MadeBy::Key(k.id),
                Body::Rule { ref rule, .. } => {
                    MadeBy::Rule(self.timeline.rules().index(rule).unwrap_or(usize::MAX))
                }
            });
        let mut hard = Mesh::with_texture(self.hard.id());
        let mut soft = Mesh::with_texture(self.soft.id());
        let mut glow = Mesh::with_texture(self.soft.id());
        for layer in 0..6 {
            for p in &state.particles {
                if draw_layer(p) != layer {
                    continue;
                }
                let (color, size, is_soft) = look(p);
                let color = match focus {
                    Some(made_by) if p.made_by != made_by => color.gamma_multiply(0.12),
                    _ => color,
                };
                let rect = Rect::from_center_size(to_screen(p.pos), Vec2::splat(size * 2.0 * scale));
                let uv = Rect::from_min_max(Pos2::ZERO, pos2(1.0, 1.0));
                let mesh = match (is_soft, p.material) {
                    (_, Material::Flame) => &mut glow,
                    (true, _) => &mut soft,
                    (false, _) => &mut hard,
                };
                mesh.add_rect_with_uv(rect, uv, color);
            }
        }
        painter.add(Shape::mesh(Arc::new(soft)));
        painter.add(Shape::mesh(Arc::new(hard)));
        painter.add(Shape::mesh(Arc::new(glow)));
        for m in &state.mimics {
            let dim = matches!(focus, Some(made_by) if m.made_by != made_by);
            draw_mimic(&painter, m, &to_screen, scale, dim);
        }

        if let Some(p) = pointer.filter(|_| !self.selecting) {
            let r = match self.brush {
                Brush::Smudge => self.radius * 2.5,
                Brush::Tree => self.radius * 2.0,
                _ => self.radius,
            } * scale;
            painter.circle_stroke(p, r.max(2.0), Stroke::new(1.0, FAINT));
        }

        // An empty note that's switched on is worth saying out loud.
        let inert: Vec<_> = self
            .timeline
            .rules()
            .notes
            .iter()
            .enumerate()
            .filter(|(i, r)| r.inert() && state.rules_on[*i])
            .map(|(_, r)| format!("“{}” is on but does nothing: nothing in it says what to do.", r.title))
            .collect();
        for (k, line) in inert.iter().enumerate() {
            painter.text(
                sheet.left_bottom() + vec2(16.0, -16.0 - k as f32 * 22.0),
                Align2::LEFT_BOTTOM,
                line,
                FontId::proportional(16.0),
                DOT,
            );
        }
        if state.particles.is_empty() && self.timeline.keys().next().is_none() {
            painter.text(
                sheet.center(),
                Align2::CENTER_CENTER,
                "Paint something.",
                FontId::proportional(26.0),
                FAINT,
            );
        }
    }
}

impl eframe::App for App {
    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        let (tool, radius) = (self.tool(), self.radius);
        self.marks.intercept(raw, tool, radius);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        // Rule files edited anywhere (here, or in another editor) take
        // effect within half a second.
        let now = ui.input(|i| i.time);
        if now - self.last_poll > 0.5 {
            self.last_poll = now;
            self.reload_rules();
        }
        ui.ctx()
            .request_repaint_after(std::time::Duration::from_millis(500));
        self.ide.begin_frame(ui.ctx());
        self.take_synced();
        self.marks.begin_frame();
        let selected = self.ide.term_selection();
        self.highlights
            .begin_frame(ui.ctx(), selected.as_ref(), self.ide.terminal_active());
        self.keyboard(ui);

        let top = egui::Panel::top("top").show(ui, |ui| self.top_bar(ui));
        self.marks.keep_clear(top.response.rect);
        if let Some(mut tab) = self.maximized.clone() {
            egui::CentralPanel::default().show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.add_space(8.0);
                    let esc = ui.input(|i| i.key_pressed(egui::Key::Escape))
                        && !self.ide.terminal_active()
                        && !self.ide.has_focus();
                    if quiet_link(ui, "back to the layout", false).clicked() || esc
                    {
                        self.maximized = None;
                    }
                });
                self.tab_ui(ui, &mut tab);
            });
        } else if let Some(mut dock) = self.dock.take() {
            let mut style = egui_dock::Style::from_egui(ui.style());
            style.tab_bar.bg_fill = PAPER;
            style.tab_bar.hline_color = RULE_LINE;
            style.tab.tab_body.bg_fill = PAPER;
            style.tab.tab_body.stroke = Stroke::NONE;
            style.tab.active.bg_fill = PAPER;
            style.tab.active.text_color = INK;
            style.tab.focused.bg_fill = PAPER;
            style.tab.focused.text_color = INK;
            style.tab.inactive.bg_fill = PAPER;
            style.tab.inactive.text_color = FAINT;
            style.tab.hovered.bg_fill = PAPER;
            style.tab.hovered.text_color = INK;
            style.separator.color_idle = RULE_LINE;
            style.separator.color_hovered = FAINT;
            style.separator.color_dragged = INK;
            style.overlay.selection_color = DOT.gamma_multiply(0.25);
            egui::CentralPanel::default()
                .frame(egui::Frame::NONE.fill(PAPER))
                .show(ui, |ui| {
                    DockArea::new(&mut dock)
                        .style(style)
                        .show_leaf_close_all_buttons(false)
                        .show_inside(ui, &mut Tabs { app: self });
                });
            for path in std::mem::take(&mut self.ide.open_requests) {
                let tab = Tab::File(path);
                if let Some(at) = dock.find_tab(&tab) {
                    let _ = dock.set_active_tab(at);
                } else {
                    if let Some(files) = dock.find_tab(&Tab::Files) {
                        dock.set_focused_node_and_surface(files.node_path());
                    }
                    dock.push_to_focused_leaf(tab);
                }
            }
            // Opening or following a terminal from its pane brings the files forward.
            if std::mem::take(&mut self.ide.reveal_files)
                && let Some(files) = dock.find_tab(&Tab::Files)
            {
                let _ = dock.set_active_tab(files);
            }
            self.dock = Some(dock);
        }
        if std::mem::take(&mut self.ide.reveal_files) && self.maximized == Some(Tab::Terminals) {
            self.maximized = None;
        }

        // Over everything: the "+" over a selection. What it keeps is a note.
        let selected = self.ide.term_selection();
        let source = self.ide.editing.clone();
        if let Some(h) = self.highlights.show(ui.ctx(), selected, source) {
            self.notebook.add(&h.to_note());
        }
        self.marks.keep_clear(self.highlights.plus_rect());

        // In front of that: what the green brush picked and the notes it
        // leads to, then every mark over its pane.
        self.marks.read_selection(ui.ctx());
        for note in self.tabnote.show(ui.ctx(), &mut self.marks) {
            self.notebook.add(&note);
        }
        let (tool, radius) = (self.tool(), self.radius);
        self.marks
            .show(ui.ctx(), self.hard.id(), self.soft.id(), tool, radius);

        self.run_clock(ui);
        self.take_shot(ui);

        if let Some(inner) = ui.input(|i| i.viewport().inner_rect) {
            let at = ui.input(|i| i.viewport().outer_rect).map(|r| r.min);
            self.window = (inner.size(), at);
        }
        if now - self.layout_at > LAYOUT_EVERY {
            self.layout_at = now;
            self.save_layout();
        }
    }

    fn on_exit(&mut self) {
        self.save_layout();
    }
}

impl App {
    fn tab_ui(&mut self, ui: &mut egui::Ui, tab: &mut Tab) {
        // Marks drawn here belong to this pane.
        let label = match &*tab {
            Tab::File(p) => p.display().to_string(),
            t => format!("{t:?}").to_lowercase(),
        };
        self.marks.pane(format!("{tab:?}"), ui.max_rect(), label);
        if *tab == Tab::Brushes {
            self.marks.keep_clear(ui.max_rect());
        }
        match tab {
            Tab::Canvas => self.canvas(ui),
            Tab::Brushes => self.palette(ui),
            Tab::Rules => {
                ui.add_space(4.0);
                egui::Frame::NONE
                    .inner_margin(egui::Margin::symmetric(12, 0))
                    .show(ui, |ui| self.notes(ui));
            }
            Tab::Timeline => self.timeline_bar(ui),
            Tab::Files => self.ide.files_ui(ui),
            Tab::Terminals => {
                egui::Frame::NONE
                    .inner_margin(egui::Margin::symmetric(12, 0))
                    .show(ui, |ui| self.ide.terminals_ui(ui));
            }
            Tab::Notes => {
                egui::Frame::NONE
                    .inner_margin(egui::Margin::symmetric(12, 0))
                    .show(ui, |ui| self.notebook.ui(ui));
            }
            Tab::File(path) => {
                let path = path.clone();
                self.ide.editor_ui(ui, &path);
            }
        }
    }

    fn take_shot(&mut self, ui: &egui::Ui) {
        let Some((path, at, asked)) = &mut self.shot else {
            return;
        };
        if !*asked && self.timeline.tick() >= *at {
            self.playing = false;
            *asked = true;
            ui.ctx()
                .send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
        }
        let image = ui.input(|i| {
            i.raw.events.iter().find_map(|e| match e {
                egui::Event::Screenshot { image, .. } => Some(image.clone()),
                _ => None,
            })
        });
        if let Some(image) = image {
            let [w, h] = image.size;
            let bytes: Vec<u8> = image.pixels.iter().flat_map(|c| c.to_array()).collect();
            let file = std::io::BufWriter::new(std::fs::File::create(&*path).unwrap());
            let mut png = png::Encoder::new(file, w as u32, h as u32);
            png.set_color(png::ColorType::Rgba);
            png.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
            png.write_header().unwrap().write_image_data(&bytes).unwrap();
            ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
        }
        ui.ctx().request_repaint();
    }
}

/// Paint order, back to front.
fn draw_layer(p: &Particle) -> u8 {
    match p.material {
        Material::Water => 0,
        Material::Tree if p.trunk => 1,
        Material::Tree => 2,
        Material::Ink => 3,
        Material::Ash => 4,
        Material::Fire | Material::Flame => 5,
    }
}

/// Colour, drawn radius, and whether to use the soft dot.
fn look(p: &Particle) -> (Color32, f32, bool) {
    let shade = p.shade();
    match p.material {
        Material::Ink if p.wet > 0.05 => (rgba(40, 52, 78, 170), p.radius * 1.1, true),
        Material::Ink => (rgba(22, 25, 27, 235), p.radius, false),
        Material::Water => (rgba(74, 127, 193, 150), 12.0, true),
        Material::Tree if p.trunk => (rgba(107, 74, 47, 255), p.radius, false),
        Material::Tree => {
            let green = mix([79, 122, 58], [52, 92, 45], shade);
            let c = mix(green, [168, 112, 40], (p.heat).clamp(0.0, 1.0));
            (rgba(c[0], c[1], c[2], 240), p.radius * 1.15, false)
        }
        Material::Fire => {
            let flicker = 0.85 + 0.15 * ((p.age as f32 * 0.7 + shade * 9.0).sin());
            (rgba(232, 73, 42, 235), p.radius * 1.2 * flicker, false)
        }
        Material::Flame => {
            let a = p.age as f32 / TICKS_PER_SECOND as f32;
            let (c, alpha) = if a < 0.25 {
                (mix([255, 214, 110], [244, 140, 38], a / 0.25), 230.0)
            } else if a < 0.55 {
                (mix([244, 140, 38], [200, 64, 30], (a - 0.25) / 0.3), 190.0)
            } else {
                (mix([200, 64, 30], [130, 126, 120], ((a - 0.55) / 0.4).min(1.0)), 110.0)
            };
            (rgba(c[0], c[1], c[2], alpha as u8), p.radius * (1.25 + a * 1.4), true)
        }
        Material::Ash => {
            let c = mix([96, 94, 90], [140, 137, 131], shade);
            (rgba(c[0], c[1], c[2], 230), p.radius, false)
        }
    }
}

fn swatch(brush: Brush) -> Color32 {
    match brush {
        Brush::Ink => INK,
        Brush::Water => Color32::from_rgb(74, 127, 193),
        Brush::Tree => Color32::from_rgb(79, 122, 58),
        Brush::Fire => DOT,
        Brush::Smudge => Color32::from_rgb(190, 186, 178),
        Brush::Mimic => Color32::from_rgb(122, 76, 196),
    }
}

/// A mimic: inky tentacles, thick at the root and fine at the tip, with
/// colour running along them as dots, and its core on top.
fn draw_mimic(painter: &egui::Painter, m: &Mimic, to_screen: &impl Fn(glam::Vec2) -> Pos2, scale: f32, dim: bool) {
    let fade = |c: Color32| if dim { c.gamma_multiply(0.12) } else { c };
    let ink = |c: [f32; 3], a: u8| fade(rgba((c[0] * 255.0) as u8, (c[1] * 255.0) as u8, (c[2] * 255.0) as u8, a));
    let line = fade(rgba(22, 25, 27, 255));
    for arm in &m.arms {
        let pts: Vec<Pos2> = arm.points.iter().map(|p| to_screen(*p)).collect();
        for (i, w) in pts.windows(2).enumerate() {
            let f = i as f32 / (SEGS - 1) as f32;
            let width = (m.size * 0.5 * (1.0 - f) + 0.6) * scale;
            painter.line_segment([w[0], w[1]], Stroke::new(width.max(0.8), line));
            painter.circle_filled(w[1], width * 0.5, line);
        }
        for pulse in &arm.pulses {
            let at = pulse.at.clamp(0.0, 1.0) * (SEGS - 1) as f32;
            let i = (at as usize).min(SEGS - 2);
            let p = pts[i].lerp(pts[i + 1], at - i as f32);
            painter.circle_filled(p, (m.size * 0.42 * scale).max(2.0), ink(pulse.color, 240));
        }
    }
    // The core bulges as it takes colour in.
    let r = m.size * (1.0 + 0.3 * m.jiggle.clamp(-1.0, 1.0)) * scale;
    let c = to_screen(m.core);
    painter.circle_filled(c, r * 1.12, line);
    painter.circle_filled(c, r, ink(m.color, 255));
}

fn rgba(r: u8, g: u8, b: u8, a: u8) -> Color32 {
    Color32::from_rgba_unmultiplied(r, g, b, a)
}

fn mix(a: [u8; 3], b: [u8; 3], t: f32) -> [u8; 3] {
    let t = t.clamp(0.0, 1.0);
    std::array::from_fn(|i| (a[i] as f32 + (b[i] as f32 - a[i] as f32) * t) as u8)
}

/// Plain italic text that darkens under the pointer, like the AJAX page's
/// links. `strong` keeps it dark.
fn quiet_link(ui: &mut egui::Ui, text: &str, strong: bool) -> egui::Response {
    let galley = ui.painter().layout_no_wrap(
        text.to_owned(),
        FontId::proportional(19.0),
        Color32::PLACEHOLDER,
    );
    let (rect, response) = ui.allocate_exact_size(galley.size() + vec2(4.0, 8.0), Sense::click());
    let color = if strong || response.hovered() {
        INK
    } else {
        FAINT
    };
    ui.painter()
        .galley(rect.min + vec2(2.0, 4.0), galley, color);
    if strong && !matches!(text, "play" | "pause") || response.hovered() {
        let y = rect.bottom() - 2.0;
        ui.painter().line_segment(
            [pos2(rect.left() + 2.0, y), pos2(rect.right() - 2.0, y)],
            Stroke::new(1.0, color),
        );
    }
    if response.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    response
}

fn title(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("title".into()))
}

/// A round dot, white with alpha falling off from `core` (0..1) outward.
fn dot_texture(ctx: &egui::Context, name: &str, core: f32) -> TextureHandle {
    let n = 64;
    let mut rgba = Vec::with_capacity(n * n * 4);
    for y in 0..n {
        for x in 0..n {
            let d = vec2(x as f32 + 0.5, y as f32 + 0.5) / n as f32 * 2.0 - vec2(1.0, 1.0);
            let r = d.length();
            let a = if r >= 1.0 {
                0.0
            } else if r <= core {
                1.0
            } else {
                let t = (r - core) / (1.0 - core);
                let s = 1.0 - t;
                s * s * (3.0 - 2.0 * s)
            };
            rgba.extend_from_slice(&[255, 255, 255, (a * 255.0) as u8]);
        }
    }
    let image = egui::ColorImage::from_rgba_unmultiplied([n, n], &rgba);
    ctx.load_texture(name, image, egui::TextureOptions::LINEAR)
}

/// IBM Plex Serif italic stands in for the AJAX page's Sabon italic. If it
/// isn't installed, egui's own font is used.
fn install_fonts(ctx: &egui::Context) {
    const DIR: &str = "/usr/share/fonts/truetype/ibm-plex";
    let mut fonts = egui::FontDefinitions::default();
    let body = std::fs::read(format!("{DIR}/IBMPlexSerif-Italic.ttf"));
    let head = std::fs::read(format!("{DIR}/IBMPlexSerif-SemiBoldItalic.ttf"));
    if let Ok(bytes) = body {
        fonts.font_data.insert(
            "serif".into(),
            Arc::new(egui::FontData::from_owned(bytes)),
        );
        fonts
            .families
            .entry(FontFamily::Proportional)
            .or_default()
            .insert(0, "serif".into());
    }
    let mut title = fonts.families[&FontFamily::Proportional].clone();
    if let Ok(bytes) = head {
        fonts.font_data.insert(
            "serif-title".into(),
            Arc::new(egui::FontData::from_owned(bytes)),
        );
        title.insert(0, "serif-title".into());
    }
    fonts
        .families
        .insert(FontFamily::Name("title".into()), title);
    ctx.set_fonts(fonts);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panes_travel_without_this_screen() {
        let mut dock = default_layout();
        let file = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/main.rs");
        dock.push_to_first_leaf(Tab::File(file.clone()));
        let shared = dock.filter_map_tabs(|t| Some(shared_tab(t)));
        assert!(shared.find_tab(&Tab::File("@tapestry/apps/canvas/src/main.rs".into())).is_some());
        let panes = |rect_x: f32| {
            let mut v = serde_json::to_value(Panes {
                dock: shared.clone(),
                maximized: None,
                root: "@tapestry".into(),
                here: "@tapestry".into(),
            })
            .unwrap();
            // Pretend a pane sat somewhere on this screen.
            v["dock"]["surfaces"][0]["Main"]["nodes"][0]["Vertical"]["rect"]["min"]["x"] = rect_x.into();
            forget_rects(&mut v);
            v
        };
        assert_eq!(panes(0.0), panes(500.0));
        let back: Panes = serde_json::from_value(panes(500.0)).unwrap();
        let local = back.dock.filter_map_tabs(|t| Some(local_tab(t)));
        assert!(local.find_tab(&Tab::File(file)).is_some());
        assert!(local.find_tab(&Tab::Notes).is_some());
    }
}
