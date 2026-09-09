---
phase: 01-deterministic-core-readable-format
plan: 04
subsystem: kernel
tags: [c++20, tree-format, journal, durability, failure-injection, f_fullfsync, ftruncate, flock, sidecar, save-as, doctest, tdd]

# Dependency graph
requires:
  - phase: 01-deterministic-core-readable-format (plan 01)
    provides: "Digest/Ids/Value/Time primitives, FixedClock, doctest runner, support.hpp (scratchPath/readFile/writeFile/fileSize/fileExists)"
  - phase: 01-deterministic-core-readable-format (plan 02)
    provides: "Sink seam + PosixSink, Journal open/scan/append with Ok/TornTail/Corrupt, Kernel::createWithSink/openBytes, DecodeFailure.atEof"
  - phase: 01-deterministic-core-readable-format (plan 03)
    provides: "Full v1 op set (the sweep fixtures use every verb), Journal::scan tick tracking, DigestMismatch at the record offset"
provides:
  - "doctest suite `journal` (13 cases, 27,052 assertions): write→sync→ack order, failed sync, mid-record write, exhaustive prefix-truncation sweep, single-bit-flip sweep, refusal while torn/corrupt, flock lock-out, header-only fresh world, open never modifies the file, repair round trip, repair refusals, save-as identity/idempotency, save-as of unknown data"
  - "Journal::append turns an unacknowledged write or sync into a TornTail status at the verified prefix (never appends behind bytes it could not confirm); lastGoodSeq names the last verified commit in every status"
  - "Sink::truncate() on the seam; PosixSink: EINTR-safe ftruncate then F_FULLFSYNC"
  - "RepairResult + Journal::repair(RecordedAt): explicit only; sidecar <journal>.torn-<stamp> written and synced before the journal is truncated and synced; refuses Ok, Corrupt, read-only, pathless and an existing sidecar"
  - "Journal::saveAs(path): CreateNew (EEXIST on an existing target), exactly the verified prefix bytes, synced, source untouched"
  - "Kernel::repair() (clock-stamped) and Kernel::saveAs()"
  - "RecordingSink test double with failNextSync / failWriteAfter / truncate; recordBoundaries() helper that finds record ends from the text alone"
  - "Sidecar naming convention <journal>.torn-<YYYY-MM-DDTHH-MM-SSZ>"
affects: [01-05, FORMAT.md, phase-2-host-bridge, phase-3-replay]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 16768
  tasks: 2
  commits: 3
  plan_head_before: c73bb590da4f9e7da732fe0c45d101485e41d519

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Failure injection through the Sink seam: the double caps accepted bytes or fails one sync, never rolls back, and the production Journal/Kernel is what is under test"
    - "Exhaustive sweeps as plain loops with CHECK_MESSAGE carrying the cut length / byte index; record boundaries computed from the file text (lines beginning `@end sha256:`), not from kernel code"
    - "An append the medium did not confirm is a TornTail in memory: the journal refuses to write behind it until an explicit repair() or a fresh open() classifies the bytes"
    - "Repair ordering: create sidecar (O_EXCL, directory fsync) → write tail → F_FULLFSYNC sidecar → close → ftruncate journal → F_FULLFSYNC → status Ok; the first failing step is named and the status stays TornTail"
    - "The Journal keeps the bytes it verified (plus any unverified tail) so repair() and saveAs() act on exactly what was read or written, never on a file that may have changed since"

key-files:
  created:
    - tapestry/kernel_tests/journal_test.cpp
    - .planning/phases/01-deterministic-core-readable-format/01-04-tdd-red-evidence.json
    - .planning/phases/01-deterministic-core-readable-format/deferred-items.md
  modified:
    - tapestry/kernel/journal/Sink.hpp
    - tapestry/kernel/journal/Sink.cpp
    - tapestry/kernel/journal/Journal.hpp
    - tapestry/kernel/journal/Journal.cpp
    - tapestry/kernel/Kernel.hpp
    - tapestry/kernel/Kernel.cpp
    - tapestry/kernel_tests/kernel_test.cpp

