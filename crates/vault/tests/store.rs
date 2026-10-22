mod common;

use std::fs;
use tapestry_vault::frontmatter::LayoutPatch;
use tapestry_vault::journal::{self, Entry, Event};
use tapestry_vault::links;
use tapestry_vault::scan::scan;
use tapestry_vault::{Change, Store, VaultCmd, VaultIndex, WriteError};

fn store_at(root: &std::path::Path) -> Store {
    Store::open(root).unwrap().with_clock(common::fixed_clock())
}

#[cfg(unix)]
#[test]
fn keeps_permissions() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let root = common::temp_vault("store-perms");
    fs::set_permissions(root.join("Welcome.md"), fs::Permissions::from_mode(0o600)).unwrap();
    let mut store = store_at(&root);
    store
        .apply(VaultCmd::SetLayout {
            rel: "Welcome.md".into(),
            patch: LayoutPatch {
                x: Some(5.0),
                ..Default::default()
            },
        })
        .unwrap();
    assert_eq!(
        fs::metadata(root.join("Welcome.md")).unwrap().mode() & 0o777,
        0o600
    );
}

#[cfg(unix)]
#[test]
fn refuses_symlink_note() {
    use std::os::unix::fs::symlink;
    let root = common::temp_vault("store-links");
    let original = fs::read(root.join("Welcome.md")).unwrap();
    symlink("Welcome.md", root.join("link.md")).unwrap();
    let mut store = store_at(&root);
    assert!(matches!(
        store.apply(VaultCmd::SetLayout {
            rel: "link.md".into(),
            patch: LayoutPatch {
                x: Some(3.0),
                ..Default::default()
            }
        }),
        Err(WriteError::Symlink(_))
    ));
    assert_eq!(fs::read(root.join("Welcome.md")).unwrap(), original);
}

#[cfg(unix)]
#[test]
fn refuses_symlinked_parent() {
    use std::os::unix::fs::symlink;
    let root = common::temp_vault("store-link-parent");
    symlink("Sub", root.join("linkdir")).unwrap();
    let leaf = fs::read(root.join("Sub/Deep/Leaf.md")).unwrap();
    let mut store = store_at(&root);
    assert!(matches!(
        store.apply(VaultCmd::SetLayout {
            rel: "linkdir/Deep/Leaf.md".into(),
            patch: LayoutPatch {
                x: Some(3.0),
                ..Default::default()
            }
        }),
        Err(WriteError::Symlink(_))
    ));
    assert_eq!(fs::read(root.join("Sub/Deep/Leaf.md")).unwrap(), leaf);
}

#[test]
fn rejects_bad_paths() {
    let root = common::temp_vault("store-bad-paths");
    let mut store = store_at(&root);
    for rel in [
        "../x.md",
        "/abs.md",
        ".obsidian/a.md",
        "a/./b.md",
        "a//b.md",
        "a\\b.md",
        "note.txt",
        "",
    ] {
        assert!(
            matches!(
                store.apply(VaultCmd::SetLayout {
                    rel: rel.into(),
                    patch: LayoutPatch {
                        x: Some(5.0),
                        ..Default::default()
                    }
                }),
                Err(WriteError::BadPath(_))
            ),
            "{rel:?}"
        );
        assert!(
            matches!(
                store.apply(VaultCmd::CreateNote {
                    rel: rel.into(),
                    body: "x".into()
                }),
                Err(WriteError::BadPath(_))
            ),
            "{rel:?}"
        );
    }
    assert!(!root.parent().unwrap().join("x.md").exists());
}

#[test]
fn no_temp_files_and_stale_cleanup() {
    let root = common::temp_vault("store-cleanup");
    fs::write(root.join(".Welcome.md.tapestry-1-1.tmp"), "stale").unwrap();
    fs::write(root.join(".notes.tmp"), "user file").unwrap();
    let mut store = store_at(&root);
    assert!(!root.join(".Welcome.md.tapestry-1-1.tmp").exists());
    assert!(root.join(".notes.tmp").exists());
    for x in 0..20 {
        store
            .apply(VaultCmd::SetLayout {
                rel: "Welcome.md".into(),
                patch: LayoutPatch {
                    x: Some(x as f64 + 1.0),
                    ..Default::default()
                },
            })
            .unwrap();
    }
    assert!(common::no_temp_files(&root));
}

