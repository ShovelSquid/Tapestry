//! Marks: the canvas brushes, drawn on any pane of the app.
//!
//! Hold Option and drag anywhere, or switch on "draw anywhere", and the
//! brush draws over whatever pane you start on. The mark belongs to that
//! pane: it moves and clips with it, and is drawn above everything. Smudge
//! rubs marks out. Marks here don't live like the canvas's particles; they
//! stay as drawn.
//!
//! The green select brush draws nothing. What it passes over is selected,
//! whatever drew the text (labels, cards, terminals, the timeline), and the
//! desktop-note tab from the Kubuntu spike peeks out at the end of the
//! stroke (see `tabnote.rs`).
//!
//! Marks are kept in `~/.local/state/tapestry/marks.jsonl`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use eframe::egui;
use egui::{Color32, Id, LayerId, Mesh, Order, Pos2, Rect, Shape, Stroke, TextureId, Vec2, pos2};
use tapestry_canvas::Brush;

use crate::{DOT, FAINT, INK, rgba, swatch};

/// The select brush's green: the Kubuntu spikes' `#2ecc71`.
pub const SELECT: Color32 = crate::tabnote::GREEN;

/// What the brush does outside the canvas.
#[derive(Clone, Copy, PartialEq)]
pub enum Tool {
    Paint(Brush),
    Select,
}

struct Mark {
    /// The pane it was drawn on.
    pane: String,
    brush: Brush,
    radius: f32,
    /// Offsets from the pane's top-left corner.
    points: Vec<Vec2>,
}

/// A stroke being drawn, in screen points.
struct Live {
    tool: Tool,
    radius: f32,
    pane: Option<String>,
    points: Vec<Pos2>,
}

/// Text the select brush passed over.
pub struct Picked {
    pub text: String,
    /// The pane it was picked from.
    pub source: String,
    /// Where the stroke ended: the note's tab peeks out there.
    pub end: Pos2,
    /// The stretches of text that were picked, to tint.
    pub runs: Vec<Rect>,
}

struct Pane {
    rect: Rect,
    /// What it's called in a highlight's source.
    label: String,
}

pub struct Marks {
    marks: Vec<Mark>,
    live: Option<Live>,
    /// Draw with any press, not only with Option held.
    pub anywhere: bool,
    /// Panes drawn this frame, and last frame (input arrives before panes
    /// are laid out, so it goes by where they were).
    panes: HashMap<String, Pane>,
    last: HashMap<String, Pane>,
    /// Presses here go to the app, not the brush: the brushes pane, the top
    /// bar, the "+", the highlights list. Last frame's.
    keep_clear: Vec<Rect>,
    clear_now: Vec<Rect>,
    /// The canvas sheet paints for itself (but doesn't select).
    sheet: Option<Rect>,
    sheet_now: Option<Rect>,
    /// The select stroke that just ended, to read once the panes are drawn.
    finished: Option<Live>,
    pub picked: Option<Picked>,
    /// The last thing drawn was a mark, so Cmd+Z takes it back.
    pub fresh: bool,
    alt: bool,
    pointer: Option<Pos2>,
}

impl Marks {
    pub fn new() -> Self {
        Self {
            marks: load(),
            live: None,
            anywhere: false,
            panes: HashMap::new(),
            last: HashMap::new(),
            keep_clear: Vec::new(),
            clear_now: Vec::new(),
            sheet: None,
            sheet_now: None,
            finished: None,
            picked: None,
            fresh: false,
            alt: false,
            pointer: None,
        }
    }