key-decisions:
  - "An append the sink does not confirm (failed writeAll or failed sync) flips the in-memory journal to TornTail at the verified prefix with bytes = what the sink reports landed; the next submit is JournalNotClean. Without this a retry wrote a second `@commit N` behind the unconfirmed one and the file reopened Corrupt"
  - "A complete record that did reach the medium before a failed sync is valid history on reopen (Ok, commit present): the format has no acknowledgement marker and the rejection meant 'not confirmed', not 'did not happen'. The plan's bullet expected TornTail from openBytes(sink.data); the test asserts the truth for the full bytes and TornTail for every proper prefix of the unconfirmed record"
  - "The Journal retains m_bytes (verified prefix plus any unverified tail) and m_path, beyond the plan's interface block, because repair() must preserve the exact tail and saveAs() must copy the exact verified prefix; re-reading the file would race a concurrent change and sink-only journals have no file"
  - "JournalStatus.lastGoodSeq equals lastSeq() whenever the status is Ok (scan, append, createWithSink, repair), so status() always names the last verified commit; it was only set on failure before"
  - "repair() refuses Ok ('nothing to repair'), Corrupt (all bytes present, not a torn tail — a person decides), read-only opens (no sink to truncate), sink-only journals (no path for a sidecar) and an occupied sidecar name (CreateNew, never overwritten); it always writes the sidecar, even when the known tail is empty, so the event leaves a durable trace"
  - "saveAs() is allowed on TornTail and Corrupt journals: it copies exactly the verified prefix, which is the salvage a person wants, and the copy opens Ok"
  - "A torn or corrupt header stays OpenFailure::NotATree (Plan 02's open question): the truncation sweep confirms all 129 header cuts fail that way and load nothing; there is no anchor for a chain without a verified header"
  - "The BadEnvelope offset for a flipped byte-count digit (reported where the decoder looked for @end, inside the next record) is pinned by Plan 03's codec suite at that position, so it is logged in deferred-items.md rather than changed here; the sweep asserts the bad region never begins before the damaged record"
  - "Sink::truncate is pure virtual as the plan specified, so kernel_test.cpp's RecordingSink gained a three-line override (outside Task 2's file list) to keep the kernel suite compiling"

patterns-established:
  - "Sweep fixture: buildJournal(path, n) submits the first n of five fixed proposals (every verb, block text, real/int/bool/time/ref, an edge with a prop, advance 3, delete-node cascade) with FixedClock; kNodesAfter/kTickAfter tables say what the loaded world must contain after each commit"
  - "Sidecar name derived in tests with sidecarFor(path, stamp) exactly as Journal::repair derives it: path + \".torn-\" + stamp with ':' → '-'"
  - "Every journal case removes its scratch files and sidecars; the litter check `ls $TMPDIR | grep -c '.torn-'` must print 0 after the suite"

requirements-completed: [TREE-03, TREE-02]

