//! The mimics as the app shows them, and what you can do to them.
//!
//! Links are drawn as faint lines between cores, darker the stronger they
//! are, and in red once kept: the swarm's structure, apart from the
//! tentacles that act it out. Hover a mimic or a link to read it. Press on
//! a mimic to drag it (its partners follow, as hard as they're linked),
//! double-click one to pin it in place, right-click a link to cut it. What
//! the swarm proposes is listed in the canvas's corner, to keep or turn down.

use std::collections::HashMap;

use eframe::egui;
use egui::{Align2, Color32, CornerRadius, FontId, Pos2, Rect, Stroke, pos2, vec2};
use glam::Vec2;
use tapestry_canvas::{Hold, MadeBy, Mimic, Proposal, SEGS, Swarm, shared_words};

use crate::{DOT, FAINT, INK, MUTED, SHEET, quiet_link, rgba};

/// Notes for the demo, on three topics, so it has something to think about.
pub const DEMO_NOTES: &[(&str, &str)] = &[
    ("demo-tomatoes", "# Tomatoes\nThe tomatoes want more compost and deeper watering; tie them to the trellis before the harvest gets heavy."),
    ("demo-beds", "# Raised beds\nTurn the compost into the soil of the raised beds, then mulch so the seedlings keep their watering."),
    ("demo-basil", "# Basil\nPinch the basil so it bushes out; it likes sunlight, warm soil and steady watering, and hates the cold greenhouse floor."),
    ("demo-greenhouse", "# Greenhouse\nStart seedlings in the greenhouse in March. Pruning and mulch later; tomatoes and basil go out after the last frost."),
    ("demo-chorus", "# The chorus\nThe chorus needs a stronger melody over the same chord change; the verse can stay quiet and let the rhythm carry it."),
    ("demo-tempo", "# Tempo\nSlow the tempo down for the bridge. The drummer should leave space so the bassline and the guitar rhythm breathe."),
    ("demo-mixing", "# Mixing\nIn mixing, pull the synth back under the guitar and the harmony vocals; the chorus melody has to sit on top."),
    ("demo-bassline", "# Bassline\nTry the bassline an octave down in the verse, locked with the drummer, then a walking line into the chorus chord."),
    ("demo-comet", "# The comet\nWatch the comet through the telescope after midnight; its orbit brings it closest to the planet in autumn."),
    ("demo-launch", "# Launch\nThe rocket launch is at dawn. The satellite goes into a low orbit, then a burn lifts it past the crater survey."),
    ("demo-nebula", "# Nebula\nA long telescope exposure shows the nebula: a nursery where gravity pulls gas into new stars, far across the galaxy."),
    ("demo-asteroid", "# Asteroid\nThe asteroid's orbit crosses ours; gravity from the planet bends its path, and the telescope tracks every pass."),
];

/// The title of a note: its first `#` line, or else its first line.
pub fn title(text: &str) -> String {
    let first = text.lines().map(str::trim).find(|l| !l.is_empty());
    first.map_or("Untitled".to_owned(), |l| l.trim_start_matches('#').trim().to_owned())
}

/// A mind's colour, livelier than the plain view of it.
fn ink(c: [f32; 3], alpha: u8) -> Color32 {
    let mean = (c[0] + c[1] + c[2]) / 3.0;
    let k = |x: f32| ((mean + (x - mean) * 2.2).clamp(0.0, 1.0) * 255.0) as u8;
    rgba(k(c[0]), k(c[1]), k(c[2]), alpha)
}

fn short(s: &str, n: usize) -> String {
    match s.char_indices().nth(n) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_owned(),
    }
}

/// Every link, then every mimic, then the notes' names.
pub fn draw(
    painter: &egui::Painter,
    swarm: &Swarm,
    to_screen: &impl Fn(Vec2) -> Pos2,
    scale: f32,
    focus: Option<MadeBy>,
) {
    let dim = |m: &Mimic| matches!(focus, Some(made_by) if m.made_by != made_by);
    for l in &swarm.links {
        let (Some(a), Some(b)) = (swarm.mimic(l.a), swarm.mimic(l.b)) else { continue };
        let (color, width) = if l.pinned {
            (DOT.gamma_multiply(0.8), 2.5)
        } else {
            (rgba(22, 25, 27, (25.0 + 140.0 * l.weight) as u8), 0.6 + 2.0 * l.weight)
        };
        let color = if dim(a) && dim(b) { color.gamma_multiply(0.15) } else { color };
        painter.line_segment([to_screen(a.core), to_screen(b.core)], Stroke::new(width * scale.max(0.6), color));
    }
    for m in &swarm.mimics {
        draw_mimic(painter, swarm, m, to_screen, scale, dim(m));
    }
    for m in &swarm.mimics {
        if let Some(note) = &m.note {
            let at = to_screen(m.core) + vec2(0.0, (m.size * 1.6 + 4.0) * scale);
            let color = if dim(m) { FAINT.gamma_multiply(0.3) } else { MUTED };
            painter.text(at, Align2::CENTER_TOP, short(&note.title, 22), FontId::proportional(13.0), color);
        }
    }
}

