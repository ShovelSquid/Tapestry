# Phase 1: Deterministic Core & Readable Format - Research

**Researched:** 2026-09-08
**Domain:** Headless C++20 transaction kernel + durable, human-readable `.tree` journal (append-only, hash-chained, crash-recoverable)
**Confidence:** MEDIUM-HIGH — toolchain, build/test commands, durability primitives and library facts were verified by running them on this machine; the `.tree` grammar and kernel API are design proposals (no CONTEXT.md exists) and are marked as planner decisions.

## Summary

Phase 1 builds the part of Tapestry nothing else can be retrofitted onto: a rendering-independent C++20 kernel whose only way to change the world is an ordered, validated transaction, and whose only durable artifact is a `.tree` journal that a person can read in a text editor. Four requirements drive every design choice: readability without the app (TREE-01), stable IDs plus readable fallback for unknown plugin data (TREE-02), crash recovery with no silent loss and no silent acceptance of partial writes (TREE-03), and three distinguishable kinds of time on every change (TREE-04).

The research resolves the three open items STATE.md flagged for this phase. **Framing:** use a line-oriented record format with a byte-counted outer envelope (`@commit <seq> <bytes>` … `@end sha256:<hex>`) and git-fast-import-style delimited blocks for multi-line text inside it, so long notes stay literally readable while framing stays unambiguous. **Canonical hashing of unknown extension fields:** none is needed in Phase 1 — committed records are immutable byte spans, the digest is computed over the bytes as written, and unknown lines/values are preserved verbatim and re-emitted byte-identically; canonicalization only becomes necessary when state is re-serialized (snapshots, Phase 3). **Failure injection:** an injectable write sink (records write/sync call order, can fail or truncate at byte N) plus exhaustive prefix-truncation and single-byte-corruption tests over a small generated journal; both run in milliseconds and need no kernel-level crash simulation.

Verified on this macOS machine: CMake 4.4.1, Apple clang 14.0.3 (libc++ 15006), `F_FULLFSYNC`, `flock`, `std::to_chars(double)` (shortest round-trip, locale-independent), doctest 2.5.3 (vendored, builds offline, CTest discovery works), PicoSHA2 (SHA-256 KAT matches). Also verified as *absent*: `std::from_chars(double)`, usable `std::format`, `<source_location>`, ninja. The existing prototype builds and its three tests pass; its `.tapestry` codec is reference material only.

**Primary recommendation:** Create a new `tapestry/kernel/` library (`tapestry_kernel`, no glad/NanoVG/SDL) with a single-writer transaction kernel, a byte-counted + SHA-256-chained line-oriented `.tree` journal with delimited text blocks, F_FULLFSYNC-before-acknowledge appends, explicit TORN/CORRUPT classification on open, vendored doctest tests discovered by CTest, and an exhaustive truncation/corruption harness — starting with one tracer slice: create node → append commit → reopen → read back.

## User Constraints

No `01-CONTEXT.md` exists for this phase (`/gsd-discuss-phase` was not run). There are no locked user decisions beyond PROJECT.md, REQUIREMENTS.md, ROADMAP.md and CLAUDE.md. Where this document says "Recommend", the planner/executor decides; each such choice is listed under **Open Questions** and the **Assumptions Log**.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TREE-01 | User can inspect a .tree file in an ordinary text editor and identify node content, relationships, changes, authorship and branch ancestry. | Record grammar (Pattern 2): `@commit` header carries `branch`, `parent sha256:…`, `actor`, `recorded`, `tick`; ops are verb lines (`create-node`, `set`, `create-edge`); multi-line text is a delimited block with no escapes; golden example file + format guide are deliverables. Pitfall 1 (escaped text), Pitfall 4 (opaque IDs). |
| TREE-02 | User can save and reopen extensible node data with stable identifiers and readable fallback values for unknown plugin types. | Kernel-assigned readable IDs recorded in committed ops (Pattern 6); node `type` is a namespaced string the core never needs to understand; all plugin values are typed core values (`text/int/real/bool/ref/time`); unknown header lines preserved verbatim; load→save-as must be byte-identical (Pattern 5). |
| TREE-03 | User can recover the last complete committed history after an interrupted write without silently losing or accepting partial changes. | Byte-counted envelope + SHA-256 trailer + parent chain (Pattern 2); buffer-then-single-write + `F_FULLFSYNC` (Pattern 3); open-time classification OK / TORN_TAIL / CORRUPT with sidecar preservation and refusal to append until explicit repair (Pattern 4); exhaustive truncation, bit-flip and sink-order tests (Validation Architecture). |
| TREE-04 | User can distinguish when an event happened, when it was recorded or corrected, and the simulation tick at which a change applies. | Three fields with three names in three places: `recorded` (RFC 3339 UTC, commit header, audit only), `tick` (integer, commit header, kernel-controlled), `event` (EDTF/RFC 3339 string, a node *property* set by an op). A correction is a new commit with its own `recorded`; the old value stays in an earlier record (Pattern 7). |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives extracted from `./.claude/CLAUDE.md`; treat as locked:

