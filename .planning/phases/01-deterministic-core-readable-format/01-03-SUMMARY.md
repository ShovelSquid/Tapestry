---
phase: 01-deterministic-core-readable-format
plan: 03
subsystem: kernel
tags: [c++20, tree-format, codec, std-visit, tombstones, utf-8, doctest, tdd, extension-lines, unsupported-op]

# Dependency graph
requires:
  - phase: 01-deterministic-core-readable-format (plan 01)
    provides: "Digest/Ids/Value/Time primitives, doctest runner, support.hpp, the locked block-line .tree v1 format"
  - phase: 01-deterministic-core-readable-format (plan 02)
    provides: "Ops/Record/World/Codec/Journal/Kernel contracts, the tracer path, isValidText, Journal::markCorrupt, set lines decoded as separate ops"
provides:
  - "The complete v1 op vocabulary: UnsetProperty, CreateEdge, DeleteNode, DeleteEdge, Advance join CreateNode/SetProperty in the Op variant; every op struct has a defaulted operator=="
  - "World: edge()/edgeIds()/edgeCount(), wasDeleted() tombstones for node and edge ids, prepare/apply as std::visit with no default branch — edges assigned only in prepare, endpoints/refs must be live, delete-node cascades to touching edges, advance raises tick"
  - "Encoder line forms unset / create-edge (+ set lines in key order) / delete-node / delete-edge / advance; one canonical form, no normalization"
  - "Strict decoder for every verb and value form: BadValue for missing value or unknown type, UnsupportedOp naming verb and seq, InvalidUtf8 at the line holding the bad byte, DigestMismatch at the record offset, TickMismatch named in the detail, x- lines kept verbatim in order"
  - "Journal::scan raises expectedTick from advance ops; Kernel::submit returns CommitResult.edgeIds"
  - "doctest suite `codec` (10 cases, 787 assertions, pure — no file I/O) and 6 new `kernel` cases proving TREE-02 through the public Kernel API"
affects: [01-04, 01-05, FORMAT.md, phase-2-plugin-schemas, phase-3-replay]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff).
actuals:
  tokens: 23218
  tasks: 2
  commits: 3
  plan_head_before: 32e837969a4653385940d7a1a9be26f2ccd80021

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Op visitors are an Overload{lambda...} passed to std::visit with one operator() per alternative and no default — a new verb fails to compile in World::prepare, World::apply and Encoder::appendOp until handled"
    - "Decoder failure offsets: grammar/value failures point at the offending line, InvalidUtf8 at the line holding the bad byte (byte offset in detail), envelope/digest/seq failures at the record's head line"
    - "Diagnostic details carry the enum name and the seq where a JournalStatus.reason will be searched (UnsupportedOp: verb 'x' in commit N; TickMismatch: expected N, found M)"
    - "Tests rewrite one record with the pure codec: decodeAll walks the chain with decodeHeader/decodeCommit, bodyOf/frame re-seal a hand-edited body with an independent sha256, withRecordReplaced splices it back"
    - "TDD in C++ (second use): RED commit carries the headers plus visitor skeletons whose new alternatives are inert, so the suite links and fails on assertions; RED evidence persisted as 01-03-tdd-red-evidence.json"

key-files:
  created:
    - tapestry/kernel_tests/codec_test.cpp
    - .planning/phases/01-deterministic-core-readable-format/01-03-tdd-red-evidence.json
  modified:
    - tapestry/kernel/Ops.hpp
    - tapestry/kernel/World.hpp
    - tapestry/kernel/World.cpp
    - tapestry/kernel/tree/Codec.hpp
    - tapestry/kernel/tree/Encoder.cpp
    - tapestry/kernel/tree/Decoder.cpp
    - tapestry/kernel/journal/Journal.cpp
    - tapestry/kernel/Kernel.cpp
    - tapestry/kernel_tests/kernel_test.cpp