coverage:
  - id: D1
    description: "Every commit is written then synced before submit returns: a RecordingSink sees exactly w,s (header) then w,s per commit, and the bytes decode as the header plus the two commits with the digests submit returned"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: every commit is written then synced before submit returns"
        status: pass
    human_judgment: false
  - id: D2
    description: "A failed sync or a write that stops mid-record returns Rejection::Io, leaves the world, commit count and verified bytes untouched, flips the journal to TornTail at the verified prefix, and a further submit is JournalNotClean; every proper prefix of the unconfirmed record reopens TornTail with only the prior commit, and a write cut 20 bytes into commit 2 reopens with commitCount 1 and offset == verified bytes"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: a failed sync rejects the commit and leaves the world untouched"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: a write that stops mid-record is a torn tail, never a partial commit"
        status: pass
    human_judgment: false
  - id: D3
    description: "Exhaustive prefix truncation of a 1,846-byte five-commit journal (1,847 prefixes): 129 cuts inside the header are NotATree, the 6 boundary cuts are Ok, the other 1,712 are TornTail with offset == the largest boundary <= len and bytes == len - offset; at every cut commitCount, lastGoodSeq, verifiedBytes, node count and tick equal exactly the commits that end at or before the cut"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: exhaustive prefix truncation never accepts a partial record"
        status: pass
      - kind: other
        ref: "tapestry_kernel_tests -ts=journal -tc='*exhaustive prefix truncation*' -s | grep 'assertions: 17569 | 17569 passed | 0 failed'"
        status: pass
    human_judgment: false
  - id: D4
    description: "Flipping bit 0 of every one of the 1,280 bytes of a three-commit journal is never accepted: 129 header flips are NotATree, 1,150 are Corrupt, 1 is TornTail (a count digit in the last record); commitCount is always below 3 and never includes the damaged record; flips inside commit 1 or 2 are always Corrupt"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: single-byte corruption is never accepted"
        status: pass
    human_judgment: false
  - id: D5
    description: "A torn file and a corrupt file opened Existing refuse submit with JournalNotClean and their bytes are unchanged; a second Existing opener gets Locked while the first is alive (a ReadOnly opener is fine), the file does not change, and the second succeeds once the first is destroyed"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: appends are refused while torn or corrupt"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: a second opener is locked out"
        status: pass
    human_judgment: false
  - id: D6
    description: "A fresh world's file begins `@tree 1 ` with exactly one `@end sha256:` line and no `@commit`, reopens Ok with zero commits; a zero-byte file is NotATree and a missing path is Missing under both policies with no file created; opening the same file three times (Existing, Existing, ReadOnly) yields identical digests, parents, ids, tick and props and never changes the file's bytes or size"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: a fresh world is only the header and empty or missing files are diagnosed"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: open twice yields the same digests and never modifies the file"
        status: pass
    human_judgment: false
  - id: D7
    description: "repair() on a torn journal (137 unconfirmed bytes) creates <journal>.torn-2026-09-08T21-15-07Z holding exactly the tail, truncates the journal to exactly the verified prefix, reports Ok with lastDigest/verifiedBytes unchanged, and submit succeeds again (reopen shows 2 commits); repair() is refused without touching anything on an Ok journal, a read-only opener, an occupied sidecar name and a Corrupt journal"
    requirement: TREE-03
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: repair preserves the torn tail in a sidecar and re-enables appends"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: repair refuses a corrupt journal"
        status: pass
      - kind: other
        ref: "test \"$(ls \"${TMPDIR:-/tmp}\" | grep -c '\\.torn-')\" = 0 && echo NO_SIDECAR_LITTER"
        status: pass
    human_judgment: false
  - id: D8
    description: "saveAs(b) of a three-commit journal gives readFile(b) == readFile(a); saveAs(b) again is IoError EEXIST with b unchanged; saveAs(c) equals b; saveAs(a) onto the source is EEXIST; b opens as the same world with the same lastDigest and can be written independently; a TornTail journal saves only its verified prefix, which opens Ok; a journal with an acme.widgets/gizmo@7 node and two x- lines copies byte-for-byte"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: save-as is byte-identical to the verified prefix and idempotent"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/journal_test.cpp#journal: save-as keeps unknown node types and x- lines byte-for-byte"
        status: pass
    human_judgment: false
  - id: D9
    description: "The kernel builds with zero warning/error lines under the project flags and the full CTest run is 43/43 (value 9, codec 10, kernel 11, journal 13)"
    requirement: TREE-02
    verification:
      - kind: other
        ref: "cmake --build tapestry/build-kernel && grep -ciE 'warning:|error:' build.log == 0 && ctest --test-dir tapestry/build-kernel → 100% tests passed out of 43"
        status: pass
    human_judgment: false

# Metrics
duration: 16 min
completed: 2026-09-09
status: complete
---

# Phase 01 Plan 04: Crash safety by exhaustive failure injection, explicit repair and byte-identical save-as Summary

**TREE-03 is now proven rather than promised: 1,847 prefix cuts and 1,280 bit flips of real journals never make `open()` accept a partial or damaged record and never lose a complete one; an append the disk did not confirm leaves the journal `TornTail` and refusing to write behind it; `repair()` is the only thing that ever shortens a file and it moves the tail verbatim into a `.torn-<stamp>` sidecar first; `saveAs()` copies the verified prefix byte-for-byte, unknown plugin data included.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-09-09T07:42:00Z
- **Completed:** 2026-09-09T07:58:19Z
- **Tasks:** 2 (Task 1 TDD: RED → GREEN, no refactor needed; Task 2 auto)
- **Files modified:** 10 (1 test file created, 6 kernel files and 1 test file modified, RED evidence and deferred-items records)

## Accomplishments