#[test]
fn unchanged_layout_is_not_written_and_bad_frontmatter_is_untouched() {
    let root = common::temp_vault("store-noop");
    let before = fs::metadata(root.join("Welcome.md"))
        .unwrap()
        .modified()
        .unwrap();
    let mut store = store_at(&root);
    let outcome = store
        .apply(VaultCmd::SetLayout {
            rel: "Welcome.md".into(),
            patch: LayoutPatch {
                x: Some(0.0),
                y: Some(0.0),
                w: Some(230.0),
                h: Some(150.0),
                ..Default::default()
            },
        })
        .unwrap();
    assert!(outcome.written.is_empty());
    assert_eq!(
        before,
        fs::metadata(root.join("Welcome.md"))
            .unwrap()
            .modified()
            .unwrap()
    );
    assert!(journal::read(&root).unwrap().is_empty());
    let bytes = fs::read(root.join("Broken.md")).unwrap();
    let modified = fs::metadata(root.join("Broken.md"))
        .unwrap()
        .modified()
        .unwrap();
    assert!(matches!(
        store.apply(VaultCmd::SetLayout {
            rel: "Broken.md".into(),
            patch: LayoutPatch {
                x: Some(1.0),
                ..Default::default()
            }
        }),
        Err(WriteError::Splice(_))
    ));
    assert_eq!(bytes, fs::read(root.join("Broken.md")).unwrap());
    assert_eq!(
        modified,
        fs::metadata(root.join("Broken.md"))
            .unwrap()
            .modified()
            .unwrap()
    );
    assert!(journal::read(&root).unwrap().is_empty());
}

#[test]
fn classify_by_hash() {
    let root = common::temp_vault("store-classify");
    let scanned = scan(&root).unwrap();
    let mut store = store_at(&root);
    store.seed_known(&scanned);
    assert_eq!(store.classify("Welcome.md"), Change::Unchanged);
    store
        .apply(VaultCmd::SetLayout {
            rel: "Welcome.md".into(),
            patch: LayoutPatch {
                x: Some(10.0),
                ..Default::default()
            },
        })
        .unwrap();
    assert_eq!(store.classify("Welcome.md"), Change::OwnEcho);
    fs::write(root.join("Welcome.md"), "external\n").unwrap();
    assert_eq!(store.classify("Welcome.md"), Change::External);
    assert_eq!(store.classify("Welcome.md"), Change::Unchanged);
    fs::remove_file(root.join("Welcome.md")).unwrap();
    assert_eq!(store.classify("Welcome.md"), Change::Removed);

    let mut store = store_at(&root);
    fs::write(root.join("Welcome.md"), "reset\n").unwrap();
    store
        .apply(VaultCmd::SetLayout {
            rel: "Welcome.md".into(),
            patch: LayoutPatch {
                x: Some(11.0),
                ..Default::default()
            },
        })
        .unwrap();
    store
        .apply(VaultCmd::SetLayout {
            rel: "Welcome.md".into(),
            patch: LayoutPatch {
                x: Some(12.0),
                ..Default::default()
            },
        })
        .unwrap();
    assert_eq!(store.classify("Welcome.md"), Change::OwnEcho);
}

#[test]
fn journal_tolerates_torn_tail() {
    let root = common::temp_vault("store-torn");
    for path in ["A.md", "B.md"] {
        journal::append(
            &root,
            &Entry {
                t: common::FIXED_MS,
                event: Event::NoteCreated { path: path.into() },
            },
        )
        .unwrap();
    }
    use std::io::Write;
    fs::OpenOptions::new()
        .append(true)
        .open(journal::path(&root))
        .unwrap()
        .write_all(b"{\"t\":1,\"kind\":\"note_cr")
        .unwrap();
    assert_eq!(journal::read(&root).unwrap().len(), 2);
    assert!(Store::open(&root).is_ok());
}

