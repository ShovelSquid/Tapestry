---
phase: 01-painting-with-the-pen
plan: 05
subsystem: sim-core
tags: [cpp20, fixed-point, q32.32, spring-damper, symplectic-euler, stroke-actions, tilt, twist, node-ids, brush-versions, presets, golden-fixtures, ctest, ubsan, emscripten, vitest]

# Dependency graph
requires:
  - phase: 01-01
    provides: "ddsim skeleton: state/walk/hash, action header + DefineBrush, flat C ABI, Wasm build, Vitest golden test"
  - phase: 01-03
    provides: "fx64 mul/div/sqrt with floor semantics, seeded rng streams, strict restore, native-ubsan preset, ddsim_replay CLI, two-process golden CTest per fixture"
provides:
  - "Stroke action grammar (STRK-01/STRK-06): StrokeBegin 56 B with a 9 x i32 Q16.16 plane frame, StrokeSamples with 24-byte samples (tick, index, u, v, pressure, tiltX, tiltY, twist, flags, pad), StrokeEnd 12 B; decoded field by field; every validation row of the interfaces table enforced in order with the hash untouched on rejection; DD_ERR_SAMPLE_RANGE = 11"
  - "Spring-damper brush body inside the sim (STRK-02): rules/brush_body.hpp with DD_BODY_K = 1, DD_BODY_ZETA = 0.5, DD_DIR_EPS = ONE >> 16, derive_params (k_t = K/m, c_t = 2 zeta sqrt(k_t)) shared by validator and integrator, semi-implicit Euler sub-stepped by h = 1/n, held target on empty ticks; validate_brush rejects k_t or c_t outside (0, 1] (mass < 1) — never clamps"
  - "Emission at spacing with stable ids (STRK-03): rules/emit.hpp emit_segment (carried/remaining loop, distance-interpolated inside the sub-step, seg == 0 guard for node 0) and emit_node with make_node_id(branch, ordinal, next_emission_index) inserted at lower_bound; no counter symbol exists"
  - "3D node positions from the recorded frame (CANV-01): pos3 = origin + u right + v up in fx64; z never comes from a camera"
  - "Versioned immutable brush table with four presets (STRK-04): presets.hpp DD_PRESETS ink 1 / rust 4 / clay 16 / lead 64 with fixed raw radius/spacing; sequential append-only ids; descriptions compared byte-wise"
  - "Canonical walk per active stroke now carries u8 has_target | u16 last_pressure | u32 pending_count | 24-byte pending samples; restore rejects a pending sample off this tick, out of order or out of range (SIM-02)"
  - "One test-side encoder (tests/action_writer.hpp) with stroke_actions (the stroke-log builder gen_fixtures and the suites share) and synthetic_sample (the curve 01-07's TS regenerates byte for byte); replayLog in golden_support.hpp"
  - "Seven committed fixtures with goldens — one-stroke, four-per-tick, gap, two-strokes, two-strokes-inserted, brush-edit, presets — reproduced by native-debug, native-release, native-ubsan, two processes + roundtrip, and the Wasm module in Vitest"
  - "Tests: 20 actions cases, 7 brush_body/emit/ids/plane_frame cases, id_stability, 2 tpf, 6 brush_versions"
affects: [01-06, 01-07, 01-08, phase-2-settle, phase-2-grammar, phase-3-timeline, phase-3-marks]

# Actuals (#2632) — chars/4 over the realized diff (git diff d5973c7..HEAD), not a harness token count.
actuals:
  tokens: 51227
  tasks: 3
  commits: 3
plan_head_before: d5973c71b6f98760a13c154d0a61349c398abfa2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rules are inline headers under include/ddsim/rules/, each pinned by a DD_RULE_*_VERSION already in the walk; the validator and the integrator share one derive_params so they cannot drift"
    - "Validation rows run in the documented order over a decoded local; state-dependent checks live in Sim::apply, shape checks in the decoders; the hash is provably untouched by every rejection (each row has a test)"
    - "Derived, not stored: ordinal-in-use is answered from the hashed state (active list + a lower_bound over the ordinal's contiguous node-id range), so a restored sim answers exactly as the live one"
    - "Fixed-point integrator with floor semantics: velocity before position (symplectic), direction from v only above DD_DIR_EPS, h = ONE / n by exact division"
    - "Every loop in the rules is bounded: emission stops consuming path once the node table is full, sample counts are bounded by the payload and by DD_MAX_SAMPLES_PER_*"
    - "Fixtures are described once (stroke_actions) and rendered to text by gen_fixtures; goldens are written by ddsim_replay --write-golden from native-release and only ever compared"