/// A mimic: inky tentacles, thick at the root and fine at the tip (holding
/// another, as thick as their link is strong), messages running along them
/// as dots in the sender's colour, and its core on top.
fn draw_mimic(painter: &egui::Painter, swarm: &Swarm, m: &Mimic, to_screen: &impl Fn(Vec2) -> Pos2, scale: f32, dim: bool) {
    let fade = |c: Color32| if dim { c.gamma_multiply(0.12) } else { c };
    let line = fade(rgba(22, 25, 27, 255));
    for arm in &m.arms {
        let thick = match arm.hold {
            Hold::Mimic(other) => 0.7 + 0.8 * swarm.link(m.id, other).map_or(0.3, |l| l.weight),
            _ => 1.0,
        };
        let pts: Vec<Pos2> = arm.points.iter().map(|p| to_screen(*p)).collect();
        for (i, w) in pts.windows(2).enumerate() {
            let f = i as f32 / (SEGS - 1) as f32;
            let width = (m.size * 0.5 * (1.0 - f) * thick + 0.6) * scale;
            painter.line_segment([w[0], w[1]], Stroke::new(width.max(0.8), line));
            painter.circle_filled(w[1], width * 0.5, line);
        }
        for pulse in &arm.pulses {
            let at = pulse.at.clamp(0.0, 1.0) * (SEGS - 1) as f32;
            let i = (at as usize).min(SEGS - 2);
            let p = pts[i].lerp(pts[i + 1], at - i as f32);
            let color = tapestry_canvas::mind_color(&pulse.message);
            painter.circle_filled(p, (m.size * 0.42 * scale).max(2.0), fade(ink(color, 240)));
        }
    }
    // The core bulges as messages get in.
    let r = m.size * (1.0 + 0.3 * m.jiggle.clamp(-1.0, 1.0)) * scale;
    let c = to_screen(m.core);
    painter.circle_filled(c, r * 1.12, line);
    painter.circle_filled(c, r, fade(ink(m.color(), 255)));
    if m.pinned {
        painter.circle_stroke(c, r * 1.12 + 4.0 * scale.max(0.6), Stroke::new(1.5, fade(DOT)));
    }
}

/// The mimic whose core is under `at`, if any (`slack` in canvas units).
pub fn mimic_at(swarm: &Swarm, at: Vec2, slack: f32) -> Option<u64> {
    swarm
        .mimics
        .iter()
        .map(|m| (m.core.distance(at), m))
        .filter(|(d, m)| *d < m.size * 1.6 + slack)
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, m)| m.id)
}

/// The link passing within `within` of `at`, nearest first.
pub fn link_at(swarm: &Swarm, at: Vec2, within: f32) -> Option<(u64, u64)> {
    swarm
        .links
        .iter()
        .filter_map(|l| {
            let (a, b) = (swarm.mimic(l.a)?.core, swarm.mimic(l.b)?.core);
            let ab = b - a;
            let t = ((at - a).dot(ab) / ab.length_squared().max(1e-6)).clamp(0.0, 1.0);
            let d = at.distance(a + ab * t);
            (d < within && t > 0.05 && t < 0.95).then_some((d, (l.a, l.b)))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, l)| l)
}

fn name_of(swarm: &Swarm, id: u64) -> String {
    match swarm.mimic(id).and_then(|m| m.note.as_ref()) {
        Some(n) => format!("“{}”", short(&n.title, 24)),
        None => format!("a {}", swarm.mimic(id).map_or("mimic", |m| m.species.name())),
    }
}

/// What a mimic is and who it's linked to, in words.
pub fn describe_mimic(swarm: &Swarm, id: u64) -> String {
    let Some(m) = swarm.mimic(id) else { return String::new() };
    let mut links: Vec<_> = swarm.links.iter().filter(|l| l.has(id)).collect();
    links.sort_by(|a, b| b.weight.total_cmp(&a.weight));
    let holding = m.arms.iter().filter(|a| matches!(a.hold, Hold::Mimic(_))).count();
    let mut out = format!(
        "{} · {}{}",
        name_of(swarm, id),
        m.species.name(),
        if m.pinned { " · pinned" } else { "" }
    );
    if holding > 0 {
        out += &format!(" · holding {holding}");
    }
    for l in links.iter().take(4) {
        out += &format!("\n{:.2}  {}{}", l.weight, name_of(swarm, l.other(id)), if l.pinned { "  (kept)" } else { "" });
    }
    if links.is_empty() {
        out += "\nno links yet";
    }
    out + "\ndrag to move · double-click to pin"
}