- **Readability:** content, relationships, changes and provenance inspectable without the application; binary attachments may only be *referenced* with readable descriptions.
- **Control:** historical origin remains available after correction (a corrected value must not overwrite the record of the original).
- **History:** editing the past preserves the original future in a branch; replay uses recorded outcomes, never new guesses. Phase 1 must not paint Phase 3 into a corner: every record must carry `branch` and `parent` from day one.
- **Simple core:** storage, graph state and rule execution conceptually small and separable from AI/integration adapters — no feature-specific classes (no `Note`, `Person`, `Page`) in the kernel.
- **Plugins from the beginning:** the kernel must not need to understand plugin node types to load, save, or display a fallback.
- **Developer accessibility:** kernel builds and tests must run without SDL, NanoVG, a display, or (ideally) network.
- **Development scope:** stay in this Conductor workspace; do not rename the branch (`start-tapestry-project`); do not write planning artifacts into the primary checkout.
- **Toolkit independence (STATE.md):** Phase 1 stays toolkit-independent; the UI decision belongs to the Phase 2 feasibility gate. `[VERIFIED: .planning/STATE.md]`
- **Determinism flags already in repo:** `-ffp-contract=off`, no fast-math, `-Wall -Wextra -Wpedantic -Wshadow -Wconversion` — `[VERIFIED: tapestry/CMakeLists.txt:34-36]` quoted: `target_compile_options(tapestry_settings INTERFACE -Wall -Wextra -Wpedantic -Wshadow -Wconversion -ffp-contract=off)`. The kernel must link `tapestry_settings` and compile warning-clean under these flags.
- **GSD workflow:** file edits go through `$gsd-execute-phase` / `$gsd-quick`; never direct edits outside a GSD command.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| World model (nodes, edges, typed properties, unknown types) | Kernel (C++ `tapestry_kernel`) | — | Generic, feature-free graph state; the only in-memory truth |
| Transaction validation, ordering, ID/seq/tick assignment | Kernel | — | Sole mutation entry point; single writer per open world |
| `.tree` encoding/decoding (grammar, blocks, digests) | Kernel (`kernel/tree/*`) | — | Format is a versioned public contract; codec must be pure (bytes in/out, no I/O) so tests can fuzz it |
| Durable append, locking, recovery classification | Kernel (`kernel/journal/*`) + OS filesystem | — | Platform durability calls (`F_FULLFSYNC`, `flock`, dir fsync) live behind one `Sink` seam for injection |
| Readable fallback for unknown plugin data | Kernel data model | Host/UI (Phase 2 inspector) | Fallback is a *data* guarantee (typed properties, `title`/`body` convention) before it is a UI feature |
| Three kinds of time | Kernel (record header + property) | Timeline plugin (Phase 4) | Kernel records; plugins present |
| Branch ancestry fields | Kernel record header | History store (Phase 3) | Phase 1 writes `branch main` + `parent` so Phase 3 adds forks without a format break |
| Test harness, failure injection, golden fixtures | Kernel tests (doctest/CTest) | — | Headless; no display, no network |
| UI / rendering / SDL / NanoVG | Out of scope (Phase 2 gate) | — | Legacy `tapestry_core` stays as the baseline, untouched |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| C++20 (Apple clang 14.0.3, libc++ 15006) | in repo | Kernel language | Already the repo standard `[VERIFIED: tapestry/CMakeLists.txt:8-10]` (`set(CMAKE_CXX_STANDARD 20)`); compiler verified on this machine `[VERIFIED: clang++ --version]` |
| CMake + CTest | 4.4.1 installed; `cmake_minimum_required 3.24` in repo | Build kernel and run headless tests | `[VERIFIED: cmake --version]`; existing `enable_testing()`/`add_test` pattern `[VERIFIED: tapestry/CMakeLists.txt:153-168]` |
| doctest (vendored single header + 2 cmake scripts) | v2.5.3 (2026-07-06) | Unit/property tests with CTest discovery | Single-header, no network at configure, compiles in ~1.1 s under the project's warning flags, `doctest_discover_tests` registers each `TEST_CASE` with CTest `[VERIFIED: local build /tmp/dtcmake]`; matches the repo's "vendor rather than fetch" convention `[VERIFIED: tapestry/third_party/CMakeLists.txt:1-10]` |
| PicoSHA2 (vendored single header) | master (pushed 2025-05-04), MIT | SHA-256 record digests / parent chain | 388-line header; `hash256_hex_string("abc")` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` matches FIPS 180-4 vector and macOS CommonCrypto `[VERIFIED: local compile + CommonCrypto cross-check]`; needs `SYSTEM` include (12 `-Wconversion` warnings otherwise) |
| `std::to_chars(double)` | libc++ 15006 | Shortest round-trip, locale-independent `real` formatting | Prints `0.30000000000000004` for `0.1+0.2` and `1.5` even under `de_DE.UTF-8` `[VERIFIED: /tmp/cxx20probe]` |
| POSIX `write(2)` + `fcntl(F_FULLFSYNC)` + `flock(2)` | macOS 26.5 | Durable append, single-writer lock | `F_FULLFSYNC` returns 0; second `flock(LOCK_EX\|LOCK_NB)` returns -1 `[VERIFIED: /tmp/cxx20probe/loc.cpp]`; Apple's man page says plain `fsync` does not guarantee media durability `[CITED: developer.apple.com fsync(2)]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `strtod_l` / `newlocale(LC_NUMERIC_MASK,"C")` (or `std::from_chars` where present) | libc / libc++ | Locale-independent `real` parsing | Required: Apple libc++ has **no** `std::from_chars(double)` (`= delete`) and `strtod("1.5")` returns `1` under `de_DE` `[VERIFIED: /tmp/cxx20probe]`; `strtod_l(s,end,nullptr)` parsed correctly under `de_DE` on macOS `[VERIFIED]`; portable form via `newlocale` `[ASSUMED]` |
| nlohmann/json | v3.12.0 (2025-04-11) | JSON for the Phase 2 host protocol | **Deferred to Phase 2.** Not needed by the recommended Phase 1 grammar. If the planner picks the JSON-lines alternative instead: duplicate keys silently last-wins (needs a SAX pre-check), floats dump as `%g` with 17 digits (not JCS shortest), NaN dumps as `null` `[CITED: json.nlohmann.me number_handling; GitHub discussions #3567/#3392]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| doctest (vendored) | Catch2 v3.16.0 via FetchContent | Richer matchers/reporters, but multi-file, needs network at configure and noticeably slower compiles; breaks the offline-kernel goal. Use only if the team wants Catch2's BDD style. |
| doctest | Existing hand-rolled `check()` style `[VERIFIED: tapestry/tests/DocumentTest.cpp:23-30]` | Zero deps, but no per-case CTest discovery, no `-tc=` filtering, no SUBCASE; Nyquist quick-run commands become awkward. Keep the legacy tests as they are; write new tests in doctest. |
| Block/line record grammar (recommended) | JSON Lines / RFC 7464 text sequences (ARCHITECTURE.md's provisional choice) | JSON escapes every newline in notes (`\n`), needs JCS canonicalization + duplicate-key rejection + shortest-float writer that nlohmann does not provide; RFC 7464 explicitly provides "no cryptographic integrity protection" and tells parsers to *skip* malformed elements — the opposite of TREE-03 `[CITED: rfc-editor.org/rfc/rfc7464]`. |
| PicoSHA2 | macOS CommonCrypto / OpenSSL | CommonCrypto is macOS-only (verified working, useful as a test cross-check); OpenSSL is a heavy dependency for one primitive. |
| Sequential per-branch IDs (`n12`) | ULID / UUIDv7 (RFC 9562) | Random 128-bit IDs are collision-free across branches but opaque to readers (PITFALLS.md #4) and 26–36 chars per reference; sequential IDs are readable and deterministic, and branch-scoping (Phase 3) avoids fork collisions `[ASSUMED]` |

**Installation:** nothing to install. Vendor these files (pinned by tag) under `tapestry/third_party/`:

```bash
# doctest v2.5.3 — verified URLs
curl -sL -o tapestry/third_party/doctest/doctest.h            https://raw.githubusercontent.com/doctest/doctest/v2.5.3/doctest/doctest.h
curl -sL -o tapestry/third_party/doctest/doctest.cmake        https://raw.githubusercontent.com/doctest/doctest/v2.5.3/scripts/cmake/doctest.cmake
curl -sL -o tapestry/third_party/doctest/doctestAddTests.cmake https://raw.githubusercontent.com/doctest/doctest/v2.5.3/scripts/cmake/doctestAddTests.cmake
curl -sL -o tapestry/third_party/doctest/LICENSE.txt          https://raw.githubusercontent.com/doctest/doctest/v2.5.3/LICENSE.txt
# PicoSHA2 (MIT) — pin the commit hash in third_party/CMakeLists.txt comment as nanovg does
curl -sL -o tapestry/third_party/picosha2/picosha2.h https://raw.githubusercontent.com/okdshin/PicoSHA2/master/picosha2.h
```

**Version verification:** performed 2026-09-08 via GitHub API (`releases/latest`): doctest v2.5.3 (2026-07-06), Catch2 v3.16.0 (2026-08-25), nlohmann/json v3.12.0 (2025-04-11), googletest v1.18.0 (2026-08-10). `[VERIFIED: api.github.com]`

## Package Legitimacy Audit

The `gsd-tools package-legitimacy check` seam supports only `npm|pypi|crates` `[VERIFIED: seam usage error]`; C++ header libraries were audited manually against GitHub repository metadata.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| doctest | vendored from GitHub tag v2.5.3 | since 2014-08 (12 yrs); pushed 2026-08-29 | 6.9k stars / 700 forks | github.com/doctest/doctest (MIT) | OK | Approved — vendor 4 files |
| PicoSHA2 | vendored from GitHub | since 2014-02 (12 yrs); pushed 2025-05-04 | 760 stars / 162 forks | github.com/okdshin/PicoSHA2 (MIT) | OK (KAT verified locally) | Approved — vendor 1 header + LICENSE; add SHA-256 known-answer test |
| Catch2 | not used | since 2010; v3.16.0 2026-08-25 | 21k stars | github.com/catchorg/Catch2 (BSL-1.0) | OK | Not adopted (alternative) |
| nlohmann/json | not used in Phase 1 | since 2013; v3.12.0 | 50k stars | github.com/nlohmann/json (MIT) | OK | Deferred to Phase 2 |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
 caller (Phase 1: tests + tiny CLI; Phase 2: plugin host)
   │  Proposal { ops[], actor, event-times inside ops }
   ▼
 ┌──────────────── Transaction kernel (single writer) ────────────────┐
 │ 1 validate: ids exist/absent, types well-formed, values typed,      │
 │            tick monotone, journal not TORN/CORRUPT, lock held        │──reject──▶ Result{error}; nothing written, state untouched
 │ 2 resolve: assign node/edge ids, seq = last+1, recorded = now(UTC), │
 │            parent = digest(previous record), branch = current        │
 └───────────────────────────┬─────────────────────────────────────────┘
                             │ CommitRecord (in-memory struct)
                             ▼
 ┌──── .tree codec (pure: struct ⇄ bytes) ────┐
 │ encode header lines + op lines + <<BLOCK   │
 │ text; compute byte-count; SHA-256 → @end   │
 └───────────────────────────┬────────────────┘
                             │ exact bytes of one record
                             ▼
 ┌──── Journal writer (Sink seam) ────────────┐        ┌──── Human ────┐
 │ write(all bytes) → F_FULLFSYNC → ack       │──────▶ │ text editor   │
 └───────────────────────────┬────────────────┘        └───────────────┘
                             │ ack (only now)
                             ▼
 apply ops to World state (nodes/edges/typed props; unknown types kept) → publish

 open(path):  lock → scan records → per record: byte-count ok? @end present?
              digest matches? parent == previous digest? seq == prev+1?
              ├─ all ok ─────────────▶ OK: apply every record → World
              ├─ failure only at EOF ─▶ TORN_TAIL: apply complete prefix, report {offset, bytes};
              │                         appends refused until repair() moves tail to sidecar
              └─ failure mid-file ────▶ CORRUPT: read-only prefix + diagnostic; never "fixed" silently
```