- **The sweeps, in numbers.** Truncation: a 1,846-byte five-commit journal (every verb, a `<<TEXT` block, real/int/bool/time/ref values, an edge with a property, `advance 3`, a cascading delete) cut at all 1,847 prefix lengths — 129 cuts inside the header are `NotATree`, the 6 record boundaries are `Ok`, the remaining 1,712 are `TornTail` with `offset` equal to the last boundary and `bytes` equal to the overhang, and at every single cut the commit count, `lastGoodSeq`, `verifiedBytes`, node count and tick are exactly those of the commits that end at or before the cut (17,569 assertions in that case alone). Corruption: all 1,280 bytes of a three-commit journal flipped one at a time — 129 header flips `NotATree`, 1,150 `Corrupt`, 1 `TornTail` (a count digit in the last record made its body run past EOF), zero `Ok`, and the damaged record is never loaded.
- **Write → sync → acknowledge is observable and its failures are safe.** The `RecordingSink` logs exactly `w,s` for the header and `w,s` per commit. A failed sync returns `Rejection::Io` with the world, commit count and verified bytes untouched; a write that stops 20 bytes into commit 2 does the same with no sync attempted. In both cases the journal now reports `TornTail` at the verified prefix and refuses the next submit with `JournalNotClean` — the RED run showed that before this plan the kernel would have written a second `@commit 2` behind the unconfirmed one, and the file would have reopened `Corrupt`.
- **Refusal, lock, empty and idempotent open are pinned.** Torn and corrupt files refuse appends and are left byte-identical; a second `Existing` opener is `Locked` (`flock`) while a `ReadOnly` opener is not, and the lock releases with the first kernel; a fresh world is only its header record; zero-byte and missing files are diagnosed without creating anything; three consecutive opens yield the same digests, ids and props and never change the file.
- **Explicit repair, sidecar first.** `Journal::repair(now)` writes the tail to `<journal>.torn-<RFC 3339 with ':' as '-'>` through a `CreateNew` `PosixSink` (directory fsync, `O_EXCL`, `O_NOFOLLOW`), `F_FULLFSYNC`s it, closes it, then `ftruncate`s the journal to the verified prefix and `F_FULLFSYNC`s again, and only then reports `Ok` with `lastDigest`/`verifiedBytes` unchanged. The test proves `readFile(sidecar) == tailBytes`, `readFile(journal) == prefixBytes`, that `submit` works again and a reopen shows the new commit, and that repair is refused — touching nothing — for an `Ok` journal, a read-only opener, an occupied sidecar name and a `Corrupt` journal.
- **Save-as is byte identity.** `saveAs(b)` gives `readFile(b) == readFile(a)`; a second `saveAs(b)` is `IoError` `EEXIST` with `b` unchanged; `saveAs(c)` equals `b`; the source can never be its own target; the copy opens as the same world with the same `lastDigest` and can diverge independently; a torn journal saves exactly its verified prefix (which opens `Ok`); a journal holding an `acme.widgets/gizmo@7` node and two `x-` lines copies byte-for-byte.
- Build stays warning-free under `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -ffp-contract=off`; CTest is 43/43 (value 9, codec 10, kernel 11, journal 13); 27,052 assertions in the journal suite; no `.torn-` litter in `$TMPDIR` after the run.

## Task Commits

Each task was committed atomically:

1. **Task 1: Failure-injection sinks, truncation and bit-flip sweeps, refusal and lock** — `5d89845` (test, RED) → `5d1a1ea` (feat, GREEN); no REFACTOR commit was needed
2. **Task 2: Explicit repair with sidecar and byte-identical save-as** — `c6b5b6f` (feat)

**Plan metadata:** see the `docs(01-04)` commit that adds this SUMMARY.

## Files Created/Modified

- `tapestry/kernel_tests/journal_test.cpp` — `TEST_SUITE("journal")`, 13 cases; `RecordingSink` (`failNextSync`, `failWriteAfter`, `truncate` logging `t`); `fixtureProposals`/`buildJournal` with `kNodesAfter`/`kTickAfter`; `recordBoundaries`, `recordHolding`, `writeTornJournal`, `decodeAll`, `withRecordReplaced`, `sidecarFor`
- `tapestry/kernel/journal/Sink.hpp/.cpp` — `Sink::truncate(std::uint64_t)`; `PosixSink::truncate`: `off_t` range check, EINTR-safe `ftruncate`, then the same `F_FULLFSYNC` path as `sync()`
- `tapestry/kernel/journal/Journal.hpp/.cpp` — `RepairResult`; `repair(RecordedAt)`; `saveAs(path) const`; `markUnacknowledged` (TornTail on a failed write or sync); `m_bytes`/`m_path`; `lastGoodSeq` maintained on every path; `create`/`open` record the path; `scan` moves the read bytes in
- `tapestry/kernel/Kernel.hpp/.cpp` — `repair()` forwarding `m_clock->now()`; `saveAs(path) const`
- `tapestry/kernel_tests/kernel_test.cpp` — the tracer's `RecordingSink` gains the `truncate` override the seam now requires
- `.planning/phases/01-deterministic-core-readable-format/01-04-tdd-red-evidence.json` — persisted RED evidence (`RED_EVIDENCE_OK`)
- `.planning/phases/01-deterministic-core-readable-format/deferred-items.md` — the `BadEnvelope` offset observation (below)

