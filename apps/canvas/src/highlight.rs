//! Highlights: select any text in the app (a label, a card, a file being
//! edited, a terminal) and a small "+" rises above it. Mousing over it opens
//! into "add highlight"; clicking keeps the text, with where it came from, as
//! a note in the notes pane.

use eframe::egui;
use egui::{Align2, CornerRadius, FontId, Pos2, Rect, Sense, Stroke, pos2, vec2};

use crate::{INK, SHEET};

/// Selected text egui keeps to itself (in labels and text fields) is only
/// handed out when it's copied. This asks for a copy and catches what comes
/// back before it reaches the clipboard.
#[derive(Default)]
struct CopyCatch {
    armed: bool,
    caught: Option<String>,
    /// Where the focused text field's cursor was drawn last frame.
    cursor: Option<Rect>,
}

impl egui::Plugin for CopyCatch {
    fn debug_name(&self) -> &'static str {
        "CopyCatch"
    }

    // Registered after egui's own label selection, so this runs after it has
    // put the selected text out.
    fn on_end_pass(&mut self, ui: &mut egui::Ui) {
        let armed = std::mem::take(&mut self.armed);
        ui.ctx().output_mut(|o| {
            self.cursor = o.ime.as_ref().map(|i| i.cursor_rect);
            if armed {
                o.commands.retain(|c| match c {
                    egui::OutputCommand::CopyText(t) => {
                        self.caught = Some(t.clone());
                        false
                    }
                    _ => true,
                });
            }
        });
    }
}

#[derive(Clone)]
pub struct Highlight {
    pub text: String,
    /// Where it was found: a file, a terminal, a pane.
    pub source: String,
}

/// Text selected somewhere the app can read it directly (a terminal).
pub struct Direct {
    pub text: String,
    pub source: String,
    pub anchor: Pos2,
}

pub struct Highlights {
    /// Text the "+" would keep, once it's been asked for.
    ready: Option<String>,
    /// Where the pointer let go last: labels don't say where their
    /// selection is, so the "+" goes where the drag ended.
    released: Option<Pos2>,
    plus: Rect,
}

impl Highlights {
    pub fn new(ctx: &egui::Context) -> Self {
        ctx.add_plugin(CopyCatch::default());
        Self {
            ready: None,
            released: None,
            plus: Rect::NOTHING,
        }
    }

    /// Where the "+" is, so a brush doesn't draw over it.
    pub fn plus_rect(&self) -> Rect {
        self.plus
    }

    /// Call at the start of the frame, before anything reads input.
    /// `direct` is a terminal's selection; `typing` says a terminal has the
    /// keyboard (a copy request would reach it as Ctrl+C); `source` names
    /// the file being edited, if one is.
    pub fn begin_frame(&mut self, ctx: &egui::Context, direct: Option<&Direct>, typing: bool) {
        if let Some(p) = ctx.input(|i| i.pointer.any_released().then(|| i.pointer.latest_pos()).flatten()) {
            self.released = Some(p);
        }
        let catch = ctx.plugin::<CopyCatch>();
        let mut catch = catch.lock();
        if let Some(text) = catch.caught.take() {
            self.ready = Some(text);
        }
        // While the pointer is on the "+", ask for the selection once.
        let over = ctx.input(|i| i.pointer.hover_pos()).is_some_and(|p| self.plus.contains(p));
        if over && self.ready.is_none() && direct.is_none() && !typing {
            ctx.input_mut(|i| i.events.push(egui::Event::Copy));
            catch.armed = true;
        }
        if !over {
            self.ready = None;
        }
    }