### Recommended Project Structure

```text
tapestry/
├── CMakeLists.txt              # add option TAPESTRY_BUILD_RENDER (default ON); gate glad+nanovg+tapestry_core+legacy tests behind it
├── kernel/                     # NEW — no includes from core/ or render/, no glad/nanovg
│   ├── Ids.hpp                 # NodeId/EdgeId/CommitSeq strong types, parse/format ("n12", "e3")
│   ├── Value.hpp/.cpp          # typed value: text|int|real|bool|ref|time; format/parse (to_chars, strtod_l)
│   ├── Time.hpp/.cpp           # RecordedAt (RFC 3339 UTC 'Z'), EventTime (EDTF L0/L1 string, validated grammar), Tick
│   ├── World.hpp/.cpp          # nodes, edges, properties; apply(Op); read-only queries; NO feature classes
│   ├── Ops.hpp                 # CreateNode/Set/Unset/CreateEdge/DeleteNode/DeleteEdge/Advance (+ Proposal)
│   ├── Record.hpp              # HeaderRecord/CommitRecord structs incl. preserved unknown lines
│   ├── tree/Encoder.cpp        # struct → bytes (byte count, blocks, digest)
│   ├── tree/Decoder.cpp        # bytes → struct; strict; reports framing/digest/chain failures with offsets
│   ├── journal/Sink.hpp        # interface: write(span), sync(), size(); PosixSink + test sinks
│   ├── journal/Journal.cpp     # open/scan/classify, lock, append (buffer→write→FULLFSYNC), repair()
│   └── Kernel.hpp/.cpp         # submit(Proposal) → Result; owns World + Journal; single writer
├── kernel_tests/               # doctest; one file per concern; main.cpp with DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
│   ├── main.cpp
│   ├── value_test.cpp          # number/locale/round-trip, EDTF/RFC3339 validation
│   ├── codec_test.cpp          # encode/decode, blocks, unknown-line preservation, byte-identical resave
│   ├── journal_test.cpp        # durability order, truncation sweep, bit-flip sweep, TORN/CORRUPT, lock
│   ├── kernel_test.cpp         # tracer slice, rejection leaves state untouched, three times, ids stable
│   └── readability_test.cpp    # golden fixture: docs/tree/example.tree bytes + literal grep assertions
├── third_party/doctest/        # doctest.h, doctest.cmake, doctestAddTests.cmake, LICENSE.txt
├── third_party/picosha2/       # picosha2.h, LICENSE
└── docs/tree/
    ├── FORMAT.md               # grammar guide for humans (deliverable of TREE-01)
    └── example.tree            # golden world, committed; tests assert exact bytes
```

Keep `core/`, `render/`, `app/` and the three legacy tests untouched (STACK.md: "Keep SDL/NanoVG operational as the comparison baseline"). Reuse from `core/Document.cpp` by *reading*, not linking: the scratch-path helper and round-trip test style `[VERIFIED: tapestry/tests/DocumentTest.cpp:33-44]`, the foreign-file refusal test, the full-precision double intent. Do **not** reuse its `%.17g` formatting (prints `0.10000000000000001` for `0.1`), its `\n` escaping of bodies (`[VERIFIED: tapestry/core/Document.cpp:17-44]`), or its "unknown key — refuse rather than silently drop" rule (`[VERIFIED: tapestry/core/Document.cpp:419]`) — for `.tree`, unknown *header lines* must be preserved, while unknown *op verbs* must stop the load loudly.

### Pattern 1: Single-writer transaction kernel (validate → durable write → apply → publish)

**What:** `Kernel::submit(Proposal)` is the only mutation path. Order is strict: validate everything against current state; build the complete record in memory; write it durably; only then apply to in-memory state. A failed write applies nothing.
**When to use:** every state change in Phase 1 (tests and the demo CLI) and, unchanged, for plugin proposals in Phase 2 (PLUG-06 "failed transactions leave the prior state intact").
**Example:**

```cpp
// kernel/Kernel.hpp — proposed public shape (planner may rename)
struct Proposal {
    Actor actor;                 // {kind: human|plugin|system, id: "kaelen"}
    std::vector<Op> ops;         // CreateNode{type, props}, Set{id, key, Value}, CreateEdge{...}, Advance{ticks} ...
    std::string message;         // optional, readable; e.g. "corrected dinner date"
};
struct CommitResult { bool ok; CommitSeq seq; Digest digest; std::vector<AssignedId> ids; Diagnostic error; };

class Kernel {
public:
    static Expected<Kernel, OpenDiagnostic> open(std::filesystem::path tree, OpenPolicy);  // OpenPolicy::RefuseTorn|ReadOnly
    CommitResult submit(const Proposal&);   // validate → encode → sink.write → sink.sync → apply → return
    const World& world() const;
    const JournalStatus& status() const;    // OK | TORN_TAIL{offset,bytes} | CORRUPT{seq,offset,reason}
    RepairResult repair();                  // moves torn tail to <file>.torn-<recordedAt>, truncates, fsyncs, logs
};
```

### Pattern 2: `.tree` record grammar — byte-counted envelope, line headers, delimited text blocks

**What:** The file is a sequence of records. Each record is a header line with a byte count, N bytes of `key value` lines, and a trailer with the SHA-256 of those bytes. Multi-line text uses git-fast-import's delimited form *inside* the counted envelope, so humans see raw text and machines never mis-frame. `[CITED: git-scm.com/docs/git-fast-import — "data" command: exact byte-count form "is more robust", delimited form requires the delimiter "must not appear on a line by itself within <raw>"]`
**When to use:** all durable records. This is the recommended resolution of STATE.md's "line-oriented vs block framing" item — planner decision, see Open Question 1.

Proposed grammar (v1). Tokens are space-separated; keys are lowercase ASCII; the file is UTF-8 with `\n` line endings; no BOM; no tabs in structural lines.

```text
@tree 1 <bytes>                      # header record, once, first bytes of the file
world <slug>                         #   human-chosen world name (not an id)
created <rfc3339-utc>
@end sha256:<64 hex>                 # digest of "@tree ...\n" .. last byte before "@end"

@commit <seq> <bytes>                # seq: 1,2,3… per branch; bytes: exact byte count of the lines between this line and @end
parent sha256:<64 hex>               # digest of the previous record on this branch (the @tree record for seq 1)
branch main                          # Phase 3 adds: "fork-of sha256:<digest>" on the first commit of a new branch
recorded 2026-09-08T21:15:07Z        # wall clock, UTC, audit only — never used for ordering
tick 0                               # simulation tick this commit applies at; kernel-controlled, monotone non-decreasing
actor human kaelen                   # <kind> <id>; kinds: human | plugin | system
message "why (optional)"
create-node n1 tapestry.notes/note@1 # <id> <type>: type is a namespaced string, opaque to the kernel
set n1 title text "Sam"
set n1 body text <<TEXT
Met Sam at dinner.
Loves architecture and weird bird memes.
TEXT
set n1 event time 2026-09-07         # domain time: EDTF Level 0/1 or RFC 3339; readable, editable
create-node n2 example.people/person@2
set n2 name text "Sam"
set n2 anger int 3
set n2 position real2 12.5 -3        # (optional Phase 1 type; otherwise two reals)
create-edge e1 n1 n2 mentions
set e1 note text "first meeting"
x-example.people mood "curious"      # unknown header line: preserved verbatim, reported, never dropped
@end sha256:<64 hex>
```

Typed values (the only value forms the kernel knows; plugins compose everything from them):

