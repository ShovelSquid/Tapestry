---
phase: 01-deterministic-core-readable-format
plan: 01
subsystem: kernel
tags: [cmake, ctest, doctest, picosha2, sha256, c++20, to_chars, strtod_l, locale, edtf, rfc3339, tree-format]

# Dependency graph
requires: []
provides:
  - ".tree v1 format bundle confirmed by the user: byte-counted block-line framing, full SHA-256 chain, sequential n<k>/e<k> ids, second-precision recorded stamps (PD-01, PD-02, PD-03, PD-07)"
  - "CMake option TAPESTRY_BUILD_RENDER gating glad/nanovg/tapestry_core/app/legacy tests; kernel-only configure needs no network, Python or display"
  - "tapestry_kernel static library (links only tapestry_settings) and tapestry_kernel_tests doctest binary discovered per-case by CTest; GLOB CONFIGURE_DEPENDS so later plans never edit CMake"
  - "Vendored doctest v2.5.3 and PicoSHA2 (commit 161cb3fc4170fa7a3eca9e582cebd27cc4d1fe29) with licenses"
  - "kernel/Digest: sha256() over exact bytes and strict 64-lowercase-hex parseDigestHex()"
  - "kernel/Ids: NodeId/EdgeId strong types, CommitSeq, Tick, n<k>/e<k> format and strict parse"
  - "kernel/Value: ValueType text|int|real|bool|ref|time, Value aggregate with factories, formatReal/parseReal (locale-proof), quoteText/unquoteText, textNeedsBlock, formatInline/parseValue"
  - "kernel/Time: RecordedAt (RFC 3339 UTC seconds, proleptic Gregorian, no gmtime), isValidEventTime (EDTF L0/L1 + RFC 3339 whitelist, calendar-checked), Clock/SystemClock/FixedClock"
  - "kernel_tests/support.hpp: scratchPath, readFile, writeFile, fileSize, fileExists"
affects: [01-02, 01-03, 01-04, 01-05, phase-2-plugin-schemas, phase-3-replay, FORMAT.md]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff).
# tokens counts the hand-written diff only; the vendored doctest.h/picosha2.h diff adds ~100k more (115932 total).
actuals:
  tokens: 15626
  tasks: 3
  commits: 3
  plan_head_before: dc4100958354e17f75fc4481b99cf23f53bff183

# Tech tracking
tech-stack:
  added: [doctest v2.5.3 (vendored, MIT), PicoSHA2 161cb3fc (vendored, MIT)]
  patterns:
    - "Render gate: everything needing glad/nanovg/SDL lives inside if(TAPESTRY_BUILD_RENDER); kernel targets are declared before it"
    - "Kernel sources and tests collected with file(GLOB ... CONFIGURE_DEPENDS); vendored headers are SYSTEM includes"
    - "Numeric text lives only in kernel/Value.cpp: std::to_chars out; whitelisted decimal grammar then from_chars (if __cpp_lib_to_chars) or strtod_l under a C locale handle in"
    - "Strict whitelist parsers returning std::optional; anything the writer would not have produced is rejected"
    - "Wall clock only through the Clock interface (FixedClock in tests)"
    - "TDD in C++: headers + deliberately wrong stub bodies in the RED commit so the suite links and fails on assertions"

key-files:
  created:
    - tapestry/kernel/Digest.hpp
    - tapestry/kernel/Digest.cpp
    - tapestry/kernel/Ids.hpp
    - tapestry/kernel/Ids.cpp
    - tapestry/kernel/Value.hpp
    - tapestry/kernel/Value.cpp
    - tapestry/kernel/Time.hpp
    - tapestry/kernel/Time.cpp
    - tapestry/kernel_tests/main.cpp
    - tapestry/kernel_tests/support.hpp
    - tapestry/kernel_tests/value_test.cpp
    - tapestry/third_party/doctest/doctest.h
    - tapestry/third_party/doctest/doctest.cmake
    - tapestry/third_party/doctest/doctestAddTests.cmake
    - tapestry/third_party/doctest/LICENSE.txt
    - tapestry/third_party/picosha2/picosha2.h
    - tapestry/third_party/picosha2/LICENSE
    - .planning/phases/01-deterministic-core-readable-format/01-01-tdd-red-evidence.json
  modified:
    - tapestry/CMakeLists.txt
    - tapestry/.gitignore

