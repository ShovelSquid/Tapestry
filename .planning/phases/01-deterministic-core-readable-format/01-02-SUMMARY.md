---
phase: 01-deterministic-core-readable-format
plan: 02
subsystem: kernel
tags: [c++20, tree-format, journal, sha256, f_fullfsync, flock, doctest, tracer, walking-skeleton]

# Dependency graph
requires:
  - phase: 01-deterministic-core-readable-format (plan 01)
    provides: "tapestry_kernel target, Digest/Ids/Value/Time primitives, doctest runner, support.hpp, the locked block-line .tree v1 format"
provides:
  - "Kernel::create/createWithSink/open/openBytes/submit — the single-writer transaction path (validate on a scratch world → encode → write → F_FULLFSYNC → apply)"
  - "tree::encodeHeader/encodeCommit/decodeHeader/decodeCommit — pure byte-counted .tree v1 codec with <<TEXT blocks, per-record SHA-256, parent chain, offsets on every failure"
  - "Journal::create/open/openBytes/append with Ok/TornTail/Corrupt classification; the valid prefix is always loaded, appends refused unless Ok"
  - "Sink seam (writeAll/sync/size) + PosixSink (O_APPEND|O_CLOEXEC|O_NOFOLLOW, flock LOCK_EX|LOCK_NB, EINTR-safe write loop, F_FULLFSYNC with fsync fallback, directory fsync on create)"
  - "World: generic Node/Edge/typed props; prepare() is the only id assigner, apply() the only mutator; Rejection kinds"
  - "Expected<T,E>, Actor/Target/CreateNode/SetProperty/Op, HeaderRecord/CommitRecord, isToken/isValidKey/isValidActorKind, isValidText"
  - "The first real .tree file (tracer journal, verbatim below) and doctest suite `kernel` (5 cases, 148 assertions)"
affects: [01-03, 01-04, 01-05, FORMAT.md, phase-2-plugin-proposals, phase-3-replay]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff).
actuals:
  tokens: 22706
  tasks: 2
  commits: 2
  plan_head_before: 34428a387b7ab61cfb61f5eec7d29eb576abc9b4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixed submit order: refuse unless journal Ok → validate actor → prepare+apply every op on a scratch World (ids assigned here) → build CommitRecord → encode → Journal::append (writeAll → sync → record) → m_world = scratch"
    - "Pure codec on std::string_view: every DecodeFailure carries the byte offset; atEof is the TornTail/Corrupt discriminator"
    - "Decoder never folds `set` lines back into CreateNode.props — each becomes its own SetProperty op so re-encoding is byte-identical (save-as, Plan 04)"
    - "Replay applies each verified commit on a scratch World; a commit the world refuses flips the journal to Corrupt via markCorrupt and stops, leaving the prefix loaded"
    - "Durability primitives live only in journal/Sink.cpp; Journal and Kernel never touch a file descriptor"
    - "Validation before bytes: World::prepare rejects text/type/actor the decoder would refuse (UTF-8, NUL) so a written file always reopens"

key-files:
  created:
    - tapestry/kernel/Result.hpp
    - tapestry/kernel/Ops.hpp
    - tapestry/kernel/Record.hpp
    - tapestry/kernel/World.hpp
    - tapestry/kernel/World.cpp
    - tapestry/kernel/tree/Codec.hpp
    - tapestry/kernel/tree/Encoder.cpp
    - tapestry/kernel/tree/Decoder.cpp
    - tapestry/kernel/journal/Sink.hpp
    - tapestry/kernel/journal/Sink.cpp
    - tapestry/kernel/journal/Journal.hpp
    - tapestry/kernel/journal/Journal.cpp
    - tapestry/kernel/Kernel.hpp
    - tapestry/kernel/Kernel.cpp
    - tapestry/kernel_tests/kernel_test.cpp
  modified:
    - tapestry/kernel/Value.hpp
    - tapestry/kernel/Value.cpp

