//! Prose to rule lines, as you write.
//!
//! While a rule note is open, a moment after you stop typing its title and
//! prose go to Claude, and the rule lines that come back replace the note's
//! own, checked by the parser first. It runs the `claude` command, so it uses
//! whatever Claude Code is signed in as: there's no key to set. Write rule
//! lines yourself and it stops, so it never overwrites your hand.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use eframe::egui;
use egui::{FontId, RichText};
use tapestry_canvas::{RuleNote, grammar, is_rule_line};

use crate::{DOT, FAINT, MUTED};

/// How long typing has to pause before the prose is sent.
const PAUSE: f64 = 1.0;
/// Fast enough to keep up with typing; the grammar is small.
const MODEL: &str = "haiku";
const TIMEOUT: Duration = Duration::from_secs(60);
/// Comments a translation adds about what isn't built start with this, so
/// the next translation can replace them.
const NEEDS: &str = "// needs:";

/// What a new note starts with.
pub const NEW_NOTE: &str = "# Untitled\nWhat should happen?\n\n// change tree heat +1/s within 10 of fire\n// convert tree to ash at heat 1\n";
const PLACEHOLDER: &str = "What should happen?";

enum Status {
    Idle,
    Waiting,
    Translating,
    Done,
    Failed(String),
}

type Reply = Result<Vec<String>, String>;

/// Translation for the one note being edited.
pub struct Translator {
    /// The prose the note's rule lines were last made from.
    translated: String,
    /// The rule lines as last set, by opening the note or by a translation.
    /// When the text's own differ, the author wrote them.
    lines: Vec<String>,
    /// The prose as of the last frame, and when it last changed.
    prose: String,
    edited_at: f64,
    pending: Option<(String, mpsc::Receiver<Reply>)>,
    auto: bool,
    status: Status,
}

impl Translator {
    pub fn new(source: &str) -> Self {
        let prose = prose(source);
        let lines = rule_lines(source);
        Self {
            // A note that already says something was translated, by hand or
            // otherwise; one that says nothing yet gets translated now.
            translated: if lines.is_empty() {
                String::new()
            } else {
                prose.clone()
            },
            lines,
            prose,
            edited_at: f64::NEG_INFINITY,
            pending: None,
            auto: true,
            status: Status::Idle,
        }
    }

    /// Before the editor is drawn: take a finished translation into `text`,
    /// and start one if the prose has changed and typing has paused. Returns
    /// whether `text` changed.
    pub fn frame(&mut self, text: &mut String, now: f64, ctx: &egui::Context) -> bool {
        if self.auto && rule_lines(text) != self.lines {
            self.auto = false;
            self.pending = None;
            self.status = Status::Idle;
        }
        let prose = prose(text);
        if prose != self.prose {
            self.prose = prose.clone();
            self.edited_at = now;
        }

        let mut changed = false;
        if let Some((sent, rx)) = &self.pending {
            match rx.try_recv() {
                Ok(reply) => {
                    let sent = sent.clone();
                    self.pending = None;
                    match reply {
                        // Stale replies are dropped; the newer prose goes next.
                        Ok(lines) if sent == prose => {
                            *text = splice(text, &lines);
                            self.lines = rule_lines(text);
                            self.translated = sent;
                            self.status = Status::Done;
                            changed = true;
                        }
                        Ok(_) => self.status = Status::Idle,
                        Err(e) => {
                            // Don't retry until the prose changes.
                            self.translated = sent;
                            self.status = Status::Failed(e);
                        }
                    }
                }
                Err(mpsc::TryRecvError::Empty) => {}
                Err(mpsc::TryRecvError::Disconnected) => self.pending = None,
            }
        }

        if self.auto && self.pending.is_none() && prose != self.translated && !blank(&prose) {
            let wait = PAUSE - (now - self.edited_at);
            if wait <= 0.0 {
                self.pending = Some((prose.clone(), spawn(prose, self.lines.clone(), ctx)));
                self.status = Status::Translating;
            } else {
                self.status = Status::Waiting;
                ctx.request_repaint_after(Duration::from_secs_f64(wait));
            }
        }
        changed
    }

