---
phase: 01-painting-with-the-pen
plan: 03
subsystem: sim-core
tags: [cpp20, fixed-point, q32.32, int128-oracle, xoshiro256, splitmix64, ubsan, sha256, golden-fixtures, ctest, replay-cli, emscripten, vitest]

# Dependency graph
requires:
  - phase: 01-01
    provides: "ddsim skeleton: fx64 add/sub/compare, seeded Xoshiro256ss state, canonical walk + strict read_canonical, flat C ABI, presets, forbidden-token gate, golden_support.hpp, gen_fixtures, Wasm build + Vitest golden test"
provides:
  - "fx64 complete: mul_q32 (four 32x32->64 partial products, no 128-bit type in the header), div_q32 = floor(a*2^32/b) by 96-bit shift-subtract, isqrt64/isqrt128 fixed-iteration digit-by-digit, sqrt, abs, min, max, clamp, lerp, operator* and /; the floor-everywhere rounding rule documented at the top of fx64.hpp"
  - "rng complete: rotl, Xoshiro256ss::next() verbatim from the reference, seed_stream(world, purpose, entity), uniform_fx in [0, ONE), range_u32 (Lemire multiply-shift), DD_PURPOSE_SETTLE reserved; golden first output frozen"
  - "Integer-oracle tests: 1e6 seeded mul pairs, 1e5 div pairs, 1e5 isqrt inputs against __int128 (native only); Debug contract asserts proven from forked children"
  - "Reject-or-exact restore proof: every byte of the one-brush tick-60 state flipped (157 offsets: 51 rejected, 106 accepted exactly, 0 silently corrected); every truncation rejected; restore hash == source hash for every fixture at every checkpoint"
  - "DDSIM_SANITIZE option + native-ubsan configure/build/test presets: -fsanitize=undefined -fno-sanitize-recover=all on ddsim_settings, so the library, tests, gen_fixtures and the replay CLI are all instrumented; 32/32 tests, 0 runtime errors"
  - "ddsim_replay CLI (tools/ddsim_replay) driving the sim only through ddsim_c.h: prints '<tick> <sha256>' per checkpoint; --compare, --write-golden, --roundtrip; exit 0/1/2"
  - "cmake/two_process.cmake + CTest golden_two_process_<fixture> for every tests/golden/*.actions: two fresh processes must equal each other and the committed .sha256, then a third process runs --roundtrip --compare; registered in every native preset so Debug, Release and UBSan all check the same committed golden"
  - "many-brushes fixture: seed 7, 50 DefineBrush at ticks 0..49 (ids 1..50), descriptions cycling ink / green rust / loneliness / 青苔 / rust ✓ (multibyte UTF-8, desc_len counts bytes), masses 1/4/16/64, checkpoints 0 25 50 600; golden written from native-release and reproduced by Debug, UBSan, two processes, the Node checker and Vitest"
  - "One replay rule: golden_support.hpp replayFixtureWith over an abstract driver, with replayFixture (Sim&) and replayFixtureAbi (dd_sim*) as adapters"
affects: [01-05, 01-06, 01-07, 01-08, phase-2-settle, phase-3-timeline]

# Actuals (#2632) — chars/4 over the realized diff (git diff 0492e6a..HEAD), not a harness token count.
actuals:
  tokens: 17080
  tasks: 3
  commits: 3
plan_head_before: 0492e6a79c751fe6aee7ca09c47c5ba1a22a6c43

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integer oracles only: tests certify fx64 against __int128 arithmetic and seed from splitmix64; no floating-point value, no <random>, no std::sort with ties anywhere in the sim tests"
    - "Contract violations return 0 in every build and assert in Debug; the Debug assert is proven from a forked child (SIGABRT observed) so the clamp and the assert are both tested without an ODR-splitting macro"
    - "No signed intermediate overflows in fx64 even though -fwrapv defines it: magnitudes and negations run in unsigned arithmetic, so the UBSan preset would still catch a real overflow elsewhere"
    - "Fixed iteration counts for every iterative integer algorithm (96-step division, 32/64-step square roots): never 'until converged'"
    - "Sanitizer rides ddsim_settings (INTERFACE) so it instruments every target including the CLI, and CTest's two-process golden tests therefore run sanitized too"
    - "The replay rule is written once (replayFixtureWith) and adapted to the C++ class and to the C ABI; the CLI shares the fixture parsers with the tests"
    - "Goldens are produced by an explicit act (ddsim_replay --write-golden from native-release, or DDSIM_WRITE_GOLDEN=1) and only ever compared by CTest and Vitest"

