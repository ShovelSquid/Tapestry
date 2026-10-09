//! Prose to rule lines, as you write.
//!
//! While a rule note is open, a moment after you stop typing its title and
//! prose go to a model, and the rule lines that come back replace the note's
//! own, checked by the parser first. Write rule lines yourself and it stops,
//! so it never overwrites your hand.
//!
//! By default the model is local: a small one on Ollama, held to a JSON
//! schema built from the basic rules, so it can only name materials,
//! properties and rules that exist. `TAPESTRY_MODEL` picks another Ollama
//! model; `TAPESTRY_TRANSLATE=claude` uses the `claude` command instead
//! (whatever Claude Code is signed in as).

use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use eframe::egui;
use egui::{FontId, RichText};
use serde_json::{Value as Json, json};
use tapestry_canvas::{Material, Prop, RuleNote, grammar, is_rule_line};

use crate::{DOT, FAINT, MUTED};

/// How long typing has to pause before the prose is sent.
const PAUSE: f64 = 1.0;
/// The Claude model, when translating with Claude: fast enough to keep up
/// with typing.
const CLAUDE_MODEL: &str = "haiku";
/// The local model: small, and good at this with the schema holding it.
const LOCAL_MODEL: &str = "qwen3:4b";
const OLLAMA: &str = "http://localhost:11434";
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
        warm_up();
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
                (Status::Done, _) => (format!("translated from your prose by {}", backend()), FAINT),
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

fn translate(prose: &str, current: &[String]) -> Reply {
    match backend() {
        Backend::Claude => translate_with_claude(prose, current),
        Backend::Local(model) => translate_locally(&model, prose, current),
    }
}

enum Backend {
    Local(String),
    Claude,
}

fn backend() -> Backend {
    if std::env::var("TAPESTRY_TRANSLATE").is_ok_and(|v| v == "claude") {
        Backend::Claude
    } else {
        Backend::Local(std::env::var("TAPESTRY_MODEL").unwrap_or_else(|_| LOCAL_MODEL.into()))
    }
}

impl std::fmt::Display for Backend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Backend::Local(model) => write!(f, "{model}"),
            Backend::Claude => write!(f, "Claude"),
        }
    }
}

/// Load the local model while the author is still reading the note, so the
/// first translation doesn't wait for it.
fn warm_up() {
    if let Backend::Local(model) = backend() {
        std::thread::spawn(move || {
            let _ = agent()
                .post(&format!("{OLLAMA}/api/generate"))
                .send_json(json!({ "model": model, "keep_alive": "30m" }));
        });
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(TIMEOUT))
        .build()
        .into()
}

