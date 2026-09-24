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
| 7 fold ddsim | **done condition met headlessly** (`a7ee49c`): 7a headers moved (`4a99d1c`), 7b brush body rule (`ff7c851`), 7c bridge (`3b6909a`), 7d emission (`4d1e6dc`), 7e Worker switch (`f74d0db`), 7f ddsim deleted (`a7ee49c`). The in-app look (drawing a stroke in the data-drawing surface) joins the GUI checklist in Blocked |

## In progress

Nothing. Tree is clean. Every plan phase is done headlessly and
`autonomy/DONE` exists; the driver stops on it. (`autonomy/watch.py` is
the operator's log viewer; it is theirs to edit.)

## Next

Nothing for an unattended session: the seven phases of `mathspace_plan.md`
are done (Phases) and `autonomy/DONE` is committed. What remains needs a
human:

1. GUI confirmation of phases 1 to 7 (human, or a session that can drive
   Electron): `npm install` at the root (or symlink node_modules, see
   Learned), `npm run build:native` in `app/` if the addon is missing,
   `npm run engine:wasm` and `npm run build` in `plugins/mathspace`,
   `npm run sim:wasm` and `npm run build` in `plugins/data-drawing`, then
   `npm run dev` in `app/`. Checklist: a note with `velocity.x real 1`
   moves under `mathspace.run` and the `.tree` records it; `y.expr text
   "self.position.x * 2"` shows `y real` after Step; `mathspace.preset.
   anger`/`gold`/`push` run as described; a pair `constraint.expr` rod
   swings; `mathspace.preset.view-4d` then "Open Mathspace" shows two
   panels and only `zw` moves under Run; a stroke in the data-drawing
   surface lays nodes with the brush body's overshoot (mass 64). Without
   the app: `npm run dev` in `plugins/mathspace` serves the surface over a
   stub `window.tapestry` at localhost:5174.
2. Optional polish, only if a human asks: a `torus` preset (flat metric,
   `identify.x`/`identify.y` 200); shapes by sampled level sets and rule
   regions in the surface; a `getNodes` poll while the surface is open;
   `CLAUDE.md`'s repository map (it still describes `include/ddsim`,
   `src/*.cpp` and `data-drawing/sim/`, all deleted in 7f).

## Done

- `a7ee49c` ms7f delete ddsim: `include/ddsim`, ddsim's sources, tests,
  goldens, `ddsim_replay`, `gen_fixtures`, `ddsim_wasm` and
  `data-drawing/sim/` gone; `ByteReader` + `read_header` in
  `src/mathspace/wire.hpp`, picosha2 in `src/mathspace/hash.cpp`,
  `MS_FX_FORMAT_ID` in `version.hpp` (same bytes, hashes unchanged);
  `brush_reference.hpp` transcribes `body_substep` for the parity tests;
  `rope_chain_test` is a plain regression; `ms-bridge.test.ts` replays
  through the bridge alone and checks recorded codes; `DdsimModule` and
  `ddsim-glue.d.ts` gone; `sim:wasm` builds only mathspace. Debug,
  Release, UBSan 156/156; data-drawing 113, mathspace 98, typecheck,
  build green. README status rewritten; phase 7 done.
- `f74d0db` ms7e Worker switch: `ms-sim.ts` (engine + bridge behind
  ddsim's instance shape, node table kept as NODE_STRIDE records, body
  table from a filtered `decodeSnapshot`), `SimDriver` over `MsSim`,
  worker and main-thread transport load `mathspace.mjs`, Vite plugin
  generalised, the ten fixtures copied to `surface/test/golden/` with
  mathspace `.sha256` (`MS_WRITE_FIXTURES=1 npm test` re-records). 113
  plugin tests, typecheck and `npm run build` green.
- `4d1e6dc` ms7d emission: `emit_segment`/`emit_node`/`curve_weight`
  ported into `MsBridge.afterStep(notes, tick)` (run after each
  `engine.step()`), `fxSqrt`/`isqrt128` in `ms-abi.ts`, `fxDiv` fixed to
  floor, node space id 4 dim 3, deferred end-tick delete, emitted stroke
  ids refused by StrokeBegin. `ms-bridge.test.ts`: the five one-sample
  fixtures give ddsim's node table bit for bit (ids every tick, fields
  once per node) as well as the body. No engine change; Debug and both
  plugin suites green.