key-files:
  created:
    - data-drawing/sim/include/ddsim/presets.hpp
    - data-drawing/sim/include/ddsim/rules/brush_body.hpp
    - data-drawing/sim/include/ddsim/rules/emit.hpp
    - data-drawing/sim/tests/action_writer.hpp
    - data-drawing/sim/tests/action_test.cpp
    - data-drawing/sim/tests/brush_body_test.cpp
    - data-drawing/sim/tests/id_stability_test.cpp
    - data-drawing/sim/tests/tpf_test.cpp
    - data-drawing/sim/tests/brush_versions_test.cpp
    - data-drawing/sim/tests/golden/one-stroke.actions
    - data-drawing/sim/tests/golden/one-stroke.sha256
    - data-drawing/sim/tests/golden/four-per-tick.actions
    - data-drawing/sim/tests/golden/four-per-tick.sha256
    - data-drawing/sim/tests/golden/gap.actions
    - data-drawing/sim/tests/golden/gap.sha256
    - data-drawing/sim/tests/golden/two-strokes.actions
    - data-drawing/sim/tests/golden/two-strokes.sha256
    - data-drawing/sim/tests/golden/two-strokes-inserted.actions
    - data-drawing/sim/tests/golden/two-strokes-inserted.sha256
    - data-drawing/sim/tests/golden/brush-edit.actions
    - data-drawing/sim/tests/golden/brush-edit.sha256
    - data-drawing/sim/tests/golden/presets.actions
    - data-drawing/sim/tests/golden/presets.sha256
  modified:
    - data-drawing/sim/include/ddsim/action.hpp
    - data-drawing/sim/include/ddsim/brush.hpp
    - data-drawing/sim/include/ddsim/ddsim_c.h
    - data-drawing/sim/include/ddsim/state.hpp
    - data-drawing/sim/src/sim.cpp
    - data-drawing/sim/src/hash.cpp
    - data-drawing/sim/tests/golden_support.hpp
    - data-drawing/sim/tests/skeleton_test.cpp
    - data-drawing/sim/tools/gen_fixtures/main.cpp

key-decisions:
  - "StrokeEnd integrates the end tick's pending samples through integrate_tick before the stroke leaves the active list: 01-07's worker stamps end_tick with the current tick and a pen-up arrives with its last coalesced samples in the same frame, so dropping them would lose recorded input and rejecting would break the recorder; the flush is the same rule at the same tick, needs no new state, and the fixtures (end on the tick after the last sample) are unaffected"
  - "Ordinal reuse is derived from the hashed state (active list + lower_bound over the ordinal's node-id range) instead of the plan's seen_stroke_ids walk entry: a u32 count of zero still adds four bytes to the hashed stream, so the plan's claim that the three pre-existing goldens would survive was false; the derived check keeps them byte-identical, restores exactly, and rejects a duplicate whether the stroke is active or ended with nodes (the only untracked case, a begin/end pair that never received a sample, leaves no ids to collide with)"
  - "curve_weight lives in rules/emit.hpp and is reachable through brush.hpp: brush.hpp -> brush_body.hpp (derive_params) -> emit.hpp (emit_segment for integrate_tick) -> brush.hpp would be an include cycle; the pressure-to-weight mapping is evaluated at emission time so it belongs to the emit rule's version anyway"
  - "The mass-1 preset (k_t = c_t = 1, h = 1) is dead-beat: v <- target - x, x <- target, so at one sample per tick it lands exactly on each sample (lag 0 raw); mass 64 trails a 0.25-unit-per-tick target by 7398907896 raw (1.72 units) after 60 samples. The heavy-vs-light test asserts heavy > light and heavy > 0 (the plan's 'greater than zero' cannot hold for the light body under these constants)"
  - "read_canonical's node pre-check compared node_count * 88 (the snapshot stride) against the remaining bytes, but a walk node record is 84 bytes: every state with at least one node was refused by restore. Latent since 01-01, unreachable until nodes existed, fixed with DD_NODE_WALK_BYTES"
  - "A stroke id with bits above the (branch, ordinal) layout (bits 63..40) is DD_ERR_STROKE_STATE: it would map onto another stroke's node ids; strict parse, reject not clamp"
  - "emit_segment stops consuming path once the node table is full (path_accum = 0) so a legal-but-tiny spacing cannot spin the emission loop past DD_MAX_NODES (T-05-01); below the cap the loop is bounded by the cap"
  - "STRK-03 and SIM-02 marked complete; STRK-01 and STRK-06 wait for 01-06, STRK-04 and CANV-01 for 01-07, STRK-02 for 01-08 (shared-ID gate)"