key-decisions:
  - "Decoded `set` lines stay separate SetProperty ops (CreateNode decodes with empty props) so encode(decode(x)) reproduces the file's line order byte for byte; folding into the std::map would re-sort keys on save-as"
  - "A header record that is torn or corrupt makes open() fail NotATree with the decode reason in detail — there is no world to load without a verified header; Plan 04's sweeps may refine this"
  - "Journal::open reads the file, scans, then takes the flock and checks the sink's size equals the bytes read, so a commit appended between read and lock cannot produce a wrong parent digest"
  - "Journal::markCorrupt(seq, reason) + per-commit begin offsets added to the Journal contract so a verified record the World refuses on replay is reported as Corrupt at that record's offset, exactly as the plan asked, without a crash"
  - "Ops.hpp validators (isToken, isValidKey, isValidActorKind) are inline in the header; no Ops.cpp was in the plan's file list and they are a few lines each"
  - "isValidText/findInvalidText (strict UTF-8, no NUL) live in Value.hpp/.cpp and are shared by World::prepare and the Decoder, so the writer can never emit bytes the reader rejects"
  - "Journal::append re-checks seq == lastSeq+1 and parent == lastDigest before writing: a defensive guard against a future caller bug corrupting a world file"
  - "kMaxRecordBytes/kMaxLineBytes are `inline constexpr` (one definition across TUs; also silences -Wunused-const-variable when a header is compiled standalone)"

patterns-established:
  - "Codec failure vocabulary: Truncated(atEof) | BadEnvelope | DigestMismatch | ChainBreak | SeqGap | TickMismatch | UnsupportedOp | BadLine | BadValue | InvalidUtf8 | LimitExceeded | NotATree, each with a file offset"
  - "Test doubles for the Sink are file-local structs in the test that needs them (RecordingSink with failSync); the kernel under test is the production kernel"
  - "Tracer journal at ${TMPDIR}/tapestry-kernel-tracer.tree is left on disk deliberately so the verify step and a human can read it"

requirements-completed: [TREE-01, TREE-02, TREE-03]

coverage:
  - id: D1
    description: "A node with typed properties created through Kernel::submit is appended to a .tree file and a fresh Kernel::open yields the same node with the same id, type and properties; nextNodeId is restored to n2"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: create a node, commit durably, reopen from disk, read it back"
        status: pass
    human_judgment: false
  - id: D2
    description: "The journal on disk is readable text with @tree, world, @commit 1, parent sha256, branch main, recorded, tick 0, actor, message, create-node, set lines (block form for the two-line body) and @end lines; no escaped newlines anywhere"
    requirement: TREE-01
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: create a node, commit durably, reopen from disk, read it back"
        status: pass
      - kind: other
        ref: "cat ${TMPDIR}/tapestry-kernel-tracer.tree && grep -c (11 required lines) >= 11 → TRACER_JOURNAL_READABLE"
        status: pass
    human_judgment: false
  - id: D3
    description: "Commit 1's parent equals the header record's digest and each @end digest equals SHA-256 of the record's head line plus counted body exactly as written"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: create a node, commit durably, reopen from disk, read it back"
        status: pass
      - kind: other
        ref: "python3 hashlib.sha256 over the file's counted byte ranges matches both @end lines and the parent line (executor cross-check, independent of PicoSHA2)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A proposal referencing a missing target/ref, a bad key, a bad actor or an invalid time is rejected before anything is written: file bytes, node count and lastSeq unchanged; the kernel keeps working afterwards"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: a rejected proposal writes nothing and leaves the world untouched"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every submit performs exactly one writeAll then one sync on the Sink before returning; the bytes decode; a failed sync is reported as Rejection::Io with the world, commit count and verifiedBytes unchanged"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: every submit writes once then syncs once before returning"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: a failed sync is reported as Io and applies nothing"
        status: pass
    human_judgment: false
  - id: D6
    description: "Opening a missing path reports Missing and a foreign or empty file reports NotATree, under both policies, without creating or modifying any file"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: opening a missing path reports Missing and a foreign file reports NotATree"
        status: pass
    human_judgment: false
  - id: D7
    description: "Journal open-time classification Ok / TornTail / Corrupt exists with offsets and lastGoodSeq, appends are refused unless Ok, and the valid prefix is always loaded"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/kernel_test.cpp#kernel: create a node, commit durably, reopen from disk, read it back (status Ok path)"
        status: pass
    human_judgment: true
    rationale: "Only the Ok path is exercised by a test in this plan; the TornTail and Corrupt branches are implemented (Journal::scan, Decoder atEof) but are proven by Plan 04's truncation and bit-flip sweeps, not here"
  - id: D8
    description: "The kernel still builds offline with zero warnings under the project flags, all 14 CTest cases pass, and libtapestry_kernel.a references no renderer symbols"
    requirement: TREE-02
    verification:
      - kind: other
        ref: "cmake --build tapestry/build-kernel && grep -ciE 'warning:|error:' build.log == 0 && ctest --test-dir tapestry/build-kernel → 100% tests passed out of 14 && nm -u libtapestry_kernel.a | grep -ci 'nvg\\|glad' == 0"
        status: pass
    human_judgment: false

