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
| 4 constraints | first slice done (`60c8346`): `constraint.expr` + `compliance` solved by fixed XPBD passes over lifted symbolic gradients, golden `rod`, runner test; open: the `rope-chain` comparison against ddsim, the contact preset and golden `contact` |
| 5 views | not started |
| 6 metrics | not started |
| 7 fold ddsim | not started |

## In progress

Nothing. Tree is clean. (`autonomy/watch.py` is the operator's log
viewer; it is theirs to edit.)

## Next

1. **Phase 4 second slice: the comparison test against ddsim's
   `rope-chain` golden.** Read `tests/golden/rope-chain.actions` and the
   ddsim replay path (`tools/dd_replay` or the ddsim tests; find how a
   ddsim `State` is built from that fixture and stepped) and
   `include/ddsim/rules/constraints.hpp`. Write a doctest in a new
   `tests/mathspace/rope_chain_test.cpp` that builds the same chain as
   mathspace notes (one Note per particle with `pos`, `velocity`, `mass`,
   `pinned` for a static particle) plus one pair rod rule with a `select`
   that picks chain neighbours (e.g. a per-note scalar `link` holding the
   neighbour's id and `select` = `other.id == self.link`... the grammar
   has no `id`; instead give each note `k` = its chain index and select
   `abs(other.k - self.k) == 1`, rest = the fixture's rest length; if the
   fixture has several lengths, one rule per length) and a unary gravity
   force `[0, DD_GRAVITY_Y_PER_TICK * self.mass]`, steps both engines the
   fixture's tick count, and compares each particle's position within a
   stated tolerance (not the hash: ddsim corrects both ends in one visit,
   mathspace one end per visit, so a free-free rod's residual after four
   passes is 2^-8 of the stretch, see Decisions). Record the tolerance
   and the worst deviation under Learned; that number is what justifies
   phase 7.
2. Phase 4 third slice: Point-vs-Shape contact as a preset,
   `C = max(0, shape(pos))`. Decide how a Shape note exposes `shape(pos)`
   (design: a scalar expression over `pos`; simplest is a unary rule whose
   `constraint` is `max(0, r - norm(self.pos - node(nS).pos))` for a
   circle of radius r at note S, i.e. "stay outside" or `min(0, ...)` for
   "stay inside"); note `diff.hpp`'s `max` derivative is the branch taken,
   so a zero branch gives a flat gradient and the visit is silently
   skipped, exactly "no contact". Preset `contact` in
   `plugins/mathspace/presets/` + `presets.test.js` case, golden `contact`
   via `golden_test.cpp` under `MS_WRITE_FIXTURES=1`, six `.sha256`,
   Debug/Release/UBSan. Then phase 4's done condition is met: say so in
   Phases and README.
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

- `60c8346` ms4 rod: `expr/lift.hpp` (bytecode back to an Ast, round-trip
  tested over every op shape), `constraint` + `compliance` on a Rule note
  solved after the integrator by `MS_CONSTRAINT_ITERATIONS` XPBD passes
  with the gradient from `diff.hpp`, `velocity = pos - prev` after the
  passes, `Skip::BadGradient`, `MS_STEP_VERSION` 8 (all goldens
  re-recorded), golden `rod` (pendulum, 60 ticks), doctests for the pinned
  anchor, compliance, free rod, unary manifold and whole-rule skips, one
  runner test with `constraint.expr` and `compliance` (no plugin change).
- `e1e30a5` ms3 presets: `presets/<id>.json` (rule node + bodies in
  `.tree` spelling), `presets.js` lists them in name order into
  `mathspace.preset.<id>` commands that submit one `createNode` commit;
  seven presets; `presets.test.js` runs each for 1 and 60 ticks on the
  real engine and checks the roadmap promises.
