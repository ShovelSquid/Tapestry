//! Reading a note's YAML frontmatter, and splicing the app's own keys into it.
//!
//! Frontmatter is the block between a `---` line at the very top of a note
//! (after an optional UTF-8 BOM) and the next `---` line. It is read with
//! `yaml_serde`, but it is never re-serialised: the app writes by editing the
//! value bytes of its own keys (`x`, `y`, `w`, `h`, `world-x`, `world-y`,
//! `world-scale`, `created`) as text lines, so comments, lists, quoting,
//! unknown keys, CRLF line endings and a BOM all survive byte for byte.

use std::ops::Range;

use yaml_serde::{Mapping, Value};

/// The keys this app owns. Every other key belongs to the user.
pub const APP_KEYS: [&str; 8] = ["x", "y", "w", "h", "created", "world-x", "world-y", "world-scale"];

/// Frontmatter larger than this is never parsed (and so never rewritten).
pub const MAX_FRONTMATTER_BYTES: usize = 64 * 1024;

/// The splice order for layout keys (`created` is only written by `ensure_created`).
const LAYOUT_KEYS: [&str; 7] = ["x", "y", "w", "h", "world-x", "world-y", "world-scale"];

const BOM: &str = "\u{FEFF}";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEnding {
    Lf,
    CrLf,
}

impl LineEnding {
    pub fn as_str(&self) -> &'static str {
        match self {
            LineEnding::Lf => "\n",
            LineEnding::CrLf => "\r\n",
        }
    }
}

/// Where the frontmatter sits in a note's text (byte offsets).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Region {
    /// The text starts with a UTF-8 BOM (the opening line starts at byte 3).
    pub bom: bool,
    /// The YAML between the delimiter lines.
    pub inner: Range<usize>,
    /// The closing delimiter line, including its line ending.
    pub close: Range<usize>,
    /// The first byte after the closing line.
    pub body_start: usize,
    /// The opening line's line ending.
    pub le: LineEnding,
}

/// Why a note's frontmatter cannot be trusted (so the note is never rewritten).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invalid {
    /// An opening `---` with no closing `---`.
    Unterminated,
    /// Closed with `...`, which Obsidian does not document.
    DotsTerminator,
    /// Valid YAML whose top level is not a mapping.
    NotMapping,
    /// Over `MAX_FRONTMATTER_BYTES`.
    TooLarge,
    /// The YAML parser's message.
    Yaml(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Frontmatter {
    /// No `---` on the first line: the whole text is body.
    Absent,
    Parsed { region: Region, map: Mapping },
    Invalid { region: Option<Region>, reason: Invalid },
}

/// Finds and parses a note's frontmatter.
pub fn split(text: &str) -> Frontmatter {
    let bom = text.starts_with(BOM);
    let start = if bom { BOM.len() } else { 0 };
    let Some(open) = line_at(text, start) else {
        return Frontmatter::Absent;
    };
    if !is_delim(open.content(text), "---") {
        return Frontmatter::Absent;
    }
    let le = open.ending(text);
    let inner_start = open.end;
    let mut pos = inner_start;
    let close = loop {
        let Some(line) = line_at(text, pos) else {
            return Frontmatter::Invalid { region: None, reason: Invalid::Unterminated };
        };
        if is_delim(line.content(text), "---") {
            break line;
        }
        pos = line.end;
    };
    let region = Region {
        bom,
        inner: inner_start..close.start,
        close: close.start..close.end,
        body_start: close.end,
        le,
    };
    match yaml_serde::from_str::<Value>(&text[region.inner.clone()]) {
        Ok(Value::Mapping(map)) => Frontmatter::Parsed { region, map },
        Ok(Value::Null) => Frontmatter::Parsed { region, map: Mapping::new() },
        Ok(_) => Frontmatter::Invalid { region: Some(region), reason: Invalid::NotMapping },
        Err(e) => Frontmatter::Invalid { region: Some(region), reason: Invalid::Yaml(e.to_string()) },
    }
}

/// The first byte of the body: after the frontmatter, or 0 when there is none.
pub fn body_start(text: &str) -> usize {
    match split(text) {
        Frontmatter::Parsed { region, .. } | Frontmatter::Invalid { region: Some(region), .. } => {
            region.body_start
        }
        _ => 0,
    }
}

/// The app's keys as read from a note. Absent or unusable values are `None`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Layout {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub world_x: Option<f64>,
    pub world_y: Option<f64>,
    pub world_scale: Option<f64>,
    pub created: Option<String>,
    /// App keys holding something that is not a number (`x: left`). The card
    /// falls back to a computed place and the app never overwrites the key.
    pub conflicts: Vec<&'static str>,
}

impl Layout {
    fn slot(&mut self, key: &str) -> Option<&mut Option<f64>> {
        Some(match key {
            "x" => &mut self.x,
            "y" => &mut self.y,
            "w" => &mut self.w,
            "h" => &mut self.h,
            "world-x" => &mut self.world_x,
            "world-y" => &mut self.world_y,
            "world-scale" => &mut self.world_scale,
            _ => return None,
        })
    }
}

