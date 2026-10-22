//! The single writer: every change to a vault goes through `Store::apply`.
//!
//! Each command reads the note's current bytes from disk, applies a pure
//! text transform, and writes the result atomically: a temp file in the same
//! folder (`.{name}.tapestry-{pid}-{n}.tmp`, dot-prefixed so scans and
//! Obsidian ignore it), fsync, rename over the note, fsync the folder. A
//! transform that changes nothing writes nothing. Symlinked notes are refused,
//! and every path must stay inside the vault root.
//!
//! The rename replaces the file, so a hard link to a note is broken by a
//! write; that is accepted.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::frontmatter::{self, LayoutPatch, SpliceError};
use crate::journal::{self, Entry, Event};
use crate::time;

/// A change to the vault.
#[derive(Debug, Clone, PartialEq)]
pub enum VaultCmd {
    /// Creates a new note (refused if the path exists), stamped with `created:`.
    CreateNote { rel: String, body: String },
    /// Writes the patched layout keys into an existing note's frontmatter.
    SetLayout { rel: String, patch: LayoutPatch },
}

/// What a command did. An empty `written` means nothing changed on disk.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Outcome {
    /// Vault-relative paths that were written.
    pub written: Vec<String>,
    /// A block id the command created or reused (anchor commands).
    pub id: Option<String>,
    /// Link text the command wrote (link commands).
    pub link: Option<String>,
}

