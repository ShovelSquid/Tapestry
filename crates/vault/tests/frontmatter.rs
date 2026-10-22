//! Byte-exact golden tests for the frontmatter splice.
//!
//! Every input is a string literal here, never a fixture file: editors and
//! git can quietly normalise CRLF line endings and a BOM.

mod common;

use std::fs;

use tapestry_vault::frontmatter::{
    APP_KEYS, Frontmatter, Invalid, LayoutPatch, SpliceError, ensure_created, format_num, read_layout,
    splice_layout, split,
};
use tapestry_vault::{Store, VaultCmd, WriteError};
use yaml_serde::{Mapping, Value};

fn patch(pairs: &[(&str, f64)]) -> LayoutPatch {
    let mut p = LayoutPatch::default();
    for &(k, v) in pairs {
        match k {
            "x" => p.x = Some(v),
            "y" => p.y = Some(v),
            "w" => p.w = Some(v),
            "h" => p.h = Some(v),
            "world-x" => p.world_x = Some(v),
            "world-y" => p.world_y = Some(v),
            "world-scale" => p.world_scale = Some(v),
            _ => panic!("not a layout key: {k}"),
        }
    }
    p
}

/// The YAML mapping of a note, found without the crate's own splitter:
/// an optional BOM, a `---` first line, then the next `---` line.
fn yaml_of(text: &str) -> Mapping {
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let mut lines = text.split_inclusive('\n');
    match lines.next() {
        Some(first) if first.trim_end() == "---" => {}
        _ => return Mapping::new(),
    }
    let mut inner = String::new();
    for line in lines {
        if line.trim_end() == "---" {
            return match yaml_serde::from_str::<Value>(&inner).expect("output parses") {
                Value::Mapping(m) => m,
                Value::Null => Mapping::new(),
                other => panic!("output is not a mapping: {other:?}"),
            };
        }
        inner.push_str(line);
    }
    panic!("output frontmatter is unterminated");
}

/// Splices, checks the bytes, and re-parses the output independently: the
/// patched keys hold the patched values and every other key is unchanged.
fn golden(input: &str, pairs: &[(&str, f64)], expected: &str) {
    let out = splice_layout(input, &patch(pairs)).expect("splice ok").expect("a change");
    assert_eq!(out, expected, "\ninput: {input:?}");
    let before = yaml_of(input);
    let after = yaml_of(&out);
    for &(k, v) in pairs {
        let got = after.get(k).and_then(Value::as_f64).unwrap_or_else(|| panic!("{k} missing in {out:?}"));
        assert_eq!(format_num(got), format_num(v), "{k}");
    }
    for (k, v) in &before {
        let patched = k.as_str().is_some_and(|k| pairs.iter().any(|(p, _)| *p == k));
        if !patched {
            assert_eq!(after.get(k), Some(v), "key {k:?} changed");
        }
    }
    let extra = after.len() - before.len();
    let inserted = pairs.iter().filter(|(k, _)| before.get(*k).is_none()).count();
    assert_eq!(extra, inserted, "unexpected keys appeared");
}

fn unparseable(input: &str) -> Invalid {
    match splice_layout(input, &patch(&[("x", 1.0)])) {
        Err(SpliceError::Unparseable(why)) => why,
        other => panic!("{input:?} gave {other:?}"),
    }
}

// --- golden splices -------------------------------------------------------

#[test]
fn crlf_comment_block_list_existing_key() {
    golden(
        "---\r\ntitle: A # keep\r\ntags:\r\n  - a\r\nx: 10\r\n---\r\nBody\r\n",
        &[("x", 12.5), ("y", 40.0)],
        "---\r\ntitle: A # keep\r\ntags:\r\n  - a\r\nx: 12.5\r\ny: 40\r\n---\r\nBody\r\n",
    );
}

#[test]
fn no_frontmatter_gets_a_block() {
    golden(
        "# Heading\nI think about a note\n",
        &[("x", 0.0), ("y", 0.0), ("w", 230.0), ("h", 150.0)],
        "---\nx: 0\ny: 0\nw: 230\nh: 150\n---\n# Heading\nI think about a note\n",
    );
}

#[test]
fn no_frontmatter_crlf_block_uses_crlf() {
    golden("Title\r\nbody\r\n", &[("x", 1.0)], "---\r\nx: 1\r\n---\r\nTitle\r\nbody\r\n");
}

#[test]
fn bom_with_frontmatter() {
    golden("\u{FEFF}---\nx: 1\n---\nb", &[("x", 2.0)], "\u{FEFF}---\nx: 2\n---\nb");
}

#[test]
fn bom_without_frontmatter() {
    golden("\u{FEFF}# T\n", &[("x", 0.0), ("y", 0.0)], "\u{FEFF}---\nx: 0\ny: 0\n---\n# T\n");
}

#[test]
fn empty_frontmatter() {
    golden("---\n---\nbody", &[("x", 5.0)], "---\nx: 5\n---\nbody");
}

#[test]
fn comment_only_frontmatter() {
    golden("---\n# c\n---\n", &[("x", 5.0)], "---\n# c\nx: 5\n---\n");
}

