//! A window onto a world: scrub its time, orbit its space, see its keys.
//!
//! The viewer only talks to `WorldView`. Today the world is the hand-keyed
//! cup scene; later it will be the core, and nothing here should change.

use eframe::{egui, egui_wgpu, wgpu};
use egui::{Align2, Color32, FontId, Pos2, Rect, Sense, Stroke, Vec2, pos2, vec2};
use glam::{Vec3, Vec4};
use tapestry_render::{BlobRenderer, Camera, instances};
use tapestry_view::{Frame, KeyKind, KeyMark, WorldView, resolve};

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Tapestry")
            .with_inner_size([1280.0, 800.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Tapestry",
        options,
        Box::new(|cc| Ok(Box::new(Viewer::new(cc, Box::new(tapestry_mock::CupScene))))),
    )
}

const SPEEDS: [f64; 5] = [0.05, 0.25, 1.0, 4.0, 10.0];

struct Orbit {
    target: Vec3,
    yaw: f32,
    pitch: f32,
    distance: f32,
}

impl Orbit {
    fn camera(&self) -> Camera {
        let dir = Vec3::new(
            self.pitch.cos() * self.yaw.sin(),
            self.pitch.sin(),
            self.pitch.cos() * self.yaw.cos(),
        );
        Camera { eye: self.target + dir * self.distance, target: self.target, fov_y: 45f32.to_radians() }
    }
}

struct Viewer {
    world: Box<dyn WorldView>,
    keys: Vec<KeyMark>,
    gpu: egui_wgpu::RenderState,
    renderer: BlobRenderer,
    texture: Option<egui::TextureId>,
    orbit: Orbit,
    time: f64,
    playing: bool,
    speed: f64,
    labels: bool,
}

impl Viewer {
    fn new(cc: &eframe::CreationContext<'_>, world: Box<dyn WorldView>) -> Self {
        let gpu = cc.wgpu_render_state.clone().expect("the viewer needs the wgpu renderer");
        let renderer = BlobRenderer::new(&gpu.device);
        let keys = world.keys();
        Self {
            world,
            keys,
            gpu,
            renderer,
            texture: None,
            orbit: Orbit { target: Vec3::new(0.6, 0.6, 0.0), yaw: 0.65, pitch: 0.38, distance: 5.2 },
            time: 30.0,
            playing: true,
            speed: 1.0,
            labels: true,
        }
    }

    fn advance(&mut self, ui: &egui::Ui) {
        let (start, end) = self.world.time_range();
        if ui.input(|i| i.key_pressed(egui::Key::Space)) {
            if !self.playing && self.time >= end {
                self.time = start;
            }
            self.playing = !self.playing;
        }
        if self.playing {
            self.time += ui.input(|i| i.stable_dt) as f64 * self.speed;
            if self.time >= end {
                self.time = end;
                self.playing = false;
            }
            ui.ctx().request_repaint();
        }
    }