#[test]
fn estimates_before_first_rewrite_once() {
    let root = common::temp_vault("store-estimated");
    let meta = fs::symlink_metadata(root.join("Topic/Notes.md")).unwrap();
    let (expected, from) = if let Ok(created) = meta.created() {
        (
            created
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
            "birth",
        )
    } else {
        (
            meta.modified()
                .unwrap()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
            "mtime",
        )
    };
    let mut store = store_at(&root);
    let patch = |x| LayoutPatch {
        x: Some(x),
        ..Default::default()
    };
    store
        .apply(VaultCmd::SetLayout {
            rel: "Topic/Notes.md".into(),
            patch: patch(1.0),
        })
        .unwrap();
    store
        .apply(VaultCmd::SetLayout {
            rel: "Topic/Notes.md".into(),
            patch: patch(2.0),
        })
        .unwrap();
    assert_eq!(
        journal::read(&root)
            .unwrap()
            .iter()
            .filter(|e| matches!(e.event, Event::NoteEstimated { .. }))
            .count(),
        1
    );
    assert!(journal::read(&root).unwrap().iter().any(|e| e.event
        == Event::NoteEstimated {
            path: "Topic/Notes.md".into(),
            created: expected,
            from: from.into()
        }));
    drop(store);
    let mut reopened = store_at(&root);
    reopened
        .apply(VaultCmd::SetLayout {
            rel: "Topic/Notes.md".into(),
            patch: patch(3.0),
        })
        .unwrap();
    assert_eq!(
        journal::read(&root)
            .unwrap()
            .iter()
            .filter(|e| matches!(e.event, Event::NoteEstimated { .. }))
            .count(),
        1
    );
    reopened
        .apply(VaultCmd::CreateNote {
            rel: "Stamped.md".into(),
            body: "hello".into(),
        })
        .unwrap();
    reopened
        .apply(VaultCmd::SetLayout {
            rel: "Stamped.md".into(),
            patch: patch(4.0),
        })
        .unwrap();
    assert!(
        !journal::read(&root)
            .unwrap()
            .iter()
            .any(|e| matches!(&e.event, Event::NoteEstimated { path, .. } if path == "Stamped.md"))
    );
}

#[test]
fn store_index_is_usable() {
    let root = common::temp_vault("store-index");
    let index = VaultIndex::build(&scan(&root).unwrap());
    assert_eq!(index.link_path("Blocks.md"), "Blocks");
}

fn with_scripted(root: &std::path::Path, ids: &[&str]) -> Store {
    store_at(root).with_ids(common::ScriptedIds::new(ids))
}

fn line_of(text: &str, starts_with: &str) -> usize {
    text.lines()
        .position(|line| line.starts_with(starts_with))
        .unwrap()
}

#[test]
fn create_note() {
    let root = common::temp_vault("store-create");
    let mut store = store_at(&root);
    store
        .apply(VaultCmd::CreateNote {
            rel: "Topic/New.md".into(),
            body: "Hello\n".into(),
        })
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Topic/New.md")).unwrap(),
        "---\ncreated: 2026-10-21T10:11:12\n---\nHello\n"
    );
    assert_eq!(
        journal::read(&root).unwrap()[0],
        Entry {
            t: common::FIXED_MS,
            event: Event::NoteCreated {
                path: "Topic/New.md".into()
            }
        }
    );
    assert!(matches!(
        store.apply(VaultCmd::CreateNote {
            rel: "Topic/New.md".into(),
            body: "again".into()
        }),
        Err(WriteError::Exists(_))
    ));
    store
        .apply(VaultCmd::CreateNote {
            rel: "NewFolder/Sub/N.md".into(),
            body: "---\ntags: [a]\n---\nx".into(),
        })
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("NewFolder/Sub/N.md")).unwrap(),
        "---\ntags: [a]\ncreated: 2026-10-21T10:11:12\n---\nx"
    );
    let before = common::snapshot(&root);
    assert!(
        store
            .apply(VaultCmd::CreateNote {
                rel: "Invalid/Sub/N.md".into(),
                body: "---\nx: [1, 2\n---\nbody".into()
            })
            .is_err()
    );
    assert_eq!(common::snapshot(&root), before);
}

