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
| 5 views | **done condition met headlessly** (`b27808a`): engine side (`61ef64f`), stage surface (`24f1dbb`, `4acdaab`), default views as presets `view-2d`/`view-3d`/`view-4d`, and one 4-space projected through `[x, y]` and `[z, w]` at once in `projection.test.js` and `presets.test.js`. Shapes and rule regions in the surface are optional polish (Next 2); the in-app look joins the GUI checklist in Blocked |
| 6 metrics | engine side (`02481a2`): diagonal `metric` on the Space note, geodesic integrator, golden `poincare`; plugin side (`566ff24`): `metric.expr` on a space node binds through `buildImage`, errors land on the space, preset `poincare`; open: preset `sphere`, `embed`, `identify` |
| 7 fold ddsim | not started |

## In progress

Nothing. Tree is clean. (`autonomy/watch.py` is the operator's log
viewer; it is theirs to edit.)

## Next

1. **Phase 6 third slice: `sphere` preset.** `presets/sphere.json`: a
   2-space with chart (theta, phi) and `metric.expr "[1, pow(sin(
   self.position.x), 2)]"` (diff.hpp handles sin/cos/pow), one note near
   the equator (theta 1.5, phi 0, velocity (0, 1/64)) and one near the
   pole (theta 0.25, same velocity), plus a View that draws the sphere
   from the side, `[100 * sin(self.position.x) * cos(self.position.y),
   100 * cos(self.position.x)]`. All reals must be `k/2^32` (1.5, 0.25,
   0.015625 are; pi/2 is not). `presets.test.js`: the id list gains
   `sphere` (name order: ..., `push`, `sphere`, `spring-to-anchor`, ...),
   the manifest gains `mathspace.preset.sphere`, and over 240 ticks the
   equator note's phi grows while its theta stays in [1.5, pi - 1.5] and
   the pole note's theta grows (a great circle tangent to a small circle
   leaves it toward the equator). Then copy the poincare test's shape.
