---
phase: 01-deterministic-core-readable-format
verified: 2026-09-09T08:21:18Z
status: human_needed
score: 34/35 must-haves verified
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/01-deterministic-core-readable-format/01-01-PLAN.md
  - .planning/phases/01-deterministic-core-readable-format/01-01-SUMMARY.md
  - .planning/phases/01-deterministic-core-readable-format/01-02-PLAN.md
  - .planning/phases/01-deterministic-core-readable-format/01-02-SUMMARY.md
  - .planning/phases/01-deterministic-core-readable-format/01-03-PLAN.md
  - .planning/phases/01-deterministic-core-readable-format/01-03-SUMMARY.md
  - .planning/phases/01-deterministic-core-readable-format/01-04-PLAN.md
  - .planning/phases/01-deterministic-core-readable-format/01-04-SUMMARY.md
  - .planning/phases/01-deterministic-core-readable-format/01-05-PLAN.md
  - .planning/phases/01-deterministic-core-readable-format/01-05-SUMMARY.md
  - tapestry/.gitignore
  - tapestry/CMakeLists.txt
  - tapestry/docs/tree/FORMAT.md
  - tapestry/docs/tree/example.tree
  - tapestry/kernel/Digest.cpp
  - tapestry/kernel/Digest.hpp
  - tapestry/kernel/Ids.cpp
  - tapestry/kernel/Ids.hpp
  - tapestry/kernel/Kernel.cpp
  - tapestry/kernel/Kernel.hpp
  - tapestry/kernel/Ops.hpp
  - tapestry/kernel/Record.hpp
  - tapestry/kernel/Result.hpp
  - tapestry/kernel/Time.cpp
  - tapestry/kernel/Time.hpp
  - tapestry/kernel/Value.cpp
  - tapestry/kernel/Value.hpp
  - tapestry/kernel/World.cpp
  - tapestry/kernel/World.hpp
  - tapestry/kernel/journal/Journal.cpp
  - tapestry/kernel/journal/Journal.hpp
  - tapestry/kernel/journal/Sink.cpp
  - tapestry/kernel/journal/Sink.hpp
  - tapestry/kernel/tree/Codec.hpp
  - tapestry/kernel/tree/Decoder.cpp
  - tapestry/kernel/tree/Encoder.cpp
  - tapestry/kernel_tests/codec_test.cpp
  - tapestry/kernel_tests/journal_test.cpp
  - tapestry/kernel_tests/kernel_test.cpp
  - tapestry/kernel_tests/main.cpp
  - tapestry/kernel_tests/readability_test.cpp
  - tapestry/kernel_tests/support.hpp
  - tapestry/kernel_tests/value_test.cpp
  - tapestry/third_party/doctest/LICENSE.txt
  - tapestry/third_party/doctest/doctest.cmake
  - tapestry/third_party/doctest/doctest.h
  - tapestry/third_party/doctest/doctestAddTests.cmake
  - tapestry/third_party/picosha2/LICENSE
  - tapestry/third_party/picosha2/picosha2.h