key-files:
  created:
    - data-drawing/sim/cmake/two_process.cmake
    - data-drawing/sim/tests/fx64_test.cpp
    - data-drawing/sim/tests/rng_test.cpp
    - data-drawing/sim/tests/restore_test.cpp
    - data-drawing/sim/tests/golden/many-brushes.actions
    - data-drawing/sim/tests/golden/many-brushes.sha256
    - data-drawing/sim/tools/ddsim_replay/main.cpp
  modified:
    - data-drawing/sim/include/ddsim/fx64.hpp
    - data-drawing/sim/include/ddsim/rng.hpp
    - data-drawing/sim/tests/golden_support.hpp
    - data-drawing/sim/tools/gen_fixtures/main.cpp
    - data-drawing/sim/CMakeLists.txt
    - data-drawing/sim/CMakePresets.json

key-decisions:
  - "Debug contract asserts (div by zero, sqrt of a negative) are tested from a forked child that observes SIGABRT, while the zero clamp is checked directly in Release; a per-TU macro to disable the assert would split the inline function's definition across translation units (ODR) once 01-05 calls sqrt from the library"
  - "div_q32 is a general 96-by-64-bit long division (fixed 96 iterations) rather than the research's 'precompute reciprocals' shortcut, so 01-05's spring constants and 1/n sub-steps get exact floor division with no second rounding path"
  - "seed_stream fills the state from splitmix64 run on world ^ purpose ^ entity exactly as the plan's interfaces block states (four outputs), so seed_stream(seed, 0, 0) is byte-identical to the 01-01 seed_from(seed) the goldens already hash; the golden first output 0x0bab45d9a0e3ae53 is frozen in rng_test.cpp"
  - "sim.cpp needed no change for strict restore: 01-01's read_canonical already enforces magic, every version pin, DD_MAX_* limits, brush ids sequential from 1, ascending stroke/node ids and no trailing bytes; the byte sweep proves reject-or-exact (0 silent corrections), so the plan's 'make sure' was satisfied by test rather than by code"
  - "The replay rule was refactored into one driver-agnostic template (replayFixtureWith) instead of duplicating the loop in the CLI, because the CLI must drive the sim only through ddsim_c.h while the tests use ddsim::Sim"
  - "SIM-01 marked complete (01-01 finished, 01-03 is the last declaring plan); SIM-02 left unmarked by the shared-ID gate because 01-05 also declares it"

patterns-established:
  - "Test names must not contain unbalanced [ or ; — doctest's CMake discovery splits on them and add_test fails (the plan's literal '[0, ONE)' name broke configure)"
  - "The forbidden-token gate scans comments too: a header comment naming the random header fails cmake -B, so prose says 'standard-library distribution' instead"

requirements-completed: [SIM-01]

