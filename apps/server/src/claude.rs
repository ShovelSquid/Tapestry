//! Claude Code's own records: the sessions you've had, and which are running.
//!
//! Every session's transcript is `~/.claude/projects/<folder>/<id>.jsonl`;
//! its lines name the folder it ran in, and the first thing you asked is
//! the best title it has. A running Claude writes `~/.claude/sessions/<pid>.json`.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;

use serde::Serialize;

fn claude_dir() -> PathBuf {
    crate::session::home().join(".claude")
}

/// The transcript of session `id`, if it has one yet.
pub fn transcript(id: &str) -> Option<PathBuf> {
    let file = format!("{id}.jsonl");
    std::fs::read_dir(claude_dir().join("projects"))
        .ok()?
        .flatten()
        .map(|d| d.path().join(&file))
        .find(|p| p.is_file())
}

/// The session Claude process `pid` is running, if it says.
pub fn running_session(pid: u32) -> Option<String> {
    let text = std::fs::read_to_string(claude_dir().join(format!("sessions/{pid}.json"))).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let id = v.get("sessionId")?.as_str()?;
    crate::session::valid_claude_id(id).then(|| id.to_owned())
}

/// Every session some Claude process says it's running.
fn running() -> Vec<String> {
    let Ok(dir) = std::fs::read_dir(claude_dir().join("sessions")) else {
        return Vec::new();
    };
    dir.flatten()
        .filter_map(|e| {
            let pid: u32 = e.path().file_stem()?.to_str()?.parse().ok()?;
            std::path::Path::new(&format!("/proc/{pid}")).exists().then_some(())?;
            running_session(pid)
        })
        .collect()
}

#[derive(Serialize)]
pub struct Past {
    pub id: String,
    pub cwd: Option<PathBuf>,
    pub title: String,
    /// Unix time it was last written to.
    pub at: f64,
    /// A Claude process has it open right now, here or elsewhere.
    pub running: bool,
}

/// The `limit` sessions written to most recently, newest first.
pub fn recent(limit: usize) -> Vec<Past> {
    let mut files: Vec<(f64, PathBuf)> = std::fs::read_dir(claude_dir().join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|d| std::fs::read_dir(d.path()).ok())
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|p| {
            let at = p.metadata().ok()?.modified().ok()?;
            let at = at.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs_f64();
            Some((at, p))
        })
        .collect();
    files.sort_by(|a, b| b.0.total_cmp(&a.0));
    let running = running();
    files
        .into_iter()
        .filter_map(|(at, path)| {
            let id = path.file_stem()?.to_str()?.to_owned();
            if !crate::session::valid_claude_id(&id) {
                return None;
            }
            let (cwd, title) = describe(&path);
            Some(Past {
                running: running.contains(&id),
                id,
                cwd,
                title: title?,
                at,
            })
        })
        .take(limit)
        .collect()
}

/// The folder a transcript ran in, and the first thing typed into it. A
/// transcript with nothing typed (a session opened and left) has no title.
fn describe(path: &PathBuf) -> (Option<PathBuf>, Option<String>) {
    let Ok(f) = std::fs::File::open(path) else {
        return (None, None);
    };
    let (mut cwd, mut title) = (None, None);
    for line in BufReader::new(f).lines().take(400).map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        if cwd.is_none() {
            cwd = v.get("cwd").and_then(|c| c.as_str()).map(PathBuf::from);
        }
        if let Some(t) = v.get("customTitle").and_then(|t| t.as_str()) {
            title = Some(t.to_owned());
        }
        if title.is_none() && v.get("type").and_then(|t| t.as_str()) == Some("user") {
            title = prompt(&v);
        }
        if cwd.is_some() && title.is_some() {
            break;
        }
    }
    (cwd, title.map(|t| clip(&t, 140)))
}

/// What the user wrote in a transcript line, skipping what Claude Code itself
/// puts there (tool results, command and system tags, resumed summaries).
fn prompt(v: &serde_json::Value) -> Option<String> {
    let content = v.pointer("/message/content")?;
    let text = match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(parts) => parts
            .iter()
            .filter(|p| p.get("type").and_then(|t| t.as_str()) == Some("text"))
            .filter_map(|p| p.get("text")?.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        _ => return None,
    };
    let text = text.trim();
    if text.is_empty() || text.starts_with('<') || text.starts_with("This session is being continued") {
        return None;
    }
    Some(text.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn clip(s: &str, n: usize) -> String {
    match s.char_indices().nth(n) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_owned(),
    }
}
