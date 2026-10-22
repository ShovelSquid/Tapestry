//! Obsidian wikilink scanning and construction over plain Markdown text.

use std::ops::Range;

use crate::frontmatter::{self, Frontmatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubpathKind {
    Heading,
    Block,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Subpath {
    pub kind: SubpathKind,
    /// The byte range excludes `#` and, for block ids, the leading `^`.
    pub range: Range<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub span: Range<usize>,
    pub embed: bool,
    pub target: Range<usize>,
    pub subpath: Option<Subpath>,
    pub alias: Option<Range<usize>>,
    pub escaped_pipe: bool,
}

impl Link {
    pub fn target_text<'a>(&self, text: &'a str) -> &'a str {
        &text[self.target.clone()]
    }

    pub fn subpath_text<'a>(&self, text: &'a str) -> Option<&'a str> {
        self.subpath.as_ref().map(|s| &text[s.range.clone()])
    }

    pub fn alias_text<'a>(&self, text: &'a str) -> Option<&'a str> {
        self.alias.as_ref().map(|r| &text[r.clone()])
    }

    pub fn block_id<'a>(&self, text: &'a str) -> Option<&'a str> {
        self.subpath
            .as_ref()
            .filter(|s| s.kind == SubpathKind::Block)
            .map(|s| &text[s.range.clone()])
    }

    pub fn heading<'a>(&self, text: &'a str) -> Option<&'a str> {
        self.subpath
            .as_ref()
            .filter(|s| s.kind == SubpathKind::Heading)
            .map(|s| &text[s.range.clone()])
    }
}

fn line_ranges(text: &str, from: usize) -> Vec<Range<usize>> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut start = from;
    while start < bytes.len() {
        let mut end = start;
        while end < bytes.len() && bytes[end] != b'\n' {
            end += 1;
        }
        if end < bytes.len() {
            end += 1;
        }
        out.push(start..end);
        start = end;
    }
    out
}

fn content_end(text: &str, range: &Range<usize>) -> usize {
    let b = text.as_bytes();
    let mut end = range.end;
    if end > range.start && b[end - 1] == b'\n' {
        end -= 1;
    }
    if end > range.start && b[end - 1] == b'\r' {
        end -= 1;
    }
    end
}

/// Remove blockquote prefixes (including repeated nested prefixes), then at
/// most three indentation spaces as Markdown fenced-code syntax permits.
fn fence_content_start(text: &str, range: &Range<usize>) -> usize {
    let bytes = text.as_bytes();
    let end = content_end(text, range);
    let mut i = range.start;
    loop {
        let mut spaces = 0;
        while i < end && bytes[i] == b' ' && spaces < 4 {
            i += 1;
            spaces += 1;
        }
        if spaces > 3 {
            return end;
        }
        if i < end && bytes[i] == b'>' {
            i += 1;
            if i < end && bytes[i] == b' ' {
                i += 1;
            }
        } else {
            break;
        }
    }
    let mut spaces = 0;
    while i < end && bytes[i] == b' ' && spaces < 4 {
        i += 1;
        spaces += 1;
    }
    if spaces > 3 { end } else { i }
}

fn fence_marker(text: &str, line: &Range<usize>) -> Option<(u8, usize, usize)> {
    let start = fence_content_start(text, line);
    let end = content_end(text, line);
    let bytes = text.as_bytes();
    let ch = *bytes.get(start)?;
    if ch != b'`' && ch != b'~' {
        return None;
    }
    let mut run_end = start;
    while run_end < end && bytes[run_end] == ch {
        run_end += 1;
    }
    let n = run_end - start;
    if n < 3 {
        return None;
    }
    if ch == b'`' && bytes[run_end..end].contains(&b'`') {
        return None;
    }
    Some((ch, n, run_end))
}

/// Returns fenced-code ranges, including the opening and closing lines.
/// Unclosed fences extend to EOF.
pub fn fences(text: &str) -> Vec<Range<usize>> {
    let lines = line_ranges(text, frontmatter::body_start(text));
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let Some((ch, n, _)) = fence_marker(text, &lines[i]) else {
            i += 1;
            continue;
        };
        let start = lines[i].start;
        i += 1;
        let mut close = None;
        while i < lines.len() {
            if let Some((close_ch, close_n, run_end)) = fence_marker(text, &lines[i]) {
                let end = content_end(text, &lines[i]);
                if close_ch == ch && close_n >= n && text[run_end..end].trim().is_empty() {
                    close = Some(lines[i].end);
                    i += 1;
                    break;
                }
            }
            i += 1;
        }
        let end = close.unwrap_or(text.len());
        out.push(start..end);
    }
    out
}