    /// Before egui sees the input: presses that start a mark are taken out,
    /// so nothing under the brush clicks or drags.
    pub fn intercept(&mut self, raw: &mut egui::RawInput, tool: Tool, radius: f32) {
        let mut keep = Vec::with_capacity(raw.events.len());
        for event in std::mem::take(&mut raw.events) {
            match &event {
                egui::Event::ModifiersChanged(m) => self.alt = m.alt,
                egui::Event::Key { modifiers, key, pressed, .. }
                    if !(*key == egui::Key::Escape && *pressed && (self.anywhere || self.picked.is_some())) =>
                {
                    self.alt = modifiers.alt
                }
                egui::Event::PointerMoved(p) => {
                    self.pointer = Some(*p);
                    self.extend(*p);
                }
                egui::Event::PointerGone => self.pointer = None,
                egui::Event::PointerButton {
                    pos,
                    button: egui::PointerButton::Primary,
                    pressed: true,
                    modifiers,
                } if (modifiers.alt || self.anywhere) && self.takes(*pos, tool) => {
                    self.picked = None;
                    self.live = Some(Live {
                        tool,
                        radius,
                        pane: self.pane_at(*pos),
                        points: vec![*pos],
                    });
                    self.extend(*pos);
                    continue;
                }
                egui::Event::PointerButton {
                    pos,
                    button: egui::PointerButton::Primary,
                    pressed: false,
                    ..
                } if self.live.is_some() => {
                    self.extend(*pos);
                    self.finish();
                    continue;
                }
                egui::Event::PointerButton { pos, pressed: true, .. }
                    if !self.keep_clear.iter().any(|r| r.contains(*pos)) =>
                {
                    self.picked = None
                }
                egui::Event::Key {
                    key: egui::Key::Escape,
                    pressed: true,
                    ..
                } if self.anywhere || self.picked.is_some() => {
                    self.anywhere = false;
                    self.picked = None;
                    continue;
                }
                _ => {}
            }
            keep.push(event);
        }
        raw.events = keep;
    }

    /// Whether a press here starts a mark.
    fn takes(&self, p: Pos2, tool: Tool) -> bool {
        if self.keep_clear.iter().any(|r| r.contains(p)) {
            return false;
        }
        // The canvas paints its own strokes into the world.
        !(matches!(tool, Tool::Paint(_)) && self.sheet.is_some_and(|s| s.contains(p)))
    }

    fn pane_at(&self, p: Pos2) -> Option<String> {
        self.last
            .iter()
            .filter(|(_, pane)| pane.rect.contains(p))
            // Nested panes (a torn-off window over the dock): the smallest.
            .min_by(|a, b| a.1.rect.area().total_cmp(&b.1.rect.area()))
            .map(|(k, _)| k.clone())
    }

    fn extend(&mut self, p: Pos2) {
        let Some(live) = &mut self.live else { return };
        if live.points.last().is_some_and(|q| q.distance(p) < 1.5) {
            return;
        }
        live.points.push(p);
        if live.tool == Tool::Paint(Brush::Smudge) {
            let (pane, r) = (live.pane.clone(), live.radius * 2.5);
            let origin = pane.as_ref().and_then(|k| self.last.get(k)).map_or(Pos2::ZERO, |p| p.rect.min);
            let before = self.marks.len();
            self.marks.retain(|m| {
                Some(&m.pane) != pane.as_ref()
                    || m.points.iter().all(|q| (origin + *q).distance(p) > r + m.radius)
            });
            if self.marks.len() != before {
                save(&self.marks);
            }
        }
    }

    fn finish(&mut self) {
        let Some(live) = self.live.take() else { return };
        match live.tool {
            Tool::Select => self.finished = Some(live),
            Tool::Paint(Brush::Smudge) => {}
            Tool::Paint(brush) => {
                let pane = live.pane.unwrap_or_else(|| "screen".into());
                let origin = self.last.get(&pane).map_or(Pos2::ZERO, |p| p.rect.min);
                self.marks.push(Mark {
                    pane,
                    brush,
                    radius: live.radius,
                    points: live.points.iter().map(|p| *p - origin).collect(),
                });
                self.fresh = true;
                save(&self.marks);
            }
        }
    }

    /// Take back the last mark.
    pub fn undo(&mut self) -> bool {
        if !std::mem::take(&mut self.fresh) || self.marks.pop().is_none() {
            return false;
        }
        save(&self.marks);
        true
    }

