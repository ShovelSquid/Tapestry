use tapestry_vault::links::{
    LinkError, SubpathKind, build_link, fences, parse, targets, validate_description,
};

#[test]
fn parses_plain_alias_heading_and_block_links() {
    let text = "[[Note]] [[Note|alias]] [[Note#Heading]] [[Note#H1#H2]] [[Note#^abc-1]]";
    let links = parse(text);
    assert_eq!(links.len(), 5);
    assert_eq!(&text[links[0].span.clone()], "[[Note]]");
    assert_eq!(links[0].target_text(text), "Note");
    assert_eq!(links[0].alias_text(text), None);
    assert_eq!(links[1].alias_text(text), Some("alias"));
    assert_eq!(links[2].heading(text), Some("Heading"));
    assert_eq!(links[3].heading(text), Some("H1#H2"));
    assert_eq!(links[4].block_id(text), Some("abc-1"));
    assert_eq!(links[4].subpath.as_ref().unwrap().kind, SubpathKind::Block);
}

#[test]
fn parses_folder_embed_and_same_note_links() {
    let text = "[[Folder/Note#^id|description]] ![[Img.png]] [[#^local]]";
    let links = parse(text);
    assert_eq!(links.len(), 3);
    assert_eq!(links[0].target_text(text), "Folder/Note");
    assert_eq!(links[0].block_id(text), Some("id"));
    assert!(links[1].embed);
    assert_eq!(&text[links[1].span.clone()], "![[Img.png]]");
    assert_eq!(links[2].target_text(text), "");
    assert_eq!(links[2].block_id(text), Some("local"));
}

#[test]
fn trims_fields_and_recognizes_escaped_pipe() {
    let text = "| [[ Note\\| shown ]] | x |";
    let link = parse(text).pop().unwrap();
    assert_eq!(link.target_text(text), "Note");
    assert_eq!(link.alias_text(text), Some("shown"));
    assert!(link.escaped_pipe);
}

#[test]
fn masks_backtick_and_tilde_fences_including_quoted_fences() {
    for text in [
        "```md\n[[x]]\n```\n[[y]]",
        "~~~\n[[x]]\n~~~\n[[y]]",
        "> ```\n> [[x]]\n> ```\n[[y]]",
        "```\n[[x]]",
    ] {
        let parsed = parse(text);
        if text.contains("[[y]]") {
            assert_eq!(
                parsed
                    .iter()
                    .map(|l| l.target_text(text))
                    .collect::<Vec<_>>(),
                vec!["y"],
                "{text:?}"
            );
        } else {
            assert!(parsed.is_empty(), "{text:?}");
        }
    }
}

#[test]
fn masks_inline_code_comments_and_frontmatter() {
    let text = "---\nfound_from: \"[[front]]\"\n---\n`[[one]]` ``[[two]]`` %% [[three]] %%\n<!-- [[four]] -->\n%% open\n[[five]]\nclose %%\n[[ok]]";
    assert_eq!(targets(text), vec!["ok"]);
}

#[test]
fn inline_code_unmatched_ticks_and_four_space_code_behavior() {
    let text = "prefix ` unmatched [[a]]\n    [[b]]";
    assert_eq!(targets(text), vec!["a", "b"]);
}

#[test]
fn four_space_indented_fence_like_text_is_not_a_fence() {
    let text = "    ```\n[[visible]]";
    assert!(fences(text).is_empty());
    assert_eq!(targets(text), vec!["visible"]);
}

#[test]
fn nested_and_multiline_openers_are_recovered() {
    assert_eq!(targets("[[a [[b]]"), vec!["b"]);
    assert!(parse("[[Note\n]]").is_empty());
    assert!(parse("[[]] [[|x]]").is_empty());
}

#[test]
fn spans_are_byte_exact_after_multibyte_text() {
    let text = "é [[Note]]";
    let link = parse(text).pop().unwrap();
    assert_eq!(&text[link.span], "[[Note]]");
}

#[test]
fn crlf_never_leaks_carriage_return_into_fields() {
    let text = "[[Note|alias]]\r\n";
    let link = parse(text).pop().unwrap();
    assert_eq!(link.target_text(text), "Note");
    assert_eq!(link.alias_text(text), Some("alias"));
}

#[test]
fn targets_preserves_legacy_contract_for_plain_corpus() {
    let corpus = [
        "[[One]]",
        "[[Two|alias]]",
        "[[Three#Heading]]",
        "[[Four#^id]]",
        "![[Five]]",
        "[[folder/Six]]",
        "[[ Seven ]]",
        "[[Eight]] [[Eight]]",
        "[[Nine]][[Ten]]",
        "prefix [[Eleven|shown]] suffix",
        "[[Twelve#H1#H2|alias]]",
    ];
    for text in corpus {
        assert_eq!(targets(text), old_wikilinks(text), "{text}");
    }
}

