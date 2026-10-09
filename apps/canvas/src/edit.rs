//! What egui's text field leaves out of everyday editing. Enter keeps the
//! line's indentation (one step more after an opening bracket). Tab indents
//! with the file's own indentation, and with a selection Tab and Shift+Tab
//! indent or outdent every line in it. Cmd+/ comments lines out and back in.
//!
//! Word and line movement and deletion (Option/Cmd with arrows, Backspace,
//! Delete) are egui's own.

use eframe::egui;
use egui::text::{CCursor, CCursorRange};

/// Handle this frame's editing keys for the text field `id`, before it's
/// drawn. `comment` is the line-comment marker, if the language has one.
pub fn keys(ui: &egui::Ui, id: egui::Id, text: &mut String, comment: Option<&str>) {
    if !ui.memory(|m| m.has_focus(id)) {
        return;
    }
    let Some(mut state) = egui::TextEdit::load_state(ui.ctx(), id) else {
        return;
    };
    let Some(range) = state.cursor.char_range() else {
        return;
    };
    let [a, b] = range.sorted_cursors();
    let (mut a, mut b) = (byte(text, a.index.0), byte(text, b.index.0));
    let unit = indent_unit(text);
    let mut handled = false;
    ui.input_mut(|i| {
        i.events.retain(|e| {
            let egui::Event::Key {
                key,
                pressed: true,
                modifiers: m,
                ..
            } = e
            else {
                return true;
            };
            let sel = match key {
                egui::Key::Enter if !m.command && !m.alt && !m.ctrl => {
                    let at = newline(text, a, b, unit);
                    (at, at)
                }
                egui::Key::Tab if !m.command && !m.alt && !m.ctrl => {
                    if m.shift {
                        lines(text, a, b, |l| outdent(l, unit))
                    } else if text[a..b].contains('\n') {
                        lines(text, a, b, |l| format!("{unit}{l}"))
                    } else {
                        text.replace_range(a..b, unit);
                        (a + unit.len(), a + unit.len())
                    }
                }
                egui::Key::Slash if m.command && comment.is_some() => {
                    toggle_comment(text, a, b, comment.unwrap_or("//"))
                }
                _ => return true,
            };
            (a, b) = sel;
            handled = true;
            false
        });
    });
    if handled {
        let at = |b: usize| CCursor::new(text[..b].chars().count());
        state
            .cursor
            .set_char_range(Some(CCursorRange::two(at(a), at(b))));
        state.store(ui.ctx(), id);
    }
}

/// The comment marker for a file, by its extension.
pub fn comment_for(path: &std::path::Path) -> Option<&'static str> {
    match path.extension()?.to_str()? {
        "rs" | "c" | "h" | "cpp" | "hpp" | "js" | "ts" | "wgsl" | "tree" | "json" => Some("//"),
        "toml" | "py" | "sh" | "yaml" | "yml" => Some("#"),
        _ => None,
    }
}

/// Byte offset of char index `c`.
fn byte(text: &str, c: usize) -> usize {
    text.char_indices().nth(c).map_or(text.len(), |(b, _)| b)
}

fn line_start(text: &str, at: usize) -> usize {
    text[..at].rfind('\n').map_or(0, |i| i + 1)
}

fn line_end(text: &str, at: usize) -> usize {
    text[at..].find('\n').map_or(text.len(), |i| at + i)
}

/// Tabs if the file indents with them, else four spaces.
fn indent_unit(text: &str) -> &'static str {
    let tabs = text.lines().filter(|l| l.starts_with('\t')).count();
    let spaces = text.lines().filter(|l| l.starts_with("  ")).count();
    if tabs > spaces { "\t" } else { "    " }
}

/// Replace the selection with a new line indented like this one.
fn newline(text: &mut String, a: usize, b: usize, unit: &str) -> usize {
    let start = line_start(text, a);
    let indent: String = text[start..a]
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect();
    let opens = text[start..a]
        .trim_end()
        .ends_with(['{', '(', '[']);
    let mut insert = format!("\n{indent}");
    if opens {
        insert.push_str(unit);
    }
    text.replace_range(a..b, &insert);
    a + insert.len()
}

/// Rewrite each line the selection touches, selecting the lines after.
fn lines(text: &mut String, a: usize, b: usize, f: impl Fn(&str) -> String) -> (usize, usize) {
    let start = line_start(text, a);
    // A selection ending at the start of a line doesn't take that line in.
    let b = if b > a && b == line_start(text, b) { b - 1 } else { b };
    let end = line_end(text, b.max(start));
    let block: Vec<String> = text[start..end].split('\n').map(&f).collect();
    let block = block.join("\n");
    text.replace_range(start..end, &block);
    (start, start + block.len())
}

fn outdent(line: &str, unit: &str) -> String {
    if let Some(rest) = line.strip_prefix('\t') {
        return rest.to_owned();
    }
    let spaces = line.len() - line.trim_start_matches(' ').len();
    line[spaces.min(unit.len().max(1))..].to_owned()
}

/// Comment the touched lines out, or back in if they all already are.
fn toggle_comment(text: &mut String, a: usize, b: usize, mark: &str) -> (usize, usize) {
    let start = line_start(text, a);
    let end = line_end(text, b.max(start));
    let all = text[start..end]
        .split('\n')
        .filter(|l| !l.trim().is_empty())
        .all(|l| l.trim_start().starts_with(mark));
    // Markers line up at the shallowest indent, as editors put them.
    let depth = text[start..end]
        .split('\n')
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    lines(text, a, b, |l| {
        if l.trim().is_empty() {
            l.to_owned()
        } else if all {
            let i = l.len() - l.trim_start().len();
            let rest = &l[i + mark.len()..];
            format!("{}{}", &l[..i], rest.strip_prefix(' ').unwrap_or(rest))
        } else {
            format!("{}{mark} {}", &l[..depth], &l[depth..])
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enter_keeps_indent_and_steps_in_after_a_brace() {
        let mut t = "fn x() {\n    let a = 1;".to_owned();
        let n = t.len();
        let at = newline(&mut t, n, n, "    ");
        assert_eq!(t, "fn x() {\n    let a = 1;\n    ");
        assert_eq!(at, t.len());
        let mut t = "    if y {".to_owned();
        let n = t.len();
        newline(&mut t, n, n, "    ");
        assert_eq!(t, "    if y {\n        ");
    }

    #[test]
    fn tab_and_shift_tab_over_lines() {
        let mut t = "a\nb\nc".to_owned();
        let (s, e) = lines(&mut t, 0, 3, |l| format!("    {l}"));
        assert_eq!(t, "    a\n    b\nc");
        assert_eq!((s, e), (0, 11));
        lines(&mut t, 0, 11, |l| outdent(l, "    "));
        assert_eq!(t, "a\nb\nc");
    }

    #[test]
    fn selection_ending_at_line_start_leaves_that_line() {
        let mut t = "a\nb\n".to_owned();
        lines(&mut t, 0, 2, |l| format!("-{l}"));
        assert_eq!(t, "-a\nb\n");
    }

    #[test]
    fn comment_toggles() {
        let mut t = "    a\n      b".to_owned();
        let n = t.len();
        let (s, e) = toggle_comment(&mut t, 0, n, "//");
        assert_eq!(t, "    // a\n    //   b");
        toggle_comment(&mut t, s, e, "//");
        assert_eq!(t, "    a\n      b");
    }
}