fn byte_run(bytes: &[u8], mut i: usize, byte: u8) -> usize {
    while i < bytes.len() && bytes[i] == byte {
        i += 1;
    }
    i
}

fn exact_backtick_close(bytes: &[u8], mut i: usize, n: usize) -> Option<usize> {
    while i < bytes.len() {
        if bytes[i] == b'\n' {
            let mut p = i + 1;
            while p < bytes.len() && (bytes[p] == b' ' || bytes[p] == b'\t' || bytes[p] == b'\r') {
                p += 1;
            }
            if p < bytes.len() && bytes[p] == b'\n' {
                return None;
            }
        }
        if bytes[i] == b'`' {
            let end = byte_run(bytes, i, b'`');
            if end - i == n {
                return Some(end);
            }
            i = end;
        } else {
            i += 1;
        }
    }
    None
}

fn merged(mut ranges: Vec<Range<usize>>) -> Vec<Range<usize>> {
    ranges.sort_by_key(|r| (r.start, r.end));
    let mut out: Vec<Range<usize>> = Vec::new();
    for r in ranges {
        if let Some(last) = out.last_mut() {
            if r.start <= last.end {
                last.end = last.end.max(r.end);
                continue;
            }
        }
        out.push(r);
    }
    out
}

/// Sorted, merged byte ranges that must not be scanned for wikilinks.
pub fn mask(text: &str) -> Vec<Range<usize>> {
    let mut ranges = fences(text);
    match frontmatter::split(text) {
        Frontmatter::Parsed { region, .. }
        | Frontmatter::Invalid {
            region: Some(region),
            ..
        } => {
            ranges.push(0..region.body_start);
        }
        _ => {}
    }
    let base = merged(ranges);
    let bytes = text.as_bytes();
    let mut comments = Vec::new();
    let mut i = 0;
    let mut blocked = 0;
    while i < bytes.len() {
        while blocked < base.len() && base[blocked].end <= i {
            blocked += 1;
        }
        if blocked < base.len() && i >= base[blocked].start {
            i = base[blocked].end;
            blocked += 1;
            continue;
        }
        if i + 1 < bytes.len() && bytes[i] == b'%' && bytes[i + 1] == b'%' {
            let mut j = i + 2;
            while j + 1 < bytes.len() && !(bytes[j] == b'%' && bytes[j + 1] == b'%') {
                j += 1;
            }
            let end = if j + 1 < bytes.len() {
                j + 2
            } else {
                bytes.len()
            };
            comments.push(i..end);
            i = end;
        } else if i + 3 < bytes.len() && &bytes[i..i + 4] == b"<!--" {
            let mut j = i + 4;
            while j + 2 < bytes.len() && &bytes[j..j + 3] != b"-->" {
                j += 1;
            }
            let end = if j + 2 < bytes.len() {
                j + 3
            } else {
                bytes.len()
            };
            comments.push(i..end);
            i = end;
        } else if bytes[i] == b'`' {
            let end = byte_run(bytes, i, b'`');
            if let Some(close) = exact_backtick_close(bytes, end, end - i) {
                comments.push(i..close);
                i = close;
            } else {
                i = end;
            }
        } else {
            i += 1;
        }
    }
    merged(base.into_iter().chain(comments).collect())
}

fn trim_ascii(text: &str, mut range: Range<usize>) -> Range<usize> {
    let b = text.as_bytes();
    while range.start < range.end && b[range.start].is_ascii_whitespace() {
        range.start += 1;
    }
    while range.start < range.end && b[range.end - 1].is_ascii_whitespace() {
        range.end -= 1;
    }
    range
}

fn in_ranges(ranges: &[Range<usize>], pos: usize, mut cursor: usize) -> (bool, usize) {
    while cursor < ranges.len() && ranges[cursor].end <= pos {
        cursor += 1;
    }
    (
        cursor < ranges.len() && ranges[cursor].start <= pos && pos < ranges[cursor].end,
        cursor,
    )
}