    fn timeline(&mut self, ui: &mut egui::Ui) {
        let (start, end) = self.world.time_range();
        ui.horizontal(|ui| {
            let label = if self.playing { "⏸ Pause" } else { "▶ Play" };
            if ui.button(label).clicked() {
                if !self.playing && self.time >= end {
                    self.time = start;
                }
                self.playing = !self.playing;
            }
            ui.monospace(format!("morning@{:>6.2}", self.time));
            ui.separator();
            ui.label("speed");
            for s in SPEEDS {
                ui.selectable_value(&mut self.speed, s, format!("{s}×"));
            }
            ui.separator();
            ui.checkbox(&mut self.labels, "labels");
        });

        let (rect, response) = ui.allocate_exact_size(vec2(ui.available_width(), 44.0), Sense::click_and_drag());
        let x_of = |t: f64| rect.left() + ((t - start) / (end - start)) as f32 * rect.width();
        if let Some(p) = response.interact_pointer_pos() {
            let f = ((p.x - rect.left()) / rect.width()).clamp(0.0, 1.0) as f64;
            self.time = start + f * (end - start);
        }

        let painter = ui.painter_at(rect.expand(2.0));
        let track_y = rect.center().y + 6.0;
        painter.rect_filled(Rect::from_x_y_ranges(rect.x_range(), track_y - 2.0..=track_y + 2.0), 2.0, Color32::from_gray(55));
        for s in (start as i64..=end as i64).step_by(5) {
            let x = x_of(s as f64);
            painter.line_segment([pos2(x, track_y + 5.0), pos2(x, track_y + 9.0)], Stroke::new(1.0, Color32::from_gray(90)));
        }

        let mut hovered: Option<&KeyMark> = None;
        let pointer = response.hover_pos();
        for key in &self.keys {
            let color = kind_color(key.kind);
            match key.time {
                // Always-on rules hold across the whole span.
                None => {
                    let y = rect.top() + 4.0;
                    painter.line_segment([pos2(rect.left(), y), pos2(rect.right(), y)], Stroke::new(3.0, color.gamma_multiply(0.6)));
                    painter.text(pos2(rect.left() + 4.0, y + 3.0), Align2::LEFT_TOP, &key.id, FontId::monospace(10.0), color);
                    if pointer.is_some_and(|p| (p.y - y).abs() < 5.0) {
                        hovered = Some(key);
                    }
                }
                Some(t) => {
                    let c = pos2(x_of(t), track_y);
                    match key.kind {
                        KeyKind::Cause => painter.add(egui::Shape::convex_polygon(
                            vec![c + vec2(0.0, -7.0), c + vec2(6.0, 5.0), c + vec2(-6.0, 5.0)],
                            color,
                            Stroke::NONE,
                        )),
                        _ => painter.add(egui::Shape::convex_polygon(
                            vec![c + vec2(0.0, -6.0), c + vec2(6.0, 0.0), c + vec2(0.0, 6.0), c + vec2(-6.0, 0.0)],
                            color,
                            Stroke::NONE,
                        )),
                    };
                    painter.text(c + vec2(0.0, -9.0), Align2::CENTER_BOTTOM, &key.id, FontId::monospace(10.0), color);
                    if pointer.is_some_and(|p| p.distance(c) < 9.0) {
                        hovered = Some(key);
                    }
                }
            }
        }

        let x = x_of(self.time);
        painter.line_segment([pos2(x, rect.top()), pos2(x, rect.bottom())], Stroke::new(2.0, Color32::WHITE));

        let note = hovered.map_or(String::new(), |k| format!("{} · {:?} · {}", k.id, k.kind, k.text));
        ui.label(egui::RichText::new(note).small().weak());
    }

    fn sidebar(&self, ui: &mut egui::Ui, frame: &Frame) {
        ui.heading("Keys");
        for key in &self.keys {
            ui.horizontal_wrapped(|ui| {
                ui.colored_label(kind_color(key.kind), format!("{} {:?}", key.id, key.kind));
                let when = key.time.map_or("always".to_owned(), |t| format!("@{t}"));
                ui.weak(when);
            });
            ui.label(egui::RichText::new(&key.text).small());
            ui.add_space(4.0);
        }
        ui.separator();
        ui.heading("Gap report");
        let gaps = self.world.gaps();
        if gaps.is_empty() {
            ui.label("No bounded gaps. k2 is satisfied by k3 through k4.");
        }
        for gap in gaps {
            ui.label(gap);
        }
        ui.separator();
        ui.weak(format!("{} points at this moment", frame.points.len()));
        ui.weak("Mock world: hand-keyed, not simulated.");
        ui.add_space(8.0);
        ui.weak("Drag to orbit · right-drag to pan · scroll to zoom · space to play");
    }

