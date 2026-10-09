//! Where a terminal has been: the files the program in it read and changed.
//!
//! A Claude Code session says so exactly. `~/.claude/sessions/<pid>.json`
//! names the session, its transcript is `~/.claude/projects/*/<id>.jsonl`,
//! and every Read, Edit and Write there carries a `file_path`. Anything else
//! running in the terminal (vim, nano, less…) is followed by the files named
//! on its command line.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use eframe::egui;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Touch {
    /// Named on an editor's or viewer's command line.
    Open,
    Read,
    Edit,
}

#[derive(Clone, Debug)]
pub struct Visit {
    /// Unix time in seconds.
    pub at: f64,
    pub path: PathBuf,
    pub touch: Touch,
}

/// A Claude Code session running in the terminal.
#[derive(Clone, Default)]
pub struct Claude {
    pub name: String,
    pub status: String,
}

#[derive(Default)]
pub struct Trail {
    /// Oldest first. Back-to-back touches of one file are one visit.
    pub visits: Vec<Visit>,
    pub claude: Option<Claude>,
}

impl Trail {
    pub fn last(&self) -> Option<&Visit> {
        self.visits.last()
    }

    /// Where the terminal was at time `t`.
    pub fn at(&self, t: f64) -> Option<&Visit> {
        self.visits.iter().rev().find(|v| v.at <= t).or(self.visits.first())
    }

    fn push(&mut self, at: f64, path: PathBuf, touch: Touch) {
        let path = path.canonicalize().unwrap_or(path);
        if let Some(last) = self.visits.last_mut()
            && last.path == path
        {
            last.at = last.at.max(at);
            last.touch = last.touch.max(touch);
            return;
        }
        self.visits.push(Visit { at, path, touch });
    }
}

pub fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64())
}

/// Follow what runs under `shell_pid` until `exited`, once a second.
pub fn watch(shell_pid: u32, exited: Arc<AtomicBool>, ctx: egui::Context) -> Arc<Mutex<Trail>> {
    let trail = Arc::new(Mutex::new(Trail::default()));
    let shared = trail.clone();
    std::thread::spawn(move || {
        let mut transcript: Option<Transcript> = None;
        let mut open_now: HashSet<PathBuf> = HashSet::new();
        let mut cwds: HashMap<u32, Option<PathBuf>> = HashMap::new();
        while !exited.load(Ordering::Relaxed) {
            let procs = processes();
            let under = descendants(shell_pid, &procs);
            let claude = under.iter().find_map(|&pid| Some((pid, session(pid)?)));
            let mut changed = false;

            // Claude, and everything Claude runs, speaks through the transcript.
            let mut skip = HashSet::new();
            match &claude {
                Some((pid, s)) => {
                    skip.insert(*pid);
                    skip.extend(descendants(*pid, &procs));
                    if transcript.as_ref().is_none_or(|t| t.session != s.id) {
                        transcript = Transcript::find(&s.id);
                    }
                    let mut tr = shared.lock().unwrap();
                    let info = Claude {
                        name: s.name.clone(),
                        status: s.status.clone(),
                    };
                    changed |= tr.claude.as_ref().is_none_or(|c| c.name != info.name || c.status != info.status);
                    tr.claude = Some(info);
                    drop(tr);
                    if let Some(t) = &mut transcript {
                        let new = t.read();
                        if !new.is_empty() {
                            let mut tr = shared.lock().unwrap();
                            for (at, path, touch) in new {
                                tr.push(at, path, touch);
                            }
                            changed = true;
                        }
                    }
                }
                None => {
                    transcript = None;
                    let mut tr = shared.lock().unwrap();
                    changed |= tr.claude.take().is_some();
                }
            }

            // Anything else: files named on its command line.
            let mut seen = HashSet::new();
            for p in procs.iter().filter(|p| under.contains(&p.pid) && !skip.contains(&p.pid)) {
                for arg in p.args.split_whitespace().skip(1) {
                    if arg.starts_with('-') {
                        continue;
                    }
                    let path = if Path::new(arg).is_absolute() {
                        PathBuf::from(arg)
                    } else {
                        let Some(cwd) = cwds.entry(p.pid).or_insert_with(|| cwd_of(p.pid)) else {
                            continue;
                        };
                        cwd.join(arg)
                    };
                    if path.is_file() {
                        seen.insert(path.canonicalize().unwrap_or(path));
                    }
                }
            }
            cwds.retain(|pid, _| under.contains(pid));
            for path in seen.difference(&open_now) {
                shared.lock().unwrap().push(now(), path.clone(), Touch::Open);
                changed = true;
            }
            open_now = seen;

            if changed {
                ctx.request_repaint();
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
    trail
}

struct Proc {
    pid: u32,
    ppid: u32,
    args: String,
}

fn processes() -> Vec<Proc> {
    let Ok(out) = std::process::Command::new("ps")
        .args(["-axo", "pid=,ppid=,args="])
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            let pid = parts.next()?.parse().ok()?;
            let ppid = parts.next()?.parse().ok()?;
            Some(Proc {
                pid,
                ppid,
                args: parts.collect::<Vec<_>>().join(" "),
            })
        })
        .collect()
}

/// Every process below `root`, nearest first.
fn descendants(root: u32, procs: &[Proc]) -> Vec<u32> {
    let mut out = Vec::new();
    let mut frontier = vec![root];
    while let Some(p) = frontier.pop() {
        for c in procs.iter().filter(|c| c.ppid == p) {
            out.push(c.pid);
            frontier.push(c.pid);
        }
    }
    out
}

fn cwd_of(pid: u32) -> Option<PathBuf> {
    let out = std::process::Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find_map(|l| l.strip_prefix('n').map(PathBuf::from))
}

fn claude_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| Path::new(&h).join(".claude"))
}