covered_digest: "v1:sha256:ef84f4a29193f4ff00082da5fc0eb955ddcf9dfe99b02a051ba56301a0b844c8"
behavior_unverified: 0
overrides_applied: 0
prohibitions_flagged: 5 # judgment-tier; LLM-judge verdict recorded (none violated), human review recommended per ADR-550 D4
human_verification:
  - test: "Cold read of tapestry/docs/tree/example.tree (Plan 01-05 Task 3 human-check, TREE-01 / Success Criterion 1). Open the file in a plain text editor WITHOUT reading FORMAT.md first and answer: (1) Who is the note about and what does its body say? (2) Which record connects the note to the person and with what label? (3) When did the dinner happen according to the latest value, and can you find the earlier value that was corrected? (4) Which lines tell you when each change was written down, versus when the event happened, versus which simulation tick a change applies at? (5) Which branch is this history on and how does each record point to its predecessor? Then skim FORMAT.md and confirm nothing in it contradicts what you read."
    expected: "All five answerable from the file alone: (1) Sam; 'Met Sam at dinner. / Loves architecture and weird bird memes.' (2) @commit 3, 'create-edge e1 n1 n2 mentions', by actor 'plugin example.people'. (3) 2026-09-06 (commit 4, 'corrected dinner date'); the earlier 2026-09-07 is still in commit 1. (4) 'recorded <stamp>' = when written down; 'set n1 event time <date>' = when it happened; 'tick <n>' = simulation tick (0 through commit 5, 3 at commit 6 after 'advance 3'). (5) 'branch main'; each 'parent sha256:' equals the previous record's '@end sha256:'. A question that cannot be answered from the file alone is a TREE-01 gap, not a documentation nit."
    why_human: "Readability to a person with no Tapestry is a human judgment (RESEARCH A10); the plan explicitly deferred it to end-of-phase UAT. The verifier's own cold read answered all five, and 26 literal-needle assertions pass, but that is an LLM judge, not the human the plan asked for."
  - test: "Prohibition (Plan 02, TREE-01): MUST NOT conflate human, plugin and system actors; every commit names an actor kind and id. Verdict (LLM-judge, non-authoritative): NOT VIOLATED. Confirm by reading tapestry/kernel/tree/Encoder.cpp lines 204-208 (actor line always emitted), tapestry/kernel/Kernel.cpp lines 112-114 (BadActor rejection), tapestry/kernel/tree/Decoder.cpp lines 529-534 (decoder requires 'actor <human|plugin|system> <id>'), and docs/tree/example.tree commits 1, 3 and 5 (human / plugin / system)."
    expected: "No code path writes a commit without a validated actor line; the three actor kinds are distinct in the fixture."
    why_human: "Judgment-tier prohibition with no explicit test-tier enforcement declared; ADR-550 D4 requires explicit human resolution, never a silent pass."
  - test: "Prohibition (Plan 03, TREE-02): MUST NOT silently drop, rewrite, reorder or normalize plugin/extension data the core does not understand; unknown verbs may only stop loudly. Verdict (LLM-judge): NOT VIOLATED. Evidence: Decoder.cpp lines 547-556 keep x- lines verbatim in order and line 409-411 return UnsupportedOp naming the verb and seq; Encoder.cpp lines 217-220 re-emit extension lines; named tests 'kernel: x- extension lines survive reopen verbatim and in order', 'kernel: an unsupported op verb stops the load with the verb and seq named' and 'journal: save-as keeps unknown node types and x- lines byte-for-byte' all pass (run by the verifier)."
    expected: "Unknown x- lines and unknown node types survive open and save-as byte-identically; an unknown verb yields Corrupt with the verb named and only the verified prefix loaded."
    why_human: "Judgment-tier prohibition; human resolution required per ADR-550 D4."
  - test: "Prohibition (Plan 04, TREE-03): MUST NOT acknowledge a commit before its bytes are flushed, and MUST NOT auto-repair/truncate/rewrite/discard journal bytes without an explicit caller action that first preserves them in a sidecar. Verdict (LLM-judge): NOT VIOLATED. Evidence: Journal.cpp lines 252-268 (writeAll -> sync -> only then record), Kernel.cpp lines 148-153 (append before m_world swap); grep shows repair( is invoked only from Kernel::repair (explicit) and never from open/scan; Journal::repair lines 335-359 writes and syncs the sidecar before ftruncate; named tests 'journal: every commit is written then synced before submit returns' and 'journal: repair preserves the torn tail in a sidecar and re-enables appends' pass."
    expected: "Write precedes sync precedes acknowledge; open never shortens a file; repair is explicit and sidecar-first."
    why_human: "Judgment-tier prohibition; human resolution required per ADR-550 D4."
  - test: "Prohibition (Plan 05, TREE-01): MUST NOT store any part of the world's meaning in a form requiring Tapestry, a binary decoder, compression or encryption. Verdict (LLM-judge): NOT VIOLATED. Evidence: example.tree is 2139 bytes of LF-terminated UTF-8 (0 CR, 0 TAB, 0 NUL, 0 escaped-newline sequences); no compression/encryption code exists under tapestry/kernel; FORMAT.md 'Integrity, not authenticity' and 'Not in v1' sections state plaintext by design."
    expected: "Every value in the fixture is readable as text; binary attachments are not embedded."
    why_human: "Judgment-tier prohibition; human resolution required per ADR-550 D4."
  - test: "Prohibition (Plan 05, TREE-04): MUST NOT silently substitute the wall clock for an unknown/corrected event time, and MUST NOT erase the earlier event value when a correction is recorded. Verdict (LLM-judge): NOT VIOLATED. Evidence: event time is an ordinary typed property set only by an op (World.cpp lines 130-134 validate it against the EDTF/RFC 3339 grammar; nothing defaults it from Clock); 'recorded' is written only from m_clock->now() into the commit header (Kernel.cpp line 141); named test 'kernel: three kinds of time are distinguishable and a correction keeps both values' asserts both 'set n1 event time 2026-09-07' and 'set n1 event time 2026-09-06' remain in the file; example.tree commits 1 and 4 show both values."
    expected: "A correction is a new commit; the earlier value stays in its earlier record under its own recorded stamp; event time is never derived from the clock."
    why_human: "Judgment-tier prohibition; human resolution required per ADR-550 D4."
---

# Phase 1: Deterministic Core & Readable Format Verification Report

**Phase Goal:** The world's content, relationships, changes, and history live in a durable `.tree` journal a person can read without Tapestry — and unknown plugin data stays readable and safe
**Verified:** 2026-09-09T08:21:18Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Verification method

Nothing in this report is taken from the SUMMARY files. The verifier:

