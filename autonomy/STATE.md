# STATE — the handoff between autonomous sessions

Read fully at the start of every session. Rewrite the "Next" section at
the end of every session so its first item can be started cold.

**2026-09-24 redirect.** `phase-2-implementation-v1` (kernel, Electron
app, SDK, plugins) was merged in; mathspace is the engine over the
kernel, hosted as `plugins/mathspace/`, per the rewritten plan. The SDL
Space page path is abandoned; the pre-redirect store, hash, actions,
replay tool and goldens are kept.

## Phases

| Phase | Status |
| --- | --- |
| 1 engine over the kernel | built and tested headlessly (`836a4da`); only the human GUI confirmation is open, see Blocked |
| 2 expressions | done headlessly (`c5d134e`, `d6e9c0b`): golden `plot` hashes across processes and builds, `<f>.expr text` props bind through the runner so the bound value is committed as a kernel prop after a step (the inspector reads props, so it shows it; a human look is still open like phase 1's), and `diff.hpp` exists for phase 4 |
| 3 force rules | engine (`22bc70c`, `f90b3c7`, `872831b`, `919c06e`, `e0b6942`): force and `set.<f>` rules under unary, pair and global scope with `select`, mass integrator, `pinned`, `RuleDims`, goldens `gravity` and `pair`; plugin side (`204ced5`): rule nodes, `mathspace.error` for compile-time failures; open: runtime-skip reporting (RULE-07), presets, then the plan's done condition check |
| 4 constraints | not started |
| 5 views | not started |
| 6 metrics | not started |
| 7 fold ddsim | not started |

## In progress

Nothing. Tree is clean. (`autonomy/watch.py` is the operator's log
viewer; it is theirs to edit.)

## Next

1. **RULE-07 runtime errors.** The engine skips silently at runtime
   (a per-visit eval error, a `set.<f>` the target lacks, a rule whose
   program is at the wrong dim or whose `scope`/`select` is malformed);
   the plugin writes only compile-time problems. Add an `ms_errors`
   C ABI call (not in the hash, not in the snapshot bytes): per rule id,
   a skip count for the last tick and the last `VmError`/reason code,
   collected in `step.cpp` into a `std::vector` on `World` that step()
   resets (it is not serialized, so `restore`/`==` ignore it; the
   forbidden-token gate allows `vector`). Then `Engine.errors()` in
   `engine.js` and have `runner.js` fold `rule <id>: skipped N targets
   (<reason>)` into `mathspace.error` via `errorOps` (its diff against
   the kernel's text already dedups). Test: doctest on the counts, a
   runner test with a rule reading `self.nope`. Bump `MS_ABI_VERSION`.
2. Presets under `plugins/mathspace/presets/` and the roadmap examples;
   then the GUI checklist (phase 1 item, phase 2 `y.expr`, and a gravity
   rule) for a human.
3. **GUI confirmation of phases 1 and 2 (human, or a session that can
   drive Electron).** `npm install` at the root (or symlink node_modules,
   see Learned), `npm run build:native` in `app/` if
   `app/native/build/Release/tapestry_addon.node` is missing, `npm run
   engine:wasm` in `plugins/mathspace`, then `npm run dev` in `app/`.
   Create a note, set `velocity.x real 1`, run `mathspace.run`, watch it
   move, `mathspace.pause`, check the `.tree`; set `y.expr text
   "self.position.x * 2"`, Step, see `y real ...` in the inspector.

## Done

- `e0b6942` ms3 pair and global scope (`MS_STEP_VERSION` 7): ordered
  pairs with `other` bound in law and `select`, global visits the rule
  once; golden `gravity` loses its dormant pair rule, golden `pair` added.
- `919c06e` ms3 `set.<f>`: a rule's bound `set.<f>` fields assign the
  target's existing `f` after the integrator (`MS_STEP_VERSION` 6);
  golden `gravity` gains rule 8; force and set passes share
  `for_each_target` in `step.cpp`; runner test, no runner change.
- Earlier ms3, one line each: `872831b` `pinned` (`MS_STEP_VERSION` 5);
  `204ced5` plugin side (rule nodes, `mathspace.error` from compile-time
  problems, manifest node types); `f90b3c7` `select` (version 4);
  `22bc70c` engine (force pass, mass integrator, `RuleDims`, golden
  `gravity`, version 3).
- Phase 2 plugin/ABI (ms2), one line each: `d6e9c0b` `diff.hpp`
  symbolic d/d(self.field.lane) checked against finite differences;
  `c5d134e` `<f>.expr` props bound through the runner's second pass;
  `c44393d` `Engine.compile` + `encodeBindField`; `a159268` `ms_compile`
  C ABI with `ms_compile_error_name` and `MS_ERR_BAD_BYTECODE`.
- Phase 2 engine (ms2), one line each; git has the details: `1abc9d4`
  action 37 BindField + bound evaluation in `step()` + golden `plot`
  (`MS_STEP_VERSION` 2); `3b25475` vm; `30fc1a6` bytecode; `1725143`
  ast+parser; `3ca1482` fxmath (`tools/gen_fxmath/gen.py` oracle).
- Phase 1 (ms1), oldest last, one line each; git has the details:
  `836a4da` real-tree check + lane padding; `b223a54` README status;
  `a111181` run loop `runner.js`; `07f35f4` `image.js` + checkpoint
  fixture; `feab148` plugin skeleton + vitest goldens; `f7013b3` wasm
  target; `8587ec9` C ABI; `dc75224` lazy notes snapshot; `a247eab`
  bootstrap integrate rule + golden `velocity`; `0903619` kernel ids;
  `3cd79d9` build scaffolding; `1d6f2f1` driver bash 3.2 guard; note
  store/world/hash walk/actions 32..36/replay tool/goldens `empty` and
  `two-notes` up to `943b9bb`; SDL Space page `bdf03eb`..`8774401`
  reverted in the redirect; `215602c` merge of `phase-2-implementation-v1`.

## Decisions

- Pair and global scope (`e0b6942`). Pair visits ordered pairs (a,b) and
  (b,a), `self` receives: the design's gravity example is a force on
  `self` in terms of `other`, so Newton's third law is the user's
  symmetric formula, not the engine's; the cost is two evals per
  unordered pair, accepted for now. `select` is evaluated per visit with
  both bound and gates only that visit (the design's "pair of selected
  notes" would need both sides selected; a user writes
  `self.mass > 0` times `other.mass > 0` for that). A pair `set.<f>`
  visits `self` once per `other`, each visit reading what the last
  wrote, so a running min/sum over others is one expression. Global
  visits the rule note itself as `self`: a global force is collected by
  the rule (the integrator does not move a note without `velocity`), a
  global set writes the rule's own field, visible to `node(nN).f` only
  since rule fields are never committed back. `scope` bound, vector or
  outside 0..2 skips the rule whole.
- `set.<f>` (`919c06e`): runs after the integrator (so `self.pos` is this
  tick's) and before the phase 2 bound-field pass (so a body's own bound
  field still wins over a rule's set on the same field, as it evaluates
  last). Set fields on one rule run in name order, so `set.b` can read
  what `set.a` just wrote. Two rules setting one field: last in id order
  wins silently until the runtime-error channel exists. A set on `pos` or
  `velocity` is not forbidden. The program's dim must equal the target
  field's dim; `bind_field` already reshapes the rule's own `set.<f>` to
  the program's dim, which is harmless (never committed back).
- Plugin side of rules (`204ced5`): a rule node's membership is like a
  note's; its numeric props enter as fields (it is never a target); an
  unknown `scope` text keeps it out of the image; its bound fields are
  never committed back (`diff()` skips rule ids); `mathspace.error` is
  its problems as `key: reason` in key order joined by `; `, diffed
  against the kernel's text and unset when gone, riding the next commit.
- `pinned` (`872831b`) is engine-side, not a plugin-side write filter
  (a filtered diff would let the engine's copy drift from the kernel's).
  The plugin sends `pinned` 1 only when the app's bool is true.
- Rule notes in the engine (`22bc70c`, `f90b3c7`): the law is the
  rule's bound fields evaluated with `self` = each target, never the
  rule itself; `scope` is a scalar field (0/1/2, absent = unary);
  targets are the non-Rule notes of the rule's space with `pos`; force
  is a per-tick accumulator, never a field; `mass` scalar, 1 when
  absent, <= 0 drops the force; h = 1; a program at the wrong dim
  skips the rule, a per-target error skips the target silently; `select`
  is a bound scalar per target. Details in `step.cpp`'s header. Every
  change to `step()` bumps `MS_STEP_VERSION`; re-recording five goldens
  is one command line.
- `diff.hpp` (`d6e9c0b`): a derivative keeps its value's dim, so it
  reuses the compiler's shapes with a `DimResolver`; `abs min max clamp`
  differentiate as the fx64 branch goes, `curve` is `Unsupported`,
  `node(nN).f` is a constant even for self; the output is a tree (no
  shared subtrees) built with an explicit task stack.
- Expression text spelling (`c5d134e`): the `.tree` says `self.position`,
  the engine grammar `pos`; the plugin rewrites the one renamed field
  before `ms_compile` and maps error offsets back. Compiling happens in
  the runner, not `buildImage`, because refs need every note present.
- `ms_compile` errors (`a159268`): a negative return packs
  `-(stage << 8 | code)` (0 world, 1 parse with the byte offset in
  `*where`, 2 compile with the Ast index); `ms_compile_error_name` gives
  a static `"parse:InexactNumber"` string.
- Phase 2 engine decisions live in the headers they concern (`world.hpp`
  bound-field order, `vm.hpp` domain errors, `bytecode.hpp` shapes,
  `parser.hpp` grammar and bounds, `fxmath.hpp` rounding); the plan's
  `MS_RULE_INTEGRATE_VERSION` is `MS_STEP_VERSION`, same walk slot.
- Phase 1 plugin decisions (git has the details): a lane-addressed key
  (`f.x`) is a vector zero-padded to the space dim, a bare name a scalar;
  the run loop rebuilds on a foreign commit or refused submit, seed 1;
  the implicit space is id `2^63` dim 2 and never a kernel op; an inexact
  `real` drops its field into `problems` (see Blocked); the image is
  derived, real↔fx64 conversion exact and in JS; note ids are kernel ids;
  `MS_ABI_VERSION` 1 is separate from the walk's `FORMAT_VERSION`.

## Learned

- Goldens with bytecode (`plot`, `gravity`, `pair`) are generated by
  `golden_test.cpp` and rewritten under `MS_WRITE_FIXTURES=1` (a new one
  needs an empty `.actions` and `.sha256` touched first, then the
  rewrite, then the six `.sha256` via `ms_replay --write-golden`).
  macOS has no `timeout`. The grammar has no `and`: multiply predicates.
- doctest: `MESSAGE` ignores `std::hex`; wrap a `const char*` first
  token of `CHECK_MESSAGE` in `std::string`; a helper named `apply`
  collides with `std::apply` via ADL.
- `app/native/build/Release/tapestry_addon.node` is copied from the
  primary checkout (`/Users/kaelencook/Tapestry/app/native/build/Release/`,
  identical sources; `build:native` needs Electron headers), gitignored.
  The plugin's vitest imports `app/test/helpers/temp-tree.ts` and
  `app/src/main/plugin-host.ts`, which load in plain Node.
- `node_modules` is a gitignored symlink to the primary checkout's
  (vitest 2.1.9). Plugin files are CommonJS, so the vitest config is
  `.mjs` and tests reach `engine.js` via `createRequire`. Wasm:
  `source ~/emsdk/emsdk_env.sh` (6.0.10), then `npm run engine:wasm` in
  `plugins/mathspace` (~15 s, copies into `plugins/mathspace/wasm/`,
  untracked), then `npm test` there; `engine.test.js` replays every
  golden through the Wasm module, so re-recorded goldens need a rebuild.
  `_ms_create` takes a BigInt seed and `_ms_tick` returns one.
- The ESM test shims (`test/image-cjs.js`, `test/engine-cjs.js`) list
  the exports by name: a new export from `image.js` is `undefined` in
  the tests until it is added there (it cost a puzzled minute).
- `tests/golden/ms/*.actions` are globbed at configure time
  (CONFIGURE_DEPENDS), so a new fixture needs `cmake --build` before
  ctest lists its two-process test. Re-record: `build/native-debug/
  ms_replay <f>.actions --write-golden <f>.sha256` for the five files,
  then Release and UBSan must agree (each preset ~10-20 s).
- A bound `Field` compares unequal to a plain one with the same lanes
  (`bound`/`bytecode` are in `operator==`): compare lanes in tests.
  `World::notes` is a vector, so a `RuleDims`/`WorldDims` built before
  `create_note` holds a dangling note reference; build it per query.
- The app stores positions as `position.x`/`position.y` reals measured
  from the note's tree frame origin, plus `pinned bool`
  (`app/src/renderer/layout/placement.ts`). Match these keys exactly.
- The SDK (`sdk/src/index.ts`) gives plugins `kernel.getNodes/getNode/
  getEdges/status/submit`; commits are stamped `plugin <dir-name>`.
  Surfaces get no kernel access in API 1.

## Blocked

(questions a human would have been asked; answered by the session's best
judgement, recorded here so a human can revisit)

- **Phase 1 GUI confirmation.** The plan's done condition says "in the
  app". Every file-level and determinism clause is covered by tests; an
  unattended session cannot click Run in Electron. A human should do
  Next item 1 once and tick this off. (2026-09-24)

- Dragged notes may hold positions that are not `k/2^32` (a drag at a
  fractional zoom divides by the zoom). The plan says such reals are
  rejected, so `buildImage` drops that note's `pos` and it does not move.
  If the phase 1 app check shows this bites, the run loop could round
  and commit the rounded position first; that is a plan change, so it is
  left for a human. (2026-09-24)