    pub fn begin_frame(&mut self) {
        self.last = std::mem::take(&mut self.panes);
        self.keep_clear = std::mem::take(&mut self.clear_now);
        self.sheet = self.sheet_now.take();
    }

    /// A pane was drawn here this frame.
    pub fn pane(&mut self, key: String, rect: Rect, label: String) {
        self.panes.insert(key, Pane { rect, label });
    }

    /// Presses here this frame belong to the app.
    pub fn keep_clear(&mut self, rect: Rect) {
        self.clear_now.push(rect);
    }

    pub fn sheet(&mut self, rect: Rect) {
        self.sheet_now = Some(rect);
    }

    /// Whether the brush would draw if pressed now.
    pub fn armed(&self) -> bool {
        self.live.is_some() || self.anywhere || self.alt
    }

    /// A stroke is being drawn.
    pub fn drawing(&self) -> bool {
        self.live.is_some()
    }

    /// Once every pane is drawn: read what the select brush passed over.
    pub fn read_selection(&mut self, ctx: &egui::Context) {
        let live = match (&self.live, &self.finished) {
            (Some(l), _) if l.tool == Tool::Select => l,
            (_, Some(l)) => l,
            _ => return,
        };
        let source = live
            .pane
            .as_ref()
            .and_then(|k| self.panes.get(k).or(self.last.get(k)))
            .map_or_else(|| "tapestry".to_owned(), |p| p.label.clone());
        let end = *live.points.last().unwrap();
        let (text, runs) = text_under(ctx, &live.points, live.radius.max(6.0));
        if self.finished.take().is_some() {
            self.picked = (!text.trim().is_empty()).then_some(Picked { text, source, end, runs });
        } else {
            self.picked = Some(Picked { text, source, end, runs });
        }
    }

    /// Draw every mark over its pane, in front of everything.
    pub fn show(&self, ctx: &egui::Context, hard: TextureId, soft: TextureId, tool: Tool, radius: f32) {
        let painter = ctx.layer_painter(LayerId::new(Order::Tooltip, Id::new("marks")));
        let time = ctx.input(|i| i.time) as f32;
        let mut fire = false;
        for m in &self.marks {
            let Some(pane) = self.panes.get(&m.pane) else { continue };
            let points: Vec<Pos2> = m.points.iter().map(|q| pane.rect.min + *q).collect();
            fire |= m.brush == Brush::Fire;
            painter
                .with_clip_rect(pane.rect)
                .extend(stroke_shapes(m.brush, m.radius, &points, hard, soft, time));
        }
        if let Some(live) = &self.live {
            let clip = live.pane.as_ref().and_then(|k| self.last.get(k)).map_or(ctx.content_rect(), |p| p.rect);
            match live.tool {
                Tool::Paint(Brush::Smudge) => {}
                Tool::Paint(brush) => {
                    painter
                    .with_clip_rect(clip)
                        .extend(stroke_shapes(brush, live.radius, &live.points, hard, soft, time));
                }
                Tool::Select => {
                    painter.add(Shape::line(
                        live.points.clone(),
                        Stroke::new(live.radius.max(6.0) * 2.0, SELECT.gamma_multiply(0.35)),
                    ));
                }
            }
        }
        if let Some(p) = &self.picked {
            let tint = ctx.layer_painter(LayerId::new(Order::Foreground, Id::new("marks-picked")));
            for r in &p.runs {
                tint.rect_filled(r.expand2(Vec2::new(1.0, 0.0)), 3.0, SELECT.gamma_multiply(0.22));
            }
        }
        // Where the brush is, when it would draw.
        if self.armed()
            && let Some(at) = self.pointer
            && !self.keep_clear.iter().any(|r| r.contains(at))
        {
            let (r, color) = match tool {
                Tool::Select => (radius.max(6.0), SELECT),
                Tool::Paint(Brush::Smudge) => (radius * 2.5, FAINT),
                Tool::Paint(b) => (radius, swatch(b)),
            };
            painter.circle_stroke(at, r.max(2.0), Stroke::new(1.2, color));
            ctx.set_cursor_icon(egui::CursorIcon::Crosshair);
        }
        if fire || self.live.is_some() {
            ctx.request_repaint();
        }
    }
}