- deleted `tapestry/build-kernel` and re-ran `cmake -S tapestry -B tapestry/build-kernel -DTAPESTRY_BUILD_APP=OFF -DTAPESTRY_BUILD_RENDER=OFF && cmake --build ... -j 8` from scratch: 0 `warning:`/`error:` lines, no `_deps` directory, `nm -u libtapestry_kernel.a | grep -ci 'nvg\|glad'` = 0
- ran `ctest --test-dir tapestry/build-kernel` exactly once: **100% tests passed out of 49** (value 9, kernel 14, codec 10, journal 13, readability 3); no `.torn-` litter in `$TMPDIR` afterwards
- re-ran the legacy render tree (`tapestry/build`, render ON): camera/world/document **3/3 passed**
- ran individual named tests for every behavior-dependent truth (sweeps, sync ordering, repair, lock, TREE-02, TREE-04, readability, locale) — counts below
- read `Kernel.cpp`, `Journal.cpp`, `Encoder.cpp`, `World.cpp`, `Sink.cpp`, the op/extension section of `Decoder.cpp`, and the TREE-02/TREE-04/readability test bodies in full
- independently re-derived every digest and the parent chain of `docs/tree/example.tree` with Python `hashlib` (no PicoSHA2, no kernel code): 7 records, all digests match, chain intact, valid UTF-8, 0 NUL
- diffed FORMAT.md's fenced fixture (lines 42-109) against `example.tree`: identical
- ran `gsd-tools query verify.artifacts` / `verify.key-links` on all five plans: 24/24 artifacts, 15/15 key links
- confirmed all 14 documented task commits exist (`verify.commits`: 9/9 valid on the spot-checked subset; the rest via `git log -1`)

Note on MVP mode: ROADMAP marks the phase `mode: mvp`, but the goal is not in User Story form (`user-story.validate` → `valid: false`). Plan 01-01 already records this ("quoted verbatim rather than invented"). The MVP User-Flow-Coverage narrowing therefore cannot apply; standard goal-backward verification was used against the four ROADMAP Success Criteria. This is an Info-level discrepancy, not a gap.

## Goal Achievement

### Observable Truths

Roadmap Success Criteria (the contract):

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC1 | A person can open a saved `.tree` file in an ordinary text editor and identify node content, relationships, changes, authorship, and branch ancestry without running the application | ? UNCERTAIN (human) | `docs/tree/example.tree` is 2139 bytes of plain LF text: `create-node n1 tapestry.notes/note@1` + raw two-line `<<TEXT` body (content), `create-edge e1 n1 n2 mentions` (relationship), six `@commit` records with `message` lines (changes), `actor human kaelen` / `actor plugin example.people` / `actor system tapestry` (authorship), `branch main` + `parent sha256:` chain (ancestry). `readability: the fixture reads as text` asserts 26 literal needles, 0 escaped newlines, 7 `@end` lines. The verifier's own cold read answered all five plan questions. The plan explicitly routes the cold read to a human (RESEARCH A10) — see Human Verification #1. |
| SC2 | Saving and reopening a world reproduces the same node data with stable identifiers, and node types the core does not recognize display readable fallback values instead of disappearing or breaking the load | ✓ VERIFIED | `kernel: an unknown node type loads with readable typed fallback values` (type `acme.widgets/gizmo@7`, absent from every file under `tapestry/kernel` — grep confirms 0 hits) reopens with id n1, same type string, 7 typed props, `formatInline` forms `"Gizmo"`, `3`, `12.5`, `-3`, `true`, `2026-09-07`; `kernel: ids are stable across reopen and never reused after delete` (n2/e1 tombstoned, next ids n3/e2, refs to n2 rejected); `journal: open twice yields the same digests and never modifies the file`; `journal: save-as keeps unknown node types and x- lines byte-for-byte`. Named run: 6 TREE-02 kernel cases, 162 assertions, 0 failed. Code: `World::prepare` is the only id assigner (World.cpp 166-178, 206-215), tombstones in `std::set` (287-304). |
| SC3 | After an interrupted write (simulated crash mid-save), reopening recovers the last complete committed history with no silent loss and no silent acceptance of partial changes | ✓ VERIFIED | `journal: exhaustive prefix truncation never accepts a partial record` — loop `for (len = 0; len <= full.size(); ++len)` (journal_test.cpp:461), **17,569 assertions passed** when run alone; `journal: single-byte corruption is never accepted` — loop over every byte (line 519), **9,147 assertions passed**; `journal: a write that stops mid-record is a torn tail, never a partial commit`; `journal: a failed sync rejects the commit and leaves the world untouched`; `journal: appends are refused while torn or corrupt`. Code: `Journal::scan` classifies the first failure TornTail (atEof) vs Corrupt and stops with the verified prefix loaded (Journal.cpp 165-206); `open` never calls `repair` (grep: only `Kernel::repair` does). |
| SC4 | Every recorded change carries a distinguishable domain event time, recorded/corrected time, and simulation tick, and a reader can tell the three apart in the journal | ✓ VERIFIED | Every commit in `example.tree` has `recorded <RFC3339Z>` and `tick <n>` header lines; event time is a `set n1 event time 2026-09-07` op line. `kernel: three kinds of time are distinguishable and a correction keeps both values` asserts both event values remain in the file under different `recorded` stamps and that `recorded`/`tick` start lines while `event` never does; `kernel: recorded is audit-only and never orders history` (clock stepped backwards → still seq 2 chained to seq 1); `kernel: tick changes only through advance and appears in the header`. Named run: 3 cases, 104 assertions, 0 failed. Fixture: commits 1-5 `tick 0`, commit 6 `tick 3` after `advance 3`. |

