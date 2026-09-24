---
phase: 01-deterministic-core-readable-format
plan: 05
subsystem: kernel
tags: [tree-format, golden-fixture, readability, three-kinds-of-time, edtf, rfc3339, doctest, documentation, c++20]

# Dependency graph
requires:
  - phase: 01-deterministic-core-readable-format (plan 01)
    provides: "FixedClock, RecordedAt, isValidEventTime table in Time.hpp, TAPESTRY_FIXTURE_DIR compile definition, support.hpp helpers"
  - phase: 01-deterministic-core-readable-format (plan 02)
    provides: "Kernel::create/open/submit, the byte-counted block-line codec, the tracer journal shape"
  - phase: 01-deterministic-core-readable-format (plan 03)
    provides: "create-edge / advance / full op set, x- lines, UnsupportedOp, decodeAll-style test helpers"
  - phase: 01-deterministic-core-readable-format (plan 04)
    provides: "Ok / TornTail / Corrupt semantics, explicit repair with the .torn- sidecar, saveAs"
provides:
  - "Kernel-suite proof of TREE-04: recorded / tick / event told apart by name and line position; a correction keeps the earlier value in the earlier record; a backwards wall clock still yields seq 2 chained to seq 1; tick moves only through advance and a mixed advance+edit commit applies at the header tick"
  - "docs/tree/example.tree — the frozen golden world journal (2139 bytes, 6 commits) written by the real kernel under a FixedClock, byte-compared on every test run"
  - "doctest suite `readability` (3 cases, 108 assertions) with buildGoldenWorld() and the TAPESTRY_REGEN_FIXTURE regeneration switch"
  - "docs/tree/FORMAT.md — the human guide to .tree v1: fixture walkthrough, record grammar, value types, three kinds of time with the accepted-shapes table, ids incl. the Phase 3 b2.n12 rule, reader checks, damage classes and repair, limits, integrity-not-authenticity, not-in-v1"