patterns-established:
  - "Rule headers under include/ddsim/rules/ are the only place behaviour lives; sim.cpp only sequences them (ordinal order, then tick++)"
  - "Per-row rejection tests: every validation row has a case that builds the exact offending bytes, asserts the code and asserts the hash unchanged"
  - "Suites build logs with stroke_actions and replay with replayLog; fixtures are the same builder rendered to text, so a test log and a fixture describing the same stroke are the same bytes"

requirements-completed: [STRK-03, SIM-02]

coverage:
  - id: D1
    description: "Stroke grammar with tilt and twist from the first fixture: StrokeBegin/StrokeSamples/StrokeEnd round-trip field for field; every validation row (tick mismatch, unknown brush, duplicate/zero/over-wide ordinal, active limit, no begin, first index, non-sequential index, per-tick and per-action limits, tilt 91, twist 360, flags bit 3, non-zero pad, end without begin, end tick, truncated/over-long payloads) returns its exact code with the hash unchanged"
    requirement: STRK-01
    verification:
      - kind: unit
        ref: "cd data-drawing/sim && ctest --preset native-debug -R '^actions' (20/20)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tilt and twist fields exist in the 24-byte sample from the first fixture, are zero with flag bits clear when absent, are range-checked (|tilt| <= 90, twist <= 359) and no rule reads them"
    requirement: STRK-06
    verification:
      - kind: unit
        ref: "data-drawing/sim/tests/action_test.cpp#actions: every stroke action round-trips through the writer and decoder field for field (offsets tiltX@16 tiltY@17 twist@18 flags@20 asserted)"
        status: pass
      - kind: other
        ref: "grep -n 'tilt_x\\|tilt_y\\|twist' data-drawing/sim/include/ddsim/rules/*.hpp -> no matches (no rule reads them)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Spring-damper body from mass, stability at define time: mass 0.5 and mass ONE-1 rejected; presets accepted; heavy lags more than light (light=0 dead-beat, heavy=7398907896 raw); every preset converges onto a held target within 600 empty ticks to exactly 0 raw distance and 0 raw velocity; symplectic order pinned (one sub-step from rest lands at exactly ONE); 1x and 4x stepping identical"
    requirement: STRK-02
    verification:
      - kind: unit
        ref: "cd data-drawing/sim && ctest --preset native-debug -R 'brush_body|tpf' (5/5) && ctest --preset native-ubsan -R brush_body (3/3, 0 runtime errors)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Nodes at spacing with ids make_node_id(0, ordinal, k), k dense from 0, first node at the first sample; consecutive nodes 0.5 apart within ONE >> 20 on a straight stroke; inserting stroke 3 between strokes 1 and 2 leaves 172 + 41 nodes of ordinals 1 and 2 identical in id and every field; an ended ordinal cannot be reused; no next_node_id / node_counter symbol"
    requirement: STRK-03
    verification:
      - kind: unit
        ref: "cd data-drawing/sim && ctest --preset native-debug -R 'emit|ids|id_stability' (5/5 incl. 01-01's ids case)"
        status: pass
      - kind: other
        ref: "grep -rn 'next_node_id\\|node_counter' data-drawing/sim/include data-drawing/sim/src -> nothing; grep -n lower_bound data-drawing/sim/include/ddsim/rules/emit.hpp -> line 69"
        status: pass
    human_judgment: false
  - id: D5
    description: "Brush versions append-only with sequential ids, four presets differing in description and mass, empty and 256-byte descriptions rejected, byte-wise description comparison (ink / 'ink ' / NFD i+diaeresis are three brushes), single-brush table hashes identically across sims; after the edit creates version 2, stroke 1's 172 nodes replay identically and stroke 2 with version 2 (62 nodes) differs from version 1 (172 nodes) on the same samples"
    requirement: STRK-04
    verification:
      - kind: unit
        ref: "cd data-drawing/sim && ctest --preset native-debug -R brush_versions (6/6)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Node z comes from the recorded plane frame: with origin (0,0,5) every node's z is exactly 5; with up = (0,0,1) every node's y is 0 and (x, z) equals the default frame's (x, y) node for node"
    requirement: CANV-01
    verification:
      - kind: unit
        ref: "data-drawing/sim/tests/brush_body_test.cpp#plane_frame: node z comes from the recorded frame and never from a camera"
        status: pass
    human_judgment: false
  - id: D7
    description: "All ten fixtures reproduced by native-debug, native-release and native-ubsan (75/75 each, 0 runtime errors), by two fresh processes plus a roundtrip process at every checkpoint (10 golden_two_process tests), and by the Wasm module in Vitest (13/13) with no TS change; mid-stroke serialize/restore at tick 70 continues to the same tick-600 hash; the three pre-existing goldens are byte-identical"
    requirement: SIM-02
    verification:
      - kind: integration
        ref: "cd data-drawing/sim && ctest --preset native-release && ctest --preset native-debug && ctest --preset native-ubsan; cd /Users/kaelencook/Tapestry && npm --prefix plugins/data-drawing run sim:wasm && npm --prefix plugins/data-drawing test"
        status: pass
      - kind: other
        ref: "git diff HEAD --stat -- data-drawing/sim/tests/golden/noop.sha256 one-brush.sha256 many-brushes.sha256 -> empty before every commit"
        status: pass
    human_judgment: false

