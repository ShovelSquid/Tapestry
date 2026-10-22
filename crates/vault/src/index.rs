//! A snapshot of the vault for drawing: one entry per note with its folder,
//! title, frontmatter status and layout.

use std::collections::BTreeMap;

use crate::frontmatter::{self, Frontmatter, Layout};
use crate::scan::{NoteStatus, Scan};

#[derive(Debug, Clone, Default)]
pub struct VaultIndex {
    /// Bumped by the owner each time the index is rebuilt.
    pub generation: u64,
    /// Notes by vault-relative path.
    pub notes: BTreeMap<String, NoteMeta>,
}

#[derive(Debug, Clone)]
pub struct NoteMeta {
    pub rel: String,
    /// The folder (graph) the note is in; `""` at the vault root.
    pub folder: String,
    /// The file name without `.md`, as Obsidian shows it.
    pub title: String,
    pub frontmatter: FmStatus,
    pub layout: Layout,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FmStatus {
    Absent,
    Parsed,
    /// Unparseable: the note is shown but never rewritten.
    Invalid(String),
    /// The note's text could not be read (not UTF-8, too large).
    Skipped,
}

impl VaultIndex {
    pub fn build(scan: &Scan) -> VaultIndex {
        let mut notes = BTreeMap::new();
        for note in &scan.notes {
            let (folder, file) = match note.rel.rsplit_once('/') {
                Some((folder, file)) => (folder.to_owned(), file),
                None => (String::new(), note.rel.as_str()),
            };
            let title = file.get(..file.len().saturating_sub(3)).unwrap_or(file).to_owned();
            let (status, layout) = match (&note.text, note.status) {
                (Some(text), NoteStatus::Ok) => {
                    let fm = frontmatter::split(text);
                    let status = match &fm {
                        Frontmatter::Absent => FmStatus::Absent,
                        Frontmatter::Parsed { .. } => FmStatus::Parsed,
                        Frontmatter::Invalid { reason, .. } => FmStatus::Invalid(format!("{reason:?}")),
                    };
                    (status, frontmatter::read_layout(&fm))
                }
                _ => (FmStatus::Skipped, Layout::default()),
            };
            notes.insert(
                note.rel.clone(),
                NoteMeta { rel: note.rel.clone(), folder, title, frontmatter: status, layout },
            );
        }
        VaultIndex { generation: 0, notes }
    }
}