Plan-level must-have truths (added detail; none reduce the SC scope):

| #   | Truth (plan) | Status | Evidence |
| --- | ------------ | ------ | -------- |
| 5 | (01-01) `.tree` v1 grammar bundle confirmed by the user before any writer code exists | ✓ VERIFIED | STATE.md line 78 records the decision "block-lines ... one-way door confirmed by user"; the first code commit `ba20555` follows; every file written matches the plan's `<format_contract>` line for line (fixture inspected). |
| 6 | (01-01) Kernel-only build offline with `-DTAPESTRY_BUILD_RENDER=OFF`, zero renderer symbols | ✓ VERIFIED | Rebuilt from scratch by the verifier: warning-free, `_deps` absent, 0 nvg/glad symbols; `tapestry_kernel` links only `tapestry_settings` (CMakeLists.txt:72). |
| 7 | (01-01) Legacy prototype still builds and passes with render ON | ✓ VERIFIED | `ctest --test-dir tapestry/build -R '^(camera\|world\|document)$'` → 100% of 3. |
| 8 | (01-01) SHA-256("abc") KAT through vendored PicoSHA2 | ✓ VERIFIED | `value: sha256 known answer` in the 49/49 run; additionally the verifier's Python `hashlib` reproduces all 7 fixture digests the kernel wrote — an independent oracle. |
| 9 | (01-01) Reals shortest round-trip under `de_DE.UTF-8` | ✓ VERIFIED | `value: reals are locale-proof ...` run alone: 21 assertions; value_test.cpp sets `setlocale(LC_ALL, ...)` via `ScopedLocale`; `grep '%.17g\|strtod\b\|std::stod'` in kernel → 0 hits. |
| 10 | (01-01) Recorded stamps RFC 3339 Z seconds; event times EDTF L0/L1 or RFC 3339 only | ✓ VERIFIED | `value: recorded stamps round-trip ...` and `value: event time whitelist grammar ...` pass; `World::prepare` enforces `isValidEventTime` (World.cpp 130-134). |
| 11 | (01-01) Ids format n<k>/e<k>, strict parse | ✓ VERIFIED | `value: node and edge ids format ...` passes; Decoder uses `parseNodeId`/`parseEdgeId`. |
| 12 | (01-02) Create node via `Kernel::submit`, append to file, reopen yields same node/id/props | ✓ VERIFIED | `kernel: create a node, commit durably, reopen from disk, read it back` passes; tracer journal present on disk at `$TMPDIR/tapestry-kernel-tracer.tree`. |
| 13 | (01-02) Journal on disk is readable text with all named lines | ✓ VERIFIED | Fixture inspected directly (see SC1 evidence). |
| 14 | (01-02) Commit 1's parent == header digest; each `@end` == SHA-256 of bytes as written | ✓ VERIFIED | Python hashlib: 7/7 digests match, 6/6 parent links match. |
| 15 | (01-02) Proposal referencing a missing id rejected before any write | ✓ VERIFIED | `kernel: a rejected proposal writes nothing ...` passes; Kernel.cpp 123-135 returns before encode/append. |
| 16 | (01-02) Exactly one write then one sync per submit; world applied only after sync | ✓ VERIFIED | Behavior-dependent; named tests `journal: every commit is written then synced before submit returns` and `kernel: every submit writes once then syncs once` pass; Kernel.cpp 148-153: `append` (writeAll→sync, Journal.cpp 252-259) precedes `m_world = std::move(scratch)`. |
| 17 | (01-02) Missing path → Missing; non-.tree → NotATree; neither creates a file | ✓ VERIFIED | `kernel: opening a missing path reports Missing ...` and `journal: a fresh world is only the header and empty or missing files are diagnosed` pass; `readWholeFile` opens `"rb"` only (Journal.cpp 28-52). |
| 18 | (01-03) Every op verb and value type round-trips byte-identically with matching digest | ✓ VERIFIED | `codec: every op and value type round-trips byte-identically` run alone (with two siblings): 100 assertions; Encoder/World visitors have 0 `default:` branches. |
| 19 | (01-03) Unknown node type survives save/reopen readably | ✓ VERIFIED | See SC2. |
| 20 | (01-03) `x-` lines survive verbatim in order; other unknown verbs stop the load naming verb and seq; only the verified prefix loads | ✓ VERIFIED | Decoder.cpp 547-556 / 409-411; `kernel: x- extension lines survive ...` and `kernel: an unsupported op verb stops the load ...` pass (asserts `Corrupt`, reason contains `frobnicate` and `commit 2`, `lastGoodSeq == 1`, nodeCount 1, submit → `JournalNotClean`, file unchanged). |
| 21 | (01-03) After reopen ids continue above every restored id; deleted ids never reused; refs to deleted rejected | ✓ VERIFIED | `kernel: ids are stable across reopen and never reused after delete` (kernel_test.cpp 552-614). |
| 22 | (01-03) Byte counts/digests over UTF-8 bytes; NUL/invalid UTF-8 → InvalidUtf8; no normalization | ✓ VERIFIED | `codec: a NUL byte or invalid UTF-8 ... is InvalidUtf8`, `kernel: text is bytes — non-ASCII round-trips ...` pass; Decoder.cpp 227; encoder header comment and code contain no normalization step. |
| 23 | (01-03) Tick line == world tick at apply; `advance` raises it; disagreeing tick → Corrupt TickMismatch | ✓ VERIFIED | Journal.cpp 189-193 raises `expectedTick`; Decoder.cpp 522-526; `kernel: tick lines follow advance` passes (hand-edited `tick 2` → Corrupt/TickMismatch). |
| 24 | (01-04) Every prefix cut: Ok exactly at boundaries, TornTail elsewhere, exact prefix loaded | ✓ VERIFIED | 17,569-assertion sweep (see SC3). |
| 25 | (01-04) Every single flipped byte: never Ok, never all three commits | ✓ VERIFIED | 9,147-assertion sweep (see SC3). |
| 26 | (01-04) Failed sync → Io rejection, world unchanged; partial write → TornTail on reopen with prior commits only | ✓ VERIFIED | Named tests pass; `markUnacknowledged` (Journal.cpp 277-293) flips the in-memory journal to TornTail. Deviation noted (Info): a *complete* record that fully reached the sink before a failed sync reopens Ok — documented in 01-04 SUMMARY, consistent with the format having no ack marker; every proper prefix of it reopens TornTail. |
| 27 | (01-04) TornTail/Corrupt refuse submit with JournalNotClean; explicit `repair()` moves tail to sidecar, truncates, status Ok, submit succeeds | ✓ VERIFIED | `journal: appends are refused while torn or corrupt`, `journal: repair preserves the torn tail in a sidecar ...`, `journal: repair refuses a corrupt journal` pass; Journal.cpp 305-370 orders sidecar create→write→sync→close before `truncate`. |
| 28 | (01-04) Fresh world file is exactly the header; zero-byte → NotATree; missing → Missing; no file created | ✓ VERIFIED | `journal: a fresh world is only the header ...` passes. |
| 29 | (01-04) Second `Kernel::open` on a held path → Locked, file unmodified | ✓ VERIFIED | `journal: a second opener is locked out` passes; Sink.cpp 125-131 `flock(LOCK_EX\|LOCK_NB)` → `EWOULDBLOCK "locked"` → `OpenFailure::Locked` (Journal.cpp 55-57). |
| 30 | (01-04) Interrupted append leaves at most one torn tail; reopened world never contains a partially applied commit | ✓ VERIFIED | Mid-record write test + truncation sweep; `Kernel::fromJournal` applies each commit on a scratch world (Kernel.cpp 92-103). |
| 31 | (01-04) Open twice → identical digests/worlds; open never changes the file; saveAs idempotent and byte-identical to the verified prefix | ✓ VERIFIED | `journal: open twice yields the same digests and never modifies the file`, `journal: save-as is byte-identical to the verified prefix and idempotent` pass (in the 49/49 run); `saveAs` is `const`, `CreateNew` (EEXIST), writes exactly `m_bytes[0..verified)` (Journal.cpp 372-382). |
| 32 | (01-05) Every commit carries recorded/tick/event in three places; a correction keeps the earlier value | ✓ VERIFIED | See SC4. |
| 33 | (01-05) Golden fixture byte-identical to kernel output under a fixed clock; no escaped newlines; raw multi-line body | ✓ VERIFIED | `readability` suite run without `TAPESTRY_REGEN_FIXTURE`: 3 cases, 108 assertions; verifier greps: `ESCAPED_NEWLINES=0`, `END_LINES=7`, `CR=0`, `TAB=0`, last byte `0a`. |
| 34 | (01-05) `recorded` never orders: a backwards stamp still gets next seq and a valid chain, reopens Ok | ✓ VERIFIED | `kernel: recorded is audit-only and never orders history` (kernel_test.cpp 843-891) passes; Kernel.cpp derives seq/parent from the journal only (138-139). |
| 35 | (01-05) FORMAT.md documents every keyword, value type, time field, reader rule, id rule (incl. Phase 3 branch tag), limit, torn/corrupt/repair semantics, and states integrity-not-authenticity | ✓ VERIFIED | All 12 required H2 headings present in order (lines 9-508); keyword greps: TornTail 2, Corrupt 3, repair 3, `.torn-` 2, `b2.n12` 2, `64 MiB` 1, `1 MiB` 1, `fork-of` 2, SHA-256 6; "Integrity, not authenticity" section read (line 494); fenced fixture diff against `example.tree` is empty. |

