//! What the green select brush leads to: the desktop-note UI from the
//! Kubuntu spikes (021 guide ring, 023 edge tab), inside the app.
//!
//! What was selected gets the guide's pulsing green ring. A green sliver
//! peeks out where the stroke ended; near it, it shows "+"; over it, it
//! becomes "+  new note". Click it, or drag a note out of it and drop it
//! anywhere, and a note opens there with the selection in it and "On:"
//! naming the pane it came from. Save puts it in the notes pane.

use eframe::egui;
use egui::{Align2, Color32, CornerRadius, FontId, Id, Order, Pos2, Rect, RichText, Sense, Stroke, Vec2, pos2, vec2};

use crate::marks::{Marks, Picked};

/// The spike's green, `#2ecc71`.
pub const GREEN: Color32 = Color32::from_rgb(0x2e, 0xcc, 0x71);
const NOTE_FILL: Color32 = Color32::from_rgb(0xf7, 0xf3, 0xd6);
const NOTE_SIZE: Vec2 = vec2(280.0, 190.0);
/// The spike's tab animates over 140 ms.
const EASE: f32 = 0.14;

struct Placed {
    id: u64,
    pos: Pos2,
    on: String,
    text: String,
    focus: bool,
}

pub struct TabNote {
    notes: Vec<Placed>,
    next: u64,
    dragging: bool,
    tab: Rect,
}

impl Default for TabNote {
    fn default() -> Self {
        Self { notes: Vec::new(), next: 0, dragging: false, tab: Rect::NOTHING }
    }
}

impl TabNote {
    /// Draw the ring, the tab and any open notes. Returns notes to keep.
    pub fn show(&mut self, ctx: &egui::Context, marks: &mut Marks) -> Vec<String> {
        if let Some(picked) = marks.picked.take() {
            if !marks.drawing() {
                ring(ctx, &picked);
            }
            match self.tab(ctx, &picked, marks).filter(|_| !marks.drawing()) {
                Some(note) => self.notes.push(note),
                None => marks.picked = Some(picked),
            }
        } else {
            self.dragging = false;
        }
        self.placed(ctx, marks)
    }

    /// The sliver at the stroke's end. Returns a note when one is pulled out.
    fn tab(&mut self, ctx: &egui::Context, picked: &Picked, marks: &mut Marks) -> Option<Placed> {
        let pointer = ctx.input(|i| i.pointer.hover_pos());
        let near = pointer.is_some_and(|p| p.distance(picked.end) < 70.0) || self.dragging;
        let over = pointer.is_some_and(|p| self.tab.expand(4.0).contains(p)) || self.dragging;
        let ease = |name: &str, target: f32| ctx.animate_value_with_time(Id::new(("tabnote", name)), target, EASE);
        let w = ease("w", if over { 150.0 } else if near { 90.0 } else { 56.0 });
        let h = ease("h", if over { 40.0 } else if near { 18.0 } else { 6.0 });
        let fill = ease("a", if over { 1.0 } else if near { 0.8 } else { 0.53 });
        // Centred under where the stroke ended, clear of the text it picked.
        let top = picked.runs.iter().map(|r| r.bottom()).fold(picked.end.y, f32::max) + 8.0;
        let rect = Rect::from_min_size(pos2(picked.end.x - w / 2.0, top), vec2(w, h));
        // Keep the brush off it, and off the room it grows into.
        marks.keep_clear(Rect::from_min_size(pos2(picked.end.x - 80.0, top - 4.0), vec2(160.0, 52.0)));
        let mut placed = None;
        egui::Area::new(Id::new("tabnote-tab"))
            .order(Order::Foreground)
            .fixed_pos(rect.min)
            .show(ctx, |ui| {
                let (rect, resp) = ui.allocate_exact_size(rect.size(), Sense::click_and_drag());
                self.tab = rect;
                let p = ui.painter();
                p.rect_filled(rect, CornerRadius::same((h / 2.0) as u8), GREEN.gamma_multiply(fill));
                let label = if self.dragging {
                    "drop anywhere"
                } else if over && w > 140.0 {
                    "+  new note"
                } else if near && h > 14.0 {
                    "+"
                } else {
                    ""
                };
                let size = if label == "+" { 14.0 } else { 15.0 };
                p.text(rect.center(), Align2::CENTER_CENTER, label, FontId::proportional(size), Color32::WHITE);
                if resp.hovered() {
                    ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                }
                if resp.drag_started() {
                    self.dragging = true;
                }
                let at = resp.interact_pointer_pos().or(pointer);
                if self.dragging && let Some(at) = at {
                    ghost(ui.ctx(), at);
                }
                if resp.drag_stopped() {
                    self.dragging = false;
                    // Let go by the tab: no note.
                    if let Some(at) = at
                        && at.distance(rect.center()) > 60.0
                    {
                        placed = Some(at - vec2(NOTE_SIZE.x / 2.0, 20.0));
                    }
                } else if resp.clicked() {
                    placed = Some(pos2(rect.center().x - NOTE_SIZE.x / 2.0, rect.bottom() + 10.0));
                }
            });
        if w < 149.0 || h < 39.0 {
            ctx.request_repaint();
        }
        let pos = placed?;
        self.next += 1;
        Some(Placed {
            id: self.next,
            pos: clamp(ctx, pos),
            on: picked.source.clone(),
            text: picked.text.clone() + "\n\n",
            focus: true,
        })
    }

