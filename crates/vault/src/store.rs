//! The one serialized writer for a vault. All command offsets are applied to
//! fresh bytes; writes use a same-directory temp file and atomic rename.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions, Permissions};
use std::io::Write;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::blocks::{self, BlockError, BlockKind, IdGen, RandomIds};
use crate::frontmatter::{self, LayoutPatch, SpliceError};
use crate::journal::{self, Entry, Event};
use crate::layout::fnv1a64;
use crate::links::{self, LinkError};
use crate::scan::{Scan, is_ignored_name};
use crate::time;

#[derive(Debug, Clone, PartialEq)]
pub enum VaultCmd {
    CreateNote {
        rel: String,
        body: String,
    },
    SetLayout {
        rel: String,
        patch: LayoutPatch,
    },
    SetFolderWorld {
        folder: String,
        x: f64,
        y: f64,
        scale: f64,
    },
    InsertAnchor {
        rel: String,
        line: usize,
        base_hash: Option<u64>,
    },
    AddLink {
        source_rel: String,
        line: usize,
        target_rel: String,
        target_line: Option<usize>,
        description: String,
        link_path: String,
        base_hash: Option<u64>,
    },
    RemoveLink {
        rel: String,
        span: Range<usize>,
        base_hash: u64,
    },
    CardKept {
        rel: String,
    },
    CardDismissed {
        rel: String,
    },
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Outcome {
    pub written: Vec<String>,
    pub id: Option<String>,
    pub link: Option<String>,
}

#[derive(Debug)]
pub enum WriteError {
    Io(std::io::Error),
    BadPath(String),
    Symlink(String),
    NotFound(String),
    Exists(String),
    SameNote,
    Conflict { rel: String },
    NoLinkAt { rel: String },
    Splice(SpliceError),
    Block(BlockError),
    Link(LinkError),
}
impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "{e}"),
            Self::BadPath(p) => write!(f, "not a vault note path: {p:?}"),
            Self::Symlink(p) => write!(f, "refusing to write through a symlink: {p}"),
            Self::NotFound(p) => write!(f, "no such note: {p}"),
            Self::Exists(p) => write!(f, "a note already exists at {p}"),
            Self::SameNote => write!(f, "source and target are the same note"),
            Self::Conflict { rel } => write!(f, "{rel} changed since it was read"),
            Self::NoLinkAt { rel } => write!(f, "no link at the requested span in {rel}"),
            Self::Splice(e) => write!(f, "{e}"),
            Self::Block(e) => write!(f, "{e:?}"),
            Self::Link(e) => write!(f, "{e:?}"),
        }
    }
}
impl std::error::Error for WriteError {}
impl From<std::io::Error> for WriteError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}
impl From<SpliceError> for WriteError {
    fn from(e: SpliceError) -> Self {
        Self::Splice(e)
    }
}
impl From<BlockError> for WriteError {
    fn from(e: BlockError) -> Self {
        Self::Block(e)
    }
}
impl From<LinkError> for WriteError {
    fn from(e: LinkError) -> Self {
        Self::Link(e)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    OwnEcho,
    Unchanged,
    External,
    Removed,
}

pub fn check_rel(rel: &str) -> Result<(), WriteError> {
    let bad = || Err(WriteError::BadPath(rel.to_owned()));
    if rel.is_empty()
        || rel.starts_with('/')
        || rel.contains('\\')
        || rel.contains('\0')
        || Path::new(rel).is_absolute()
    {
        return bad();
    }
    if rel
        .split('/')
        .any(|c| c.is_empty() || c == "." || c == ".." || c.starts_with('.'))
    {
        return bad();
    }
    if !crate::scan::is_note_name(rel.rsplit('/').next().unwrap_or("")) {
        return bad();
    }
    Ok(())
}

pub struct Store {
    root: PathBuf,
    clock: Box<dyn FnMut() -> i64 + Send>,
    ids: Box<dyn IdGen + Send>,
    own_writes: HashMap<String, u64>,
    known: HashMap<String, u64>,
    stamped: HashSet<String>,
    temps: u64,
}

impl Store {
    pub fn open(root: &Path) -> std::io::Result<Store> {
        let root = root.canonicalize()?;
        let journal_dir = root.join(journal::DIR);
        if fs::symlink_metadata(&journal_dir).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "journal directory is a symlink",
            ));
        }
        if fs::symlink_metadata(journal::path(&root)).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "journal file is a symlink",
            ));
        }
        let stamped = journal::read(&root)?
            .into_iter()
            .filter_map(|entry| match entry.event {
                Event::NoteCreated { path } | Event::NoteEstimated { path, .. } => Some(path),
                _ => None,
            })
            .collect();
        cleanup_stale_temps(&root);
        Ok(Store {
            root,
            clock: Box::new(time::now_ms),
            ids: Box::new(RandomIds::new()),
            own_writes: HashMap::new(),
            known: HashMap::new(),
            stamped,
            temps: 0,
        })
    }
    pub fn with_clock(mut self, clock: impl FnMut() -> i64 + Send + 'static) -> Self {
        self.clock = Box::new(clock);
        self
    }
    pub fn with_ids(mut self, ids: impl IdGen + Send + 'static) -> Self {
        self.ids = Box::new(ids);
        self
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn seed_known(&mut self, scan: &Scan) {
        for note in &scan.notes {
            self.known.insert(note.rel.clone(), note.hash);
        }
    }

    pub fn classify(&mut self, rel: &str) -> Change {
        if check_rel(rel).is_err() {
            return Change::Unchanged;
        }
        let path = self.root.join(rel);
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => return Change::Unchanged,
            Ok(meta) if meta.is_file() => meta,
            Ok(_) => return Change::Unchanged,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                self.known.remove(rel);
                self.own_writes.remove(rel);
                return Change::Removed;
            }
            Err(_) => return Change::Unchanged,
        };
        let _ = meta;
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => return Change::External,
        };
        let hash = fnv1a64(&bytes);
        if self.own_writes.get(rel) == Some(&hash) {
            self.known.insert(rel.to_owned(), hash);
            Change::OwnEcho
        } else if self.known.get(rel) == Some(&hash) {
            Change::Unchanged
        } else {
            self.known.insert(rel.to_owned(), hash);
            self.own_writes.remove(rel);
            Change::External
        }
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
                        self.estimate_before_rewrite(&rel, &text)?;
                        self.write_atomic(&rel, &path, new.as_bytes())?;
                        Ok(Outcome {
                            written: vec![rel],
                            ..Default::default()
                        })
                    }
                }
            }
            VaultCmd::CreateNote { rel, body } => self.create_note(rel, body),
            VaultCmd::SetFolderWorld {
                folder,
                x,
                y,
                scale,
            } => self.set_folder_world(folder, x, y, scale),
            VaultCmd::InsertAnchor {
                rel,
                line,
                base_hash,
            } => self.insert_anchor(rel, line, base_hash),
            VaultCmd::AddLink {
                source_rel,
                line,
                target_rel,
                target_line,
                description,
                link_path,
                base_hash,
            } => self.add_link(
                source_rel,
                line,
                target_rel,
                target_line,
                description,
                link_path,
                base_hash,
            ),
            VaultCmd::RemoveLink {
                rel,
                span,
                base_hash,
            } => self.remove_link(rel, span, base_hash),
            VaultCmd::CardKept { rel } => self.card_event(rel, true),
            VaultCmd::CardDismissed { rel } => self.card_event(rel, false),
        }
    }

    fn create_note(&mut self, rel: String, body: String) -> Result<Outcome, WriteError> {
        check_rel(&rel)?;
        let path = self.root.join(&rel);
        let parent = path.parent().unwrap_or(&self.root).to_path_buf();
        self.check_existing_parent(&parent, &rel)?;
        let now = (self.clock)();
        let text = frontmatter::ensure_created(&body, &time::iso_utc(now))?.unwrap_or(body);
        fs::create_dir_all(&parent)?;
        self.check_parent_canonical(&parent, &rel)?;
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => return Err(WriteError::Symlink(rel)),
            Ok(_) => return Err(WriteError::Exists(rel)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        self.write_atomic(&rel, &path, text.as_bytes())?;
        self.append_event(now, Event::NoteCreated { path: rel.clone() })?;
        self.stamped.insert(rel.clone());
        Ok(Outcome {
            written: vec![rel],
            ..Default::default()
        })
    }

    fn set_folder_world(
        &mut self,
        folder: String,
        x: f64,
        y: f64,
        scale: f64,
    ) -> Result<Outcome, WriteError> {
        check_rel(&format!("{folder}/_folder-check.md"))?;
        let dir = self.root.join(&folder);
        let meta = fs::symlink_metadata(&dir).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                WriteError::NotFound(folder.clone())
            } else {
                e.into()
            }
        })?;
        if meta.file_type().is_symlink() {
            return Err(WriteError::Symlink(folder));
        }
        if !meta.is_dir() {
            return Err(WriteError::NotFound(folder));
        }
        self.check_parent_canonical(&dir, &folder)?;
        let basename = folder.rsplit('/').next().unwrap_or(&folder);
        let rel = format!("{folder}/{basename}.md");
        let patch = LayoutPatch {
            world_x: Some(x),
            world_y: Some(y),
            world_scale: Some(scale),
            ..Default::default()
        };
        match self.existing_note(&rel) {
            Ok(path) => {
                let text = read_text(&path, &rel)?;
                if let Some(new) = frontmatter::splice_layout(&text, &patch)? {
                    self.estimate_before_rewrite(&rel, &text)?;
                    self.write_atomic(&rel, &path, new.as_bytes())?;
                    Ok(Outcome {
                        written: vec![rel],
                        ..Default::default()
                    })
                } else {
                    Ok(Outcome::default())
                }
            }
            Err(WriteError::NotFound(_)) => {
                let now = (self.clock)();
                let text =
                    frontmatter::ensure_created("", &time::iso_utc(now))?.unwrap_or_default();
                let text = frontmatter::splice_layout(&text, &patch)?.unwrap_or(text);
                self.write_atomic(&rel, &dir.join(format!("{basename}.md")), text.as_bytes())?;
                self.append_event(now, Event::NoteCreated { path: rel.clone() })?;
                self.stamped.insert(rel.clone());
                Ok(Outcome {
                    written: vec![rel],
                    ..Default::default()
                })
            }
            Err(e) => Err(e),
        }
    }

    fn insert_anchor(
        &mut self,
        rel: String,
        line: usize,
        base_hash: Option<u64>,
    ) -> Result<Outcome, WriteError> {
        check_rel(&rel)?;
        let path = self.existing_note(&rel)?;
        let text = read_text(&path, &rel)?;
        if base_hash.is_some_and(|hash| hash != fnv1a64(text.as_bytes())) {
            return Err(WriteError::Conflict { rel });
        }
        let anchor = blocks::insert_anchor(&text, line, self.ids.as_mut())?;
        let Some(edit) = anchor.edit else {
            return Ok(Outcome {
                id: Some(anchor.id),
                ..Default::default()
            });
        };
        let new = edit.apply(&text);
        self.estimate_before_rewrite(&rel, &text)?;
        self.write_atomic(&rel, &path, new.as_bytes())?;
        Ok(Outcome {
            written: vec![rel],
            id: Some(anchor.id),
            ..Default::default()
        })
    }

    fn add_link(
        &mut self,
        source_rel: String,
        line: usize,
        target_rel: String,
        target_line: Option<usize>,
        description: String,
        link_path: String,
        base_hash: Option<u64>,
    ) -> Result<Outcome, WriteError> {
        check_rel(&source_rel)?;
        check_rel(&target_rel)?;
        if source_rel.to_lowercase() == target_rel.to_lowercase() {
            return Err(WriteError::SameNote);
        }
        let description = links::validate_description(&description)?;
        let rel_without_ext = strip_md(&target_rel).to_owned();
        let stem = target_rel
            .rsplit('/')
            .next()
            .map(strip_md)
            .unwrap_or(&target_rel)
            .to_owned();
        if link_path != rel_without_ext && link_path != stem {
            return Err(WriteError::BadPath(link_path));
        }
        let source_path = self.existing_note(&source_rel)?;
        let target_path = self.existing_note(&target_rel)?;
        let source_text = read_text(&source_path, &source_rel)?;
        if base_hash.is_some_and(|hash| hash != fnv1a64(source_text.as_bytes())) {
            return Err(WriteError::Conflict { rel: source_rel });
        }
        let (line_start, line_end, line_content_end) =
            line_bounds(&source_text, line).ok_or(BlockError::LineOutOfRange)?;
        if line_start < frontmatter::body_start(&source_text) {
            return Err(WriteError::Block(BlockError::Frontmatter));
        }
        let segments = blocks::segment(&source_text);
        let block = segments
            .iter()
            .find(|b| b.lines.contains(&line))
            .ok_or(BlockError::NoBlock)?;
        if !matches!(
            block.kind,
            BlockKind::Paragraph
                | BlockKind::ListItem
                | BlockKind::Quote
                | BlockKind::Callout
                | BlockKind::Table
        ) {
            return Err(WriteError::Block(match block.kind {
                BlockKind::Heading => BlockError::Heading,
                BlockKind::Fence => BlockError::Fence,
                BlockKind::Comment => BlockError::Comment,
                BlockKind::Rule => BlockError::Rule,
                _ => BlockError::NoBlock,
            }));
        }
        let (target_id, target_edit, target_text) = if let Some(target_line) = target_line {
            let text = read_text(&target_path, &target_rel)?;
            let anchor = blocks::insert_anchor(&text, target_line, self.ids.as_mut())?;
            (Some(anchor.id), anchor.edit, Some(text))
        } else {
            (None, None, None)
        };
        let link = links::build_link(
            &link_path,
            target_id.as_deref(),
            &description,
            block.kind == BlockKind::Table,
        )?;
        let updated = insert_link_on_line(
            &source_text,
            line_start,
            line_end,
            line_content_end,
            &link,
            block.kind == BlockKind::Table,
        )?;
        let source_new = updated;
        let mut written = Vec::new();
        if let (Some(edit), Some(text)) = (target_edit, target_text) {
            let anchored = edit.apply(&text);
            self.estimate_before_rewrite(&target_rel, &text)?;
            self.write_atomic(&target_rel, &target_path, anchored.as_bytes())?;
            written.push(target_rel.clone());
        }
        // If the source write fails after an anchor was added, the orphaned
        // target id is harmless and can be reused by a later link operation.
        self.estimate_before_rewrite(&source_rel, &source_text)?;
        self.write_atomic(&source_rel, &source_path, source_new.as_bytes())?;
        written.push(source_rel.clone());
        let now = (self.clock)();
        self.append_event(
            now,
            Event::LinkAdded {
                path: source_rel.clone(),
                line,
                block: block.id.clone(),
                target: target_rel.clone(),
                target_block: target_id.clone(),
                description: description.clone(),
            },
        )?;
        Ok(Outcome {
            written,
            id: target_id,
            link: Some(link),
        })
    }

    fn remove_link(
        &mut self,
        rel: String,
        span: Range<usize>,
        base_hash: u64,
    ) -> Result<Outcome, WriteError> {
        check_rel(&rel)?;
        let path = self.existing_note(&rel)?;
        let text = read_text(&path, &rel)?;
        if fnv1a64(text.as_bytes()) != base_hash {
            return Err(WriteError::Conflict { rel });
        }
        let link = links::parse(&text)
            .into_iter()
            .find(|link| link.span == span)
            .ok_or_else(|| WriteError::NoLinkAt { rel: rel.clone() })?;
        let target = link.target_text(&text).to_owned();
        let description = link.alias_text(&text).map(str::to_owned);
        let replacement = description.clone().unwrap_or_else(|| {
            if !target.is_empty() {
                target.clone()
            } else {
                link.subpath_text(&text).unwrap_or("").to_owned()
            }
        });
        let mut new = String::with_capacity(text.len());
        new.push_str(&text[..span.start]);
        new.push_str(&replacement);
        new.push_str(&text[span.end..]);
        self.estimate_before_rewrite(&rel, &text)?;
        self.write_atomic(&rel, &path, new.as_bytes())?;
        let line = blocks::line_of(&text, span.start);
        let now = (self.clock)();
        self.append_event(
            now,
            Event::LinkRemoved {
                path: rel.clone(),
                line,
                target,
                description,
            },
        )?;
        Ok(Outcome {
            written: vec![rel],
            ..Default::default()
        })
    }

    fn card_event(&mut self, rel: String, kept: bool) -> Result<Outcome, WriteError> {
        check_rel(&rel)?;
        let event = if kept {
            Event::CardKept { path: rel }
        } else {
            Event::CardDismissed { path: rel }
        };
        let now = (self.clock)();
        self.append_event(now, event)?;
        Ok(Outcome::default())
    }

    fn estimate_before_rewrite(&mut self, rel: &str, text: &str) -> Result<(), WriteError> {
        if self.stamped.contains(rel)
            || frontmatter::read_layout(&frontmatter::split(text))
                .created
                .is_some()
        {
            return Ok(());
        }
        let path = self.root.join(rel);
        let meta = fs::symlink_metadata(path)?;
        let (created, from) = meta
            .created()
            .ok()
            .and_then(to_ms)
            .map(|ms| (ms, "birth".to_owned()))
            .or_else(|| {
                meta.modified()
                    .ok()
                    .and_then(to_ms)
                    .map(|ms| (ms, "mtime".to_owned()))
            })
            .ok_or_else(|| {
                std::io::Error::other("file has no usable creation or modification time")
            })?;
        let now = (self.clock)();
        self.append_event(
            now,
            Event::NoteEstimated {
                path: rel.to_owned(),
                created,
                from,
            },
        )?;
        self.stamped.insert(rel.to_owned());
        Ok(())
    }

    fn append_event(&mut self, t: i64, event: Event) -> Result<(), WriteError> {
        let dir = self.root.join(journal::DIR);
        if fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(WriteError::Symlink(journal::DIR.into()));
        }
        if fs::symlink_metadata(journal::path(&self.root)).is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err(WriteError::Symlink(journal::FILE.into()));
        }
        journal::append(&self.root, &Entry { t, event })?;
        Ok(())
    }

    fn existing_note(&self, rel: &str) -> Result<PathBuf, WriteError> {
        let path = self.root.join(rel);
        let parent = path.parent().unwrap_or(&self.root);
        self.check_parent_canonical(parent, rel)?;
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(WriteError::NotFound(rel.to_owned()))
            }
            Err(e) => Err(e.into()),
            Ok(meta) if meta.file_type().is_symlink() => Err(WriteError::Symlink(rel.to_owned())),
            Ok(meta) if !meta.is_file() => Err(WriteError::NotFound(rel.to_owned())),
            Ok(_) => Ok(path),
        }
    }

    fn check_existing_parent(&self, dir: &Path, rel: &str) -> Result<(), WriteError> {
        let inner = dir
            .strip_prefix(&self.root)
            .map_err(|_| WriteError::BadPath(rel.to_owned()))?;
        let mut at = self.root.clone();
        for part in inner.components() {
            at.push(part);
            match fs::symlink_metadata(&at) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    return Err(WriteError::Symlink(rel.to_owned()));
                }
                Ok(meta) if !meta.is_dir() => return Err(WriteError::NotFound(rel.to_owned())),
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }

    fn check_parent_canonical(&self, dir: &Path, rel: &str) -> Result<(), WriteError> {
        let expected = dir;
        let actual = fs::canonicalize(dir).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                WriteError::NotFound(rel.to_owned())
            } else {
                e.into()
            }
        })?;
        if actual != expected {
            return Err(WriteError::Symlink(rel.to_owned()));
        }
        Ok(())
    }

    /// Same-directory rename is atomic. Replacing a note breaks hard links;
    /// that is accepted for vault writes.
    fn write_atomic(&mut self, rel: &str, path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
        let dir = path.parent().unwrap_or(&self.root);
        self.check_parent_canonical(dir, rel)?;
        let permissions: Option<Permissions> = match fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(WriteError::Symlink(rel.to_owned()));
            }
            Ok(meta) if meta.is_file() => Some(meta.permissions()),
            Ok(_) => return Err(WriteError::NotFound(rel.to_owned())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };
        self.temps += 1;
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("note");
        let tmp = dir.join(format!(
            ".{name}.tapestry-{}-{}.tmp",
            std::process::id(),
            self.temps
        ));
        let result = (|| -> std::io::Result<()> {
            let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
            file.write_all(bytes)?;
            if let Some(permissions) = permissions {
                fs::set_permissions(&tmp, permissions)?;
            }
            file.sync_all()?;
            drop(file);
            let hash = fnv1a64(bytes);
            self.own_writes.insert(rel.to_owned(), hash);
            self.known.insert(rel.to_owned(), hash);
            if let Err(error) = fs::rename(&tmp, path) {
                self.own_writes.remove(rel);
                return Err(error);
            }
            File::open(dir)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result.map_err(WriteError::Io)
    }
}