/// A stroke drawn as the canvas draws its particles: soft or hard dots
/// close together along the line.
fn stroke_shapes(
    brush: Brush,
    radius: f32,
    points: &[Pos2],
    hard: TextureId,
    soft: TextureId,
    time: f32,
) -> Vec<Shape> {
    let (texture, size, step, color) = match brush {
        Brush::Ink => (hard, radius.max(1.5), 0.3, INK),
        Brush::Water => (soft, radius * 1.8, 0.35, rgba(74, 127, 193, 150)),
        Brush::Tree => (hard, radius * 0.9, 0.45, swatch(Brush::Tree)),
        Brush::Fire => (soft, radius * 1.4, 0.4, DOT),
        // Mimics live only on the canvas.
        Brush::Smudge | Brush::Mimic => return Vec::new(),
    };
    let mut mesh = Mesh::with_texture(texture);
    let uv = Rect::from_min_max(Pos2::ZERO, pos2(1.0, 1.0));
    let gap = (size * step).max(0.75);
    let mut n = 0u32;
    let mut dot = |c: Pos2| {
        n += 1;
        let (s, color) = match brush {
            // Flames flicker, each at its own pace.
            Brush::Fire => {
                let w = (time * 9.0 + n as f32 * 1.7).sin() * 0.5 + 0.5;
                (size * (0.8 + 0.4 * w), color.gamma_multiply(0.55 + 0.45 * w))
            }
            _ => (size, color),
        };
        mesh.add_rect_with_uv(Rect::from_center_size(c, Vec2::splat(s * 2.0)), uv, color);
    };
    match points {
        [] => {}
        [p] => dot(*p),
        _ => {
            for w in points.windows(2) {
                let (a, b) = (w[0], w[1]);
                let steps = (a.distance(b) / gap).ceil().max(1.0) as usize;
                for k in 0..steps {
                    dot(a.lerp(b, k as f32 / steps as f32));
                }
            }
            dot(*points.last().unwrap());
        }
    }
    vec![Shape::mesh(Arc::new(mesh))]
}

