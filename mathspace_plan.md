# Mathspace — implementation plan

Companion to `mathspace_design.md`. That file says what the thing is. This
one says what gets built, in what order, where it lives, and how each step
is known to be done.

Revised 2026-09-24 after merging `phase-2-implementation-v1`: the main
line has a deterministic kernel (`tapestry/kernel/`) whose node model is
the note store this plan originally set out to build, an Electron app
that already renders nodes at `position.x`/`position.y`, a plugin SDK, and
a roadmap whose phase 5 ("Deterministic Rule Engine", requirements
RULE-01..08 in `.planning/REQUIREMENTS.md`) is this engine. Mathspace is
now built as that engine, over the kernel, as a plugin.

## The core, restated

The core is **spatial notes in an N-dimensional space**. The kernel
already provides notes: a node is an id, a type string, and typed
properties, changed only through recorded ops, journaled to a readable
`.tree` file. Mathspace adds what the kernel deliberately does not have:
a fixed-point simulation over those properties, expressions, rules,
constraints, views, and metric spaces.

Any node becomes spatial by carrying position properties. `mass`,
`velocity`, shape, and colour are properties somebody added, and the
engine only does something with them because a rule node says so. The
engine core never learns a property name.

## Foundational decisions

These are hard to change later, so they are decided now.

**The kernel is the store. Mathspace never owns durable state.** Durable
truth is the `.tree` journal. Mathspace keeps an in-memory **engine
image**: the `fx64` mirror of the nodes that participate in a space,
rebuilt from kernel nodes in id order and updated incrementally. The
image has a canonical byte walk and a SHA-256 hash for determinism tests
and checkpoint verification; that hash is never written into the `.tree`.

**Where the code lives.** The `mathspace` static library stays in this
repo at `include/mathspace/` and `src/mathspace/`, tests under
`tests/mathspace/`, reusing `ddsim/fx64.hpp` and the SHA-256 helper. The
forbidden-token gate covers it. The engine is built to WebAssembly with
the existing `wasm-release` preset and hosted by `plugins/mathspace/`,
a plugin in the Electron app that runs in the main process, reads nodes
through the SDK's `kernel.getNodes()`, and submits plugin-signed commits
through `kernel.submit()`. The native addon route is deliberately not
used: the project constraint is that a normal feature must not require a
core fork, and a plugin is the proof.

**Numeric type.** `fx64` Q32.32, and nothing else, inside the engine.
Kernel `real` values are IEEE doubles. Conversion is exact in both
directions and happens in JavaScript at the plugin boundary, never in
C++: a real `r` is accepted only if `r * 2^32` is an integer with
magnitude below 2^53, and it is sent to the engine as that raw int64. The
engine's outputs are raw int64 converted back the same way. Every value
the engine can produce is therefore exactly representable as a `real`,
the `.tree` stays readable (`position.x real 12.5`), and no double ever
enters `include/` or `src/`. The usable range is about ±2 million world
units at 2^-32 resolution, enough for an idea space.

**Identity.** Note ids are kernel `NodeId`s: sequential `u64`, never
reused, tombstoned on delete. The structured branch/group/index layout
from the earlier plan is dropped; grouping and branching are the kernel's
job (roadmap phase 3), not an id-layout trick.

**Property conventions.** Keys follow the app's existing convention:
- a vector field `f` of dim N is `f.x f.y f.z f.w` for N ≤ 4 and
  `f.0 … f.(N-1)` for N > 4, each a `real`;
- a scalar field is one `real` (or `int` when integer-valued, as in
  `anger int 3`);
- a bound field `f` stores its formula as `f.expr text "…"` and its last
  computed value in `f` (or `f.x` …), so the file shows both;
- membership is `space ref n<k>`; a node with `position.*` and no
  `space` ref lives in the implicit space of its tree frame (2D
  Euclidean, identity metric), which is how every existing note already
  behaves in the app;
- Space, Rule, and View nodes are `mathspace/space@1`, `mathspace/rule@1`,
  `mathspace/view@1` with their fields as properties (`dim int`,
  `metric.expr text`, `scope text`, `select.expr text`, `force.expr text`,
  `constraint.expr text`, `compliance real`, `project.expr text`).

**Commit granularity.** The engine runs ticks in memory. A commit is
submitted on pause, on any human edit that touches a participating node,
and every `MS_COMMIT_EVERY` ticks while running (default 60, one second).
Each commit carries `set` lines for every durable field that changed
since the last commit and one `advance k`. Replaying the `.tree` without
the engine reproduces every committed state, so the file is readable and
complete on its own. The engine's determinism is checked separately:
goldens over action fixtures, and a checkpoint test that re-runs the
engine from commit i for k ticks and requires the result to equal commit
i+1's `set` lines exactly.