/// One rule as the local model gives it: the basic rules' words as fields,
/// with every material and property an enum, so it can't name one that
/// doesn't exist.
fn schema() -> Json {
    let materials: Vec<&str> = Material::ALL.iter().map(|m| m.name()).collect();
    let mut becomes = materials.clone();
    becomes.push("nothing");
    let props: Vec<&str> = Prop::ALL.iter().map(|p| p.name()).collect();
    json!({
        "type": "object",
        "properties": {
            "rules": { "type": "array", "items": { "anyOf": [
                {
                    "type": "object",
                    "properties": {
                        "rule": { "enum": ["change"] },
                        "who": { "enum": materials },
                        "prop": { "enum": props },
                        "rate_per_second": { "type": "number" },
                        "within": { "type": "number" },
                        "of": { "type": "array", "items": { "enum": materials }, "minItems": 1 }
                    },
                    "required": ["rule", "who", "prop", "rate_per_second", "within", "of"]
                },
                {
                    "type": "object",
                    "properties": {
                        "rule": { "enum": ["convert"] },
                        "who": { "enum": materials },
                        "to": { "enum": becomes },
                        "when": { "enum": props },
                        "reaches": { "type": "number" },
                        "spread_percent": { "type": "number" }
                    },
                    "required": ["rule", "who", "to", "when", "reaches", "spread_percent"]
                }
            ]}},
            "needs": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["rules", "needs"]
    })
}

fn local_system() -> String {
    let names = |v: Vec<&str>| v.join(", ");
    format!(
        "You translate an author's plain-language rule for a particle canvas into rules \
the canvas runs.

There are two kinds of rule:
- change: while a <who> is within <within> canvas units of any material in <of>, its \
property <prop> changes by <rate_per_second> each second.
- convert: when a <who>'s property <when> reaches <reaches>, it becomes <to> \
(\"nothing\" makes it vanish). spread_percent varies each particle's threshold \
(use 30-60) so a crowd doesn't turn all at once.

Materials: {materials}. Properties: {props}. Properties start at 0 and only change \
rules move them.

What materials do on their own: ink blots and dries (wet ink flows); water falls and \
pools; trees hang and sway; fire burns its fuel for a few seconds giving off flames, \
then becomes ash; flames rise and die within a second; ash falls and piles. How \
materials act on each other comes only from rules.

Most effects are a pair: a change that builds a property near something, then a \
convert when it's high enough. To make something vanish, build its own property and \
convert it to nothing. Make the rules about the thing the prose is about.

Numbers that work: \"near\" or \"touching\" is within 8-20. Rates reach the \
threshold in 0.3-2 seconds. Example, \"A tree near fire heats up and catches\":
{{\"rules\":[{{\"rule\":\"change\",\"who\":\"tree\",\"prop\":\"heat\",\"rate_per_second\":1.5,\"within\":18,\"of\":[\"fire\",\"flame\"]}},{{\"rule\":\"convert\",\"who\":\"tree\",\"to\":\"fire\",\"when\":\"heat\",\"reaches\":1,\"spread_percent\":60}}],\"needs\":[]}}

If the prose asks for something not listed here (another material, property or kind \
of rule), say what in \"needs\", in a few words.",
        materials = names(Material::ALL.iter().map(|m| m.name()).collect()),
        props = names(Prop::ALL.iter().map(|p| p.name()).collect()),
    )
}

fn translate_locally(model: &str, prose: &str, current: &[String]) -> Reply {
    let mut ask = prose.to_owned();
    if !current.is_empty() {
        ask.push_str(
            "\n\nThe note's rules so far, as rule lines (keep any that still fit the \
             prose, with the same numbers):\n",
        );
        ask.push_str(&current.join("\n"));
    }
    let body = json!({
        "model": model,
        "stream": false,
        "think": false,
        "keep_alive": "30m",
        "format": schema(),
        "options": { "temperature": 0 },
        "messages": [
            { "role": "system", "content": local_system() },
            { "role": "user", "content": ask }
        ]
    });
    let mut response = agent()
        .post(&format!("{OLLAMA}/api/chat"))
        .send_json(&body)
        .map_err(|_| "Ollama isn't running (open the Ollama app)".to_owned())?;
    let status = response.status();
    let reply: Json = response
        .body_mut()
        .read_json()
        .map_err(|e| format!("Ollama sent something odd: {e}"))?;
    if !status.is_success() {
        let msg = reply["error"].as_str().unwrap_or("unknown error");
        if msg.contains("not found") {
            return Err(format!("run `ollama pull {model}` first"));
        }
        return Err(format!("Ollama: {msg}"));
    }
    let content = reply["message"]["content"].as_str().unwrap_or("");
    let out: Json =
        serde_json::from_str(content).map_err(|e| format!("{model} sent bad JSON: {e}"))?;
    let lines = from_json(&out);
    // The schema keeps the words right; anything that still doesn't read
    // (an odd number) is left out rather than written into the note.
    Ok(lines
        .into_iter()
        .filter(|l| l.starts_with("//") || RuleNote::parse("draft", l).problems.is_empty())
        .collect())
}

/// The local model's rules, as rule lines and notes on what's missing.
fn from_json(out: &Json) -> Vec<String> {
    let s = |v: &Json| v.as_str().unwrap_or("").to_owned();
    let n = |v: &Json| v.as_f64().unwrap_or(0.0) as f32;
    let mut lines = Vec::new();
    // Changes first, then the converts they lead to: how a note reads.
    let mut rules: Vec<&Json> = out["rules"].as_array().into_iter().flatten().collect();
    rules.sort_by_key(|r| r["rule"] != "change");
    for r in rules {
        match r["rule"].as_str() {
            Some("change") => {
                let of: Vec<String> =
                    r["of"].as_array().into_iter().flatten().map(s).collect();
                lines.push(format!(
                    "change {} {} {:+}/s within {} of {}",
                    s(&r["who"]),
                    s(&r["prop"]),
                    n(&r["rate_per_second"]),
                    n(&r["within"]),
                    of.join(" or ")
                ));
            }
            Some("convert") => {
                let mut line = format!(
                    "convert {} to {} at {} {}",
                    s(&r["who"]),
                    s(&r["to"]),
                    s(&r["when"]),
                    n(&r["reaches"])
                );
                let spread = n(&r["spread_percent"]).round();
                if spread > 0.0 {
                    line.push_str(&format!(" ±{spread}%"));
                }
                lines.push(line);
            }
            _ => {}
        }
    }
    let materials: Vec<&str> = Material::ALL.iter().map(|m| m.name()).collect();
    for need in out["needs"].as_array().into_iter().flatten() {
        let need = need.as_str().unwrap_or("").trim();
        // Small models sometimes "need" a thing that's already here.
        if !need.is_empty() && !materials.contains(&need) {
            lines.push(format!("{NEEDS} {need}"));
        }
    }
    lines
}

/// Ask once; if a line doesn't read, ask again with what the parser said.
fn translate_with_claude(prose: &str, current: &[String]) -> Reply {
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
        .args(["-p", "--model", CLAUDE_MODEL, "--tools", "", "--no-session-persistence"])
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
    fn local_rules_become_rule_lines_that_read() {
        let out = json!({
            "rules": [
                { "rule": "convert", "who": "tree", "to": "nothing", "when": "heat",
                  "reaches": 1, "spread_percent": 60 },
                { "rule": "change", "who": "tree", "prop": "heat", "rate_per_second": 1.5,
                  "within": 18, "of": ["fire", "flame"] }
            ],
            "needs": ["a smoke material", "ash"]
        });
        let lines = from_json(&out);
        assert_eq!(
            lines,
            [
                "change tree heat +1.5/s within 18 of fire or flame",
                "convert tree to nothing at heat 1 ±60%",
                "// needs: a smoke material",
            ]
        );
        assert!(RuleNote::parse("t", &lines.join("\n")).problems.is_empty());
    }

    #[test]
    fn placeholder_prose_isnt_translated() {
        assert!(blank(&prose(NEW_NOTE)));
        assert!(!blank(&prose("# Fire\nFire burns trees.")));
    }
}
