---
phase: 01-vault-model
plan: 01
subsystem: vault
tags: [rust, vault, frontmatter, yaml_serde, tracer, atomic-write, journal]

requires: []
provides:
  - "crates/vault (package tapestry-vault): egui-free, network-free vault crate in the workspace"
  - "frontmatter: split, read_layout (lenient), splice_layout (byte-exact), ensure_created, format_num, post-edit verify guard"
  - "scan (thin, read-only walk) and index (VaultIndex::build with folder/title/frontmatter status/layout)"
  - "store: Store single writer with check_rel, symlink refusal, atomic temp+fsync+rename+dir fsync, VaultCmd::{CreateNote, SetLayout}"
  - "journal: <vault>/.tapestry/journal.jsonl append/read, Event::NoteCreated"
  - "time: now_ms, iso_utc, parse_created"
affects: [01-02, 01-03, 01-04, 01-05, phase-02-vault-host, phase-03-canvas, phase-06-replay]

actuals:
  tokens: 14900
  tasks: 2
  commits: 3
plan_head_before: 8932410039887afd17ee537adae7d4f8cf348603

tech-stack:
  added: [yaml_serde 0.10.7, libyaml-rs 0.3.0 (transitive)]
  patterns:
    - "Pure &str -> Result<Option<String>> transforms; Ok(None) means no write"
    - "Every successful splice is re-parsed and compared key by key before it is returned"
    - "All writes through Store::apply on fresh disk bytes; atomic temp file named .{name}.tapestry-{pid}-{n}.tmp"
    - "Byte-sensitive tests as string literals, never fixture files"

key-files:
  created:
    - crates/vault/Cargo.toml
    - crates/vault/src/lib.rs
    - crates/vault/src/frontmatter.rs
    - crates/vault/src/scan.rs
    - crates/vault/src/index.rs
    - crates/vault/src/store.rs
    - crates/vault/src/journal.rs
    - crates/vault/src/time.rs
    - crates/vault/tests/common/mod.rs
    - crates/vault/tests/tracer.rs
    - crates/vault/tests/frontmatter.rs
  modified:
    - Cargo.lock

key-decisions:
  - "Splice refuses rather than guesses: a key found on zero or several top-level lines, or with its value on the next line, is KeyNotSpliceable; a non-numeric value is Conflict"
  - "A null app key (`x:` or `x: # c`) is filled in place (`x: 5 # c`)"
  - "No-op compares format_num of old and new, so `x: 10.04` set to 10 leaves the file untouched"
  - "Store refuses any write whose folder path passes through a symlink (checked before create_dir_all)"

patterns-established:
  - "Verify guard: written keys must read back as format_num(value); every other key must keep its exact yaml Value; no unexpected keys"
  - "Store tests inject a fixed clock (FIXED_MS = 2026-10-21T10:11:12 UTC)"

requirements-completed: [VAULT-03, VAULT-04]

coverage:
  - id: D1
    description: "Tracer: scan a temp vault, index reads x/y from frontmatter, Store writes a layout into a note without frontmatter, creates a note stamped created:, journals one note_created line, rescan shows the new layout, no temp files left"
    requirement: VAULT-04
    verification:
      - kind: integration
        ref: "crates/vault/tests/tracer.rs#layout_round_trip_through_store"
        status: pass
    human_judgment: false
  - id: D2
    description: "Layout read from frontmatter as numbers or numeric strings; .inf/.nan/null ignored; non-numeric values reported as conflicts"
    requirement: VAULT-03
    verification:
      - kind: unit
        ref: "crates/vault/tests/frontmatter.rs#read_layout_is_lenient"
        status: pass
    human_judgment: false
  - id: D3
    description: "Byte-exact splice of x/y/w/h/world-x/world-y/world-scale on CRLF, BOM, empty, comment-only, no-frontmatter, no-trailing-newline, HR-body, block-scalar, quoted and unknown-key notes"
    requirement: VAULT-04
    verification:
      - kind: unit
        ref: "crates/vault/tests/frontmatter.rs (21 golden and no-op tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Unparseable frontmatter (invalid YAML, duplicate key, tab indent, unterminated, '...', non-mapping, over 64 KB) is never rewritten; Store leaves bytes and mtime identical"
    requirement: VAULT-04
    verification:
      - kind: unit
        ref: "crates/vault/tests/frontmatter.rs#invalid_yaml_is_unparseable, unterminated_is_unparseable, dots_terminator_is_unparseable, non_mapping_is_unparseable, oversized_frontmatter_is_never_parsed"
        status: pass
      - kind: integration
        ref: "crates/vault/tests/frontmatter.rs#store_never_rewrites_unparseable"
        status: pass
    human_judgment: false
  - id: D5
    description: "created: format and time helpers (iso_utc, parse_created, civil round trip)"
    verification:
      - kind: unit
        ref: "cargo test -p tapestry-vault --lib time::"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-10-22