key-decisions:
  - "Task 1 (one-way door): user selected option block-lines — byte-counted block-line .tree v1 framing, full 64-hex SHA-256 in parent/@end, sequential n<k>/e<k> ids, second-precision recorded stamps, exactly as the plan's format_contract (PD-01, PD-02, PD-03, PD-07)"
  - "PicoSHA2 vendored at upstream master commit 161cb3fc4170fa7a3eca9e582cebd27cc4d1fe29 (2025-05-04); recorded in the CMakeLists banner with doctest tag v2.5.3"
  - "Value equality compares reals by bit pattern so -0 and 0 differ exactly as their file text does"
  - "parseReal pre-validates a decimal grammar (optional minus, digits, fraction, exponent) before any library call, so nan/inf/hex/+/whitespace/comma never reach strtod_l or from_chars"
  - "unquoteText accepts the JSON escape set (\\\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX with surrogate pairs) even though the writer emits only quote/backslash/LF/tab/CR/\\u00XX; hand-edited files stay readable, lone surrogates and raw control bytes are rejected"
  - "Event-time grammar: unspecified X digits run right-to-left (a year with X takes no month), month/day X only as whole XX components, seasons 21-24 take no day, qualifiers ?~% only on dates (not date-times) and only as a single suffix, intervals accept .. (open) and empty (unknown) ends but not both missing, date-times require Z or +/-HH:MM, seconds 00-59"
  - "RecordedAt uses Howard Hinnant's civil-from-days/days-from-civil so the same bytes come out on every machine; no gmtime, no printf"
  - "RED phase in a compiled language: the test commit carries the three headers (the contract) plus stub .cpp bodies that return wrong defaults, so the binary links and 8 of 9 cases fail on assertions; RED evidence classified RED_EVIDENCE_OK by transcribing doctest's JUnit report to TAP"

patterns-established:
  - "Kernel header convention: pragma once, project headers first, prose why-comments, m_/k prefixes, closing namespace comment, never include core/ or render/"
  - "Test convention: TEST_SUITE(\"value\") with case names prefixed 'value: ' so -ts=/-tc= filters and CTest discovery both work"
  - "Per-plan RED evidence record persisted under the phase directory (01-01-tdd-red-evidence.json)"

requirements-completed: [TREE-01, TREE-02, TREE-04]