(The 01-05 truth "a person can open docs/tree/example.tree ... without running Tapestry" restates SC1 and is deduplicated into it.)

**Score:** 34/35 truths verified (0 present, behavior-unverified; 1 uncertain pending human cold read)

### Deferred Items

None. No gap maps to a later phase; the one executor-logged deferred observation (`BadEnvelope` offset precision, `deferred-items.md`) is not a failed truth — see Anti-Patterns (Info).

### Required Artifacts

`gsd-tools query verify.artifacts`: 24/24 across the five plans. Substance and wiring checked by reading:

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `tapestry/CMakeLists.txt` | render gate, kernel + tests targets, doctest discovery | ✓ VERIFIED | `option(TAPESTRY_BUILD_RENDER` (19), `add_library(tapestry_kernel STATIC` (69), `target_link_libraries(tapestry_kernel PUBLIC tapestry_settings)` (72, only link), `TAPESTRY_FIXTURE_DIR=` (86), `doctest_discover_tests` (89), `if(TAPESTRY_BUILD_RENDER)` (97); banner pins doctest v2.5.3 and PicoSHA2 161cb3fc |
| `tapestry/third_party/doctest/doctest.h`, `picosha2/picosha2.h` (+ licenses, cmake helpers) | vendored | ✓ VERIFIED | 362,930 / 13,422 bytes, git-tracked, licenses present |
| `tapestry/kernel/{Digest,Ids,Value,Time}.{hpp,cpp}` | primitives | ✓ VERIFIED | 32-462 lines each; wired from Encoder/Decoder/World/Kernel |
| `tapestry/kernel/{Result,Ops,Record,World,Kernel}.hpp`, `World.cpp`, `Kernel.cpp` | contracts + world + transaction kernel | ✓ VERIFIED | `Kernel::submit` real (Kernel.cpp 107-157); `World::prepare/apply` full `std::visit` (World.cpp 165-307) |
| `tapestry/kernel/tree/{Codec.hpp,Encoder.cpp,Decoder.cpp}` | pure codec | ✓ VERIFIED | 224 / 564 lines; no `std::istream`; `string_view` in |
| `tapestry/kernel/journal/{Sink,Journal}.{hpp,cpp}` | durability seam, classification, repair, saveAs | ✓ VERIFIED | `F_FULLFSYNC`, `flock`, `O_NOFOLLOW`, `O_CLOEXEC`, `O_EXCL`, `EINTR`, `ftruncate`, directory fsync all present in Sink.cpp; Journal.cpp 149-206 scan, 242-269 append, 305-370 repair, 372-382 saveAs |
| `tapestry/kernel_tests/{value,kernel,codec,journal,readability}_test.cpp` | 49 test cases | ✓ VERIFIED | 9 + 14 + 10 + 13 + 3 cases enumerated by `ctest -N`; no skipped/disabled tests |
| `tapestry/docs/tree/example.tree` | frozen golden journal | ✓ VERIFIED | 2139 bytes, 7 records, digests independently verified, contains `create-edge e1 n1 n2 ` |
| `tapestry/docs/tree/FORMAT.md` | human guide | ✓ VERIFIED | 520 lines, `## Record grammar` present, fence matches fixture |