#[test]
fn set_folder_world() {
    let root = common::temp_vault("store-world");
    let before = fs::read_to_string(root.join("Topic/Topic.md")).unwrap();
    let mut store = store_at(&root);
    store
        .apply(VaultCmd::SetFolderWorld {
            folder: "Topic".into(),
            x: 10.0,
            y: 20.0,
            scale: 0.5,
        })
        .unwrap();
    let after = fs::read_to_string(root.join("Topic/Topic.md")).unwrap();
    let expected = before
        .replace("world-x: 1200", "world-x: 10")
        .replace("world-y: -400", "world-y: 20");
    assert_eq!(after, expected);
    assert!(matches!(
        journal::read(&root).unwrap().first().unwrap().event,
        Event::NoteEstimated { .. }
    ));
    store
        .apply(VaultCmd::SetFolderWorld {
            folder: "Other".into(),
            x: 10.0,
            y: 20.0,
            scale: 0.5,
        })
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Other/Other.md")).unwrap(),
        "---\ncreated: 2026-10-21T10:11:12\nworld-x: 10\nworld-y: 20\nworld-scale: 0.5\n---\n"
    );
    assert!(matches!(
        store.apply(VaultCmd::SetFolderWorld {
            folder: "".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0
        }),
        Err(WriteError::BadPath(_))
    ));
    assert!(matches!(
        store.apply(VaultCmd::SetFolderWorld {
            folder: "Missing".into(),
            x: 0.0,
            y: 0.0,
            scale: 1.0
        }),
        Err(WriteError::NotFound(_))
    ));
}

#[test]
fn insert_anchor_command_reuses_and_creates_and_checks_hash() {
    let root = common::temp_vault("store-anchor");
    let original = fs::read_to_string(root.join("Blocks.md")).unwrap();
    let line = line_of(&original, "line two");
    let mut store = with_scripted(&root, &["id0001"]);
    let reused = store
        .apply(VaultCmd::InsertAnchor {
            rel: "Blocks.md".into(),
            line,
            base_hash: Some(tapestry_vault::layout::fnv1a64(original.as_bytes())),
        })
        .unwrap();
    assert_eq!(reused.id.as_deref(), Some("blk-1"));
    assert!(reused.written.is_empty());
    let item = line_of(&original, "- item alpha");
    let added = store
        .apply(VaultCmd::InsertAnchor {
            rel: "Blocks.md".into(),
            line: item,
            base_hash: None,
        })
        .unwrap();
    assert_eq!(added.id.as_deref(), Some("id0001"));
    assert!(
        fs::read_to_string(root.join("Blocks.md"))
            .unwrap()
            .contains("- item alpha ^id0001")
    );
    let before = fs::read(root.join("Blocks.md")).unwrap();
    assert!(matches!(
        store.apply(VaultCmd::InsertAnchor {
            rel: "Blocks.md".into(),
            line: item,
            base_hash: Some(0)
        }),
        Err(WriteError::Conflict { .. })
    ));
    assert_eq!(fs::read(root.join("Blocks.md")).unwrap(), before);
}

