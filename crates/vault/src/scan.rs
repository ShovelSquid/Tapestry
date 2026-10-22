//! Walking a vault folder, read-only.
//!
//! Every `.md` file is a note and every folder reached is a graph. Nothing in
//! this module writes, creates, renames or removes anything: scanning a vault
//! must leave every byte and every modification time as it was. Symlinks are
//! never followed, and dot-entries (`.obsidian`, `.git`, `.tapestry`, the
//! store's temp files) are skipped along with build and dependency folders.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Never walked: build output, version control, dependencies.
pub const SKIP: [&str; 4] = ["target", ".git", "node_modules", "__pycache__"];

/// What a walk found.
#[derive(Debug, Clone)]
pub struct Scan {
    /// The canonical vault root.
    pub root: PathBuf,
    /// Every note, sorted by `rel`.
    pub notes: Vec<ScannedNote>,
    /// Every folder reached, sorted; the root folder is `""`.
    pub folders: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ScannedNote {
    /// Vault-relative path with `/` separators.
    pub rel: String,
    /// The note's text, when it could be read as UTF-8.
    pub text: Option<String>,
    pub status: NoteStatus,
    pub len: u64,
    pub mtime_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteStatus {
    Ok,
    /// Listed, but not parsed and never written.
    NotUtf8,
    /// Listed, but not parsed and never written.
    TooLarge,
}

/// Names that are never walked: dot-entries and `SKIP`.
pub fn is_ignored_name(name: &str) -> bool {
    name.starts_with('.') || SKIP.contains(&name)
}

/// A file name that makes a note: extension `md`, any ASCII case.
pub fn is_note_name(name: &str) -> bool {
    name.len() > 3 && name.is_char_boundary(name.len() - 3) && name[name.len() - 3..].eq_ignore_ascii_case(".md")
}

/// Walks `root` and reads every note. Read-only.
pub fn scan(root: &Path) -> std::io::Result<Scan> {
    let root = root.canonicalize()?;
    let mut out = Scan { root: root.clone(), notes: Vec::new(), folders: Vec::new() };
    walk(&root, "", &mut out)?;
    out.notes.sort_by(|a, b| a.rel.cmp(&b.rel));
    out.folders.sort();
    Ok(out)
}

fn walk(dir: &Path, rel: &str, out: &mut Scan) -> std::io::Result<()> {
    out.folders.push(rel.to_owned());
    let mut entries: Vec<(String, fs::DirEntry)> = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        // Names that are not UTF-8 cannot be linked to; leave them out.
        let Ok(name) = entry.file_name().into_string() else { continue };
        if !is_ignored_name(&name) {
            entries.push((name, entry));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    for (name, entry) in entries {
        // `DirEntry::file_type` does not follow symlinks.
        let kind = entry.file_type()?;
        let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            walk(&entry.path(), &child_rel, out)?;
        } else if kind.is_file() && is_note_name(&name) {
            out.notes.push(read_note(&entry.path(), child_rel)?);
        }
    }
    Ok(())
}

fn read_note(path: &Path, rel: String) -> std::io::Result<ScannedNote> {
    let meta = fs::symlink_metadata(path)?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    let bytes = fs::read(path)?;
    let (text, status) = match String::from_utf8(bytes) {
        Ok(text) => (Some(text), NoteStatus::Ok),
        Err(_) => (None, NoteStatus::NotUtf8),
    };
    Ok(ScannedNote { rel, text, status, len: meta.len(), mtime_ms })
}