| Type | Encoding | Notes |
|------|----------|-------|
| `text` | `"…"` on one line with JSON-string escapes (`\" \\ \n \t \uXXXX` for controls only), **or** `<<DELIM … DELIM` block when the text contains a newline or exceeds ~80 bytes | Writer picks `TEXT`, then `TEXT1`, `TEXT2`… until no body line equals the delimiter (fast-import rule). Block content is raw UTF-8; the LF before `DELIM` is not part of the value. |
| `int` | decimal int64 | |
| `real` | `std::to_chars` shortest round-trip | never `%.17g`; `nan`/`inf` rejected (JCS also rejects them `[CITED: rfc-editor.org/rfc/rfc8785]`) |
| `bool` | `true`/`false` | |
| `ref` | `n<k>` / `e<k>` | must exist at validation time |
| `time` | EDTF L0/L1 or RFC 3339 string, unquoted | e.g. `2026-09-07`, `2004-06~`, `1999-03-XX`, `2026-09-08T21:15:07Z` |

Reader rules: unknown header keys (anything not in the v1 key set, conventionally `x-…`) → preserve verbatim in order, count as diagnostics; unknown **op verbs** → stop, report `UNSUPPORTED_OP{seq, verb}` (a newer Tapestry wrote it) — never skip; unknown **node types** → load normally (types are strings). Limits: max record 64 MiB, max line 1 MiB, reject NUL bytes and invalid UTF-8 (`[ASSUMED]` limits; planner may adjust).

### Pattern 3: Durable append = buffer whole envelope → one `write` → `F_FULLFSYNC` → acknowledge

**What:** Never write a partial record; never acknowledge before the drive flush. On macOS `fsync` alone "may find that only some or none of their data was written" after power loss; `F_FULLFSYNC` "asks the drive to flush all buffered data to permanent storage" `[CITED: developer.apple.com fsync(2) man page]`. SQLite assumes sector writes are not atomic, that "write operations will be reordered by the operating system", and syncs the containing directory after creating a file `[CITED: sqlite.org/atomiccommit.html §2, §9.5]`.
**When to use:** every commit; file creation (`@tree` record) additionally fsyncs the parent directory; `repair()` uses write-sidecar → fsync sidecar → fsync dir → `ftruncate` journal → `F_FULLFSYNC`.
**Example:**

```cpp
// kernel/journal/Sink.hpp
struct Sink {
    virtual ~Sink() = default;
    virtual Expected<void, IoError> write(std::span<const std::byte>) = 0;  // loop until all bytes written
    virtual Expected<void, IoError> sync() = 0;                              // PosixSink: fcntl(fd, F_FULLFSYNC); fallback fsync if EINVAL/ENOTSUP
    virtual std::uint64_t size() const = 0;
};
// kernel/journal/Journal.cpp — append
Expected<Digest, IoError> Journal::append(const CommitRecord& rec) {
    const std::vector<std::byte> bytes = tree::encode(rec);       // includes "@commit", body, "@end sha256:..."
    if (status_.kind != JournalStatus::OK) return Unexpected(IoError::RefusedNotClean);
    if (auto r = sink_->write(bytes); !r) return Unexpected(r.error());
    if (auto r = sink_->sync();       !r) return Unexpected(r.error());
    lastDigest_ = rec.digest; lastSeq_ = rec.seq;
    return rec.digest;                                                 // only now may the kernel apply to World
}
```

`F_FULLFSYNC` verified to return 0 on this machine `[VERIFIED: /tmp/cxx20probe/fs.cpp]`; `F_BARRIERFSYNC` exists on Darwin and is cheaper but only orders writes, it does not guarantee durability — do not substitute it `[ASSUMED, web search only]`.

### Pattern 4: Open-time classification — OK / TORN_TAIL / CORRUPT — with no silent repair

**What:** Scan sequentially. A record is valid iff: `@commit`/`@tree` line parses, at least `<bytes>` bytes follow, the next line is `@end sha256:<hex>`, the digest of the counted bytes equals `<hex>`, `parent` equals the previous record's digest, and `seq` is previous+1. The first failure decides the class: at EOF with no further complete record → **TORN_TAIL** (the unacknowledged write); anywhere else → **CORRUPT**. Load the valid prefix in both cases; expose class + offsets; refuse appends until `repair()` (TORN) or forever (CORRUPT, until a human intervenes). This is the raft-wal/Cassandra distinction: torn writes lose only un-acknowledged records and are safe to truncate; corruption of committed records is a different class `[CITED: github.com/hashicorp/raft-wal README; web search MEDIUM]`.
**When to use:** every `Kernel::open`. Tests: the truncation sweep must produce only OK or TORN_TAIL; the bit-flip sweep must produce TORN_TAIL (last record) or CORRUPT, never OK.

### Pattern 5: Unknown data round-trips byte-identically; digest over stored bytes (no canonicalization in Phase 1)

**What:** Records are immutable once written, so the digest is over the bytes as written, exactly like git hashes object bytes. Decoding keeps unknown header lines verbatim (ordered) and keeps every value's original text so `save-as` re-emits identical bytes. Canonical *state* serialization (properties sorted by key, same typed writer, extension lines re-emitted verbatim in original order) is specified now but only exercised by snapshots in Phase 3. This closes STATE.md's "canonical hashing of unknown extension fields" item without JCS.
**When to use:** `codec_test`: for every fixture, `decode → encode` must equal input bytes; `kernel_test`: `open(a) → saveAs(b)` then `cmp a b`.

### Pattern 6: Stable, readable, kernel-assigned identifiers

**What:** `n<k>`/`e<k>` counters per world, assigned by the kernel at commit time and written into the committed op (`create-node n7 …`), so replay never re-derives them (ARCHITECTURE.md: "Committed operations contain assigned IDs"). Loading restores counters from the max id seen (as `World::adopt` does today `[VERIFIED: tapestry/core/World.cpp:120-126]`). Deleted ids are never reused. Phase 3 rule (record now in FORMAT.md, do not implement): ids allocated after a fork carry the branch tag (`b2.n12`) so branches never collide; `main` stays unprefixed.
**When to use:** all node/edge creation. Planner decision vs ULID/UUIDv7 — see Open Question 3.

### Pattern 7: Three kinds of time, three names, three places

| Field | Where | Format | Who sets | Readable meaning |
|-------|-------|--------|----------|------------------|
| `recorded` | commit header | RFC 3339 UTC with `Z` (`date-time = full-date "T" full-time`; UTC recommended for interoperability `[CITED: rfc-editor.org/rfc/rfc3339 §5.6]`) | kernel clock at commit; **never** used for ordering (`seq`/`parent` order) | "when this change was written down (or corrected)" |
| `tick` | commit header | unsigned integer | kernel; changes only via `advance <n>` op | "the simulation step this applies at" |
| `event` | node property via `set <id> event time …` | EDTF Level 0/1 (`1984?`, `2004-06~`, `1999-03-XX`) or RFC 3339 `[CITED: id.loc.gov/datatypes/edtf/EDTF-level1.html via search; examples MEDIUM]` | the user/plugin, through an op | "when the thing happened, possibly partial or uncertain" |

A correction is a new commit that `set`s `event` again; the earlier commit keeps the old value with its own `recorded`. The reader distinguishes the three by name and location alone — no legend required. Test: write, correct, reopen; assert both values appear in the file with two different `recorded` stamps and that the world shows the corrected one.

