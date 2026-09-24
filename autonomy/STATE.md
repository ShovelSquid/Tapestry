# STATE — the handoff between autonomous sessions

Read fully at the start of every session. Rewrite the "Next" section at
the end of every session so its first item can be started cold.

**2026-09-24 redirect.** `phase-2-implementation-v1` was merged into this
branch. It brings the deterministic kernel (`tapestry/kernel/`), the
Electron app (`app/`), the plugin SDK (`sdk/`), and plugins. Mathspace is
now the engine over the kernel, hosted as `plugins/mathspace/`, per the
rewritten `mathspace_plan.md`. The SDL Space page work (`tapestry/core`)
was reverted to v1's files; that path is abandoned. The store, hash,
actions, replay tool, and goldens built before the redirect are kept.

## Phases

| Phase | Status |
| --- | --- |
| 1 engine over the kernel | in progress (store/hash/actions/replay done; ids, ABI, wasm, plugin remain) |
| 2 expressions | not started |
| 3 force rules | not started |
| 4 constraints | not started |
| 5 views | not started |
| 6 metrics | not started |
| 7 fold ddsim | not started |

## In progress

Nothing. Tree is clean. (`autonomy/watch.py` is the operator's log
viewer; it is theirs to edit.)

## Next

1. **Kernel ids.** Rewrite `include/mathspace/ids.hpp`: `NoteId` is a
   plain sequential `u64` (kernel `NodeId`), drop the branch/group/index
   layout, masks, `make_note_id`, and their tests in
   `tests/mathspace/ids_test.cpp`. Keep `SpaceId` as a distinct type over
   the same value. Fix every caller (`world.cpp`, `action.cpp`, fixtures
   in `tests/golden/ms/*.actions` if they encode structured ids — check
   `tools/ms_replay` and `tests/mathspace/fixture.hpp`). Re-record the
   two goldens if the walk changed; say so in the commit.
2. **Bootstrap integrate rule.** `src/mathspace/step.cpp`: in
   `World::step`, for each note in id order that has both `position` and
   `velocity` fields of equal dim, `position += velocity`. Pin
   `MS_RULE_INTEGRATE_VERSION = 1` in `version.hpp` and write it into the
   hash walk. Golden `tests/golden/ms/velocity.actions` + `.sha256`.
3. **Snapshot bytes.** `World::notes_bytes()` refreshed by `apply` and
   `step`: per note in id order `u64 id | u8 field_count | per field in
   name order: u8 name_len | name | u8 dim | dim x i64`. Test: bytes match
   a hand-built expectation; stable across serialize/restore.
4. **C ABI.** `include/mathspace/mathspace_c.h`, `src/mathspace/ms_c.cpp`:
   `ms_version, ms_create(seed), ms_destroy, ms_apply(ptr,len), ms_step,
   ms_tick, ms_hash(out32), ms_serialize(out_ptr,out_len), ms_restore,
   ms_notes_ptr, ms_notes_len`. Same error-code style as `ddsim_c.h`.
   Tests through the ABI only, like `tools/ddsim_replay` does.
5. **Wasm target.** `wasm/mathspace_wasm.cpp` and a `mathspace_wasm`
   executable in the `EMSCRIPTEN` block of `CMakeLists.txt`, exporting
   the `ms_*` symbols plus malloc/free, output `mathspace.mjs`. Building
   needs Emscripten 6.0.10 at `$EMSDK`; if it is not installed, install
   it under `~/emsdk` per `plugins/data-drawing/surface/scripts/build-wasm.sh`
   (network required) and record the outcome under Learned.
6. **Plugin skeleton.** `plugins/mathspace/`: `tapestry.plugin.json`
   (api "1", commands `mathspace.run`, `mathspace.pause`,
   `mathspace.step`), `package.json` (workspace member, vitest),
   `scripts/build-wasm.sh` mirroring data-drawing's but building the root
   project's `wasm-release` preset and copying `mathspace.mjs/.wasm`
   into `plugins/mathspace/wasm/` (gitignored), `engine.js` loading it.
