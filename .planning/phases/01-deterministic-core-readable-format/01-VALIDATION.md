---
phase: "1"
slug: "deterministic-core-readable-format"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-08"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | doctest v2.5.3 (vendored single header at `tapestry/third_party/doctest/`, discovered by CTest via `doctest_discover_tests`) |
| **Config file** | none — Wave 0 (Plan 01 Task 2) adds the `tapestry_kernel_tests` target and discovery to `tapestry/CMakeLists.txt` |
| **Quick run command** | `/Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel/tapestry_kernel_tests -ts=<value|codec|journal|kernel|readability>` (or `-tc="<case name>*"`) |
| **Full suite command** | `cmake --build /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel -j 8 && ctest --test-dir /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel --output-on-failure` |
| **Estimated runtime** | ~1 seconds (sweeps in Plan 04 run in milliseconds; builds are incremental) |

First-time configure (verified on this machine by RESEARCH, render stack off, no network): `cmake -S /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry -B /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build-kernel -DTAPESTRY_BUILD_APP=OFF -DTAPESTRY_BUILD_RENDER=OFF`

Legacy regression (render stack on, existing build dir): `ctest --test-dir /Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry/build -R '^(camera|world|document)$' --output-on-failure` → expect "100% tests passed, 0 tests failed out of 3".

---

## Sampling Rate

- **After every task commit:** Run `…/build-kernel/tapestry_kernel_tests -ts=<suite touched>` (build first with `cmake --build …/build-kernel -j 8`)
- **After every plan wave:** Run the full suite command above, plus the legacy regression once per wave
- **Before `/gsd-verify-work`:** Full suite must be green and `tapestry/docs/tree/example.tree` unchanged (or intentionally regenerated with a commit message)
- **Max feedback latency:** 1 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | TREE-01, TREE-02, TREE-04 | — | N/A (checkpoint:decision — format bundle confirmed by the user) | manual | — (decision gate, no command) | — | ⬜ pending |
| 1-01-02 | 01 | 1 | TREE-01 | T-1-SC / T-1-13 | Vendored headers pinned; kernel links no renderer; no FetchContent in kernel build | build + unit (KAT) | `cmake -S …/tapestry -B …/build-kernel -DTAPESTRY_BUILD_APP=OFF -DTAPESTRY_BUILD_RENDER=OFF && cmake --build …/build-kernel -j 8 && ctest --test-dir …/build-kernel --output-on-failure`; `nm -u …/libtapestry_kernel.a \| grep -ci 'nvg\|glad'` → 0 | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | TREE-02, TREE-04 | T-1-11 | Locale-independent real parse/format; NaN/Inf rejected; strict id/time grammars | unit | `…/build-kernel/tapestry_kernel_tests -ts=value` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 2 | TREE-01, TREE-02, TREE-03 | — | Contracts document validate→write→apply order and torn/corrupt flag | compile | `for h in …; do clang++ -std=c++20 … -fsyntax-only -I . -x c++ "$h"; done` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 2 | TREE-01, TREE-02, TREE-03 | T-1-01 / T-1-02 / T-1-03 / T-1-05 / T-1-07 / T-1-10 | Digest+chain verified before apply; limits before allocation; flock; F_FULLFSYNC before ack; O_NOFOLLOW | tracer (unit + readable file grep) | `…/tapestry_kernel_tests -ts=kernel`; `grep -c … "$TMPDIR"/tapestry-kernel-tracer.tree` ≥ 11; full ctest | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 3 | TREE-02, TREE-01 | T-1-02 / T-1-04 / T-1-05 / T-1-14 | UTF-8/NUL validation; line/record limits; delimiter escalation; ids only via prepare | unit (pure codec) | `…/tapestry_kernel_tests -ts=codec` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 3 | TREE-02 | T-1-14 / T-1-15 | Unknown verbs stop the load; x- lines preserved; deleted ids never reused | unit (kernel API) | `…/tapestry_kernel_tests -ts=kernel` + full ctest | ❌ W0 | ⬜ pending |
| 1-04-01 | 04 | 3 | TREE-03 | T-1-01 / T-1-03 / T-1-07 | Torn/corrupt never Ok; write→sync→ack; lock excludes second writer; open never modifies the file | property (sweeps) + unit | `…/tapestry_kernel_tests -ts=journal`; `… -tc='*exhaustive prefix truncation*' -s \| grep -E 'assertions: … 0 failed'` | ❌ W0 | ⬜ pending |
| 1-04-02 | 04 | 3 | TREE-03, TREE-02 | T-1-06 / T-1-16 / T-1-08 | Sidecar name from path+timestamp only; repair explicit and ordered; save-as byte-identical | unit | `…/tapestry_kernel_tests -ts=journal` + full ctest; `ls "$TMPDIR" \| grep -c '\.torn-'` → 0 | ❌ W0 | ⬜ pending |
| 1-05-01 | 05 | 4 | TREE-04 | — | Corrections keep earlier values; recorded never orders | unit | `…/tapestry_kernel_tests -ts=kernel -tc='kernel: three kinds of time*,kernel: recorded is audit-only*,kernel: tick changes only*'` | ❌ W0 | ⬜ pending |
| 1-05-02 | 05 | 4 | TREE-01 | T-1-17 | Fixture regenerated only with TAPESTRY_REGEN_FIXTURE; drift fails | golden + assertion | `…/tapestry_kernel_tests -ts=readability`; `grep -c '\\n' …/docs/tree/example.tree` → 0; `grep -c '^@end sha256:' …` → 7 | ❌ W0 | ⬜ pending |
| 1-05-03 | 05 | 4 | TREE-01 | T-1-09 / T-1-08 | FORMAT.md states integrity-not-authenticity and plaintext-by-design | doc grep + manual cold read | heading loop over `…/docs/tree/FORMAT.md` + keyword grep ≥ 7; `<human-check>` cold read (end-of-phase UAT) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Paths abbreviated with `…` expand to `/Users/kaelencook/conductor/workspaces/Tapestry/tehran/tapestry` (source) and `…/build-kernel` (git-ignored build output). Every `<automated>` command in the plans carries a `<fails_when>` naming its observable failure signal; the doctest summary line `[doctest] test cases: N | …` reporting 0 cases is the "filter matched nothing" signal for every `-ts`/`-tc` command.