coverage:
  - id: D1
    description: ".tree v1 format bundle (framing, digest form, id scheme, recorded precision) confirmed by the user before any writer code exists"
    requirement: TREE-01
    verification: []
    human_judgment: true
    rationale: "A user decision, not a testable artifact; the orchestrator recorded the selection (block-lines) and this SUMMARY records it"
  - id: D2
    description: "Kernel-only build configures/builds/tests offline with -DTAPESTRY_BUILD_RENDER=OFF, no _deps directory, zero renderer symbols in libtapestry_kernel.a"
    requirement: TREE-02
    verification:
      - kind: other
        ref: "cmake -S tapestry -B tapestry/build-kernel -DTAPESTRY_BUILD_APP=OFF -DTAPESTRY_BUILD_RENDER=OFF && cmake --build ... && ctest --test-dir tapestry/build-kernel"
        status: pass
      - kind: other
        ref: "test ! -e tapestry/build-kernel/_deps && nm -u tapestry/build-kernel/libtapestry_kernel.a | grep -ci 'nvg\\|glad' == 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Legacy prototype (tapestry_core, camera/world/document tests) still builds and passes with the render stack ON"
    verification:
      - kind: integration
        ref: "ctest --test-dir tapestry/build -R '^(camera|world|document)$' -> 100% tests passed out of 3"
        status: pass
    human_judgment: false
  - id: D4
    description: "SHA-256 wrapper proven by known-answer test and strict digest-hex parser"
    requirement: TREE-01
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/value_test.cpp#value: sha256 known answer"
        status: pass
    human_judgment: false
  - id: D5
    description: "Reals format as shortest round-trip text and parse back identically under de_DE.UTF-8; NaN/Inf/comma/empty/trailing rejected"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/value_test.cpp#value: reals format as shortest round-trip text"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/value_test.cpp#value: reals are locale-proof and reject nan inf comma empty trailing"
        status: pass
    human_judgment: false
  - id: D6
    description: "Inline text quoting round-trips (quote, backslash, LF, tab, CR, control byte, UTF-8), block selection at LF or >80 bytes, parseValue/formatInline for all six types, type names round-trip"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/value_test.cpp#value: inline text quoting round-trips and block selection"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/value_test.cpp#value: parseValue and formatInline per type"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/value_test.cpp#value: type names round-trip"
        status: pass
    human_judgment: false
  - id: D7
    description: "Recorded stamps format/parse as RFC 3339 UTC seconds byte-identically; event times accepted only under the EDTF L0/L1 + RFC 3339 whitelist"
    requirement: TREE-04
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/value_test.cpp#value: recorded stamps round-trip as RFC 3339 UTC seconds"
        status: pass
      - kind: unit
        ref: "tapestry/kernel_tests/value_test.cpp#value: event time whitelist grammar (EDTF level 0/1 and RFC 3339)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Node and edge ids format as n<k>/e<k> and parse strictly (n0, n01, n, N1, trailing space, wrong kind, overflow rejected)"
    requirement: TREE-02
    verification:
      - kind: unit
        ref: "tapestry/kernel_tests/value_test.cpp#value: node and edge ids format as n<k>/e<k> and parse strictly"
        status: pass
    human_judgment: false

# Metrics
duration: 12 min
completed: 2026-09-09
status: complete
---

# Phase 01 Plan 01: Kernel scaffold and typed primitives Summary

**Rendering-independent `tapestry_kernel` + vendored doctest/PicoSHA2 under CTest discovery, with the `.tree` v1 block-line format locked and locale-proof value/time/id primitives (9 cases, 262 assertions) shipped warning-clean.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-09T06:22:18Z
- **Completed:** 2026-09-09T06:35:09Z
- **Tasks:** 3 (1 decision resolved by the user, 2 auto; Task 3 TDD)
- **Files modified:** 19 under `tapestry/` (17 created, 2 modified) plus this SUMMARY and the RED evidence record

## Accomplishments

- The one-way `.tree` v1 format door is closed: the user selected **block-lines** (byte-counted `@commit <seq> <bytes>` … `@end sha256:<64 hex>` envelope with `<<TEXT` blocks, full SHA-256 chain, sequential `n<k>`/`e<k>` ids, `recorded` at whole seconds) — the RESEARCH recommendation exactly as written in the plan's `<format_contract>`.
- `tapestry_kernel` builds and tests with `-DTAPESTRY_BUILD_RENDER=OFF`: no FetchContent `_deps`, no Python/Jinja2, no network, `nm -u libtapestry_kernel.a` has zero `nvg`/`glad` references. The legacy render build (`tapestry/build`) still passes camera/world/document; the full render-tree CTest is 12/12.
- doctest v2.5.3 and PicoSHA2 (upstream master `161cb3fc4170fa7a3eca9e582cebd27cc4d1fe29`, 2025-05-04) are vendored with licenses and pinned in the CMake banner; `doctest_discover_tests` registers every `TEST_CASE` with CTest individually.
- `kernel/Digest`, `kernel/Ids`, `kernel/Value`, `kernel/Time` deliver every behavior bullet of Task 3 with one doctest case each; the whole kernel compiles with zero warnings under `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -ffp-contract=off`.
- Locale proof is real: the test switches the process to `de_DE.UTF-8`, confirms libc now reads `"1,5"` as 1.5, and then shows `parseReal("1.5") == 1.5` and `formatReal(1.5) == "1.5"` unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm the .tree v1 format bundle** — no commit (checkpoint:decision resolved by the user: **block-lines**)
2. **Task 2: Stand up the rendering-independent kernel target and doctest runner** — `ba20555` (feat)
3. **Task 3: Typed values, times and identifiers** — `80431dd` (test, RED) → `6e2e3d9` (feat, GREEN); no REFACTOR commit was needed