coverage:
  - id: D1
    description: "fx64 op set complete with floor semantics: mul_q32 matches the 128-bit oracle on 1e6 seeded pairs across all four sign combinations plus INT64_MIN / -1 / 0 / ONE / ONE-1 edges; div_q32 equals floor((a<<32)/b) on 1e5 pairs incl. negative and small divisors; isqrt64/isqrt128 satisfy r*r <= x < (r+1)^2 on 1e5 inputs plus 0..17, UINT64_MAX and every power of two; sqrt(k*k) == k for k in 0..1000; div by zero and sqrt(negative) return 0 (Release) and assert (Debug); no 128-bit type in the header"
    requirement: SIM-01
    verification:
      - kind: unit
        ref: "cd data-drawing/sim && ctest --preset native-debug -R fx64 (9/9) && ctest --preset native-release -R fx64 (9/9); oracle MESSAGE 'mul_q32 oracle: 1000000 iterations, 0 mismatches'"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' include/ddsim/fx64.hpp | grep -c __int128 -> 0; fx64_test.cpp 'the header holds no 128-bit integer type' reads the file"
        status: pass
    human_judgment: false
  - id: D2
    description: "Project-owned PRNG with per-entity streams: same seed same 10000 outputs; entity streams differ within 4 outputs; zero seed gives non-zero state; uniform_fx in [0, ONE) over 1e5 draws; range_u32(n) < n for the listed n and range_u32(0) == 0; first output of seed_stream(1234,0,0) frozen as 0x0bab45d9a0e3ae53"
    requirement: SIM-01
    verification:
      - kind: unit
        ref: "cd data-drawing/sim && ctest --preset native-debug -R '^rng' (6/6)"
        status: pass
    human_judgment: false
  - id: D3
    description: "UBSan preset runs the full suite and every golden fixture clean: native-ubsan (Debug, -fsanitize=undefined -fno-sanitize-recover=all on all targets) passes 32/32 incl. ddsim_forbidden_tokens and golden_two_process_{noop,one-brush,many-brushes}, with zero 'runtime error:' lines"
    requirement: SIM-01
    verification:
      - kind: integration
        ref: "cd data-drawing/sim && cmake --preset native-ubsan && cmake --build --preset native-ubsan && ctest --preset native-ubsan --output-on-failure (32/32; grep -c 'runtime error:' -> 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "dd_restore is reject-or-exact: flipping each of the 157 bytes of the one-brush tick-60 state yields DD_ERR_RESTORE (51) or DD_OK with serialize() == the mutated bytes (106), never a silently corrected value; every truncation 0..len-1 and every 1..16-byte extension is rejected with the hash untouched; restore hash == source hash for noop, one-brush and many-brushes at every checkpoint"
    requirement: SIM-02
    verification:
      - kind: unit
        ref: "cd data-drawing/sim && ctest --preset native-debug -R '^restore' (3/3); MESSAGE 'byte sweep over 157 offsets: 51 rejected, 106 accepted exactly, 0 silently corrected'"
        status: pass
    human_judgment: false
  - id: D5
    description: "ddsim_replay run as two separate processes prints identical checkpoint hashes equal to the committed .sha256 for every fixture in Debug, Release and UBSan; --roundtrip serialize/restore agrees at every checkpoint; the Debug-built CLI --compare against the Release-written many-brushes golden exits 0"
    requirement: SIM-02
    verification:
      - kind: integration
        ref: "cd data-drawing/sim && ctest --preset native-release (32/32, 3 golden_two_process) && ctest --preset native-debug -R golden_two_process (3/3) && ./build/native-debug/ddsim_replay tests/golden/many-brushes.actions --compare tests/golden/many-brushes.sha256 (exit 0)"
        status: pass
      - kind: other
        ref: "./build/native-release/ddsim_replay tests/golden/noop.actions prints exactly 4 lines matching ^[0-9]+ [0-9a-f]{64}$; --compare against the wrong golden prints 'MISMATCH tick 0: got ... expected ...' and exits 1; no arguments exits 2"
        status: pass
    human_judgment: false
  - id: D6
    description: "The Wasm module rebuilt from the same source (Emscripten 6.0.10) matches every committed golden including many-brushes with multibyte UTF-8 descriptions, in Vitest and in the Node checker, with no TS change"
    requirement: SIM-02
    verification:
      - kind: integration
        ref: "npm --prefix plugins/data-drawing run sim:wasm && npm --prefix plugins/data-drawing test -> wasm-golden.test.ts 6 passed incl. 'many-brushes: the Wasm module reproduces every committed checkpoint hash'; node tools/wasm-hash-check.mjs ... -> OK noop 4 / OK one-brush 4 / OK many-brushes 4"
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-09-23
status: complete
---

# Phase 1 Plan 03: Determinism Harness Completion Summary

**Complete Q32.32 `fx64` (four-partial-product multiply, exact floor division, fixed-iteration square roots) proven against `__int128` oracles, a project-owned xoshiro256** with per-entity streams and a frozen golden, a UBSan preset over every target, a reject-or-exact restore sweep, and the `ddsim_replay` CLI whose two-process and roundtrip runs are CTest tests for every committed fixture — including a new 50-brush UTF-8 fixture that Debug, Release, UBSan, two processes, the Node checker and the Wasm module in Vitest all reproduce.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-23T01:28:40Z
- **Completed:** 2026-09-23T01:42:43Z
- **Tasks:** 3
- **Files modified:** 13 (7 created, 6 modified)

## Accomplishments

