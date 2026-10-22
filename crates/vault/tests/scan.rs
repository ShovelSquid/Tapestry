mod common;

use std::path::Path;
use tapestry_vault::scan::{NoteStatus, ScanOptions, SkipReason, scan, scan_with, stat_tree};

#[test]
fn scan_lists_notes_and_folders() {
    let root = common::temp_vault("scan-lists");
    common::add_test_time_entries(&root);
    let scan = scan(&root).unwrap();
    let rels: Vec<_> = scan.notes.iter().map(|n| n.rel.as_str()).collect();
    assert_eq!(
        rels,
        [
            "Blocks.md",
            "Broken.md",
            "Links.md",
            "Other/Notes.md",
            "Sub/Deep/Leaf.md",
            "Topic/Notes.md",
            "Topic/Topic.md",
            "UPPER.MD",
            "Welcome.md",
            "bin.md",
            "no-frontmatter/2026-10-09-0726-15.md",
            "no-frontmatter/2026-10-09-0822-48.md"
        ]
    );
    assert_eq!(
        scan.folders,
        [
            "",
            "Empty",
            "Other",
            "Sub",
            "Sub/Deep",
            "Topic",
            "no-frontmatter"
        ]
    );
}

#[cfg(unix)]
#[test]
fn scan_skips_symlinks() {
    let root = common::temp_vault("scan-symlinks");
    common::add_test_time_entries(&root);
    let scan = scan(&root).unwrap();
    for rel in ["link.md", "linkdir", "loop"] {
        assert!(
            scan.skipped
                .iter()
                .any(|s| s.rel == rel && s.reason == SkipReason::Symlink)
        );
        assert!(!scan.notes.iter().any(|n| n.rel == rel));
        assert!(!scan.folders.iter().any(|f| f == rel));
    }
}

#[test]
fn scan_reports_unreadable_text_and_caps() {
    let root = common::temp_vault("scan-limits");
    common::add_test_time_entries(&root);
    let full = scan(&root).unwrap();
    let bin = full.notes.iter().find(|n| n.rel == "bin.md").unwrap();
    assert_eq!(bin.status, NoteStatus::NotUtf8);
    assert!(bin.text.is_none());
    let limited = scan_with(
        &root,
        &ScanOptions {
            max_note_bytes: 10,
            ..ScanOptions::default()
        },
    )
    .unwrap();
    let welcome = limited
        .notes
        .iter()
        .find(|n| n.rel == "Welcome.md")
        .unwrap();
    assert_eq!(welcome.status, NoteStatus::TooLarge);
    assert!(welcome.text.is_none());
    assert_eq!(welcome.hash, 0);
    let capped = scan_with(
        &root,
        &ScanOptions {
            max_entries: 5,
            ..ScanOptions::default()
        },
    )
    .unwrap();
    assert!(capped.truncated);
    assert!(capped.notes.len() <= 5);
}

#[test]
fn scan_changes_nothing() {
    let root = common::temp_vault("scan-read-only");
    common::add_test_time_entries(&root);
    let before = common::snapshot(&root);
    scan(&root).unwrap();
    let after = common::snapshot(&root);
    assert_eq!(before, after);
    assert!(!root.join(".tapestry").exists());
}

#[test]
fn scan_records_hashes_and_stat_tree_matches() {
    let root = common::temp_vault("scan-stats");
    common::add_test_time_entries(&root);
    let result = scan(&root).unwrap();
    for note in result.notes.iter().filter(|n| n.status == NoteStatus::Ok) {
        assert!(note.mtime_ms.is_some());
        assert_eq!(
            note.hash,
            tapestry_vault::layout::fnv1a64(&std::fs::read(root.join(&note.rel)).unwrap())
        );
        #[cfg(target_os = "macos")]
        assert!(note.birth_ms.is_some());
    }
    let stats = stat_tree(Path::new(&root)).unwrap();
    assert_eq!(
        stats.keys().cloned().collect::<Vec<_>>(),
        result
            .notes
            .iter()
            .map(|n| n.rel.clone())
            .collect::<Vec<_>>()
    );
    for note in result.notes {
        assert_eq!(stats[&note.rel].len, note.len);
    }
}
