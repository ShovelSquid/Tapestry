---
phase: 01-vault-model
plan: 03
subsystem: vault
tags: [rust, scan, layout, wikilinks, backlinks]

requires:
  - phase: 01-vault-model
    provides: frontmatter, link parser, block anchors, and vault crate foundation
provides:
  - Read-only vault walk with skip rules, caps, hashes, and file metadata
  - Stable layout math and in-memory non-overlapping card placement
  - Obsidian path resolution, block-aware link index, backlinks, and link text selection
affects: [01-vault-model, explorer, canvas, store]

actuals:
  tokens: 12920
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns: [iterative sorted vault walk, stable FNV-1a layout math, explicit ambiguous link resolution]

key-files:
  created:
    - crates/vault/src/layout.rs
    - crates/vault/tests/scan.rs
    - crates/vault/tests/index.rs
    - crates/vault/tests/fixtures/obsidian-sample/
  modified:
    - crates/vault/src/scan.rs
    - crates/vault/src/index.rs
    - crates/vault/src/lib.rs
    - crates/vault/tests/common/mod.rs

key-decisions:
  - "Computed placements remain in memory and are assigned deterministically per folder."
  - "Duplicate basename links retain their candidates and expose a deterministic same-folder-first pick."
  - "The scan uses metadata before reading and never follows symlinks."

patterns-established:
  - "Read-only scans return skipped entries and truncation state instead of silently following or hiding problematic entries."
  - "All path lookup keys pass through the index key normalization function."

requirements-completed: [VAULT-02, VAULT-03, LINK-04]
coverage:
  - id: D1
    description: "The vault scan lists notes and folders, reports skipped symlinks, enforces caps, and leaves file and directory snapshots unchanged."
    requirement: VAULT-02
    verification:
      - kind: integration
        ref: "cargo test -p tapestry-vault --test scan"
        status: pass
    human_judgment: false
  - id: D2
    description: "Positioned notes keep their frontmatter rectangles; unpositioned notes receive deterministic non-overlapping per-folder placements without writes."
    requirement: VAULT-03
    verification:
      - kind: integration
        ref: "cargo test -p tapestry-vault --test index"
        status: pass
      - kind: unit
        ref: "cargo test -p tapestry-vault --lib layout::"
        status: pass
    human_judgment: false
  - id: D3
    description: "Links resolve across the vault with ambiguity surfaced, block references indexed, backlinks available, and shortest unambiguous paths built."
    requirement: LINK-04
    verification:
      - kind: integration
        ref: "cargo test -p tapestry-vault --test index"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-vault"
        status: pass
      - kind: integration
        ref: "cargo build -p tapestry-canvas-app"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-10-22
status: complete
---

# Phase 1 Plan 3: Read-only scan, stable layout, and link index

**The vault now scans read-only with explicit skips and caps, places cards deterministically in memory, and indexes Obsidian links with ambiguity and backlinks.**

## Performance

- **Duration:** about 15 minutes
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 3
- **Files modified:** 19

## Accomplishments

- Replaced the thin walk with a sorted, capped read-only scan that records symlinks, timestamps, hashes, and unreadable text states.
- Added a 12-file Obsidian-style fixture vault and zero-change snapshot tests.
- Added stable FNV placement math, folder world positions, block metadata, Obsidian path resolution, link records, backlinks, and link-path construction.

## Task Commits

1. **Task 1: Read-only scan and fixture vault** - `f2fee37`
2. **Task 2: Stable layout and computed placement** - `2175a60`
3. **Task 3: Link resolution, index, and backlinks** - `8a758b4`

**Plan metadata:** this SUMMARY will be committed separately.

## Files Created/Modified

- `crates/vault/src/scan.rs` - capped, read-only filesystem walk and stat tree.
- `crates/vault/src/layout.rs` - stable hash, normalized paths, rectangles, and free placement.
- `crates/vault/src/index.rs` - card, folder, block, link, resolution, and backlink read model.
- `crates/vault/tests/common/mod.rs` - fixture copying, snapshots, and test-time vault entries.
- `crates/vault/tests/scan.rs`, `crates/vault/tests/index.rs` - scan and index contract tests.
- `crates/vault/tests/fixtures/obsidian-sample/` - 12-file fixture vault, including byte-copied existing notes.
- `crates/vault/src/lib.rs` - exports the layout module.

## Decisions Made

- Computed placements are recalculated in memory per folder; no note is modified by indexing.
- Duplicate basenames produce an `Ambiguous` result with candidates and a deterministic same-folder-first pick.
- Symlinks are reported and skipped; entry and note-size caps are explicit in scan results.

## Deviations from Plan

### Auto-fixed Issues

**1. Parallel index tests collided on a shared temporary directory.**
- **Found during:** Task 2 verification.
- **Issue:** Multiple tests used the same process-scoped fixture name while Rust ran them concurrently.
- **Fix:** Give each index test its own uniquely named temporary fixture directory.
- **Files modified:** `crates/vault/tests/index.rs`.
- **Verification:** All four index integration tests passed.
- **Committed in:** `2175a60`.

**2. Link path generation did not strip uppercase `.MD` consistently.**
- **Found during:** Task 3 review.
- **Issue:** `strip_suffix(".md")` was case-sensitive despite vault note names being case-insensitive.
- **Fix:** Add a shared ASCII case-insensitive `.md` suffix stripper and cover `UPPER.MD`.
- **Files modified:** `crates/vault/src/index.rs`, `crates/vault/tests/index.rs`.
- **Verification:** Full vault tests passed; app build passed.
- **Committed in:** `8a758b4`.

**Total deviations:** 2 auto-fixed.
**Impact on plan:** Both fixes improve deterministic tests and case-insensitive path behavior within scope.

## Issues Encountered

- None remaining. The initial temporary-directory collision was resolved before final verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 04 can build on the scan/index model and fixture vault. The full vault test suite and app build pass.

---
*Phase: 01-vault-model*
*Completed: 2026-10-22*