# Metrics
duration: 24min
completed: 2026-09-24
status: complete
---

# Phase 1 Plan 05: Sim Behaviour — Strokes, Brush Body, Emission, Versions Summary

**The sim now paints: stroke actions with tick-stamped 24-byte samples (tilt and twist from the first fixture) are strictly validated row by row, a mass-derived symplectic spring-damper body integrates them inside the sim with stability enforced at `DefineBrush` (reject, never clamp), nodes are emitted at spacing with `(ordinal, index)` ids at 3D positions from the recorded plane frame, four immutable presets ship, and seven new fixtures replay to committed goldens in Debug, Release, UBSan, two processes, roundtrip and the Wasm module in Vitest — with the three earlier goldens byte-identical.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-09-24T06:52:38Z
- **Completed:** 2026-09-24T07:16:53Z
- **Tasks:** 3
- **Files modified:** 32 (23 created, 9 modified)

## Accomplishments

- STRK-01/STRK-06: `StrokeBegin` (56 B), `StrokeSamples` (24-byte samples: tick, index, u, v, pressure, tiltX, tiltY, twist, flags, pad) and `StrokeEnd` (12 B) are decoded field by field; the interfaces table's validation rows run in order in `Sim::apply` and every row has a test proving its exact code and an unchanged hash; tilt and twist are recorded, range-checked, and read by no rule.
- STRK-02: `rules/brush_body.hpp` — `k_t = K/m`, `c_t = 2 zeta sqrt(k_t)` (K = 1, zeta = 0.5) through one `derive_params` the validator and integrator share; `validate_brush` rejects `k_t` or `c_t` outside (0, 1]; semi-implicit Euler with `h = 1/n`, velocity before position, direction only above `DD_DIR_EPS`, held target on empty ticks. Heavy lags more than light: **light = 0 raw (dead-beat at k = c = 1), heavy = 7398907896 raw (1.72 units)** after 60 samples of a 0.25-unit-per-tick straight stroke; every preset converges onto a held target to exactly 0 raw within 600 empty ticks.
- STRK-03: `rules/emit.hpp` — emission at spacing, distance-interpolated inside the sub-step, node 0 at pen-down, ids `make_node_id(branch, ordinal, next_emission_index)` inserted at their `lower_bound` position; inserting stroke 3 between strokes 1 and 2 leaves all 172 + 41 nodes of ordinals 1 and 2 identical in id and every field.
- STRK-04: `presets.hpp` (`ink` 1, `rust` 4, `clay` 16, `lead` 64 with the plan's raw radius/spacing), sequential append-only versions, byte-wise descriptions; after the edit creates version 2, stroke 1's 172 nodes replay identically and stroke 2 painted with version 2 (62 nodes) differs from version 1 (172 nodes).
- CANV-01 (sim side): `pos3 = origin + u right + v up` in `fx64`; z = 5 for every node on a frame at z 5; on an up = +z frame y is 0 and z carries v.
- SIM-02: the walk now serializes each active stroke's `has_target`, `last_pressure` and pending samples; restore is strict over them; one step per call equals four per burst at every checkpoint; serialize at tick 70 mid-stroke (one pending sample, 346 nodes at the end) restores and continues to the same tick-600 hash and bytes. Ten fixtures, 75/75 tests in each native preset, 0 UBSan findings, Vitest 13/13.

## Task Commits

1. **Task 1: Stroke actions, sample layout with tilt and twist, brush validator with stability clamps, presets, shared encoder** - `18754b0` (feat)
2. **Task 2: Spring-damper brush body, emission at spacing with stable ids, plane frame to 3D** - `52fa3a2` (feat)
3. **Task 3: Stroke fixtures and goldens, insert-a-stroke id stability, ticks-per-frame invariance, brush-version replay, Wasm parity** - `1299234` (feat)

**Plan metadata:** see the final `docs(01-05)` commit.

## The ten goldens (tick-600 lines)

Written by `./build/native-release/ddsim_replay tests/golden/<name>.actions --write-golden tests/golden/<name>.sha256`; the first three are unchanged from 01-01/01-03 (`git diff HEAD --stat -- tests/golden/{noop,one-brush,many-brushes}.sha256` printed nothing before every commit, and `gen_fixtures` regenerated their `.actions` byte for byte).

```
noop                  600 04411bbe5d2f42ab9fd4d6060d0a78cfa0916d288d14ae6a9f495425902b8458
one-brush             600 0b06a0f241e683874c0465ddd6b5d6a490adce125a7d20dca1e3121ebdb0fba4
many-brushes          600 0df3de7c8d19d820097541bfeabb8b36b625e2122270fac36be6ab444e4e267d
one-stroke            600 2e982b0637734aaea4e24f2a53d247f12193dca12125a1d4dbfa1d974f39e9bd
four-per-tick         600 2e12bac486b28a62845d4ae87e5e4200e29dd8010ed910b4b48b6f9d0b336d8c
gap                   600 0764a8bb06ada45b4fb712d826923985d94830c1c65e8ee925d72e7165d72dee
two-strokes           600 de9d939b176dd83ef917fde55199f365b48b3bd2aa7eec0c123321b118803618
two-strokes-inserted  600 9fa00421702af6737337978b47151ee2f965161115ce10ff94097274d7e02b52
brush-edit            600 b19bc2e3622c550bb2c8c80987df3f4940c89636c538c8deba8014d37eb389f5
presets               600 0fed344819c72b0236d879fdd1c0b6a4e8138bceb5fa07c24344424129a34a11
```

`two-strokes` and `two-strokes-inserted` differ at 600 (the inserted stroke's 56 nodes exist) while `id_stability` proves the shared strokes identical. Fixture shapes: one-stroke = 120 samples one per tick at 10..129, end 130 (checkpoints 10, 70, 130, 600); four-per-tick = the same 120 samples as 4 per tick at 10..39, end 40; gap = one per tick with ticks 40-42 empty, end 133; two-strokes = ink 10..69 (end 70) and lead 100..159 (end 160); inserted = plus ordinal 3 ink at 75..95 (end 96), ordinals 1, 3, 2 in time order; brush-edit = ink stroke 1, then brush 2 = ink with mass 4 at tick 80, stroke 2 with brush 2; presets = the four `DD_PRESETS` at ticks 0..3.

## Verification record

- `cmake --preset native-release && cmake --build --preset native-release && ctest --preset native-release` → 100% of 75; `ctest -N | grep -c golden_two_process` → 10.
- `ctest --preset native-debug` → 100% of 75 (`-R 'id_stability|tpf|brush_versions'` lists 9 cases; `-R '^actions'` 20; `-R brush_versions` 6).
- `cmake --preset native-ubsan && ... && ctest --preset native-ubsan` → 100% of 75; `grep -c 'runtime error:'` → 0.
- `npm --prefix plugins/data-drawing run sim:wasm` → Emscripten 6.0.10 matches the pin; `npm --prefix plugins/data-drawing test` → `test/wasm-golden.test.ts` 13 passed, naming all ten fixtures; `node tools/wasm-hash-check.mjs` → `OK one-stroke 4`, `OK presets 2`. No TS file changed.
- Walk change and the earlier goldens: the per-stroke record grew (has_target, last_pressure, pending samples) and the node record is unchanged, so a state without active strokes hashes exactly as before — the three earlier goldens pass untouched in every preset and in Wasm.

## Files Created/Modified

- `include/ddsim/action.hpp` - `PlaneFrame`, `StrokeBegin`, `StrokeSamples`, `StrokeEnd`, `sample_in_range`, `decode_sample`, `decode_stroke_begin/samples/end`; `ByteReader::read_i32/read_i8`
- `include/ddsim/state.hpp` - `Sample` (wire order), sample constants and flag bits, `ActiveStroke` + `has_target`, `last_pressure`, `pending`
- `include/ddsim/ddsim_c.h` - `DD_ERR_SAMPLE_RANGE = 11`
- `include/ddsim/brush.hpp` - validator with the stability clamps via `derive_params`
- `include/ddsim/presets.hpp` - `PresetSpec`, `DD_PRESETS[4]`, `DD_PRESET_COUNT`
- `include/ddsim/rules/brush_body.hpp` - constants, `BodyParams`, `derive_params`, `body_substep`, `integrate_tick`
- `include/ddsim/rules/emit.hpp` - `curve_weight`, `emit_node`, `emit_segment`
- `src/sim.cpp` - stroke dispatch with the validation rows, `stroke_in_use`, sorted active list, `step()` running the rules, `StrokeEnd` flush
- `src/hash.cpp` - per-stroke walk additions with strict restore; `DD_NODE_WALK_BYTES` fix
- `tests/action_writer.hpp` - the one encoder (`ByteWriter`, `wrapAction`, `BrushSpec`, `inkBrush`, `preset_brush`, `write_stroke_*`, `synthetic_sample`, `stroke_actions`)
- `tests/golden_support.hpp` - encoder moved out; `replayLog` added
- `tests/action_test.cpp`, `brush_body_test.cpp`, `id_stability_test.cpp`, `tpf_test.cpp`, `brush_versions_test.cpp` - the suites
- `tests/skeleton_test.cpp` - the unknown-kind case now expects `DD_ERR_BAD_LENGTH` for empty kind 2-4 payloads
- `tools/gen_fixtures/main.cpp` - the seven stroke fixtures through `stroke_actions`
- `tests/golden/*.actions|.sha256` - fourteen new files

## Decisions Made

See `key-decisions` in the frontmatter: the `StrokeEnd` flush; ordinal reuse derived from hashed state (no `seen_stroke_ids` walk entry, goldens byte-identical); `curve_weight` in `rules/emit.hpp`; the dead-beat light body; the 84-byte node pre-check fix; over-wide stroke ids rejected; the emission loop bounded by the node cap; STRK-03 and SIM-02 marked, the rest gated.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `read_canonical` refused every state that held a node**
- **Found during:** Task 3 (all seven stroke fixtures failed `golden_two_process` on the `--roundtrip --compare` leg with `dd_restore returned 10`)
- **Issue:** 01-01's pre-check `node_count * 88 > remaining` used the 88-byte snapshot stride; the walk's node record is 84 bytes (u64 id, 8 x i64, 3 x u32), so with exactly `count * 84` bytes left the check rejected. Unreachable until this plan produced nodes.
- **Fix:** `DD_NODE_WALK_BYTES = 8 + 8*8 + 3*4` in `hash.cpp`.
- **Files modified:** `data-drawing/sim/src/hash.cpp`
- **Verification:** `golden_two_process_*` 10/10 in every preset; `tpf: serialize at tick 70 mid-stroke ...` passes; the 01-03 restore sweep still reports 0 silent corrections.
- **Committed in:** `1299234`

**2. [Rule 2 - Missing critical] `StrokeEnd` integrates the end tick's pending samples**
- **Found during:** Task 2
- **Issue:** The validation table is silent about samples already applied on the end tick. 01-07's worker stamps `end_tick` with the current tick and a pen-up arrives with its last coalesced samples in the same frame, so those samples would have been silently dropped (data loss) — or, if rejected, the recorder design would break.
- **Fix:** Before the stroke leaves the active list, `apply` runs `integrate_tick` on its non-empty `pending` — the same rule at the same tick `step()` would have used; no new state. Fixtures end on the tick after the last sample and are unaffected.
- **Files modified:** `data-drawing/sim/src/sim.cpp`
- **Verification:** `actions: a well-formed stroke is accepted and each action changes the hash` ends a stroke on a tick with a pending sample; every golden and Wasm check passes.
- **Committed in:** `52fa3a2`

**3. [Rule 1 - Bug] The plan's `seen_stroke_ids` walk entry would have changed the three earlier goldens**
- **Found during:** Task 1
- **Issue:** The plan states a `u32 seen_count` added to the walk leaves the noop/one-brush/many-brushes goldens unchanged "because the count is zero"; a zero count still adds four bytes to the hashed stream, contradicting the acceptance criterion that those goldens stay byte-identical.
- **Fix:** `stroke_in_use(state, id)` derives the answer from hashed state: any active stroke with that id, or any node whose id falls in `[make_node_id(b, o, 0), make_node_id(b, o, index_mask)]` (one `lower_bound`). Duplicate rejection is tested for an active stroke and for an ended stroke with nodes; the walk is unchanged for states without strokes.
- **Files modified:** `data-drawing/sim/src/sim.cpp`
- **Verification:** `git diff HEAD --stat` over the three goldens is empty; `ids: ... an ended ordinal cannot be reused` passes.
- **Committed in:** `18754b0` (rejection), `52fa3a2` (node-range half becomes reachable)

**4. [Rule 3 - Blocking] `curve_weight` placed in `rules/emit.hpp` instead of `brush.hpp`**
- **Found during:** Task 1
- **Issue:** `brush.hpp` must include `rules/brush_body.hpp` (shared `derive_params`), `brush_body.hpp` must include `rules/emit.hpp` (`integrate_tick` calls `emit_segment`), and `emit.hpp` needing `curve_weight` from `brush.hpp` closes an include cycle that breaks under either include order.
- **Fix:** `curve_weight` is defined in `emit.hpp` (it is evaluated at emission time and belongs to that rule's version) and is reachable through `brush.hpp`.
- **Files modified:** `data-drawing/sim/include/ddsim/rules/emit.hpp`, `brush.hpp`
- **Verification:** every TU compiles warning-free under all presets and Emscripten.
- **Committed in:** `18754b0`

**5. [Rule 1 - Bug in the test spec] Light lag is exactly zero**
- **Found during:** Task 2
- **Issue:** The plan's heavy-vs-light case asks for the light distance to be "greater than zero"; with the pinned constants (k_t = c_t = 1, h = 1) the mass-1 update is dead-beat (`v <- target - x; x <- target`) so at one sample per tick it lands on each sample exactly.
- **Fix:** The case asserts `heavy > light`, `heavy > 0`, pins `light == 0`, and reports both raw values in its message (`light=0 heavy=7398907896`).
- **Files modified:** `data-drawing/sim/tests/brush_body_test.cpp`
- **Committed in:** `52fa3a2`

**6. [Rule 2 - Correctness] Stroke ids with bits above the layout are rejected; the emission loop is bounded by the node cap**
- **Found during:** Tasks 1 and 2
- **Issue:** A stroke id with bits 63..40 set would be a "different" stroke mapping onto another stroke's node ids; a legal spacing of one raw unit would make `emit_segment` iterate 2^32+ times per unit of path (T-05-01).
- **Fix:** `(stroke_id >> 40) != 0` → `DD_ERR_STROKE_STATE` (also enforced by restore); `emit_segment` stops consuming path (`path_accum = 0`) once `state.nodes.size() >= DD_MAX_NODES`, so per-segment iterations are bounded by the cap.
- **Files modified:** `sim.cpp`, `hash.cpp`, `rules/emit.hpp`
- **Committed in:** `18754b0`, `52fa3a2`

### Design choices within the plan's contract (not deviations from must-haves)

- `Sample` is defined in `state.hpp` (the walk and `ActiveStroke::pending` need it; `action.hpp` includes `state.hpp`); `samples_this_tick` is not stored — it is always `pending.size()`; `last_pressure` (u16) was added so an empty tick emits with a real pressure and restores exactly.
- The plan's "pressure > DD_PRESSURE_MAX" case cannot be built while the provisional width is 65535 on a u16 field; the case asserts that fact statically and that 65535 is accepted. The plan's own suggestion to skip the `DD_MAX_NODES` cap test was followed (the cap path is read in `emit.hpp`; making 2^20 nodes per test run is not worth the time).
- `skeleton_test.cpp`'s unknown-kind case was updated: kinds 2-4 with an empty payload are now `DD_ERR_BAD_LENGTH` (they are real actions), kinds 0/5/255 remain `DD_ERR_UNKNOWN_KIND`.
- The stroke-log builder `stroke_actions` and `replayLog` were added to `action_writer.hpp` / `golden_support.hpp` so the generator, `id_stability`, `tpf` and `brush_versions` describe strokes once; `brush_body_test.cpp` keeps its own small straight-line builder.
- Test names avoid `[`, `]`, `{`, `}` (doctest discovery); note that `ctest -N` right-aligns numbers, so `grep "Test #"` misses single-digit cases — count with `grep "Test *#"`.

---

**Total deviations:** 6 auto-fixed (3 bugs incl. one in the plan's contract and one in a test spec, 2 missing-critical/correctness, 1 blocking). **Impact on plan:** every must-have truth holds; the three earlier goldens are byte-identical; no scope added beyond bounded loops and strict parsing.

## Issues Encountered

- First run of Task 3's two-process tests failed on all seven new fixtures with `dd_restore returned 10` — the 88-vs-84 pre-check above. The tpf mid-stroke case and the roundtrip leg now cover restore with nodes and with pending samples.
- Vitest passed before that fix (it never restores), which is a reminder that the roundtrip leg is the one that exercises `read_canonical` on real states.

## Known Stubs

None. The 01-01 stub "dd_step() advances the tick and runs no rules; stroke kinds return DD_ERR_UNKNOWN_KIND" (WINDOWS.md id 1) is closed by this plan.

## Threat Flags

None new. T-05-01 (hostile counts/ticks/indices/ranges): every row has a test; sample counts are bounded by the payload before any reserve; the emission loop is bounded by `DD_MAX_NODES`. T-05-02 (overflow): `-fwrapv` everywhere, 75/75 under UBSan with 0 findings on every fixture. T-05-03: goldens written once by `--write-golden` from native-release, compared by three presets, two processes, roundtrip and Wasm.

## For 01-06 / 01-07 / 01-08

- 01-07's TS encoder must produce the byte layouts in `action.hpp`'s header comment; `presets.actions` (ticks 0..3) and `one-stroke.actions` are the byte oracles the plan names; `synthetic_sample` is the integer curve to regenerate.
- `StrokeEnd` on the same tick as that tick's samples is accepted and integrates them (deviation 2) — the worker may stamp `end_tick = current tick` as planned.
- `StrokeSamples` index rule: the first index of an action is 0 if no sample was applied this tick, else the last index + 1 (`pending` is the truth; it is cleared by `step()`). Up to 64 samples per tick, 1024 per action.
- `dd_body_ptr` now lists every active stroke (stroke id, body x, y, vx, vy, target u, v) for the cursor overlay.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The sim is behaviourally complete for Phase 1: 01-06 (pen fence/plane math, pure TS) and 01-07 (recorder + encoder + placeholder renderer) can build on committed byte oracles; 01-08 mounts it in Tapestry.
- Phase 2's settle rule gets `seed_stream(seed, DD_PURPOSE_SETTLE, id)` and a node table it can iterate in ascending id; Phase 2's STRK-05 (dead zone, finish line) should revisit the `StrokeEnd` semantics (the flush is the Phase 1 shape; a finishing body would keep the stroke active for a bounded number of ticks).
- Nothing here needs a human look; every claim above was measured headlessly. Optional feel check later on the dev page once 01-07 lands: paint with `lead` vs `ink`.

---
*Phase: 01-painting-with-the-pen*
*Completed: 2026-09-24*

## Self-Check: PASSED

All 23 created files exist on disk (16 spot-checked above by path); commits 18754b0, 52fa3a2 and 1299234 are in history; `git rev-list --count d5973c7..HEAD` = 3 with code changes, matching `actuals.commits`.