/// Reads the app's keys from parsed frontmatter (all `None` otherwise).
pub fn read_layout(fm: &Frontmatter) -> Layout {
    let mut out = Layout::default();
    let Frontmatter::Parsed { map, .. } = fm else {
        return out;
    };
    for key in LAYOUT_KEYS {
        if let Some(v) = map.get(key)
            && let Some(slot) = out.slot(key)
        {
            *slot = v.as_f64().filter(|n| n.is_finite());
        }
    }
    out.created = map.get("created").and_then(|v| v.as_str()).map(str::to_owned);
    out
}

/// A layout write: each `Some` key is set, each `None` key is left alone.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct LayoutPatch {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub world_x: Option<f64>,
    pub world_y: Option<f64>,
    pub world_scale: Option<f64>,
}

impl LayoutPatch {
    /// The patched keys with their values, in splice order.
    fn entries(&self) -> Vec<(&'static str, f64)> {
        let all = [
            ("x", self.x),
            ("y", self.y),
            ("w", self.w),
            ("h", self.h),
            ("world-x", self.world_x),
            ("world-y", self.world_y),
            ("world-scale", self.world_scale),
        ];
        all.into_iter().filter_map(|(k, v)| v.map(|v| (k, v))).collect()
    }
}

/// Why a write into a note's frontmatter was refused. The note is left as is.
#[derive(Debug, Clone, PartialEq)]
pub enum SpliceError {
    /// The frontmatter cannot be parsed; the note is never rewritten.
    Unparseable(Invalid),
    /// The key is set in a form a line edit cannot safely change
    /// (flow mapping, quoted key, value on the next line).
    KeyNotSpliceable(&'static str),
    /// The key holds something that is not a number.
    Conflict(&'static str),
    /// The patch value for the key is NaN or infinite.
    NonFinite(&'static str),
    /// The edited text did not re-parse to exactly the intended values.
    Verify(String),
}

impl std::fmt::Display for SpliceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SpliceError::Unparseable(why) => write!(f, "frontmatter cannot be parsed: {why:?}"),
            SpliceError::KeyNotSpliceable(k) => write!(f, "`{k}` is written in a form that cannot be edited safely"),
            SpliceError::Conflict(k) => write!(f, "`{k}` holds something that is not a number"),
            SpliceError::NonFinite(k) => write!(f, "`{k}` would be set to a non-finite number"),
            SpliceError::Verify(msg) => write!(f, "edit did not verify: {msg}"),
        }
    }
}

impl std::error::Error for SpliceError {}

/// Writes the patched layout keys into `text`.
///
/// `Ok(None)` means the note already holds these values (after rounding) and
/// should not be rewritten. Only the value bytes of existing key lines change;
/// missing keys become new lines just before the closing `---`; a note with
/// no frontmatter gets a new block at the top.
pub fn splice_layout(text: &str, patch: &LayoutPatch) -> Result<Option<String>, SpliceError> {
    let entries = patch.entries();
    for &(key, v) in &entries {
        if !v.is_finite() {
            return Err(SpliceError::NonFinite(key));
        }
    }
    if entries.is_empty() {
        return Ok(None);
    }
    let lines: Vec<String> = entries.iter().map(|&(k, v)| format!("{k}: {}", format_num(v))).collect();
    match split(text) {
        Frontmatter::Absent => Ok(Some(prepend_block(text, &lines))),
        Frontmatter::Invalid { reason, .. } => Err(SpliceError::Unparseable(reason)),
        Frontmatter::Parsed { region, map } => {
            let mut edits: Vec<(Range<usize>, String)> = Vec::new();
            let mut insert = String::new();
            for &(key, v) in &entries {
                let new = format_num(v);
                if map.get(key).is_none() {
                    insert.push_str(&format!("{key}: {new}{}", region.le.as_str()));
                    continue;
                }
                let Some(value) = find_value(text, &region, key) else {
                    return Err(SpliceError::KeyNotSpliceable(key));
                };
                if text[value.clone()] != new {
                    edits.push((value, new));
                }
            }
            if !insert.is_empty() {
                edits.push((region.close.start..region.close.start, insert));
            }
            if edits.is_empty() {
                return Ok(None);
            }
            Ok(Some(apply(text, edits)))
        }
    }
}

/// Adds `created: ISO` unless the note already has a `created` key (never overwritten).
pub fn ensure_created(text: &str, iso: &str) -> Result<Option<String>, SpliceError> {
    let line = format!("created: {iso}");
    match split(text) {
        Frontmatter::Absent => Ok(Some(prepend_block(text, &[line]))),
        Frontmatter::Invalid { reason, .. } => Err(SpliceError::Unparseable(reason)),
        Frontmatter::Parsed { region, map } => {
            if map.get("created").is_some() {
                return Ok(None);
            }
            let at = region.close.start;
            Ok(Some(apply(text, vec![(at..at, format!("{line}{}", region.le.as_str()))])))
        }
    }
}

