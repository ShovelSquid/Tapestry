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
| 1 engine over the kernel | in progress (store/hash/actions/replay/ids/snapshot/ABI/wasm/plugin skeleton/image done; run loop, app check remain) |
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

1. **Run loop and commits.** In `index.js`: on `mathspace.run`, build the
   image from `getNodes()`, step at 60 Hz with `setInterval`, every 60
   ticks or on pause read the snapshot, diff, `kernel.submit('plugin',
   'mathspace', 'advance', [...sets, {op:'advance', ticks:k}])`. Before
   each commit compare `status().lastGoodSeq` with the seq of our last
   commit; if others committed, rebuild the image first. `image.js`
   already gives `buildImage(nodes)` → `{actions, fields, types,
   problems}`, `parseSnapshot(engine.notes())` and `diff(fields, snap,
   types)` → setProperty ops; the checkpoint fixture
   `test/fixtures/velocity.json` exists and passes. Test the loop with a
   fake `kernel` object (getNodes/status/submit recording calls) and
   fake timers.
2. **Phase 1 done check.** Build the app (`npm install` at the root,
   `npm run build:native` in `app/`, then the app's dev script; see
   `app/package.json`), create a note, set `velocity.x real 1` via the
   inspector or a `set` commit, Run, Pause, confirm the `.tree` has the
   `set position.x` lines and reopening shows the note moved. Record
   exactly how the app was launched under Learned. Then mark phase 1
   done and update `README.md`'s status paragraph.

Then phase 2 per the plan, starting with `include/ddsim/fxmath.hpp` and
its oracle tests.

## Done

- `07f35f4` ms1 image.js: exact real↔raw, key convention, JS encoders
  pinned to `velocity.actions`, `buildImage`, `parseSnapshot`, `diff`,
  checkpoint fixture `test/fixtures/velocity.json` (16 tests).
- `feab148` ms1 plugin skeleton: `plugins/mathspace/` manifest, package,
  `scripts/build-wasm.sh`, `engine.js` (Engine over ms_*), `index.js`
  with stub commands, vitest golden replay (8 tests).
- `f7013b3` ms1 wasm target: `wasm/mathspace_wasm.cpp`, `mathspace_wasm`
  in `CMakeLists.txt`, `tools/wasm-hash-check.mjs` takes either module.
- `8587ec9` ms1 C ABI: `include/mathspace/mathspace_c.h`,
  `src/mathspace/ms_c.cpp`, `tests/mathspace/c_abi_test.cpp`.
- `dc75224` ms1 lazy notes snapshot: `World::notes_bytes()` in
  `snapshot.cpp`, `notes_dirty`/`notes_cache` set by mutators, step and
  restore; tests in `snapshot_test.cpp`.
- `a247eab` ms1 bootstrap integrate rule in `step.cpp`,
  `MS_RULE_INTEGRATE_VERSION` in the walk (FORMAT_VERSION 2), golden
  `velocity`.
- `0903619` ms1 kernel ids: `NoteId` plain u64, create actions carry the
  id, `next_group` gone from World and the walk, goldens re-recorded.
- `3cd79d9` ms1 step 1: build scaffolding (`mathspace` lib, tests, ids).
- `1d6f2f1` autonomy: driver bash 3.2 guard.
- ms1 note store, world, hash walk, actions 32..36, replay tool, goldens
  `empty` and `two-notes` (commits up to `943b9bb`).
- SDL Space page (`bdf03eb`..`8774401`): reverted in the redirect commit;
  kept in history only.
- `215602c` merge of `phase-2-implementation-v1`.

## Decisions

- The implicit space (notes with `position.*` and no `space` ref) is one
  per image under id `2^63`, a value no kernel `n<k>` reaches, dim 2.
  `diff` ignores snapshot notes absent from the before-image, so the
  implicit space never becomes a kernel op. (2026-09-24, `07f35f4`.)
- An inexact real (not `k/2^32`) drops the whole field it belongs to from
  the image and is reported in `buildImage(...).problems`; the note is
  still created. Rejecting per the plan rather than rounding; see
  Blocked. (2026-09-24, `07f35f4`.)
- Mathspace is a plugin over the kernel, not a second store. Durable
  state is the `.tree`; the engine image is derived. (2026-09-24, from
  the merge review.)
- real↔fx64 conversion is exact and lives in JS at the plugin boundary,
  so no double enters the gated C++ tree.
- Note ids are kernel ids. The structured id layout is dropped.
- The engine never allocates ids (2026-09-24, session `0903619`).
  `CreateSpace`/`CreateNote` carry the kernel's id in the payload; the
  store rejects zero and duplicates (`Error::DuplicateId`) and does not
  track deleted ids, because "never reused" is the kernel's promise, not
  something the image can or should enforce. `World::apply` lost its
  `created` out-param for the same reason.
- `ms_serialize` uses ddsim's cap protocol (cap 0 returns the needed
  length, short cap returns 0) rather than a handle-owned buffer, so the
  plugin loader can be data-drawing's with the prefix changed. `ms_error`
  values equal `mathspace::Error` by value, `static_assert`ed in
  `ms_c.cpp`; `ms_version()` returns `MS_ABI_VERSION` (1), separate from
  the walk's `FORMAT_VERSION`. (2026-09-24, session `8587ec9`.)
- Phase 1 ships one hardcoded bootstrap rule (`position += velocity`) so
  something moves; phase 3 deletes it.

## Learned

- This worktree has no `node_modules`; the pattern is a symlink to the
  primary checkout's: `ln -s /Users/kaelencook/Tapestry/node_modules
  node_modules` (gitignored). vitest 2.1.9 lives there. Plugin tests:
  `npm test` in `plugins/mathspace` after `npm run engine:wasm`.
- Plugin files are CommonJS (`require`d by the host), so the vitest config
  is `vitest.config.mjs` and tests reach `engine.js` through
  `createRequire` (`test/engine-cjs.js`); `"type": "module"` in
  package.json would break the host's require.
- Wasm build: `source ~/emsdk/emsdk_env.sh` (prints 6.0.10), then
  `cmake --preset wasm-release && cmake --build build/wasm-release`.
  Configure+build is ~15 s. `node tools/wasm-hash-check.mjs
  build/wasm-release/mathspace.mjs tests/golden/ms/<f>.actions
  tests/golden/ms/<f>.sha256` printed `OK` for empty, two-notes and
  velocity on the first try; the Wasm hashes equal the native goldens.
  `mathspace.wasm` is 36 KB. `_ms_create` takes a BigInt seed and
  `_ms_tick` returns one (WASM_BIGINT is on by default).
- In a doctest file with `using namespace mathspace`, a free helper
  named `apply` collides with `std::apply` (ADL on `std::vector` args)
  and gives a baffling `tuple_size` error. Name helpers `applyTo`.
- `tests/golden/ms/*.actions` are globbed by `CMakeLists.txt`, so a new
  fixture gets its two-process test at configure time with no edit.
  Write fixture hex with a few lines of Python from the grammar in
  `action.hpp` rather than by hand (a by-hand attempt was off by a byte).
- Re-recording goldens: `build/native-debug/ms_replay <f>.actions
  --write-golden <f>.sha256`, then Release and UBSan must agree.

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

- Dragged notes may hold positions that are not `k/2^32` (a drag at a
  fractional zoom divides by the zoom). The plan says such reals are
  rejected, so `buildImage` drops that note's `pos` and it does not move.
  If the phase 1 app check shows this bites, the run loop could round
  and commit the rounded position first; that is a plan change, so it is
  left for a human. (2026-09-24)