/// Every bit of text drawn this frame that the stroke passed over, in
/// reading order, with the stretches it covered.
fn text_under(ctx: &egui::Context, stroke: &[Pos2], reach: f32) -> (String, Vec<Rect>) {
    let bounds = Rect::from_points(stroke).expand(reach);
    let near = |r: Rect| {
        let c = r.center();
        let reach = reach + r.height() * 0.25;
        match stroke {
            [p] => p.distance(c) <= reach,
            _ => stroke.windows(2).any(|w| segment_distance(c, w[0], w[1]) <= reach),
        }
    };
    let mut layers: Vec<LayerId> = ctx.memory(|m| m.areas().visible_layer_ids()).into_iter().collect();
    layers.push(LayerId::background());
    layers.sort_by_key(|l| (l.order, l.id.value()));
    layers.dedup();
    // One run per row of text touched: (rect, text).
    let mut runs: Vec<(Rect, String)> = Vec::new();
    ctx.graphics(|g| {
        for layer in &layers {
            if layer.id == Id::new("marks") || layer.id == Id::new("marks-picked") {
                continue;
            }
            let Some(list) = g.get(*layer) else { continue };
            for clipped in list.all_entries() {
                visit(&clipped.shape, &mut |text| {
                    let galley_rect = text.galley.rect.translate(text.pos.to_vec2());
                    if !galley_rect.intersects(bounds) || !clipped.clip_rect.intersects(bounds) {
                        return;
                    }
                    for row in &text.galley.rows {
                        let row_rect = row.rect().translate(text.pos.to_vec2());
                        if !row_rect.intersects(bounds) {
                            continue;
                        }
                        let glyph = |g: &egui::epaint::text::Glyph| {
                            let x = text.pos.x + row.pos.x + g.pos.x;
                            Rect::from_x_y_ranges(x..=x + g.advance_width, row_rect.y_range())
                        };
                        let hit: Vec<usize> = row
                            .glyphs
                            .iter()
                            .enumerate()
                            .filter(|(_, g)| {
                                let r = glyph(g);
                                clipped.clip_rect.intersects(r) && near(r)
                            })
                            .map(|(i, _)| i)
                            .collect();
                        let (Some(&a), Some(&b)) = (hit.first(), hit.last()) else { continue };
                        let s: String = row.glyphs[a..=b].iter().map(|g| g.chr).collect();
                        let r = glyph(&row.glyphs[a]).union(glyph(&row.glyphs[b]));
                        if !s.trim().is_empty() {
                            runs.push((r, s));
                        }
                    }
                });
            }
        }
    });
    // Bold terminal text is drawn twice, a hair apart.
    runs.sort_by(|a, b| {
        (a.0.center().y, a.0.left()).partial_cmp(&(b.0.center().y, b.0.left())).unwrap()
    });
    runs.dedup_by(|b, a| a.1 == b.1 && a.0.center().distance(b.0.center()) < 2.0);
    let mut text = String::new();
    let mut last: Option<Rect> = None;
    for (r, s) in &runs {
        if let Some(l) = last {
            let same_line = (r.center().y - l.center().y).abs() < l.height().min(r.height()) * 0.5;
            text.push_str(if !same_line {
                "\n"
            } else if r.left() - l.right() > 2.0 {
                " "
            } else {
                ""
            });
        }
        text.push_str(s.trim_end());
        last = Some(*r);
    }
    (text, runs.into_iter().map(|(r, _)| r).collect())
}

fn visit(shape: &Shape, f: &mut impl FnMut(&egui::epaint::TextShape)) {
    match shape {
        Shape::Text(t) => f(t),
        Shape::Vec(v) => v.iter().for_each(|s| visit(s, f)),
        _ => {}
    }
}

fn segment_distance(p: Pos2, a: Pos2, b: Pos2) -> f32 {
    let ab = b - a;
    let t = if ab.length_sq() == 0.0 { 0.0 } else { ((p - a).dot(ab) / ab.length_sq()).clamp(0.0, 1.0) };
    p.distance(a + ab * t)
}

fn file() -> Option<PathBuf> {
    crate::ide::state_dir().map(|d| d.join("marks.jsonl"))
}

fn load() -> Vec<Mark> {
    let Some(text) = file().and_then(|f| std::fs::read_to_string(f).ok()) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|v| {
            let name = v.get("brush")?.as_str()?;
            Some(Mark {
                pane: v.get("pane")?.as_str()?.to_owned(),
                brush: Brush::ALL.into_iter().find(|b| b.name() == name)?,
                radius: v.get("radius")?.as_f64()? as f32,
                points: v
                    .get("points")?
                    .as_array()?
                    .iter()
                    .filter_map(|p| Some(Vec2::new(p.get(0)?.as_f64()? as f32, p.get(1)?.as_f64()? as f32)))
                    .collect(),
            })
        })
        .collect()
}

fn save(marks: &[Mark]) {
    let Some(path) = file() else { return };
    let lines: String = marks
        .iter()
        .map(|m| {
            let points: Vec<[f32; 2]> = m.points.iter().map(|p| [p.x, p.y]).collect();
            serde_json::json!({ "pane": m.pane, "brush": m.brush.name(), "radius": m.radius, "points": points })
                .to_string()
                + "\n"
        })
        .collect();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(e) = std::fs::write(&path, lines) {
        eprintln!("couldn't keep marks: {e}");
    }
}
