//! Notes: plain writing that isn't rules. Ideas, todos, story bits.
//!
//! Each note is a `.md` file in `world/notes/`, shown as a card. Click one to
//! write in it; it saves itself once typing pauses, and Escape or a click off
//! the card puts it down. A note left empty is deleted. Files changed
//! elsewhere (by Claude in a terminal, say) show up within half a second.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use eframe::egui;
use egui::{CornerRadius, FontId, RichText, Sense, Stroke, pos2};

use crate::{FAINT, INK, MUTED, SHEET, quiet_link, title};

/// How long typing pauses before a note saves itself.
const AUTOSAVE: f64 = 0.4;
/// How often the folder is reread for notes changed elsewhere.
const POLL: f64 = 0.5;

struct Note {
    /// File name without `.md`.
    name: String,
    source: String,
}

impl Note {
    /// The first `#` line, or else the first line, or else "Untitled".
    fn title(&self) -> String {
        let first = self.source.lines().map(str::trim).find(|l| !l.is_empty());
        match first {
            Some(l) => l.trim_start_matches('#').trim().to_owned(),
            None => "Untitled".to_owned(),
        }
    }

    /// Everything after the title line.
    fn body(&self) -> String {
        let mut lines = self.source.lines().skip_while(|l| l.trim().is_empty());
        lines.next();
        lines.collect::<Vec<_>>().join("\n").trim().to_owned()
    }
}

struct Editing {
    name: String,
    text: String,
    /// The text as last written to disk.
    saved: String,
    changed_at: f64,
    /// Give the editor the keyboard on its first frame.
    focus: bool,
}

pub struct Notes {
    dir: PathBuf,
    /// Newest first.
    notes: Vec<Note>,
    editing: Option<Editing>,
    last_poll: f64,
}

impl Notes {
    pub fn new(world: &Path) -> Self {
        let mut notes = Self {
            dir: world.join("notes"),
            notes: Vec::new(),
            editing: None,
            last_poll: f64::NEG_INFINITY,
        };
        notes.reload();
        notes
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{name}.md"))
    }