2. Phase 6 fourth slice: `embed` (a bound dim-3 map on the Space note,
   evaluated like `project` by the surface, never by step) and a View
   over it; `identify` (wrap lanes at ±L: the smallest form is a bound
   `identify` dim-N field of half-widths, 0 meaning no wrap, applied to
   `pos` after the constraint passes; an `MS_STEP_VERSION` bump and every
   golden re-recorded). Then phase 6's done condition per the plan
   (re-read it: "Unchanged: metric.expr on the Space node, Christoffel
   symbols by symbolic differentiation, geodesic step, identify, embed,
   and the Poincaré and sphere presets"), and README's status paragraph.
3. Phase 5 optional polish, only if cheap: shapes by sampled level sets
   and rule regions faintly in the surface; three.js only if a 3D panel
   needs it. The surface refreshes only on `onTreeChanged` (fired for
   commits from outside the renderer, not the human's own drags); a
   `getNodes` poll while open, or a host change, would close that gap.
4. **GUI confirmation of phases 1 to 5 (human, or a session that can
   drive Electron).** `npm install` at the root (or symlink node_modules,
   see Learned), `npm run build:native` in `app/` if the addon is
   missing, `npm run engine:wasm` and `npm run build` in
   `plugins/mathspace`, then `npm run dev` in `app/`. Checklist: a note
   with `velocity.x real 1` moves under `mathspace.run` and the `.tree`
   records it; `y.expr text "self.position.x * 2"` shows `y real` after
   Step; `mathspace.preset.anger`/`gold`/`push` run as described; a pair
   `constraint.expr` rod swings; `mathspace.preset.view-4d` then "Open
   Mathspace" shows two panels and only `zw` moves under Run. Without
   the app: `npm run dev` in `plugins/mathspace` serves the surface over
   a stub `window.tapestry` at localhost:5174.

## Done

- `566ff24` ms6 plugin side: `buildImage` collects a space node's
  `metric.expr` as a binding (any other `.expr` on a space is a problem
  on the space) and puts every space id in `image.rules`, so compile
  problems and the engine's BadMetric/VmError reports on the space are
  written to it as `mathspace.error`; spaces still have no before-image,
  so `diff()` never commits their lanes. Runner tests: Euclidean metric
  steps as before and clears a stale error, a dim-1 metric on a 2-space
  gives `step: skipped 1 visit (BadMetric)`, a parse error maps its
  offset back to the user's text; the Poincaré disk keeps a note inside
  radius 100 over 240 ticks. `presets/poincare.json` (space then members
  over two commits, an identity `Disk` view) with a presets test.
- `02481a2` ms6 engine side: `METRIC_FIELD` on a Space note (bound, dim N,
  the diagonal g_kk in `self.pos`), `prepare_metric` (lift, diff per pos
  lane, compile under `WorldDims` on the space note) and
  `geodesic_correction` in `step.cpp`, `Skip::BadMetric`,
  `MS_METRIC_EPS_RAW`, `MS_STEP_VERSION` 10, all goldens re-recorded,
  golden `poincare` (radius-100 disk, 240 ticks), four step tests
  (Euclidean metric bit-identical to none; polar geodesics straight to
  2 percent; bad metric reported on the space; degenerate point silent).
  Debug, Release, UBSan and the plugin (wasm rebuilt) all green.
- `b27808a` ms5 default views as presets and the done condition:
  `presets/view-2d.json` (identity over the implicit space),
  `view-3d.json` (one 3-space, perspective `[x, y] * 400 / (z + 400)` and
  xy/xz/yz views), `view-4d.json` (one 4-space, `[x, y]` and `[z, w]`);
  `presets.js` resolves `$<index>` refs over two commits (`applyPreset`);
  `presets.test.js` projects every view preset after 60 ticks and checks
  the two-commit shape; `projection.test.js` dim-4 case; manifest lists
  the three commands.
- Phase 5 (ms5) earlier, one line each: `4acdaab` surface runs in a
  browser (`image.js` without `Buffer`, dev page mounts `dist/surface.js`,
  verified headlessly); `24f1dbb` stage surface first cut
  (`plugins/mathspace/surface/`, `mathspace.stage`, `panels.ts`,
  refresh on `onTreeChanged`); `fd781d9` `engine-core.js`, `buildWorld`,
  `projectAll`; `61ef64f` engine side (`ms_project`, `MS_ABI_VERSION` 3,
  `MS_STEP_VERSION` 9).
- Phase 4 (ms4), one line each: `064966d` contact preset + golden
  `contact`; `60cd37e` `rope_chain_test.cpp` against ddsim; `60c8346`
  `lift.hpp`, `constraint`/`compliance` XPBD passes, golden `rod`,
  `MS_STEP_VERSION` 8.
- Phase 3 (ms3): `e1e30a5` presets; `9b28407` RULE-07 runtime skips
  (`MS_ABI_VERSION` 2); `e0b6942` pair/global scope, golden `pair`;
  `919c06e` `set.<f>`; `872831b` `pinned`; `204ced5` plugin rule nodes;
  `f90b3c7` `select`; `22bc70c` force pass, integrator, golden `gravity`.
- Phase 2 (ms2): `d6e9c0b` `diff.hpp`; `c5d134e` `<f>.expr` bound through
  the runner; `c44393d` `Engine.compile`; `a159268` `ms_compile`;
  `1abc9d4` action 37 BindField, golden `plot`; `3b25475` vm; `30fc1a6`
  bytecode; `1725143` ast+parser; `3ca1482` fxmath (`tools/gen_fxmath`).
- Phase 1 (ms1): `836a4da` real-tree check; `a111181` `runner.js`;
  `07f35f4` `image.js`; `feab148` plugin skeleton; `f7013b3` wasm;
  `8587ec9` C ABI; `a247eab` golden `velocity`; `215602c` merge of
  `phase-2-implementation-v1`.

## Decisions

- Metric (`02481a2`): diagonal only, as one dim-N bound field `metric`
  on the Space note, because a `Field` holds at most `MAX_DIM` (8) lanes
  so an N×N tensor cannot be one field, and the plan's two charts
  (Poincaré, sphere) are diagonal; a full tensor would be `metric.<row>`
  fields later. Forces are taken as chart vectors as written (no index
  raised through g); the correction is semi-implicit (uses the velocity
  after the force, before `pos += velocity`), h = 1. A g_kk below 2^-16
  skips the correction for that note silently (like the constraint
  pass's flat-gradient guard); a metric of the wrong dim or without a
  symbolic gradient is `BadMetric` on the space; per-note evaluation
  errors are VmError reports on the space id (RuleReport's `rule` may
  now be a Space). The space's own `metric` lanes are never written by
  the bound-field pass.
- View presets (`b27808a`): a `ref` must name a live node at commit time
  and the kernel assigns ids, so a preset cannot point at a node of its
  own commit. `presets.js` accepts `{ type: 'ref', value: '$k' }` (k a
  node index in the file, one level only: the target may not have local
  refs itself; `loadPresets` rejects anything else by file and node) and
  submits the space in one commit and its members in a second
  (`preset <id> members`). One `view-3d` preset holds all four 3D views
  over one space rather than four presets each making a space (the STATE
  plan said separate files; a preset cannot add a view to an existing
  space anyway). The "axis-pair picker" for N > 3 is the `view-4d`
  preset plus editing a View's `project.expr` until there is UI. The
  presets test now accepts a rule or a view as the preset's active node.
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

- Vite dev ignores `build.outDir` in its watcher (`server.watch.ignored:
  ['!**/dist/**']` fixes it) and serves CommonJS untransformed; nothing
  bundled into the renderer may touch `Buffer` or `node:`. The
  browser-automation skill (`~/.claude/skills/browser-automation/
  browser.mjs <url> --script f.mjs --screenshot p.png`) loads the dev
  page headlessly (15 to 45 s per load) and can read the canvas.
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
  fractional zoom); the plan rejects such reals, so `buildImage` drops
  that note's `pos`. If the app check shows this bites, rounding and
  committing first is a plan change for a human. (2026-09-24)