key-decisions:
  - "Decoded records compare equal to their inputs in flattened form: the codec test expands CreateNode/CreateEdge initial props into the same separate SetProperty ops the decoder produces, keeping Plan 02's byte-order rule instead of folding set lines back into the map"
  - "Every op struct (and Actor) gets a C++20 defaulted operator== so std::vector<Op> equality is a one-line assertion; Value already compared reals by bit pattern"
  - "DigestMismatch reports the record's own offset (JournalStatus.offset then names the bad record, not its @end line); InvalidUtf8 reports the line holding the bad byte with the byte offset in the detail, as the plan's behavior asked"
  - "A `set` line with the right shape but no value or an unknown type is BadValue (the value is wrong), a line with the wrong token count or an id/key that does not parse is BadLine (the shape is wrong)"
  - "`advance 0` is refused at decode (BadValue) as well as at prepare (TickZero): the writer never produces it, so a reader treats it as not-an-op rather than replaying a no-op"
  - "World::prepare refuses a text value with any LF-separated line over kMaxLineBytes (World.cpp includes tree/Codec.hpp for the constant) — the writer must never emit bytes its own reader refuses"
  - "Journal::scan's expectedTick hook and CommitResult.edgeIds were completed with the smallest possible edits in Plan 04-owned files (Journal.cpp, Kernel.cpp) because Task 2's reopen-after-advance and create-edge cases cannot pass without them and Plan 04's plan does not cover either"
  - "Ops.hpp's isToken comment example is now example.widgets/gizmo@7 so that no kernel source mentions the test's unknown type acme.widgets/gizmo@7 (Task 2 acceptance criterion)"

patterns-established:
  - "Reader rules are two rules, two tests: x- lines are kept without being read; any other unknown first token stops the load naming the verb and the seq"
  - "Tombstones: DeleteNode/DeleteEdge move ids into std::set<NodeId>/std::set<EdgeId>; a deleted id is below the counter so a CreateNode/CreateEdge naming it is IdOutOfOrder and a ref to it is RefMissing"
  - "The commit that carries an advance applies at the tick before it; only the next commit's tick line shows the move — proven in file bytes (tick 0 / advance 3 / tick 3) and on reopen"

requirements-completed: [TREE-02, TREE-01]

