---
phase: 01-vault-model
plan: 02
subsystem: vault
tags: [rust, wikilinks, markdown, block-refs]

requires:
  - phase: 01-vault-model
    provides: frontmatter parsing and byte-preserving vault foundation
provides:
  - Obsidian wikilink parser with byte spans and code/comment masks
  - Markdown block segmentation and Obsidian block anchor insertion
  - Described-link builder and shared Files tool link targets
affects: [01-vault-model, canvas, index, store]

actuals:
  tokens: 12500
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns: [byte-range parsing over plain text, shared vault parser API]

key-files:
  created:
    - crates/vault/src/links.rs
    - crates/vault/src/blocks.rs
    - crates/vault/tests/links.rs
    - crates/vault/tests/blocks.rs
  modified:
    - crates/vault/src/lib.rs
    - apps/canvas/Cargo.toml
    - apps/canvas/src/ide.rs
    - Cargo.lock

key-decisions:
  - "Keep parsing hand-rolled over plain text to preserve exact byte spans and avoid a markdown-parser dependency."
  - "Reuse the link module's fence detection in block segmentation."

patterns-established:
  - "Parser outputs refer to UTF-8 byte ranges in the original note text."
  - "Vault consumers use the shared tapestry-vault wikilink targets function."

requirements-completed: [LINK-01, LINK-02, LINK-03]
coverage:
  - id: D1
    description: "Wikilinks, embeds, and targets parse with byte spans while fenced code, inline code, comments, and frontmatter are masked."
    requirement: LINK-01
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-vault --test links"
        status: pass
    human_judgment: false
  - id: D2
    description: "Markdown blocks receive valid Obsidian ^id anchors at the correct placement, with existing ids reused."
    requirement: LINK-02
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-vault --test blocks"
        status: pass
    human_judgment: false
  - id: D3
    description: "Described links are validated and round-trip through the parser; the Files tool uses the shared parser."
    requirement: LINK-03
    verification:
      - kind: integration
        ref: "cargo test -p tapestry-vault"
        status: pass
      - kind: integration
        ref: "cargo build -p tapestry-canvas-app"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-canvas-app -q"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-10-21
status: complete
---

# Phase 1 Plan 2: Wikilinks, block anchors, and described-link builder

**The vault now parses and builds Obsidian links with byte-accurate spans, masks code and comments, and inserts block anchors; the Files tool shares this parser.**

## Performance

- **Duration:** about 20 minutes
- **Started:** 2026-10-21
- **Completed:** 2026-10-21
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added the link parser, masks, target extraction, description validation, and described-link builder.
- Added block segmentation and anchor insertion for paragraphs, lists, quotes, callouts, and tables.
- Routed the Files tool through `tapestry_vault::links::targets` and verified the app build and tests.

## Task Commits

1. **Task 1: Wikilink parser and masks** - `22ef122`
2. **Task 2: Block segmentation and anchors** - `a911bcd`
3. **Task 3: Described-link builder and Files tool delegation** - `467ba4f`

**Plan metadata:** this SUMMARY will be committed separately.

## Files Created/Modified

- `crates/vault/src/links.rs` - link parser, masks, targets, and builder.
- `crates/vault/src/blocks.rs` - Markdown block segmentation and anchor insertion.
- `crates/vault/tests/links.rs` - parser, mask, builder, and round-trip tests.
- `crates/vault/tests/blocks.rs` - segmentation and anchor behavior tests.
- `crates/vault/src/lib.rs` - exports the `links` and `blocks` modules.
- `apps/canvas/Cargo.toml`, `Cargo.lock` - adds the vault crate dependency.
- `apps/canvas/src/ide.rs` - delegates Files tool link extraction.

## Decisions Made

- Kept the parser hand-rolled over plain text to preserve exact spans without a markdown-parser dependency.
- Reused fence detection from the links module when segmenting blocks.

## Deviations from Plan

### Auto-fixed Issues

**1. Table delimiter detection accepted empty delimiter rows.**
- **Found during:** Task 2 review.
- **Issue:** Filtering empty cells before checking the row could let a row of only empty cells pass because `all()` on an empty collection is true.
- **Fix:** Require at least one nonempty cell and validate every remaining cell as colon-wrapped dashes.
- **Files modified:** `crates/vault/src/blocks.rs`.
- **Verification:** Full `cargo test -p tapestry-vault` passed.
- **Committed in:** `a911bcd`.

**Total deviations:** 1 auto-fixed.
**Impact on plan:** Correctness edge case fix within the planned table segmentation scope.

## Issues Encountered

- The sandbox initially prevented access to Git metadata outside the writable workspace. The scoped commits completed after the Git operation was approved. No unrelated notes were included.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 03 can use the shared parser and block-anchor APIs. Vault tests, app build, and app tests all pass.

---
*Phase: 01-vault-model*
*Completed: 2026-10-21*