#[test]
fn no_trailing_newline() {
    golden("---\nx: 1\n---\nbody", &[("x", 3.0)], "---\nx: 3\n---\nbody");
}

#[test]
fn horizontal_rule_in_body_is_not_frontmatter() {
    let body = "Intro\n\n---\n\nmore\n";
    assert_eq!(split(body), Frontmatter::Absent);
    let out = splice_layout(body, &patch(&[("x", 1.0)])).unwrap().unwrap();
    assert_eq!(out, format!("---\nx: 1\n---\n{body}"));
}

#[test]
fn trailing_comment_kept() {
    golden("---\nx: 10 # left edge\n---\n", &[("x", 12.0)], "---\nx: 12 # left edge\n---\n");
}

#[test]
fn null_value_is_filled() {
    golden("---\nx:\n---\n", &[("x", 5.0)], "---\nx: 5\n---\n");
    golden("---\nx: # later\n---\n", &[("x", 5.0)], "---\nx: 5 # later\n---\n");
}

#[test]
fn unknown_keys_lists_quotes_and_block_scalars_kept() {
    let input = "---\ntitle: \"Quoted: yes\"\naliases: [one, two]\nx: 1\nnotes: |\n  x: 5\n  more\nz-last: 'single'\n---\nbody\n";
    let expected = "---\ntitle: \"Quoted: yes\"\naliases: [one, two]\nx: 2\nnotes: |\n  x: 5\n  more\nz-last: 'single'\ny: 3\nw: 4\nh: 5\nworld-x: 6\nworld-y: 7\nworld-scale: 0.5\n---\nbody\n";
    golden(
        input,
        &[("x", 2.0), ("y", 3.0), ("w", 4.0), ("h", 5.0), ("world-x", 6.0), ("world-y", 7.0), ("world-scale", 0.5)],
        expected,
    );
}

#[test]
fn world_keys_splice_like_card_keys() {
    golden(
        "---\nworld-x: 10\nworld-y: 20\nworld-scale: 1\n---\n",
        &[("world-x", 15.0), ("world-scale", 0.25)],
        "---\nworld-x: 15\nworld-y: 20\nworld-scale: 0.3\n---\n",
    );
    let fm = split("---\nworld-x: 10\n---\n");
    assert_eq!(read_layout(&fm).world_x, Some(10.0));
}

#[test]
fn numeric_string_is_replaced_in_place() {
    golden("---\nx: \"120\"\n---\n", &[("x", 130.0)], "---\nx: 130\n---\n");
}

#[test]
fn unchanged_values_are_a_no_op() {
    let text = "---\nx: 10.0\ny: 20\n---\n";
    assert_eq!(splice_layout(text, &patch(&[("x", 10.0), ("y", 20.0)])), Ok(None));
    assert_eq!(splice_layout(text, &patch(&[("x", 10.04)])), Ok(None));
    assert_eq!(splice_layout(text, &LayoutPatch::default()), Ok(None));
}

// --- numbers --------------------------------------------------------------

#[test]
fn numbers_round_to_one_decimal() {
    assert_eq!(format_num(12.345), "12.3");
    assert_eq!(format_num(120.0), "120");
    assert_eq!(format_num(-12.5), "-12.5");
    assert_eq!(format_num(-0.04), "0");
    assert_eq!(format_num(0.1 + 0.2), "0.3");
    let big = format_num(1e21);
    assert!(big.bytes().all(|b| b.is_ascii_digit()), "{big}");
}

#[test]
fn non_finite_patch_is_refused() {
    let text = "---\nx: 1\n---\n";
    assert_eq!(splice_layout(text, &patch(&[("x", f64::NAN)])), Err(SpliceError::NonFinite("x")));
    assert_eq!(splice_layout(text, &patch(&[("y", f64::INFINITY)])), Err(SpliceError::NonFinite("y")));
    assert_eq!(splice_layout("body", &patch(&[("h", f64::NEG_INFINITY)])), Err(SpliceError::NonFinite("h")));
}

// --- never rewrite what cannot be parsed ----------------------------------

#[test]
fn invalid_yaml_is_unparseable() {
    for input in [
        "---\nx: [1, 2\n---\nbody",
        "---\nx: 1\nx: 2\n---\n",
        "---\ntags:\n\t- a\n---\n",
        "---\ntitle: a: b\n---\n",
    ] {
        assert!(matches!(unparseable(input), Invalid::Yaml(_)), "{input:?}");
    }
}

#[test]
fn unterminated_is_unparseable() {
    assert_eq!(unparseable("---\nx: 1\nbody"), Invalid::Unterminated);
    assert_eq!(unparseable("---"), Invalid::Unterminated);
}

#[test]
fn dots_terminator_is_unparseable() {
    assert_eq!(unparseable("---\nx: 1\n...\nbody\n"), Invalid::DotsTerminator);
}

#[test]
fn non_mapping_is_unparseable() {
    assert_eq!(unparseable("---\njust text\n---\n"), Invalid::NotMapping);
    assert_eq!(unparseable("---\n- a\n- b\n---\n"), Invalid::NotMapping);
}

