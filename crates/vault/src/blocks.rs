//! Markdown block segmentation and insertion of Obsidian `^id` anchors.

use std::hash::{BuildHasher, Hasher};
use std::ops::Range;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::frontmatter::{self, Frontmatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    Paragraph,
    ListItem,
    Quote,
    Callout,
    Table,
    Heading,
    Fence,
    Comment,
    Rule,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub kind: BlockKind,
    pub lines: Range<usize>,
    pub id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockError {
    Heading,
    Fence,
    Frontmatter,
    Comment,
    Rule,
    NoBlock,
    LineOutOfRange,
    IdExhausted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edit {
    pub range: Range<usize>,
    pub insert: String,
}

impl Edit {
    pub fn apply(&self, text: &str) -> String {
        let mut result = String::with_capacity(text.len() + self.insert.len());
        result.push_str(&text[..self.range.start]);
        result.push_str(&self.insert);
        result.push_str(&text[self.range.end..]);
        result
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Anchor {
    pub id: String,
    pub edit: Option<Edit>,
}

pub trait IdGen {
    fn next_id(&mut self) -> String;
}

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct RandomIds {
    state: u64,
}

impl RandomIds {
    pub fn new() -> Self {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u64(ID_COUNTER.fetch_add(1, Ordering::Relaxed));
        let seed = hasher.finish()
            ^ SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64
            ^ ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        Self {
            state: if seed == 0 {
                0x9e37_79b9_7f4a_7c15
            } else {
                seed
            },
        }
    }
}

impl Default for RandomIds {
    fn default() -> Self {
        Self::new()
    }
}

impl IdGen for RandomIds {
    fn next_id(&mut self) -> String {
        const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
        let mut value = String::with_capacity(6);
        for _ in 0..6 {
            self.state ^= self.state >> 12;
            self.state ^= self.state << 25;
            self.state ^= self.state >> 27;
            let n = self.state.wrapping_mul(0x2545_f491_4f6c_dd1d);
            value.push(CHARS[(n % 36) as usize] as char);
        }
        value
    }
}

/// Byte starts for each line; a trailing newline creates a final empty line.
pub fn line_starts(text: &str) -> Vec<usize> {
    let mut starts = vec![0];
    for (i, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            starts.push(i + 1);
        }
    }
    starts
}

/// Returns the zero-based line containing `byte` (clamped to the final line).
pub fn line_of(text: &str, byte: usize) -> usize {
    let starts = line_starts(text);
    let byte = byte.min(text.len());
    starts
        .partition_point(|&start| start <= byte)
        .saturating_sub(1)
}

#[derive(Clone)]
struct Line {
    start: usize,
    end: usize,
    content_end: usize,
}

fn lines(text: &str) -> Vec<Line> {
    let starts = line_starts(text);
    starts
        .iter()
        .enumerate()
        .map(|(i, &start)| {
            let end = starts.get(i + 1).copied().unwrap_or(text.len());
            let mut content_end = end;
            if content_end > start && text.as_bytes()[content_end - 1] == b'\n' {
                content_end -= 1;
            }
            if content_end > start && text.as_bytes()[content_end - 1] == b'\r' {
                content_end -= 1;
            }
            Line {
                start,
                end,
                content_end,
            }
        })
        .collect()
}

fn content<'a>(text: &'a str, line: &Line) -> &'a str {
    &text[line.start..line.content_end]
}
fn blank(text: &str, l: &Line) -> bool {
    content(text, l).trim().is_empty()
}
fn indent_end(s: &str) -> usize {
    s.bytes().take_while(|b| *b == b' ').count()
}

fn list_marker(s: &str) -> Option<usize> {
    let indent = indent_end(s);
    let b = s.as_bytes();
    let mut i = indent;
    if i >= b.len() {
        return None;
    }
    if matches!(b[i], b'-' | b'*' | b'+') && i + 1 < b.len() && b[i + 1] == b' ' {
        return Some(indent);
    }
    let start = i;
    while i < b.len() && b[i].is_ascii_digit() && i - start < 9 {
        i += 1;
    }
    if i > start && i + 1 < b.len() && matches!(b[i], b'.' | b')') && b[i + 1] == b' ' {
        Some(indent)
    } else {
        None
    }
}

fn atx_heading(s: &str) -> bool {
    let n = indent_end(s);
    if n > 3 {
        return false;
    }
    let bytes = s.as_bytes();
    let mut i = n;
    while i < bytes.len() && bytes[i] == b'#' && i - n < 7 {
        i += 1;
    }
    let count = i - n;
    count > 0 && count <= 6 && (i == bytes.len() || bytes[i] == b' ')
}

fn setext(s: &str) -> bool {
    let trimmed = s.trim();
    !trimmed.is_empty()
        && (trimmed.bytes().all(|b| b == b'=') || trimmed.bytes().all(|b| b == b'-'))
}

fn rule(s: &str) -> bool {
    let mut chars = s.trim().chars().filter(|c| *c != ' ' && *c != '\t');
    let Some(first) = chars.next() else {
        return false;
    };
    matches!(first, '-' | '*' | '_')
        && chars.all(|c| c == first)
        && s.trim().chars().filter(|c| *c != ' ' && *c != '\t').count() >= 3
}

fn quote(s: &str) -> bool {
    let n = indent_end(s);
    n <= 3 && s[n..].starts_with('>')
}
fn table_delimiter(s: &str) -> bool {
    if !s.contains('|') {
        return false;
    }
    let cells: Vec<_> = s
        .split('|')
        .map(str::trim)
        .filter(|cell| !cell.is_empty())
        .collect();
    !cells.is_empty()
        && cells.iter().all(|cell| {
            let dashes = cell.trim_matches(':');
            !dashes.is_empty() && dashes.bytes().all(|b| b == b'-')
        })
}

fn marker_id(s: &str) -> Option<String> {
    let t = s.trim_end();
    let p = t.rfind('^')?;
    if p > 0 && !t.as_bytes()[p - 1].is_ascii_whitespace() {
        return None;
    }
    let id = &t[p + 1..];
    if is_valid_id(id) {
        Some(id.to_owned())
    } else {
        None
    }
}

fn id_only(s: &str) -> Option<String> {
    let t = s.trim();
    let id = t.strip_prefix('^')?;
    if is_valid_id(id) {
        Some(id.to_owned())
    } else {
        None
    }
}

pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn anchors_from(text: &str, ls: &[Line], start_line: usize, end_line: usize) -> Option<String> {
    if end_line > start_line {
        for i in (start_line..end_line).rev() {
            if let Some(id) = marker_id(content(text, &ls[i])) {
                return Some(id);
            }
            if !blank(text, &ls[i]) {
                break;
            }
        }
    }
    None
}

/// Segment Markdown into anchorable blocks. Line ranges are whole-file indices.
pub fn segment(text: &str) -> Vec<Block> {
    let ls = lines(text);
    let body_start = frontmatter::body_start(text);
    let first_body = line_of(text, body_start);
    let fence_lines: Vec<Range<usize>> = crate::links::fences(text)
        .into_iter()
        .map(|r| line_of(text, r.start)..line_of(text, r.end.saturating_sub(1)) + 1)
        .collect();
    let mut blocks = Vec::new();
    let mut i = first_body;
    while i < ls.len() {
        if blank(text, &ls[i]) {
            i += 1;
            continue;
        }
        if ls[i].start < body_start {
            i += 1;
            continue;
        }
        if let Some(r) = fence_lines.iter().find(|r| r.start == i) {
            blocks.push(Block {
                kind: BlockKind::Fence,
                lines: r.clone(),
                id: None,
            });
            i = r.end;
            continue;
        }
        let s = content(text, &ls[i]);
        if s.contains("%%") || s.trim_start().starts_with("<!--") {
            let start = i;
            let mut opened = s.matches("%%").count() % 2 == 1
                || s.trim_start().starts_with("<!--") && !s.contains("-->");
            let mut html = s.trim_start().starts_with("<!--") && !s.contains("-->");
            i += 1;
            while i < ls.len() && (opened || html) {
                let c = content(text, &ls[i]);
                if opened && c.contains("%%") && c.matches("%%").count() % 2 == 1 {
                    opened = false;
                }
                if html && c.contains("-->") {
                    html = false;
                }
                i += 1;
            }
            blocks.push(Block {
                kind: BlockKind::Comment,
                lines: start..i,
                id: None,
            });
            continue;
        }
        if atx_heading(s) {
            blocks.push(Block {
                kind: BlockKind::Heading,
                lines: i..i + 1,
                id: None,
            });
            i += 1;
            continue;
        }
        if i + 1 < ls.len() && setext(content(text, &ls[i + 1])) {
            blocks.push(Block {
                kind: BlockKind::Heading,
                lines: i..i + 2,
                id: None,
            });
            i += 2;
            continue;
        }
        if rule(s) {
            blocks.push(Block {
                kind: BlockKind::Rule,
                lines: i..i + 1,
                id: None,
            });
            i += 1;
            continue;
        }
        if i + 1 < ls.len() && s.contains('|') && table_delimiter(content(text, &ls[i + 1])) {
            let start = i;
            i += 2;
            while i < ls.len() && !blank(text, &ls[i]) && content(text, &ls[i]).contains('|') {
                i += 1;
            }
            let mut end = i;
            let mut id = None;
            if end < ls.len() && blank(text, &ls[end]) {
                if end + 1 < ls.len() {
                    id = id_only(content(text, &ls[end + 1]));
                    if id.is_some() {
                        end += 2;
                    }
                }
            } else if end < ls.len() {
                id = id_only(content(text, &ls[end]));
                if id.is_some() {
                    end += 1;
                }
            }
            if id.is_none() {
                id = anchors_from(text, &ls, start, i);
            }
            blocks.push(Block {
                kind: BlockKind::Table,
                lines: start..end,
                id,
            });
            i = end.max(i);
            continue;
        }
        if quote(s) {
            let start = i;
            let is_callout = s.trim_start().starts_with("> [!");
            i += 1;
            while i < ls.len() && quote(content(text, &ls[i])) {
                i += 1;
            }
            let body_end = i;
            let mut end = i;
            let mut id = None;
            if end < ls.len() && blank(text, &ls[end]) && end + 1 < ls.len() {
                id = id_only(content(text, &ls[end + 1]));
                if id.is_some() {
                    end += 2;
                }
            } else if end < ls.len() {
                id = id_only(content(text, &ls[end]));
                if id.is_some() {
                    end += 1;
                }
            }
            if id.is_none() {
                id = anchors_from(text, &ls, start, body_end);
            }
            blocks.push(Block {
                kind: if is_callout {
                    BlockKind::Callout
                } else {
                    BlockKind::Quote
                },
                lines: start..end,
                id,
            });
            i = end;
            continue;
        }
        if list_marker(s).is_some() {
            let start = i;
            i += 1;
            while i < ls.len() && !blank(text, &ls[i]) {
                let next = content(text, &ls[i]);
                if list_marker(next).is_some()
                    || atx_heading(next)
                    || quote(next)
                    || fence_lines.iter().any(|r| r.start == i)
                {
                    break;
                }
                i += 1;
            }
            let id = anchors_from(text, &ls, start, i);
            blocks.push(Block {
                kind: BlockKind::ListItem,
                lines: start..i,
                id,
            });
            continue;
        }
        let start = i;
        i += 1;
        while i < ls.len() && !blank(text, &ls[i]) {
            let next = content(text, &ls[i]);
            if atx_heading(next)
                || list_marker(next).is_some()
                || quote(next)
                || fence_lines.iter().any(|r| r.start == i)
                || rule(next)
            {
                break;
            }
            if i + 1 < ls.len() && next.contains('|') && table_delimiter(content(text, &ls[i + 1]))
            {
                break;
            }
            i += 1;
        }
        blocks.push(Block {
            kind: BlockKind::Paragraph,
            lines: start..i,
            id: anchors_from(text, &ls, start, i),
        });
    }
    blocks
}

/// Anchor ids already present as end-of-block or own-line markers.
pub fn ids(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for block in segment(text) {
        if let Some(id) = block.id {
            if !out.iter().any(|known| known == &id) {
                out.push(id);
            }
        }
    }
    out
}

fn line_ending(text: &str, line: &Line) -> &'static str {
    if line.end > line.content_end
        && text.as_bytes().get(line.end.saturating_sub(2)) == Some(&b'\r')
    {
        "\r\n"
    } else if line.end > line.content_end {
        "\n"
    } else {
        ""
    }
}

