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
| 6 metrics | **done condition met headlessly** (`9d47eaf`): engine side (`02481a2`, diagonal `metric`, geodesic integrator, golden `poincare`), plugin side (`566ff24`, `metric.expr` bound through `buildImage`), presets `poincare` and `sphere` (`c49dd84`), `identify` (`5b5b55e`) and `embed` (`9d47eaf`). The in-app look joins the GUI checklist in Blocked |
| 7 fold ddsim | in progress: sliced (below), 7a headers moved (`4a99d1c`) |

## In progress

Nothing. Tree is clean. (`autonomy/watch.py` is the operator's log
viewer; it is theirs to edit.)

## Next

Phase 7 slices, one commit with tests each, in this order (ddsim is
deleted last so every earlier slice can be tested against it). The
rope-chain deviation is accepted (Decisions), so `MS_STEP_VERSION` and
the goldens do not change in 7b to 7e unless a slice says so.

1. **7b brush body as a preset rule.** Add
   `plugins/mathspace/presets/brush.json` (copy `spring-to-anchor.json`
   for the format): one Rule note, unary scope, `force.expr` =
   `self.k * (self.target - self.pos) - sqrt(self.k) * self.velocity`
   (the `.tree` spells `self.position`; `world.js` rewrites), `select`
   on notes that carry `target`. A body note carries `mass 1`, `k` =
   1 / brush mass (ddsim's k_t with K = 1; c_t = sqrt(k_t) since
   2 * zeta = 1), `target`, `pos`, `velocity`. Mathspace's integrator
   (`velocity += force / mass; pos += velocity`, h = 1) is ddsim's
   `body_substep` at h = 1 exactly, so the C++ test is
   `tests/mathspace/brush_body_test.cpp`: 60 ticks of a moving target
   through `World::step` versus `ddsim::body_substep` (root
   `include/ddsim/rules/brush_body.hpp`, still present) with one sample
   per tick, raw-equal every tick for mass 1 and mass 64; plus golden
   `brush` in `tests/golden/ms/`. Check how `select` treats a note
   without `target` (skip, not error) before writing the preset.
2. **7c the bridge, kinds 1..4 to mathspace actions.** New
   `plugins/data-drawing/surface/src/ms-bridge.ts`: DefineBrush (1) is
   kept in JS as a table (id, mass, radius, spacing, curve; validated
   like `validate_brush`, reject not clamp); StrokeBegin (2) emits
   CreateNote for the body (id derived from the stroke id, see
   `ids.hpp`) and SetField `mass`, `k`, `spacing`, and stores the
   plane; StrokeSamples (3) emits SetField `target` from the tick's
   LAST sample (Decisions: no sub-steps), and on the first sample ever
   also SetField `pos` = target and `velocity` = 0 (ddsim places the
   body on it); StrokeEnd (4) emits DeleteNote for the body. Test with
   both Wasm modules in vitest: `one-stroke.actions` replayed through
   the bridge into the mathspace Wasm gives the same body position per
   tick as `_dd_body_ptr` from ddsim, for the ticks with one sample.
3. **7d emission at spacing in the bridge.** Exact JS port of
   `emit_segment`/`emit_node`/`curve_weight` over BigInt Q32.32 (fx64
   mul/div/sqrt semantics; look for existing Q32 helpers in
   `plugins/mathspace/image.js` first) run per tick after the step from
   the body snapshot; each emitted node is CreateNote (id
   `make_node_id(branch, ordinal, index)`) plus SetField `pos` (3D,
   plane transform), `weight`, `dir`, `velocity`, `tick`, `brush`. Test:
   node positions and count equal ddsim's node table for the one-sample
   fixtures (`one-stroke`, `two-strokes`, `gap`; `four-per-tick` will
   differ and is re-recorded in 7e).