- Earlier ms3, one line each: `9b28407` RULE-07 runtime skips
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
- Phase 1 (ms1), oldest last: `836a4da` real-tree check + lane padding;
  `b223a54` README status; `a111181` run loop `runner.js`; `07f35f4`
  `image.js` + checkpoint fixture; `feab148` plugin skeleton + vitest
  goldens; `f7013b3` wasm target; `8587ec9` C ABI; `dc75224` lazy notes
  snapshot; `a247eab` bootstrap integrate rule + golden `velocity`;
  `0903619` kernel ids; `3cd79d9` build scaffolding; `1d6f2f1` driver
  bash 3.2 guard; store/world/hash walk/actions 32..36/replay
  tool/goldens `empty` and `two-notes` up to `943b9bb`; SDL Space page
  `bdf03eb`..`8774401` reverted in the redirect; `215602c` merge of
  `phase-2-implementation-v1`.

## Decisions

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
  every field its rule reads (`Sam` has `chips 0`, so the pair rule's
  `select other.chips > 0` gates cleanly), so a fresh tree shows no
  RULE-07 skip; the user's existing notes lacking those fields will show
  a skip count on the rule, by design. Positions are file-given and
  relative to the tree frame origin; `y` grows down the screen, so
  `gravity-field` pushes `+y`. Notes get `title` and empty `body` like
  the app's own. A preset needs both `velocity` lanes to move, `mass`
  for forces. The manifest lists the preset commands (the host does
  not require it; it is documentation).
- RULE-07 runtime channel (`9b28407`). Reasons are one byte: below 16
  an `expr::VmError` on a visit, 16+ a whole-rule `Skip` (`NoScope`,
  `NoSpace`, `BadSelect`, `WrongDim`, `NoTargetField`); a whole-rule
  skip counts once, the reason kept is the last in step order. A pinned
  target of a set rule is not a skip (RULE-08). Reports live on `World`
  outside `==`, the walk and the snapshot; `ms_world` re-encodes them
  after each `ms_step`, clears on `ms_restore`. The runner sums counts
  over the ticks since the last commit and rewrites the property on
  every commit while the rule keeps failing. Not detected: two rules
  writing one field, a bound field on a plain note that fails. `select`
  runs before the `NoTargetField` check, so a gated visit is silent.
- Pair and global scope (`e0b6942`). Pair visits ordered pairs, `self`
  receives, Newton's third law is the user's symmetric formula; `select`
  is evaluated per visit with both bound; a pair `set.<f>` visits `self`
  once per `other`, each reading what the last wrote. Global visits the
  rule note itself as `self`; a global set writes the rule's own field,
  visible to `node(nN).f` only. `scope` bound, vector or outside 0..2
  skips the rule whole.
- `set.<f>` (`919c06e`) runs after the integrator and before the bound-
  field pass (a body's own bound field wins); set fields on one rule run
  in name order; two rules setting one field: last in id order wins
  silently. The program's dim must equal the target field's dim.
- Plugin side of rules (`204ced5`): a rule node's numeric props enter as
  fields (never a target); unknown `scope` text keeps it out of the
  image; its bound fields are never committed back (`diff()` skips rule
  ids); `mathspace.error` is its problems as `key: reason` in key order
  joined by `; `, diffed against the kernel's text and unset when gone.
- `pinned` (`872831b`) is engine-side, not a plugin-side write filter;
  the plugin sends `pinned` 1 only when the app's bool is true.
- Rule notes in the engine (`22bc70c`, `f90b3c7`): the law is the rule's
  bound fields evaluated with `self` = each target; `scope` is a scalar
  field (0/1/2, absent = unary); targets are the non-Rule notes of the
  rule's space with `pos`; force is a per-tick accumulator; `mass`
  scalar, 1 when absent, <= 0 drops the force; h = 1. Every change to
  `step()` bumps `MS_STEP_VERSION`; re-recording goldens is one command.
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

- doctest's `CHECK(a && b)` is a compile error ("Expression Too
  Complex"): bind the conjunction to a `bool` first. A golden with a new
  name needs `touch tests/golden/ms/<f>.actions <f>.sha256` before the
  build (the glob), then `MS_WRITE_FIXTURES=1 mathspace_tests
  -tc="*golden <f>*"` fails once on the empty `.sha256` after writing the
  `.actions`; `ms_replay --write-golden` fills it. Rebuilding the Wasm
  (`source ~/emsdk/emsdk_env.sh; npm run engine:wasm`) is needed after any
  golden re-record or the plugin's `engine.test.js` fails on old hashes.
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