fn choose_id(text: &str, generator: &mut dyn IdGen) -> Result<String, BlockError> {
    let existing = ids(text);
    for _ in 0..64 {
        let candidate = generator.next_id();
        if is_valid_id(&candidate)
            && !existing
                .iter()
                .any(|id| id.eq_ignore_ascii_case(&candidate))
        {
            return Ok(candidate);
        }
    }
    Err(BlockError::IdExhausted)
}

/// Inserts a new stable anchor or returns an existing one for the selected block.
pub fn insert_anchor(
    text: &str,
    line: usize,
    generator: &mut dyn IdGen,
) -> Result<Anchor, BlockError> {
    let ls = lines(text);
    if line >= ls.len() {
        return Err(BlockError::LineOutOfRange);
    }
    let body_start = frontmatter::body_start(text);
    if ls[line].start < body_start {
        return Err(BlockError::Frontmatter);
    }
    let blocks = segment(text);
    let Some(block) = blocks.iter().find(|b| b.lines.contains(&line)) else {
        return Err(BlockError::NoBlock);
    };
    match block.kind {
        BlockKind::Heading => return Err(BlockError::Heading),
        BlockKind::Fence => return Err(BlockError::Fence),
        BlockKind::Comment => return Err(BlockError::Comment),
        BlockKind::Rule => return Err(BlockError::Rule),
        _ => {}
    }
    if let Some(id) = block.id.clone() {
        return Ok(Anchor { id, edit: None });
    }
    let id = choose_id(text, generator)?;
    let last_line = block.lines.end.saturating_sub(1);
    if matches!(block.kind, BlockKind::Paragraph | BlockKind::ListItem) {
        let ln = &ls[last_line];
        let slice = &text[ln.start..ln.content_end];
        let trim = slice
            .trim_end_matches(|c: char| c.is_ascii_whitespace())
            .len();
        let at = ln.start + trim;
        return Ok(Anchor {
            id: id.clone(),
            edit: Some(Edit {
                range: at..at,
                insert: format!(" ^{id}"),
            }),
        });
    }
    let le = match frontmatter::split(text) {
        Frontmatter::Parsed { region, .. }
        | Frontmatter::Invalid {
            region: Some(region),
            ..
        } => region.le.as_str(),
        _ => {
            if line_ending(text, &ls[last_line]) == "\r\n" {
                "\r\n"
            } else {
                "\n"
            }
        }
    };
    let le = if le.is_empty() { "\n" } else { le };
    let after = ls[last_line].end;
    let next_line = last_line + 1;
    let insert = if after == text.len() {
        if line_ending(text, &ls[last_line]).is_empty() {
            format!("{le}{le}^{id}{le}")
        } else {
            format!("{le}^{id}{le}")
        }
    } else if next_line < ls.len() && blank(text, &ls[next_line]) {
        let after_blank = ls
            .get(next_line + 1)
            .map_or(ls[next_line].end, |next| next.start);
        return Ok(Anchor {
            id: id.clone(),
            edit: Some(Edit {
                range: after_blank..after_blank,
                insert: format!("^{id}{le}{le}"),
            }),
        });
    } else {
        format!("{le}^{id}{le}{le}")
    };
    // Preserve a separator if inserting before a nonblank following line. At a
    // line start `after` is already a valid UTF-8 boundary.
    Ok(Anchor {
        id: id.clone(),
        edit: Some(Edit {
            range: after..after,
            insert,
        }),
    })
}