    /// Open notes, each where it was dropped. Returns the ones saved.
    fn placed(&mut self, ctx: &egui::Context, marks: &mut Marks) -> Vec<String> {
        let mut saved = Vec::new();
        self.notes.retain_mut(|note| {
            let mut keep = true;
            let area = egui::Area::new(Id::new(("tabnote", note.id)))
                .order(Order::Foreground)
                .current_pos(note.pos)
                .movable(true)
                .show(ctx, |ui| {
                    egui::Frame::new()
                        .fill(NOTE_FILL)
                        .stroke(Stroke::new(2.0, GREEN))
                        .corner_radius(CornerRadius::same(10))
                        .inner_margin(egui::Margin::same(10))
                        .show(ui, |ui| {
                            ui.set_width(NOTE_SIZE.x - 20.0);
                            ui.label(RichText::new(format!("On: {}", note.on)).color(Color32::from_gray(0x77)).size(11.0));
                            let edit = egui::TextEdit::multiline(&mut note.text)
                                .frame(egui::Frame::NONE)
                                .hint_text("Write anything…")
                                .text_color(Color32::from_gray(0x22))
                                .font(egui::FontSelection::FontId(FontId::proportional(14.0)))
                                .desired_width(f32::INFINITY)
                                .desired_rows(5)
                                .show(ui);
                            if std::mem::take(&mut note.focus) {
                                edit.response.request_focus();
                                let end = egui::text::CCursor::new(note.text.chars().count());
                                let mut state = edit.state;
                                state.cursor.set_char_range(Some(egui::text::CCursorRange::one(end)));
                                state.store(ui.ctx(), edit.response.id);
                            }
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                let save = egui::Button::new(RichText::new("Save").color(Color32::WHITE).strong())
                                    .fill(GREEN)
                                    .corner_radius(CornerRadius::same(6));
                                if ui.add(save).clicked() {
                                    saved.push(format!("{}\n\nOn: {}\n", note.text.trim_end(), note.on));
                                    keep = false;
                                }
                                if ui.button("Discard").clicked() {
                                    keep = false;
                                }
                            });
                        });
                });
            note.pos = area.response.rect.min;
            marks.keep_clear(area.response.rect);
            keep
        });
        saved
    }
}

/// The note being pulled out of the tab, under the pointer.
fn ghost(ctx: &egui::Context, at: Pos2) {
    let rect = Rect::from_min_size(at - vec2(NOTE_SIZE.x / 2.0, 20.0), NOTE_SIZE);
    let p = ctx.layer_painter(egui::LayerId::new(Order::Tooltip, Id::new("tabnote-ghost")));
    p.rect(
        rect,
        CornerRadius::same(10),
        NOTE_FILL.gamma_multiply(0.92),
        Stroke::new(2.0, GREEN),
        egui::StrokeKind::Inside,
    );
    p.text(rect.min + vec2(12.0, 10.0), Align2::LEFT_TOP, "New note", FontId::proportional(14.0), Color32::from_gray(0x55));
}

/// The guide's ring around what was picked: a circle when it's roughly
/// square, a pill when it's wide, pulsing 1.0 to 1.12 every 600 ms.
fn ring(ctx: &egui::Context, picked: &Picked) {
    let Some(bounds) = picked.runs.iter().copied().reduce(Rect::union) else { return };
    let bounds = bounds.expand(10.0);
    let t = ctx.input(|i| i.time) as f32;
    let scale = 1.0 + 0.06 * (1.0 - (t * std::f32::consts::PI / 0.6).cos());
    let p = ctx.layer_painter(egui::LayerId::new(Order::Foreground, Id::new("tabnote-ring")));
    let stroke = Stroke::new(4.0, GREEN);
    if bounds.width() < 1.8 * bounds.height() {
        p.circle_stroke(bounds.center(), bounds.size().max_elem() / 2.0 * scale, stroke);
    } else {
        let r = Rect::from_center_size(bounds.center(), bounds.size() * scale);
        p.rect_stroke(r, CornerRadius::same((r.height() / 2.0).min(255.0) as u8), stroke, egui::StrokeKind::Middle);
    }
    ctx.request_repaint();
}

fn clamp(ctx: &egui::Context, pos: Pos2) -> Pos2 {
    let screen = ctx.content_rect();
    pos2(
        pos.x.clamp(screen.left(), (screen.right() - NOTE_SIZE.x).max(screen.left())),
        pos.y.clamp(screen.top(), (screen.bottom() - NOTE_SIZE.y).max(screen.top())),
    )
}