- SIM-01 in full: `fx64` now has `mul_q32`, `div_q32`, `isqrt64`, `isqrt128`, `sqrt`, `abs`, `min`, `max`, `clamp`, `lerp` and the `*` / `/` operators, with one documented rounding rule (floor everywhere) and no 128-bit type in the header; the PRNG is project code with `next()`, `seed_stream`, `uniform_fx` and `range_u32`; the `native-ubsan` preset runs the whole suite and every fixture with zero findings; the forbidden-token gate is still active (it caught a comment of mine during this plan).
- SIM-02 in full: every byte of a serialized state is either rejected or accepted exactly (never corrected); `ddsim_replay` lets a person verify "same file, same seed, same hash" from the command line; CTest runs it twice as separate processes plus a roundtrip process for every fixture in Debug, Release and UBSan against the same committed `.sha256`; the Wasm build still matches all three fixtures.
- The 01-01 goldens (`noop`, `one-brush`) are unchanged byte for byte; `gen_fixtures` regenerated them identically before adding `many-brushes`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Full fx64 op set with integer oracles** - `3a8441a` (feat)
2. **Task 2: PRNG streams, strict-restore sweep, UBSan preset** - `9e6a9b6` (feat)
3. **Task 3: ddsim_replay CLI, two-process and Debug/Release golden checks, many-brushes fixture** - `5a62292` (feat)

**Plan metadata:** see the final `docs(01-03)` commit.

## Task 1 record: fx64

Oracle run (native-debug, `ctest -V -R oracle`):

```
MESSAGE: mul_q32 oracle: 1000000 iterations, 0 mismatches
MESSAGE: div_q32 oracle: 100000 iterations, 49988 with |b| < |a|
MESSAGE: isqrt oracle: 100000 seeded inputs each for isqrt64 and isqrt128, 0 bad
```

Spot values the tests pin: `sqrt(2)` = raw `6074000999` (floor(sqrt(2) * 2^32)); `sqrt(from_raw(INT64_MAX))` = raw `199032864766430`; `sqrt(2^-32)` = `2^-16`; `mul_q32(-1, -1) == 0` (2^-64 floors to zero); `div_q32(-1, ONE) == -1` and `div_q32(-1, 2*ONE) == -1` (floor, not truncation); `abs(INT64_MIN)` stays `INT64_MIN` with no signed overflow. `grep -v '^\s*//' include/ddsim/fx64.hpp | grep -c __int128` prints `0`, and the test reads the header to assert the same on the raw file.

## Task 2 record: rng, restore, UBSan

**Frozen rng golden** (`tests/rng_test.cpp`): `seed_stream(1234, 0, 0).next()` = **`0x0bab45d9a0e3ae53`**. Regenerating it is a deliberate act that must bump `DD_RNG_VERSION`.

**Byte sweep** (`restore: reject-or-exact byte sweep`, one-brush state at tick 60, 157 bytes): `51 rejected, 106 accepted exactly, 0 silently corrected`. The accepted offsets are the fields that are free by design — seed, tick, description bytes, curve knots, rng words and the sign-preserving bytes of mass/radius/spacing; every one of them re-serializes to the mutated bytes. No change to `sim.cpp` was needed: 01-01's `read_canonical` already enforces every check the plan lists.

**UBSan run** (`cmake --preset native-ubsan && cmake --build --preset native-ubsan && ctest --preset native-ubsan --output-on-failure`, after Task 3):

```
-- ddsim: UBSan enabled on every target (DDSIM_SANITIZE=ON)
100% tests passed out of 32
runtime error: 0 lines
```