#[derive(Debug)]
pub enum WriteError {
    Io(std::io::Error),
    /// The path is not a safe vault-relative `.md` path.
    BadPath(String),
    /// The note (or a folder on its path) is a symlink; never written through.
    Symlink(String),
    NotFound(String),
    Exists(String),
    Splice(SpliceError),
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WriteError::Io(e) => write!(f, "{e}"),
            WriteError::BadPath(p) => write!(f, "not a vault note path: {p:?}"),
            WriteError::Symlink(p) => write!(f, "refusing to write through a symlink: {p}"),
            WriteError::NotFound(p) => write!(f, "no such note: {p}"),
            WriteError::Exists(p) => write!(f, "a note already exists at {p}"),
            WriteError::Splice(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for WriteError {}

impl From<std::io::Error> for WriteError {
    fn from(e: std::io::Error) -> Self {
        WriteError::Io(e)
    }
}

impl From<SpliceError> for WriteError {
    fn from(e: SpliceError) -> Self {
        WriteError::Splice(e)
    }
}

/// Accepts only a plain vault-relative note path: `/`-separated, no empty,
/// `.`, `..` or dot-prefixed component, no backslash, ending in `.md`.
pub fn check_rel(rel: &str) -> Result<(), WriteError> {
    let bad = || Err(WriteError::BadPath(rel.to_owned()));
    if rel.is_empty() || rel.starts_with('/') || rel.contains('\\') || rel.contains('\0') {
        return bad();
    }
    if rel.split('/').any(|c| c.is_empty() || c.starts_with('.')) {
        return bad();
    }
    if !crate::scan::is_note_name(rel.rsplit('/').next().unwrap_or("")) {
        return bad();
    }
    if Path::new(rel).is_absolute() {
        return bad();
    }
    Ok(())
}

pub struct Store {
    root: PathBuf,
    clock: Box<dyn FnMut() -> i64 + Send>,
    temps: u64,
}

impl Store {
    /// Opens a vault for writing. Nothing is written until a command is applied.
    pub fn open(root: &Path) -> std::io::Result<Store> {
        Ok(Store { root: root.canonicalize()?, clock: Box::new(time::now_ms), temps: 0 })
    }

    /// Replaces the clock (Unix ms) used for `created:` and journal times.
    pub fn with_clock(mut self, clock: impl FnMut() -> i64 + Send + 'static) -> Self {
        self.clock = Box::new(clock);
        self
    }

    /// The canonical vault root.
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn apply(&mut self, cmd: VaultCmd) -> Result<Outcome, WriteError> {
        match cmd {
            VaultCmd::SetLayout { rel, patch } => {
                check_rel(&rel)?;
                let path = self.existing_note(&rel)?;
                let text = read_text(&path, &rel)?;
                match frontmatter::splice_layout(&text, &patch)? {
                    None => Ok(Outcome::default()),
                    Some(new) => {
                        self.write_atomic(&path, new.as_bytes())?;
                        Ok(Outcome { written: vec![rel], ..Outcome::default() })
                    }
                }
            }
            VaultCmd::CreateNote { rel, body } => {
                check_rel(&rel)?;
                let path = self.root.join(&rel);
                if fs::symlink_metadata(&path).is_ok() {
                    return Err(WriteError::Exists(rel));
                }
                let parent = path.parent().unwrap_or(&self.root).to_path_buf();
                self.check_inside(&parent, &rel)?;
                fs::create_dir_all(&parent)?;
                let now = (self.clock)();
                let text = frontmatter::ensure_created(&body, &time::iso_utc(now))?.unwrap_or(body);
                self.write_atomic(&path, text.as_bytes())?;
                journal::append(&self.root, &Entry { t: now, event: Event::NoteCreated { path: rel.clone() } })?;
                Ok(Outcome { written: vec![rel], ..Outcome::default() })
            }
        }
    }

    /// The path of an existing regular note inside the root.
    fn existing_note(&self, rel: &str) -> Result<PathBuf, WriteError> {
        let path = self.root.join(rel);
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(WriteError::NotFound(rel.to_owned())),
            Err(e) => Err(e.into()),
            Ok(m) if m.file_type().is_symlink() => Err(WriteError::Symlink(rel.to_owned())),
            Ok(m) if !m.is_file() => Err(WriteError::NotFound(rel.to_owned())),
            Ok(_) => {
                self.check_inside(path.parent().unwrap_or(&self.root), rel)?;
                Ok(path)
            }
        }
    }

    /// No folder between the root and `dir` may be a symlink (it would lead
    /// the write outside the vault).
    fn check_inside(&self, dir: &Path, rel: &str) -> Result<(), WriteError> {
        let inner = dir.strip_prefix(&self.root).map_err(|_| WriteError::BadPath(rel.to_owned()))?;
        let mut at = self.root.clone();
        for part in inner.components() {
            at.push(part);
            match fs::symlink_metadata(&at) {
                Ok(m) if m.file_type().is_symlink() => return Err(WriteError::Symlink(rel.to_owned())),
                Ok(_) => {}
                // Not there yet: the rest will be created as plain folders.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }

    /// Temp file in the same folder, fsync, rename over `path`, fsync the folder.
    fn write_atomic(&mut self, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        let dir = path.parent().unwrap_or(&self.root);
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("note");
        self.temps += 1;
        let tmp = dir.join(format!(".{name}.tapestry-{}-{}.tmp", std::process::id(), self.temps));
        let result = (|| {
            let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&tmp, path)?;
            File::open(dir)?.sync_all()
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result
    }
}

fn read_text(path: &Path, rel: &str) -> Result<String, WriteError> {
    let bytes = fs::read(path)?;
    String::from_utf8(bytes).map_err(|_| {
        WriteError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, format!("{rel} is not UTF-8")))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rel_paths() {
        for ok in ["A.md", "Folder/Note.md", "a/b/c.MD", "with space.md"] {
            assert!(check_rel(ok).is_ok(), "{ok}");
        }
        for bad in [
            "", "/abs.md", "../up.md", "a/../b.md", "./a.md", "a//b.md", ".hidden.md", "a/.obsidian/x.md",
            "a\\b.md", "note.txt", "folder/", ".md",
        ] {
            assert!(matches!(check_rel(bad), Err(WriteError::BadPath(_))), "{bad}");
        }
    }
}