coverage:
  - id: D1
    description: "A commit using every op verb and every value type (text inline and block with delimiter escalation to TEXT1, int, real 0.1, bool, ref, time) plus two x- lines encodes, decodes to the same record and re-encodes byte-identically with a matching digest"
    requirement: TREE-01
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/codec_test.cpp#codec: every op and value type round-trips byte-identically"
        status: pass
    human_judgment: false
  - id: D2
    description: "Text is inline up to 80 bytes and a block beyond that or with a newline; empty text is inline; non-ASCII text round-trips inline and in a block and the @commit byte count is the body's UTF-8 length"
    requirement: TREE-01
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/codec_test.cpp#codec: text is inline up to 80 bytes and a block beyond that or with a newline"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/codec_test.cpp#codec: non-ASCII text round-trips byte-identically and the byte count is UTF-8 length"
        status: pass
    human_judgment: false
  - id: D3
    description: "Strict, offset-carrying diagnostics: InvalidUtf8 (NUL, 0xC3 0x28, inside a block), LimitExceeded (line over 1 MiB; count over 64 MiB from the head line alone), UnsupportedOp naming verb and seq, BadValue for missing value and unknown type, BadLine for tick abc, SeqGap, ChainBreak, DigestMismatch for every flipped body byte, BadValue for an unclosed block, BadEnvelope for a 63-char digest"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/codec_test.cpp#codec: a NUL byte or invalid UTF-8 in the body is InvalidUtf8 at that line"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/codec_test.cpp#codec: a line over kMaxLineBytes or a count over kMaxRecordBytes is LimitExceeded"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/codec_test.cpp#codec: x- lines survive verbatim, unknown verbs stop the load, malformed lines are named"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/codec_test.cpp#codec: seq gaps, chain breaks and any flipped body byte are refused"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/codec_test.cpp#codec: an unclosed block and a short @end digest are refused"
        status: pass
    human_judgment: false
  - id: D4
    description: "World validates every op (RefMissing endpoints, BadValue label, UnknownTarget for missing/deleted targets and keys, TickZero, IdOutOfOrder for deleted ids, DuplicateId for live ones) and applies edges, unset, advance and cascading deletes with tombstoned ids that are never reused"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/codec_test.cpp#codec: the world validates every op and assigns ids only in prepare"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/codec_test.cpp#codec: the world applies edges, cascading deletes, unset and advance with tombstoned ids"
        status: pass
    human_judgment: false
  - id: D5
    description: "A node of type acme.widgets/gizmo@7 (unknown to every kernel source) with title/body/anger/position.x/position.y/pinned/event survives save and reopen with the same id, type string and typed values, each with a readable formatInline form"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: an unknown node type loads with readable typed fallback values"
        status: pass
    human_judgment: false
  - id: D6
    description: "After reopen, n1 is present, deleted n2 and cascaded e1 are absent and tombstoned, new ids are n3/e2, and a set on n2, an edge to n2 or a ref to n2 is rejected"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: ids are stable across reopen and never reused after delete"
        status: pass
    human_judgment: false
  - id: D7
    description: "x- extension lines planted in commit 2 survive reopen verbatim and in order, and a further append; a frobnicate verb makes the load Corrupt naming the verb and commit 2, lastGoodSeq 1, only commit 1's world loaded, submit refused JournalNotClean, file untouched"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: x- extension lines survive reopen verbatim and in order"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: an unsupported op verb stops the load with the verb and seq named"
        status: pass
    human_judgment: false
  - id: D8
    description: "Tick lines follow advance (commits carry tick 0, 0, 3; reopen gives tick 3) and a hand-edited tick 2 with a valid digest is Corrupt with TickMismatch, lastGoodSeq 2"
    requirement: TREE-01
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: tick lines follow advance"
        status: pass
    human_judgment: false
  - id: D9
    description: "A title café ☕ (6 code points, 9 bytes) is written raw with no \\u escapes, the @commit count equals the exact hand-computed body length, and the value reopens byte-identical"
    requirement: TREE-01
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: text is bytes — non-ASCII round-trips and the byte count is UTF-8 length"
        status: pass
    human_judgment: false
  - id: D10
    description: "The kernel builds with zero warning/error lines under the project flags and the full CTest run is 30/30 (value 9, codec 10, kernel 11)"
    requirement: TREE-02
    verification:
      - kind: other
        ref: "cmake --build tapestry/build-kernel && grep -ciE 'warning:|error:' build.log == 0 && ctest --test-dir tapestry/build-kernel → 100% tests passed out of 30"
        status: pass
    human_judgment: false

# Metrics
duration: 17 min
completed: 2026-09-09
status: complete
---

# Phase 01 Plan 03: Full v1 op set, block text and the "unknown data stays readable and safe" guarantees Summary

**The `.tree` v1 grammar is complete and byte-exact in both directions — `unset`, `create-edge`, `delete-node`, `delete-edge` and `advance` join the tracer's two verbs through `std::visit` with no default branch — and TREE-02 is proven through the public `Kernel`: a node type no kernel source knows reopens as readable typed values, `x-` lines survive verbatim, `frobnicate` stops the load naming the verb and the seq, deleted ids are tombstoned and never reused, tick lines follow `advance`, and `café ☕` is nine counted bytes.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-09-09T07:18:56Z
- **Completed:** 2026-09-09T07:35:42Z
- **Tasks:** 2 (Task 1 TDD: RED → GREEN, no refactor needed; Task 2 auto)
- **Files modified:** 11 (1 test file created, 9 kernel/test files modified, 1 RED evidence record)

## Accomplishments

