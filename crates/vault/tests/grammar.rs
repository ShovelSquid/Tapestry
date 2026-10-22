mod common;

mod checker {
    use regex::Regex;
    use yaml_serde::{Mapping, Value};

    pub fn check_note(text: &str) -> Vec<String> {
        let mut errors = Vec::new();
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        let lines: Vec<&str> = text.lines().collect();
        let mut body = 0;
        if lines.first() == Some(&"---") {
            if let Some(end) = lines
                .iter()
                .enumerate()
                .skip(1)
                .find_map(|(i, l)| (*l == "---").then_some(i))
            {
                let yaml = lines[1..end].join("\n");
                match yaml_serde::from_str::<Value>(&yaml) {
                    Ok(Value::Mapping(map)) => check_props(&map, &mut errors),
                    Ok(Value::Null) => {}
                    Ok(_) => errors.push("frontmatter must be a mapping or null".into()),
                    Err(e) => errors.push(format!("invalid YAML: {e}")),
                }
                body = end + 1;
            } else {
                errors.push("unterminated frontmatter".into());
            }
        }
        let link = Regex::new(r"^!?\[\[[^\[\]|#^]*(#\^?[^\[\]|]+)?(\\?\|[^\[\]|]+)?\]\]$").unwrap();
        let ref_id = Regex::new(r"^[A-Za-z0-9-]+$").unwrap();
        let mut fenced = false;
        let mut fence_char = '`';
        let mut fence_len = 0;
        for (offset, line) in lines.iter().enumerate().skip(body) {
            let trimmed = line.trim_start();
            if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
                let ch = trimmed.chars().next().unwrap();
                if !fenced {
                    fenced = true;
                    fence_char = ch;
                    fence_len = trimmed.chars().take_while(|c| *c == ch).count();
                } else if ch == fence_char
                    && trimmed.chars().take_while(|c| *c == ch).count() >= fence_len
                {
                    fenced = false;
                }
                continue;
            }
            if fenced {
                continue;
            }
            if let Some(pos) = line.rfind(" ^") {
                let id = &line[pos + 2..];
                if !ref_id.is_match(id)
                    || line.starts_with('|')
                    || line.starts_with('>')
                    || line.trim_start().starts_with('#')
                {
                    errors.push(format!(
                        "invalid trailing block reference at line {}",
                        offset + 1
                    ));
                }
            }
            if line.starts_with('^') {
                let id = &line[1..];
                if !ref_id.is_match(id)
                    || offset == 0
                    || !lines[offset - 1].is_empty()
                    || (offset + 1 < lines.len() && !lines[offset + 1].is_empty())
                {
                    errors.push(format!(
                        "invalid standalone block reference at line {}",
                        offset + 1
                    ));
                }
            }
            for m in Regex::new(r"!?\[\[.*?\]\]").unwrap().find_iter(line) {
                if !link.is_match(m.as_str()) {
                    errors.push(format!("invalid wikilink at line {}", offset + 1));
                }
            }
        }
        errors
    }

    fn check_props(map: &Mapping, errors: &mut Vec<String>) {
        for key in ["x", "y", "w", "h", "world-x", "world-y", "world-scale"] {
            if let Some(value) = map.get(&Value::String(key.into())) {
                if !matches!(value, Value::Number(_)) {
                    errors.push(format!("{key} must be numeric"));
                }
            }
        }
        if let Some(value) = map.get(&Value::String("created".into())) {
            let re = Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$").unwrap();
            if !value.as_str().is_some_and(|s| re.is_match(s)) {
                errors.push("created must be UTC date-time".into());
            }
        }
    }
}

#[test]
fn checker_rejects_bad_samples() {
    use checker::check_note;
    for bad in [
        "---\nx: left\n---\n",
        "---\nx: 1\nx: 2\n---\n",
        "---\ncreated: 2026-10-21 10:11\n---\n",
        "| a | ^abc\n",
        "> quote ^abc\n",
        "text ^bad_id\n",
        "one\n^abc\nthree\n",
        "[[a|b|c]]",
    ] {
        assert!(!check_note(bad).is_empty(), "accepted {bad:?}");
    }
    let fixture =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/obsidian-sample");
    for name in ["Blocks.md", "Welcome.md"] {
        assert!(
            check_note(&std::fs::read_to_string(fixture.join(name)).unwrap()).is_empty(),
            "{name}"
        );
    }
}