**Plan metadata:** see the `docs(01-01)` commit that adds this SUMMARY.

## Files Created/Modified

- `tapestry/CMakeLists.txt` — `TAPESTRY_BUILD_RENDER` option; vendored-deps banner (doctest v2.5.3, PicoSHA2 161cb3fc); `doctest` INTERFACE target + `doctest::doctest` alias; `tapestry_kernel` (GLOB_RECURSE `kernel/*.cpp`, PUBLIC include root, SYSTEM picosha2 include, links only `tapestry_settings`); `tapestry_kernel_tests` (GLOB `kernel_tests/*.cpp`, `TAPESTRY_FIXTURE_DIR`, `doctest_discover_tests`); glad/third_party/tapestry_core/app/legacy tests wrapped in `if(TAPESTRY_BUILD_RENDER)`
- `tapestry/.gitignore` — `build-kernel/`
- `tapestry/third_party/doctest/{doctest.h,doctest.cmake,doctestAddTests.cmake,LICENSE.txt}` — doctest v2.5.3 verbatim
- `tapestry/third_party/picosha2/{picosha2.h,LICENSE}` — PicoSHA2 verbatim
- `tapestry/kernel/Digest.{hpp,cpp}` — `struct Digest{hex}`, `sha256(string_view)` (the only TU that includes `picosha2.h`), `parseDigestHex` (exactly 64 lowercase hex)
- `tapestry/kernel/Ids.{hpp,cpp}` — `NodeId`/`EdgeId` (`==`, `<`, `assigned()`), `CommitSeq`, `Tick`, `format`, `parseNodeId`/`parseEdgeId`
- `tapestry/kernel/Value.{hpp,cpp}` — `ValueType`, `typeName`/`parseTypeName`, `Value` + `ofText/ofInt/ofReal/ofBool/ofRef/ofTime`, `formatReal`/`parseReal`, `quoteText`/`unquoteText`, `textNeedsBlock`, `formatInline`/`parseValue`
- `tapestry/kernel/Time.{hpp,cpp}` — `RecordedAt` (`rfc3339Z`, `parse`), `isValidEventTime` with the accepted-shapes table FORMAT.md will copy, `Clock`/`SystemClock`/`FixedClock`
- `tapestry/kernel_tests/main.cpp` — `DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN`
- `tapestry/kernel_tests/support.hpp` — `scratchPath` (`${TMPDIR}/tapestry-kernel-test-<name>-<pid>.tree`), `readFile`, `writeFile`, `fileSize`, `fileExists`
- `tapestry/kernel_tests/value_test.cpp` — `TEST_SUITE("value")`: KAT, reals, locale, quoting/blocks, parseValue/formatInline, event-time grammar, RecordedAt, ids, type names
- `.planning/phases/01-deterministic-core-readable-format/01-01-tdd-red-evidence.json` — persisted RED evidence (`RED_EVIDENCE_OK`)

## Decisions Made

- **Format bundle (Task 1):** block-lines, as recommended. Plans 02–05 are written for this option; no re-planning needed.
- **PicoSHA2 pin:** upstream has no tags; the master commit `161cb3fc4170fa7a3eca9e582cebd27cc4d1fe29` (committed 2025-05-04) is recorded in the CMake banner beside the doctest tag.
- **Real parsing grammar-first:** `parseReal` whitelists the decimal literal shape before calling the library, so behavior is identical whether the fallback is `from_chars` or `strtod_l`, and `nan`, `inf`, hex floats, `+1.5`, leading whitespace and a decimal comma are all rejected uniformly.
- **`Value` equality by bits for reals** so `-0` and `0` compare unequal exactly as their file text does.
- **`unquoteText` is a JSON-escape superset of what `quoteText` emits** (`\/ \b \f` and non-control `\uXXXX` with surrogate pairs); lone surrogates, unknown escapes and raw control bytes are rejected.
- **Event-time grammar details** (all documented in the `Time.hpp` table): X-digits run right-to-left (a year with X takes no month), month/day unspecified only as whole `XX`, seasons `21–24` never take a day, `? ~ %` only on dates as a single trailing qualifier, intervals accept `..` (open) and an empty side (unknown) but not both, date-times need `Z` or `±HH:MM`, seconds `00–59`.
- **`RecordedAt` calendar math** is Howard Hinnant's proleptic-Gregorian conversion — no `gmtime`, no time zone, no `printf`; padded with `std::to_chars`.
- **Auth/CLAUDE.md:** no adjustments needed; this run is the GSD execute-phase workflow.