### Key Link Verification

`gsd-tools query verify.key-links`: 15/15 across the five plans. Manually confirmed the load-bearing ones:

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| Kernel.cpp | Journal.cpp | `append` before world swap | WIRED | Kernel.cpp 148 → 153 |
| Journal.cpp | Sink.hpp | `writeAll` → `sync` → record | WIRED | Journal.cpp 252-268 |
| Sink.cpp | fcntl/flock | `F_FULLFSYNC` (fsync fallback), `LOCK_EX\|LOCK_NB` | WIRED | Sink.cpp 55-69, 125 |
| Decoder.cpp | Digest.hpp | `sha256` over counted bytes vs `@end` | WIRED | Decoder.cpp 212-214 |
| Encoder.cpp / World.cpp | Ops.hpp | `std::visit(Overload{...})`, no default | WIRED | 0 `default:` in either file |
| Journal.cpp | Sink.hpp | repair: sidecar CreateNew → `truncate()` → sync | WIRED | Journal.cpp 336-359; Sink.cpp 80-92 |
| Kernel.cpp | Journal.hpp | `repair()` passes `m_clock->now()`; `saveAs` forwards | WIRED | Kernel.cpp 159-161 |
| readability_test.cpp | docs/tree/example.tree | `TAPESTRY_FIXTURE_DIR` compare | WIRED | readability_test.cpp 60, 177-182 |
| FORMAT.md | example.tree | fenced walkthrough | WIRED | `sed -n 42,109p FORMAT.md \| diff - example.tree` empty |
| CMakeLists.txt | doctest.cmake | include + `doctest_discover_tests` | WIRED | 49 tests registered with CTest |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `Kernel::world()` after `open` | `m_world` | `Journal::commits()` replayed via `prepare/apply` (Kernel.cpp 92-103) | Yes — fixture reopens to n1/n2/e1, tick 3 | ✓ FLOWING |
| `Journal::commits()` | `m_commits` | `tree::decodeCommit` over bytes read from disk (Journal.cpp 166-199) | Yes | ✓ FLOWING |
| `.tree` file bytes | `Sink::writeAll` | `tree::encodeCommit(record)` from prepared ops (Kernel.cpp 145-148) | Yes — fixture bytes | ✓ FLOWING |
| `docs/tree/example.tree` | file | generated by the production kernel under `FixedClock` (readability_test.cpp 90-158) | Yes — regenerated on every run and compared | ✓ FLOWING |