### Anti-Patterns to Avoid
- **Escaping note bodies into single lines** (`pbody line one\nline two` as the prototype does `[VERIFIED: tapestry/core/Document.cpp:17-44]`): defeats TREE-01 for anything longer than a sentence. Use blocks.
- **Refusing files with unknown keys** (prototype: "unknown key — refuse rather than silently drop" `[VERIFIED: tapestry/core/Document.cpp:419]`): correct instinct for *op verbs*, wrong for plugin/extension header lines, which must survive.
- **Stopping at the first corrupt block and silently keeping what came before** (prototype `readAccumulated` `[VERIFIED: tapestry/core/Document.cpp:449]`): silently accepting a truncated history is exactly what TREE-03 forbids; classify and report.
- **`std::ofstream` + `<<` for durable writes**: no control over partial writes, no fsync; use `write(2)` behind `Sink`.
- **`%.17g`, `printf("%g")`, `strtod`, `std::stod`, `iostream` numeric I/O** in the codec: locale-dependent or non-shortest; verified failure under `de_DE`.
- **Feature classes in the kernel** (`Page`, `Stroke`, `PageKind` enum `[VERIFIED: tapestry/core/Page.hpp:15-20]`): notes and drawings are plugin node types with typed properties.
- **Applying ops to `World` before the sync returns**: a crash between apply and sync yields state the file does not contain.
- **Using `recorded` for ordering or as an id**: clocks tie and go backwards; only `seq`/`parent` order.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 | your own compression function | vendored PicoSHA2 (+ KAT test; CommonCrypto cross-check on macOS in tests) | ASVS V6: never hand-roll crypto; KAT verified locally |
| Shortest round-trip double text | Grisu/Ryu port or `%.17g` | `std::to_chars(double)` | Verified correct and locale-proof on this toolchain; GCC ≥ 11 / MSVC also have it `[ASSUMED]` |
| Locale-safe double parsing | ad-hoc decimal parser | `std::from_chars` if `__cpp_lib_to_chars`, else `strtod_l` with a `newlocale(LC_NUMERIC_MASK,"C",nullptr)` handle | Apple libc++ lacks FP `from_chars`; `strtod` is locale-dependent `[VERIFIED]` |
| Test runner, filtering, CTest registration | custom `check()` counters | doctest + `doctest_discover_tests` | Verified working offline; per-case `-tc=`/`-ts=` filters |
| Durability | "it's on disk after `close()`" | `write` → `fcntl(F_FULLFSYNC)`; dir `fsync` on create/rename | Apple man page and SQLite both document why |
| Single-writer exclusion | pid files | `flock(LOCK_EX\|LOCK_NB)` on the journal fd | Verified; released automatically on process death |
| Partial/uncertain dates | custom "year-only" flags | EDTF Level 0/1 strings (validated by a small grammar) | Library of Congress standard, ISO 8601-2 profile; keeps `event` readable |
| Wall-clock format | custom | RFC 3339 with `Z` | Universally parseable |

**Key insight:** every one of these has a subtle correctness edge (locale, rounding, reordering, torn sectors) that only shows up on another machine or after a crash — precisely where Tapestry's promise is tested.

## Runtime State Inventory

Omitted — greenfield phase; no rename/refactor/migration. The legacy `.tapestry` files are not migrated (REQUIREMENTS.md Out of Scope: "Immediate compatibility with every old .tapestry file … not requested").

## Common Pitfalls

### Pitfall 1: The long-note readability trap
**What goes wrong:** Bodies get JSON/backslash-escaped into one line; a 40-line note becomes an unreadable 3 KB line (STATE.md open item).
**Why it happens:** Line-oriented parsers are easiest when every value is one line.
**How to avoid:** Delimited blocks inside a byte-counted envelope (Pattern 2); writer switches to a block whenever the text contains `\n`.
**Warning signs:** `\n` appears in the golden fixture; `readability_test` greps for `\\n` and fails.

### Pitfall 2: Apple libc++ 15 is not "full C++20"
**What goes wrong:** Code using `std::from_chars(double)`, `std::format`, or `std::source_location` fails to compile on this machine even though `__cplusplus == 202002`.
**Why it happens:** Apple clang 14.0.3 ships libc++ 15006 with those parts disabled `[VERIFIED: /tmp/cxx20probe — from_chars(double) "explicitly deleted"; `std::format` "no member named 'format'"; `<source_location>` absent]`.
**How to avoid:** Confine numeric text conversion to `kernel/Value.cpp` with feature-test guards; no `<format>`; own tiny `Diagnostic{file,line}` macro.
**Warning signs:** compile errors mentioning `charconv:116` or `no member named 'format'`.

### Pitfall 3: Locale silently corrupts numbers
**What goes wrong:** `strtod("1.5")` returns `1` after any component calls `setlocale(LC_ALL, "")` (Electron/Qt hosts and some CLIs do).
**Why it happens:** C `strtod`/`printf` honour `LC_NUMERIC` `[VERIFIED: de_DE probe]`.
**How to avoid:** Pattern in Don't-Hand-Roll; add `value_test` that sets `de_DE.UTF-8` and round-trips `1.5`, `-0.0`, `1e300`, `4.35`.
**Warning signs:** positions truncated to integers after opening the world from an app.

### Pitfall 4: `fsync` is not durability on macOS; `F_BARRIERFSYNC` is not either
**What goes wrong:** Power loss after a "successful" save loses the last commits.
**Why it happens:** Apple's `fsync` flushes to the drive cache only `[CITED: fsync(2)]`; Apple's SQLite swaps `F_FULLFSYNC` for the barrier variant for speed `[web search, LOW]`.
**How to avoid:** `F_FULLFSYNC` in `PosixSink::sync`; `Sink` seam test asserts `sync()` is called after every `write()` before `submit` returns.
**Warning signs:** commit latency < 1 ms on a laptop SSD (a full flush typically costs milliseconds `[ASSUMED]`).

### Pitfall 5: Torn tail treated as "corrupt, refuse to open" (or worse, "fine, ignore")
**What goes wrong:** Either the user loses access to their whole world because of 300 dangling bytes, or partial history is accepted silently.
**Why it happens:** No distinction between unacknowledged tail and damaged committed record.
**How to avoid:** Pattern 4; sidecar-preserving `repair()`; kernel refuses `submit` while status ≠ OK.
**Warning signs:** `open()` returns a `World` without a `JournalStatus`; tests never construct a torn file.

### Pitfall 6: Digest over re-serialized structures instead of stored bytes
**What goes wrong:** Round-tripping a record through the struct changes whitespace/number text, digest mismatches, every file looks corrupt after a codec tweak.
**Why it happens:** Canonicalization ambition without an immutable-bytes rule.
**How to avoid:** Pattern 5; keep original text of every value in the decoded struct; assert `encode(decode(x)) == x` for all fixtures.
**Warning signs:** a "normalize" function in the encoder; digests computed from `CommitRecord` rather than from the byte buffer.

### Pitfall 7: The kernel target silently depends on the renderer
**What goes wrong:** `tapestry_core` links `nanovg` → `glad` → configure needs Python+Jinja2+network `[VERIFIED: tapestry/CMakeLists.txt:52-57,65-76]`; a "headless kernel" that inherits this cannot build in CI or offline.
**Why it happens:** `render/*.cpp` are compiled into `tapestry_core`.
**How to avoid:** New `tapestry_kernel` target with `kernel/` sources only; gate `FetchContent(glad)`, `third_party` nanovg, `tapestry_core` and legacy tests behind `TAPESTRY_BUILD_RENDER`. Verify: `nm -u tapestry/build-kernel/libtapestry_kernel.a | grep -ci 'nvg\|glad'` prints `0`.
**Warning signs:** `include "core/…"` or `render/…` inside `kernel/`.

### Pitfall 8: Unknown op verb skipped "for forward compatibility"
**What goes wrong:** A file written by a newer Tapestry loads with holes; later commits reference ids that were never created; state diverges from history silently.
**Why it happens:** Conflating "unknown plugin data" (must survive) with "unknown kernel operation" (cannot be applied).
**How to avoid:** Two rules, two tests (Pattern 2 reader rules).
**Warning signs:** a `default: continue;` in the op switch.

## Code Examples