## Deviations from Plan

None - plan executed exactly as written. Two execution notes that are not deviations:

- The orchestrator resolved Task 1 before dispatch (user answer: block-lines), so no checkpoint was returned.
- The executor's worktree `agent-*` branch-namespace assertion was not applied: the orchestrator stated this working tree is a Conductor workspace worktree on `start-tapestry-project` and directed normal commits on it (branch is not a protected/default branch; HEAD was attached for every commit).

## TDD Gate Compliance

| Gate | Commit | Evidence |
|------|--------|----------|
| RED | `80431dd` `test(01-01): add failing tests for typed values, times and identifiers` | `tapestry_kernel_tests -ts=value` exit 1; 8 of 9 cases failed on assertions (57 failing assertions), only the pre-existing KAT passed; `gsd_run check tdd-red-evidence` → `RED_EVIDENCE_OK` (`target_test_failed`, target `value: reals format as shortest round-trip text`) |
| GREEN | `6e2e3d9` `feat(01-01): implement typed values, times and identifiers` | same command exit 0; 9 cases / 262 assertions pass; build log has 0 warning/error lines |
| REFACTOR | — | not needed; no commit made |

How RED was made honest in a compiled language: the RED commit carries the three headers (the contract the tests compile against) and stub `.cpp` bodies that return empty/false/nullopt, so the failure is an assertion failure on the planned behavior rather than a compile or link error. doctest has no TAP reporter, so its `-r=junit` output of the same run was transcribed line-for-line into TAP for the classifier; the record is committed at `01-01-tdd-red-evidence.json`.

## Issues Encountered

- `check tdd-red-evidence` parses a Node `--test` TAP summary and camelCase keys (`command`, `exitCode`, `targetTest`, `output`); the first record used the snake_case names from the reference prose and was classified `invalid_record`. Resolved by reading the classifier and rendering doctest's JUnit report as TAP (counts taken from the real run).

## Known Stubs

None. The RED-phase stub bodies were fully replaced in the GREEN commit; no placeholder values or TODOs remain in `tapestry/kernel` or `tapestry/kernel_tests`. `TAPESTRY_FIXTURE_DIR` points at `tapestry/docs/tree`, which Plan 02/05 creates; nothing reads it yet.

## Threat Flags

None new. Plan threat register dispositions applied: T-1-SC (pinned tag/commit in banner, licenses vendored, KAT passes, no package-manager installs), T-1-11 (grammar-first locale-independent `parseReal`, NaN/Inf/trailing rejected), T-1-13 (kernel links only `tapestry_settings`; `_deps` absent; zero renderer symbols).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `01-02` (tracer: create node → durable `@commit` → reopen → read back). It can use `Digest`, `Ids`, `Value`, `Time` and `support.hpp` as-is; `FixedClock` pins `recorded` for the golden fixture.
- `tapestry/docs/tree/` does not exist yet; Plan 02 creates it (the CMake define already points there).
- Verify-work note: the locale case requires `de_DE.UTF-8` on the machine (present on this Mac); it fails loudly rather than silently passing if the locale is missing.

---
*Phase: 01-deterministic-core-readable-format*
*Completed: 2026-09-09*

## Self-Check: PASSED

All 18 created files exist on disk; commits ba20555, 80431dd and 6e2e3d9 are present in git history.
