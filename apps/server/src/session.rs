//! A terminal the server keeps: a shell (or Claude Code) on a pseudo-terminal,
//! its screen kept by a VT100 parser so whoever attaches sees it as it is now.
//!
//! The program outlives every window looking at it. Closing the app, the
//! browser tab or the phone doesn't end it; only "close" does.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

const SCROLLBACK: usize = 5000;

/// What survives a restart: enough to open the session again.
#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct Saved {
    pub id: u64,
    /// Where the shell is now, so it reopens there.
    pub cwd: PathBuf,
    /// The Claude Code session running in it, reopened with `--resume`.
    pub claude: Option<String>,
}

impl Saved {
    /// What runs in it, and the folder it's in.
    pub fn title(&self) -> String {
        let place = self
            .cwd
            .file_name()
            .map_or_else(|| "/".into(), |n| n.to_string_lossy().into_owned());
        if self.claude.is_some() { format!("claude · {place}") } else { format!("shell · {place}") }
    }
}

pub struct Session {
    pub saved: Mutex<Saved>,
    parser: Mutex<vt100::Parser>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    pub pid: Option<u32>,
    /// What the program writes, for everyone attached. Sent while the parser
    /// is locked, so a snapshot plus what follows it misses nothing. An empty
    /// message means it ended.
    output: broadcast::Sender<Arc<[u8]>>,
    pub ended: AtomicBool,
    /// Unix time it was opened.
    pub started: f64,
}

/// The user's login shell.
pub fn shell() -> String {
    if let Ok(s) = std::env::var("SHELL") {
        return s;
    }
    let user = std::env::var("USER").unwrap_or_default();
    std::fs::read_to_string("/etc/passwd")
        .ok()
        .and_then(|p| {
            p.lines()
                .find(|l| l.starts_with(&format!("{user}:")))
                .and_then(|l| l.rsplit(':').next().map(str::to_owned))
        })
        .unwrap_or_else(|| "/bin/bash".into())
}