fn old_wikilinks(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("[[") {
        rest = &rest[i + 2..];
        let Some(j) = rest.find("]]") else { break };
        let inner = &rest[..j];
        let target = inner.split(['|', '#']).next().unwrap_or("").trim();
        if !target.is_empty() && !out.iter().any(|t: &String| t == target) {
            out.push(target.to_owned());
        }
        rest = &rest[j + 2..];
    }
    out
}

#[test]
fn targets_masks_fences_and_fixes_escaped_pipe() {
    assert_eq!(targets("```\n[[hidden]]\n```\n[[shown]]"), vec!["shown"]);
    assert_eq!(targets("[[Note\\|a]]"), vec!["Note"]);
}

#[test]
fn fence_ranges_cover_delimiters() {
    let text = "before\n~~~x\nbody\n~~~\nafter";
    let r = fences(text);
    assert_eq!(r.len(), 1);
    assert_eq!(&text[r[0].clone()], "~~~x\nbody\n~~~\n");
}

#[test]
fn builder_formats_block_and_table_links() {
    assert_eq!(
        build_link("Note", Some("k3x9a1"), "why it matters", false).unwrap(),
        "[[Note#^k3x9a1|why it matters]]"
    );
    assert_eq!(
        build_link("Topic/Note", Some("k3x9a1"), "why", true).unwrap(),
        "[[Topic/Note#^k3x9a1\\|why]]"
    );
    assert_eq!(
        build_link("Topic/Note", None, "why", false).unwrap(),
        "[[Topic/Note|why]]"
    );
}

#[test]
fn validates_and_normalizes_descriptions() {
    assert_eq!(validate_description("  a\n\t b  ").unwrap(), "a b");
    assert_eq!(
        validate_description(" \t\n "),
        Err(LinkError::EmptyDescription)
    );
    for bad in ["[", "]", "|", "`", "%%", "<!--"] {
        assert!(matches!(
            validate_description(&format!("before {bad} after")),
            Err(LinkError::ForbiddenInDescription(_))
        ));
    }
}

#[test]
fn builder_rejects_bad_path_and_id() {
    assert_eq!(
        build_link("", None, "why", false),
        Err(LinkError::EmptyTarget)
    );
    assert_eq!(
        build_link("A#B", None, "why", false),
        Err(LinkError::ForbiddenInTarget("#"))
    );
    assert_eq!(
        build_link("A", Some("a_b"), "why", false),
        Err(LinkError::BadBlockId("a_b".into()))
    );
}

#[test]
fn builder_round_trips_multiple_paths_descriptions_and_table_modes() {
    let descriptions = [
        "a",
        "Two words",
        "comma, semicolon;",
        "unicode é漢🙂",
        "quotes ' \" / \\",
        "punctuation !?()",
    ];
    for description in descriptions {
        for path in ["Note", "Topic/Note", "My Note"] {
            for block in [None, Some("k3x9a1")] {
                for table in [false, true] {
                    let built = build_link(path, block, description, table).unwrap();
                    let wrapped = if table {
                        format!("| {built} | x |")
                    } else {
                        format!("see {built} end")
                    };
                    let found = parse(&wrapped);
                    assert_eq!(found.len(), 1, "{wrapped}");
                    assert_eq!(found[0].target_text(&wrapped), path);
                    assert_eq!(found[0].block_id(&wrapped), block);
                    assert_eq!(found[0].alias_text(&wrapped), Some(description));
                    assert_eq!(found[0].escaped_pipe, table);
                }
            }
        }
    }
}

#[test]
fn seeded_corpus_round_trips_two_hundred_descriptions() {
    let alphabet: Vec<char> = "abcXYZ012 éß漢🙂,.;!?()".chars().collect();
    let mut state = 0x8f31_2a77_6c09_b5d1u64;
    let mut valid = 0;
    for _ in 0..200 {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        let length = (state.wrapping_mul(0x2545_f491_4f6c_dd1d) % 20) as usize + 1;
        let mut description = String::new();
        for _ in 0..length {
            state ^= state >> 12;
            state ^= state << 25;
            state ^= state >> 27;
            let n = state.wrapping_mul(0x2545_f491_4f6c_dd1d) as usize;
            description.push(alphabet[n % alphabet.len()]);
        }
        let Ok(description) = validate_description(&description) else {
            continue;
        };
        valid += 1;
        for path in ["Note", "Topic/Note", "My Note"] {
            for block in [None, Some("k3x9a1")] {
                for table in [false, true] {
                    let built = build_link(path, block, &description, table).unwrap();
                    let wrapped = if table {
                        format!("| {built} | x |")
                    } else {
                        format!("see {built} end")
                    };
                    let links = parse(&wrapped);
                    assert_eq!(links.len(), 1);
                    assert_eq!(links[0].target_text(&wrapped), path);
                    assert_eq!(links[0].block_id(&wrapped), block);
                    assert_eq!(links[0].alias_text(&wrapped), Some(description.as_str()));
                    assert_eq!(links[0].escaped_pipe, table);
                }
            }
        }
    }
    assert!(valid >= 150);
}