### CMake: rendering-independent kernel + vendored doctest with CTest discovery
```cmake
# Source: verified skeleton at /tmp/dtcmake (configure offline, build 1.8 s, 3 cases discovered)
option(TAPESTRY_BUILD_RENDER "Build glad/nanovg, the legacy tapestry_core and its tests" ON)

add_library(tapestry_kernel STATIC
    kernel/Value.cpp kernel/Time.cpp kernel/World.cpp
    kernel/tree/Encoder.cpp kernel/tree/Decoder.cpp
    kernel/journal/Journal.cpp kernel/Kernel.cpp)
target_include_directories(tapestry_kernel PUBLIC ${PROJECT_SOURCE_DIR})
target_include_directories(tapestry_kernel SYSTEM PRIVATE ${PROJECT_SOURCE_DIR}/third_party/picosha2)
target_link_libraries(tapestry_kernel PUBLIC tapestry_settings)   # same warning/determinism flags, no nanovg

add_library(doctest INTERFACE)
target_include_directories(doctest SYSTEM INTERFACE ${PROJECT_SOURCE_DIR}/third_party/doctest)
add_library(doctest::doctest ALIAS doctest)

if(TAPESTRY_BUILD_TESTS)
    enable_testing()
    add_executable(tapestry_kernel_tests
        kernel_tests/main.cpp kernel_tests/value_test.cpp kernel_tests/codec_test.cpp
        kernel_tests/journal_test.cpp kernel_tests/kernel_test.cpp kernel_tests/readability_test.cpp)
    target_link_libraries(tapestry_kernel_tests PRIVATE tapestry_kernel doctest::doctest)
    target_compile_definitions(tapestry_kernel_tests PRIVATE
        TAPESTRY_FIXTURE_DIR="${PROJECT_SOURCE_DIR}/docs/tree")
    include(${PROJECT_SOURCE_DIR}/third_party/doctest/doctest.cmake)
    doctest_discover_tests(tapestry_kernel_tests)
endif()

if(TAPESTRY_BUILD_RENDER)
    include(FetchContent)            # glad clone + Python/Jinja2 only here
    # ... existing glad / add_subdirectory(third_party) / tapestry_core / app / legacy tests ...
endif()
```

```cpp
// kernel_tests/main.cpp
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
```

### Numbers: shortest round-trip out, locale-proof in
```cpp
// Source: verified behaviour on Apple clang 14 (/tmp/cxx20probe/loc.cpp)
#include <charconv>
#include <clocale>
#include <cstdlib>
#include <xlocale.h>   // macOS/BSD; <locale.h> on glibc

std::string formatReal(double v) {                 // never NaN/Inf (validated earlier)
    char buf[64];
    auto r = std::to_chars(buf, buf + sizeof buf, v);   // "1.5", "0.30000000000000004", "1e+300"
    return std::string(buf, r.ptr);
}
std::optional<double> parseReal(std::string_view s) {
#if defined(__cpp_lib_to_chars) && __cpp_lib_to_chars >= 201611L
    double v; auto r = std::from_chars(s.data(), s.data() + s.size(), v);
    if (r.ec != std::errc{} || r.ptr != s.data() + s.size()) return std::nullopt;
    return v;
#else
    static locale_t cLoc = newlocale(LC_NUMERIC_MASK, "C", nullptr);   // [ASSUMED] portable POSIX.2008
    std::string z(s); char* end = nullptr;
    double v = strtod_l(z.c_str(), &end, cLoc);
    if (end != z.c_str() + z.size() || z.empty()) return std::nullopt;
    return v;
#endif
}
```

### Encoder: byte-counted envelope, block selection, digest
```cpp
// Source: grammar in Pattern 2; delimiter rule from git-fast-import "data" docs
std::vector<std::byte> tree::encode(const CommitRecord& rec) {
    std::string body;
    body += "parent sha256:" + rec.parent.hex + '\n';
    body += "branch " + rec.branch + '\n';
    body += "recorded " + rec.recorded.rfc3339Z() + '\n';
    body += "tick " + std::to_string(rec.tick) + '\n';
    body += "actor " + rec.actor.kind + ' ' + rec.actor.id + '\n';
    if (!rec.message.empty()) body += "message " + quoteText(rec.message) + '\n';
    for (const Op& op : rec.ops) body += encodeOp(op);            // set n1 body text <<TEXT ... TEXT
    for (const std::string& line : rec.unknownLines) body += line + '\n';   // verbatim, original order
    std::string head = "@commit " + std::to_string(rec.seq) + ' ' + std::to_string(body.size()) + '\n';
    std::string counted = head + body;
    std::string digest = picosha2::hash256_hex_string(counted);   // over head+body exactly as written
    counted += "@end sha256:" + digest + '\n';
    return toBytes(counted);
}
std::string blockDelimiter(std::string_view text) {               // "TEXT", "TEXT1", ... until unique
    for (int i = 0;; ++i) {
        std::string d = i == 0 ? "TEXT" : "TEXT" + std::to_string(i);
        if (!hasLineEqualTo(text, d)) return d;
    }
}
```

### Failure-injection sinks and the truncation sweep
```cpp
// kernel_tests/journal_test.cpp — Source: design derived from ALICE crash-state exploration
// (micro-ops: write block / change file size; explore every legal prefix)  [CITED: blog.acolyer.org/2016/02/11/fs-not-equal/]
struct RecordingSink : Sink { std::vector<std::string> calls; std::string data; /* write→"w", sync→"s" */ };
struct TruncatingSink : Sink { std::size_t failAfter; /* writes only failAfter bytes, then returns IoError */ };
struct FailingSyncSink : Sink { /* sync() returns IoError::Io */ };

TEST_CASE("journal: every commit is written then synced before submit returns") {
    auto k = Kernel::openWithSink(std::make_unique<RecordingSink>(), OpenPolicy::New);
    k.submit(sampleProposal());
    CHECK(sink.calls == std::vector<std::string>{"w", "s"});     // exactly one write, one sync, in order
}
TEST_CASE("journal: exhaustive prefix truncation never accepts a partial record") {
    const std::string full = buildJournalBytes(5 /*commits*/);      // ~2 KB
    const auto boundaries = recordEndOffsets(full);                 // offsets after each "@end ...\n"
    for (std::size_t len = 0; len <= full.size(); ++len) {
        writeFile(tmp, full.substr(0, len));
        auto r = Kernel::open(tmp, OpenPolicy::ReadOnly);
        const std::size_t expectedCommits = countBoundariesAtOrBelow(boundaries, len);
        CHECK(r.status.kind == (isBoundary(len) ? Status::OK : Status::TORN_TAIL));
        CHECK(r.world.commitCount() == expectedCommits);            // never more, never fewer
        if (!isBoundary(len)) CHECK(r.status.tornOffset == lastBoundaryBelow(len));
    }
}
TEST_CASE("journal: single-byte corruption is never accepted") {
    const std::string full = buildJournalBytes(3);
    for (std::size_t i = 0; i < full.size(); ++i) {
        std::string bad = full; bad[i] ^= 0x01;
        writeFile(tmp, bad);
        auto r = Kernel::open(tmp, OpenPolicy::ReadOnly);
        CHECK(r.status.kind != Status::OK);
        CHECK(r.world.commitCount() < 3);
    }
}
TEST_CASE("journal: appends are refused while torn; repair preserves the tail in a sidecar") { /* ... */ }
TEST_CASE("journal: second opener is rejected by flock") { /* open twice; expect Locked */ }
```