/// A Claude Code session id is a UUID; anything else never reaches a shell line.
pub fn valid_claude_id(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

impl Session {
    /// Open `saved`: a shell in its folder, running Claude Code first if it
    /// names a session. When Claude exits, the shell is left.
    pub fn spawn(saved: Saved, on_end: impl FnOnce(u64) + Send + 'static) -> Result<Arc<Self>, String> {
        let (rows, cols) = (24, 80);
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let shell = shell();
        let mut cmd = CommandBuilder::new(&shell);
        match &saved.claude {
            Some(id) if valid_claude_id(id) => {
                let how = if crate::claude::transcript(id).is_some() { "--resume" } else { "--session-id" };
                cmd.args(["-lc", &format!("claude {how} {id}; exec \"$0\" -l"), &shell]);
            }
            _ => cmd.arg("-l"),
        }
        let cwd = if saved.cwd.is_dir() { saved.cwd.clone() } else { home() };
        cmd.cwd(&cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // Started from inside a Claude Code session (while testing, say), the
        // Claude in here must not think it's that session's child.
        for (k, _) in std::env::vars_os() {
            if k.to_str().is_some_and(|k| k == "CLAUDECODE" || k.starts_with("CLAUDE_CODE_")) {
                cmd.env_remove(k);
            }
        }
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let pid = child.process_id();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let (output, _) = broadcast::channel(1024);
        let id = saved.id;
        let session = Arc::new(Self {
            saved: Mutex::new(Saved { cwd, ..saved }),
            parser: Mutex::new(vt100::Parser::new(rows, cols, SCROLLBACK)),
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            pid,
            output,
            ended: AtomicBool::new(false),
            started: now(),
        });
        let s = session.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let mut parser = s.parser.lock().unwrap();
                        parser.process(&buf[..n]);
                        let _ = s.output.send(buf[..n].into());
                    }
                }
            }
            s.ended.store(true, Ordering::Relaxed);
            let _ = s.output.send(Arc::from(&[][..]));
            on_end(id);
        });
        Ok(session)
    }

    /// The screen as it is now, as bytes that redraw it on a fresh terminal,
    /// and a receiver for everything after.
    pub fn attach(&self) -> (Vec<u8>, broadcast::Receiver<Arc<[u8]>>) {
        let parser = self.parser.lock().unwrap();
        let rx = self.output.subscribe();
        (snapshot(parser.screen()), rx)
    }

    pub fn snapshot(&self) -> Vec<u8> {
        snapshot(self.parser.lock().unwrap().screen())
    }

    pub fn write(&self, bytes: &[u8]) {
        let mut w = self.writer.lock().unwrap();
        let _ = w.write_all(bytes);
        let _ = w.flush();
    }

    pub fn resize(&self, rows: u16, cols: u16) {
        if rows < 2 || cols < 4 {
            return;
        }
        let mut parser = self.parser.lock().unwrap();
        if parser.screen().size() == (rows, cols) {
            return;
        }
        parser.screen_mut().set_size(rows, cols);
        let _ = self.master.lock().unwrap().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }

    /// Hang up, as closing a terminal window does: everything in it gets
    /// SIGHUP, and what's still there two seconds later is killed.
    pub fn kill(&self) {
        let Some(pid) = self.pid else {
            let _ = self.child.lock().unwrap().kill();
            return;
        };
        // The shell leads its own session and process group (the pty made it so),
        // but a program in it may have started groups of its own.
        let all = descendants(pid, &parents());
        let signal = |sig| {
            for &p in &all {
                unsafe { libc::kill(p as i32, sig) };
            }
            unsafe { libc::killpg(pid as i32, sig) };
        };
        signal(libc::SIGHUP);
        std::thread::sleep(std::time::Duration::from_secs(2));
        signal(libc::SIGKILL);
        let _ = self.child.lock().unwrap().wait();
    }

    /// Look at what runs in the terminal now: the folder the shell is in, and
    /// the Claude Code session, if one runs. Returns whether either changed.
    pub fn observe(&self) -> bool {
        let Some(pid) = self.pid else { return false };
        if self.ended.load(Ordering::Relaxed) {
            return false;
        }
        let procs = parents();
        let under = descendants(pid, &procs);
        let claude: Vec<u32> = under.iter().copied().filter(|&p| is_claude(p)).collect();
        let mut saved = self.saved.lock().unwrap();
        let before = saved.clone();
        if let Ok(cwd) = std::fs::read_link(format!("/proc/{pid}/cwd")) {
            saved.cwd = cwd;
        }
        match claude.iter().find_map(|&p| crate::claude::running_session(p)) {
            Some(id) => saved.claude = Some(id),
            // Claude was asked for and has had time to start, and isn't running:
            // it was quit, so the terminal is a shell now.
            None if claude.is_empty() && now() - self.started > 15.0 => saved.claude = None,
            None => {}
        }
        *saved != before
    }
}

fn snapshot(screen: &vt100::Screen) -> Vec<u8> {
    // Reset, step into the alternate screen if a full-screen program is
    // there, then draw the screen and its modes, and put the cursor back.
    let mut out = b"\x1bc".to_vec();
    if screen.alternate_screen() {
        out.extend_from_slice(b"\x1b[?1049h");
    }
    out.extend(screen.state_formatted());
    let (row, col) = screen.cursor_position();
    out.extend(format!("\x1b[{};{}H", row + 1, col + 1).into_bytes());
    out
}

pub fn home() -> PathBuf {
    std::env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from)
}

pub fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64())
}

/// Every process and its parent, from `/proc`.
fn parents() -> Vec<(u32, u32)> {
    let Ok(dir) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    dir.flatten()
        .filter_map(|e| {
            let pid: u32 = e.file_name().to_str()?.parse().ok()?;
            let stat = std::fs::read_to_string(e.path().join("stat")).ok()?;
            // The name is in parentheses and may hold spaces; fields follow the last ')'.
            let rest = &stat[stat.rfind(')')? + 2..];
            let ppid = rest.split(' ').nth(1)?.parse().ok()?;
            Some((pid, ppid))
        })
        .collect()
}

fn descendants(root: u32, procs: &[(u32, u32)]) -> Vec<u32> {
    let mut out = vec![root];
    let mut i = 0;
    while i < out.len() {
        let p = out[i];
        out.extend(procs.iter().filter(|(_, pp)| *pp == p).map(|(c, _)| *c));
        i += 1;
    }
    out
}

fn is_claude(pid: u32) -> bool {
    let cmd = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    let argv0 = cmd.split(|&b| b == 0).next().unwrap_or_default();
    Path::new(std::str::from_utf8(argv0).unwrap_or_default())
        .file_name()
        .is_some_and(|n| n == "claude")
}