status: complete
---

# Phase 1 Plan 01: Vault crate tracer and byte-exact frontmatter splice Summary

**New `tapestry-vault` crate: read-only scan, frontmatter index, a single atomic Store writer and a JSONL journal, proven end to end by one tracer test, plus a yaml_serde-guarded line splice that changes only the app's own key values on any Obsidian note shape and refuses to touch frontmatter it cannot parse.**

## Performance

- **Duration:** about 8 min
- **Started:** 2026-10-22T05:45:46Z
- **Completed:** 2026-10-22T05:53:11Z
- **Tasks:** 2
- **Files modified:** 12 (11 created, Cargo.lock modified)

## Accomplishments
- `crates/vault` builds as a workspace member with no root `Cargo.toml` edit; it depends only on yaml_serde, serde and serde_json (Cargo.lock gained only `tapestry-vault`, `yaml_serde` and `libyaml-rs`).
- The tracer test runs the whole path on real files: scan, index, `SetLayout` into a note with no frontmatter, a repeat `SetLayout` that writes nothing, `CreateNote` with `created: 2026-10-21T10:11:12`, exactly one journal line `{"t":1792577472000,"kind":"note_created","path":"C.md"}`, rescan, and no temp files left.
- The frontmatter splice is byte-exact across 33 literal cases. Every successful edit is re-parsed and compared key by key, so `SpliceError::Verify` fires before any drifted text could reach disk.
- Notes the splice cannot handle safely are refused with a typed error, and the Store leaves their bytes and mtime unchanged. That covers invalid YAML, duplicate keys, tab indents, unterminated frontmatter, a `...` terminator, non-mapping YAML, frontmatter over 64 KB, flow mappings, quoted keys, values on the next line and non-numeric values.

## Task Commits

1. **Task 1: Tracer (scan, read layout, write layout and create a note through the single Store, journal it, rescan)**: `c4474ec` (feat)
2. **Task 2: Byte-exact frontmatter splice for every Obsidian note shape; unparseable never rewritten** (TDD):
   - RED `5239284` (test): 33-case matrix, 7 failing against the tracer implementation
   - GREEN `94fd379` (feat): all 33 passing

**Plan metadata:** see the docs(01-01) commit that adds this file

## Files Created/Modified
- `crates/vault/Cargo.toml`: package `tapestry-vault`, workspace edition and license
- `crates/vault/src/lib.rs`: crate doc (no UI, no network, one write door) and root re-exports
- `crates/vault/src/frontmatter.rs`: `split`, `body_start`, `read_layout`, `splice_layout`, `ensure_created`, `format_num`, verify guard
- `crates/vault/src/scan.rs`: read-only recursive walk, sorted, symlinks and dot or `SKIP` names skipped
- `crates/vault/src/index.rs`: `VaultIndex::build` with folder, title, `FmStatus` and `Layout` per note
- `crates/vault/src/store.rs`: `Store`, `VaultCmd`, `Outcome`, `WriteError`, `check_rel`, atomic writer
- `crates/vault/src/journal.rs`: `Entry`/`Event` (serde tag `kind`), `append`, tolerant `read`
- `crates/vault/src/time.rs`: `now_ms`, `iso_utc`, `parse_created`, Hinnant `civil` and its inverse
- `crates/vault/tests/common/mod.rs`: `temp_dir`, `FIXED_MS`, `fixed_clock`, `no_temp_files`
- `crates/vault/tests/tracer.rs`: `layout_round_trip_through_store`
- `crates/vault/tests/frontmatter.rs`: golden splice matrix, refusal cases and `store_never_rewrites_unparseable`
- `Cargo.lock`: adds `tapestry-vault`, `yaml_serde`, `libyaml-rs`