#[test]
fn oversized_frontmatter_is_never_parsed() {
    let text = format!("---\n{}---\nbody\n", "# padding line\n".repeat(5000));
    assert!(text.len() > 64 * 1024);
    match split(&text) {
        Frontmatter::Invalid { region: Some(_), reason: Invalid::TooLarge } => {}
        other => panic!("{other:?}"),
    }
    assert_eq!(unparseable(&text), Invalid::TooLarge);
}

#[test]
fn ensure_created_refuses_unparseable() {
    assert!(matches!(ensure_created("---\nx: [\n---\n", "2026-10-21T10:11:12"), Err(SpliceError::Unparseable(_))));
}

// --- keys a line edit cannot safely change ---------------------------------

#[test]
fn flow_mapping_is_not_spliceable() {
    let r = splice_layout("---\n{x: 1, y: 2}\n---\n", &patch(&[("x", 3.0)]));
    assert_eq!(r, Err(SpliceError::KeyNotSpliceable("x")));
}

#[test]
fn quoted_key_is_not_spliceable() {
    let r = splice_layout("---\n\"x\": 1\n---\n", &patch(&[("x", 3.0)]));
    assert_eq!(r, Err(SpliceError::KeyNotSpliceable("x")));
}

#[test]
fn value_on_next_line_is_not_spliceable() {
    let r = splice_layout("---\nx:\n  10\n---\n", &patch(&[("x", 3.0)]));
    assert_eq!(r, Err(SpliceError::KeyNotSpliceable("x")));
}

#[test]
fn non_numeric_value_is_a_conflict() {
    assert_eq!(splice_layout("---\nx: left\n---\n", &patch(&[("x", 3.0)])), Err(SpliceError::Conflict("x")));
    assert_eq!(splice_layout("---\nx: [1]\n---\n", &patch(&[("x", 3.0)])), Err(SpliceError::Conflict("x")));
    assert_eq!(splice_layout("---\nw: true\n---\n", &patch(&[("w", 3.0)])), Err(SpliceError::Conflict("w")));
}

#[test]
fn a_key_inside_a_multiline_string_is_never_edited() {
    // The `x: 5` line is part of the quoted title, so a line edit would
    // change the title; the splice must refuse rather than guess.
    let text = "---\ntitle: \"one\n\nx: 5\"\nx: 1\n---\n";
    let r = splice_layout(text, &patch(&[("x", 2.0)]));
    assert!(
        matches!(
            r,
            Err(SpliceError::KeyNotSpliceable("x") | SpliceError::Verify(_) | SpliceError::Unparseable(_))
        ),
        "{r:?}"
    );
}

// --- reading --------------------------------------------------------------

#[test]
fn read_layout_is_lenient() {
    let l = read_layout(&split("---\nx: \"120\"\ny: .inf\nw: .nan\nh:\n---\n"));
    assert_eq!((l.x, l.y, l.w, l.h), (Some(120.0), None, None, None));
    assert!(l.conflicts.is_empty());
    let l = read_layout(&split("---\nx: left\ny: 4\n---\n"));
    assert_eq!((l.x, l.y), (None, Some(4.0)));
    assert_eq!(l.conflicts, vec!["x"]);
    let l = read_layout(&split("---\ncreated: 2026-10-21T10:11:12\n---\n"));
    assert_eq!(l.created.as_deref(), Some("2026-10-21T10:11:12"));
    assert_eq!(read_layout(&split("---\nx: [\n---\n")), Default::default());
    assert_eq!(APP_KEYS.len(), 8);
}

// --- created --------------------------------------------------------------

#[test]
fn ensure_created_prepends_when_absent() {
    let out = ensure_created("Gamma\n", "2026-10-21T10:11:12").unwrap().unwrap();
    assert_eq!(out, "---\ncreated: 2026-10-21T10:11:12\n---\nGamma\n");
}

#[test]
fn ensure_created_inserts_before_closing_line() {
    let out = ensure_created("---\r\ntitle: T\r\n---\r\nbody\r\n", "2026-10-21T10:11:12").unwrap().unwrap();
    assert_eq!(out, "---\r\ntitle: T\r\ncreated: 2026-10-21T10:11:12\r\n---\r\nbody\r\n");
}

#[test]
fn ensure_created_never_overwrites() {
    assert_eq!(ensure_created("---\ncreated: 2020-01-01\n---\n", "2026-10-21T10:11:12"), Ok(None));
}

// --- the store leaves unparseable notes alone -----------------------------

#[test]
fn store_never_rewrites_unparseable() {
    let root = common::temp_dir("never-rewrite");
    let path = root.join("Broken.md");
    let text = "---\nx: [1, 2\n---\nbody\n";
    fs::write(&path, text).unwrap();
    let mtime = fs::metadata(&path).unwrap().modified().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));

    let mut store = Store::open(&root).unwrap().with_clock(common::fixed_clock());
    let r = store.apply(VaultCmd::SetLayout { rel: "Broken.md".into(), patch: patch(&[("x", 1.0)]) });
    assert!(matches!(r, Err(WriteError::Splice(SpliceError::Unparseable(_)))), "{r:?}");
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), mtime);
    assert!(common::no_temp_files(&root));
}