`grep -n "fsanitize=undefined" CMakeLists.txt` → lines 73-74 inside `if(DDSIM_SANITIZE)`; `grep -c '"native-ubsan"' CMakePresets.json` → 4 (configure, build, test, plus the build preset's `configurePreset`).

## Task 3 record: CLI and goldens

`tests/golden/many-brushes.actions` (seed 7, 50 `action` lines, checkpoints 0 25 50 600) → `many-brushes.sha256`, written by `./build/native-release/ddsim_replay tests/golden/many-brushes.actions --write-golden tests/golden/many-brushes.sha256`:

```
0 e5b70e1765edafc2517abaa85f9311b53a4c5c4ac13c3d33cffab4a485cfc7fe
25 48376765521ee8e88c6eaeae2ff15ffd114c866aa7cd2604ee3687671115c422
50 b6bcc6a7044ba0e4bc2b337b4ca9d04c125cdca1558a242a9c8336f521b5f0fb
600 0df3de7c8d19d820097541bfeabb8b36b625e2122270fac36be6ab444e4e267d
```

The tick-600 line differs from one-brush's (`0b06a0f2...`). The fixture's action hex contains `e99d92e88b94` (青苔) and `7275737420e29c93` (rust ✓) as UTF-8 bytes with `desc_len` 6 and 8.

Reproduction: `ctest --preset native-release` 32/32 (`ctest -N | grep -c golden_two_process` → 3); `ctest --preset native-debug` 32/32; `ctest --preset native-ubsan` 32/32; `./build/native-debug/ddsim_replay tests/golden/many-brushes.actions --compare tests/golden/many-brushes.sha256` exit 0 (Debug equals the Release-written golden); `./build/native-release/ddsim_replay tests/golden/noop.actions` prints exactly 4 lines matching `^[0-9]+ [0-9a-f]{64}$`; `--compare` against the wrong golden prints `MISMATCH tick 0: got 198a1ff5... expected fc271b77...` and exits 1; no arguments → usage, exit 2. Wasm: `npm --prefix plugins/data-drawing run sim:wasm` (Emscripten 6.0.10 matches the pin) then `npm --prefix plugins/data-drawing test` → 6 passed, including `many-brushes: the Wasm module reproduces every committed checkpoint hash`; `node tools/wasm-hash-check.mjs` → `OK noop 4`, `OK one-brush 4`, `OK many-brushes 4`.

## Files Created/Modified

- `data-drawing/sim/include/ddsim/fx64.hpp` - full op set; rounding rule and contract-violation policy at the top; `DDSIM_ASSERT`
- `data-drawing/sim/include/ddsim/rng.hpp` - `rotl`, `next()`, `seed_stream`, `uniform_fx`, `range_u32`, `DD_PURPOSE_SETTLE`
- `data-drawing/sim/tests/fx64_test.cpp` - 128-bit oracle cases (native only), contract cases, lerp/abs/min/max/clamp; header-file assertion
- `data-drawing/sim/tests/rng_test.cpp` - 6 cases incl. the frozen golden
- `data-drawing/sim/tests/restore_test.cpp` - byte sweep, truncation/extension, per-fixture round trip (scans `tests/golden/*.actions`)
- `data-drawing/sim/tests/golden_support.hpp` - `replayFixtureWith` (one rule), `replayFixture` (Sim&), `replayFixtureAbi` (dd_sim*)
- `data-drawing/sim/tools/ddsim_replay/main.cpp` - the CLI
- `data-drawing/sim/cmake/two_process.cmake` - the two-process + roundtrip CTest script
- `data-drawing/sim/CMakeLists.txt` - `DDSIM_SANITIZE`, `ddsim_replay` target, `golden_two_process_<fixture>` per fixture
- `data-drawing/sim/CMakePresets.json` - `native-ubsan` configure/build/test presets
- `data-drawing/sim/tools/gen_fixtures/main.cpp` - `many-brushes` generator
- `data-drawing/sim/tests/golden/many-brushes.{actions,sha256}` - the new fixture and its golden

## Decisions Made

See `key-decisions` in the frontmatter: fork-based proof of the Debug asserts; general 96-bit long division; `seed_stream` as the interfaces block specifies (so existing goldens are untouched); no `sim.cpp` change because the sweep proves 01-01's parser is already strict; one driver-agnostic replay rule; SIM-01 marked, SIM-02 gated.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Debug contract asserts would abort the very test that checks the clamp**
- **Found during:** Task 1
- **Issue:** The plan asks for `sqrt(negative) == 0` and `div by zero returns 0` in every build *and* an `assert` in Debug; in a Debug run the assert aborts the test process before the CHECK.
- **Fix:** Under `NDEBUG` the tests CHECK the zero result directly; otherwise they `fork()`, reset `SIGABRT` to default in the child, call the function and require `WIFSIGNALED && WTERMSIG == SIGABRT` — proving the Debug assert fires. A per-TU macro to silence the assert was rejected (ODR split once the library calls `sqrt`).
- **Files modified:** `tests/fx64_test.cpp`
- **Verification:** both cases pass in native-debug, native-release and native-ubsan.
- **Committed in:** `3a8441a`

**2. [Rule 3 - Blocking] Test names broke doctest's CMake discovery**
- **Found during:** Task 2
- **Issue:** The plan's literal names `rng: uniform_fx is in [0, ONE) ...` and `... n in {1, 2, ...}` contain an unbalanced `[`, which doctest's `doctest_discover_tests` list handling turns into `add_test called with incorrect number of arguments`.
- **Fix:** Renamed to `rng: uniform_fx is at least 0 and below ONE for 1e5 draws` and `rng: range_u32(n) is below n for n in 1 2 3 7 1000 65536 UINT32_MAX over 1e4 draws each and range_u32(0) == 0`; assertions unchanged.
- **Files modified:** `tests/rng_test.cpp`
- **Verification:** `ctest -R '^rng'` lists and passes 6 cases.
- **Committed in:** `9e6a9b6`

**3. [Rule 3 - Blocking] The forbidden-token gate rejected a header comment**
- **Found during:** Task 2
- **Issue:** `rng.hpp`'s new comment named the standard random header verbatim; `cmake -B` failed with `forbidden token in .../rng.hpp` (the gate is working as designed).
- **Fix:** Reworded the comment; no code change.
- **Files modified:** `include/ddsim/rng.hpp`
- **Verification:** configure reports `12 sim sources are clean`.
- **Committed in:** `9e6a9b6`

### Design choices within the plan's contract (not deviations from must-haves)

- `replayFixture` was generalised (`replayFixtureWith` + two adapters) rather than the CLI carrying its own copy of the loop; the plan's key link "shares parseActions/replayFixture" is honoured through the ABI adapter.
- `restore_test.cpp` discovers fixtures with `std::filesystem` over `tests/golden/*.actions` (the plan: "write the loop over whatever fixtures exist"), so a future fixture is covered without a test edit — matching the Vitest golden test.
- `two_process.cmake` also fails on a missing golden with a message naming the exact `--write-golden` command, and counts a third `--roundtrip --compare` process as part of the test.
- `ctest -R restore` matches 5 cases (two 01-01 skeleton cases also say "restore"); `-R '^restore'` gives the plan's 3. `-R fx64` gives 9 (7 planned + the header check + the 01-01 constructor case).

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking). **Impact on plan:** each was required to make the plan's own tests runnable; no scope creep, no must-have relaxed.

