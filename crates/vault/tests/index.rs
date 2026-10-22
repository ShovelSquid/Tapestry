mod common;

use std::collections::BTreeMap;
use tapestry_vault::index::{FmStatus, Resolution, VaultIndex};
use tapestry_vault::layout::Rect;
use tapestry_vault::scan::scan;

fn fixture(name: &str) -> (std::path::PathBuf, VaultIndex) {
    let root = common::temp_vault(name);
    common::add_test_time_entries(&root);
    let scan = scan(&root).unwrap();
    (root, VaultIndex::build(&scan))
}

#[test]
fn index_keeps_rectangles_and_computes_non_overlapping_positions_per_folder() {
    let (root, index) = fixture("index-placement");
    let welcome = &index.notes["Welcome.md"];
    assert_eq!(
        welcome.rect,
        Some(Rect {
            x: 0.0,
            y: 0.0,
            w: 230.0,
            h: 150.0
        })
    );
    assert!(!welcome.computed);
    let links = &index.notes["Links.md"];
    assert_eq!(
        links.rect,
        Some(Rect {
            x: 120.0,
            y: 40.0,
            w: 230.0,
            h: 150.0
        })
    );
    let other = &index.notes["Other/Notes.md"];
    assert_eq!(
        other.rect,
        Some(Rect {
            x: 300.0,
            y: 0.0,
            w: 230.0,
            h: 150.0
        })
    );
    let first = index.notes["Blocks.md"].placed;
    assert!(index.notes["Blocks.md"].computed);
    let positioned = [welcome.placed, links.placed];
    assert!(positioned.iter().all(|rect| !rect.intersects(&first)));
    for (rel, note) in &index.notes {
        if note.folder == "" {
            continue;
        }
        let siblings: Vec<_> = index
            .notes
            .values()
            .filter(|s| s.folder == note.folder && s.rel != *rel)
            .collect();
        for sibling in siblings {
            assert!(
                !note.placed.intersects(&sibling.placed),
                "{rel} overlaps {}",
                sibling.rel
            );
        }
    }
    let before = common::snapshot(&root);
    let again = VaultIndex::build(&scan(&root).unwrap());
    assert_eq!(before, common::snapshot(&root));
    let places: BTreeMap<_, _> = index
        .notes
        .iter()
        .map(|(k, v)| (k.clone(), v.placed))
        .collect();
    assert_eq!(
        places,
        again
            .notes
            .iter()
            .map(|(k, v)| (k.clone(), v.placed))
            .collect()
    );
}

#[test]
fn index_reads_folder_world_positions_blocks_and_bad_frontmatter() {
    let (_, index) = fixture("index-frontmatter");
    assert_eq!(index.folders["Topic"].world, Some((1200.0, -400.0, 0.5)));
    assert_eq!(index.folders["Other"].world, None);
    assert_eq!(index.folders[""].world, None);
    assert!(matches!(
        index.notes["Broken.md"].frontmatter,
        FmStatus::Invalid(_)
    ));
    assert_eq!(index.notes["bin.md"].frontmatter, FmStatus::Skipped);
    let blocks = &index.notes["Blocks.md"].blocks;
    for id in ["blk-1", "item-b", "quote-1"] {
        assert!(blocks.iter().any(|b| b.id == id));
    }
    assert!(index.notes["Broken.md"].blocks.is_empty());
}