#[test]
fn add_link_end_to_end_and_reuses_existing_anchor() {
    let root = common::temp_vault("store-add-link");
    let source = fs::read_to_string(root.join("Welcome.md")).unwrap();
    let source_line = line_of(&source, "Start at");
    let target = fs::read_to_string(root.join("Blocks.md")).unwrap();
    let target_line = line_of(&target, "- item alpha");
    let index = VaultIndex::build(&scan(&root).unwrap());
    let link_path = index.link_path("Blocks.md");
    let mut store = with_scripted(&root, &["id0001"]);
    let out = store
        .apply(VaultCmd::AddLink {
            source_rel: "Welcome.md".into(),
            line: source_line,
            target_rel: "Blocks.md".into(),
            target_line: Some(target_line),
            description: "  why\n it matters ".into(),
            link_path,
            base_hash: Some(tapestry_vault::layout::fnv1a64(source.as_bytes())),
        })
        .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Blocks.md"))
            .unwrap()
            .lines()
            .find(|line| line.starts_with("- item alpha"))
            .unwrap(),
        "- item alpha ^id0001"
    );
    let actual = fs::read_to_string(root.join("Welcome.md"))
        .unwrap()
        .lines()
        .nth(source_line)
        .unwrap()
        .to_owned();
    assert!(
        actual.ends_with("[[Blocks#^id0001|why it matters]]"),
        "{actual:?}"
    );
    assert_eq!(out.id.as_deref(), Some("id0001"));
    assert_eq!(
        out.link.as_deref(),
        Some("[[Blocks#^id0001|why it matters]]")
    );
    assert!(journal::read(&root).unwrap().iter().any(|entry| entry.event
        == Event::LinkAdded {
            path: "Welcome.md".into(),
            line: source_line,
            block: None,
            target: "Blocks.md".into(),
            target_block: Some("id0001".into()),
            description: "why it matters".into()
        }));
    let rescanned = VaultIndex::build(&scan(&root).unwrap());
    assert!(
        rescanned
            .backlinks("Blocks.md")
            .iter()
            .any(|link| link.source == "Welcome.md"
                && link.target_block.as_deref() == Some("id0001")
                && link.description.as_deref() == Some("why it matters"))
    );

    let original_blocks = fs::read(root.join("Blocks.md")).unwrap();
    let target_line = line_of(&String::from_utf8_lossy(&original_blocks), "line two");
    let src_now = fs::read_to_string(root.join("Welcome.md")).unwrap();
    let mut reuse_store = with_scripted(&root, &[]);
    let reused = reuse_store
        .apply(VaultCmd::AddLink {
            source_rel: "Welcome.md".into(),
            line: source_line,
            target_rel: "Blocks.md".into(),
            target_line: Some(target_line),
            description: "existing".into(),
            link_path: "Blocks".into(),
            base_hash: None,
        })
        .unwrap();
    assert_eq!(reused.id.as_deref(), Some("blk-1"));
    assert_eq!(fs::read(root.join("Blocks.md")).unwrap(), original_blocks);
    assert!(
        src_now
            .lines()
            .nth(source_line)
            .unwrap()
            .contains("why it matters")
    );
}

#[test]
fn add_link_before_trailing_id_and_inside_table() {
    let root = common::temp_vault("store-add-position");
    let links_text = fs::read_to_string(root.join("Links.md")).unwrap();
    let line = line_of(&links_text, "First link");
    let mut store = store_at(&root);
    store
        .apply(VaultCmd::AddLink {
            source_rel: "Links.md".into(),
            line,
            target_rel: "Welcome.md".into(),
            target_line: None,
            description: "d".into(),
            link_path: "Welcome".into(),
            base_hash: None,
        })
        .unwrap();
    assert!(
        fs::read_to_string(root.join("Links.md"))
            .unwrap()
            .lines()
            .nth(line)
            .unwrap()
            .ends_with("[[Welcome|d]] ^src-1")
    );

    let root = common::temp_vault("store-add-table");
    let blocks_text = fs::read_to_string(root.join("Blocks.md")).unwrap();
    let line = line_of(&blocks_text, "| 1");
    let mut store = store_at(&root);
    store
        .apply(VaultCmd::AddLink {
            source_rel: "Blocks.md".into(),
            line,
            target_rel: "Welcome.md".into(),
            target_line: None,
            description: "d".into(),
            link_path: "Welcome".into(),
            base_hash: None,
        })
        .unwrap();
    assert!(
        fs::read_to_string(root.join("Blocks.md"))
            .unwrap()
            .lines()
            .nth(line)
            .unwrap()
            .contains("| 1  | 2  [[Welcome\\|d]] |")
    );
}