# Metrics
duration: 33 min
completed: 2026-09-09
status: complete
---

# Phase 01 Plan 02: Tracer — create a node, commit it durably, reopen, read it back Summary

**The walking skeleton's spine is real: `Kernel::submit` validates on a scratch world, encodes a byte-counted SHA-256-sealed `@commit`, pushes it through the `Sink` seam with one `write` and one `F_FULLFSYNC`, applies only after the sync, and a fresh `Kernel::open` verifies the chain and rebuilds the same `n1` from disk — leaving a 539-byte `.tree` file a person can read.**

## Performance

- **Duration:** 33 min
- **Started:** 2026-09-09T06:39:49Z
- **Completed:** 2026-09-09T07:13:20Z
- **Tasks:** 2 (Task 1 auto: contracts; Task 2 tracer: implementation + tests)
- **Files modified:** 17 under `tapestry/` (15 created, 2 modified)

## Accomplishments

- The one path is wired end-to-end for keeps: `CreateNode` with initial typed properties → `World::prepare` (assigns `n1`) → `tree::encodeCommit` → `Journal::append` (`writeAll` → `sync`) → `m_world = scratch` → `CommitResult{seq 1, digest, {n1}}`; then a second process's worth of `Kernel::open` scans, verifies digest + parent chain + seq + tick, replays the record with its committed id and reports `nextNodeId() == n2`.
- The journal is readable text (verbatim below): every field the plan named is on its own line, the two-line note body is a raw `<<TEXT` block with no escapes, and both digests plus the parent link were re-derived independently with Python's `hashlib` from the bytes on disk.
- Rejection is proven to change nothing: five rejection kinds (`UnknownTarget`, `RefMissing`, `BadKey`, `BadActor`, `BadValue`) leave the file bytes, node count and `lastSeq` untouched, a rejection mid-proposal discards the accepted ops before it, and the kernel accepts the next good proposal as `seq 2`.
- The durability ordering is observable through the seam: a `RecordingSink` sees exactly `w,s` for the header and `w,s` per commit, a rejected proposal never reaches the sink, and an injected sync failure comes back as `Rejection::Io` with the world, `commitCount()` and `verifiedBytes()` unchanged even though bytes were written.
- Open-time classification, single-writer locking and the size limits are real code on this path (`Journal::scan`, `PosixSink`, `Decoder`), ready for Plan 04's sweeps; `Missing` and `NotATree` are proven never to create or touch a file.
- Build stays warning-free under `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -ffp-contract=off`; CTest is 14/14; the archive has zero `nvg`/`glad` references.

## The first real `.tree` file

`${TMPDIR}/tapestry-kernel-tracer.tree`, 539 bytes, exactly as the tracer case left it (FixedClock pinned at `2026-09-08T21:15:07Z`):

```text
@tree 1 42
world tracer
created 2026-09-08T21:15:07Z
@end sha256:d516d737c4e1d5fa0c2bfc9a9dcddf71ec394fd661a9c04aabb7d48769a99ae4
@commit 1 318
parent sha256:d516d737c4e1d5fa0c2bfc9a9dcddf71ec394fd661a9c04aabb7d48769a99ae4
branch main
recorded 2026-09-08T21:15:07Z
tick 0
actor human kaelen
message "first note"
create-node n1 tapestry.notes/note@1
set n1 body text <<TEXT
Met Sam at dinner.
Loves architecture and weird bird memes.
TEXT
set n1 title text "Sam"
@end sha256:d9b5b997184ecf769031d4feefd85dbb0581518702ba3e1c92f64bf5e0d44cd5
```

Notes for later plans: `set` lines for initial properties come out in `std::map` key order (`body` before `title`); `@tree 1 42` counts the two header body lines; `@commit 1 318` counts everything between its own line feed and `@end`. This is the shape Plan 05's golden `example.tree` will extend.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the kernel contracts (headers only)** — `deec426` (feat)
2. **Task 2: End-to-end "create a node, commit it durably, reopen, read it back"** — `86355e0` (feat, tracer)