fn read_text(path: &Path, rel: &str) -> Result<String, WriteError> {
    let bytes = fs::read(path)?;
    String::from_utf8(bytes).map_err(|_| {
        WriteError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{rel} is not UTF-8"),
        ))
    })
}
fn to_ms(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}
fn strip_md(path: &str) -> &str {
    if path.len() >= 3 && path[path.len() - 3..].eq_ignore_ascii_case(".md") {
        &path[..path.len() - 3]
    } else {
        path
    }
}

fn cleanup_stale_temps(root: &Path) {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if !is_ignored_name(&name) {
                    stack.push(entry.path());
                }
            } else if kind.is_file() && is_stale_temp_name(&name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}
fn is_stale_temp_name(name: &str) -> bool {
    if !name.starts_with('.') || !name.ends_with(".tmp") {
        return false;
    }
    let Some(index) = name.find(".tapestry-") else {
        return false;
    };
    if index <= 1 {
        return false;
    }
    let Some((pid, counter)) = name[index + 10..name.len() - 4].split_once('-') else {
        return false;
    };
    !pid.is_empty()
        && !counter.is_empty()
        && pid.bytes().all(|b| b.is_ascii_digit())
        && counter.bytes().all(|b| b.is_ascii_digit())
}

fn line_bounds(text: &str, line: usize) -> Option<(usize, usize, usize)> {
    let starts = blocks::line_starts(text);
    let start = *starts.get(line)?;
    let end = starts.get(line + 1).copied().unwrap_or(text.len());
    let mut content_end = end;
    if content_end > start && text.as_bytes()[content_end - 1] == b'\n' {
        content_end -= 1;
    }
    if content_end > start && text.as_bytes()[content_end - 1] == b'\r' {
        content_end -= 1;
    }
    Some((start, end, content_end))
}

