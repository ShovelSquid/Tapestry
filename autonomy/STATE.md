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
| 5 views | engine side done (`61ef64f`); stage surface first cut done and seen in a headless browser (`24f1dbb`, `4acdaab`): one canvas 2D panel per View, refreshed on `onTreeChanged`; open: default-view presets, the 4D-through-two-views done condition, shapes and rule regions |
| 6 metrics | not started |
| 7 fold ddsim | not started |

## In progress

Nothing. Tree is clean. (`autonomy/watch.py` is the operator's log
viewer; it is theirs to edit.)

## Next

1. **Phase 5 third slice: default views as presets and the done
   condition.** Add `presets/view-2d.json` (identity `[self.position.x,
   self.position.y]`), `view-3d-perspective.json` and three orthographic
   `view-3d-{xy,xz,yz}.json`, and a 4D axis-pair example
   `view-4d-xy.json` / `view-4d-zw.json` (the "axis-pair picker" for
   N > 3 is two such presets until there is UI). Each is a `.tree`-shaped
   preset like the others (see `presets.js` for the node list format;
   note a preset cannot name node ids, so a View preset must create its
   own `mathspace/space@1` and a couple of notes, or the test must place
   the view in an existing space by hand). Done condition to meet and
   test: one 4D space viewable through two View nodes at once. Write it
   as `test/projection.test.js` case (buildWorld + projectAll over a
   dim-4 space with `[x, y]` and `[z, w]` views, both placing every note)
   and as a preset run in `presets.test.js` (the preset test currently
   expects a field change after stepping; a view preset may need that
   check relaxed or a moving note included). Then mark phase 5's done
   condition met in Phases and update README.md's status paragraph.
2. Phase 5 fourth slice (optional polish, only if cheap): shapes by
   sampled level sets and rule regions faintly in the surface; three.js
   only if a 3D panel needs it. The surface refreshes only on
   `onTreeChanged`, which the app fires for commits from outside the
   renderer (the runner's, an agent's), not for the human's own drags; a
   `getNodes` poll while open, or a host change, would close that gap.
3. **GUI confirmation of phases 1 to 5 (human, or a session that can
   drive Electron).** `npm install` at the root (or symlink node_modules,
   see Learned), `npm run build:native` in `app/` if
   `app/native/build/Release/tapestry_addon.node` is missing, `npm run
   engine:wasm` and `npm run build` in `plugins/mathspace`, then `npm run
   dev` in `app/`. Create a note, set `velocity.x real 1`, run
   `mathspace.run`, watch it move, `mathspace.pause`, check the `.tree`;
   set `y.expr text "self.position.x * 2"`, Step, see `y real ...` in the
   inspector; run `mathspace.preset.anger`, `mathspace.preset.gold`,
   `mathspace.preset.push` on a fresh tree, Run, watch Sam's `anger`
   rise, gold grow, the cart move; a rule node with `scope text pair`,
   `constraint.expr text "norm(other.position - self.position) - 100"`
   between a pinned note and a free one with `velocity.*`, Run, see it
   swing; click "Open Mathspace" with a View node present and see the
   panel. Without the app: `npm run dev` in `plugins/mathspace` serves
   the surface over a stub `window.tapestry` at localhost:5174.

## Done

- `4acdaab` ms5 surface in a browser: `image.js` uses `TextEncoder`/
  `TextDecoder` instead of Node's `Buffer` (it is bundled into the
  renderer now); the dev page mounts the built `dist/surface.js`; the dev
  server watches `dist/`. Verified with the browser-automation skill
  against the fixture world: two panels with both notes, `world:BadDim`
  on the dim-1 view, no console errors.
- `24f1dbb` ms5 stage surface first cut: `plugins/mathspace/surface/`
  (Vite library build to `surface/dist/surface.js`, gitignored; `npm run
  build`), registered as `mathspace.stage` in `index.js` and the
  manifest; `main.ts` reads `window.tapestry.kernel.getNodes(treeId)`,
  builds the world with the bundled `world.js` + `engine-core.js` + the
  plugin's own wasm glue, `projectAll`s and draws with `panels.ts`
  (grid of panels, uniform fit per view, error text for a failed view);
  refresh on `onTreeChanged`; `test/panels.test.js`.
- `fd781d9` ms5 plumbing: `engine-core.js` (the `Engine` class, no
  `node:` imports; `engine.js` keeps `loadModule` and re-exports),
  `world.js` `buildWorld(nodes, mod)` extracted from `Runner.rebuild`,
  `buildImage` returns `notes` and `views` id lists, `projection.js`
  `projectAll(engine, image)` (a view's own failures found by probing it
  with itself; per-note failures are `null`), `test/projection.test.js`.
- `61ef64f` ms5 views, engine side: View notes skipped by step(), `RuleDims`
  over Note-kind notes, `ms_project` (`MS_ABI_VERSION` 3), `Engine.project`,
  `image.js` maps `mathspace/view@1` into `rules`; `MS_STEP_VERSION` 9.
- Phase 4 (ms4), one line each: `064966d` contact preset + golden
  `contact`; `60cd37e` `rope_chain_test.cpp` against ddsim; `60c8346`
  `lift.hpp`, `constraint`/`compliance` XPBD passes, golden `rod`,
  `MS_STEP_VERSION` 8.
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