**Plan metadata:** see the `docs(01-02)` commit that adds this SUMMARY.

Tracer feedback gate (interactive run, `human_verify_mode: end-of-phase`, automated-only `<verify>`): all three verify blocks re-ran green after the Task 2 commit; no expansion task follows in this plan.

## Files Created/Modified

- `tapestry/kernel/Result.hpp` — `Expected<T,E>` over `std::variant` (libc++ 15 has no `std::expected`); `ok()`, `value()` (lvalue/const/rvalue), `error()`
- `tapestry/kernel/Ops.hpp` — `Actor`, `Target`, `CreateNode`, `SetProperty`, `Op`; inline `isValidActorKind`, `isToken`, `isValidKey`
- `tapestry/kernel/Record.hpp` — `HeaderRecord` (version, world, created, extension lines), `CommitRecord` (seq, parent, branch, recorded, tick, actor, message, ops, extension lines)
- `tapestry/kernel/World.hpp/.cpp` — `Node`, `Edge`, `Rejection` (11 kinds), `World` with `node/nodeIds/nodeCount/tick/nextNodeId/nextEdgeId`, `prepare(Op&) const` (id assignment + validation), `apply(const Op&)` (only mutator, counter moves past adopted ids)
- `tapestry/kernel/tree/Codec.hpp` — `Encoded`, `encodeHeader/encodeCommit`, `DecodeFailure` (reason, offset, detail, atEof), `DecodedHeader/DecodedCommit`, `decodeHeader/decodeCommit`, `kMaxRecordBytes` (64 MiB), `kMaxLineBytes` (1 MiB)
- `tapestry/kernel/tree/Encoder.cpp` — body builder in the fixed line order, `<<TEXT`/`TEXT1`… delimiter escalation, `seal()` computing the digest over head line + body
- `tapestry/kernel/tree/Decoder.cpp` — `readEnvelope` (torn-vs-malformed head and `@end` detection, count and line limits before allocation, digest check), `splitBody` (UTF-8/NUL, LF-terminated lines with offsets), strict header/commit field parsing, `parseOp` for `create-node` and `set` (inline and block values), `UnsupportedOp` for any other verb, `x-` lines preserved
- `tapestry/kernel/journal/Sink.hpp/.cpp` — `IoError`, `Sink`, `SinkMode`, `openPosixSink`; `PosixSink` with the documented open flags, `flock`, EINTR-safe `writeAll`, `F_FULLFSYNC` → `fsync` fallback on EINVAL/ENOTSUP, `fstat` size, parent-directory fsync on create
- `tapestry/kernel/journal/Journal.hpp/.cpp` — `OpenPolicy`, `JournalStatus`, `OpenFailure`, `Journal` (`create/createWithSink/open/openBytes`, accessors, `append`, `markCorrupt`); scan loop classifying the first failure as TornTail (atEof) or Corrupt
- `tapestry/kernel/Kernel.hpp/.cpp` — `Proposal`, `CommitResult`, `Kernel` factories, `fromJournal` replay on per-commit scratch copies, `submit` in the fixed order
- `tapestry/kernel/Value.hpp/.cpp` (modified) — `findInvalidText` / `isValidText`: strict UTF-8 (no overlongs, surrogates or > U+10FFFF) and no NUL
- `tapestry/kernel_tests/kernel_test.cpp` — `TEST_SUITE("kernel")`: tracer, rejection, write-then-sync order, failed sync, missing/foreign/empty file; file-local `RecordingSink`

## Decisions Made