    /// Below the editor: what the canvas will run, and what translation is
    /// doing.
    pub fn show(&mut self, ui: &mut egui::Ui, text: &str) {
        let note = RuleNote::parse("draft", text);
        ui.add_space(6.0);
        ui.label(RichText::new("runs as").color(FAINT).size(12.0));
        let mono = FontId::monospace(13.0);
        for b in &note.basics {
            ui.label(RichText::new(b.to_string()).font(mono.clone()).color(MUTED));
        }
        for p in &note.problems {
            ui.label(
                RichText::new(format!("line {}: {}", p.line, p.message))
                    .color(DOT)
                    .size(13.0),
            );
        }
        for l in text.lines().filter(|l| l.trim().starts_with(NEEDS)) {
            let what = l.trim()[NEEDS.len()..].trim();
            ui.label(RichText::new(format!("needs {what}")).color(FAINT).italics().size(13.0));
        }
        if note.inert() && note.problems.is_empty() {
            ui.label(RichText::new("nothing yet").color(FAINT).size(13.0));
        }

        ui.add_space(4.0);
        ui.horizontal(|ui| {
            let (label, color) = match (&self.status, self.auto) {
                (_, false) => ("translating is off: the rule lines are yours".to_owned(), FAINT),
                (Status::Waiting, _) => ("translating when you pause…".to_owned(), FAINT),
                (Status::Translating, _) => ("translating…".to_owned(), FAINT),
                (Status::Done, _) => ("translated from your prose".to_owned(), FAINT),
                (Status::Failed(e), _) => (format!("couldn't translate: {e}"), DOT),
                (Status::Idle, _) => ("translates as you write".to_owned(), FAINT),
            };
            ui.label(RichText::new(label).color(color).size(12.0));
            let toggle = if self.auto { "stop" } else { "translate again" };
            if crate::quiet_link(ui, toggle, false).clicked() {
                self.auto = !self.auto;
                self.pending = None;
                self.status = Status::Idle;
                if self.auto {
                    self.lines = rule_lines(text);
                    self.translated.clear();
                    self.edited_at = f64::NEG_INFINITY;
                }
            }
        });
        if matches!(self.status, Status::Waiting | Status::Translating) {
            ui.ctx().request_repaint_after(Duration::from_millis(250));
        }
    }
}

/// The note's title and prose: what translation reads.
fn prose(source: &str) -> String {
    let note = RuleNote::parse("", source);
    format!("# {}\n{}", note.title, note.text)
}

fn blank(prose: &str) -> bool {
    let body = prose.split_once('\n').map_or("", |(_, b)| b).trim();
    body.is_empty() || body == PLACEHOLDER
}

fn rule_lines(source: &str) -> Vec<String> {
    source
        .lines()
        .map(str::trim)
        .filter(|l| is_rule_line(l))
        .map(str::to_owned)
        .collect()
}

/// `source` with its rule lines, earlier translation notes and the new-note
/// examples replaced by `lines`, which go at the end below the prose.
fn splice(source: &str, lines: &[String]) -> String {
    let examples: Vec<&str> = NEW_NOTE.lines().filter(|l| l.starts_with("//")).collect();
    let mut kept: Vec<&str> = source
        .lines()
        .filter(|l| {
            let t = l.trim();
            !is_rule_line(t) && !t.starts_with(NEEDS) && !examples.contains(&t)
        })
        .collect();
    while kept.last().is_some_and(|l| l.trim().is_empty()) {
        kept.pop();
    }
    let mut out = kept.join("\n");
    if !lines.is_empty() {
        out.push_str("\n\n");
        out.push_str(&lines.join("\n"));
    }
    out.push('\n');
    out
}

fn spawn(prose: String, current: Vec<String>, ctx: &egui::Context) -> mpsc::Receiver<Reply> {
    let (tx, rx) = mpsc::channel();
    let ctx = ctx.clone();
    std::thread::spawn(move || {
        let _ = tx.send(translate(&prose, &current));
        ctx.request_repaint();
    });
    rx
}

/// Ask once; if a line doesn't read, ask again with what the parser said.
fn translate(prose: &str, current: &[String]) -> Reply {
    let mut ask = prose.to_owned();
    if !current.is_empty() {
        ask.push_str(
            "\n\nThe note's rule lines so far (keep any that still fit the prose, \
             with the same numbers):\n",
        );
        ask.push_str(&current.join("\n"));
    }
    let lines = clean(&claude(&ask)?);
    let problems = RuleNote::parse("draft", &lines.join("\n")).problems;
    if problems.is_empty() {
        return Ok(lines);
    }
    let said: Vec<String> = problems
        .iter()
        .map(|p| format!("- \"{}\": {}", lines[p.line - 1], p.message))
        .collect();
    ask.push_str(&format!(
        "\n\nYou replied:\n{}\n\nThese lines don't read:\n{}\n\nReply again, corrected.",
        lines.join("\n"),
        said.join("\n")
    ));
    Ok(clean(&claude(&ask)?))
}