7. **`image.js`.** Kernel `NodeData` → engine actions: exact real↔raw
   int64 conversion (reject reals that are not `k / 2^32` with `|k| <
   2^53`), key conventions (`f.x f.y f.z f.w`, `f.0..` above dim 4,
   `space ref`, implicit space per tree frame), and `diff(before,
   after)` → `set` ops. Vitest tests for all three.
8. **Run loop and commits.** In `index.js`: on `mathspace.run`, build the
   image from `getNodes()`, step at 60 Hz with `setInterval`, every 60
   ticks or on pause read the snapshot, diff, `kernel.submit('plugin',
   'mathspace', 'advance', [...sets, {op:'advance', ticks:k}])`. Before
   each commit compare `status().lastGoodSeq` with the seq of our last
   commit; if others committed, rebuild the image first. Checkpoint
   fixture `plugins/mathspace/test/fixtures/velocity.json`.
9. **Phase 1 done check.** Build the app (`npm install` at the root,
   `npm run build:native` in `app/`, then the app's dev script; see
   `app/package.json`), create a note, set `velocity.x real 1` via the
   inspector or a `set` commit, Run, Pause, confirm the `.tree` has the
   `set position.x` lines and reopening shows the note moved. Record
   exactly how the app was launched under Learned. Then mark phase 1
   done and update `README.md`'s status paragraph.

Then phase 2 per the plan, starting with `include/ddsim/fxmath.hpp` and
its oracle tests.

## Done

- `3cd79d9` ms1 step 1: build scaffolding (`mathspace` lib, tests, ids).
- `1d6f2f1` autonomy: driver bash 3.2 guard.
- ms1 note store, world, hash walk, actions 32..36, replay tool, goldens
  `empty` and `two-notes` (commits up to `943b9bb`).
- SDL Space page (`bdf03eb`..`8774401`): reverted in the redirect commit;
  kept in history only.
- `215602c` merge of `phase-2-implementation-v1`.

## Decisions

- Mathspace is a plugin over the kernel, not a second store. Durable
  state is the `.tree`; the engine image is derived. (2026-09-24, from
  the merge review.)
- real↔fx64 conversion is exact and lives in JS at the plugin boundary,
  so no double enters the gated C++ tree.
- Note ids are kernel ids. The structured id layout is dropped.
- Phase 1 ships one hardcoded bootstrap rule (`position += velocity`) so
  something moves; phase 3 deletes it.

## Learned

- Full Debug configure+build+ctest of the root tree is ~10 s; Release
  the same. Run both every slice, it is cheap.
- `mathspace_tests` gets `MATHSPACE_GOLDEN_DIR` = `tests/golden/ms`.
- The tapestry kernel builds alone with
  `cmake -S tapestry -B build/tapestry-kernel -DTAPESTRY_BUILD_RENDER=OFF
  -DTAPESTRY_BUILD_APP=OFF` and its 59 tests pass in ~2 s. Render ON
  needs network for glad on first configure.
- The app stores positions as `position.x`/`position.y` reals measured
  from the note's tree frame origin, plus `pinned bool`
  (`app/src/renderer/layout/placement.ts`). Match these keys exactly.
- The SDK (`sdk/src/index.ts`) gives plugins `kernel.getNodes/getNode/
  getEdges/status/submit`; commits are stamped `plugin <dir-name>`.
  Surfaces get no kernel access in API 1.
- `.claude/CLAUDE.md` (merged from v1, GSD-generated) says work happens
  in `/Users/kaelencook/Tapestry` on branch `phase-2-implementation-v1`.
  That is the primary checkout's instruction, not this worktree's; the
  root `CLAUDE.md` overrides it here.

## Blocked

(questions a human would have been asked; answered by the session's best
judgement, recorded here so a human can revisit)