- `3b6909a` ms7c the bridge: `surface/src/ms-bridge.ts` (kinds 1..4 to
  mathspace actions, every DD_ERR code reproduced before any state change,
  `MsBridge.bootstrap` for the body space and rule), `ms-abi.ts` (the
  mathspace_c.h mirror: encoders, snapshot decoder, `MsEngine`, fx64
  div/mul over BigInt), `build-wasm.sh` copies `mathspace.*` too.
  `ms-bridge.test.ts`: five one-sample fixtures bit-equal to ddsim's body
  table every tick, fifteen rejections code-equal. Debug and both plugin
  suites green; no engine change.
- `ff7c851` ms7b brush body rule: force `self.k * (self.target - self.pos)
  - sqrt(self.k) * self.velocity`, bit-equal to `ddsim::body_substep` for
  60 ticks at mass 1 and 64 (`brush_body_test.cpp`), golden `brush`,
  preset `brush` (k = 1/64) with an overshoot test at tick 30. Debug,
  Release, Wasm, plugin tests green; `MS_STEP_VERSION` unchanged.
- `4a99d1c` ms7a: `fx64.hpp`, `rng.hpp`, `fxmath.hpp` moved to
  `include/mathspace/`; `include/ddsim/` holds one-line forwarding stubs
  until 7f; the two header-scan tests follow; Debug, Release, Wasm and
  the plugin tests green, no hash change. Phase 7 sliced (Next).
- Phase 6 (ms6), one line: `9d47eaf` `embed`; `5b5b55e` `identify`
  (`MS_STEP_VERSION` 11); `c49dd84` `sphere` preset; `566ff24` plugin
  side; `02481a2` engine side (diagonal `metric`, `MS_STEP_VERSION` 10).
- Phase 5 (ms5), one line: `b27808a` view presets and the done condition;
  `4acdaab` surface in a browser; `24f1dbb` stage surface; `fd781d9`
  `engine-core.js`; `61ef64f` engine side (`ms_project`, `MS_ABI_VERSION` 3).
- Phases 1 to 4, one line each (details in git): ms4 `064966d`,
  `60cd37e`, `60c8346` (constraints, `MS_STEP_VERSION` 8); ms3 `e1e30a5`,
  `9b28407`, `e0b6942`, `919c06e`, `872831b`, `204ced5`, `f90b3c7`,
  `22bc70c` (force rules, presets, RULE-07); ms2 `d6e9c0b`, `c5d134e`,
  `c44393d`, `a159268`, `1abc9d4`, `3b25475`, `30fc1a6`, `1725143`,
  `3ca1482` (expressions); ms1 `836a4da`, `a111181`, `07f35f4`, `feab148`,
  `f7013b3`, `8587ec9`, `a247eab`, `215602c` (engine over the kernel).

## Decisions

- Delete ddsim (`a7ee49c`): the rope-chain comparison is kept as a
  regression with mathspace's EXACT raw positions per checkpoint and
  ddsim's recorded ones beside them (from the deleted solver at
  `f74d0db`), so the accepted deviation stays measurable and any step()
  change for a chain fails loudly. The brush parity tests compare
  against a transcription of `body_substep` (`brush_reference.hpp`)
  rather than being dropped: the rule's bit-equality is the point of 7b.
  The bridge test's five lockstep tests became bridge-only replays; bit
  parity with ddsim's body and node table is the ten recorded `.sha256`
  in `surface/test/golden/` (written while the bridge was lockstep-equal)
  and `wasm-golden.test.ts` checks them. The `ddsim` namespace stays on
  `fx64`, `rng`, `fxmath` (renaming is churn with no test); the CMake
  interface stays `ddsim_settings` and the options `DDSIM_*` because
  CLAUDE.md and the presets name them; the project is `mathspace`.
  `MS_FX_FORMAT_ID` keeps ddsim's `0x00200020` so the walk bytes and
  every golden are unchanged.
- Worker switch (`f74d0db`): the snapshot keeps ddsim's byte layouts
  (`NODE_STRIDE` 88, `BODY_STRIDE` 56) rather than making `decodeNodes` a
  view over notes: nothing that renders changes, and the per-tick cost is
  O(new nodes) instead of a BigInt decode of every note. `MsSim.step` is
  engine step + `afterStep`; the body table omits `ending` strokes so a
  pen-up drops the body at once as ddsim's table did. The goldens were
  COPIED, not moved: `data-drawing/sim`'s own tests still read the
  originals until 7f deletes the directory. `version()` now reports
  `MS_ABI_VERSION`.
