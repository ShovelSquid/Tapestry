//! Read model joining vault files, card placement, blocks and wikilinks.

use std::collections::BTreeMap;
use std::ops::Range;

use crate::blocks::{self, BlockKind};
use crate::frontmatter::{self, Frontmatter, Layout};
use crate::layout::{self, CARD_H, CARD_W, GAP, Rect};
use crate::links::{self, LinkError};
use crate::scan::{NoteStatus, Scan};

pub fn key(s: &str) -> String {
    s.to_lowercase()
}

fn strip_md(path: &str) -> &str {
    if path.len() >= 3 && path[path.len() - 3..].eq_ignore_ascii_case(".md") {
        &path[..path.len() - 3]
    } else {
        path
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Resolution {
    Resolved(String),
    Ambiguous {
        pick: String,
        candidates: Vec<String>,
    },
    Unresolved,
}
impl Resolution {
    pub fn target(&self) -> Option<&str> {
        match self {
            Self::Resolved(rel) => Some(rel),
            Self::Ambiguous { pick, .. } => Some(pick),
            Self::Unresolved => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct BlockInfo {
    pub id: String,
    pub line: usize,
    pub kind: BlockKind,
}
#[derive(Debug, Clone, PartialEq)]
pub struct FolderMeta {
    pub rel: String,
    pub world: Option<(f64, f64, f64)>,
}
#[derive(Debug, Clone, PartialEq)]
pub struct LinkRec {
    pub source: String,
    pub source_line: usize,
    pub source_block: Option<String>,
    pub embed: bool,
    pub path: String,
    pub target: Resolution,
    pub target_block: Option<String>,
    pub heading: Option<String>,
    pub description: Option<String>,
    pub span: Range<usize>,
}

#[derive(Debug, Clone, Default)]
pub struct VaultIndex {
    pub generation: u64,
    pub notes: BTreeMap<String, NoteMeta>,
    pub folders: BTreeMap<String, FolderMeta>,
    pub links: Vec<LinkRec>,
    by_stem: BTreeMap<String, Vec<String>>,
    block_owner: BTreeMap<String, Vec<String>>,
    outlinks: BTreeMap<String, Vec<usize>>,
    backlinks: BTreeMap<String, Vec<usize>>,
}

#[derive(Debug, Clone)]
pub struct NoteMeta {
    pub rel: String,
    pub folder: String,
    pub title: String,
    pub frontmatter: FmStatus,
    pub layout: Layout,
    pub rect: Option<Rect>,
    /// Recomputed by each build; Phase 3 should cache this for the session.
    pub placed: Rect,
    pub computed: bool,
    pub created: Option<String>,
    pub mtime_ms: Option<i64>,
    pub birth_ms: Option<i64>,
    pub hash: u64,
    pub blocks: Vec<BlockInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FmStatus {
    Absent,
    Parsed,
    Invalid(String),
    Skipped,
}

impl VaultIndex {
    pub fn build(scan: &Scan) -> VaultIndex {
        let mut index = VaultIndex::default();
        let mut texts = BTreeMap::new();
        for note in &scan.notes {
            let (folder, file) = match note.rel.rsplit_once('/') {
                Some((folder, file)) => (folder.to_owned(), file),
                None => (String::new(), note.rel.as_str()),
            };
            let title = file
                .get(..file.len().saturating_sub(3))
                .unwrap_or(file)
                .to_owned();
            let (status, layout_values, blocks_info) = match (&note.text, note.status) {
                (Some(text), NoteStatus::Ok) => {
                    let fm = frontmatter::split(text);
                    let status = match &fm {
                        Frontmatter::Absent => FmStatus::Absent,
                        Frontmatter::Parsed { .. } => FmStatus::Parsed,
                        Frontmatter::Invalid { reason, .. } => {
                            FmStatus::Invalid(format!("{reason:?}"))
                        }
                    };
                    let layout_values = frontmatter::read_layout(&fm);
                    let blocks_info = blocks::segment(text)
                        .into_iter()
                        .filter_map(|block| {
                            block.id.map(|id| BlockInfo {
                                id,
                                line: block.lines.start,
                                kind: block.kind,
                            })
                        })
                        .collect::<Vec<_>>();
                    texts.insert(note.rel.clone(), text.clone());
                    (status, layout_values, blocks_info)
                }
                _ => (FmStatus::Skipped, Layout::default(), Vec::new()),
            };
            let rect = match (layout_values.x, layout_values.y) {
                (Some(x), Some(y)) if x.is_finite() && y.is_finite() => Some(Rect {
                    x,
                    y,
                    w: layout_values
                        .w
                        .filter(|w| w.is_finite() && *w > 0.0)
                        .unwrap_or(CARD_W),
                    h: layout_values
                        .h
                        .filter(|h| h.is_finite() && *h > 0.0)
                        .unwrap_or(CARD_H),
                }),
                _ => None,
            };
            let placed = rect.unwrap_or(Rect {
                x: 0.0,
                y: 0.0,
                w: CARD_W,
                h: CARD_H,
            });
            index
                .by_stem
                .entry(key(&title))
                .or_default()
                .push(note.rel.clone());
            for block in &blocks_info {
                index
                    .block_owner
                    .entry(key(&block.id))
                    .or_default()
                    .push(note.rel.clone());
            }
            index.notes.insert(
                note.rel.clone(),
                NoteMeta {
                    rel: note.rel.clone(),
                    folder,
                    title,
                    frontmatter: status,
                    layout: layout_values.clone(),
                    rect,
                    placed,
                    computed: rect.is_none(),
                    created: layout_values.created,
                    mtime_ms: note.mtime_ms,
                    birth_ms: note.birth_ms,
                    hash: note.hash,
                    blocks: blocks_info,
                },
            );
        }
        for paths in index.by_stem.values_mut() {
            paths.sort();
            paths.dedup();
        }
        for owners in index.block_owner.values_mut() {
            owners.sort();
            owners.dedup();
        }

        for folder in &scan.folders {
            let world_note = if folder.is_empty() {
                None
            } else {
                let basename = folder.rsplit('/').next().unwrap_or(folder);
                index.notes.get(&format!("{folder}/{basename}.md"))
            };
            let world = world_note
                .and_then(|n| Some((n.layout.world_x?, n.layout.world_y?, n.layout.world_scale?)));
            index.folders.insert(
                folder.clone(),
                FolderMeta {
                    rel: folder.clone(),
                    world,
                },
            );
            let positioned: Vec<Rect> = index
                .notes
                .values()
                .filter(|n| n.folder == *folder)
                .filter_map(|n| n.rect)
                .collect();
            let mut occupied = positioned;
            let unpositioned: Vec<String> = index
                .notes
                .values()
                .filter(|n| n.folder == *folder && n.rect.is_none())
                .map(|n| n.rel.clone())
                .collect();
            for rel in unpositioned {
                let note = index.notes.get_mut(&rel).unwrap();
                note.placed = layout::place_free(&occupied, (CARD_W, CARD_H), (0.0, 0.0), GAP);
                note.computed = true;
                occupied.push(note.placed);
            }
        }

        for (source, text) in texts {
            let line_blocks = blocks::segment(&text);
            for link in links::parse(&text) {
                let source_line = blocks::line_of(&text, link.span.start);
                let source_block = line_blocks
                    .iter()
                    .find(|block| block.lines.contains(&source_line))
                    .and_then(|block| block.id.clone());
                let path = link.target_text(&text).trim().to_owned();
                let target = index.resolve(&path, &source);
                let record = LinkRec {
                    source: source.clone(),
                    source_line,
                    source_block,
                    embed: link.embed,
                    path,
                    target,
                    target_block: link.block_id(&text).map(str::to_owned),
                    heading: link.heading(&text).map(str::to_owned),
                    description: link.alias_text(&text).map(str::to_owned),
                    span: link.span,
                };
                let ix = index.links.len();
                index.outlinks.entry(source.clone()).or_default().push(ix);
                if let Some(target) = record.target.target() {
                    index.backlinks.entry(key(target)).or_default().push(ix);
                }
                index.links.push(record);
            }
        }
        index
    }

    pub fn resolve(&self, path: &str, source_rel: &str) -> Resolution {
        let raw = path.trim().replace('\\', "/");
        if raw.is_empty() {
            return if self.notes.contains_key(source_rel) {
                Resolution::Resolved(source_rel.to_owned())
            } else {
                Resolution::Unresolved
            };
        }
        let relative = raw.starts_with("./") || raw.starts_with("../");
        let mut parts: Vec<&str> = Vec::new();
        if relative {
            if let Some((folder, _)) = source_rel.rsplit_once('/') {
                parts.extend(folder.split('/'));
            }
        }
        let path_part = raw.trim_start_matches('/');
        let mut escaped = false;
        for part in path_part.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    if parts.pop().is_none() {
                        escaped = true;
                        break;
                    }
                }
                p => parts.push(p),
            }
        }
        if escaped {
            return Resolution::Unresolved;
        }
        let mut normalized = parts.join("/");
        if normalized.to_ascii_lowercase().ends_with(".md") {
            normalized.truncate(normalized.len() - 3);
        }
        let wanted = key(&normalized);
        if wanted.is_empty() {
            return Resolution::Resolved(source_rel.to_owned());
        }
        let all: Vec<&String> = self.notes.keys().collect();
        let exact: Vec<String> = all
            .iter()
            .filter(|rel| key(rel) == format!("{wanted}.md"))
            .map(|r| (*r).clone())
            .collect();
        if let Some(result) = pick(exact, source_rel, false) {
            return result;
        }
        let candidates: Vec<String> = if wanted.contains('/') {
            let suffix = format!("/{wanted}.md");
            all.iter()
                .filter(|rel| key(rel).ends_with(&suffix))
                .map(|r| (*r).clone())
                .collect()
        } else {
            self.by_stem.get(&wanted).cloned().unwrap_or_default()
        };
        pick(candidates, source_rel, true).unwrap_or(Resolution::Unresolved)
    }

    pub fn outlinks(&self, rel: &str) -> Vec<&LinkRec> {
        self.outlinks
            .get(rel)
            .into_iter()
            .flatten()
            .filter_map(|i| self.links.get(*i))
            .collect()
    }
    pub fn backlinks(&self, rel: &str) -> Vec<&LinkRec> {
        self.backlinks
            .get(&key(rel))
            .into_iter()
            .flatten()
            .filter_map(|i| self.links.get(*i))
            .collect()
    }
    pub fn block_owners(&self, id: &str) -> Vec<String> {
        self.block_owner.get(&key(id)).cloned().unwrap_or_default()
    }
    pub fn link_path(&self, target_rel: &str) -> String {
        let stem = strip_md(target_rel.rsplit('/').next().unwrap_or(target_rel));
        if self
            .by_stem
            .get(&key(stem))
            .is_some_and(|paths| paths.len() == 1)
        {
            stem.to_owned()
        } else {
            strip_md(target_rel).to_owned()
        }
    }
    pub fn build_link(
        &self,
        target_rel: &str,
        target_block: Option<&str>,
        description: &str,
        in_table: bool,
    ) -> Result<String, LinkError> {
        links::build_link(
            &self.link_path(target_rel),
            target_block,
            description,
            in_table,
        )
    }
}

fn pick(
    mut candidates: Vec<String>,
    source_rel: &str,
    ambiguous_allowed: bool,
) -> Option<Resolution> {
    candidates.sort();
    candidates.dedup();
    match candidates.len() {
        0 => None,
        1 => Some(Resolution::Resolved(candidates.remove(0))),
        _ if !ambiguous_allowed => None,
        _ => {
            let source_folder = source_rel.rsplit_once('/').map(|(f, _)| f).unwrap_or("");
            let mut ranked = candidates.clone();
            ranked.sort_by_key(|rel| {
                let folder = rel.rsplit_once('/').map(|(f, _)| f).unwrap_or("");
                (
                    usize::from(folder != source_folder),
                    rel.matches('/').count() + 1,
                    rel.len(),
                    rel.clone(),
                )
            });
            Some(Resolution::Ambiguous {
                pick: ranked[0].clone(),
                candidates,
            })
        }
    }
}
