//! The vault's append-only event log, `<vault>/.tapestry/journal.jsonl`.
//!
//! One JSON object per line, `{"t": <unix ms>, "kind": "...", ...}`. Only the
//! store appends to it. Growth replay reads it back; a line that does not
//! parse (a torn tail after a crash) is skipped, never fatal.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The app's hidden folder inside a vault.
pub const DIR: &str = ".tapestry";
pub const FILE: &str = "journal.jsonl";

pub fn path(root: &Path) -> PathBuf {
    root.join(DIR).join(FILE)
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    /// The app created a note at this vault-relative path.
    NoteCreated { path: String },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Entry {
    /// Unix milliseconds.
    pub t: i64,
    #[serde(flatten)]
    pub event: Event,
}

/// Appends one line and flushes it to disk.
pub fn append(root: &Path, entry: &Entry) -> std::io::Result<()> {
    fs::create_dir_all(root.join(DIR))?;
    let mut line = serde_json::to_string(entry).map_err(std::io::Error::other)?;
    line.push('\n');
    let mut file = OpenOptions::new().create(true).append(true).open(path(root))?;
    file.write_all(line.as_bytes())?;
    file.sync_data()
}

/// Every entry that parses, in file order; empty when there is no journal.
pub fn read(root: &Path) -> std::io::Result<Vec<Entry>> {
    let bytes = match fs::read(path(root)) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    // Lossy: a torn multi-byte tail must not hide the lines before it.
    let text = String::from_utf8_lossy(&bytes);
    Ok(text.lines().filter_map(|line| serde_json::from_str(line).ok()).collect())
}
