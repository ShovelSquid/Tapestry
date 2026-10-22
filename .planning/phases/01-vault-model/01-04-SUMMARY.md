---
phase: 01-vault-model
plan: 04
subsystem: vault
tags: [rust, atomic-write, journal, links, security]

requires:
  - phase: 01-vault-model
    provides: read-only scan, block anchors, link parser, index, and layout hash
provides:
  - Serialized Store commands for note, layout, anchor, link, and card changes
  - Same-directory atomic note replacement with path and symlink checks
  - Journal events, one-time creation estimates, and own-write hash classification
affects: [01-vault-model, watcher, canvas, proposals, journal-replay]

actuals:
  tokens: 17612
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns: [fresh-read command validation, atomic same-directory rename, content-hash write classification]

key-files:
  created:
    - crates/vault/tests/store.rs
  modified:
    - crates/vault/src/store.rs
    - crates/vault/src/journal.rs
    - crates/vault/src/lib.rs
    - crates/vault/tests/common/mod.rs
    - crates/vault/tests/tracer.rs

key-decisions:
  - "Store commands validate fresh note bytes and all inputs before their first note write."
  - "Own-write and known states use content hashes, not filesystem timestamps."
  - "Replacing a note atomically preserves permissions and intentionally replaces hard links."

patterns-established:
  - "Stale Tapestry temp cleanup matches the exact generated filename form and skips symlinks and hidden directories."
  - "Pre-existing notes receive one note_estimated journal entry before their first rewrite unless they already have created:."

requirements-completed: [VAULT-05, VAULT-06, LINK-02, LINK-03]
coverage:
  - id: D1
    description: "Atomic writes preserve permissions, refuse bad paths and symlinks, clean matching stale temps, and classify own/external changes by hash."
    requirement: VAULT-06
    verification:
      - kind: integration
        ref: "cargo test -p tapestry-vault --test store -- keeps_permissions"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-vault --test store -- refuses_symlinked_parent"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-vault --test store -- classify_by_hash"
        status: pass
    human_judgment: false
  - id: D2
    description: "Create, layout, folder-world, anchor, add/remove-link, keep, and dismiss commands write through Store with journal records and typed refusals."
    requirement: VAULT-05
    verification:
      - kind: integration
        ref: "cargo test -p tapestry-vault --test store"
        status: pass
      - kind: integration
        ref: "cargo test -p tapestry-vault"
        status: pass
    human_judgment: false
  - id: D3
    description: "Link commands add reusable block anchors, preserve user descriptions, and remove links into readable text."
    requirement: LINK-02
    verification:
      - kind: integration
        ref: "cargo test -p tapestry-vault --test store"
        status: pass
    human_judgment: false
  - id: D4
    description: "The described-link builder is used for on-disk additions and removals, with invalid writes rejected before note changes."
    requirement: LINK-03
    verification:
      - kind: integration
        ref: "cargo test -p tapestry-vault --test store"
        status: pass
      - kind: integration
        ref: "cargo build -p tapestry-canvas-app"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-10-22
status: complete
---

# Phase 1 Plan 4: Atomic Store commands and journal

**Vault changes now pass through a single atomic writer with symlink-safe paths, permission preservation, journal events, and hash-based own-write classification.**

## Performance

- **Duration:** about 13 minutes
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Implemented atomic note writes with `create_new`, file and directory sync, same-directory rename, permission preservation, path validation, and symlink checks.
- Added stale temp cleanup, torn-tail tolerant journal events, one-time `note_estimated` entries, and own-write classification by content hash.
- Routed create, layout, folder-world, anchor, link, keep, and dismiss commands through Store with fresh reads and typed failures.
- Added 20 store integration tests and updated the tracer journal assertion for the new estimate event.

## Task Commits

1. **Tasks 1–2: Atomic writer, journal, and every Store command** - `ea831d3`

The two tasks were committed together because the command implementation and its integration tests share the Store module and its test suite.

**Plan metadata:** this SUMMARY will be committed separately.

## Files Created/Modified

- `crates/vault/src/store.rs` - all vault commands, atomic writes, path checks, estimation, and classification.
- `crates/vault/src/journal.rs` - note, estimate, link, and card event schema.
- `crates/vault/src/lib.rs` - re-exports `Change`.
- `crates/vault/tests/common/mod.rs` - deterministic scripted block ids.
- `[crates/vault/tests/store.rs]` - safety, journal, and command integration tests.
- `crates/vault/tests/tracer.rs` - expects the new estimate event before the first rewrite of a legacy note.

## Decisions Made

- Commands compute against fresh on-disk bytes before writing.
- Own-write classification compares content hashes and ignores unreliable timestamp changes.
- Same-directory rename replaces the note atomically, preserves its permissions, and breaks any hard links to the old inode.

## Deviations from Plan

### Auto-fixed Issues

**1. The existing tracer test encoded the old journal behavior.**
- **Found during:** Plan end-gate verification.
- **Issue:** It expected only `note_created`, but Plan 04 requires a `note_estimated` event before rewriting a pre-existing note without `created:`.
- **Fix:** Updated the regression assertion to check the estimate followed by the new-note event.
- **Files modified:** `crates/vault/tests/tracer.rs`.
- **Verification:** `cargo test -p tapestry-vault --test tracer` passed.
- **Committed in:** `ea831d3`.

**2. A line insertion initially dropped the source line ending.**
- **Found during:** Task 2 tests.
- **Issue:** Appending a link concatenated the following line because the splice omitted the current line ending.
- **Fix:** Preserve the line ending separately from following text for ordinary and table rows.
- **Files modified:** `crates/vault/src/store.rs`.
- **Verification:** Store integration tests and full vault suite passed.
- **Committed in:** `ea831d3`.

**Total deviations:** 2 auto-fixed.
**Impact on plan:** Both changes were required for correct journal expectations and byte-preserving line edits.

## Issues Encountered

- One formatter pass initially touched unrelated module files through `lib.rs`; those formatting-only diffs were reverted. No unrelated source files remain changed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05 can use Store classification and the expanded journal. Vault tests and the canvas app build pass.

---
*Phase: 01-vault-model*
*Completed: 2026-10-22*