struct Session {
    id: String,
    name: String,
    status: String,
}

/// The Claude Code session process `pid` is running, if it is one.
fn session(pid: u32) -> Option<Session> {
    let text = std::fs::read_to_string(claude_dir()?.join(format!("sessions/{pid}.json"))).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_owned();
    Some(Session {
        id: s("sessionId"),
        name: s("name"),
        status: s("status"),
    })
}

struct Transcript {
    session: String,
    path: PathBuf,
    read_to: u64,
    partial: String,
}

impl Transcript {
    fn find(session: &str) -> Option<Self> {
        let file = format!("{session}.jsonl");
        let projects = claude_dir()?.join("projects");
        let path = std::fs::read_dir(projects)
            .ok()?
            .flatten()
            .map(|d| d.path().join(&file))
            .find(|p| p.is_file())?;
        Some(Self {
            session: session.to_owned(),
            path,
            read_to: 0,
            partial: String::new(),
        })
    }

    /// The files touched in lines written since the last read.
    fn read(&mut self) -> Vec<(f64, PathBuf, Touch)> {
        let Ok(mut f) = std::fs::File::open(&self.path) else {
            return Vec::new();
        };
        let mut bytes = Vec::new();
        if f.seek(SeekFrom::Start(self.read_to)).is_err() || f.read_to_end(&mut bytes).is_err() {
            return Vec::new();
        }
        self.read_to += bytes.len() as u64;
        self.partial.push_str(&String::from_utf8_lossy(&bytes));
        let Some(end) = self.partial.rfind('\n') else {
            return Vec::new();
        };
        let complete: String = self.partial.drain(..=end).collect();
        complete
            .lines()
            .filter(|l| l.contains("\"tool_use\""))
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .flat_map(|v| touches(&v))
            .collect()
    }
}

fn touches(line: &serde_json::Value) -> Vec<(f64, PathBuf, Touch)> {
    let at = line
        .get("timestamp")
        .and_then(|t| t.as_str())
        .and_then(parse_time)
        .unwrap_or_else(now);
    let Some(content) = line.pointer("/message/content").and_then(|c| c.as_array()) else {
        return Vec::new();
    };
    content
        .iter()
        .filter(|c| c.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
        .filter_map(|c| {
            let touch = match c.get("name")?.as_str()? {
                "Read" => Touch::Read,
                "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => Touch::Edit,
                _ => return None,
            };
            let input = c.get("input")?;
            let path = input
                .get("file_path")
                .or(input.get("notebook_path"))?
                .as_str()?;
            Some((at, PathBuf::from(path), touch))
        })
        .collect()
}

/// `2026-10-09T04:50:10.651Z` as Unix seconds.
fn parse_time(s: &str) -> Option<f64> {
    let (date, time) = s.trim_end_matches('Z').split_once('T')?;
    let mut d = date.split('-').map(|x| x.parse::<i64>());
    let (y, m, day) = (d.next()?.ok()?, d.next()?.ok()?, d.next()?.ok()?);
    let mut t = time.split(':');
    let (h, min) = (t.next()?.parse::<f64>().ok()?, t.next()?.parse::<f64>().ok()?);
    let sec = t.next()?.parse::<f64>().ok()?;
    // Days since 1970-01-01 (Howard Hinnant's days_from_civil).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days as f64 * 86400.0 + h * 3600.0 + min * 60.0 + sec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times() {
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0.0));
        assert_eq!(parse_time("2026-10-09T04:50:10.5Z"), Some(1791521410.5));
    }

    #[test]
    fn tool_calls_become_visits() {
        let line: serde_json::Value = serde_json::from_str(
            r#"{"timestamp":"1970-01-01T00:00:01Z","message":{"content":[
                {"type":"tool_use","name":"Read","input":{"file_path":"/a.rs"}},
                {"type":"tool_use","name":"Bash","input":{"command":"ls"}},
                {"type":"tool_use","name":"Edit","input":{"file_path":"/b.rs"}}]}}"#,
        )
        .unwrap();
        let t = touches(&line);
        assert_eq!(t.len(), 2);
        assert_eq!(t[0], (1.0, PathBuf::from("/a.rs"), Touch::Read));
        assert_eq!(t[1].2, Touch::Edit);
    }

    #[test]
    fn repeat_touches_merge() {
        let mut tr = Trail::default();
        tr.push(1.0, "/a".into(), Touch::Read);
        tr.push(2.0, "/a".into(), Touch::Edit);
        tr.push(3.0, "/b".into(), Touch::Read);
        assert_eq!(tr.visits.len(), 2);
        assert_eq!(tr.visits[0].touch, Touch::Edit);
        assert_eq!(tr.at(2.5).unwrap().path, PathBuf::from("/a"));
    }
}
