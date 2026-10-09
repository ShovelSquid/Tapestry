//! Paint with particles that keep living; switch rule notes on and watch.
//!
//! Everything you do is a keyframe on the timeline below the canvas. Scrub
//! back and the canvas replays to that moment; paint there and the future
//! replays around what you added.

use std::sync::Arc;

use eframe::egui;
use egui::{
    Align2, Color32, CornerRadius, FontFamily, FontId, Mesh, Pos2, Rect, RichText, Sense, Shape,
    Stroke, TextureHandle, Vec2, pos2, vec2,
};
use tapestry_canvas::{
    Body, Brush, DT, HEIGHT, KeyId, MadeBy, Material, Particle, RULES, TICKS_PER_SECOND, Tick,
    Timeline, WIDTH,
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
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Tapestry canvas")
            .with_inner_size([1480.0, 920.0]),
        ..Default::default()
    };
    let demo = std::env::args().any(|a| a == "--demo");
    eframe::run_native(
        "Tapestry canvas",
        options,
        Box::new(move |cc| {
            let mut app = App::new(cc);
            if demo {
                paint_demo(&mut app.timeline);
            }
            Ok(Box::new(app))
        }),
    )
}

/// A scene to start from: an ink cup with water poured in, and a row of
/// trees that fire reaches once "Fire spreads to trees" is switched on.
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
    t.set_rule(0, true);
    t.seek(0);
}

#[derive(Clone, Copy, PartialEq)]
enum Show {
    All,
    Mine,
    Rules,
}

