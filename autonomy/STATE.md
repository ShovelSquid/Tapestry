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
| 3 force rules | done headlessly (`e1e30a5`): force and `set.<f>` rules under unary, pair and global scope with `select`, mass integrator, `pinned`, RULE-07 skips on the rule node, goldens `gravity` and `pair`, and `plugins/mathspace/presets/` with the plan's four presets plus the roadmap's `anger`, `gold`, `push`, each a `mathspace.preset.<id>` command; `presets.test.js` runs all seven on one engine build with no skip and the promised field change. The "in the app" clause joins the GUI checklist in Blocked |
| 4 constraints | done headlessly (`60c8346`, `60cd37e`, `064966d`): `constraint.expr` + `compliance` by fixed XPBD passes over lifted symbolic gradients, goldens `rod` and `contact`, the `contact` preset, the `pendulum`/`rope-chain` comparison against ddsim (numbers under Learned). The "in the app" look joins the GUI checklist in Blocked |
| 5 views | not started |
| 6 metrics | not started |
| 7 fold ddsim | not started |

## In progress

Nothing. Tree is clean. (`autonomy/watch.py` is the operator's log
viewer; it is theirs to edit.)

## Next

1. **Phase 5 first slice: `mathspace/view@1` nodes with `project.expr`,
   engine side.** Read `mathspace_design.md` lines 191-215 and the plan's
   phase 5. Smallest step: a View is a Note of kind `View` (add
   `NoteKind::View` to `note.hpp` if the enum lacks it; check the walk
   and `ms_c.cpp` for kind handling) in a space, with a bound field
   `project` whose program takes `self.pos`-shaped input and yields dim 2.
   The engine does not evaluate `project` in `step()` (rendering never
   enters the hash; a View's bound field must be skipped by the bound-
   field pass like a Rule's). Add a C ABI call `ms_project(world, view
   id, note id, out[2])` that evaluates the view's program with `self` =
   the note (so `project.expr` is written in terms of `self.pos`) and
   returns the two lanes without touching state; `MS_ABI_VERSION` 3;
   doctest + `c_abi_test` case; the plugin's `image.js` maps
   `mathspace/view@1` nodes to kind View and binds `project.expr` like a
   rule's; `Engine.project(viewId, noteId)` in `engine.js`; one runner
   test. No surface yet.
2. Phase 5 second slice: `plugins/mathspace/surface/` stage surface (copy
   `plugins/data-drawing/surface/`, placement `stage`), reading the
   engine snapshot from a module Worker and drawing notes at
   `project(pos)` with three.js; then default views as presets (identity
   2D, perspective and three orthographic 3D, axis-pair picker for N > 3).
   Done when one 4D space is viewable through two View nodes at once.
3. **GUI confirmation of phases 1 to 4 (human, or a session that can
   drive Electron).** `npm install` at the root (or symlink node_modules,
   see Learned), `npm run build:native` in `app/` if
   `app/native/build/Release/tapestry_addon.node` is missing, `npm run
   engine:wasm` in `plugins/mathspace`, then `npm run dev` in `app/`.
   Create a note, set `velocity.x real 1`, run `mathspace.run`, watch it
   move, `mathspace.pause`, check the `.tree`; set `y.expr text
   "self.position.x * 2"`, Step, see `y real ...` in the inspector; run
   `mathspace.preset.anger`, `mathspace.preset.gold`,
   `mathspace.preset.push` on a fresh tree, Run, watch Sam's `anger`
   rise, gold grow, the cart move; a rule node with `scope text pair`,
   `constraint.expr text "norm(other.position - self.position) - 100"`
   between a pinned note and a free one with `velocity.*`, Run, see it
   swing.

## Done

- `064966d` ms4 contact: `presets/contact.json` (gravity, bumper and
  floor rules plus a ball; the bumper rule sits at its shape's centre),
  golden `contact` (120 ticks, never inside either shape), the preset
  test now allows more than one rule per preset.
- `60cd37e` ms4 comparison: `tests/mathspace/rope_chain_test.cpp` replays
  ddsim's `pendulum` and `rope-chain` goldens through `ddsim::Sim`
  (hashes checked) and as mathspace notes with a pair rod rule
  (`select abs(other.k - self.k) == 1`) and a gravity rule reading its
  own `g` field; per-checkpoint position tolerances, worst deviation
  printed.
- `60c8346` ms4 rod: `expr/lift.hpp` (bytecode back to an Ast, round-trip
  tested over every op shape), `constraint` + `compliance` on a Rule note
  solved after the integrator by `MS_CONSTRAINT_ITERATIONS` XPBD passes
  with the gradient from `diff.hpp`, `velocity = pos - prev` after the
  passes, `Skip::BadGradient`, `MS_STEP_VERSION` 8 (all goldens
  re-recorded), golden `rod` (pendulum, 60 ticks), doctests for the pinned
  anchor, compliance, free rod, unary manifold and whole-rule skips, one
  runner test with `constraint.expr` and `compliance` (no plugin change).
- Phase 3 (ms3), one line each: `e1e30a5` presets (`presets/<id>.json`,
  `presets.js`, `mathspace.preset.<id>` commands, `presets.test.js`);
  `9b28407` RULE-07 runtime skips
  (`World::reports`, `ms_errors_ptr/len`, `Engine.errors()`, runner sums
  skips into `mathspace.error`; `MS_ABI_VERSION` 2); `e0b6942` pair and
  global scope, golden `pair` (`MS_STEP_VERSION` 7); `919c06e` `set.<f>`
  after the integrator (version 6); `872831b` `pinned` (version 5);
  `204ced5` plugin side (rule nodes, compile-time `mathspace.error`);
  `f90b3c7` `select` (version 4); `22bc70c` engine (force pass, mass
  integrator, `RuleDims`, golden `gravity`, version 3).
- Phase 2 (ms2), one line each: `d6e9c0b` `diff.hpp` symbolic
  d/d(self.field.lane) checked against finite differences; `c5d134e`
  `<f>.expr` props bound through the runner; `c44393d` `Engine.compile`;
  `a159268` `ms_compile` C ABI; `1abc9d4` action 37 BindField + golden
  `plot` (version 2); `3b25475` vm; `30fc1a6` bytecode; `1725143`
  ast+parser; `3ca1482` fxmath (`tools/gen_fxmath/gen.py` oracle).
- Phase 1 (ms1): `836a4da` real-tree check; `a111181` `runner.js`;
  `07f35f4` `image.js`; `feab148` plugin skeleton; `f7013b3` wasm;
  `8587ec9` C ABI; `a247eab` golden `velocity`; store/walk/actions/
  replay tool/goldens up to `943b9bb`; `215602c` merge of
  `phase-2-implementation-v1` (SDL Space page reverted).

## Decisions

- Contact (`064966d`) needs no engine change: `max(0, shape(pos))` as a
  unary `constraint` is zero with a flat gradient outside the shape,
  which the solver skips silently, and pushes out along `grad(shape)`
  inside; a `.tree` preset cannot name node ids, so the bumper's centre
  is a literal vector in the expression. Presets may hold several rule
  nodes (the phase 3 one-rule check was a convention, not a rule).
- Constraints (`60c8346`). The engine holds bytecode only, so the
  gradient comes from lifting the program back to an Ast (`lift.hpp`),
  differentiating per `pos` lane and compiling against `RuleDims`, once
  per rule per step (no cache to invalidate on a rebind; a profile can
  ask for one). Only `self.pos` moves per visit: `dpos = w_self * dl *
  g`, `dl = -C / ((w_self + w_other) |g|^2 + compliance)`, w = 1/mass, 0
  when pinned or mass <= 0, w_other 0 without `other`; that split is
  ddsim's `wa/(wa+wb)` exactly for a rod whose other end is pinned, and
  for a free-free rod the two ordered visits each halve the error, so a
  pass quarters it and four passes leave 2^-8 of the stretch (ddsim
  meets a lone rod in one pass). A denominator below 2^-16 is a silent
  visit skip (ddsim's len2 guard), a pinned self a silent skip (RULE-08),
  notes without `velocity` are moved (the projection is a position write;
  `pinned` is the one hold), the velocity derivation touches only what
  the integrator moves. `MS_CONSTRAINT_ITERATIONS` (4) and
  `MS_CONSTRAINT_EPS_RAW` live in `version.hpp` next to
  `MS_STEP_VERSION` (there is no `step.hpp`), `CONSTRAINT_FIELD` and
  `COMPLIANCE_FIELD` in `world.hpp`. `compliance` must be an unbound
  scalar; bound or vector reads as 0.
- Presets (`e1e30a5`) are self-consistent worlds: every note carries
  every field its rule reads, so a fresh tree shows no RULE-07 skip;
  positions are relative to the tree frame origin, `y` grows down the
  screen; a preset needs both `velocity` lanes and `mass`.
- RULE-07 runtime channel (`9b28407`): reasons are one byte, below 16 an
  `expr::VmError` on a visit, 16+ a whole-rule `Skip` counted once with
  the last reason; reports live on `World` outside `==`, the walk and the
  snapshot; the runner sums counts since the last commit. Not detected:
  two rules writing one field. `select` runs before `NoTargetField`.
- Scope (`e0b6942`): pair visits ordered pairs, `self` receives, Newton's
  third law is the user's symmetric formula; global visits the rule note
  itself (a global set writes the rule's own field). `set.<f>`
  (`919c06e`) runs after the integrator, before the bound-field pass;
  last rule in id order wins silently; dims must match. Plugin side
  (`204ced5`): rule numeric props are fields, never targets; rule bound
  fields are never committed back; `mathspace.error` is `key: reason`
  joined by `; `. `pinned` (`872831b`) is engine-side. Rule notes
  (`22bc70c`): `scope` scalar 0/1/2 (absent unary); targets are the
  non-Rule notes of the rule's space with `pos`; `mass` 1 when absent,
  <= 0 drops the force; h = 1; every `step()` change bumps
  `MS_STEP_VERSION`.
- Phase 2 plugin/ABI: `diff.hpp` keeps a derivative at its value's dim,
  `curve` is `Unsupported`, `node(nN).f` is a constant; the `.tree`
  spells `self.position`, the plugin rewrites it to `pos` before
  `ms_compile` and maps error offsets back, compiling in the runner not
  `buildImage`; `ms_compile` failures pack `-(stage << 8 | code)`,
  `ms_compile_error_name` gives `"parse:InexactNumber"`. Engine
  decisions live in the headers (`world.hpp`, `vm.hpp`, `bytecode.hpp`,
  `parser.hpp`, `fxmath.hpp`); the plan's `MS_RULE_INTEGRATE_VERSION` is
  `MS_STEP_VERSION`.
- Phase 1 plugin: a lane-addressed key (`f.x`) is a vector zero-padded
  to the space dim, a bare name a scalar; the run loop rebuilds on a
  foreign commit or refused submit, seed 1; the implicit space is id
  `2^63` dim 2 and never a kernel op; an inexact `real` drops its field
  into `problems` (see Blocked); real↔fx64 conversion is exact and in
  JS; note ids are kernel ids; `MS_ABI_VERSION` is separate from the
  walk's `FORMAT_VERSION`.

## Learned

- ddsim comparison numbers (ms4): the single pendulum agrees to 4 raw at
  tick 1 and at most 3152 raw (2^-20.4 units) over 600 ticks, so the
  lifted-gradient XPBD is ddsim's rod solver up to fx64 rounding. The
  double pendulum (`rope-chain`, rods of 2) deviates 6811 raw at tick 1,
  0.45 at 60, 0.97 at 300, 1.44 at 600: a chaotic system amplifying the
  free-free rod's 2^-8 residual (mathspace corrects one end per ordered
  visit, ddsim both ends per constraint). Phase 7 must either accept
  that data-drawing's ropes do not replay bit-for-bit under mathspace or
  let a pair constraint visit write `other` too (a semantic change to
  "a rule writes self"; not taken at ms4).
- doctest's `CHECK(a && b)` is a compile error ("Expression Too
  Complex"): bind the conjunction to a `bool` first. A golden with a new
  name needs `touch tests/golden/ms/<f>.actions <f>.sha256` before the
  build (the glob), then `MS_WRITE_FIXTURES=1 mathspace_tests
  -tc="*golden <f>*"` fails once on the empty `.sha256` after writing the
  `.actions`; `ms_replay --write-golden` fills it. Rebuilding the Wasm
  (`source ~/emsdk/emsdk_env.sh; npm run engine:wasm`) is needed after any
  golden re-record or the plugin's `engine.test.js` fails on old hashes.
- macOS has no `timeout`. The grammar has no `and`: multiply predicates.
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
- Re-record every golden after a `MS_STEP_VERSION` bump:
  `build/native-debug/ms_replay <f>.actions --write-golden <f>.sha256`
  for the seven files, then Release and UBSan must agree.
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