affects: [phase-2-plugin-schemas, phase-2-typescript-reader, phase-3-replay, phase-3-branching, verify-work-uat]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff).
actuals:
  tokens: 13248
  tasks: 3
  commits: 3
  plan_head_before: ceef7ea06dc34b7c0c23b4b47d2cc6146fdee1c4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Golden-fixture test: generate into scratchPath with the production kernel under a FixedClock, compare readFile(scratch) == readFile(TAPESTRY_FIXTURE_DIR \"/example.tree\"); regeneration only when TAPESTRY_REGEN_FIXTURE is set, so drift is always a git diff"
    - "Readability is asserted with literal line needles plus structural counts (countLinesStartingWith) rather than by parsing: header keys start their line, values never do"
    - "Documentation quotes the fixture verbatim and the acceptance check diffs the fenced block against the file line for line"

key-files:
  created:
    - tapestry/kernel_tests/readability_test.cpp
    - tapestry/docs/tree/example.tree
    - tapestry/docs/tree/FORMAT.md
  modified:
    - tapestry/kernel_tests/kernel_test.cpp

key-decisions:
  - "The three-times cases keep a raw FixedClock* alongside the Kernel (createWithClock helper) so a test can move the wall clock forwards or backwards between commits without any kernel API change"
  - "Each of the six golden commits advances the clock by 60 s before submit (commitAfterAMinute), so recorded stamps are 21:16:07Z … 21:21:07Z and every one differs from the world's created stamp"
  - "FORMAT.md documents x- lines exactly as the code behaves: the kernel writes them after the op lines, the reader accepts them anywhere after the fixed header lines and keeps them in order"
  - "doctest MESSAGE/REQUIRE_MESSAGE arguments are bound to std::string locals first, because the macro expands to `mb * expr` and a `std::string(...) + x` expression mis-associates"
  - "countLinesStartingWith is duplicated in the two test files' anonymous namespaces rather than added to support.hpp, which was outside this plan's file list"

patterns-established:
  - "Fixture regeneration switch: TAPESTRY_REGEN_FIXTURE=1 <test binary> -ts=readability rewrites docs/tree/example.tree and reports it in a MESSAGE; the default run compares"
  - "Format documentation lives next to its fixture in tapestry/docs/tree/ and is kept consistent by acceptance greps plus a fence-vs-file diff"

requirements-completed: [TREE-01, TREE-04]

coverage:
  - id: D1
    description: "recorded, tick and event are distinguishable by name and line position; a correction is a new commit that keeps the earlier event value in the earlier record under its own recorded stamp, and the world exposes the corrected value after reopen"
    requirement: TREE-04
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: three kinds of time are distinguishable and a correction keeps both values"
        status: pass
    human_judgment: false
  - id: D2
    description: "recorded is audit-only: a wall clock stepping backwards between commits still yields seq 2 whose parent is commit 1's digest, the file reopens Ok, and the second recorded line is the earlier stamp"
    requirement: TREE-04
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: recorded is audit-only and never orders history"
        status: pass
    human_judgment: false
  - id: D3
    description: "tick changes only through advance and appears in the header: edits keep tick 0, advance 3 applies at tick 0 and the next commit shows tick 3, and a single commit mixing Advance 2 with a SetProperty applies at header tick 3 and leaves the world at tick 5 after reopen"
    requirement: TREE-04
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: tick changes only through advance and appears in the header"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/tree/example.tree is byte-identical to what the kernel writes for the documented six-commit sequence under a FixedClock; it contains every literal readability needle, no escaped-newline sequence, LF only, exactly seven @end lines"
    requirement: TREE-01
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/readability_test.cpp#readability: the golden world matches docs/tree/example.tree byte for byte"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/readability_test.cpp#readability: the fixture reads as text"
        status: pass
      - kind: other
        ref: "grep -c '\\\\n' tapestry/docs/tree/example.tree == 0 && grep -c '^@end sha256:' tapestry/docs/tree/example.tree == 7"
        status: pass
    human_judgment: false
  - id: D5
    description: "The frozen fixture reopens read-only as Ok with 6 commits and rebuilds the same world: n1 event 2026-09-06, n2 anger 4, edge e1 n1→n2 mentions, tick 3, actors human/plugin/system per commit"
    requirement: TREE-01
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/readability_test.cpp#readability: the fixture reopens Ok and equals the generated world"
        status: pass
    human_judgment: false
  - id: D6
    description: "FORMAT.md lets a person with no Tapestry read any v1 .tree file: all twelve sections present, every keyword documented, the fenced fixture matches example.tree line for line, digests stated as integrity not authenticity"
    requirement: TREE-01
    verification:
      - kind: other
        ref: "twelve-heading grep loop + keyword grep (26 hits) + `sed -n 42,109p FORMAT.md | diff - example.tree` (empty)"
        status: pass
    human_judgment: true
    rationale: "Whether the fixture is readable cold — the five questions in Task 3's <human-check> — is a human judgment (RESEARCH A10); it is queued for end-of-phase UAT, and a question that cannot be answered from the file alone is a TREE-01 gap, not a documentation nit"

# Metrics
duration: 9 min
completed: 2026-09-09
status: complete
---

# Phase 01 Plan 05: Three kinds of time, the golden example.tree and FORMAT.md Summary

**The readability promise is now a frozen artifact and a test: the kernel writes the six-commit `example.tree` byte for byte under a fixed clock, three kernel cases prove `recorded` / `tick` / `event` are distinct by name and place and that a correction never erases the earlier value, and `FORMAT.md` walks the fixture record by record so a person with no Tapestry can read any v1 `.tree` file.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-09T08:04:47Z
- **Completed:** 2026-09-09T08:13:05Z
- **Tasks:** 3
- **Files modified:** 4 (3 created, 1 modified; +1070 lines)

## Accomplishments

- **TREE-04 proven through the public kernel API.** A correction (`set n1 event time 2026-09-06` at `recorded …21:16:07Z`) leaves `set n1 event time 2026-09-07` in commit 1 under `…21:15:07Z`; both `recorded` lines and both `tick 0` lines are counted as line-initial keys while `event` never begins a line. Moving the FixedClock *backwards* before commit 2 still produces `seq 2` with `parent == commit 1's digest`, verified both through `Journal::commits()` and independently with the pure codec. Two edits, an `advance 3` and an edit at tick 3 yield exactly four `tick` lines (`0,0,0,3`), and a commit carrying `Advance{2}` plus a `SetProperty` applies at header `tick 3` and leaves `world().tick() == 5` after reopen.
- **The golden fixture exists and is frozen.** `buildGoldenWorld(Kernel&, FixedClock&)` submits the plan's sequence exactly (note → person of an unknown type → plugin-made edge → correction → system advance → message-less edit at tick 3), advancing the clock 60 s before each commit. The first run with `TAPESTRY_REGEN_FIXTURE=1` wrote `tapestry/docs/tree/example.tree` (2139 bytes); every later run regenerates into a scratch file and compares byte for byte. Twenty-six literal needles, the raw two-line body between `<<TEXT` and `TEXT`, zero backslash-n sequences, a single trailing LF, no CR/NUL/tab, and exactly 7 `@end sha256:` lines are asserted on the fixture bytes.
- **The fixture reopens to the same world.** `Kernel::open(fixture, ReadOnly)` is Ok with 6 commits, tick 3, n1's event `2026-09-06`, n2's anger `4`, edge `e1` from `n1` to `n2` labelled `mentions` with `note "first meeting"`, and actors `human kaelen` / `plugin example.people` / `system tapestry` on the right commits.
- **FORMAT.md is complete and code-consistent.** Twelve H2 sections in the required order; the fixture is quoted in full and diffs empty against the file; the accepted `time` shapes table is copied from `Time.hpp`; limits (64 MiB record body, 1 MiB line, RFC 3629 UTF-8, no NUL, LF only), the `.torn-<stamp>` sidecar naming, the seven reader checks plus the x-line-kept / unknown-verb-stops rule, the Phase 3 `b2.n12` branch-tag rule and `fork-of`, and an explicit "integrity, not authenticity" section (T-1-09) are all there.
- **Everything stays green and warning-free:** 49/49 under CTest (`value` 9, `kernel` 14, `codec` 10, `journal` 13, `readability` 3); zero `warning:`/`error:` lines under `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -ffp-contract=off`.

## The frozen `example.tree`

`tapestry/docs/tree/example.tree`, 2139 bytes, exactly as committed in `7cbc743`:

```text
@tree 1 43
world example
created 2026-09-08T21:15:07Z
@end sha256:d8a34e5a4217fb3d4a8d968e7003df018b80bfb71ff2f748a968113455554c90
@commit 1 347
parent sha256:d8a34e5a4217fb3d4a8d968e7003df018b80bfb71ff2f748a968113455554c90
branch main
recorded 2026-09-08T21:16:07Z
tick 0
actor human kaelen
message "first note"
create-node n1 tapestry.notes/note@1
set n1 body text <<TEXT
Met Sam at dinner.
Loves architecture and weird bird memes.
TEXT
set n1 event time 2026-09-07
set n1 title text "Sam"
@end sha256:8d5f947f7b4c3beedc59a6a7d61e18cea52ba7e71e564f328bf75cd2b4d31341
@commit 2 303
parent sha256:8d5f947f7b4c3beedc59a6a7d61e18cea52ba7e71e564f328bf75cd2b4d31341
branch main
recorded 2026-09-08T21:17:07Z
tick 0
actor human kaelen
message "who Sam is"
create-node n2 example.people/person@2
set n2 anger int 3
set n2 name text "Sam"
set n2 position.x real 12.5
set n2 position.y real -3
@end sha256:c1be9108cbbcb96ac7b8fcbbb73a1e2cf7be779bd009ffddb68caf2feb52427c
@commit 3 249
parent sha256:c1be9108cbbcb96ac7b8fcbbb73a1e2cf7be779bd009ffddb68caf2feb52427c
branch main
recorded 2026-09-08T21:18:07Z
tick 0
actor plugin example.people
message "link note to person"
create-edge e1 n1 n2 mentions
set e1 note text "first meeting"
@end sha256:f125ae1531576f1c91823a9546fa6f4cf33cf52a22b4afb7782428dc46a2d3cb
@commit 4 208
parent sha256:f125ae1531576f1c91823a9546fa6f4cf33cf52a22b4afb7782428dc46a2d3cb
branch main
recorded 2026-09-08T21:19:07Z
tick 0
actor human kaelen
message "corrected dinner date"
set n1 event time 2026-09-06
@end sha256:5e7124de89e141504c81c96d7af3a24371a4fc322f263852fefdd675e172084b
@commit 5 189
parent sha256:5e7124de89e141504c81c96d7af3a24371a4fc322f263852fefdd675e172084b
branch main
recorded 2026-09-08T21:20:07Z
tick 0
actor system tapestry
message "advance simulation"
advance 3
@end sha256:1e3c6313f82aa00fc5a82e6b732a3b6919e96d0c9f40eeef5c2de0a3d8035605
@commit 6 166
parent sha256:1e3c6313f82aa00fc5a82e6b732a3b6919e96d0c9f40eeef5c2de0a3d8035605
branch main
recorded 2026-09-08T21:21:07Z
tick 3
actor human kaelen
set n2 anger int 4
@end sha256:8083c729577231f07251d7e8f5d036e13107a020e48be395d15e8eace5ced9a4
```

Things worth noticing for the cold read: initial properties come out in key order (`body`, `event`, `title`), commit 5's own header still says `tick 0` because an advance applies after the commit that carries it, and commit 6 has no `message` line because the message is optional.

## Task Commits

Each task was committed atomically:

1. **Task 1: Three kinds of time are distinguishable and corrections keep history** — `5cca97f` (test)
2. **Task 2: Generate and freeze the golden example.tree with literal readability assertions** — `7cbc743` (feat)
3. **Task 3: FORMAT.md — the human guide to .tree v1** — `b1fd4f5` (docs)

**Plan metadata:** the `docs(01-05)` commit that adds this SUMMARY.

## Files Created/Modified

- `tapestry/kernel_tests/kernel_test.cpp` (modified, +203) — `countLinesStartingWith`, `createWithClock` helpers; three new `TEST_CASE`s under `TEST_SUITE("kernel")` for TREE-04
- `tapestry/kernel_tests/readability_test.cpp` (new, 279 lines) — `TEST_SUITE("readability")`: `buildGoldenWorld`, `commitAfterAMinute`, `generateGoldenBytes`; byte-compare with `TAPESTRY_REGEN_FIXTURE`, literal needles and structural counts, reopen-equals-world
- `tapestry/docs/tree/example.tree` (new, 68 lines / 2139 bytes) — the frozen golden fixture, generated by the kernel, never hand-edited
- `tapestry/docs/tree/FORMAT.md` (new, 520 lines) — the guide: What a .tree file is · Reading example.tree · Record grammar · Value types · Three kinds of time · Identifiers · Branches and ancestry · What the reader checks · When a file is damaged · Limits · Integrity, not authenticity · Not in v1

## Decisions Made

- **Clock handle in tests.** `createWithClock(path, world, FixedClock*&)` hands the test a raw pointer to the clock the kernel owns, so cases can set `clock->at` forwards (correction) or backwards (audit-only) between submits. No kernel API changed.
- **60 s cadence in the golden world.** `commitAfterAMinute` bumps `clock.at.unixSeconds` by 60 before each submit, matching the plan (`recorded 2026-09-08T21:16:07Z` for commit 1) and guaranteeing every stamp differs from `created`.
- **Regeneration is a MESSAGE, not silent.** With `TAPESTRY_REGEN_FIXTURE` set the suite creates `docs/tree/` if needed, rewrites the fixture and reports the path and byte count; the compare still runs afterwards. Without it the default run is compare-only (T-1-17).
- **FORMAT.md follows the code where the plan's wording was looser.** Extension lines: kernel writes them after the ops, reader accepts them anywhere after the fixed header lines. Hand edits: any byte change → `Corrupt` at that record's offset (DigestMismatch), import-as-branch is Phase 3 (PD-05). Locking: one writer via `flock`, read-only opens take no lock. All stated as the code does it.
- **doctest message arguments are locals.** `MESSAGE(std::string("…") + kFixturePath …)` failed to compile because the macro expands to `mb * expr`; binding the message to a `const std::string` first is the clean fix.

## Deviations from Plan

None - plan executed exactly as written. (The one compile error during Task 2 was in freshly written test code — the doctest `MESSAGE` precedence noted above — and was fixed before the task's first verify run; nothing outside the plan's file list was touched.)

## Issues Encountered

None. All three new kernel cases and all three readability cases passed on their first successful build; the fixture generated on the first regeneration run matched the plan's `<golden_world>` sequence line for line.

## Known Stubs

None. Nothing in this plan renders or returns placeholder data; the fixture is real kernel output and the guide documents only what the code does.

## Threat Flags

None new. Plan dispositions applied: T-1-09 (FORMAT.md's "Integrity, not authenticity" section states there is no signature or keyed hash in v1 and that a verified chain is not proof of authorship), T-1-08 (the fixture contains only invented example data; plaintext by design is stated in the same section), T-1-17 (regeneration only when `TAPESTRY_REGEN_FIXTURE` is explicitly set; the default run fails on drift; the fixture is a tracked file so any change is a git diff).

## Deferred Issues

None added. The 01-04 note about `BadEnvelope` offsets for a damaged byte count (see `deferred-items.md`) was not required by this plan and remains deferred; FORMAT.md describes the offset as "the offending bytes" without over-specifying which line an envelope failure names.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Phase 01 is fully planned-and-executed (5/5 plans).** TREE-01 through TREE-04 each have automated coverage; the one human judgment left is Task 3's cold read of `example.tree` (five questions in the plan's `<human-check>`), to be harvested by `/gsd-verify-work 01` at end of phase.
- **For Phase 2 (TypeScript host / plugin SDK):** `FORMAT.md` is the reader's spec and `example.tree` the first conformance fixture — a JS reader that decodes the fixture to the same six commits and verifies all seven digests is the natural first test. The fixture's byte counts and digests are stable as long as the encoder is.
- **For Phase 3 (branching / replay):** the `b2.n12` branch-tag rule and the `fork-of` line are documented in FORMAT.md's Identifiers and Branches sections as "documented, not implemented"; implementing them must keep v1 files (single `main`, unprefixed ids) valid.
- **Regenerating the fixture** is an intentional act: `TAPESTRY_REGEN_FIXTURE=1 tapestry/build-kernel/tapestry_kernel_tests -ts=readability`, then read the diff and commit it with a message that says why the format changed. FORMAT.md's fenced copy (lines 42–109) must be updated in the same commit; the acceptance diff will catch a mismatch.

---
*Phase: 01-deterministic-core-readable-format*
*Completed: 2026-09-09*

## Self-Check: PASSED

- `tapestry/kernel_tests/readability_test.cpp`, `tapestry/docs/tree/example.tree`, `tapestry/docs/tree/FORMAT.md` exist on disk and are git-tracked; `tapestry/kernel_tests/kernel_test.cpp` carries the three new cases.
- Commits `5cca97f`, `7cbc743`, `b1fd4f5` are in `git log`; `git rev-list --count ceef7ea..HEAD` == 3 (matches `actuals.commits`).
- Re-ran every task's `<verify>` and the plan-level `<verification>`: `-ts=kernel` filter 3/3, `-ts=readability` 3/3, `ctest` 100% of 49, fixture `ESCAPED_NEWLINES=0 END_LINES=7`, FORMAT.md twelve headings present, keyword grep 26, fence diff empty.