    /// Draw the "+" over a selection. Call last. Returns the highlight
    /// when it's added.
    pub fn show(
        &mut self,
        ctx: &egui::Context,
        direct: Option<Direct>,
        source: Option<String>,
    ) -> Option<Highlight> {
        let labels = ctx.plugin::<egui::text_selection::LabelSelectionState>().lock().has_selection();
        let field = ctx
            .memory(|m| m.focused())
            .and_then(|id| egui::TextEdit::load_state(ctx, id))
            .and_then(|s| s.cursor.char_range())
            .is_some_and(|r| !r.is_empty());
        let cursor = ctx.plugin::<CopyCatch>().lock().cursor;
        let (anchor, from) = match &direct {
            Some(d) => (Some(d.anchor), d.source.clone()),
            None if field => (
                cursor.map(|r| r.left_top()).or(self.released),
                source.unwrap_or_else(|| "a note".into()),
            ),
            None if labels => (self.released, "tapestry".into()),
            None => (None, String::new()),
        };
        let dragging = ctx.input(|i| i.pointer.primary_down());
        let hovered = self.hovering(ctx);
        self.plus = Rect::NOTHING;
        if let Some(anchor) = anchor
            && !dragging
        {
            let opened = hovered && (self.ready.is_some() || direct.is_some());
            if let Some(text) = self.plus_button(ctx, anchor, opened, direct.as_ref().map(|d| d.text.clone())) {
                self.ready = None;
                return Some(Highlight {
                    text: text.trim().to_owned(),
                    source: from,
                });
            }
        }
        None
    }

    /// The "+" above the selection, opening into "add highlight" under the
    /// pointer. Returns the text when it's clicked.
    fn plus_button(
        &mut self,
        ctx: &egui::Context,
        anchor: Pos2,
        opened: bool,
        direct: Option<String>,
    ) -> Option<String> {
        let id = egui::Id::new("highlight-plus");
        let open = ctx.animate_bool_with_time(id, opened, 0.14);
        let width = egui::lerp(26.0..=132.0, open);
        let at = anchor + vec2(-13.0, -34.0);
        let mut clicked = None;
        egui::Area::new(id)
            .order(egui::Order::Foreground)
            .fixed_pos(at)
            .show(ctx, |ui| {
                let (rect, resp) = ui.allocate_exact_size(vec2(width, 26.0), Sense::click());
                self.plus = rect.expand(4.0);
                let p = ui.painter();
                p.rect(
                    rect,
                    CornerRadius::same(13),
                    SHEET,
                    Stroke::new(1.5, INK),
                    egui::StrokeKind::Inside,
                );
                let c = pos2(rect.left() + 13.0, rect.center().y);
                p.line_segment([c - vec2(5.0, 0.0), c + vec2(5.0, 0.0)], Stroke::new(1.5, INK));
                p.line_segment([c - vec2(0.0, 5.0), c + vec2(0.0, 5.0)], Stroke::new(1.5, INK));
                if open > 0.05 {
                    p.with_clip_rect(rect.shrink(2.0)).text(
                        pos2(c.x + 12.0, c.y),
                        Align2::LEFT_CENTER,
                        "add highlight",
                        FontId::proportional(15.0),
                        INK.gamma_multiply(open),
                    );
                }
                if resp.hovered() {
                    ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                }
                if resp.clicked() {
                    clicked = direct.clone().or_else(|| self.ready.clone());
                }
            });
        if open < 1.0 && open > 0.0 {
            ctx.request_repaint();
        }
        clicked.filter(|t| !t.trim().is_empty())
    }

    fn hovering(&self, ctx: &egui::Context) -> bool {
        ctx.input(|i| i.pointer.hover_pos()).is_some_and(|p| self.plus.contains(p))
    }

}

impl Highlight {
    /// As a note: the opening words for a title, the text quoted, and
    /// where it came from.
    pub fn to_note(&self) -> String {
        let first = self.text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
        let mut head: String = first.chars().take(48).collect();
        if head.len() < first.len() {
            head.push('…');
        }
        let quoted: Vec<String> = self.text.lines().map(|l| format!("> {l}")).collect();
        format!("# “{head}”\n{}\n\nHighlighted in {}.\n", quoted.join("\n"), self.source)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn highlight_as_note() {
        let h = Highlight {
            text: "Fire spreads to trees.\nSlowly.".into(),
            source: "README.md".into(),
        };
        assert_eq!(
            h.to_note(),
            "# “Fire spreads to trees.”\n> Fire spreads to trees.\n> Slowly.\n\nHighlighted in README.md.\n"
        );
    }
}
