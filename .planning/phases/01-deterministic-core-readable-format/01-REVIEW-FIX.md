---
phase: 01-deterministic-core-readable-format
fixed_at: 2026-09-09T20:32:17Z
review_path: .planning/phases/01-deterministic-core-readable-format/01-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-09-09T20:32:17Z
**Source review:** `.planning/phases/01-deterministic-core-readable-format/01-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 8
- Fixed: 8
- Skipped: 0

## Fixed Issues

### CR-01: Decoder rejects inline text containing consecutive spaces

**Status:** fixed: requires human verification
**Files modified:** `tapestry/kernel/tree/Decoder.cpp`, `tapestry/kernel_tests/codec_test.cpp`
**Commit:** b37fc12
**Applied fix:** Bypassed whole-line tokenization for `set` operations so the quoted value is parsed intact, with regression coverage for consecutive, leading, and trailing spaces and spaced commit messages.

### CR-02: Submit can write records beyond decoder limits

**Status:** fixed: requires human verification
**Files modified:** `tapestry/kernel/Kernel.cpp`, `tapestry/kernel/World.cpp`, `tapestry/kernel/journal/Journal.cpp`, `tapestry/kernel_tests/kernel_test.cpp`
**Commit:** 4c8d666
**Applied fix:** Added early field-size validation and enforced a decode-before-write invariant for commit and header records; oversized lines and record bodies are rejected without changing the journal or world.

### WR-01: Apply corruption leaves journal metadata inconsistent

**Status:** fixed: requires human verification
**Files modified:** `tapestry/kernel/Kernel.cpp`, `tapestry/kernel/journal/Journal.cpp`, `tapestry/kernel/journal/Journal.hpp`, `tapestry/kernel_tests/kernel_test.cpp`
**Commit:** 7489ac4
**Applied fix:** Recorded header and per-commit boundaries and digests, then rolled all journal accessors and save-as state back to the last applied commit when replay marks a commit corrupt.

### WR-02: Escaped NUL reaches the world after decode

**Status:** fixed
**Files modified:** `tapestry/kernel/Value.cpp`, `tapestry/kernel_tests/value_test.cpp`, `tapestry/kernel_tests/codec_test.cpp`
**Commit:** a92b6d7
**Applied fix:** Rejected code point zero during Unicode escape decoding and added value- and codec-level regressions for `\\u0000`.

### WR-03: Decoder accepts non-canonical forms

**Status:** fixed: requires human verification
**Files modified:** `tapestry/kernel/Value.cpp`, `tapestry/kernel/tree/Decoder.cpp`, `tapestry/kernel_tests/value_test.cpp`, `tapestry/kernel_tests/codec_test.cpp`
**Commit:** 638a19d
**Applied fix:** Enforced canonical inline values, `branch main`, non-empty canonical messages, correct inline/block selection, canonical delimiters, and byte-identical record re-encoding.

### WR-04: Failed creation leaves orphaned files

**Status:** fixed
**Files modified:** `tapestry/kernel/journal/Sink.cpp`, `tapestry/kernel/journal/Journal.cpp`, `tapestry/kernel/journal/Journal.hpp`, `tapestry/kernel/Kernel.hpp`
**Commit:** 4409e28
**Applied fix:** Closed and removed newly-created journal, save-as, and repair-sidecar files when directory sync, write, or file sync fails, and documented the cleanup contract.

### WR-05: Locale test fails when a specific locale is unavailable

**Status:** fixed
**Files modified:** `tapestry/kernel_tests/value_test.cpp`
**Commit:** 217a9c8
**Applied fix:** Tried common German and French comma-decimal locale names and visibly skipped only the locale-dependent assertions when none is installed.

### WR-06: Journal tick expectation wraps on overflow

**Status:** fixed: requires human verification
**Files modified:** `tapestry/kernel/journal/Journal.cpp`, `tapestry/kernel_tests/journal_test.cpp`
**Commit:** 60f61ba
**Applied fix:** Detected tick overflow during scan before accepting the offending commit and kept the verified prefix metadata aligned with the last safe commit.

## Verification

Verification ran in the isolated review-fix worktree, not the main checkout:
`/Users/kaelencook/Tapestry/.claude/worktrees/rf-01-6253-1788985009`.

- Incremental CMake builds passed after every finding.
- Finding-focused doctest cases passed after every finding.
- Final integrated `ctest --test-dir .build-review-fix --output-on-failure`: 55/55 tests passed.
- `git diff --check` passed for every fix before commit.

---

_Fixed: 2026-09-09T20:32:17Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