---

## Wave 0 Requirements

- [ ] `tapestry/third_party/doctest/{doctest.h,doctest.cmake,doctestAddTests.cmake,LICENSE.txt}` — vendored v2.5.3 (Plan 01 Task 2)
- [ ] `tapestry/third_party/picosha2/{picosha2.h,LICENSE}` — vendored, commit hash recorded in the CMake banner (Plan 01 Task 2)
- [ ] `tapestry/CMakeLists.txt` — `TAPESTRY_BUILD_RENDER` option, `tapestry_kernel`, `tapestry_kernel_tests`, `doctest_discover_tests`, `TAPESTRY_FIXTURE_DIR`, GLOB `CONFIGURE_DEPENDS` source lists (Plan 01 Task 2)
- [ ] `tapestry/kernel_tests/main.cpp` — `DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN` (Plan 01 Task 2)
- [ ] `tapestry/kernel_tests/support.hpp` — `scratchPath`, `readFile`, `writeFile`, `fileSize`, `fileExists` (Plan 01 Task 2)
- [ ] `tapestry/kernel_tests/value_test.cpp` — SHA-256 KAT first (Plan 01 Task 2), then reals/locale/quoting/times/ids (Plan 01 Task 3)
- [ ] `tapestry/.gitignore` — `build-kernel/` (Plan 01 Task 2)
- [ ] `tapestry/kernel_tests/kernel_test.cpp` — tracer case + `RecordingSink` (Plan 02 Task 2); extended in Plans 03 and 05
- [ ] `tapestry/kernel_tests/codec_test.cpp` — pure codec suite (Plan 03 Task 1)
- [ ] `tapestry/kernel_tests/journal_test.cpp` — sweeps, sinks, repair, save-as (Plan 04)
- [ ] `tapestry/kernel_tests/readability_test.cpp` + `tapestry/docs/tree/example.tree` — golden fixture generated once with `TAPESTRY_REGEN_FIXTURE=1` then frozen (Plan 05 Task 2)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A person can read the journal cold and identify content, relationships, changes, authorship and branch ancestry | TREE-01 | Readability is a human judgment (RESEARCH A10); literal greps prove presence, not comprehension | Plan 05 Task 3 `<human-check>`: open `tapestry/docs/tree/example.tree` in a text editor without FORMAT.md and answer the five questions (who/what, which edge, corrected date and its earlier value, which lines are recorded vs event vs tick, which branch and how records chain); then skim FORMAT.md for contradictions. Harvested at end of phase (`workflow.human_verify_mode = end-of-phase`). |
| The `.tree` v1 format bundle is the one the user wants | TREE-01..04 | One-way door (on-disk format) — a decision, not a test | Plan 01 Task 1 `checkpoint:decision` (block-lines recommended) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 1s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