No static returns, hardcoded empties or mocks on any production path.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Fresh kernel-only configure+build | `rm -rf build-kernel; cmake ... -DTAPESTRY_BUILD_RENDER=OFF; cmake --build` | 0 warning/error lines; no `_deps`; 0 nvg/glad symbols | ✓ PASS |
| Full suite (once) | `ctest --test-dir tapestry/build-kernel` | 100% of 49 | ✓ PASS |
| Legacy render tree | `ctest --test-dir tapestry/build -R '^(camera\|world\|document)$'` | 100% of 3 | ✓ PASS |
| Truncation sweep alone | `tapestry_kernel_tests -ts=journal -tc='*exhaustive prefix truncation*' -s` | 17,569 / 17,569 assertions | ✓ PASS |
| Bit-flip sweep alone | `... -tc='*single-byte corruption*' -s` | 9,147 / 9,147 | ✓ PASS |
| Sync/mid-record/refusal/lock/repair | `... -tc='*failed sync*,*stops mid-record*,*refused while torn*,*locked out*,*repair preserves*'` | 5 cases, 174 assertions | ✓ PASS |
| TREE-02 kernel cases | `... -ts=kernel -tc='*unknown node type*,*never reused*,*x- extension*,*unsupported op verb*,*tick lines follow*,*non-ASCII*'` | 6 cases, 162 assertions | ✓ PASS |
| TREE-04 kernel cases | `... -tc='kernel: three kinds of time*,kernel: recorded is audit-only*,kernel: tick changes only*'` | 3 cases, 104 assertions | ✓ PASS |
| Readability (no regen) | `env -u TAPESTRY_REGEN_FIXTURE ... -ts=readability` | 3 cases, 108 assertions | ✓ PASS |
| Codec round-trip + reader rules | `... -ts=codec -tc='*round-trips byte-identically*,*x- lines survive verbatim*'` | 3 cases, 100 assertions | ✓ PASS |
| Locale independence | `... -ts=value -tc='*locale*'` | 21 assertions | ✓ PASS |
| Independent digest oracle | Python `hashlib.sha256` over `example.tree` records | 7/7 digests, 6/6 parents match; UTF-8 valid; 0 NUL | ✓ PASS |
| Fixture text properties | `grep -c '\\n'` / `grep -c '^@end sha256:'` / `tr -cd '\r\t'` | 0 / 7 / 0 / 0; last byte `0a` | ✓ PASS |
| FORMAT.md fence vs fixture | `sed -n 42,109p FORMAT.md \| diff - example.tree` | empty | ✓ PASS |
| Sidecar litter | `ls $TMPDIR \| grep -c '.torn-'` after the suite | 0 | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist or are declared by any plan; the phase's runnable checks are the CTest suite above. SKIPPED (no probes declared).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| TREE-01 | 01-01, 01-02, 01-03, 01-05 | User can inspect a .tree file in an ordinary text editor and identify node content, relationships, changes, authorship and branch ancestry | ✓ SATISFIED (cold-read confirmation pending — Human #1) | SC1 evidence; fixture + FORMAT.md + 26-needle test |
| TREE-02 | 01-01, 01-02, 01-03, 01-04 | Save and reopen extensible node data with stable identifiers and readable fallback values for unknown plugin types | ✓ SATISFIED | SC2 evidence |
| TREE-03 | 01-02, 01-04 | Recover the last complete committed history after an interrupted write without silently losing or accepting partial changes | ✓ SATISFIED | SC3 evidence |
| TREE-04 | 01-01, 01-05 | Distinguish when an event happened, when it was recorded or corrected, and the simulation tick | ✓ SATISFIED | SC4 evidence |

Orphaned requirements: none — REQUIREMENTS.md maps exactly TREE-01..04 to Phase 1 and every one is claimed by at least one plan.

### Decision Coverage

No `01-CONTEXT.md` exists for this phase (discuss-phase was not run; the planner resolved open questions as PD-01..PD-12 in 01-01-PLAN.md). Gate skipped cleanly. The one recorded user decision (PD-01/02/03/07 format bundle) is honored: STATE.md line 78 and the on-disk grammar match.

### Test Quality Audit

