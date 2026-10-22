---
phase: 01-vault-model
verified: 2026-10-22T07:43:52Z
status: passed
score: 6/8 must-haves verified
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/01-vault-model/01-01-PLAN.md
  - .planning/phases/01-vault-model/01-01-SUMMARY.md
  - .planning/phases/01-vault-model/01-02-PLAN.md
  - .planning/phases/01-vault-model/01-02-SUMMARY.md
  - .planning/phases/01-vault-model/01-03-PLAN.md
  - .planning/phases/01-vault-model/01-03-SUMMARY.md
  - .planning/phases/01-vault-model/01-04-PLAN.md
  - .planning/phases/01-vault-model/01-04-SUMMARY.md
  - .planning/phases/01-vault-model/01-05-PLAN.md
  - .planning/phases/01-vault-model/01-05-SUMMARY.md
  - .planning/phases/01-vault-model/01-CONTEXT.md
  - Cargo.lock
  - apps/canvas/Cargo.toml
  - apps/canvas/src/ide.rs
  - crates/vault/Cargo.toml
  - crates/vault/src/bin/vault-check.rs
  - crates/vault/src/blocks.rs
  - crates/vault/src/frontmatter.rs
  - crates/vault/src/index.rs
  - crates/vault/src/journal.rs
  - crates/vault/src/layout.rs
  - crates/vault/src/lib.rs
  - crates/vault/src/links.rs
  - crates/vault/src/scan.rs
  - crates/vault/src/store.rs
  - crates/vault/src/time.rs
  - crates/vault/src/watch.rs
  - crates/vault/tests/blocks.rs
  - crates/vault/tests/common/mod.rs
  - crates/vault/tests/fixtures/obsidian-sample/.obsidian/hidden.md
  - crates/vault/tests/fixtures/obsidian-sample/.obsidian/workspace.json
  - crates/vault/tests/fixtures/obsidian-sample/Blocks.md
  - crates/vault/tests/fixtures/obsidian-sample/Broken.md
  - crates/vault/tests/fixtures/obsidian-sample/Links.md
  - crates/vault/tests/fixtures/obsidian-sample/Other/Notes.md
  - crates/vault/tests/fixtures/obsidian-sample/Sub/Deep/Leaf.md
  - crates/vault/tests/fixtures/obsidian-sample/Topic/Notes.md
  - crates/vault/tests/fixtures/obsidian-sample/Topic/Topic.md
  - crates/vault/tests/fixtures/obsidian-sample/Welcome.md
  - crates/vault/tests/fixtures/obsidian-sample/no-frontmatter/2026-10-09-0726-15.md
  - crates/vault/tests/fixtures/obsidian-sample/no-frontmatter/2026-10-09-0822-48.md
  - crates/vault/tests/frontmatter.rs
  - crates/vault/tests/grammar.rs
  - crates/vault/tests/index.rs
  - crates/vault/tests/links.rs
  - crates/vault/tests/scan.rs
  - crates/vault/tests/store.rs
  - crates/vault/tests/tracer.rs
  - crates/vault/tests/watch.rs
covered_digest: "v1:sha256:6ef2f89c27832d37f68b863623b64bd09738da117b83c836434ba6f28db74225"
behavior_unverified: 2
overrides_applied: 0
re_verification:
  previous_status: passed
  previous_score: 6/8
  gaps_closed:
    - "The journal-scope finding remains resolved by the revised roadmap and context: Tapestry-originated events are journaled; outside contents are not snapshotted."
  gaps_remaining: []
  regressions: []
decision_coverage:
  honored: 11
  total: 11
  not_honored: []
behavior_unverified_items:
  - truth: "Native filesystem notification delivery detects outside edits and suppresses app writes."
    test: "On a host delivering native FSEvents, make an outside edit to a tracked note and observe WatchMsg::Changed followed by Change::External; also confirm a Store write is not classified External."
    expected: "Native notification delivery detects the outside edit without relying on Store::rescan; app-owned writes remain OwnEcho/Unchanged."
    why_human: "This sandbox delivered no native events to the adapter or a direct RecommendedWatcher probe. The live tests fell back to Store::rescan and prove recovery only."
  - truth: "Store-written notes open cleanly in Obsidian with properties, block references, and aliases interpreted as intended."
    test: "Open /Users/kaelencook/Tapestrees/core/target/tmp/obsidian-check in Obsidian and inspect the notes listed in .context/HUMAN-QUESTIONS.md."
    expected: "Properties appear correctly and generated block refs and aliases resolve without Obsidian parse warnings."
    why_human: "The independent regex/YAML checker does not run Obsidian's parser or UI."