## Decisions Made
- **Refuse rather than guess.** A key is spliced only when exactly one column-0 line holds it as a plain key with its value on that line. Anything else returns `KeyNotSpliceable`, and a non-numeric value returns `Conflict`.
- **Null app keys are filled in place.** `x:` becomes `x: 5`, and `x: # later` becomes `x: 5 # later`.
- **The no-op check compares rounded text** (`format_num`). A value that is already equal after rounding produces no write, which keeps the mtime unchanged.
- **`created` is read as text.** A numeric `created` is converted to its string form. The value is never overwritten.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] Store refuses writes through a symlinked folder**
- **Found during:** Task 1 (store.rs)
- **Issue:** `check_rel` stops `..` and absolute paths, but a symlinked folder inside the vault (for example `~/Tree` links `.planning`) would still let `SetLayout` or `CreateNote` write outside the root. `create_dir_all` could also create folders through such a link (T-1-01).
- **Fix:** `Store::check_inside` checks every existing folder component from the root with `symlink_metadata` and returns `WriteError::Symlink` if any is a symlink. `CreateNote` runs this check before `create_dir_all`.
- **Files modified:** crates/vault/src/store.rs
- **Verification:** the tracer and `store_never_rewrites_unparseable` pass; the symlink-specific store tests come in plan 04/05.
- **Committed in:** c4474ec

**2. [Rule 2 - Robustness] Journal reader is lossy on invalid UTF-8**
- **Found during:** Task 1 (journal.rs)
- **Issue:** `read_to_string` would fail the whole read if a torn tail split a multi-byte character, which goes against "the reader never fails vault open".
- **Fix:** read the bytes and decode with `String::from_utf8_lossy`, then skip lines that do not deserialize.
- **Files modified:** crates/vault/src/journal.rs
- **Committed in:** c4474ec

**3. [Process] Task 2 committed as RED then GREEN**
- The plan named one commit for Task 2. Because the task has `tdd="true"`, the tdd reference's gate sequence was followed instead: `test(01-01)` with the failing matrix (7 of 33 red), then `feat(01-01)` with the implementation. Both commits are pathspec-only.

---

**Total deviations:** 2 auto-fixed (Rule 2) plus 1 process note.
**Impact on plan:** These hardenings stay within the threat register's intent. No public signature from the interfaces block changed.

## TDD Gate Compliance
- RED: `5239284` test(01-01). `cargo test --test frontmatter` showed 26 passed and 7 FAILED: dots_terminator, null_value, non_numeric conflict, read_layout_is_lenient, unchanged no-op, value_on_next_line, oversized.
- GREEN: `94fd379` feat(01-01). 33 of 33 pass.
- REFACTOR: none needed.

## Issues Encountered
None.

## Verification
- `cargo build -p tapestry-vault`: exit 0
- `cargo test -p tapestry-vault`: lib 8 passed, tracer 1 passed, frontmatter 33 passed
- `cargo build -p tapestry-canvas-app`: exit 0
- `cargo clippy -p tapestry-vault --all-targets`: no warnings
- `git show --stat` on c4474ec, 5239284 and 94fd379 lists only `crates/vault/**` and `Cargo.lock`

## User Setup Required
None. No external service configuration is required.

## Next Phase Readiness
- Plans 01-02 to 01-05 can build on the exact interface names (`frontmatter::*`, `Scan`/`ScannedNote`, `VaultIndex`/`NoteMeta`, `Store`/`VaultCmd`/`Outcome`/`WriteError`, `journal::*`, `time::*`).
- `scan` is still thin: no size or entry caps and no skipped list yet. `NoteStatus::TooLarge` exists but is never produced. Plan 03 completes this.
- Assumption A1 (naive UTC `created:` display in Obsidian) is still open and is logged by plan 05.

---
*Phase: 01-vault-model*
*Completed: 2026-10-22*

## Self-Check: PASSED

All 11 created files exist; commits c4474ec, 5239284, 94fd379 found.