/// Keep only rule lines and notes on what's missing, whatever else came back.
fn clean(reply: &str) -> Vec<String> {
    reply
        .lines()
        .map(str::trim)
        .filter_map(|l| {
            if is_rule_line(l) {
                Some(l.to_owned())
            } else if let Some(c) = l.strip_prefix("//") {
                let c = c.trim();
                let c = c.strip_prefix("needs:").map_or(c, str::trim);
                Some(format!("{NEEDS} {c}"))
            } else {
                None
            }
        })
        .collect()
}

fn system() -> String {
    format!(
        "You translate an author's plain-language rule for a particle canvas into \
rule lines the canvas runs. The author writes a title and prose; you write what it \
means in the basic rules.

{grammar}

What materials do on their own: ink blots and dries (wet ink flows); water falls and \
pools; trees hang and sway; fire burns its fuel for a few seconds giving off flames, \
then becomes ash; flames rise and die within a second; ash falls and piles. How \
materials act on each other comes only from rule lines.

Notes that already work, for the scale of numbers:
change tree heat +1.5/s within 18 of fire or flame
convert tree to fire at heat 1 ±60%
change ink wet +3/s within 10 of water
change fire wet +6/s within 11 of water
convert fire to ash at wet 0.3
change flame wet +60/s within 9 of water
convert flame to nothing at wet 0.5

Most effects are a pair: a change that builds a property up near something, then a \
convert when it's high enough. A material can be made to vanish by building up its \
own property near something and converting it to nothing.

Reply with only rule lines, one per line, and nothing else: no prose, no code fences. \
Use only the materials, properties and basic rules listed. If the prose asks for \
something that isn't built, add a line \"{NEEDS} <what's missing>\". If nothing can be \
expressed, reply with only such lines.",
        grammar = grammar()
    )
}

fn claude(ask: &str) -> Result<String, String> {
    let bin = find_claude().ok_or("no claude command found")?;
    let mut child = Command::new(bin)
        .args(["-p", "--model", MODEL, "--tools", "", "--no-session-persistence"])
        .arg("--strict-mcp-config")
        .arg("--system-prompt")
        .arg(system())
        .arg(ask)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let err = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > TIMEOUT {
            let _ = child.kill();
            return Err("claude took too long".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let out = out.join().unwrap_or_default();
    if status.success() {
        Ok(out)
    } else {
        let err = err.join().unwrap_or_default();
        let why = err.lines().chain(out.lines()).find(|l| !l.trim().is_empty());
        Err(why.unwrap_or("claude failed").trim().to_owned())
    }
}

/// `claude` on the PATH, or where its installer puts it: an app opened from
/// the Dock doesn't get the shell's PATH.
fn find_claude() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .chain(home.iter().flat_map(|h| [h.join(".local/bin"), h.join(".claude/local")]))
        .chain([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")])
        .map(|d| d.join("claude"))
        .find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splice_replaces_rule_lines_and_keeps_prose() {
        let src = "# Fire\nIt burns.\n\nchange tree heat +1/s within 10 of fire\n// needs: smoke\n// mine\n";
        let out = splice(src, &["convert tree to ash at heat 1".into(), "// needs: wind".into()]);
        assert_eq!(out, "# Fire\nIt burns.\n\n// mine\n\nconvert tree to ash at heat 1\n// needs: wind\n");
    }

    #[test]
    fn splice_drops_the_new_note_examples() {
        let out = splice(NEW_NOTE, &["convert tree to ash at heat 1".into()]);
        assert_eq!(out, "# Untitled\nWhat should happen?\n\nconvert tree to ash at heat 1\n");
    }

    #[test]
    fn clean_keeps_only_rule_lines_and_needs() {
        let reply = "```\nchange ink wet +3/s within 10 of water\nHere you go!\n// a weight property\n```";
        assert_eq!(
            clean(reply),
            ["change ink wet +3/s within 10 of water", "// needs: a weight property"]
        );
    }

    #[test]
    fn placeholder_prose_isnt_translated() {
        assert!(blank(&prose(NEW_NOTE)));
        assert!(!blank(&prose("# Fire\nFire burns trees.")));
    }
}