---

# Phase 1: Vault model Verification Report

**Phase Goal:** A vault of plain `.md` notes can be scanned, indexed, linked and written by a headless crate without corrupting notes; Tapestry-originated note, link, and card events are journaled for growth replay, while outside edits are detected by the watcher and fallback scan.
**Verified:** 2026-10-22T07:43:52Z
**Status:** passed, with two non-blocking behavior-unverified items
**Re-verification:** Yes — revised phase scope closes the prior journal-coverage gap

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Scanning treats visible Markdown files as notes and folders as graphs, skips ignored paths and symlinks, and is read-only. | ✓ VERIFIED | `scan.rs` uses file-type/metadata checks, skips dot and configured directories and symlinks, and records skipped paths. The fixture CLI reported `modified: 0`; scan tests passed in the previous combined run. |
| 2 | Layout reads and writes preserve unrelated bytes, rejects invalid frontmatter, and computes unpersisted placement for unpositioned cards. | ✓ VERIFIED | Byte-range splicing and `layout::place_free` are wired through the index/Store. Golden frontmatter, scan, index, and Store tests passed in the prior combined run. |
| 3 | Wikilinks parse with byte spans and exclusions; block anchors and the described-link builder preserve/reuse IDs and descriptions. | ✓ VERIFIED | `links.rs` and `blocks.rs` implement the parser, masking, anchors, and builder; `apps/canvas/src/ide.rs` delegates to the shared parser. Link/block tests passed. |
| 4 | Cross-folder resolution, ambiguity, block metadata, and backlinks are provided by the index. | ✓ VERIFIED | `VaultIndex::build` wires links, blocks, and placement. Fixture CLI reported 13 resolved, 2 ambiguous, and 1 unresolved links; index tests passed. |
| 5 | Store writes are serialized and atomic; Tapestry-originated create, link, card, and legacy-estimate events are journaled. | ✓ VERIFIED | Store commands route through one writer. `Event` and its append sites cover note creation/estimation, link add/remove, and card keep/dismiss. Store/tracer tests passed. Layout and outside note contents are outside this journal scope per the revised context. |
| 6 | Outside edits and removals are detected by the fallback rescan, and app writes are suppressed. | ✓ VERIFIED | Re-ran `cargo test -p tapestry-vault --offline --test watch fallback_rescan_detects_external_edit -- --exact`: 1 passed. The test asserts an outside edit is External, a Store write is not emitted, and deletion is Removed. |
| 7 | Native notification delivery detects outside edits and suppresses app writes. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Native event delivery was unavailable to the sandbox runner, including a direct `RecommendedWatcher` probe. The live test's fallback must not be read as proof of native delivery. |
| 8 | Store-written notes open cleanly in actual Obsidian. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The independent grammar test passed, but no Obsidian runtime/parser was exercised; the real app check is logged as non-blocking in `.context/HUMAN-QUESTIONS.md`. |

**Score:** 6/8 truths verified (2 present, behavior-unverified)

The earlier journal gap is closed by the revised contract, not by a code change: the updated roadmap and `01-CONTEXT.md` say journal entries cover Tapestry-originated create/link/card/estimated events, and external contents are deliberately not copied into the journal. The watcher and fallback still report external changes to the host for later handling.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `frontmatter.rs`, `scan.rs`, `layout.rs`, `index.rs` | Lossless parsing/splicing, read-only walk, deterministic placement, index | ✓ VERIFIED | Substantive implementations; integration tests passed. |
| `links.rs`, `blocks.rs` | Wikilink parsing/building and block IDs | ✓ VERIFIED | Substantive parser and anchor logic; parser/anchor tests passed. |
| `store.rs`, `journal.rs`, `tests/store.rs` | Serialized writer, commands, classification, scoped journal | ✓ VERIFIED | Required Tapestry-originated event types and append paths are present; the corrected Plan 04 summary reference `[crates/vault/tests/store.rs]` resolves to the integration test file. External note contents intentionally are not snapshotted. |
| `watch.rs`, `tests/watch.rs` | Debounced watcher and stat-diff recovery | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Native watcher setup/routing is present; this runner only proved fallback recovery. |
| `tests/grammar.rs` | Independent regex/YAML check over Store outputs | ✓ VERIFIED | Checker is separate from crate parsers and tests valid/invalid samples plus Store-generated notes. |
| `src/bin/vault-check.rs` | Read-only scan/index diagnostic CLI | ✓ VERIFIED | Fixture run reported expected link diagnostics and `modified: 0`. |
| `tests/fixtures/obsidian-sample/` | Multi-folder fixture vault | ✓ VERIFIED | Present and used by scan/index tests and CLI. |