## Decisions Made

- **An unconfirmed append is a torn tail in memory.** `Journal::append` on a failed `writeAll` or `sync` sets `TornTail{offset = verifiedBytes, bytes = min(sink->size() - verifiedBytes, attempted), lastGoodSeq = lastSeq}` and keeps the landed bytes in `m_bytes`. The journal never appends behind bytes it could not vouch for; the caller repairs (tail to sidecar, truncate) or reopens (the scan decides on what is actually on disk).
- **A complete record that reached the medium is history.** The plan's failed-sync bullet expected `openBytes(sink.data)` to be `TornTail`, but when every byte of the record landed it verifies — the format has no acknowledgement marker, and by design a verified record is never discarded. The test asserts the truth: the full bytes reopen `Ok` with the commit present, every proper prefix of the unconfirmed record reopens `TornTail` with only the prior commit, and the in-memory kernel is `TornTail` and refuses to append. This is the standard "fsync failed" ambiguity: the rejection means "not confirmed", never "did not happen".
- **The Journal keeps its bytes and its path.** `repair()` must preserve the exact tail and `saveAs()` must copy the exact verified prefix; re-reading the file would race a concurrent change (the very thing `flock` and the open-time size check guard against) and sink-only journals have no file at all. Memory cost is the journal's size, which `kMaxRecordBytes` already bounds per record; a streaming save-as can replace it later without changing the contract.
- **`lastGoodSeq` is always meaningful.** It equals `lastSeq()` whenever the status is `Ok`, so `Kernel::status()` alone tells a caller the last verified commit in every state.
- **Repair refusals are explicit and named.** `Ok` ("nothing to repair"), `Corrupt` ("not torn" — cutting fully-present bytes would discard history a person has not looked at), read-only (no sink), sink-only (no path), and an existing sidecar (`CreateNew` fails `EEXIST`; the journal is untouched and still `TornTail`). A failed truncate after a written sidecar names both in the detail.
- **`saveAs` works on any status.** Copying the verified prefix of a torn or corrupt journal is exactly the salvage a person needs; the copy opens `Ok`.
- **A torn header stays `NotATree`.** Plan 02 left this open; the sweep's 129 header cuts all fail that way and load nothing, which is right: without a verified `@tree` record there is no world name and no anchor for the digest chain.
- **Worktree namespace assertion not applied** (as in Plans 01–03): this is a Conductor workspace worktree on `start-tapestry-project`; the cwd-drift sentinel, attached-HEAD and protected-branch checks ran before every commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The failed-sync case asserts the classification the format actually gives**
- **Found during:** Task 1 (behavior bullet 2)
- **Issue:** The plan expected `Kernel::openBytes(sink.data)` to classify `TornTail` after a failed sync, but the `RecordingSink` (as the plan specified) keeps every byte written, so the record is complete and digest-verified; the decoder correctly accepts it. Asserting `TornTail` would have required either a decoder that rejects valid records or a double that silently drops bytes.
- **Fix:** The case asserts the in-memory kernel is `TornTail` (the planned "lastGoodSeq equal to the previous commit" property, now on `status()`), that every proper prefix of the unconfirmed record reopens `TornTail` with only commit 1 (three cuts, matching Assumption A3), and that the complete bytes reopen `Ok` with the commit present. The refusal to append on top of the unconfirmed tail is what keeps the file from ever becoming `Corrupt`.
- **Files modified:** tapestry/kernel_tests/journal_test.cpp, tapestry/kernel/journal/Journal.cpp
- **Verification:** the case passes; the truncation sweep independently proves the prefix classification for every cut
- **Committed in:** 5d89845 (test), 5d1a1ea (implementation)