| Test File | Linked Req | Active | Skipped | Circular | Assertion Level | Verdict |
| --------- | ---------- | ------ | ------- | -------- | --------------- | ------- |
| value_test.cpp | TREE-01/02/04 | 9 | 0 | No (hand-written expected values; SHA-256 KAT from the standard) | Value | OK |
| kernel_test.cpp | TREE-01/02/03/04 | 14 | 0 | No (literal file needles, hand-edited records re-sealed by an independent `frame` helper) | Behavioral | OK |
| codec_test.cpp | TREE-01/02 | 10 | 0 | No | Value/Behavioral | OK |
| journal_test.cpp | TREE-02/03 | 13 | 0 | No (record boundaries computed from file text, not kernel code) | Behavioral (exhaustive sweeps) | OK |
| readability_test.cpp | TREE-01 | 3 | 0 | PARTIAL by design: the byte-compare freezes kernel output (snapshot; regeneration gated by `TAPESTRY_REGEN_FIXTURE`). Independent oracles: 26 hand-written literal needles, structural counts, verifier's hashlib check, FORMAT.md fence diff, human cold read. | Value/Behavioral | OK (snapshot, not a blocker) |

**Disabled tests on requirements:** 0. **Circular patterns detected:** 0 blocking (1 intentional golden snapshot with independent oracles). **Insufficient assertions:** 0.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | `TBD` / `FIXME` / `XXX` in any phase file | none found | — |
| — | — | `TODO` / `HACK` / `PLACEHOLDER` / skipped tests | none found | — |
| tapestry/docs/tree/FORMAT.md | 378 | "documented now, not yet implemented" (Phase 3 branch-tag rule) | ℹ️ Info | Intentional forward documentation required by Plan 05; not a stub |
| tapestry/kernel/tree/Decoder.cpp | (envelope) | `BadEnvelope` for a damaged byte-count digit reports the offset where `@end` was sought (inside the next record) rather than the damaged record's head line; logged in `deferred-items.md` by 01-04 | ℹ️ Info | Diagnostic precision only; the sweep still proves the record is never accepted and the reported offset never precedes the damaged record |
| tapestry/kernel/journal/Journal.cpp | 372 | `saveAs` creates a file at any caller-supplied path (01-04 threat flag) | ℹ️ Info | Mitigated by `O_CREAT\|O_EXCL\|O_NOFOLLOW`; path confinement is the Phase 2 host's concern |
| 01-04 plan expectation vs. implementation | — | A complete record that fully reached the sink before a failed `sync` reopens `Ok` (plan bullet expected `TornTail`) | ℹ️ Info | Documented deviation; the in-memory kernel is `TornTail` and refuses to append, every proper prefix reopens `TornTail`; consistent with a format that has no ack marker |

### Human Verification Required

#### 1. Cold read of `tapestry/docs/tree/example.tree` (TREE-01 / SC1)

**Test:** Open `/Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/docs/tree/example.tree` in a plain text editor without reading FORMAT.md first and answer: (1) Who is the note about and what does its body say? (2) Which record connects the note to the person and with what label? (3) When did the dinner happen according to the latest value, and can you find the earlier corrected value? (4) Which lines tell you when each change was written down vs. when the event happened vs. which simulation tick it applies at? (5) Which branch is this history on and how does each record point to its predecessor? Then skim `FORMAT.md` and confirm nothing contradicts what you read.
**Expected:** All five answerable from the file alone (Sam / two-line body; `@commit 3` `create-edge e1 n1 n2 mentions` by `plugin example.people`; 2026-09-06 in commit 4 with 2026-09-07 still in commit 1; `recorded` / `set n1 event time` / `tick`; `branch main` with each `parent sha256:` equal to the previous `@end sha256:`).
**Why human:** Readability to a person with no Tapestry is the plan's explicit end-of-phase human judgment (RESEARCH A10). A question that cannot be answered from the file is a TREE-01 gap.

#### 2-6. Prohibition sign-off (judgment tier)

Five `must_haves.prohibitions` are declared (Plans 02, 03, 04, 05×2). None carries `verification: test`, so each is judgment-tier. The verifier's non-authoritative verdict for every one is **not violated**, with the evidence recorded in the frontmatter `human_verification` entries (code lines and the named passing tests). Per ADR-550 D4 these are flagged `unverified-prohibition — human review recommended` rather than silently passed.

### Gaps Summary

No gaps. Every artifact exists, is substantive and is wired; every behavior-dependent truth has a named passing test that the verifier ran; the crash-safety story is proven by exhaustive sweeps (17,569 + 9,147 assertions) rather than asserted; unknown plugin data demonstrably survives reopen and save-as byte-for-byte while unknown verbs stop the load loudly; the three kinds of time are distinct by name and position in the file. The status is `human_needed` solely because (a) Success Criterion 1 is a readability judgment the plan deliberately routed to a human cold read, and (b) five judgment-tier prohibitions require explicit human sign-off. Automated verification found nothing blocking.

---

_Verified: 2026-09-09T08:21:18Z_
_Verifier: Claude (gsd-verifier)_