4. **7e Worker switch.** `sim-driver.ts`/`sim.worker.ts` load the
   mathspace Wasm (build script copies `build/wasm-release/mathspace.*`
   into `surface/wasm/`), `decodeNodes` reads the mathspace notes
   snapshot (format in `plugins/mathspace/image.js`; data-drawing may
   not import from plugins/mathspace, so port the reader or move it to
   the SDK, record which). Move the nine `data-drawing/sim/tests/golden/
   *.actions` to `plugins/data-drawing/surface/test/golden/` and
   re-record their `.sha256` as mathspace hashes; `wasm-golden.test.ts`
   replays them through the bridge. Keep the pause/hash-ring/replay
   contract of `SimDriver`. `npm test` and `npm run typecheck` green.
5. **7f delete ddsim.** `data-drawing/sim/`, `include/ddsim/` (move
   `ByteReader` + `decode_header` into `mathspace/wire.hpp`,
   `sha256_bytes` + picosha2 into `src/mathspace/hash.cpp`,
   `DD_FX_FORMAT_ID` and the DD_OK/DD_ERR codes the ABI re-exports into
   `mathspace_c.h`), `src/sim.cpp`, `src/ddsim_c.cpp`, `src/hash.cpp`,
   `wasm/ddsim_wasm.cpp`, `tests/*.cpp` (ddsim's), `tests/golden/*.actions`
   (ddsim's, not `ms/`), `tools/ddsim_replay`, `tools/gen_fixtures`, their
   CMake targets; `rope_chain_test.cpp` keeps its mathspace numbers as
   a plain regression. All three presets and the Wasm green, README
   status paragraph, phase 7 done in this table, then `autonomy/DONE`.
6. GUI confirmation of phases 1 to 6 (human, or a session that can
   drive Electron): `npm install` at the root (or symlink node_modules,
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
7. Optional polish, only if cheap: a `torus` preset (flat metric,
   `identify.x`/`identify.y` 200); shapes by sampled level sets and rule
   regions in the surface; a `getNodes` poll while the surface is open.

## Done

- `4a99d1c` ms7a: `fx64.hpp`, `rng.hpp`, `fxmath.hpp` moved to
  `include/mathspace/`; `include/ddsim/` holds one-line forwarding stubs
  until 7f; the two header-scan tests follow; Debug, Release, Wasm and
  the plugin tests green, no hash change. Phase 7 sliced (Next).
- `9d47eaf` ms6 `embed`; `5b5b55e` ms6 `identify` (`MS_STEP_VERSION` 11,
  goldens re-recorded); details in git and Decisions.
- Phase 6 (ms6) earlier, one line each: `c49dd84` `sphere` preset
  (chart (theta, phi), equator and pole notes, numbers under Learned);
  `566ff24` plugin side (`metric.expr` bound through `buildImage`,
  errors on the space, `poincare` preset); `02481a2` engine side
  (diagonal `metric`, `prepare_metric`, `geodesic_correction`,
  `Skip::BadMetric`, `MS_STEP_VERSION` 10, golden `poincare`).
- `b27808a` ms5 default views as presets and the done condition.
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

- Phase 7 (`4a99d1c`): the rope-chain deviation is ACCEPTED, not fixed.
  Mathspace visits ordered pairs and moves only `self`, so letting a
  pair constraint write `other` too would correct every rod twice per
  pass unless constraints got their own unordered-pair scope; the ddsim
  particle solver it was measured against is deleted by this phase and
  the design's "self receives" rule stands. `MS_STEP_VERSION` stays 11.
  Sub-steps: ddsim integrated n samples per tick at h = 1/n; the engine
  has one step per tick, so the bridge sets `target` from the LAST
  sample of a tick and the body integrates once (a 60 Hz mouse is one
  sample per tick anyway; a fast pen loses within-tick path, and the
  `four-per-tick` hash is re-recorded). Kinds 5 and 6 (particles,
  constraints) exist only in the diverged root copy, the plugin never
  sends them, and their goldens (`pendulum`, `rope-chain`) go with the
  root copy: the "1..6 adapters" are 1..4. The `ddsim` namespace is
  kept for `fx64`; renaming it is churn with no test.
- Embed (`9d47eaf`): bound dim-3 `embed` on the Space note, evaluated only
  by `ms_project` and seen by a view as `self.embed`; no ABI change.
- Identify (`5b5b55e`): half-widths not periods, 0 is open; pinned notes
  wrap too; wrap sits after `velocity = pos - prev`, before set rules.
- Metric (`02481a2`): diagonal only (a `Field` holds MAX_DIM lanes); forces
  are chart vectors; semi-implicit correction, h = 1; g_kk < 2^-16 skips.
- View presets (`b27808a`): `$k` refs over two commits, space first.
  Surface (`24f1dbb`): no kernel channel in API 1, runs its own engine
  from `buildWorld`, Canvas 2D. Views (`61ef64f`): compiled like a rule,
  never stepped; `project` dim 2. Contact (`064966d`): `max(0, shape)`.
  Constraints (`60c8346`): gradient by lift+diff; only `self.pos` moves
  per visit with ddsim's `wa/(wa+wb)` split; `compliance` unbound.
- Presets (`e1e30a5`) are self-consistent worlds. RULE-07 (`9b28407`):
  one-byte reasons outside `==` and the hash. Scope (`e0b6942`): pair
  visits ordered pairs, `self` receives; `set.<f>` after the integrator,
  last in id order wins; rule bound fields never committed back; every
  `step()` change bumps `MS_STEP_VERSION`.
- Phase 2: the `.tree` spells `self.position`, rewritten to `pos` in
  `world.js` before `ms_compile` with offsets mapped back; `ms_compile`
  failures pack `-(stage << 8 | code)`; `MS_RULE_INTEGRATE_VERSION` is
  `MS_STEP_VERSION`. Phase 1: lane key = vector zero-padded to the
  space dim, bare name = scalar; rebuild on a foreign commit or refused
  submit, seed 1; implicit space `2^63` dim 2, never a kernel op;
  inexact `real` drops its field into `problems`; `MS_ABI_VERSION` is
  separate from the walk's `FORMAT_VERSION`.

## Learned

- Plugin tests run against `plugins/mathspace/wasm/` as it is on disk:
  an engine change without `npm run engine:wasm` shows up as baffling
  compile errors (an `UnknownRef` for a reference the C++ resolves).
- Sphere geodesics numbers are in the `c49dd84` message. A quick probe is
  a throwaway vitest file in `test/` calling `buildWorld` on a preset's
  nodes with `$0` replaced and printing `parseSnapshot(engine.notes())`.
- Vite dev ignores `build.outDir` in its watcher (`server.watch.ignored:
  ['!**/dist/**']` fixes it) and serves CommonJS untransformed; nothing
  bundled into the renderer may touch `Buffer` or `node:`. The
  browser-automation skill (`~/.claude/skills/browser-automation/
  browser.mjs <url> --script f.mjs --screenshot p.png`) loads the dev
  page headlessly (15 to 45 s per load) and can read the canvas.
- ddsim comparison (ms4): single pendulum agrees to 3152 raw over 600
  ticks; `rope-chain` deviates 1.44 units by tick 600 (accepted, see
  Decisions).
- New golden: `touch tests/golden/ms/<f>.actions <f>.sha256`, build (the
  glob), `MS_WRITE_FIXTURES=1 mathspace_tests -tc="*golden <f>*"` (fails
  once on the empty `.sha256`), `ms_replay --write-golden` fills it. Then
  `source ~/emsdk/emsdk_env.sh; npm run engine:wasm` in `plugins/mathspace`
  (~15 s, untracked output) or `engine.test.js` fails on old hashes.
- doctest's CTest discovery breaks on a `TEST_CASE` name holding `;`
  or `[`: the generated `mathspace_tests_tests-*.cmake` then fails to
  parse and every ctest run errors before running anything.
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

- **Phase 7 sub-steps.** ddsim integrated every pen sample within a
  tick at h = 1/n; the mathspace bridge keeps the last sample per tick
  and integrates once. If drawing with a fast pen feels different in
  the app, the alternatives are stepping the engine n times per tick
  (breaks tick = kernel advance) or averaging samples; a human should
  choose. Recorded 2026-09-24 at `4a99d1c`.
