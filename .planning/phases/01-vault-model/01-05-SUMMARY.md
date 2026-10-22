---
phase: 01-vault-model
plan: 05
subsystem: vault
tags: [rust, watcher, obsidian-grammar, vault-check]

requires:
  - phase: 01-vault-model
    provides: Store commands, hash classification, scanner and index
provides:
  - notify-based canonical-root watcher with NoCache and relative Markdown routing
  - Store stat-diff fallback rescan for external edits and removals
  - independent YAML/regex grammar tests across Store-generated notes
  - read-only vault-check report CLI
affects: [phase-1-closeout, shell, knowledge-tree]

tech-stack:
  added: [notify 8.2.0, notify-debouncer-full 0.7.0, regex 1.13.1 dev]
  patterns: [event paths and stat diffs feed hash classification, before/after stat snapshots for read-only CLI]

key-files:
  created:
    - crates/vault/src/watch.rs
    - crates/vault/tests/watch.rs
    - crates/vault/tests/grammar.rs
    - crates/vault/src/bin/vault-check.rs
  modified:
    - crates/vault/Cargo.toml
    - Cargo.lock
    - crates/vault/src/store.rs
    - crates/vault/src/lib.rs

key-decisions:
  - "The watcher uses NoCache to avoid a file-id walk and watches the canonical root; event kinds do not determine change identity."
  - "The fallback compares file stats to find candidates, then Store hashes classify changes and suppress own writes."
  - "The sandbox runner did not deliver native file events even to a direct RecommendedWatcher; watcher tests exercised Store::rescan after their event deadline and logged this limitation."
  - "vault-check remains read-only and reports non-strict content problems while strict mode fails on invalid frontmatter or unresolved links."

requirements-completed: [VAULT-06, LINK-05]

verification:
  - "cargo test -p tapestry-vault --test watch --offline — passed 3 consecutive runs; each completed in 10.71s. The runner emitted no native events, so the two live scenarios reached the documented Store::rescan recovery path."
  - "cargo test -p tapestry-vault --test grammar --offline -- --nocapture — passed (2 tests); generated vault: /Users/kaelencook/Tapestrees/core/target/tmp/obsidian-check."
  - "vault-check fixture copy — exit 0, modified: 0; 13 resolved, 2 ambiguous, 1 unresolved, and one invalid-frontmatter sample were reported."
  - "vault-check world/notes copy — exit 0, modified: 0."
  - "cargo test -p tapestry-vault -p tapestry-canvas -p tapestry-canvas-app --offline -q — passed."
  - "cargo build -p tapestry-canvas-app --offline — passed."

duration: 35min
completed: 2026-10-22
status: complete
---

# Phase 1 Plan 5: Watcher, independent grammar check, and vault CLI

Phase 1 now has a filesystem watcher with hash-based own-write suppression, a stat-diff recovery path, an independent Obsidian grammar test, and a read-only vault diagnostic command.

## Accomplishments

- Added a debounced `notify` adapter using `NoCache`, canonical roots, filtered relative `.md` paths, and rescan/error messages.
- Added `Store::rescan`, which diffs metadata, routes changed candidates through the existing hash classifier, and returns external edits and removals.
- Added watcher and fallback tests. All three watcher tests passed in three runs (10.71 seconds each). This runner delivered no native file events to either the adapter or a direct `RecommendedWatcher`; the two live scenarios therefore verified the fallback recovery path. Native FSEvents delivery still needs validation on a host that provides it.
- Added a grammar checker that uses only `regex` and `yaml_serde` within its checker module. It rejects malformed properties, block refs, and aliases, and checks files written by Store commands including BOM and CRLF examples.
- Added `vault-check`, which reports scan/link/frontmatter/layout issues and detects modifications through before/after stat snapshots.
- Logged the real Obsidian review with the exact generated vault path in the git-excluded `.context/HUMAN-QUESTIONS.md`.

## Task Commits

1. `80c81ed` — watcher and fallback rescan.
2. `16074ee` — independent grammar check and read-only CLI.

## Deviations and Limitations

- The first phase verification interpreted “every vault change” as requiring layout and external-content snapshots in the event log. The existing VAULT-05 contract and D-10 scope journal entries to Tapestry-originated create, link, card, and estimated-time events. The phase boundary and roadmap goal now state that scope explicitly; watcher detection remains separate and does not copy external note contents into the journal.
- Native event delivery is unavailable in this sandboxed macOS runner, including for a direct `RecommendedWatcher` probe. The watcher implementation compiled and the tests verify recovery and own-write suppression, but this environment cannot demonstrate the native notification path. Keep the periodic rescan wired in Phase 2 and validate native delivery on a normal macOS host.

## Next Phase Readiness

- Phase 1 implementation gates are green. Phase verification should inspect the native watcher limitation and then advance to Phase 2 planning.
- The nonblocking real-Obsidian check is pending in `.context/HUMAN-QUESTIONS.md`.

---
*Phase: 01-vault-model*
*Completed: 2026-10-22*