### Key Link Verification

All plan-declared source links passed `gsd-tools query verify.key-links`. Plan 01-03's artifact query cannot treat its fixture directory as a file; the directory and its fixtures were checked directly.

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `store.rs` | `frontmatter.rs`, `journal.rs` | fresh-read splice and event append | ✓ WIRED | Plan 01-01 key-link checks passed. |
| `ide.rs` | `links.rs` | `wikilinks()` calls shared `targets()` | ✓ WIRED | Plan 01-02 check passed. |
| `links.rs`, `blocks.rs` | frontmatter/fence parser | frontmatter exclusion and shared fence detection | ✓ WIRED | Plan 01-02 checks passed. |
| `index.rs` | `links.rs`, `layout.rs`, `blocks.rs` | parse, placement, block indexing | ✓ WIRED | Plan 01-03 checks passed. |
| `store.rs` | `blocks.rs`, `links.rs`, `journal.rs`, `layout.rs` | anchor/link commands, events, hash classification | ✓ WIRED | Plan 01-04 checks passed. |
| `watch.rs` | `notify_debouncer_full` | `RecommendedWatcher` + `NoCache` on canonical root | ✓ WIRED | Plan 01-05 check passed. |
| `watch.rs` tests | `Store::classify` / `Store::rescan` | Changed/Rescan dispatch | ✓ WIRED | Both branches are exercised by test code; native callback behavior remains unverified. |
| `store.rs` | `scan.rs` | stat-tree fallback candidates | ✓ WIRED | `rescan()` diffs `stat_tree` and classifies changed paths. |
| `grammar.rs` | `regex`, `yaml_serde` | independent grammar checks | ✓ WIRED | Dev dependencies and checker use confirmed; checker does not call crate parsers. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `scan.rs` → `index.rs` | notes, folders, text, layout, links | Filesystem reads beneath canonical vault root | Yes | ✓ FLOWING |
| `vault-check.rs` | counts and diagnostics | `scan()` and `VaultIndex::build()` | Yes | ✓ FLOWING |
| `store.rs` → `journal.rs` | event entries | Store commands and clock | Yes, for scoped event types | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Vault/canvas/app regression suite | `cargo test -p tapestry-vault -p tapestry-canvas -p tapestry-canvas-app --offline -q` | Prior verification run exited 0; package tests passed. Two ignored tests belonged to canvas, not the vault tests. Watch target passed via documented fallback. | ✓ PASS |
| App integration build | `cargo build -p tapestry-canvas-app --offline` | Exit 0 in prior verification run. | ✓ PASS |
| Read-only fixture diagnostic | `cargo run -p tapestry-vault --bin vault-check --offline -- crates/vault/tests/fixtures/obsidian-sample` | Exit 0; 10 notes, 6 folders, 13 resolved / 2 ambiguous / 1 unresolved, `modified: 0`. | ✓ PASS |
| Fallback external edit, own-write suppression, and deletion | `cargo test -p tapestry-vault --offline --test watch fallback_rescan_detects_external_edit -- --exact` | Re-run in this verification: 1 passed. | ✓ PASS |
| Native event delivery | Runner evidence | No native events were delivered; live test used rescan fallback. | ⚠️ UNVERIFIED, NON-BLOCKING |

### Test Quality Audit

| Test File | Linked Requirement | Active | Skipped | Circular | Assertion Level | Verdict |
|---|---|---:|---:|---:|---|---|
| `frontmatter.rs`, `tracer.rs` tests | VAULT-03, VAULT-04 | Yes | 0 | No | Byte/value and multi-step behavior | PASS |
| `scan.rs`, `index.rs` tests | VAULT-02, VAULT-03, LINK-04 | Yes | 0 | No | Snapshot/value and resolution behavior | PASS |
| `links.rs`, `blocks.rs` tests | LINK-01, LINK-02, LINK-03 | Yes | 0 | No | Span/value and behavior | PASS |
| `crates/vault/tests/store.rs` | VAULT-05, VAULT-06, LINK-02, LINK-03 | Yes | 0 | No | Multi-step command, journal, filesystem assertions | PASS for scoped behaviors |
| `watch.rs` tests | VAULT-06 | Yes | 0 | No | Fallback behavior; native path not observed | PARTIAL |
| `grammar.rs` tests | LINK-05 | Yes | 0 | No | Independent checker and generated output | PASS for checker; actual Obsidian unverified |