#[test]
fn add_link_ambiguous_target_and_rejects_invalid_inputs_without_writes() {
    let root = common::temp_vault("store-add-ambiguous");
    let source = fs::read_to_string(root.join("Welcome.md")).unwrap();
    let line = line_of(&source, "Start at");
    let mut store = with_scripted(&root, &["id0001"]);
    store
        .apply(VaultCmd::AddLink {
            source_rel: "Welcome.md".into(),
            line,
            target_rel: "Topic/Notes.md".into(),
            target_line: Some(2),
            description: "d".into(),
            link_path: "Topic/Notes".into(),
            base_hash: None,
        })
        .unwrap();
    let actual = fs::read_to_string(root.join("Welcome.md"))
        .unwrap()
        .lines()
        .nth(line)
        .unwrap()
        .to_owned();
    assert!(actual.ends_with("[[Topic/Notes#^topic-p|d]]"), "{actual:?}");
    assert!(matches!(
        store.apply(VaultCmd::AddLink {
            source_rel: "Welcome.md".into(),
            line,
            target_rel: "Topic/Notes.md".into(),
            target_line: None,
            description: "d".into(),
            link_path: "Notes2".into(),
            base_hash: None
        }),
        Err(WriteError::BadPath(_))
    ));

    let root = common::temp_vault("store-add-refuse");
    let source = fs::read_to_string(root.join("Welcome.md")).unwrap();
    let line = line_of(&source, "Start at");
    let heading = line_of(&source, "# Welcome");
    let cases = [
        ("Welcome.md", line, "Blocks.md", "Blocks", "", None),
        ("Welcome.md", line, "Blocks.md", "Blocks", "a|b", None),
        ("Welcome.md", heading, "Blocks.md", "Blocks", "d", None),
        ("Welcome.md", line, "Welcome.md", "Welcome", "d", None),
    ];
    let mut store = store_at(&root);
    for (source_rel, line, target_rel, link_path, description, target_line) in cases {
        let before = common::snapshot(&root);
        let command = VaultCmd::AddLink {
            source_rel: source_rel.into(),
            line,
            target_rel: target_rel.into(),
            target_line,
            description: description.into(),
            link_path: link_path.into(),
            base_hash: None,
        };
        assert!(matches!(
            store.apply(command),
            Err(WriteError::Link(_)) | Err(WriteError::Block(_)) | Err(WriteError::SameNote)
        ));
        assert_eq!(common::snapshot(&root), before);
        assert!(journal::read(&root).unwrap().is_empty());
    }
}

#[test]
fn add_link_ambiguous_target() {
    let root = common::temp_vault("store-ambiguous-name");
    let source = fs::read_to_string(root.join("Welcome.md")).unwrap();
    let line = line_of(&source, "Start at");
    let mut store = store_at(&root);
    store
        .apply(VaultCmd::AddLink {
            source_rel: "Welcome.md".into(),
            line,
            target_rel: "Topic/Notes.md".into(),
            target_line: None,
            description: "d".into(),
            link_path: "Topic/Notes".into(),
            base_hash: None,
        })
        .unwrap();
    assert!(
        fs::read_to_string(root.join("Welcome.md"))
            .unwrap()
            .lines()
            .nth(line)
            .unwrap()
            .ends_with("[[Topic/Notes|d]]")
    );
}

#[test]
fn add_link_rejects_without_writing() {
    let root = common::temp_vault("store-rejects-link");
    let source = fs::read_to_string(root.join("Welcome.md")).unwrap();
    let line = line_of(&source, "Start at");
    let heading = line_of(&source, "# Welcome");
    let mut store = store_at(&root);
    let commands = [
        VaultCmd::AddLink {
            source_rel: "Welcome.md".into(),
            line,
            target_rel: "Blocks.md".into(),
            target_line: None,
            description: "".into(),
            link_path: "Blocks".into(),
            base_hash: None,
        },
        VaultCmd::AddLink {
            source_rel: "Welcome.md".into(),
            line,
            target_rel: "Blocks.md".into(),
            target_line: None,
            description: "a|b".into(),
            link_path: "Blocks".into(),
            base_hash: None,
        },
        VaultCmd::AddLink {
            source_rel: "Welcome.md".into(),
            line: heading,
            target_rel: "Blocks.md".into(),
            target_line: None,
            description: "d".into(),
            link_path: "Blocks".into(),
            base_hash: None,
        },
        VaultCmd::AddLink {
            source_rel: "Welcome.md".into(),
            line,
            target_rel: "welcome.MD".into(),
            target_line: None,
            description: "d".into(),
            link_path: "Welcome".into(),
            base_hash: None,
        },
    ];
    for command in commands {
        let before = common::snapshot(&root);
        assert!(matches!(
            store.apply(command),
            Err(WriteError::Link(_)) | Err(WriteError::Block(_)) | Err(WriteError::SameNote)
        ));
        assert_eq!(common::snapshot(&root), before);
        assert!(journal::read(&root).unwrap().is_empty());
    }
}