**Actions remain the engine ABI.** The ddsim-style action grammar
(kinds 32 to 36, header `u8 kind | u8 version | u16 reserved | u32 len`)
is how the plugin feeds the engine and how goldens and the two-process
tests drive it. It is not a durable format; the `.tree` is.

**Human edits during a run.** The SDK has no change subscription. Before
each commit the plugin reads `status()`; if the journal advanced by
commits it did not make, it rebuilds the image from `getNodes()` before
continuing, so a drag or a formula edit takes effect within one commit
interval and is never overwritten by stale engine output.

## Phase 1 — the engine over the kernel

**Goal.** Nodes in the running Electron app move under the engine, the
motion is recorded readably in the `.tree`, and a golden proves the run
is deterministic. The store, hash walk, actions, replay tool, and goldens
built before the merge are kept; the SDL Space page is gone.

Physics in this phase is one bootstrap rule compiled into the engine:
`position += velocity` per tick for any note with a `velocity` field,
pinned under `MS_RULE_INTEGRATE_VERSION`. Phase 3 replaces it with a
rule node and deletes it. It exists so phase 1 has something visible.

Deliverables:

- `include/mathspace/ids.hpp`: `NoteId` becomes a plain sequential `u64`
  matching `tapestry::kernel::NodeId`. Drop the group layout and its
  tests. `SpaceId` stays as a distinct type over the same value.
- Bootstrap integrate rule in `src/mathspace/step.cpp`, versioned in
  `version.hpp` and in the hash walk.
- Snapshot bytes: `World` exposes a flat little-endian record per note
  (`u64 id | u8 field_count | per field: name | dim | dim x i64`) so the
  plugin can read changed values after a step without a per-field call.
- C ABI `include/mathspace/mathspace_c.h` + `src/mathspace/ms_c.cpp`:
  `ms_create(seed)`, `ms_destroy`, `ms_apply(bytes, len)`, `ms_step`,
  `ms_tick`, `ms_hash`, `ms_serialize`, `ms_restore`, `ms_notes_ptr`,
  `ms_notes_len`. Mirrors `ddsim_c.h` and returns the same error codes
  where they apply.
- `wasm/mathspace_wasm.cpp` and a `mathspace_wasm` target in the
  `wasm-release` preset exporting the `ms_*` symbols.
- `plugins/mathspace/`: `tapestry.plugin.json`, `package.json`,
  `index.js` (activate registers commands `mathspace.run`,
  `mathspace.pause`, `mathspace.step`), `engine.js` (loads the Wasm),
  `image.js` (kernel `NodeData` → actions, exact real↔raw conversion,
  property-key conventions, diff → `set` ops), `scripts/build-wasm.sh`
  mirroring the data-drawing one. Vitest tests for `image.js`: exact
  conversion round-trips, rejected reals, key mapping, diff output.
- Goldens: `tests/golden/ms/velocity.actions` + `.sha256`, and a
  checkpoint fixture `plugins/mathspace/test/fixtures/velocity.json`
  (a `NodeData` array plus the expected `set` ops after 60 ticks).

Done when: in the app, a note given `velocity.x real 1` moves across the
canvas under the Run command, Pause leaves a commit whose `set
position.x` lines are in the `.tree`, reopening the file shows the note
where it stopped, and the golden and checkpoint tests pass in Debug and
Release and across two processes.

## Phase 2 — expressions

Unchanged in substance. A field can be a formula stored as `f.expr text`.

- `include/mathspace/expr/ast.hpp`, `parser.hpp`, `diff.hpp`,
  `bytecode.hpp`, `vm.hpp` and their sources; `include/ddsim/fxmath.hpp`
  with fixed-iteration `sin cos atan2 exp log pow` built first and tested
  against an integer oracle with an op-count check.
- Grammar: scalars, vectors, `+ - * /`, comparison, `if`, `min max abs
  clamp sqrt sin cos atan2 exp log pow`, `dot norm`, `curve(knots, t)`,
  component access, references `self.f`, `other.f`, `node(n12).f`,
  `space.dim`, `world.tick`.
- Action 37 `BindField(note, name, bytecode)`; the plugin compiles text
  to bytecode in JS or via a `ms_compile` ABI call (decide in-phase;
  record it).
- A `shape.expr` on a node is drawn by the phase 5 surface; in this
  phase it is only evaluated and hashed.

Done when: `tests/golden/ms/plot.actions` binds a handful of expressions
and hashes identically across processes and builds, and a bound field's
value appears in the app's inspector after a step.

## Phase 3 — rules: forces and assignments

Rule nodes drive properties. This is roadmap phase 5's RULE-01..05.

- `mathspace/rule@1` nodes with `scope` (unary, pair, global),
  `select.expr`, and `force.expr` or `set.<field>.expr`.
