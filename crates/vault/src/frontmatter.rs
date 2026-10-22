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
    let (close, dots) = loop {
        let Some(line) = line_at(text, pos) else {
            return Frontmatter::Invalid { region: None, reason: Invalid::Unterminated };
        };
        let content = line.content(text);
        if is_delim(content, "---") {
            break (line, false);
        }
        if is_delim(content, "...") {
            break (line, true);
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
    if dots {
        return Frontmatter::Invalid { region: Some(region), reason: Invalid::DotsTerminator };
    }
    // Checked before the YAML parser ever sees the text.
    if region.inner.len() > MAX_FRONTMATTER_BYTES {
        return Frontmatter::Invalid { region: Some(region), reason: Invalid::TooLarge };
    }
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
        let Some(v) = map.get(key) else { continue };
        match number(v) {
            Num::Finite(n) => *out.slot(key).expect("layout key") = Some(n),
            Num::Null | Num::NonFinite => {}
            Num::NotANumber => out.conflicts.push(key),
        }
    }
    out.created = map.get("created").and_then(|v| match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    });
    out
}

/// How an app key's YAML value reads as a number.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Num {
    Finite(f64),
    /// `x:` or `x: ~`: no value yet.
    Null,
    /// `.inf`, `.nan`, or a string that parses to one: ignored, safe to overwrite.
    NonFinite,
    /// Text, a list, a mapping, a bool: the user's, never overwritten.
    NotANumber,
}

fn number(v: &Value) -> Num {
    let n = match v {
        Value::Null => return Num::Null,
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    };
    match n {
        Some(n) if n.is_finite() => Num::Finite(n),
        Some(_) => Num::NonFinite,
        None => Num::NotANumber,
    }
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
        Frontmatter::Absent => {
            let out = prepend_block(text, &lines);
            let written: Vec<(&str, Want)> = entries.iter().map(|&(k, v)| (k, Want::Num(v))).collect();
            verify(&Mapping::new(), &out, &written)?;
            Ok(Some(out))
        }
        Frontmatter::Invalid { reason, .. } => Err(SpliceError::Unparseable(reason)),
        Frontmatter::Parsed { region, map } => {
            let mut edits: Vec<(Range<usize>, String)> = Vec::new();
            let mut insert = String::new();
            for &(key, v) in &entries {
                let new = format_num(v);
                let Some(old) = map.get(key) else {
                    insert.push_str(&format!("{key}: {new}{}", region.le.as_str()));
                    continue;
                };
                let old = number(old);
                if old == Num::NotANumber {
                    return Err(SpliceError::Conflict(key));
                }
                let Some(slot) = find_value(text, &region, key) else {
                    return Err(SpliceError::KeyNotSpliceable(key));
                };
                if slot.value.is_empty() {
                    // `x:` alone is null; an empty line with a non-null value
                    // means the value continues on the next lines.
                    if old != Num::Null {
                        return Err(SpliceError::KeyNotSpliceable(key));
                    }
                    let gap = if slot.value.end < slot.content_end { " " } else { "" };
                    edits.push((slot.after_colon..slot.value.start, format!(" {new}{gap}")));
                    continue;
                }
                if let Num::Finite(o) = old
                    && format_num(o) == new
                {
                    continue;
                }
                edits.push((slot.value, new));
            }
            if !insert.is_empty() {
                edits.push((region.close.start..region.close.start, insert));
            }
            if edits.is_empty() {
                return Ok(None);
            }
            let out = apply(text, edits);
            let written: Vec<(&str, Want)> = entries.iter().map(|&(k, v)| (k, Want::Num(v))).collect();
            verify(&map, &out, &written)?;
            Ok(Some(out))
        }
    }
}

/// What a written key must read back as.
enum Want<'a> {
    Num(f64),
    Text(&'a str),
}

/// The guard after every edit: the output must parse, each written key must
/// read back as intended, and every other key must equal the input's value.
fn verify(before: &Mapping, out: &str, written: &[(&str, Want)]) -> Result<(), SpliceError> {
    let Frontmatter::Parsed { map: after, .. } = split(out) else {
        return Err(SpliceError::Verify("the edited frontmatter does not parse".into()));
    };
    for (key, want) in written {
        let got = after.get(*key);
        let ok = match (want, got) {
            (Want::Num(v), Some(got)) => matches!(number(got), Num::Finite(n) if format_num(n) == format_num(*v)),
            (Want::Text(t), Some(Value::String(s))) => s == t,
            _ => false,
        };
        if !ok {
            return Err(SpliceError::Verify(format!("`{key}` reads back as {got:?}")));
        }
    }
    let is_written = |k: &Value| k.as_str().is_some_and(|k| written.iter().any(|(w, _)| *w == k));
    for (k, v) in before {
        if !is_written(k) && after.get(k) != Some(v) {
            return Err(SpliceError::Verify(format!("key {k:?} changed")));
        }
    }
    for k in after.keys() {
        if !is_written(k) && before.get(k).is_none() {
            return Err(SpliceError::Verify(format!("key {k:?} appeared")));
        }
    }
    Ok(())
}

/// Adds `created: ISO` unless the note already has a `created` key (never overwritten).
pub fn ensure_created(text: &str, iso: &str) -> Result<Option<String>, SpliceError> {
    let line = format!("created: {iso}");
    let (out, before) = match split(text) {
        Frontmatter::Absent => (prepend_block(text, &[line]), Mapping::new()),
        Frontmatter::Invalid { reason, .. } => return Err(SpliceError::Unparseable(reason)),
        Frontmatter::Parsed { region, map } => {
            if map.get("created").is_some() {
                return Ok(None);
            }
            let at = region.close.start;
            (apply(text, vec![(at..at, format!("{line}{}", region.le.as_str()))]), map)
        }
    };
    verify(&before, &out, &[("created", Want::Text(iso))])?;
    Ok(Some(out))
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

/// Where a key's value sits on its line.
struct Slot {
    /// The first byte after the `:`.
    after_colon: usize,
    /// The value bytes (empty when nothing but a comment or nothing at all follows).
    value: Range<usize>,
    /// The end of the line's content (before its line ending).
    content_end: usize,
}

/// `key`'s top-level line: one that starts at column 0 with the key as a
/// plain unquoted scalar, then optional spaces or tabs and `:`. `None` unless
/// there is exactly one such line.
fn find_value(text: &str, region: &Region, key: &str) -> Option<Slot> {
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
        let content_end = line.start + content.len();
        let colon = content_end - after_colon.len();
        let value_start = colon + (after_colon.len() - after_colon.trim_start_matches([' ', '\t']).len());
        let value = &text[value_start..content_end];
        let value_len = comment_start(value).unwrap_or(value.len());
        let value_len = value[..value_len].trim_end_matches([' ', '\t']).len();
        found = Some(Slot { after_colon: colon, value: value_start..value_start + value_len, content_end });
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