- Surface data path (`24f1dbb`): API 1 gives a surface no kernel and the
  host has no plugin-to-surface channel (`executeCommand` drops the
  handler's return value; data-drawing's surface reads no kernel data at
  all), so the STATE plan of "index.js posts a message" was not possible
  without a host change. The plan's own text has the surface run the
  engine itself, so the surface reads through `window.tapestry` (the
  renderer-realm route the SDK's `SurfaceHost` comment sanctions for
  reading) and builds the runner's engine from the same `buildWorld` and
  seed; it never calls `submit`. Canvas 2D for now; three.js and a Worker
  wait for shapes or a 3D panel. Views' `error` in `projectAll` covers
  `project.expr` compile problems, `world:NoSuchField` and `world:BadDim`;
  everything else is per note.
- Views (`61ef64f`): a View is compiled and evaluated like a rule (self
  is a note of its space) but never in step(); it is not a rule target
  even with `pos` (a camera under gravity would be a surprise), though
  the integrator still moves it if it carries `velocity` (a moving
  camera is the user's choice, not the rules'). `project` must be dim 2;
  a note outside the view's space is `world:NoSuchSpace`. `ms_project`
  packs failures like `ms_compile` so one name table serves both.
  Plugin side, views share the rule map (`image.rules`) rather than a
  new set: same skip in diff(), same error channel.
- Contact (`064966d`): `max(0, shape(pos))` as a unary constraint, no
  engine change; presets may hold several rule nodes. Constraints
  (`60c8346`): gradient by `lift.hpp` + `diff.hpp` per rule per step;
  only `self.pos` moves per visit with ddsim's `wa/(wa+wb)` split;
  `compliance` an unbound scalar. Details in `step.cpp`, `world.hpp`.
- Presets (`e1e30a5`) are self-consistent worlds. RULE-07 channel
  (`9b28407`): one-byte reasons, reports outside `==` and the hash. Scope
  (`e0b6942`): pair visits ordered pairs, `self` receives; `set.<f>` runs
  after the integrator, last rule in id order wins; rule bound fields are
  never committed back; every `step()` change bumps `MS_STEP_VERSION`.
- Phase 2 plugin/ABI: the `.tree` spells `self.position`, the plugin
  rewrites it to `pos` before `ms_compile` (in the runner, not
  `buildImage`) and maps error offsets back; `ms_compile` failures pack
  `-(stage << 8 | code)`. Engine decisions live in the headers; the
  plan's `MS_RULE_INTEGRATE_VERSION` is `MS_STEP_VERSION`.
- Phase 1 plugin: lane-addressed key = vector zero-padded to the space
  dim, bare name = scalar; rebuild on a foreign commit or refused submit,
  seed 1; implicit space id `2^63` dim 2, never a kernel op; inexact
  `real` drops its field into `problems`; `MS_ABI_VERSION` is separate
  from the walk's `FORMAT_VERSION`.

## Learned

- Vite dev serves a CommonJS file under its root untransformed (`require`
  is not defined in the page), and its watcher ignores `build.outDir`, so
  a rebuilt `dist/` is served from the old transform cache until restart
  (`server.watch.ignored: ['!**/dist/**']` fixes it). Anything bundled
  into the renderer must not touch `Buffer` or `node:`. The
  browser-automation skill (`~/.claude/skills/browser-automation/
  browser.mjs <url> --script f.mjs --screenshot p.png`) loads the dev
  page headlessly and can read the canvas and the status line; a page
  load there takes 15 to 45 s.
- ddsim comparison (ms4): single pendulum agrees to 3152 raw over 600
  ticks; the double pendulum (`rope-chain`) deviates 1.44 units by tick
  600 because a free-free rod keeps 2^-8 of its stretch (mathspace
  corrects one end per visit, ddsim both). Phase 7 must accept that or
  let a pair constraint write `other` too.
- New golden: `touch tests/golden/ms/<f>.actions <f>.sha256`, build (the
  glob), `MS_WRITE_FIXTURES=1 mathspace_tests -tc="*golden <f>*"` (fails
  once on the empty `.sha256`), `ms_replay --write-golden` fills it. Then
  `source ~/emsdk/emsdk_env.sh; npm run engine:wasm` in `plugins/mathspace`
  (~15 s, untracked output) or `engine.test.js` fails on old hashes.
- macOS has no `timeout`. The grammar has no `and`: multiply predicates.
  doctest: wrap a `const char*` first token of `CHECK_MESSAGE` in
  `std::string`; bind `a && b` to a `bool` before `CHECK`.
- Toolchain: `app/native/build/Release/tapestry_addon.node` and
  `node_modules` (vitest 2.1.9) are gitignored copies/symlinks from the
  primary checkout `/Users/kaelencook/Tapestry`. Plugin files are
  CommonJS; the ESM test shims (`test/image-cjs.js`, `test/engine-cjs.js`)
  list exports by name, so a new export is `undefined` until added there.
  `_ms_create` takes a BigInt seed and `_ms_tick` returns one.
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