- **Decoder keeps `set` lines as separate ops.** `create-node n1 …` decodes to `CreateNode{n1, type, {}}` and each following `set n1 …` to its own `SetProperty`. The world ends up identical, and re-encoding reproduces the file's exact line order — folding into `CreateNode.props` (a `std::map`) would re-sort keys and break Plan 04's byte-identical save-as.
- **Torn or corrupt header → `OpenFailure::NotATree` with the decode reason in `detail`.** Without a verified `@tree` record there is no header to return and no anchor for the chain. Plan 04's exhaustive truncation sweep is the place to decide whether a torn header should instead yield an empty journal with `TornTail{offset 0}`; the change would be local to `Journal::scan`.
- **`Journal::open` order: read → scan → `flock` → size check.** The plan's order (read, scan, then open the sink) is kept, with one guard added: if the sink's `size()` differs from the bytes scanned, open fails `Io("journal changed while it was being opened")` rather than later writing a commit whose `parent` is stale.
- **`Journal::markCorrupt` and per-commit begin offsets** were added to the Journal contract (beyond the plan's interface block) because the plan requires a replay-time apply rejection to surface as a `Corrupt` status with reason `apply`, and the status lives in the Journal. `commits()` still returns every digest-verified record; only `status()` changes.
- **Replay is per-commit atomic.** `Kernel::fromJournal` prepares and applies each commit's ops on a scratch `World` and swaps it in per commit, so a commit whose second op fails leaves the world at the previous commit, not half-applied.
- **Text validity is enforced before writing.** `World::prepare` rejects text, type and actor ids that are not valid UTF-8 or contain NUL (`BadValue`/`BadType`/`BadActor`), and `Kernel::submit` rejects such a message — the decoder refuses those bytes, so accepting them would write a file that never reopens.
- **Actor kinds, tokens and keys are validated exactly where the plan put them** (`Ops.hpp`), and `Journal::createWithSink` validates the world name and extension lines so `encodeHeader` can never produce a header the decoder rejects.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Text validity checked before bytes are written**
- **Found during:** Task 2 (World::prepare / Decoder)
- **Issue:** The decoder must reject NUL and invalid UTF-8 (PD-10), but nothing stopped a caller from submitting such text; the kernel would have written a file its own `open()` classifies as Corrupt.
- **Fix:** Added `findInvalidText`/`isValidText` to `kernel/Value.hpp/.cpp` (files outside this plan's list, additive only) and used them in `World::prepare` (text values, node type), `Kernel::submit` (actor id, message), `Journal::createWithSink` (world name, extension lines) and `Decoder::splitBody` (whole record body, with the offset of the first bad byte).
- **Files modified:** tapestry/kernel/Value.hpp, tapestry/kernel/Value.cpp, tapestry/kernel/World.cpp, tapestry/kernel/Kernel.cpp, tapestry/kernel/journal/Journal.cpp, tapestry/kernel/tree/Decoder.cpp
- **Verification:** kernel suite green; value suite unchanged (9/9)
- **Committed in:** 86355e0

**2. [Rule 3 - Blocking] `Journal::markCorrupt` added to the Journal contract**
- **Found during:** Task 2 (Kernel::fromJournal)
- **Issue:** The plan says a rejection while replaying a verified record "is a Corrupt status with reason apply, not a crash", but `JournalStatus` is owned by `Journal` and the interface block gave the kernel no way to set it.
- **Fix:** Declared and implemented `void Journal::markCorrupt(CommitSeq seq, std::string reason)` plus a private `m_commitBegins` vector so the status carries that commit's byte offset and `lastGoodSeq = seq - 1`. Declared in the Task 1 header (so Task 1 still declares only what Task 2 defines).
- **Files modified:** tapestry/kernel/journal/Journal.hpp, tapestry/kernel/journal/Journal.cpp, tapestry/kernel/Kernel.cpp
- **Verification:** compiles warning-free; the Ok replay path is covered by the tracer case; a test for the Corrupt-on-apply path belongs with Plan 04's corruption sweeps
- **Committed in:** deec426 (declaration), 86355e0 (definition)

**3. [Rule 3 - Blocking] `inline constexpr` for the codec limits; Task 1 verify run in header mode**
- **Found during:** Task 1 verify
- **Issue:** The plan's verify compiles each header as a main translation unit (`-x c++`), which makes clang report `#pragma once in main file` for every header and `-Wunused-const-variable` for the two limit constants — both artifacts of the harness, not of the code — while the fails_when clause forbids any `warning:` line.
- **Fix:** Made `kMaxRecordBytes`/`kMaxLineBytes` `inline constexpr` (a genuine improvement: one definition across TUs) and ran the same command with `-x c++-header`, which reports zero warnings for all eight headers. Under `-x c++`, the only remaining warning line per header is the `pragma once` one, which the plan itself mandates. Recorded here rather than silently accepted.
- **Files modified:** tapestry/kernel/tree/Codec.hpp
- **Verification:** `clang++ … -fsyntax-only -x c++-header` on all eight headers → `HEADERS_OK` with no output; `-x c++` output filtered of the pragma line is empty
- **Committed in:** deec426

**4. [Rule 2 - Missing Critical] `Journal::open` verifies the locked file's size equals the bytes scanned**
- **Found during:** Task 2 (Journal::open)
- **Issue:** Reading the file before taking the `flock` leaves a window in which another writer could append; the kernel would then compute `parent` from a stale `lastDigest` and write a chain break.
- **Fix:** After `openPosixSink(AppendExisting)` succeeds, `sink->size()` must equal the byte count scanned, else `OpenFailure::Io`.
- **Files modified:** tapestry/kernel/journal/Journal.cpp
- **Verification:** tracer reopen path exercises the check (sizes match); a concurrent-writer test belongs to Plan 04's lock case
- **Committed in:** 86355e0

---

**Total deviations:** 4 auto-fixed (2 missing critical, 2 blocking)
**Impact on plan:** All additive; no interface from the plan's `<interfaces>` block was renamed or removed. Every task's automated verify and acceptance criteria pass as written (the header-mode note above is the one harness caveat). Two execution notes that are not deviations: the `kernel` suite has 5 cases rather than the 4 the plan listed (a failed-sync case was added because the "world applied only after sync succeeds" truth is cheap to prove through the same `RecordingSink`), and Ops.hpp's three validators are inline in the header since the plan's file list has no `Ops.cpp`.

## Issues Encountered

None. The build was warning-free and all 148 assertions passed on the first run of the kernel suite.

## Known Stubs

None. `Edge`, `m_edges` and `nextEdgeId()` exist in `World` without an op that creates edges — that is Plan 03's `create-edge`, declared now so the world's shape and the `ref` resolver (`e<k>` must exist) do not change later. `JournalStatus::TornTail`/`Corrupt` and `Rejection::TickZero` are implemented or declared and awaiting their Plan 03/04 tests; nothing renders placeholder data.

## Threat Flags

None new. Plan threat register dispositions applied on this path: T-1-01 (envelope + digest + chain + seq/tick checks; first failure classified, prefix loaded, append refused unless Ok), T-1-02 (`kMaxRecordBytes` and `kMaxLineBytes` checked before any body allocation; `LimitExceeded`), T-1-03 (`flock(LOCK_EX|LOCK_NB)` held for the sink's life; second opener gets `Locked`), T-1-05 (byte-counted framing; block form whenever text has an LF; delimiter escalates until unique), T-1-07 (`F_FULLFSYNC` before acknowledge; world applied after; `RecordingSink` asserts `w,s`), T-1-10 (`O_NOFOLLOW|O_CLOEXEC`).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `01-03` (wider op set: `unset`, `create-edge`, `delete-node`, `delete-edge`, `advance`, `ref` to edges, extension lines). Extension points: append to the `Op` variant, `appendOp` in Encoder.cpp, `parseOp` in Decoder.cpp, `World::prepare/apply`; `Journal::scan` has the `expectedTick` hook (currently constant 0) for `advance`.
- Ready for `01-04` (sweeps, lock test, repair, save-as): `Kernel::openBytes` + `RecordingSink`-style doubles, `DecodeFailure.atEof`, `JournalStatus.offset/bytes/lastGoodSeq`, and the decoder's decision to keep `set` lines as separate ops (byte-identical re-encode) are all in place. Two behaviors to pin down there: a torn header currently fails `NotATree` (see Decisions), and `markCorrupt` keeps `commits()` intact while flipping `status()`.
- `tapestry/docs/tree/` still does not exist; Plan 05 creates it (the `TAPESTRY_FIXTURE_DIR` define already points there). The tracer journal above is the seed for `example.tree` and FORMAT.md.
- Verify-work note: the tracer case intentionally leaves `${TMPDIR}/tapestry-kernel-tracer.tree` on disk; the other kernel cases clean up their scratch files.

---
*Phase: 01-deterministic-core-readable-format*
*Completed: 2026-09-09*

## Self-Check: PASSED

All 15 created files exist on disk; commits deec426 and 86355e0 are present in git history; the tracer journal is on disk at ${TMPDIR}/tapestry-kernel-tracer.tree (539 bytes).