- Emission (`4d1e6dc`): one `afterStep(notes, tick)` on the bridge, not
  an `afterStep` list on each `Translation` as the slice sketched: the
  emission pass needs the post-step snapshot anyway, so the end-tick
  DeleteNote rides on its return value and a caller has one thing to
  apply per tick. A StrokeEnd with no samples on its tick deletes the
  body at once (ddsim skipped that tick's integration for it); one with
  samples marks the stroke `ending`, the step integrates, `afterStep`
  emits and then deletes. Emitted nodes carry `tick` and `brush` as fx64
  integers (`fxFromInt`), no `scale_band` (always 0 in ddsim). The node
  cap is the bridge's `nodeCount`; the "stroke id in use" check is a Set
  of stroke ids that have emitted, since nodes are never deleted.
- Bridge (`3b6909a`): the body note lives in a dim-2 space (id 1, the
  stroke plane's (u, v)) with the rule (id 2); emitted nodes (7d) get
  their own dim-3 space (id 4), so the rule never needs `select`. The
  force is compiled against a template note (id 3) that carries the body
  fields and is deleted after BindField, because `ms_compile` takes
  field dims from the notes present. Body id is
  `make_node_id(branch, ordinal, 2^24 - 1)`, an index no emission reaches.
  The body carries `k` and `spacing`, never `mass` (7b). `pos` is set from
  the FIRST sample ever (where ddsim placed the body) and `target` from
  the last sample of the tick. A StrokeBegin's body has no `pos` until
  its first sample, so the rule does not visit it (no skip is reported).
- Brush body (`ff7c851`): the brush mass lives in `k` = 1 / mass on the body
  note, never in the note's `mass`, so the one division matches ddsim's
  `derive_params`; `c` is `sqrt(self.k)` in the rule (2 zeta = 1) and is
  not stored. The preset test asserts the overshoot at tick 30, not 60:
  the damped period at k = 1/64 is about 58 ticks.
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

- `plugins/data-drawing` tests need `npm run sim:wasm` there (emsdk,
  about a minute) to fill the gitignored `surface/wasm/` with
  `mathspace.*` (a stale `ddsim.*` pair from before 7f can be deleted).
  `plugins/data-drawing` has no node_modules of its own; vitest and tsc
  resolve from the root symlink. `npm run build` there emits the wasm
  twice (`dist/<name>.wasm` and `dist/assets/<name>-*.wasm`); it did so
  for ddsim too, so it is not a regression.
- `div_q32` in fx64.hpp FLOORS, as its comment says (the sign-magnitude
  division subtracts one when the signs differ and the remainder is
  nonzero); an earlier note here said truncation and `fxDiv` copied the
  error until `4d1e6dc`. `mul_q32` floors by arithmetic shift. Check
  against the C++ with a negative dividend, not the note.
- Plugin tests run against `plugins/mathspace/wasm/` as it is on disk:
  an engine change without `npm run engine:wasm` shows up as baffling
  compile errors (an `UnknownRef` for a reference the C++ resolves).
- Vite dev ignores `build.outDir` in its watcher (`server.watch.ignored:
  ['!**/dist/**']` fixes it) and serves CommonJS untransformed; nothing
  bundled into the renderer may touch `Buffer` or `node:`. The
  browser-automation skill (`~/.claude/skills/browser-automation/
  browser.mjs <url> --script f.mjs --screenshot p.png`) loads the dev
  page headlessly (15 to 45 s per load) and can read the canvas.
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

- **Phase 7 in the app.** The data-drawing surface now runs on the
  mathspace Wasm (7e) with ddsim gone (7f); nobody has drawn a stroke in
  Electron on it. Next item 1 covers it. (2026-09-24)

- **Phase 7 sub-steps.** ddsim integrated every pen sample within a
  tick at h = 1/n; the mathspace bridge keeps the last sample per tick
  and integrates once. If drawing with a fast pen feels different in
  the app, the alternatives are stepping the engine n times per tick
  (breaks tick = kernel advance) or averaging samples; a human should
  choose. Recorded 2026-09-24 at `4a99d1c`.