- `src/mathspace/step.cpp`: force rules accumulate in id order; the
  integrator is the bootstrap rule generalized to N components and
  reading `mass`; `set` rules run after. The bootstrap rule is deleted
  and its golden re-recorded under the new version pin.
- Presets under `plugins/mathspace/presets/`: `gravity-field`, `nbody`,
  `drag`, `spring-to-anchor`, and the roadmap's required examples:
  proximity-to-chips raises `anger`, a `gold` accumulator, a movement/
  force example.
- RULE-07: every failure the engine can detect (missing definition,
  incompatible dims, a cycle between `set` rules, two rules writing one
  field, an exceeded bound) is a deterministic error code that the plugin
  writes onto the rule node as `mathspace.error text` in the same commit,
  so the failure is visible and recorded.
- RULE-08: a node with `pinned bool true` is excluded from every rule's
  writes; the plugin never touches `event`.

Done when: the three roadmap examples run in the app from preset rule
nodes with no engine change between them.

## Phase 4 — constraints

Unchanged: `constraint.expr` + `compliance`, fixed-iteration XPBD with
symbolic gradients in `src/mathspace/solve.cpp`, contact preset, rod and
contact goldens, and the comparison test against ddsim's `rope-chain`
that justifies phase 7.

## Phase 5 — views and projection

Two-dimensional spaces already render in the app's canvas. This phase is
for everything else.

- `mathspace/view@1` nodes with `project.expr`.
- `plugins/mathspace/surface/`: a stage surface (placement `stage`, like
  `datadrawing.canvas`) with a three.js scene that reads the engine
  snapshot from a module Worker, draws notes at `project(pos)`, shapes by
  sampled level sets, rule regions faintly. Read-only, as the SDK
  requires; input goes back through the plugin's main-process commands.
- Default views as presets: identity for 2D, perspective and three
  orthographic views for 3D, an axis-pair picker for N > 3.

Done when: one 4D space is viewable through two View nodes at once.

## Phase 6 — metric spaces

Unchanged: `metric.expr` on the Space node, Christoffel symbols by
symbolic differentiation, geodesic step, `identify`, `embed`, and the
Poincaré and sphere presets.

## Phase 7 — fold ddsim in

`data-drawing/sim/` is the live ddsim the data-drawing plugin builds; the
root `include/ddsim` copy has diverged (particles, constraints). Phase 7
ends the duplication:

- The brush body becomes a preset rule; pen samples become `SetField`
  actions on a target field; emission at spacing lives in the
  data-drawing plugin's bridge and emits `CreateNote`/`SetField`.
- The data-drawing plugin switches its Worker to the mathspace Wasm and
  keeps its action-kind 1..6 adapters so existing goldens replay.
- `data-drawing/sim/` and `include/ddsim/rules/` are deleted;
  `fx64.hpp`, `rng.hpp`, `fxmath.hpp` move under `include/mathspace/`.

## Sequencing and effort

| Phase | Depends on | Rough size |
| --- | --- | --- |
| 1 engine over the kernel | merge (done) | 1 to 2 weeks |
| 2 expressions | 1 | 2 to 3 weeks, fxmath is half of it |
| 3 force rules | 2 | 1 to 2 weeks (RULE-07 handling is real work) |
| 4 constraints | 3 | 1 to 2 weeks |
| 5 views | 2 | 1 to 2 weeks, can run alongside 3 and 4 |
| 6 metrics | 4, 5 | 2 weeks |
| 7 fold ddsim | 4 | 1 to 2 weeks |

## Invariants every phase must keep

- No floats, `<cmath>`, `<random>`, or unordered containers in
  `include/`, `src/`, `wasm/`. The gate enforces it. Doubles exist only
  in JavaScript at the plugin boundary, converted exactly.
- Every loop bound is fixed at compile time or by state, never by
  convergence.
- Every iteration over notes, fields, or tuples is in id order or name
  order.
- A rejected action leaves the engine image byte-identical; a rejected
  proposal leaves the kernel untouched (the kernel already guarantees
  this).
- Two processes replaying the same fixture produce the same hash, in
  Debug and Release, on every commit.
- The `.tree` is complete without the engine: every committed state is
  readable and replayable from `set` lines alone.
- Rendering and view state never enter the hash.
- Plugins import only from the SDK. No Electron, no host internals.

## Open questions, with the answer I would take

- **Where does text compile to bytecode?** In JS inside the plugin, so
  the engine ABI stays binary and the parser has good tests in Vitest.
  Revisit if two hosts need it.
- **Frame-local positions.** The app measures `position.*` from a tree's
  frame origin. The implicit space per tree frame handles this in phase
  1; an explicit `mathspace/space@1` node with `dim` above 2 is its own
  coordinate system and is not frame-local. Record any change.
- **Tick rate.** 60 Hz, matching `DD_TICK_HZ`. The kernel's `advance`
  counts ticks; the plugin's timer paces them and never enters the
  engine.