- **Every v1 verb and value form round-trips byte-identically.** One commit with `create-node` (text inline and block, int, real `0.1`, bool, ref, time), `create-edge` with a label and an initial prop, `set … ref`, `unset`, `delete-edge`, `delete-node`, `advance 3` and two `x-` lines encodes to plain lines, decodes to the same record, and `encodeCommit(decoded)` reproduces the original bytes and digest. The body contains a line that is exactly `TEXT`, and the encoder escalates the delimiter to `TEXT1` as the plan required.
- **The reader is strict and every failure says where.** Ten codec cases pin `InvalidUtf8` (NUL, `0xC3 0x28`, inside a block — at the line), `LimitExceeded` (a 1 MiB + 1 line; a 64 MiB + 1 count refused from the head line alone), `UnsupportedOp` (detail names `frobnicate` and the seq), `BadValue` (missing value, unknown type, unclosed block whose delimiter sits outside the counted body), `BadLine` (`tick abc`), `SeqGap`, `ChainBreak`, `DigestMismatch` for *every* flipped byte of a body, and `BadEnvelope` for a 63-character digest.
- **World validates and applies the full set with tombstones.** Edge ids are assigned only in `prepare`; endpoints and refs must be live; labels are one token; `unset` needs the key; `delete-node` cascades to touching edges; `advance` needs ≥ 1 and raises `tick()`; a deleted id is `wasDeleted()`, below the counter, and never handed out again.
- **Unknown plugin data is readable and safe (TREE-02) through the public API.** `acme.widgets/gizmo@7` — a string that appears in no file under `tapestry/kernel` — reopens with id `n1`, the same type and seven typed properties whose `formatInline` forms read `"Gizmo"`, `3`, `12.5`, `-3`, `true`, `2026-09-07`. Two `x-` lines planted in commit 2 survive reopen and a further append; a `frobnicate n1 7` line makes the load `Corrupt` with the verb and `commit 2` in the reason, `lastGoodSeq 1`, only commit 1's node loaded, and `submit` refused `JournalNotClean` with the file untouched.
- **Ids and ticks are consistent between file and world.** After deleting `n2` (which cascades `e1`) and reopening, `n1` is there, `n2`/`e1` are absent and tombstoned, the next ids are `n3`/`e2`, and any reference to `n2` is rejected. Commits carry `tick 0`, `tick 0` (the one holding `advance 3`), `tick 3`; reopen gives `tick() == 3`; a hand-edited `tick 2` with a valid digest is `Corrupt` with `TickMismatch`.
- Build stays warning-free under `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -ffp-contract=off`; CTest is 30/30 (value 9, codec 10, kernel 11; 1,197 assertions in the whole binary).

## Task Commits

Each task was committed atomically:

1. **Task 1: Full op set, block text and strict reader rules in the pure codec** — `48da4e1` (test, RED) → `db84f56` (feat, GREEN); no REFACTOR commit was needed
2. **Task 2: Unknown plugin data stays readable and safe; ids stable across reopen** — `e74211f` (test)

**Plan metadata:** see the `docs(01-03)` commit that adds this SUMMARY.

## Files Created/Modified