#[test]
fn resolver_uses_obsidian_paths_and_surfaces_ambiguity() {
    let (_, index) = fixture("index-resolve");
    assert_eq!(
        index.resolve("Topic/Notes", "Welcome.md"),
        Resolution::Resolved("Topic/Notes.md".into())
    );
    assert_eq!(
        index.resolve("Notes", "Welcome.md"),
        Resolution::Ambiguous {
            pick: "Other/Notes.md".into(),
            candidates: vec!["Other/Notes.md".into(), "Topic/Notes.md".into()]
        }
    );
    assert_eq!(
        index.resolve("Notes", "Topic/Topic.md"),
        Resolution::Ambiguous {
            pick: "Topic/Notes.md".into(),
            candidates: vec!["Other/Notes.md".into(), "Topic/Notes.md".into()]
        }
    );
    for (source, path, expected) in [
        ("Welcome.md", "welcome.MD", "Welcome.md"),
        ("Welcome.md", "Leaf", "Sub/Deep/Leaf.md"),
        ("Welcome.md", "Leaf.md", "Sub/Deep/Leaf.md"),
        ("Welcome.md", "Deep/Leaf", "Sub/Deep/Leaf.md"),
        ("Topic/Topic.md", "./Notes", "Topic/Notes.md"),
        ("Topic/Topic.md", "../Welcome", "Welcome.md"),
        ("Welcome.md", "TOPIC/notes", "Topic/Notes.md"),
        ("Welcome.md", "/Welcome", "Welcome.md"),
        ("Welcome.md", "Topic\\Notes", "Topic/Notes.md"),
    ] {
        assert_eq!(
            index.resolve(path, source),
            Resolution::Resolved(expected.into()),
            "{path}"
        );
    }
    assert_eq!(
        index.resolve("Missing", "Welcome.md"),
        Resolution::Unresolved
    );
    assert_eq!(
        index.resolve("../../x", "Welcome.md"),
        Resolution::Unresolved
    );
}

#[test]
fn link_records_expose_blocks_descriptions_backlinks_and_short_paths() {
    let (_, index) = fixture("index-links");
    let links = index.outlinks("Links.md");
    let first = links.iter().find(|link| link.path == "Blocks").unwrap();
    assert_eq!(first.source_block.as_deref(), Some("src-1"));
    assert_eq!(first.target, Resolution::Resolved("Blocks.md".into()));
    assert_eq!(first.target_block.as_deref(), Some("blk-1"));
    assert_eq!(first.description.as_deref(), Some("why it matters"));
    assert!(
        links
            .iter()
            .any(|link| link.heading.as_deref() == Some("Heading Two"))
    );
    assert!(links.iter().any(|link| link.embed));
    assert!(links.iter().any(|link| link.path.is_empty()
        && link.target == Resolution::Resolved("Links.md".into())
        && link.target_block.as_deref() == Some("local")));
    assert!(
        links
            .iter()
            .any(|link| link.description.as_deref() == Some("alias in table"))
    );
    for excluded in ["InFence", "InCode", "InComment", "InHtml"] {
        assert!(!index.links.iter().any(|link| link.path == excluded));
    }
    assert!(
        index
            .outlinks("Broken.md")
            .iter()
            .any(|link| link.path == "Welcome")
    );
    assert_eq!(index.backlinks("Blocks.md").len(), 4);
    assert!(
        index
            .backlinks("Topic/Notes.md")
            .iter()
            .any(|link| link.source == "Welcome.md")
    );
    assert!(
        index
            .backlinks("Topic/Notes.md")
            .iter()
            .any(|link| link.source == "Links.md")
    );
    assert!(
        index
            .backlinks("Topic/Notes.md")
            .iter()
            .any(|link| link.source == "Topic/Topic.md")
    );
    assert_eq!(index.outlinks("Welcome.md").len(), 6);
    assert_eq!(index.block_owners("BLK-1"), ["Blocks.md"]);
    assert_eq!(index.link_path("Topic/Notes.md"), "Topic/Notes");
    assert_eq!(index.link_path("Sub/Deep/Leaf.md"), "Leaf");
    assert_eq!(index.link_path("Welcome.md"), "Welcome");
    assert_eq!(index.link_path("UPPER.MD"), "UPPER");
    assert_eq!(
        index
            .build_link("Topic/Notes.md", Some("topic-p"), "why", false)
            .unwrap(),
        "[[Topic/Notes#^topic-p|why]]"
    );
    assert_eq!(
        index
            .build_link("Blocks.md", Some("blk-1"), "why", false)
            .unwrap(),
        "[[Blocks#^blk-1|why]]"
    );
}