**2. [Rule 2 - Missing Critical] `JournalStatus.lastGoodSeq` maintained when the status is `Ok`**
- **Found during:** Task 1 (truncation sweep, boundary cuts)
- **Issue:** `lastGoodSeq` was only set on a scan failure, so an `Ok` journal reported `0` — contradicting its own contract ("the last commit that verified") and making the sweep's per-cut check meaningless at boundaries.
- **Fix:** Set `lastGoodSeq = lastSeq` at the end of `scan` (when `Ok`), after a successful `append`, and after a successful `repair`; the header comment now says "equals lastSeq() when Ok".
- **Files modified:** tapestry/kernel/journal/Journal.hpp, tapestry/kernel/journal/Journal.cpp
- **Verification:** 6 boundary cuts and every `Ok` assertion across the suite; kernel cases that check `lastGoodSeq` on `Corrupt` still pass
- **Committed in:** 5d1a1ea

**3. [Rule 2 - Missing Critical] The Journal retains `m_bytes` and `m_path`**
- **Found during:** Task 1 (needed to record the unconfirmed tail) and Task 2 (repair/saveAs)
- **Issue:** The plan's interface block describes `repair` writing "the tail bytes (status.offset to end of the bytes read at open)" and `saveAs` writing "the verified prefix bytes", but nothing kept those bytes: `scan` discarded them and `createWithSink`/`openBytes` journals have no file to re-read.
- **Fix:** `Journal` stores the bytes it verified plus any unverified tail (`m_bytes`) and the file path (`m_path`, empty for sink-only journals); `append` extends it on success and, on failure, appends what the sink reports landed.
- **Files modified:** tapestry/kernel/journal/Journal.hpp, tapestry/kernel/journal/Journal.cpp
- **Verification:** repair round trip (`readFile(sidecar) == tailBytes`, `readFile(journal) == prefixBytes`), save-as byte identity, the torn-prefix save-as
- **Committed in:** 5d1a1ea, c6b5b6f

**4. [Rule 3 - Blocking] `truncate` override added to `kernel_test.cpp`'s `RecordingSink`**
- **Found during:** Task 2 (`Sink::truncate` pure virtual, as the plan specified)
- **Issue:** The tracer's test double in `kernel_test.cpp` (a file outside Task 2's list) became abstract and the kernel suite stopped compiling.
- **Fix:** A three-line `truncate` override that resizes the buffer (plus `<algorithm>`).
- **Files modified:** tapestry/kernel_tests/kernel_test.cpp
- **Verification:** kernel suite 11/11 unchanged
- **Committed in:** c6b5b6f

---