struct App {
    timeline: Timeline,
    brush: Brush,
    radius: f32,
    playing: bool,
    clock: f32,
    painting: Option<(KeyId, egui::Vec2)>,
    show: Show,
    /// `TAPESTRY_SHOT=path:seconds` saves the window at that canvas time
    /// and quits, so the canvas can be checked without a person.
    shot: Option<(String, Tick, bool)>,
    hard: TextureHandle,
    soft: TextureHandle,
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        install_fonts(&cc.egui_ctx);
        let mut visuals = egui::Visuals::light();
        visuals.panel_fill = PAPER;
        visuals.window_fill = PAPER;
        visuals.override_text_color = Some(INK);
        cc.egui_ctx.set_visuals(visuals);
        Self {
            timeline: Timeline::default(),
            brush: Brush::Ink,
            radius: 5.0,
            playing: true,
            clock: 0.0,
            painting: None,
            show: Show::All,
            shot: std::env::var("TAPESTRY_SHOT").ok().and_then(|v| {
                let (path, secs) = v.rsplit_once(':')?;
                let secs: f32 = secs.parse().ok()?;
                Some((path.to_owned(), (secs * TICKS_PER_SECOND as f32) as Tick, false))
            }),
            hard: dot_texture(&cc.egui_ctx, "hard", 0.72),
            soft: dot_texture(&cc.egui_ctx, "soft", 0.0),
        }
    }

    fn keyboard(&mut self, ui: &egui::Ui) {
        if ui.ctx().egui_wants_keyboard_input() {
            return;
        }
        ui.input(|i| {
            if i.key_pressed(egui::Key::Space) {
                self.playing = !self.playing;
            }
            if i.modifiers.command && i.key_pressed(egui::Key::Z) && self.painting.is_none() {
                self.timeline.undo();
            }
            for (n, key) in [
                egui::Key::Num1,
                egui::Key::Num2,
                egui::Key::Num3,
                egui::Key::Num4,
                egui::Key::Num5,
            ]
            .into_iter()
            .enumerate()
            {
                if i.key_pressed(key) {
                    self.brush = Brush::ALL[n];
                }
            }
            if !self.playing && self.painting.is_none() {
                let t = self.timeline.tick();
                if i.key_pressed(egui::Key::ArrowRight) {
                    self.timeline.seek(t + 1);
                }
                if i.key_pressed(egui::Key::ArrowLeft) {
                    self.timeline.seek(t.saturating_sub(1));
                }
            }
            if i.key_pressed(egui::Key::Home) && self.painting.is_none() {
                self.timeline.seek(0);
            }
        });
    }

    fn run_clock(&mut self, ui: &egui::Ui) {
        if !self.playing {
            self.clock = 0.0;
            return;
        }
        self.clock += ui.input(|i| i.stable_dt).min(0.1);
        let mut steps = 0;
        while self.clock >= DT && steps < 4 {
            self.timeline.step();
            self.clock -= DT;
            steps += 1;
        }
        if steps == 4 {
            self.clock = 0.0;
        }
        ui.ctx().request_repaint();
    }

    fn top_bar(&mut self, ui: &mut egui::Ui) {
        ui.add_space(14.0);
        ui.horizontal(|ui| {
            ui.add_space(24.0);
            ui.label(RichText::new("Tapestry").font(title(24.0)));
            ui.add_space(36.0);
            for (show, name) in [
                (Show::All, "everything"),
                (Show::Mine, "what I made"),
                (Show::Rules, "what rules made"),
            ] {
                if quiet_link(ui, name, self.show == show).clicked() {
                    self.show = show;
                }
                ui.add_space(10.0);
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.add_space(24.0);
                let s = self.timeline.state();
                ui.label(
                    RichText::new(format!("{} particles", s.particles.len()))
                        .color(FAINT)
                        .size(16.0),
                );
            });
        });
        ui.add_space(8.0);
    }

    fn palette(&mut self, ui: &mut egui::Ui) {
        ui.add_space(16.0);
        for (n, brush) in Brush::ALL.into_iter().enumerate() {
            let chosen = self.brush == brush;
            let (rect, response) = ui.allocate_exact_size(vec2(118.0, 40.0), Sense::click());
            let p = ui.painter();
            let c = pos2(rect.left() + 28.0, rect.center().y);
            p.circle_filled(c, 11.0, swatch(brush));
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
                brush.name(),
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
                self.brush = brush;
            }
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

    fn notes(&mut self, ui: &mut egui::Ui) {
        ui.add_space(14.0);
        ui.label(RichText::new("Rules").font(title(22.0)));
        ui.label(
            RichText::new("Nothing acts on anything else until a note says how.")
                .color(FAINT)
                .size(15.0),
        );
        ui.add_space(12.0);
        let on_now = self.timeline.state().rules_on.clone();
        for (i, note) in RULES.iter().enumerate() {
            let on = on_now[i];
            let card = egui::Frame::new()
                .fill(SHEET)
                .stroke(Stroke::new(1.5, if on { INK } else { MUTED }))
                .corner_radius(CornerRadius::same(14))
                .inner_margin(egui::Margin::symmetric(16, 12))
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(note.title).font(title(19.0)));
                    });
                    let r = ui.max_rect();
                    let y = ui.cursor().top() + 2.0;
                    ui.painter().line_segment(
                        [pos2(r.left(), y), pos2(r.right(), y)],
                        Stroke::new(1.2, INK),
                    );
                    ui.add_space(8.0);
                    ui.label(RichText::new(note.text).size(16.0));
                    ui.add_space(4.0);
                    match note.basics {
                        Some(basics) => {
                            for b in basics {
                                ui.label(RichText::new(b.to_string()).color(FAINT).size(13.0));
                            }
                        }
                        None => {
                            let color = if on { DOT } else { FAINT };
                            ui.label(
                                RichText::new(format!("does nothing: {}", note.missing))
                                    .color(color)
                                    .size(14.0),
                            );
                        }
                    }
                });
            // The red dot on the card's corner is its switch.
            let corner = card.response.rect.left_top() + vec2(4.0, 4.0);
            let dot = ui.interact(
                Rect::from_center_size(corner, vec2(26.0, 26.0)),
                ui.id().with(("rule-dot", i)),
                Sense::click(),
            );
            let card_click = ui.interact(
                card.response.rect,
                ui.id().with(("rule-card", i)),
                Sense::click(),
            );
            let p = ui.painter();
            if on {
                p.circle_filled(corner, 10.0, DOT);
            } else {
                p.circle_filled(corner, 10.0, SHEET);
                p.circle_stroke(corner, 10.0, Stroke::new(1.5, MUTED));
            }
            if dot.hovered() || card_click.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }
            if (dot.clicked() || card_click.clicked()) && self.painting.is_none() {
                self.timeline.set_rule(i, !on);
            }
            ui.add_space(14.0);
        }
    }

    fn timeline_bar(&mut self, ui: &mut egui::Ui) {
        ui.add_space(10.0);
        let now = self.timeline.tick();
        let end = (self.timeline.last_key_tick() + 5 * TICKS_PER_SECOND)
            .max(now + 2 * TICKS_PER_SECOND)
            .max(20 * TICKS_PER_SECOND);
        let end = end.div_ceil(5 * TICKS_PER_SECOND) * 5 * TICKS_PER_SECOND;

        ui.horizontal(|ui| {
            ui.add_space(24.0);
            let label = if self.playing { "pause" } else { "play" };
            if quiet_link(ui, label, true).clicked() {
                self.playing = !self.playing;
            }
            ui.add_space(16.0);
            ui.label(
                RichText::new(format!("{:.2} s", now as f32 / TICKS_PER_SECOND as f32))
                    .size(18.0)
                    .color(MUTED),
            );
            ui.add_space(16.0);
            let width = ui.available_width() - 24.0;
            let (rect, response) = ui.allocate_exact_size(vec2(width, 40.0), Sense::click_and_drag());
            let x_of = |t: Tick| rect.left() + t as f32 / end as f32 * rect.width();
            if let Some(p) = response.interact_pointer_pos()
                && self.painting.is_none()
            {
                let f = ((p.x - rect.left()) / rect.width()).clamp(0.0, 1.0);
                self.timeline.seek((f * end as f32).round() as Tick);
                self.playing = false;
            }
            let p = ui.painter();
            let y = rect.center().y + 4.0;
            p.line_segment(
                [pos2(rect.left(), y), pos2(rect.right(), y)],
                Stroke::new(1.0, MUTED),
            );
            for s in (0..=end).step_by(5 * TICKS_PER_SECOND as usize) {
                let x = x_of(s);
                p.line_segment([pos2(x, y), pos2(x, y + 5.0)], Stroke::new(1.0, FAINT));
                p.text(
                    pos2(x, y + 7.0),
                    Align2::CENTER_TOP,
                    format!("{}", s / TICKS_PER_SECOND),
                    FontId::proportional(11.0),
                    FAINT,
                );
            }
            // Keyframes: a dot per stroke in its brush's colour, a small
            // diamond per rule switch (filled on, hollow off).
            for key in self.timeline.keys() {
                let x = x_of(key.tick);
                match &key.body {
                    Body::Stroke(s) => {
                        p.circle_filled(pos2(x, y), 3.5, swatch(s.brush));
                    }
                    Body::Rule { on, .. } => {
                        let c = pos2(x, y - 11.0);
                        let pts = vec![
                            c + vec2(0.0, -5.0),
                            c + vec2(5.0, 0.0),
                            c + vec2(0.0, 5.0),
                            c + vec2(-5.0, 0.0),
                        ];
                        let fill = if *on { DOT } else { PAPER };
                        p.add(Shape::convex_polygon(pts, fill, Stroke::new(1.2, DOT)));
                    }
                }
            }
            let x = x_of(now);
            p.line_segment(
                [pos2(x, rect.top()), pos2(x, y + 4.0)],
                Stroke::new(1.5, INK),
            );
            p.circle_filled(pos2(x, rect.top()), 3.0, INK);
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

        if response.hovered() {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            if scroll != 0.0 {
                self.radius = (self.radius * (scroll * 0.004).exp()).clamp(2.0, 24.0);
            }
            ui.ctx().set_cursor_icon(egui::CursorIcon::Crosshair);
        }

        // Painting: one keyframe per stroke, grown while the button is held.
        if response.drag_started_by(egui::PointerButton::Primary)
            && let Some(p) = response.interact_pointer_pos()
        {
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
        let mut hard = Mesh::with_texture(self.hard.id());
        let mut soft = Mesh::with_texture(self.soft.id());
        let mut glow = Mesh::with_texture(self.soft.id());
        for layer in 0..6 {
            for p in &state.particles {
                if draw_layer(p) != layer {
                    continue;
                }
                let (color, size, is_soft) = look(p);
                let color = match (self.show, p.made_by) {
                    (Show::All, _) | (Show::Mine, MadeBy::Key(_)) | (Show::Rules, MadeBy::Rule(_)) => {
                        color
                    }
                    _ => color.gamma_multiply(0.1),
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

        if let Some(p) = pointer {
            let r = match self.brush {
                Brush::Smudge => self.radius * 2.5,
                Brush::Tree => self.radius * 2.0,
                _ => self.radius,
            } * scale;
            painter.circle_stroke(p, r.max(2.0), Stroke::new(1.0, FAINT));
        }

        // An empty note that's switched on is worth saying out loud.
        let inert: Vec<_> = RULES
            .iter()
            .enumerate()
            .filter(|(i, r)| r.basics.is_none() && state.rules_on[*i])
            .map(|(_, r)| format!("“{}” is on but does nothing: {}.", r.title, r.missing))
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
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.keyboard(ui);

        egui::Panel::top("top").show(ui, |ui| self.top_bar(ui));
        egui::Panel::bottom("timeline").show(ui, |ui| self.timeline_bar(ui));
        egui::Panel::left("palette")
            .resizable(false)
            .default_size(140.0)
            .show(ui, |ui| self.palette(ui));
        egui::Panel::right("notes")
            .resizable(false)
            .default_size(330.0)
            .show(ui, |ui| {
                egui::ScrollArea::vertical().show(ui, |ui| self.notes(ui));
            });
        egui::CentralPanel::default().show(ui, |ui| self.canvas(ui));

        self.run_clock(ui);
        self.take_shot(ui);
    }
}

impl App {
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
            (rgba(c[0], c[1], c[2], alpha as u8), p.radius * (1.0 + a * 1.4), true)
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
    }
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