- `tapestry/kernel/Ops.hpp` — `UnsetProperty`, `CreateEdge`, `DeleteNode`, `DeleteEdge`, `Advance`; `Op` is the seven-alternative variant; defaulted `operator==` on `Actor` and every op struct; the `isToken` comment example is now `example.widgets/gizmo@7`
- `tapestry/kernel/World.hpp/.cpp` — `edge()`, `edgeIds()`, `edgeCount()`, `wasDeleted(NodeId/EdgeId)`, `std::set` tombstones; `prepare`/`apply` rewritten as `std::visit(Overload{…})` over every alternative (0 `default:` branches); text values with a line over `kMaxLineBytes` refused; tick overflow refused
- `tapestry/kernel/tree/Codec.hpp` — contract comments: the op line forms, the offset each failure reports, set lines decoded as separate ops, `x-` lines kept wherever they appear
- `tapestry/kernel/tree/Encoder.cpp` — `appendOp` as `std::visit(Overload{…})`: `unset <target> <key>`, `create-edge e<k> n<a> n<b> <label>` + `set e<k> …` in key order, `delete-node n<k>`, `delete-edge e<k>`, `advance <n>`
- `tapestry/kernel/tree/Decoder.cpp` — `splitSetLine` tolerates a missing value so it can be named `BadValue`; `parseTarget`; the five new verbs parsed strictly (`advance 0` is `BadValue`); `UnsupportedOp` detail names the verb and the seq; `InvalidUtf8` reports the line holding the bad byte; `DigestMismatch` reports the record offset; `TickMismatch` detail names the reason
- `tapestry/kernel/journal/Journal.cpp` — `expectedTick` is raised by every `Advance` op in a verified commit (was the constant 0 with a "Plan 03" note)
- `tapestry/kernel/Kernel.cpp` — `submit` pushes `CreateEdge` ids into `CommitResult.edgeIds`
- `tapestry/kernel_tests/codec_test.cpp` — `TEST_SUITE("codec")`: 10 cases, pure; helpers `frame` (independent sha256 sealing), `offsetOfLine`, `expectFailure`, `flattened`, `everythingRecord`
- `tapestry/kernel_tests/kernel_test.cpp` — 6 new `kernel: ` cases; helpers `proposalOf`, `submitOk`, `createOk`, `openOk`, `decodeAll`, `bodyOf`, `frame`, `withRecordReplaced`
- `.planning/phases/01-deterministic-core-readable-format/01-03-tdd-red-evidence.json` — persisted RED evidence (`RED_EVIDENCE_OK`)

## Decisions Made

