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

## What it inherits

- `fx64`: Q32.32 fixed-point arithmetic (`include/ddsim/fx64.hpp`) — no
  floats, doubles, or `<cmath>` anywhere in the sim target (enforced by
  `cmake/forbidden_tokens.cmake`).
- A fixed-timestep sim loop with a seeded xoshiro256** PRNG and no wall
  clock, threads, or unordered containers.
- Canonical serialize/restore/hash: two runs of the same actions produce
  the same SHA-256 state hash; a restored state hashes identically to the
  original.
- A spring-damper body integrator (`include/ddsim/rules/brush_body.hpp`),
  currently specialized for pen-brush mass/stiffness/damping — the main
  candidate for generalizing into rigid-body dynamics.
- A determinism harness: `ddsim_replay` CLI, two-process goldens, and a
  Debug/Release/UBSan preset matrix (`CMakePresets.json`).

## Constraints and joints

The first generalization past pen strokes: free `Particle`s (point masses,
`include/ddsim/state.hpp`) connected by `Constraint`s
(`include/ddsim/rules/constraints.hpp`), solved each tick by fixed-iteration
Position-Based Dynamics (Jakobsen-style — no persistent Lagrange state, no
convergence-dependent loop bounds, so it's as deterministic as everything
else here). One primitive covers three cases by choice of parameters:

- **Rod / rigid distance**: `stiffness = 1`.
- **Spring**: `stiffness < 1` (partial correction per iteration reads as
  springy, damped motion).
- **Hinge / pin joint**: either endpoint is a static particle
  (`is_static`, `inv_mass = 0`), anchoring the other to a fixed point — a
  pendulum's fixed end.

`CreateParticle` / `CreateConstraint` (action kinds 5, 6) are create-only,
same as the inherited actions started. See `tests/constraint_test.cpp` and
the `pendulum` / `rope-chain` golden fixtures.

## Not yet generalized

Brush strokes (`Brush`, `DefineBrush`, node emission along a path) are
still the pen-specific machinery this was forked from — untouched, and now
sitting alongside particles/constraints as a separate subsystem rather than
folded into it. Also not here yet:

- True rotational hinges with angle limits or torque — needs rigid bodies
  with orientation, not just point masses.
- Particle-field forces (gravity/dipole-style N-body interaction, closer to
  the `chrono_magnetic_particles` prototype's domain).
- Any C ABI / Wasm export of particles or constraints — there's no
  consumer yet.

## Mathspace (current work)

This branch is building **mathspace**, a deterministic engine over
Tapestry's kernel that gives spatial notes expressions, rules, constraints,
views and metric spaces, hosted as the plugin `plugins/mathspace/`. See
`mathspace_design.md`, `mathspace_plan.md` and `autonomy/STATE.md`.

Status (2026-09-24): plan phase 1 (the engine over the kernel) is built and
tested headlessly: the `mathspace` library (`include/mathspace`,
`src/mathspace`), its C ABI and Wasm module, goldens under
`tests/golden/ms`, and the plugin (`engine.js`, `image.js`, `runner.js`)
whose tests run the real kernel and the real Wasm and check the `.tree`.
The one remaining phase 1 item is a human confirming the note moves in the
Electron app under the Run command. Plan phase 2 (expressions) is built
the same way: `include/mathspace/expr` (parser, bytecode, VM over
`include/ddsim/fxmath.hpp`), action 37 `BindField`, `ms_compile` in the C
ABI, and `<f>.expr text` props that the plugin compiles and binds so the
bound value is committed after a step; golden `plot` covers it, and
`expr/diff.hpp` holds the symbolic derivatives phase 4's solver will use.
Plan phase 3 (rules) is built and tested headlessly: force and `set.<f>`
rules under unary, pair and global scope with `select`, `pinned`,
runtime failures written to the rule node as `mathspace.error`, goldens
`gravity` and `pair`, and `plugins/mathspace/presets/` whose seven
presets (the plan's four plus the roadmap's `anger`, `gold` and `push`)
are `mathspace.preset.<id>` commands checked on one engine build.
Phases 4 to 7 are not started.

## Build

```bash
cmake --preset native-debug -DDDSIM_DOCTEST_DIR="$(pwd)/third_party/doctest"
cmake --build build/native-debug
ctest --preset native-debug
```

The `wasm-release` preset needs Emscripten 6.0.10 pinned via `$EMSDK`; not
required for native engine work.