### Readability golden test (TREE-01, TREE-04)
```cpp
TEST_CASE("readability: the golden world matches docs/tree/example.tree byte for byte") {
    auto k = Kernel::create(tmp, "example", fixedClock("2026-09-08T21:15:07Z"));
    buildGoldenWorld(k);                                            // Sam, dinner, concept, edges, one correction
    CHECK(readFile(tmp) == readFile(TAPESTRY_FIXTURE_DIR "/example.tree"));
    const std::string text = readFile(tmp);
    for (auto needle : {"branch main", "parent sha256:", "recorded 2026-", "tick 0", "actor human ",
                        "create-node n1 ", "create-edge e1 n1 n2 ", "set n1 event time 2026-09-07",
                        "<<TEXT\nMet Sam at dinner.\n"})
        CHECK_MESSAGE(text.find(needle) != std::string::npos, needle);
    CHECK(text.find("\\n") == std::string::npos);                   // no escaped newlines anywhere
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Prototype `.tapestry`: baseline + diffed deltas, `\n`-escaped bodies, `%.17g`, no digests, stop-at-first-bad-block `[VERIFIED: tapestry/core/Document.cpp]` | `.tree`: append-only commits, blocks for text, shortest-round-trip reals, SHA-256 chain, explicit TORN/CORRUPT | this phase | Readability and crash semantics become testable guarantees |
| Feature-specific `World` (pages, strokes, `PageKind`) | Generic nodes/edges/typed properties; types are namespaced strings | this phase | Plugins own meaning; kernel stays small |
| `fsync` = durable | `F_FULLFSYNC` on Darwin | long-standing Apple guidance | Commit cost is a real flush; batch when needed (group commit later) |
| `%.17g` / `printf` doubles | `std::to_chars` shortest | C++17 lib feature, available here | Human-readable `0.1`, exact round-trip |
| Hand-rolled `check()` tests | doctest + CTest discovery | this phase | Per-case quick runs for Nyquist sampling |

**Deprecated/outdated:**
- RFC 7464 "skip to next RS" resilience — inappropriate for authoritative history (TREE-03).
- EDTF lower-case `u` for unspecified digits — superseded by upper-case `X` `[web search, MEDIUM]`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `newlocale(LC_NUMERIC_MASK,"C")` + `strtod_l` is a portable fallback on Linux/BSD (MSVC uses `_create_locale`/`_strtod_l`) | Standard Stack / Code Examples | Non-macOS builds need a different guard; confined to `Value.cpp` |
| A2 | GCC ≥ 11 and MSVC provide `std::to_chars(double)`; only Apple libc++ lacks `from_chars(double)` | Don't Hand-Roll | Would need a vendored Ryu/fast_float later; no Phase 1 impact on macOS |
| A3 | On APFS, after `F_FULLFSYNC` returns, the appended bytes and file size are durable; before it, a torn tail may contain zeros or garbage (SQLite's non-atomic-sector assumption) | Pattern 3/4 | Design already tolerates garbage tails; only performance expectations change |
| A4 | `F_BARRIERFSYNC` orders but does not guarantee durability | Pitfall 4 | Only matters if someone proposes it as an optimization |
| A5 | EDTF Level 1 examples (`1984?`, `2004-06~`, `1999-03-XX`, `201X-XX`) and `%` = uncertain+approximate are accurate (loc.gov returned 403 to fetch; examples come from search snippets of id.loc.gov and edtf-ruby) | Pattern 7 | Grammar for `time` values may need correction before FORMAT.md is final |
| A6 | Sequential per-world ids with future per-branch tags are sufficient and never need global uniqueness (no merge, no multi-world references in v1) | Pattern 6 | Phase 3 could require ULID-style ids; migration = one op verb change |
| A7 | Record/line size limits (64 MiB / 1 MiB) are adequate for v1 notes and attachments-as-references | Pattern 2 | Adjustable constants |
| A8 | Full-flush commit latency on Apple SSDs is milliseconds, acceptable for interactive single-commit saves without group commit | Pitfall 4 | Phase 2 bridge may need batching; kernel API should accept multi-op proposals already (it does) |
| A9 | doctest's `doctest_discover_tests` works with CMake 4.x unchanged (verified with 4.4.1 locally; not tested on older 3.24) | Validation Architecture | CI on CMake 3.24 might need `DISCOVERY_MODE` tweaks |
| A10 | The proposed `.tree` grammar (Pattern 2) satisfies the readability criterion for real users; this is a design proposal, not a verified user finding | Pattern 2 | Planner should include a human-verify checkpoint reading `example.tree` cold |

## Open Questions

1. **Record framing: byte-counted line format with blocks (recommended) vs JSON Lines (ARCHITECTURE.md provisional)**
   - What we know: JSON Lines needs JCS + duplicate-key rejection + shortest-float writer that nlohmann lacks, and escapes every newline; the block format is readable and its digest needs no canonicalization.
   - What's unclear: whether Phase 2's TS host would prefer JSON for its own parsing convenience.
   - Recommendation: block format for `.tree`; the host talks to the kernel over its own protocol (JSON there is fine). Planner decision; record in PLAN as a locked design once chosen.
2. **Digest scope and display:** full 64-hex SHA-256 in `parent`/`@end` (recommended, unambiguous) vs abbreviated hashes plus `seq`.
   - Recommendation: full hex; `seq` already gives humans a short handle.
3. **ID scheme:** `n<k>`/`e<k>` sequential (recommended) vs ULID/UUIDv7.
   - Recommendation: sequential, with the Phase 3 branch-tag rule documented in FORMAT.md now.
4. **Torn-tail repair policy:** kernel `repair()` moves the tail to `<file>.torn-<recordedAt>` and truncates (recommended) vs never truncating and always appending after a `@recover` marker.
   - Recommendation: sidecar + truncate, invoked explicitly by the caller (tests/CLI), never automatically on open.
5. **Hand-edited files:** a digest mismatch caused by a manual edit is indistinguishable from corruption in Phase 1.
   - Recommendation: report CORRUPT with offset; ARCHITECTURE.md's "import external edits as a new branch" belongs to Phase 3.
6. **Minimal op set for the tracer slice:** `create-node`, `set`, `create-edge` first; `unset`, `delete-node`, `delete-edge`, `advance` in the second plan. `real2` (vector) type: include only if the planner wants positions in Phase 1; otherwise two `real` properties.
7. **`recorded` precision:** seconds (recommended for readability) vs milliseconds (RFC 3339 allows `time-secfrac`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| CMake | build | ✓ | 4.4.1 (`/opt/homebrew/bin/cmake`) | — |
| CTest | tests | ✓ | 4.4.1 | — |
| Apple clang / libc++ | C++20 kernel | ✓ | Apple clang 14.0.3, libc++ 15006, SDK 13.3, CLT at `/Library/Developer/CommandLineTools` | — (note Pitfall 2 gaps) |
| GNU make | default generator | ✓ | `/usr/bin/make` | — |
| ninja | faster builds | ✗ | — | Makefiles (verified) |
| Python 3 + Jinja2 | glad generation (render only) | ✓ | 3.9.6, jinja2 3.1.5 | not needed for kernel-only builds |
| Network at configure | glad `FetchContent` (render only) | ✓ (worked) | — | kernel-only build must not need it |
| git | commits | ✓ | 2.39.2 (Apple Git-143) | — |
| SDL2 | legacy app only | ✓ via brew `sdl2-compat` | — | not needed in Phase 1 |
| `F_FULLFSYNC`, `flock` | journal durability/lock | ✓ | macOS 26.5.2 | — |
| Context7 MCP / `ctx7` CLI | docs lookup | ✗ | — | WebFetch of official docs (used) |
| Catch2 / GoogleTest / doctest system packages | — | ✗ (brew has none) | — | vendored doctest (verified) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** ninja (use Makefiles); Context7 (used official docs via WebFetch).

**Verified build/test commands (run 2026-09-08 from the workspace root; outputs recorded):**

```bash
# Existing prototype (reference baseline) — configure 5.0 s, build ~4.5 s, 3/3 tests pass in 1.3 s
cmake -S /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry -B /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build -DTAPESTRY_BUILD_APP=OFF
cmake --build /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build -j 8
ctest --test-dir /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build --output-on-failure
#   -> "100% tests passed out of 3" (camera, world, document)
ctest --test-dir /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build -R '^document$' --output-on-failure
#   -> "100% tests passed out of 1"
```

`tapestry/build/` is git-ignored `[VERIFIED: tapestry/.gitignore:1]`. After the kernel target exists, the kernel-only commands (to be added by Wave 0) are:

```bash
cmake -S /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry -B /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel -DTAPESTRY_BUILD_APP=OFF -DTAPESTRY_BUILD_RENDER=OFF
cmake --build /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel -j 8
ctest --test-dir /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel --output-on-failure
nm -u /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel/libtapestry_kernel.a | grep -ci 'nvg\|glad'   # expect 0
```

(Add `build-kernel/` to `tapestry/.gitignore`, or build into `build/` with the same flags.)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | doctest v2.5.3, vendored single header + `doctest.cmake`/`doctestAddTests.cmake` (verified offline build + CTest discovery) |
| Config file | none — see Wave 0 (CMake target `tapestry_kernel_tests` + `doctest_discover_tests`) |
| Quick run command | `/Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel/tapestry_kernel_tests -ts=<suite>` or `-tc="<case name>"` (verified filters on the skeleton) |
| Full suite command | `cmake --build /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel -j 8 && ctest --test-dir /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel --output-on-failure` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TREE-01 | Golden `example.tree` byte-identical; literal `branch`/`parent`/`actor`/`recorded`/`tick`/op lines present; no `\n` escapes; multi-line body raw | golden + assertion | `tapestry_kernel_tests -ts=readability` | ❌ Wave 0 |
| TREE-01 | A human can read it cold | manual (checkpoint:human-verify) | open `docs/tree/example.tree` in a text editor, answer 5 questions (who, what, connected to what, when recorded vs happened, which branch) | ❌ Wave 0 (fixture) |
| TREE-02 | Save → reopen equals; ids stable; new ids never collide; unknown node type + unknown `x-` lines survive `open → saveAs` byte-identical | unit | `tapestry_kernel_tests -ts=codec -ts=kernel` | ❌ Wave 0 |
| TREE-03 | Exhaustive truncation sweep: only OK/TORN_TAIL, prefix exact; bit-flip sweep: never OK; write→sync order; failed sync leaves state untouched; torn refuses append; repair preserves sidecar; second opener locked out | unit + property | `tapestry_kernel_tests -ts=journal` | ❌ Wave 0 |
| TREE-04 | `recorded`, `tick`, `event` all present and distinguishable; correction keeps both values with distinct `recorded`; `tick` only changes via `advance` | unit + golden grep | `tapestry_kernel_tests -tc="kernel: three kinds of time*"` | ❌ Wave 0 |
| (cross) | Kernel has no renderer symbols | build check | `nm -u …/libtapestry_kernel.a \| grep -ci 'nvg\|glad'` → `0` | ❌ Wave 0 |
| (cross) | Number formatting/parsing locale-proof; SHA-256 KAT | unit | `tapestry_kernel_tests -ts=value` | ❌ Wave 0 |
| (regression) | Legacy prototype still builds and passes | CTest | existing `ctest --test-dir …/tapestry/build` (3 tests) | ✅ |

### Sampling Rate
- **Per task commit:** `cmake --build …/build-kernel -j 8 && …/build-kernel/tapestry_kernel_tests -ts=<suite touched>`
- **Per wave merge:** full suite command above (kernel) + legacy `ctest --test-dir …/tapestry/build`
- **Phase gate:** full suite green + golden fixture unchanged (or intentionally regenerated with a commit message) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tapestry/third_party/doctest/{doctest.h,doctest.cmake,doctestAddTests.cmake,LICENSE.txt}` — vendored v2.5.3
- [ ] `tapestry/third_party/picosha2/{picosha2.h,LICENSE}` — vendored, pinned commit noted in CMake comment
- [ ] `tapestry/CMakeLists.txt` — `TAPESTRY_BUILD_RENDER` option, `tapestry_kernel`, `tapestry_kernel_tests`, `doctest_discover_tests`
- [ ] `tapestry/kernel_tests/main.cpp` — `DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN`
- [ ] `tapestry/kernel_tests/support.hpp` — scratch path helper (port of `DocumentTest.cpp:33-45`), `readFile`/`writeFile`, `RecordingSink`/`TruncatingSink`/`FailingSyncSink`, fixed clock
- [ ] `tapestry/kernel_tests/value_test.cpp` — SHA-256 KAT (`abc` → `ba7816bf…`), `to_chars` cases, `de_DE` locale round-trip
- [ ] `tapestry/docs/tree/example.tree` + `FORMAT.md` — golden fixture and human guide (generated by the tracer slice, then frozen)
- [ ] `tapestry/.gitignore` — add `build-kernel/`

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | single local user; no accounts |
| V3 Session Management | no | — |
| V4 Access Control | no (Phase 2: plugin capabilities) | — |
| V5 Input Validation | yes | `.tree` is untrusted input: strict grammar, byte-count bounds (64 MiB record / 1 MiB line), UTF-8 validation, NUL rejection, digest before apply, ids must resolve, `real` finite, `time` grammar-validated; unknown verbs stop the load |
| V6 Cryptography | yes | SHA-256 via vendored PicoSHA2 with KAT; **integrity only** — the chain detects accidental corruption and casual edits, not deliberate forgery (no HMAC/signature; out of scope for v1, state this in FORMAT.md) |
| V7 Error Handling & Logging | yes | Diagnostics carry offsets/seq/reason; never swallow; no silent repair |
| V12 Files & Resources | yes | `flock` single writer; sidecar written next to journal (same directory permissions); no symlink following surprises — open with `O_NOFOLLOW` `[ASSUMED]`; never execute or interpret file content as code |