#[test]
fn remove_link_replaces_text_and_checks_fresh_span() {
    let root = common::temp_vault("store-remove");
    let text = fs::read_to_string(root.join("Welcome.md")).unwrap();
    let line = line_of(&text, "Start at");
    let mut store = store_at(&root);
    store
        .apply(VaultCmd::AddLink {
            source_rel: "Welcome.md".into(),
            line,
            target_rel: "Blocks.md".into(),
            target_line: None,
            description: "why it matters".into(),
            link_path: "Blocks".into(),
            base_hash: None,
        })
        .unwrap();
    let text = fs::read_to_string(root.join("Welcome.md")).unwrap();
    let link = links::parse(&text)
        .into_iter()
        .find(|link| link.target_text(&text) == "Blocks")
        .unwrap();
    let span = link.span.clone();
    let hash = tapestry_vault::layout::fnv1a64(text.as_bytes());
    store
        .apply(VaultCmd::RemoveLink {
            rel: "Welcome.md".into(),
            span: span.clone(),
            base_hash: hash,
        })
        .unwrap();
    let new_text = fs::read_to_string(root.join("Welcome.md")).unwrap();
    assert!(
        new_text
            .lines()
            .nth(line)
            .unwrap()
            .contains(" why it matters")
    );
    assert!(journal::read(&root).unwrap().iter().any(|entry| matches!(&entry.event, Event::LinkRemoved { path, line: event_line, target, description } if path == "Welcome.md" && *event_line == line && target == "Blocks" && description.as_deref() == Some("why it matters"))));
    assert!(matches!(
        store.apply(VaultCmd::RemoveLink {
            rel: "Welcome.md".into(),
            span: 0..2,
            base_hash: tapestry_vault::layout::fnv1a64(new_text.as_bytes())
        }),
        Err(WriteError::NoLinkAt { .. })
    ));
    assert!(matches!(
        store.apply(VaultCmd::RemoveLink {
            rel: "Welcome.md".into(),
            span,
            base_hash: hash
        }),
        Err(WriteError::Conflict { .. })
    ));

    let root = common::temp_vault("store-remove-no-alias");
    let text = fs::read_to_string(root.join("Links.md")).unwrap();
    let link = links::parse(&text)
        .into_iter()
        .find(|link| link.heading(&text).is_some())
        .unwrap();
    let span = link.span.clone();
    let mut store = store_at(&root);
    store
        .apply(VaultCmd::RemoveLink {
            rel: "Links.md".into(),
            span,
            base_hash: tapestry_vault::layout::fnv1a64(text.as_bytes()),
        })
        .unwrap();
    assert!(
        fs::read_to_string(root.join("Links.md"))
            .unwrap()
            .contains("Heading link Blocks and embed")
    );
}

#[test]
fn card_events_append_without_note_writes() {
    let root = common::temp_vault("store-card-events");
    let before = common::snapshot(&root);
    let mut store = store_at(&root);
    store
        .apply(VaultCmd::CardKept {
            rel: "Welcome.md".into(),
        })
        .unwrap();
    store
        .apply(VaultCmd::CardDismissed {
            rel: "Welcome.md".into(),
        })
        .unwrap();
    let after = common::snapshot(&root);
    for (rel, stat) in before.iter().filter(|(rel, _)| rel.ends_with(".md")) {
        assert_eq!(after.get(rel), Some(stat));
    }
    assert!(matches!(
        journal::read(&root).unwrap()[0].event,
        Event::CardKept { .. }
    ));
    assert!(matches!(
        journal::read(&root).unwrap()[1].event,
        Event::CardDismissed { .. }
    ));
}