    fn scene(&mut self, ui: &mut egui::Ui, frame: &Frame) {
        let (rect, response) = ui.allocate_exact_size(ui.available_size(), Sense::click_and_drag());

        if response.dragged_by(egui::PointerButton::Primary) {
            let d = response.drag_delta();
            self.orbit.yaw -= d.x * 0.008;
            self.orbit.pitch = (self.orbit.pitch + d.y * 0.008).clamp(-0.2, 1.5);
        }
        if response.dragged_by(egui::PointerButton::Secondary) {
            let d = response.drag_delta() * self.orbit.distance * 0.0015;
            let cam = self.orbit.camera();
            let forward = (cam.target - cam.eye).normalize();
            let right = forward.cross(Vec3::Y).normalize();
            let up = right.cross(forward);
            self.orbit.target += -right * d.x + up * d.y;
        }
        if response.hovered() {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            self.orbit.distance = (self.orbit.distance * (-scroll * 0.002).exp()).clamp(0.3, 60.0);
        }

        let world = resolve(frame);
        let instances = instances(frame);

        let ppp = ui.ctx().pixels_per_point();
        let size = [(rect.width() * ppp) as u32, (rect.height() * ppp) as u32];
        let camera = self.orbit.camera();
        let recreated = self.renderer.render(&self.gpu.device, &self.gpu.queue, size, &camera, &instances);
        let view = self.renderer.target_view().expect("rendered at least once");
        let mut egui_renderer = self.gpu.renderer.write();
        match self.texture {
            None => {
                self.texture = Some(egui_renderer.register_native_texture(&self.gpu.device, view, wgpu::FilterMode::Linear));
            }
            Some(id) if recreated => {
                egui_renderer.update_egui_texture_from_wgpu_texture(&self.gpu.device, view, wgpu::FilterMode::Linear, id);
            }
            Some(_) => {}
        }
        drop(egui_renderer);

        let painter = ui.painter_at(rect);
        painter.image(
            self.texture.unwrap(),
            rect,
            Rect::from_min_max(Pos2::ZERO, pos2(1.0, 1.0)),
            Color32::WHITE,
        );

        if self.labels {
            let view_proj = camera.view_proj(rect.width() / rect.height());
            let tops = blob_tops(frame, &world);
            for (i, p) in frame.points.iter().enumerate() {
                let (Some(label), Some(top)) = (&p.label, tops[i]) else { continue };
                let anchor = Vec3::new(world[i].translation.x, top + 0.08, world[i].translation.z);
                if let Some(pos) = project(view_proj, anchor, rect) {
                    painter.text(pos, Align2::CENTER_BOTTOM, label, FontId::proportional(13.0), Color32::from_gray(225));
                }
            }
        }
    }
}

impl eframe::App for Viewer {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.advance(ui);
        let frame = self.world.frame_at(self.time);

        egui::Panel::bottom("timeline").show(ui, |ui| {
            ui.add_space(4.0);
            self.timeline(ui);
        });
        egui::Panel::right("keys").default_size(300.0).show(ui, |ui| {
            egui::ScrollArea::vertical().show(ui, |ui| self.sidebar(ui, &frame));
        });
        egui::CentralPanel::no_frame().show(ui, |ui| self.scene(ui, &frame));
    }
}

fn kind_color(kind: KeyKind) -> Color32 {
    match kind {
        KeyKind::Cause => Color32::from_rgb(240, 150, 60),
        KeyKind::State => Color32::from_rgb(110, 170, 250),
        KeyKind::Rule => Color32::from_rgb(150, 210, 130),
    }
}

/// The highest point of each point's blob and all its descendants' blobs.
fn blob_tops(frame: &Frame, world: &[tapestry_view::WorldTransform]) -> Vec<Option<f32>> {
    let mut tops = vec![None::<f32>; frame.points.len()];
    for (i, p) in frame.points.iter().enumerate() {
        let Some(b) = p.blob else { continue };
        let top = world[i].translation.y + b.radii.y * world[i].scale;
        let mut at = Some(i);
        while let Some(j) = at {
            tops[j] = Some(tops[j].map_or(top, |t| t.max(top)));
            at = frame.points[j].parent;
        }
    }
    tops
}

fn project(view_proj: glam::Mat4, p: Vec3, rect: Rect) -> Option<Pos2> {
    let clip = view_proj * Vec4::new(p.x, p.y, p.z, 1.0);
    if clip.w <= 0.0 {
        return None;
    }
    let ndc = clip.truncate() / clip.w;
    Some(rect.min + Vec2::new((ndc.x * 0.5 + 0.5) * rect.width(), (0.5 - ndc.y * 0.5) * rect.height()))
}