/// A number as the app writes it: one decimal at most, integers without `.0`,
/// never in exponent form.
pub fn format_num(v: f64) -> String {
    let r = (v * 10.0).round() / 10.0;
    if r == 0.0 {
        return "0".to_owned();
    }
    format!("{r}")
}

/// A new frontmatter block holding `lines`, placed after any BOM.
fn prepend_block(text: &str, lines: &[String]) -> String {
    let at = if text.starts_with(BOM) { BOM.len() } else { 0 };
    let le = first_line_ending(text).as_str();
    let mut block = format!("---{le}");
    for line in lines {
        block.push_str(line);
        block.push_str(le);
    }
    block.push_str("---");
    block.push_str(le);
    let mut out = String::with_capacity(text.len() + block.len());
    out.push_str(&text[..at]);
    out.push_str(&block);
    out.push_str(&text[at..]);
    out
}

fn first_line_ending(text: &str) -> LineEnding {
    match text.find('\n') {
        Some(i) if i > 0 && text.as_bytes()[i - 1] == b'\r' => LineEnding::CrLf,
        _ => LineEnding::Lf,
    }
}

/// The byte range of `key`'s value on its top-level line, when there is
/// exactly one such line and the value sits on it.
fn find_value(text: &str, region: &Region, key: &str) -> Option<Range<usize>> {
    let mut found = None;
    let mut pos = region.inner.start;
    while let Some(line) = line_at(text, pos).filter(|l| l.start < region.inner.end) {
        pos = line.end;
        let content = line.content(text);
        let Some(rest) = content.strip_prefix(key) else { continue };
        let after_key = rest.trim_start_matches([' ', '\t']);
        let Some(after_colon) = after_key.strip_prefix(':') else { continue };
        if !(after_colon.is_empty() || after_colon.starts_with([' ', '\t'])) {
            continue;
        }
        if found.is_some() {
            return None;
        }
        let colon = line.start + (content.len() - after_colon.len());
        let value_start = colon + (after_colon.len() - after_colon.trim_start_matches([' ', '\t']).len());
        let value = &text[value_start..line.start + content.len()];
        let value_len = comment_start(value).unwrap_or(value.len());
        let value_len = value[..value_len].trim_end_matches([' ', '\t']).len();
        found = Some(value_start..value_start + value_len);
    }
    found
}

/// Where a ` # comment` begins in a line's value part (a `#` at the start or
/// after a space or tab).
fn comment_start(value: &str) -> Option<usize> {
    let b = value.as_bytes();
    (0..b.len()).find(|&i| b[i] == b'#' && (i == 0 || b[i - 1] == b' ' || b[i - 1] == b'\t'))
}

/// Applies non-overlapping edits (sorted here by start).
fn apply(text: &str, mut edits: Vec<(Range<usize>, String)>) -> String {
    edits.sort_by_key(|(r, _)| (r.start, r.end));
    let mut out = String::with_capacity(text.len() + 64);
    let mut at = 0;
    for (range, insert) in edits {
        out.push_str(&text[at..range.start]);
        out.push_str(&insert);
        at = range.end;
    }
    out.push_str(&text[at..]);
    out
}

/// One line: `start..end` includes the line ending; `content` excludes it.
struct Line {
    start: usize,
    end: usize,
    content_end: usize,
}

impl Line {
    fn content<'a>(&self, text: &'a str) -> &'a str {
        &text[self.start..self.content_end]
    }

    fn ending(&self, text: &str) -> LineEnding {
        if text[self.content_end..self.end].starts_with('\r') {
            LineEnding::CrLf
        } else {
            LineEnding::Lf
        }
    }
}

/// The line starting at `start`, or `None` at the end of the text.
fn line_at(text: &str, start: usize) -> Option<Line> {
    if start >= text.len() {
        return None;
    }
    let (end, mut content_end) = match text[start..].find('\n') {
        Some(i) => (start + i + 1, start + i),
        None => (text.len(), text.len()),
    };
    if content_end > start && text.as_bytes()[content_end - 1] == b'\r' && content_end < end {
        content_end -= 1;
    }
    Some(Line { start, end, content_end })
}

/// The line is exactly `delim`, allowing trailing spaces or tabs.
fn is_delim(content: &str, delim: &str) -> bool {
    content.trim_end_matches([' ', '\t']) == delim
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_print_plainly() {
        assert_eq!(format_num(120.0), "120");
        assert_eq!(format_num(12.345), "12.3");
        assert_eq!(format_num(-0.04), "0");
    }

    #[test]
    fn splits_simple_frontmatter() {
        let text = "---\nx: 10\n---\nbody";
        let Frontmatter::Parsed { region, map } = split(text) else { panic!("not parsed") };
        assert_eq!(&text[region.inner.clone()], "x: 10\n");
        assert_eq!(&text[region.body_start..], "body");
        assert_eq!(map.len(), 1);
        assert_eq!(read_layout(&split(text)).x, Some(10.0));
    }
}