#[test]
fn store_output_passes_grammar() {
    use checker::check_note;
    use std::fs;
    use std::path::Path;
    use tapestry_vault::frontmatter::LayoutPatch;
    use tapestry_vault::index::VaultIndex;
    use tapestry_vault::scan::scan;
    use tapestry_vault::{Store, VaultCmd};
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join("obsidian-check");
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/obsidian-sample");
    copy_tree(&fixture, &root);
    fs::write(
        root.join("crlf.md"),
        "---\r\ntitle: C\r\n---\r\nPara one\r\n\r\n> q\r\n",
    )
    .unwrap();
    fs::write(root.join("bom.md"), "\u{feff}# Bom\nText\n").unwrap();
    let mut store = Store::open(&root)
        .unwrap()
        .with_clock(common::fixed_clock())
        .with_ids(common::ScriptedIds::new(&[
            "aa1", "aa2", "aa3", "aa4", "aa5", "aa6", "aa7", "aa8",
        ]));
    let mut written = std::collections::BTreeSet::new();
    let mut apply = |cmd: VaultCmd| {
        let out = store
            .apply(cmd.clone())
            .unwrap_or_else(|e| panic!("{cmd:?}: {e}"));
        written.extend(out.written);
    };
    for rel in [
        "Welcome.md",
        "Blocks.md",
        "Topic/Notes.md",
        "crlf.md",
        "bom.md",
    ] {
        apply(VaultCmd::SetLayout {
            rel: rel.into(),
            patch: LayoutPatch {
                x: Some(13.0),
                y: Some(8.0),
                w: Some(320.0),
                h: Some(210.0),
                ..Default::default()
            },
        });
    }
    apply(VaultCmd::CreateNote {
        rel: "Topic/Fresh.md".into(),
        body: "Fresh note.\n".into(),
    });
    apply(VaultCmd::CreateNote {
        rel: "Other/Grammar.md".into(),
        body: "Grammar check.\n".into(),
    });
    for folder in ["Topic", "Sub"] {
        apply(VaultCmd::SetFolderWorld {
            folder: folder.into(),
            x: 1.0,
            y: 2.0,
            scale: 1.0,
        });
    }
    apply(VaultCmd::SetLayout {
        rel: "Sub/Deep/Leaf.md".into(),
        patch: LayoutPatch {
            x: Some(4.0),
            ..Default::default()
        },
    });
    for (source, prefix, target, target_prefix, desc) in [
        (
            "Welcome.md",
            "Start at",
            "Blocks.md",
            Some("First paragraph"),
            "start",
        ),
        (
            "Topic/Notes.md",
            "A paragraph",
            "Blocks.md",
            Some("> quoted"),
            "quote",
        ),
        (
            "crlf.md",
            "Para one",
            "Blocks.md",
            Some("| 1  | 2  |"),
            "table",
        ),
        ("Blocks.md", "| 1  | 2  |", "Welcome.md", None, "card"),
        (
            "Sub/Deep/Leaf.md",
            "Leaf note.",
            "Topic/Notes.md",
            Some("A paragraph"),
            "ambiguous",
        ),
        ("Blocks.md", "> body", "Sub/Deep/Leaf.md", None, "callout"),
        ("Blocks.md", "- item beta", "Other/Notes.md", None, "list"),
    ] {
        let text = fs::read_to_string(root.join(source)).unwrap();
        let line = text.lines().position(|l| l.starts_with(prefix)).unwrap();
        let target_line = target_prefix.map(|p| {
            fs::read_to_string(root.join(target))
                .unwrap()
                .lines()
                .position(|l| l.starts_with(p))
                .unwrap()
        });
        let scan = scan(&root).unwrap();
        let idx = VaultIndex::build(&scan);
        apply(VaultCmd::AddLink {
            source_rel: source.into(),
            line,
            target_rel: target.into(),
            target_line,
            description: desc.into(),
            link_path: idx.link_path(target),
            base_hash: None,
        });
    }
    let text = fs::read_to_string(root.join("Welcome.md")).unwrap();
    if let Some(span) = text.find("[[Blocks") {
        apply(VaultCmd::RemoveLink {
            rel: "Welcome.md".into(),
            span: span..text[span..].find("]]").unwrap() + span + 2,
            base_hash: tapestry_vault::layout::fnv1a64(text.as_bytes()),
        });
    }
    assert!(written.len() >= 10, "written: {written:?}");
    for rel in written {
        let text = fs::read_to_string(root.join(&rel)).unwrap();
        assert!(
            check_note(&text).is_empty(),
            "{rel}: {:?}",
            check_note(&text)
        );
    }
    let crlf = fs::read(root.join("crlf.md")).unwrap();
    assert!(
        !crlf
            .windows(1)
            .enumerate()
            .any(|(i, b)| b == b"\n" && (i == 0 || crlf[i - 1] != b'\r'))
    );
    println!(
        "obsidian-check vault: {}",
        root.canonicalize().unwrap().display()
    );
}

fn copy_tree(from: &std::path::Path, to: &std::path::Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let dst = to.join(e.file_name());
        if e.file_type().unwrap().is_dir() {
            copy_tree(&e.path(), &dst);
        } else {
            std::fs::copy(e.path(), dst).unwrap();
        }
    }
}
