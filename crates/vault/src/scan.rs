//! Walking a vault folder without changing any content or metadata.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::layout::fnv1a64;

pub const SKIP: [&str; 4] = ["target", ".git", "node_modules", "__pycache__"];
pub const MAX_ENTRIES: usize = 50_000;
pub const MAX_NOTE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub struct ScanOptions {
    pub max_entries: usize,
    pub max_note_bytes: u64,
}
impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            max_entries: MAX_ENTRIES,
            max_note_bytes: MAX_NOTE_BYTES,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Scan {
    pub root: PathBuf,
    pub notes: Vec<ScannedNote>,
    pub folders: Vec<String>,
    pub skipped: Vec<Skipped>,
    pub truncated: bool,
}
#[derive(Debug, Clone)]
pub struct ScannedNote {
    pub rel: String,
    pub text: Option<String>,
    pub status: NoteStatus,
    pub len: u64,
    pub mtime_ms: Option<i64>,
    pub birth_ms: Option<i64>,
    pub hash: u64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteStatus {
    Ok,
    NotUtf8,
    TooLarge,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skipped {
    pub rel: String,
    pub reason: SkipReason,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkipReason {
    Symlink,
    NonUtf8Name,
    Unreadable(String),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStat {
    pub len: u64,
    pub mtime: Option<SystemTime>,
}

pub fn is_ignored_name(name: &str) -> bool {
    name.starts_with('.') || SKIP.contains(&name)
}
pub fn is_note_name(name: &str) -> bool {
    name.len() > 3
        && name.is_char_boundary(name.len() - 3)
        && name[name.len() - 3..].eq_ignore_ascii_case(".md")
}

pub fn scan(root: &Path) -> std::io::Result<Scan> {
    scan_with(root, &ScanOptions::default())
}

pub fn scan_with(root: &Path, opts: &ScanOptions) -> std::io::Result<Scan> {
    let root = root.canonicalize()?;
    let mut out = Scan {
        root: root.clone(),
        notes: Vec::new(),
        folders: Vec::new(),
        skipped: Vec::new(),
        truncated: false,
    };
    let mut stack = vec![(root.clone(), String::new())];
    let mut seen = 0usize;
    while let Some((dir, rel)) = stack.pop() {
        out.folders.push(rel.clone());
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) => {
                if !rel.is_empty() {
                    out.skipped.push(Skipped {
                        rel,
                        reason: SkipReason::Unreadable(error.to_string()),
                    });
                }
                continue;
            }
        };
        let mut entries: Vec<_> = entries.collect::<Result<_, _>>()?;
        entries.sort_by(|a: &fs::DirEntry, b: &fs::DirEntry| a.file_name().cmp(&b.file_name()));
        let mut child_dirs = Vec::new();
        for entry in entries {
            if seen >= opts.max_entries {
                out.truncated = true;
                break;
            }
            seen += 1;
            let os_name = entry.file_name();
            let name = match os_name.into_string() {
                Ok(name) => name,
                Err(os_name) => {
                    let child_rel = join_rel(&rel, &os_name.to_string_lossy());
                    out.skipped.push(Skipped {
                        rel: child_rel,
                        reason: SkipReason::NonUtf8Name,
                    });
                    continue;
                }
            };
            if is_ignored_name(&name) {
                continue;
            }
            let child_rel = join_rel(&rel, &name);
            let kind = match entry.file_type() {
                Ok(kind) => kind,
                Err(error) => {
                    out.skipped.push(Skipped {
                        rel: child_rel,
                        reason: SkipReason::Unreadable(error.to_string()),
                    });
                    continue;
                }
            };
            if kind.is_symlink() {
                out.skipped.push(Skipped {
                    rel: child_rel,
                    reason: SkipReason::Symlink,
                });
            } else if kind.is_dir() {
                child_dirs.push((entry.path(), child_rel));
            } else if kind.is_file() && is_note_name(&name) {
                out.notes
                    .push(read_note(&entry.path(), child_rel, opts.max_note_bytes)?);
            }
        }
        for child in child_dirs.into_iter().rev() {
            stack.push(child);
        }
        if out.truncated {
            break;
        }
    }
    out.notes.sort_by(|a, b| a.rel.cmp(&b.rel));
    out.folders.sort();
    out.skipped.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

fn join_rel(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}/{name}")
    }
}
fn millis(time: Option<SystemTime>) -> Option<i64> {
    time.and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

fn read_note(path: &Path, rel: String, max_bytes: u64) -> std::io::Result<ScannedNote> {
    let meta = fs::symlink_metadata(path)?;
    let mtime_ms = millis(meta.modified().ok());
    let birth_ms = millis(meta.created().ok());
    if meta.len() > max_bytes {
        return Ok(ScannedNote {
            rel,
            text: None,
            status: NoteStatus::TooLarge,
            len: meta.len(),
            mtime_ms,
            birth_ms,
            hash: 0,
        });
    }
    let bytes = fs::read(path)?;
    let hash = fnv1a64(&bytes);
    match String::from_utf8(bytes) {
        Ok(text) => Ok(ScannedNote {
            rel,
            text: Some(text),
            status: NoteStatus::Ok,
            len: meta.len(),
            mtime_ms,
            birth_ms,
            hash,
        }),
        Err(_) => Ok(ScannedNote {
            rel,
            text: None,
            status: NoteStatus::NotUtf8,
            len: meta.len(),
            mtime_ms,
            birth_ms,
            hash,
        }),
    }
}

pub fn stat_tree(root: &Path) -> std::io::Result<BTreeMap<String, FileStat>> {
    let root = root.canonicalize()?;
    let mut out = BTreeMap::new();
    let mut stack = vec![(root, String::new())];
    let mut seen = 0usize;
    while let Some((dir, rel)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
        let mut dirs = Vec::new();
        for entry in entries {
            if seen >= MAX_ENTRIES {
                return Ok(out);
            }
            seen += 1;
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if is_ignored_name(&name) {
                continue;
            }
            let child = join_rel(&rel, &name);
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                dirs.push((entry.path(), child));
            } else if kind.is_file() && is_note_name(&name) {
                let meta = fs::symlink_metadata(entry.path())?;
                out.insert(
                    child,
                    FileStat {
                        len: meta.len(),
                        mtime: meta.modified().ok(),
                    },
                );
            }
        }
        for dir in dirs.into_iter().rev() {
            stack.push(dir);
        }
    }
    Ok(out)
}
