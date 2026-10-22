//! One path through every tier: scan, index, Store writes, journal, rescan.

mod common;

use std::fs;

use tapestry_vault::journal::{self, Entry, Event};
use tapestry_vault::{LayoutPatch, Store, VaultCmd, VaultIndex, scan};

const A: &str = "---\nx: 10\ny: 20\nw: 230\nh: 150\ntags:\n  - keep # note\n---\nAlpha\n";
const B: &str = "# Beta\nplain body\n";

#[test]
fn layout_round_trip_through_store() {
    let root = common::temp_dir("tracer");
    fs::write(root.join("A.md"), A).unwrap();
    fs::write(root.join("B.md"), B).unwrap();

    let index = VaultIndex::build(&scan(&root).unwrap());
    let a = &index.notes["A.md"].layout;
    assert_eq!((a.x, a.y), (Some(10.0), Some(20.0)));
    assert_eq!(index.notes["B.md"].layout.x, None);
    assert_eq!(index.notes["A.md"].title, "A");
    assert_eq!(index.notes["A.md"].folder, "");

    let mut store = Store::open(&root).unwrap().with_clock(common::fixed_clock());
    let patch = LayoutPatch { x: Some(40.0), y: Some(60.0), w: Some(230.0), h: Some(150.0), ..Default::default() };
    let out = store.apply(VaultCmd::SetLayout { rel: "B.md".into(), patch }).unwrap();
    assert_eq!(out.written, vec!["B.md".to_owned()]);
    assert_eq!(
        fs::read_to_string(root.join("B.md")).unwrap(),
        "---\nx: 40\ny: 60\nw: 230\nh: 150\n---\n# Beta\nplain body\n"
    );

    // The same layout again changes nothing on disk.
    let again = store.apply(VaultCmd::SetLayout { rel: "B.md".into(), patch }).unwrap();
    assert!(again.written.is_empty());

    let out = store.apply(VaultCmd::CreateNote { rel: "C.md".into(), body: "Gamma\n".into() }).unwrap();
    assert_eq!(out.written, vec!["C.md".to_owned()]);
    assert_eq!(fs::read_to_string(root.join("C.md")).unwrap(), "---\ncreated: 2026-10-21T10:11:12\n---\nGamma\n");

    let entries = journal::read(&root).unwrap();
    assert_eq!(entries.len(), 2);
    assert!(matches!(&entries[0].event, Event::NoteEstimated { path, from, .. } if path == "B.md" && (from == "birth" || from == "mtime")));
    assert_eq!(entries[1], Entry { t: common::FIXED_MS, event: Event::NoteCreated { path: "C.md".into() } });
    assert_eq!(
        fs::read_to_string(journal::path(&root)).unwrap().lines().last().unwrap(),
        "{\"t\":1792577472000,\"kind\":\"note_created\",\"path\":\"C.md\"}"
    );
    assert_eq!(fs::read_to_string(root.join("A.md")).unwrap(), A);

    let index = VaultIndex::build(&scan(&root).unwrap());
    let b = &index.notes["B.md"].layout;
    assert_eq!((b.x, b.y), (Some(40.0), Some(60.0)));
    assert!(index.notes.contains_key("C.md"));
    assert_eq!(index.notes.len(), 3, "the journal folder is not a note");
    assert!(common::no_temp_files(&root));
}