- **"Decoded record equals the input" is asserted in flattened form.** Plan 02 decided each `set` line decodes to its own `SetProperty` (so re-encoding keeps the file's line order). The codec test therefore expands the input's `CreateNode`/`CreateEdge` initial props into the same separate ops before comparing `std::vector<Op>` with `==`; byte identity is asserted separately and directly.
- **Defaulted `operator==` on the op structs and `Actor`.** C++20 defaulted comparison over `NodeId`/`EdgeId`/`Target`/`std::map<std::string, Value>` makes whole-record equality a single assertion in tests and costs nothing in the kernel.
- **Two failure offsets moved.** `DigestMismatch` now carries the record's head-line offset (so `JournalStatus.offset` names the bad record, matching the "start of the bad region" contract) with the `@end` offset in the detail; `InvalidUtf8` carries the offset of the line holding the bad byte, with the byte offset in the detail, exactly as the plan's behavior bullet phrased it.
- **BadLine vs BadValue for `set`.** Wrong shape (token count, unparsable target or key) is `BadLine`; right shape with a bad value (missing value, unknown type, unparsable value, unclosed block) is `BadValue`. This is the split the plan's bullets asked for and it reads naturally in a diagnostic.
- **`advance 0` is refused at decode.** The encoder never writes it (prepare rejects `TickZero` first), so a reader treats it as not a v1 op rather than a no-op it could replay.
- **Diagnostics are greppable.** `UnsupportedOp: verb 'frobnicate' in commit 2 …` and `TickMismatch: expected tick 3 …, found 2` appear inside `JournalStatus.reason` after `Journal::describe` prefixes its own lowercase reason name, so the kernel cases can assert on the plan's exact words.
- **Small edits outside the file list (see Deviations):** the `Journal::scan` tick hook and `CommitResult.edgeIds` fill are each a handful of lines in Plan 04-owned files; Plan 04's PLAN does not mention `advance`, ticks or `edgeIds`, so nothing there will conflict.
- **Worktree namespace assertion not applied** (as in Plans 01/02): this is a Conductor workspace worktree on `start-tapestry-project`; protected-branch and attached-HEAD checks ran before every commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `Journal::scan` now raises `expectedTick` from `advance` ops**
- **Found during:** Task 2 ("tick lines follow advance")
- **Issue:** `Journal::scan` passed the constant `0` as `expectedTick` for every commit (Plan 02 left a "Plan 03: follows advance ops" note). Any journal containing `advance` would reopen `Corrupt` with `TickMismatch` at the very next commit, so Task 2's case (5) — and any real world that ever advances — could not pass. `Journal.cpp` is owned by Plan 04, whose plan does not mention ticks or `advance`.
- **Fix:** After each verified commit, walk its ops and add every `Advance::ticks` to `expectedTick` (7 lines plus `#include <variant>`). The replayed world's `tick()` after `Kernel::fromJournal` equals the same sum, so file and world agree by construction.
- **Files modified:** tapestry/kernel/journal/Journal.cpp
- **Verification:** kernel case "tick lines follow advance": reopen → `tick() == 3`, commits carry 0/0/3; hand-edited `tick 2` → `Corrupt` with `TickMismatch`, `lastGoodSeq 2`
- **Committed in:** db84f56

**2. [Rule 1 - Bug] `Kernel::submit` fills `CommitResult.edgeIds`**
- **Found during:** Task 2 ("ids are stable across reopen and never reused after delete")
- **Issue:** `CommitResult` documents `edgeIds` as "the ids the creation ops received, in op order", but `submit` only recorded `CreateNode` ids; a `CreateEdge` proposal returned an empty `edgeIds`. `Kernel.cpp` is owned by Plan 04, whose plan does not mention `edgeIds`.
- **Fix:** One `else if (std::get_if<CreateEdge>)` branch pushing the assigned id.
- **Files modified:** tapestry/kernel/Kernel.cpp
- **Verification:** kernel case asserts `edgeIds == {e1}` on create and `{e2}` after reopen
- **Committed in:** db84f56

**3. [Rule 2 - Missing Critical] `World::prepare` refuses text with a line over `kMaxLineBytes`**
- **Found during:** Task 1 (LimitExceeded case)
- **Issue:** The decoder refuses any body line over 1 MiB, but nothing stopped a proposal from carrying such a text; the kernel would have written a file its own `open()` classifies as `Corrupt` — the same class of bug Plan 02 closed for invalid UTF-8.
- **Fix:** `checkValue` for `Text` also runs `hasLineLongerThan(text, tree::kMaxLineBytes)` → `BadValue`. `World.cpp` includes `kernel/tree/Codec.hpp` for the constant (a header-only dependency on the codec's limits, no cycle).
- **Files modified:** tapestry/kernel/World.cpp
- **Verification:** the codec case proves the decoder's `LimitExceeded` on a 1 MiB + 1 line and accepts exactly 1 MiB; the world-side guard compiles warning-free and is exercised by the existing prepare paths
- **Committed in:** db84f56

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 bug, 1 missing critical)
**Impact on plan:** All additive; no interface from the plan's `<interfaces>` block was renamed or removed. Deviations 1 and 2 touch files listed under Plan 04 with the smallest edits that make Task 2 pass; Plan 04 runs next on the same tree and can build on them. Two execution notes that are not deviations: (a) 4 of the 10 codec cases already passed in the RED run because they pin tracer behavior that existed (block selection, non-ASCII text, limits, unclosed block) — the RED evidence record lists which 6 failed and why; (b) the `isToken` comment in `Ops.hpp` was changed from `acme.widgets/gizmo@7` to `example.widgets/gizmo@7` so that Task 2's `grep -rc 'acme.widgets' tapestry/kernel` criterion holds.

## TDD Gate Compliance

| Gate | Commit | Evidence |
|------|--------|----------|
| RED | `48da4e1` `test(01-03): add failing codec suite for the full v1 op set` | `tapestry_kernel_tests -ts=codec` exit 1; 6 of 10 cases failed on 208 assertions against inert visitor stubs (target `codec: every op and value type round-trips byte-identically`); `gsd_run check tdd-red-evidence` → `RED_EVIDENCE_OK` (`target_test_failed`); record at `01-03-tdd-red-evidence.json` |
| GREEN | `db84f56` `feat(01-03): implement the full v1 op set, block text and strict reader rules` | same command exit 0; 10 cases / 787 assertions; build log 0 warning/error lines; all 24 then-existing cases green |
| REFACTOR | — | not needed; no commit made |

How RED was made honest: the RED commit carries the final `Ops.hpp`/`World.hpp` (the contract the tests compile against) and `std::visit` skeletons in `World.cpp`/`Encoder.cpp` whose new alternatives accept-and-ignore or emit nothing, with the decoder untouched (new verbs are `UnsupportedOp`). The suite links and fails on assertions, not on compile or link errors. The one compile fix before RED was in the test itself (a bare ternary inside `REQUIRE_MESSAGE` parses as `(builder << cond) ? …`; parenthesized).

## Issues Encountered

None beyond the test-side macro precedence slip above. Both tasks were green on their first post-implementation run.

## Known Stubs

None. No placeholder values, TODO/FIXME markers or unwired data in `tapestry/kernel` or the two test files. `Rejection::Kind::TickZero` and `JournalStatus::Corrupt` now have tests; `TornTail` remains Plan 04's.

## Threat Flags

None new. Plan threat register dispositions applied: T-1-04 (every body line and block is UTF-8-validated with NUL rejected → `InvalidUtf8` at the line; inline values still escape controls), T-1-05 (delimiter escalation proven with a body line equal to `TEXT`; an `@end`-looking line inside a counted body is inert; a delimiter placed outside the counted body is never reached), T-1-02 (`kMaxRecordBytes` refused from the head line alone, `kMaxLineBytes` per line, block scan bounded by the counted body; the world now refuses over-long lines before writing), T-1-14 (edge ids assigned only in `prepare`, explicit ids must equal the counter, tombstones make a deleted id `IdOutOfOrder`/`RefMissing`), T-1-15 (accepted: `x-` lines re-emitted verbatim, never interpreted).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `01-04` (sweeps, lock, repair, save-as): `Journal::scan` now tracks ticks; `decodeAll`/`bodyOf`/`frame`/`withRecordReplaced` in `kernel_test.cpp` show how to rewrite one record for truncation and bit-flip fixtures, and the codec suite's `everythingRecord()` is a ready-made record with every verb for save-as byte identity. Two things Plan 04 should know: `DigestMismatch` now reports the record's head-line offset (not the `@end` line), and the `codec` suite already flips every body byte of a record and expects `DigestMismatch` at offset 0.
- Ready for `01-05` (FORMAT.md, `example.tree`): the line forms and reader rules are in `Codec.hpp`'s comments; `example.tree` can be generated from `everythingRecord()`-style proposals with `FixedClock`.
- Phase 2 note: `x-` lines are the kernel's only plugin-owned escape hatch and are re-emitted verbatim; a plugin schema that needs structure beyond typed props should use them with a namespaced first token.
- Verify-work note: the tracer journal at `${TMPDIR}/tapestry-kernel-tracer.tree` is still the only file left on disk; all six new kernel cases remove their scratch files.

---
*Phase: 01-deterministic-core-readable-format*
*Completed: 2026-09-09*

## Self-Check: PASSED

All 11 files in the diff and this SUMMARY exist on disk; commits 48da4e1, db84f56 and e74211f are present in git history; commits measured from plan_head_before 32e837969a4653385940d7a1a9be26f2ccd80021 = 3; the tracer journal is on disk at ${TMPDIR}/tapestry-kernel-tracer.tree (539 bytes) and no other scratch file remains. (A first self-check pass reported plan_head_before missing because its grep was anchored at column 0 while the field is indented under actuals; re-checked un-anchored.)
