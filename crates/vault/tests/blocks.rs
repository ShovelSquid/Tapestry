use tapestry_vault::blocks::{
    Anchor, BlockError, IdGen, RandomIds, ids, insert_anchor, is_valid_id, line_of, line_starts,
    segment,
};

struct Scripted(Vec<&'static str>);
impl IdGen for Scripted {
    fn next_id(&mut self) -> String {
        if self.0.is_empty() {
            "".into()
        } else {
            self.0.remove(0).into()
        }
    }
}

fn add(text: &str, line: usize, id: &'static str) -> String {
    let anchor = insert_anchor(text, line, &mut Scripted(vec![id])).unwrap();
    anchor.edit.unwrap().apply(text)
}

#[test]
fn line_helpers_use_whole_file_byte_offsets() {
    let text = "a\r\nb\n";
    assert_eq!(line_starts(text), vec![0, 3, 5]);
    assert_eq!(line_of(text, 0), 0);
    assert_eq!(line_of(text, 4), 1);
    assert_eq!(line_of(text, text.len()), 2);
}

#[test]
fn anchors_paragraph_at_last_line() {
    assert_eq!(
        add("line one\nline two\n", 0, "k3x9a1"),
        "line one\nline two ^k3x9a1\n"
    );
}

#[test]
fn anchors_selected_list_item_not_neighbor() {
    assert_eq!(
        add("- alpha\n- beta\n", 1, "k3x9a1"),
        "- alpha\n- beta ^k3x9a1\n"
    );
    assert_eq!(
        add("- alpha\n- beta\n", 0, "k3x9a1"),
        "- alpha ^k3x9a1\n- beta\n"
    );
}

#[test]
fn list_item_continuation_is_included() {
    assert_eq!(
        add("- alpha\n  more\n- beta\n", 0, "k3x9a1"),
        "- alpha\n  more ^k3x9a1\n- beta\n"
    );
}

#[test]
fn nested_task_and_ordered_lists_are_segmented() {
    assert_eq!(add("- a\n  - b\n", 0, "k3x9a1"), "- a ^k3x9a1\n  - b\n");
    assert_eq!(add("- [ ] todo\n", 0, "k3x9a1"), "- [ ] todo ^k3x9a1\n");
    assert_eq!(
        add("1. one\n2) two\n", 1, "k3x9a1"),
        "1. one\n2) two ^k3x9a1\n"
    );
}

#[test]
fn quote_and_callout_ids_get_their_own_lines() {
    assert_eq!(
        add("> quoted\n> more\nnext\n", 0, "k3x9a1"),
        "> quoted\n> more\n\n^k3x9a1\n\nnext\n"
    );
    assert_eq!(
        add("> [!note] T\n> body\n", 0, "k3x9a1"),
        "> [!note] T\n> body\n\n^k3x9a1\n"
    );
}

#[test]
fn table_ids_get_separate_lines_and_reuse_following_blank() {
    assert_eq!(
        add("| a | b |\n|---|---|\n| 1 | 2 |\n", 0, "k3x9a1"),
        "| a | b |\n|---|---|\n| 1 | 2 |\n\n^k3x9a1\n"
    );
    assert_eq!(
        add("| a |\n|---|\n| 1 |\n\nafter\n", 0, "k3x9a1"),
        "| a |\n|---|\n| 1 |\n\n^k3x9a1\n\nafter\n"
    );
    assert_eq!(
        add("| a |\n|---|\n| 1 |", 0, "k3x9a1"),
        "| a |\n|---|\n| 1 |\n\n^k3x9a1\n"
    );
}

#[test]
fn existing_paragraph_and_structural_ids_are_reused() {
    assert_eq!(
        insert_anchor("text ^abc\n", 0, &mut Scripted(vec![])).unwrap(),
        Anchor {
            id: "abc".into(),
            edit: None
        }
    );
    assert_eq!(
        insert_anchor("> q\n\n^qid\n", 0, &mut Scripted(vec![])).unwrap(),
        Anchor {
            id: "qid".into(),
            edit: None
        }
    );
    assert!(!segment("| a |\n|---|\n| 1 |\n^table\n").iter().any(|b| b.kind == tapestry_vault::blocks::BlockKind::Paragraph && b.lines.contains(&3)));
}

#[test]
fn only_line_ending_anchor_markers_are_reused() {
    assert_eq!(
        add("text ^abc more\n", 0, "k3x9a1"),
        "text ^abc more ^k3x9a1\n"
    );
}

#[test]
fn trailing_whitespace_and_crlf_are_preserved() {
    assert_eq!(add("line  \n", 0, "k3x9a1"), "line ^k3x9a1  \n");
    assert_eq!(add("a\r\nb\r\n", 0, "k3x9a1"), "a\r\nb ^k3x9a1\r\n");
    assert_eq!(
        add("> q\r\n> r\r\n", 0, "k3x9a1"),
        "> q\r\n> r\r\n\r\n^k3x9a1\r\n"
    );
}

#[test]
fn headings_fences_frontmatter_comments_rules_and_blanks_are_refused() {
    let mut generator = Scripted(vec!["valid"]);
    assert_eq!(
        insert_anchor("# Title\n", 0, &mut generator).unwrap_err(),
        BlockError::Heading
    );
    assert_eq!(
        insert_anchor("Title\n===\n", 0, &mut generator).unwrap_err(),
        BlockError::Heading
    );
    assert_eq!(
        insert_anchor("```\nx\n```\n", 1, &mut generator).unwrap_err(),
        BlockError::Fence
    );
    assert_eq!(
        insert_anchor("---\ntitle: A\n---\ntext\n", 1, &mut generator).unwrap_err(),
        BlockError::Frontmatter
    );
    assert_eq!(
        insert_anchor("%% comment %%\n", 0, &mut generator).unwrap_err(),
        BlockError::Comment
    );
    assert_eq!(
        insert_anchor("***\n", 0, &mut generator).unwrap_err(),
        BlockError::Rule
    );
    assert_eq!(
        insert_anchor("\ntext\n", 0, &mut generator).unwrap_err(),
        BlockError::NoBlock
    );
    assert_eq!(
        insert_anchor("text\n", 2, &mut generator).unwrap_err(),
        BlockError::LineOutOfRange
    );
}

#[test]
fn id_validation_and_random_ids_follow_contract() {
    assert!(is_valid_id("A-19z"));
    assert!(!is_valid_id("a_b"));
    let mut random = RandomIds::new();
    for _ in 0..1000 {
        let id = random.next_id();
        assert_eq!(id.len(), 6);
        assert!(
            id.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        );
    }
}

#[test]
fn collisions_are_case_insensitive_and_invalid_ids_skipped() {
    let anchor = insert_anchor(
        "existing ^ABC123\n\nnew",
        2,
        &mut Scripted(vec!["abc123", "a_b", "zzz999"]),
    )
    .unwrap();
    assert_eq!(anchor.id, "zzz999");
}

#[test]
fn exhausted_generator_returns_typed_error() {
    assert_eq!(
        insert_anchor(
            "existing ^taken\n\nnew",
            2,
            &mut Scripted(vec!["taken"; 65])
        )
        .unwrap_err(),
        BlockError::IdExhausted
    );
}

#[test]
fn ids_are_unique_in_document_order() {
    assert_eq!(ids("one ^abc\n\ntwo ^def\n"), vec!["abc", "def"]);
}

#[test]
fn segments_distinguish_heading_table_quote_list_and_paragraph() {
    use tapestry_vault::blocks::{BlockKind, segment};
    let kinds = segment("# H\n\nparagraph\n\n- item\n\n> q\n\n| a |\n|---|\n| b |\n")
        .into_iter()
        .map(|block| block.kind)
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        vec![
            BlockKind::Heading,
            BlockKind::Paragraph,
            BlockKind::ListItem,
            BlockKind::Quote,
            BlockKind::Table
        ]
    );
}

#[test]
fn comments_and_fences_each_form_a_single_block() {
    use tapestry_vault::blocks::{BlockKind, segment};
    let kinds = segment("before\n\n%% start\ninside\nend %%\n\n~~~\ncode\n~~~\n")
        .into_iter()
        .map(|block| block.kind)
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        vec![BlockKind::Paragraph, BlockKind::Comment, BlockKind::Fence]
    );
}

#[test]
fn same_note_frontmatter_is_outside_body_blocks() {
    use tapestry_vault::blocks::{BlockKind, segment};
    let blocks = segment("---\ntitle: x\n---\nbody\n");
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].kind, BlockKind::Paragraph);
    assert_eq!(blocks[0].lines, 3..4);
}