    /// Read the folder again. A note open here and untouched since its last
    /// save takes whatever is on disk.
    fn reload(&mut self) {
        let mut notes = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&self.dir) {
            for path in entries.filter_map(|e| e.ok().map(|e| e.path())) {
                if path.extension().is_some_and(|e| e == "md")
                    && let Some(name) = path.file_stem().and_then(|s| s.to_str())
                    && let Ok(source) = std::fs::read_to_string(&path)
                {
                    notes.push(Note {
                        name: name.to_owned(),
                        source,
                    });
                }
            }
        }
        // Names are timestamps, so this is newest first, and a card doesn't
        // move while it's written in.
        notes.sort_by(|a, b| b.name.cmp(&a.name));
        if let Some(ed) = &mut self.editing
            && let Some(n) = notes.iter().find(|n| n.name == ed.name)
            && n.source != ed.saved
            && ed.text == ed.saved
        {
            ed.text = n.source.clone();
            ed.saved = n.source.clone();
        }
        self.notes = notes;
    }

    /// Every note: its file name, title and text, newest first.
    pub fn all(&self) -> Vec<(String, String, String)> {
        self.notes
            .iter()
            .map(|n| (n.name.clone(), n.title(), n.source.clone()))
            .collect()
    }

    /// Keep a finished note, written somewhere else in the app.
    pub fn add(&mut self, source: &str) {
        let _ = std::fs::create_dir_all(&self.dir);
        let stamp = stamp();
        let name = (0..)
            .map(|n| if n == 0 { stamp.clone() } else { format!("{stamp}-{n}") })
            .find(|n| !self.path(n).exists())
            .unwrap();
        if let Err(e) = std::fs::write(self.path(&name), source) {
            eprintln!("couldn't keep the note: {e}");
        }
        self.reload();
    }

    fn new_note(&mut self, now: f64) {
        self.stop_editing();
        let _ = std::fs::create_dir_all(&self.dir);
        let stamp = stamp();
        let name = (0..)
            .map(|n| if n == 0 { stamp.clone() } else { format!("{stamp}-{n}") })
            .find(|n| !self.path(n).exists())
            .unwrap();
        let source = "# \n".to_owned();
        if std::fs::write(self.path(&name), &source).is_ok() {
            self.reload();
            self.editing = Some(Editing {
                name,
                text: source.clone(),
                saved: source,
                changed_at: now,
                focus: true,
            });
        }
    }

    fn edit(&mut self, name: &str) {
        self.stop_editing();
        if let Some(n) = self.notes.iter().find(|n| n.name == name) {
            self.editing = Some(Editing {
                name: n.name.clone(),
                text: n.source.clone(),
                saved: n.source.clone(),
                changed_at: 0.0,
                focus: true,
            });
        }
    }

    fn save(&mut self) {
        let Some(ed) = &mut self.editing else { return };
        if ed.text == ed.saved {
            return;
        }
        let path = self.dir.join(format!("{}.md", ed.name));
        match std::fs::write(&path, &ed.text) {
            Ok(()) => ed.saved = ed.text.clone(),
            Err(e) => eprintln!("couldn't save {}: {e}", path.display()),
        }
    }

    /// Save the open note and put it down; one left empty is deleted.
    fn stop_editing(&mut self) {
        self.save();
        if let Some(ed) = self.editing.take()
            && ed.text.trim().trim_start_matches('#').trim().is_empty()
        {
            let _ = std::fs::remove_file(self.path(&ed.name));
        }
        self.reload();
    }

    pub fn ui(&mut self, ui: &mut egui::Ui) {
        let now = ui.input(|i| i.time);
        if now - self.last_poll > POLL {
            self.last_poll = now;
            self.reload();
        }
        ui.add_space(14.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new("Notes").font(title(22.0)));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if quiet_link(ui, "+ note", false).clicked() {
                    self.new_note(now);
                }
            });
        });
        ui.label(
            RichText::new("Anything worth keeping that isn't a rule.")
                .color(FAINT)
                .size(15.0),
        );
        ui.label(
            RichText::new(format!("{}", self.dir.display()))
                .color(crate::RULE_LINE)
                .size(12.0),
        );
        ui.add_space(12.0);
        if self.notes.is_empty() {
            ui.label(RichText::new("None yet.").color(FAINT).size(15.0));
        }

        let mut open = None;
        let mut put_down = false;
        for note in &self.notes {
            let editing = self.editing.as_ref().is_some_and(|e| e.name == note.name);
            let card = egui::Frame::new()
                .fill(SHEET)
                .stroke(Stroke::new(1.5, if editing { INK } else { MUTED }))
                .corner_radius(CornerRadius::same(14))
                .inner_margin(egui::Margin::symmetric(16, 12))
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    if editing && let Some(ed) = &mut self.editing {
                        let id = ui.make_persistent_id(("note-editor", &note.name));
                        crate::edit::keys(ui, id, &mut ed.text, None);
                        let response = ui.add(
                            egui::TextEdit::multiline(&mut ed.text)
                                .id(id)
                                .font(FontId::proportional(16.0))
                                .desired_width(f32::INFINITY)
                                .desired_rows(4)
                                .frame(egui::Frame::NONE),
                        );
                        if response.changed() {
                            ed.changed_at = now;
                        }
                        if ed.focus {
                            response.request_focus();
                            ed.focus = false;
                        }
                        return;
                    }
                    ui.label(RichText::new(note.title()).font(title(19.0)));
                    let r = ui.max_rect();
                    let y = ui.cursor().top() + 2.0;
                    ui.painter().line_segment(
                        [pos2(r.left(), y), pos2(r.right(), y)],
                        Stroke::new(1.2, INK),
                    );
                    ui.add_space(8.0);
                    let body = note.body();
                    if !body.is_empty() {
                        ui.label(RichText::new(body).size(16.0));
                    }
                });
            let rect = card.response.rect;
            if editing {
                // Escape, or a click anywhere off the card, puts it down.
                put_down = ui.input(|i| {
                    i.key_pressed(egui::Key::Escape)
                        || (i.pointer.primary_pressed()
                            && i.pointer.interact_pos().is_some_and(|p| !rect.contains(p)))
                });
            } else {
                let click = ui.interact(rect, ui.id().with(("note-card", &note.name)), Sense::click());
                if click.hovered() {
                    ui.ctx().set_cursor_icon(egui::CursorIcon::Text);
                }
                if click.clicked() {
                    open = Some(note.name.clone());
                }
            }
            ui.add_space(14.0);
        }

        if put_down {
            self.stop_editing();
        } else if let Some(ed) = &self.editing
            && ed.text != ed.saved
            && now - ed.changed_at >= AUTOSAVE
        {
            self.save();
        }
        if let Some(name) = open {
            self.edit(&name);
        }
        if self.editing.is_some() {
            ui.ctx()
                .request_repaint_after(std::time::Duration::from_secs_f64(AUTOSAVE));
        }
    }
}

/// Now, as a file name that sorts by time: `2026-10-08-2201-05`, in UTC.
fn stamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs()) as i64;
    let (days, rest) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (y, m, d) = civil(days);
    format!(
        "{y:04}-{m:02}-{d:02}-{:02}{:02}-{:02}",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// Days since 1970-01-01 to (year, month, day), after Howard Hinnant.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_734), (2026, 10, 8));
        assert_eq!(civil(11_016), (2000, 2, 29));
    }

    #[test]
    fn title_and_body() {
        let n = Note {
            name: "x".into(),
            source: "\n# Smoke\nFire should leave smoke.\n\nLater: wind.".into(),
        };
        assert_eq!(n.title(), "Smoke");
        assert_eq!(n.body(), "Fire should leave smoke.\n\nLater: wind.");
        let untitled = Note { name: "y".into(), source: "".into() };
        assert_eq!(untitled.title(), "Untitled");
    }
}