**Total deviations:** 4 auto-fixed (1 bug in the plan's expected value, 2 missing critical, 1 blocking)
**Impact on plan:** All additive; every interface in the plan's `<interfaces>` block exists with the given signature (`saveAs` and `Kernel::saveAs` are additionally `const`). Every task's automated verify and acceptance criteria pass as written. One scope-boundary observation was logged rather than fixed: a flipped byte-count digit in a commit head line makes the decoder report `BadEnvelope` at the position where it looked for `@end` (inside the next record), while `Codec.hpp` says envelope failures report the record's head line; Plan 03's codec suite pins the current position (`codec_test.cpp:400`), so the corruption sweep asserts only that the bad region never begins before the damaged record, and the refinement is recorded in `deferred-items.md`. Two execution notes that are not deviations: (a) 5 of the 9 Task 1 cases already passed in the RED run because they pin tracer behavior that existed (write/sync order, refusal while torn/corrupt, `flock`, header-only fresh world, open never modifies the file) — the RED evidence record lists which 4 failed and why; (b) the sweeps' truncation and corruption expectations passed on the first GREEN run without any decoder change, which confirms Plan 02's `readEnvelope` torn-vs-malformed logic (`couldBeTornEndLine`, prefix-of-head-line checks) was already exact.

## TDD Gate Compliance

| Gate | Commit | Evidence |
|------|--------|----------|
| RED | `5d89845` `test(01-04): add failing journal suite for crash safety, sweeps, refusal and lock` | `tapestry_kernel_tests -ts=journal` exit 1; 4 of 9 cases failed on assertions (target `journal: a failed sync rejects the commit and leaves the world untouched` failed on `status().kind == TornTail` and on the retry being accepted); `gsd_run check tdd-red-evidence` → `RED_EVIDENCE_OK` (`target_test_failed`); record at `01-04-tdd-red-evidence.json` |
| GREEN | `5d1a1ea` `feat(01-04): refuse appends on top of an unacknowledged tail; keep journal bytes and path` | same command exit 0; 9 cases / 26,911 assertions; build log 0 warning/error lines; kernel 11, codec 10, value 9 green |
| REFACTOR | — | not needed; no commit made |

How RED was made honest: all APIs the Task 1 suite uses existed after Plan 03, so the RED commit compiles and links and fails on assertions for the one behavior that did not exist — the journal's state after an append the sink did not confirm. The first RED build failed on a doctest limitation (a `&&` inside `CHECK_MESSAGE` cannot be decomposed) and was rewritten as a named `bool` before the evidence run; that is a test-side fix, not an implementation change.

## Issues Encountered

- doctest's `CHECK_MESSAGE(cond, a ? b : c)` parses the ternary against the message builder (the same precedence slip Plan 03 met); parenthesized at four sites in Task 2. Also BSD `sed -E` does not support back-references inside the pattern, so the fix was applied with perl. Neither touched kernel code.
- A `grep -c` that counts 0 exits 1, which aborted a `set -o pipefail` verify-and-commit chain once before anything was committed; re-run with the count captured in a variable. No effect on the tree.

## Known Stubs

None. No placeholder values, TODO/FIXME markers or unwired data in the changed files. `Journal::repair` on a journal whose `Sink::size()` reported 0 after a failed write (an `fstat` failure) writes an empty sidecar and truncates to the verified prefix — that is the documented behavior, not a stub.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: file-create | tapestry/kernel/journal/Journal.cpp (`saveAs`) | New surface: a file is created at a caller-supplied path. Mitigated by `openPosixSink(CreateNew)`: `O_CREAT|O_EXCL` (never overwrites, so the source and any existing file are safe), `O_NOFOLLOW` (no symlink surprises), `flock` for the write, directory fsync. Path validation beyond that is the caller's (Phase 2 host) concern. |

Plan threat register dispositions applied: T-1-01 (both sweeps), T-1-07 (write→sync→ack proven; failed sync/write rejects and turns the journal torn; repair orders sidecar write → sidecar sync → truncate → full sync), T-1-03 (second opener `Locked`), T-1-06 (sidecar name = journal path + `.torn-` + clock stamp only; `CreateNew` refuses an existing sidecar — tested with an occupied name), T-1-16 (accepted: one tail per explicit call, no retry loop), T-1-08 (accepted; FORMAT.md in Plan 05 states plaintext).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `01-05` (FORMAT.md, `example.tree`, readability): the durability section can cite this suite's numbers directly (1,847 prefixes, 1,280 flips, never `Ok`; sidecar naming `<journal>.torn-<YYYY-MM-DDTHH-MM-SSZ>`; the repair ordering). `Journal::saveAs` is the tool to produce a canonical `example.tree` from a `FixedClock` world. Note for FORMAT.md's "failed save" paragraph: a complete record that reached the disk before a failed flush is history on reopen; the application must repair or reopen before writing again (the kernel enforces this).
- Phase 2 (host bridge): `Kernel::repair()` and `Kernel::saveAs()` are the two operations a UI needs to expose for a torn journal and for export; `RepairResult.detail` and `IoError.what` are human-readable. `saveAs` takes any caller path — the host should confine it.
- Phase 3 (branching/replay): `m_bytes` in the Journal is the natural seed for a streaming save-as or a branch fork; nothing in this plan changes the record grammar.
- Deferred (see `deferred-items.md`): `BadEnvelope` offset for a damaged byte count could report the record's head line like `DigestMismatch` does, with the codec expectation updated alongside.
- Verify-work note: the only file left on disk after the full suite is the tracer journal at `${TMPDIR}/tapestry-kernel-tracer.tree` (by design, Plan 02); every journal case removes its scratch files and sidecars, and the litter check prints `NO_SIDECAR_LITTER`.

---
*Phase: 01-deterministic-core-readable-format*
*Completed: 2026-09-09*

## Self-Check: PASSED

All 10 files in the diff and this SUMMARY exist on disk; commits 5d89845, 5d1a1ea and c6b5b6f are present in git history; commits measured from plan_head_before c73bb590da4f9e7da732fe0c45d101485e41d519 = 3; the journal suite (13 cases), ctest (43/43) and the sidecar-litter check ran green before the SUMMARY was written; the only scratch file on disk is the tracer journal.
