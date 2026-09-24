# physics-engine

A general-purpose fork of `ddsim`, the deterministic fixed-point simulation
core built for Tapestry's Data Drawing plugin. This spike exists to grow that
core past brush-stroke physics into a broader physics engine, while keeping
its founding invariant: same file, seed, and pinned versions reproduce the
same state at every tick, on any machine.

## Provenance

Forked from `~/Tapestry` (branch `data-drawing`) at commit
`0f08fc53ac90622065a827abb5e3105c73fd7567` — `data-drawing/sim/` copied
verbatim (build artifacts excluded), plus `doctest` vendored locally under
`third_party/doctest/` so this tree configures without depending on the
outer Tapestry checkout.

At fork time, `data-drawing/sim/` itself was fully committed with a clean
working tree — the only uncommitted changes upstream were in the TS plugin
glue (`plugins/data-drawing/surface/src/`) and GSD planning bookkeeping,
neither of which this fork carries. Confirmed working standalone: configured
and built the `native-debug` preset and ran the full CTest suite (75/75
passing, including cross-process and Debug/Release golden-hash checks).

## What it inherited, and where it went

`ddsim` is gone from this tree since plan phase 7 (mathspace_plan.md):

- `fx64` (Q32.32 fixed point), the seeded xoshiro256** RNG and the
  fixed-point `fxmath` live under `include/mathspace/` — no floats,
  doubles, `<cmath>`, `<random>` or unordered containers anywhere in the
  engine (enforced by `cmake/forbidden_tokens.cmake`).
- The spring-damper brush body is a force rule the data-drawing bridge
  installs (`plugins/data-drawing/surface/src/ms-bridge.ts`), bit-equal to
  the original (`tests/mathspace/brush_body_test.cpp` keeps a transcription
  of it as the reference); emission at spacing lives in the same bridge.
- The particle-and-constraint solver became mathspace's `constraint`
  rules (XPBD over symbolic gradients); its `pendulum` and `rope-chain`
  goldens survive as `tests/mathspace/rope_chain_test.cpp`, a plain
  regression that records the deviation from the deleted solver.
- Canonical serialize/restore/hash, the two-process goldens (`ms_replay`,
  `tests/golden/ms`) and the Debug/Release/UBSan preset matrix
  (`CMakePresets.json`) are the same harness under a new name.

## Mathspace (current work)

This branch is building **mathspace**, a deterministic engine over
Tapestry's kernel that gives spatial notes expressions, rules, constraints,
views and metric spaces, hosted as the plugin `plugins/mathspace/`. See
`mathspace_design.md`, `mathspace_plan.md` and `autonomy/STATE.md`.

Status (2026-09-24): all seven plan phases are built and tested
headlessly. Phase 1, the engine over the kernel: the `mathspace` library
(`include/mathspace`, `src/mathspace`), its C ABI and Wasm module,
goldens under `tests/golden/ms`, and the plugin (`engine.js`, `image.js`,
`runner.js`) whose tests run the real kernel and the real Wasm and check
the `.tree`. Phase 2, expressions: `include/mathspace/expr` (parser,
bytecode, VM over `fxmath.hpp`), action `BindField`, `ms_compile`, and
`<f>.expr text` props compiled and bound so the value is committed after
a step; golden `plot`. Phase 3, rules: force and `set.<f>` rules under
unary, pair and global scope with `select` and `pinned`, runtime failures
written to the rule node as `mathspace.error`, goldens `gravity` and
`pair`, and `plugins/mathspace/presets/` as `mathspace.preset.<id>`
commands. Phase 4, constraints: `constraint.expr` with `compliance`
solved by fixed-count XPBD passes over symbolic gradients (`expr/lift.hpp`,
`expr/diff.hpp`), goldens `rod` and `contact`, the `contact` preset.
Phase 5, views: `mathspace/view@1` nodes with `project.expr` evaluated by
`ms_project`, the stage surface `plugins/mathspace/surface/` drawing one
canvas panel per View, presets `view-2d`, `view-3d`, `view-4d`. Phase 6,
metric spaces: `metric.expr` on a space applied by the geodesic step,
`identify.*` half-widths, `embed.expr`, golden `poincare`, presets
`poincare` and `sphere`. Phase 7, fold ddsim in: the brush body as a
force rule, pen samples as `SetField`, emission in the data-drawing
bridge, the data-drawing Worker on the mathspace Wasm with its ten
goldens re-recorded bit-equal, and ddsim deleted. What remains is a
human looking at each phase in the Electron app (`autonomy/STATE.md`,
Blocked).

## Build

```bash
cmake --preset native-debug -DDDSIM_DOCTEST_DIR="$(pwd)/third_party/doctest"
cmake --build build/native-debug
ctest --preset native-debug
```

`native-release` and `native-ubsan` are the other native presets; the
goldens compare Debug against Release. The `wasm-release` preset needs
Emscripten 6.0.10 pinned via `$EMSDK` (`npm run engine:wasm` in
`plugins/mathspace`, `npm run sim:wasm` in `plugins/data-drawing`); not
required for native engine work.