/// Parses Obsidian-style links and records exact byte ranges for every field.
pub fn parse(text: &str) -> Vec<Link> {
    let masks = mask(text);
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    let mut mask_cursor = 0;
    while i + 1 < b.len() {
        let (masked, cursor) = in_ranges(&masks, i, mask_cursor);
        mask_cursor = cursor;
        if masked {
            i = masks[cursor].end;
            mask_cursor += 1;
            continue;
        }
        if b[i] != b'[' || b[i + 1] != b'[' {
            i += 1;
            continue;
        }
        let open = i;
        let mut p = i + 2;
        let mut close = None;
        let mut restart = None;
        let mut invalid_mask = false;
        while p + 1 < b.len() {
            if b[p] == b'\n' {
                break;
            }
            let (masked, next_cursor) = in_ranges(&masks, p, mask_cursor);
            mask_cursor = next_cursor;
            if masked {
                invalid_mask = true;
                break;
            }
            if b[p] == b'[' && b[p + 1] == b'[' {
                restart = Some(p);
                break;
            }
            if b[p] == b']' && b[p + 1] == b']' {
                close = Some(p);
                break;
            }
            p += 1;
        }
        if let Some(inner_open) = restart {
            i = inner_open;
            continue;
        }
        let Some(close_at) = close.filter(|_| !invalid_mask) else {
            i = open + 2;
            continue;
        };
        let end = close_at + 2;
        let embed = open > 0 && b[open - 1] == b'!';
        let span_start = if embed { open - 1 } else { open };
        let inner_start = open + 2;
        let mut pipe = None;
        let mut q = inner_start;
        while q < close_at {
            if b[q] == b'|' {
                pipe = Some(q);
                break;
            }
            q += 1;
        }
        let escaped_pipe = pipe.is_some_and(|at| at > inner_start && b[at - 1] == b'\\');
        let target_end = pipe.map_or(close_at, |at| if escaped_pipe { at - 1 } else { at });
        let raw_target = trim_ascii(text, inner_start..target_end);
        let alias = pipe.map(|at| trim_ascii(text, at + 1..close_at));
        let hash = (raw_target.start..raw_target.end).find(|&k| b[k] == b'#');
        let (target, subpath) = if let Some(hash_at) = hash {
            let target = trim_ascii(text, raw_target.start..hash_at);
            let raw_sub = trim_ascii(text, hash_at + 1..raw_target.end);
            if raw_sub.start < raw_sub.end && b[raw_sub.start] == b'^' {
                (
                    target,
                    Some(Subpath {
                        kind: SubpathKind::Block,
                        range: raw_sub.start + 1..raw_sub.end,
                    }),
                )
            } else {
                (
                    target,
                    Some(Subpath {
                        kind: SubpathKind::Heading,
                        range: raw_sub,
                    }),
                )
            }
        } else {
            (raw_target, None)
        };
        if target.start < target.end || subpath.is_some() {
            out.push(Link {
                span: span_start..end,
                embed,
                target,
                subpath,
                alias,
                escaped_pipe,
            });
        }
        i = end;
    }
    out
}

/// Returns non-empty, exact-string-deduplicated link targets in source order.
pub fn targets(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for link in parse(text) {
        let target = link.target_text(text).trim();
        if !target.is_empty() && !out.iter().any(|known: &String| known == target) {
            out.push(target.to_owned());
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    EmptyDescription,
    ForbiddenInDescription(&'static str),
    EmptyTarget,
    ForbiddenInTarget(&'static str),
    BadBlockId(String),
}

/// Validates a user-provided description, normalizing only whitespace.
pub fn validate_description(raw: &str) -> Result<String, LinkError> {
    let normalized = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err(LinkError::EmptyDescription);
    }
    for token in ["[", "]", "|", "`", "%%", "<!--"] {
        if normalized.contains(token) {
            return Err(LinkError::ForbiddenInDescription(token));
        }
    }
    Ok(normalized)
}

/// Builds a described wikilink using the supplied path and user description.
pub fn build_link(
    path: &str,
    block: Option<&str>,
    description: &str,
    in_table: bool,
) -> Result<String, LinkError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(LinkError::EmptyTarget);
    }
    for token in ["#", "|", "^", ":", "%%", "[[", "]]"] {
        if path.contains(token) {
            return Err(LinkError::ForbiddenInTarget(token));
        }
    }
    if let Some(id) = block {
        if !crate::blocks::is_valid_id(id) {
            return Err(LinkError::BadBlockId(id.to_owned()));
        }
    }
    let description = validate_description(description)?;
    let pipe = if in_table { "\\|" } else { "|" };
    let subpath = block.map_or_else(String::new, |id| format!("#^{id}"));
    Ok(format!("[[{path}{subpath}{pipe}{description}]]"))
}