fn insert_link_on_line(
    text: &str,
    start: usize,
    end: usize,
    content_end: usize,
    link: &str,
    table: bool,
) -> Result<String, WriteError> {
    let line = &text[start..content_end];
    let mut insertion = String::with_capacity(text.len() + link.len() + 2);
    if table {
        if let Some(pipe) = line.rfind('|').filter(|i| line[*i + 1..].trim().is_empty()) {
            let prefix = &line[..pipe];
            let gap = if prefix.chars().last().is_some_and(char::is_whitespace) {
                ""
            } else {
                " "
            };
            insertion.push_str(&text[..start]);
            insertion.push_str(prefix);
            insertion.push_str(gap);
            insertion.push_str(link);
            insertion.push(' ');
            insertion.push_str(&line[pipe..]);
            insertion.push_str(&text[content_end..end]);
            insertion.push_str(&text[end..]);
            return Ok(insertion);
        }
    }
    let trimmed_end = line.trim_end().len();
    let trimmed = &line[..trimmed_end];
    let anchor_start = trimmed.rfind(" ^").filter(|start| {
        let id = &trimmed[*start + 2..];
        blocks::is_valid_id(id)
    });
    if let Some(anchor_start) = anchor_start {
        insertion.push_str(&text[..start]);
        insertion.push_str(&trimmed[..anchor_start]);
        insertion.push(' ');
        insertion.push_str(link);
        insertion.push_str(&trimmed[anchor_start..]);
        insertion.push_str(&line[trimmed_end..]);
        insertion.push_str(&text[content_end..end]);
        insertion.push_str(&text[end..]);
    } else {
        insertion.push_str(&text[..start]);
        insertion.push_str(trimmed);
        insertion.push(' ');
        insertion.push_str(link);
        insertion.push_str(&line[trimmed_end..]);
        insertion.push_str(&text[content_end..end]);
        insertion.push_str(&text[end..]);
    }
    Ok(insertion)
}