**Disabled vault tests:** 0. **Circular patterns:** 0. **Insufficient assertions:** native notification delivery and real Obsidian compatibility remain unverified; both are non-blocking notes under this autonomous project scope.

### Probe Execution

No phase-declared probes or conventional `scripts/*/tests/probe-*.sh` probes were found.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| VAULT-02 | 01-03 | Read-only scan, skips, no symlink following | ✓ SATISFIED | Scan implementation and tests passed. |
| VAULT-03 | 01-01, 01-03 | Layout read/computed placement | ✓ SATISFIED | Index/layout/frontmatter tests passed. |
| VAULT-04 | 01-01 | Byte-preserving layout writes and invalid-frontmatter refusal | ✓ SATISFIED | Golden and Store tests passed. |
| VAULT-05 | 01-01, 01-04 | `created:` stamp and specified Tapestry-originated event journal | ✓ SATISFIED | Event variants, Store append paths, and tests cover create/link/card/estimated entries. |
| VAULT-06 | 01-04, 01-05 | Single atomic writer, outside change detection, own-write suppression | ✓ SATISFIED | Atomic Store and fallback behavior verified. Native notification delivery remains non-blocking/unverified. |
| LINK-01 | 01-02 | Parser syntax, spans, exclusions | ✓ SATISFIED | Parser tests passed. |
| LINK-02 | 01-02, 01-04 | Stable block anchors and reuse | ✓ SATISFIED | Anchor and Store tests passed. |
| LINK-03 | 01-02, 01-04 | Described-link builder and Store usage | ✓ SATISFIED | Builder wiring and Store tests passed. |
| LINK-04 | 01-03 | Cross-folder resolution and backlinks | ✓ SATISFIED | Index tests and fixture CLI diagnostics. |
| LINK-05 | 01-05 | App-written files open cleanly in Obsidian | ⚠️ PARTIAL, NON-BLOCKING | Independent grammar tests passed; actual Obsidian open remains pending in `.context/HUMAN-QUESTIONS.md`. |

No orphaned Phase 1 requirement IDs were found. Roadmap and plan requirement IDs agree.

### Decision Coverage

The decision coverage query reports all 11 trackable `01-CONTEXT.md` decisions honored (non-blocking gate).

### Advisory (Re-verification)

No new-scope findings were identified.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| — | — | No unreferenced TBD/FIXME/XXX markers, implementation placeholders, or empty production implementations found in phase source/test files. | — | None |

### Non-Blocking Human Verification Items

1. **Native filesystem notification delivery**

   **Test:** On a host that delivers FSEvents, edit a tracked note outside Tapestry and observe the native `Changed` message flow through classification. Also make a Store write.
   **Expected:** The outside edit becomes `External`; the Store write is not reported as `External`, without invoking `Store::rescan` to satisfy the event check.
   **Why human:** The sandbox run emitted no native events even to a direct `RecommendedWatcher` probe. The fallback remains verified and available.

2. **Real Obsidian compatibility**

   **Test:** Open `/Users/kaelencook/Tapestrees/core/target/tmp/obsidian-check` in Obsidian and inspect the generated layout, block anchors, and aliases listed in `.context/HUMAN-QUESTIONS.md`.
   **Expected:** Properties are recognized and block references/aliases resolve cleanly.
   **Why human:** The grammar checker does not invoke Obsidian's parser or UI. This is explicitly non-blocking in `01-CONTEXT.md`.

### Gaps Summary

The revised Phase 1 goal is achieved for its stated boundary. The previous journal finding no longer applies: the revised context requires journaling Tapestry-originated create/link/card/estimated events and explicitly excludes snapshotting outside note contents. Store and the fallback rescan pass their checks. Native watcher delivery and actual Obsidian parsing remain unverified but are recorded as non-blocking items under the autonomous run constraints; this report does not claim they were proven.

---

_Verified: 2026-10-22T07:43:52Z_  
_Verifier: gsd-verifier_