## Issues Encountered

- My first `isqrt` transcription computed the trial value before shifting the root (`2p + 1` instead of `4p + 1`); the `sqrt(144) == 12` static_assert caught it at compile time before any oracle run. The committed version is correct on 1e5 seeded inputs and all listed edges.
- A hand-computed expected constant in the sqrt test was on the wrong scale (2^16 instead of 2^32); the implementation was right, the constant was fixed to `199032864766430`.

## Known Stubs

None introduced by this plan. Still open from 01-01 (tracked in `.planning/WINDOWS.md`): `dd_step()` runs no rules (01-05). The rng stub 01-01 listed ("no next()/streams") and the fx64 stub ("no multiply/divide/sqrt") are closed here.

## Threat Flags

None new. T-03-01 (crafted restore bytes) is mitigated by the sweep; T-03-02 (malformed fixture text) by the strict parser plus the CLI's exit 2; T-03-03 (golden regeneration) by `--write-golden` being an explicit flag and `two_process.cmake` never writing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 01-05 (brush body) can use `fx64 * / sqrt clamp` with exact floor semantics and the stability clamps can be expressed as `reject` on the derived constants; per-entity `seed_stream(seed, DD_PURPOSE_SETTLE, id)` is ready for Phase 2's settle rule.
- Any new fixture dropped into `tests/golden/` is automatically covered by `golden_two_process_<name>` (Debug/Release/UBSan), `restore_test`, and the Vitest golden test; its `.sha256` is produced by `ddsim_replay --write-golden` from native-release.
- SIM-02 remains unchecked until 01-05 finishes (shared-ID gate); SIM-01 is now checked.
- Nothing here needs a human look: every claim was measured headlessly. Optional: `cd data-drawing/sim && ./build/native-release/ddsim_replay tests/golden/many-brushes.actions` to see the four hash lines yourself.

---
*Phase: 01-painting-with-the-pen*
*Completed: 2026-09-23*

## Self-Check: PASSED

All 7 created and 6 modified files exist on disk; commits 3a8441a, 9e6a9b6 and 5a62292 are in history; `git rev-list --count 0492e6a..HEAD` = 3 with code changes, matching `actuals.commits`.