### Known Threat Patterns for a local file-backed C++ kernel

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Crafted `.tree` with huge byte count / deep nesting → allocation bomb | DoS | Hard limits before allocation; stream records; reject > limits with diagnostic |
| Torn or bit-rotted record accepted as history | Tampering / Integrity | Byte count + SHA-256 + parent chain; TORN vs CORRUPT classification |
| Two processes appending concurrently → interleaved records | Tampering | `flock(LOCK_EX\|LOCK_NB)` held for the session |
| Injected control characters / invalid UTF-8 in text shown later in a UI | Tampering | Validate UTF-8 on decode; escape controls in inline strings; blocks are raw but UTF-8-checked |
| Plugin-supplied values masquerading as kernel ops (`x-` line containing `\n@end …`) | Spoofing | Byte-counted envelope makes embedded `@end`/`@commit` text inert; encoder rejects `\n` in single-line values and forces blocks |
| Path traversal via world/sidecar names | Tampering | Sidecar name derived from the journal path + timestamp only; never from file content |
| Silent data loss on crash | Repudiation | `F_FULLFSYNC` before ack; recovery diagnostics surfaced to the caller |

## Sources

### Primary (HIGH confidence — verified by running on this machine)
- `tapestry/CMakeLists.txt`, `tapestry/core/{World,Document,Page,Stroke,Types}.hpp/.cpp`, `tapestry/tests/*.cpp`, `tapestry/third_party/CMakeLists.txt`, `tapestry/README.md`, `tapestry/.gitignore` — read in full this session
- Build/test runs: prototype configure/build/ctest (3/3 pass); `/tmp/cxx20probe` (to_chars, from_chars deleted, no std::format, F_FULLFSYNC=51 returns 0, flock, strtod locale, strtod_l); `/tmp/dtcmake` (vendored doctest + CTest discovery offline); PicoSHA2 KAT vs CommonCrypto
- GitHub API `releases/latest` and repo metadata for doctest, Catch2, nlohmann/json, PicoSHA2, googletest (2026-09-08)
- `.planning/{PROJECT,REQUIREMENTS,ROADMAP,STATE}.md`, `.planning/research/{SUMMARY,ARCHITECTURE,STACK,PITFALLS,FEATURES}.md` — reused for constraints and the three open items

### Secondary (MEDIUM confidence — official documentation fetched this session)
- Apple `fsync(2)` man page (developer.apple.com archive) — `F_FULLFSYNC` guidance
- SQLite "Atomic Commit In SQLite" (sqlite.org/atomiccommit.html) — non-atomic sectors, reordering, directory sync
- RFC 8785 JCS (rfc-editor.org) — why JSON canonicalization is non-trivial; NaN/Inf rejection
- RFC 7464 JSON Text Sequences — no integrity, skip-on-malformed (rejected for `.tree`)
- RFC 3339 §5.6 — `recorded` format, UTC recommendation
- git-fast-import documentation (git-scm.com) — `data` byte-count vs delimited forms
- doctest `build-systems.md`; Catch2 `cmake-integration.md`; nlohmann `parse` + `number_handling` + CMake integration pages
- "All File Systems Are Not Created Equal" (ALICE, OSDI'14) via the morning paper summary — crash-state exploration model

### Tertiary (LOW confidence — web search only)
- hashicorp/raft-wal, 0xkiire, Cassandra commitlog write-ups — torn-tail vs corruption classification and commit markers
- EDTF Level 1 examples (loc.gov returned 403; examples from id.loc.gov/edtf-ruby search snippets)
- `F_BARRIERFSYNC` vs `F_FULLFSYNC` discussion (bonsaidb/Lobsters)
- UUIDv7 vs ULID comparisons

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every component was compiled/run here; versions checked against GitHub releases the same day
- Architecture: MEDIUM — durability/recovery patterns are source-backed and the tracer slice is small, but the `.tree` grammar and kernel API are proposals awaiting planner/user confirmation (A10)
- Pitfalls: HIGH for toolchain/locale/durability pitfalls (reproduced locally); MEDIUM for readability judgments

**Research date:** 2026-09-08
**Valid until:** 2026-10-08 for toolchain/library facts (stable); the grammar proposal is valid until the planner locks it