pub fn describe_link(swarm: &Swarm, (a, b): (u64, u64)) -> String {
    let Some(l) = swarm.link(a, b) else { return String::new() };
    format!(
        "{} – {}\nweight {:.2}{}\nright-click to cut",
        name_of(swarm, a),
        name_of(swarm, b),
        l.weight,
        if l.pinned { " · kept" } else { "" }
    )
}

/// A few lines of text in a paper box beside the pointer.
pub fn tooltip(painter: &egui::Painter, at: Pos2, text: &str) {
    let galley = painter.layout(text.to_owned(), FontId::proportional(14.0), INK, 320.0);
    let rect = Rect::from_min_size(at + vec2(16.0, 12.0), galley.size() + vec2(16.0, 12.0));
    painter.rect_filled(rect, CornerRadius::same(6), SHEET);
    painter.rect_stroke(rect, CornerRadius::same(6), Stroke::new(1.0, FAINT.gamma_multiply(0.5)), egui::StrokeKind::Inside);
    painter.galley(rect.min + vec2(8.0, 6.0), galley, INK);
}

/// The swarm's proposals, in the canvas's top-left corner. Returns a
/// ruling, if one was made: the two notes, and whether to keep the link.
pub fn proposals_ui(
    ui: &mut egui::Ui,
    sheet: Rect,
    proposals: &[Proposal],
    texts: &HashMap<String, String>,
) -> Option<(String, String, bool)> {
    if proposals.is_empty() {
        return None;
    }
    let shown = &proposals[..proposals.len().min(4)];
    let row = 54.0;
    let rect = Rect::from_min_size(
        sheet.min + vec2(14.0, 14.0),
        vec2(380.0, 34.0 + row * shown.len() as f32),
    );
    ui.painter().rect_filled(rect, CornerRadius::same(8), SHEET);
    ui.painter().rect_stroke(rect, CornerRadius::same(8), Stroke::new(1.0, FAINT.gamma_multiply(0.4)), egui::StrokeKind::Inside);
    let more = proposals.len() - shown.len();
    ui.painter().text(
        rect.min + vec2(12.0, 10.0),
        Align2::LEFT_TOP,
        if more > 0 { format!("the mimics suggest ({more} more)") } else { "the mimics suggest".to_owned() },
        FontId::proportional(15.0),
        MUTED,
    );
    let mut ruling = None;
    for (k, p) in shown.iter().enumerate() {
        let top = rect.top() + 32.0 + row * k as f32;
        let body = Rect::from_min_max(pos2(rect.left() + 12.0, top), pos2(rect.right() - 12.0, top + row));
        ui.painter().text(
            body.min,
            Align2::LEFT_TOP,
            format!("{}  ↔  {}", short(&p.a.title, 20), short(&p.b.title, 20)),
            FontId::proportional(16.0),
            INK,
        );
        let words = match (texts.get(&p.a.name), texts.get(&p.b.name)) {
            (Some(a), Some(b)) => shared_words(a, b, 3).join(", "),
            _ => String::new(),
        };
        let why = if words.is_empty() {
            format!("{:.2} · strong {:.0} s", p.weight, p.for_secs)
        } else {
            format!("{:.2} · strong {:.0} s · both say {words}", p.weight, p.for_secs)
        };
        ui.painter().text(body.min + vec2(0.0, 21.0), Align2::LEFT_TOP, short(&why, 52), FontId::proportional(13.0), FAINT);
        // The weight over the last twelve seconds.
        let spark = Rect::from_min_size(pos2(body.right() - 104.0, body.top() + 4.0), vec2(36.0, 14.0));
        let pts: Vec<Pos2> = p
            .history
            .iter()
            .enumerate()
            .map(|(i, w)| pos2(spark.left() + i as f32 * spark.width() / 11.0, spark.bottom() - w * spark.height()))
            .collect();
        ui.painter().add(egui::Shape::line(pts, Stroke::new(1.2, MUTED)));
        let buttons = Rect::from_min_size(pos2(body.right() - 62.0, body.top() - 4.0), vec2(64.0, 26.0));
        ui.scope_builder(egui::UiBuilder::new().max_rect(buttons), |ui| {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 6.0;
                if quiet_link(ui, "keep", true).clicked() {
                    ruling = Some((p.a.name.clone(), p.b.name.clone(), true));
                }
                if quiet_link(ui, "no", false).clicked() {
                    ruling = Some((p.a.name.clone(), p.b.name.clone(), false));
                }
            });
        });
    }
    ruling
}
