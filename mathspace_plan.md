# Mathspace — implementation plan

Companion to `mathspace_design.md`. That file says what the thing is. This
one says what gets built, in what order, where it lives, and how each step
is known to be done.

## The core, restated

The core is **spatial notes in an N-dimensional space**. Not physics, not
expressions, not rendering. A note has an id, belongs to a space, and has
named fields. `pos` is the one field every note has. Everything else,
including `mass`, `shape`, `vel`, and `colour`, is a field somebody added,
and the simulation only does something with it because a rule note says
so. The engine core never learns a field name.

That ordering is what the phases below protect. Phase 1 is a usable idea
space with zero physics. Each later phase adds a capability by adding a
kind of note, never by changing the store.

## Foundational decisions

These are hard to change later, so they are decided now.

**Where it lives.** A new static library `mathspace` in this repo,
headers under `include/mathspace/`, sources under `src/mathspace/`, tests
under `tests/mathspace/`. It reuses `ddsim/fx64.hpp` and the SHA-256
helper from `src/hash.cpp` and links `ddsim_settings` for the compile
flags. The forbidden-token gate already globs `include/` and `src/`
recursively, so the no-float rule covers it for free. The `ddsim` source
glob must become non-recursive (`src/*.cpp`) so the two libraries do not
absorb each other's translation units. `ddsim` itself is left untouched
until phase 7 migrates its particles onto notes.

**Numeric type.** `fx64` Q32.32, and nothing else, in anything hashed.
Rendering converts to `double` at the bridge and never writes back.

**Identity.** Note ids are `u64` with ddsim's `NodeId` layout from
`include/ddsim/ids.hpp`: 8 bits of branch, 32 bits of group ordinal, 24
bits of index within the group. A group is whatever created the notes
together: a brush stroke, a paste, a preset load. A note placed by hand is
a group of one. This is chosen over plain sequential ids for the reason
stated in `rules/emit.hpp`: inserting a stroke into a session leaves every
other stroke's ids untouched, which the data-drawing plugin relies on and
which an idea space with undo and branching will rely on too. Ascending
numeric order is still (branch, group, index), so storage stays sorted by
a `lower_bound` insert exactly as `state.nodes` is today. Spaces are
notes too and take the next group ordinal. Field names are short UTF-8
strings, at most 31 bytes, and a note's fields are kept sorted by name so
the byte walk needs no map.

**Dimension.** Fixed per space, set at creation, 1 to 8 for the first
version. A note's `pos` has exactly its space's dimension. Notes cannot
change space in place; moving is delete plus create, which keeps the
per-space invariants simple.

**Field storage.** A field is a fixed-length `fx64` vector of length 1 to
8 plus an optional bound expression. Stored values are state and are
hashed. A bound expression replaces the stored value on every tick
before rules run; bound fields are hashed by their bytecode, not their
value. Strings are not a field type. Labels for the idea-space use live
in Tapestry's page, not in the note.

**The action log is the API.** Every mutation is a ddsim-style action:
`u8 kind | u8 version | u16 reserved | u32 payload_len | payload`, decoded
into a local and committed only on OK. Text grammar sits on top and is
compiled to actions by the bridge. Mathspace actions start at kind 32 so
they never collide with ddsim's 1 to 6.

**Hash walk.** `"MSP1" | u32 version pins ... | u64 seed | u64 tick |
u32 note_count | per note in id order: u64 id | u64 space_id | u8 kind |
u8 field_count | per field in name order: u8 name_len | name | u8 dim |
u8 bound | dim x i64 value | u32 bytecode_len | bytecode`. Kinds are
`Space`, `Note`, `Rule`, `View`, and exist so the bridge and renderer
can find things, not so the solver can branch.

**Input media write values; they define nothing.** The store and the
rule engine own all logic and never reference strokes, brushes, or pens.
Data drawing is the first input medium: a producer of `SetField` actions
whose value is that it locks down the richest human signal available, the
pen sample from `ddsim/state.hpp` (position, pressure, tilt, twist, at a
fixed tick rate). The `Sample` record is the reference shape of an input
event. It is not the reference shape of a note. Shader values (colour,
size, glow, opacity) are fields in the same way, and a View note declares
which fields feed which vertex attributes. The renderer reads them and
never derives them.

The brush pipeline is one preset built from that input: a body note with
`pos`, `vel`, and a `target` the samples write into, a spring-damper
force rule, emission of notes along the path, and a pressure curve. As a
worked example of "nothing is special", ddsim's `Node` maps field for
field:

| ddsim `Node` | mathspace note field |
| --- | --- |
| `x, y, z` | `pos`, dim 3 |
| pressure (consumed at emission today, not stored) | `pressure`, stored |
| `weight` | `weight = curve(note(brush).curve, self.pressure)`, bound |
| radius times weight (computed by the renderer today) | `size = note(brush).radius * self.weight`, bound |
| `dir_x, dir_y` | `dir` |
| `vx, vy` | `vel` |
| `tick`, `brush` | `tick`, `brush`, integer-valued |

The brush itself is a note holding `mass`, `radius`, `spacing`, and the
17-knot `curve`. The brush body is a note with `pos`, `vel`, and a
`target` field pen samples write into, driven by a preset spring-damper
force rule that reads `note(brush).mass`. Pressure and size are therefore
ordinary variables: a user can rebind `size`, or write `mass = weight`
so a heavy stroke attracts things. The store is not allowed to know any
of these names.

Two consequences for the phases: the expression language needs a
`curve(knots, t)` op (piecewise-linear over 17 knots, the integer
interpolation from `rules/emit.hpp`) so `weight` can be a formula rather
than C++; and emission at spacing, which creates notes rather than
setting values, lives in the input bridge as preset logic that emits
`CreateNote` and `SetField` actions, reading `spacing` from the brush
note. The engine sees only actions, so replay is unaffected by which
preset produced them. A general "rule that spawns notes" inside the
engine is deferred until a second need for it appears. A different
preset can map pressure straight to `mass` or tilt to a colour angle with
no brush concept at all.

## Phase 1 — the spatial note store

**Goal.** Create spaces and notes, move them, save and load them, and
see them in Tapestry. No expressions, no rules, no physics.

Deliverables:

- `include/mathspace/note.hpp`: `Field`, `Note`, `Space` header data.
- `include/mathspace/world.hpp`, `src/mathspace/world.cpp`: the store,
  `apply()`, `step()` (only advances tick), `hash()`, `serialize()`,
  `restore()`.
- `include/mathspace/action.hpp`: kinds 32 `CreateSpace(dim)`, 33
  `CreateNote(space, kind)`, 34 `SetField(note, name, dim, values)`, 35
  `DeleteNote`, 36 `DeleteField`.
- `src/mathspace/hash.cpp`: the walk above and its strict inverse.
- `tests/mathspace/store_test.cpp`: create, set, delete, id stability,
  serialize round-trip hashes identical, rejected action leaves state
  untouched.
- `tools/ms_replay/main.cpp` and the first two golden fixtures under
  `tests/golden/ms/` wired into the existing two-process CTest loop.

Tapestry side:

- `tapestry/core/Space.hpp`: a `PageKind::Space` page owns one mathspace
  `World`. Dragging a note in the page issues `SetField pos`. Notes render
  as labelled dots with the page's text body as the label source, so an
  idea space is usable immediately: place thoughts, drag them, save.
- `.tapestry` format gains `mspace <page-id> <base64 action bytes>` delta
  lines. A save appends the actions since the last save, which is the
  same append-only discipline the format already has.

Done when: a 2D and a 3D space can be created in Tapestry, notes placed
and dragged, saved, reopened, and the mathspace hash after reload equals
the hash before save. Golden fixtures pass in two processes and in Debug
and Release.

## Phase 2 — expressions

**Goal.** A field can be a formula. This is the graphing-calculator
capability and the foundation everything after stands on. Still no
physics.

Deliverables:

- `include/mathspace/expr/ast.hpp`, `parser.hpp`, `src/mathspace/expr/parser.cpp`:
  scalars, vectors, `+ - * /`, comparison, `if`, `min max abs clamp
  sqrt sin cos atan2 exp log pow`, `dot norm`, `curve(knots, t)`
  (ddsim's 17-knot pressure curve, so brush weight is a formula), component
  access, and
  references `self.<field>`, `other.<field>`, `space.dim`, `world.tick`,
  `note(<id>).<field>`.
- `include/mathspace/expr/diff.hpp`: symbolic differentiation with
  common-subexpression elimination.
- `include/mathspace/expr/bytecode.hpp`, `vm.hpp`, `src/mathspace/expr/vm.cpp`:
  flat bytecode, stack VM with a fixed maximum stack, zero allocation per
  evaluation, every op bounded.
- `include/ddsim/fxmath.hpp`: fixed-iteration CORDIC `sin cos atan2`,
  range-reduced `exp log`, `pow` by `exp(b * log(a))`. This is the
  riskiest single piece and is built first inside the phase.
- Action 37 `BindField(note, name, expr_bytecode)`. The text grammar is
  compiled in the bridge; the sim only ever sees bytecode.
- `tests/mathspace/fxmath_test.cpp`: every function against a
  high-precision integer oracle across the full range, plus an exact
  op-count check so the fixed-iteration promise is tested, not assumed.
- `tests/mathspace/expr_test.cpp`: parse, print, diff against hand-derived
  results, eval against oracle, bytecode round-trip, identical bytecode
  for identical source.

Tapestry side:

- A note's field editor accepts `name = <expr>`. A `shape` field whose
  expression is `f(x)` gets drawn by sampling on a view grid and tracing
  the zero level set. This is the plot of `y = sin(x)` on a page.

Done when: `tests/golden/ms/plot.actions` binds a handful of shapes and
hashes identically across processes and builds, and a Tapestry space
page plots them.

## Phase 3 — rules: forces and assignments

**Goal.** Notes with a `mass` field move under user-written laws.
`mass` is not special to the engine. The gravity rule mentions it.

Deliverables:

- `include/mathspace/rule.hpp`: a Rule note's fields `scope` (unary,
  pair, global), `select` (bound expression yielding 0 or 1), and
  `force` or `set <field>` (bound expression).
- `src/mathspace/step.cpp`: the tick order from the design. Force rules
  accumulate in id order; the integrator is the existing ddsim
  semi-implicit step generalized to N components; `set` rules run after.
  `vel` is created on a note the first time a force applies, so a note
  with no `mass` is inert forever.
- Action 38 `SetRuleScope`. Everything else a rule needs is fields.
- Presets as text files under `presets/`: `gravity-field.ms`,
  `nbody.ms`, `drag.ms`, `spring-to-anchor.ms`.
- `tests/golden/ms/pendulum-force.actions`: a spring-plus-gravity
  pendulum written entirely as text, checked against a hand-computed
  first few ticks and then frozen as a golden.

Done when: N-body gravity among a few dozen notes runs in a 2D and a 3D
space from the same rule text, and a regional gravity rule (a rule with
its own `shape`, and `select = inside(self.shape, other.pos)`) affects
only the notes inside.

## Phase 4 — constraints

**Goal.** The general solver. Rods, contacts, and "stay on this surface"
from one mechanism.

Deliverables:

- Rule field `constraint` (scalar expression `C`) and `compliance`.
- `src/mathspace/solve.cpp`: fixed-iteration XPBD. For each constraint
  rule in id order, for each selected tuple in id order, evaluate `C` and
  its symbolic gradient with respect to each participating `pos`, project
  weighted by inverse mass, clamped per pass. Velocity is derived from
  position change, exactly as ddsim does now.
- Contact preset: `constraint C = max(0, note(<shape>).shape(self.pos))`.
- `tests/golden/ms/rod-chain.actions` and `contact-plane.actions`.
- A comparison test that runs ddsim's `rope-chain` fixture and the
  equivalent mathspace text and checks the trajectories agree to within
  a few `fx64` ulps per tick for the first hundred ticks. Exact equality
  is not expected, since the gradient path differs, but this test is
  what justifies deleting the hardcoded constraint in phase 7.

Done when: a rope hangs, a ball rests on `y = 0`, and a note constrained
to `|pos| = R` orbits on a sphere in a 3D Euclidean space.

## Phase 5 — views and projection

**Goal.** Spaces with more than two dimensions are seeable, and the
projection is itself a note.

Deliverables:

- View note fields `project` (bound expression from `space.dim` to 2),
  plus non-hashed view state for the sampling grid and camera.
- `tapestry/render/Space.cpp`: draws notes at `project(pos)` with
  instanced sprites, shapes by sampled level sets in projected space,
  rule regions faintly. Reads state only.
- Default views shipped as presets: identity for 2D, perspective and
  three orthographic views for 3D, a pair-of-axes picker for N > 3.

Done when: the same 4D space is viewable through two different View
notes on two different Tapestry pages at once.

## Phase 6 — metric spaces

**Goal.** Non-Euclidean spaces from a typed metric.

Deliverables:

- Space fields `metric` (N by N bound expressions, default identity),
  `identify` (wrap maps), `embed` (optional).
- Christoffel symbols by symbolic differentiation of `metric`, compiled
  once per edit.
- Geodesic integrator replacing the straight-line step when the metric is
  not the identity, same fixed-step discipline.
- `len(a, b)` in the expression language routes through the metric.
- Presets: `poincare-disk.ms`, `sphere-chart.ms`, `torus-wrap.ms`.
- `tests/golden/ms/poincare-orbit.actions`.

Done when: one note text runs in a Euclidean space and a Poincaré disk
and the two trajectories visibly differ the right way.

## Phase 7 — fold ddsim in

**Goal.** One engine, not two.

- Brush body becomes a preset rule; pen samples become `SetField` actions
  on a target field. Emission at spacing moves into the data-drawing
  bridge as preset logic that issues `CreateNote` and `SetField
  pressure` actions; `weight` and `size` are bound expressions from that
  point on and the renderer stops computing size. The brush validator's
  stability check moves to where the preset's constants are edited.
- `Particle` and `Constraint` become notes and constraint rules. Their
  actions (kinds 5 and 6) are kept as thin adapters that emit mathspace
  actions, so existing fixtures still replay.
- `rules/brush_body.hpp` and `rules/constraints.hpp` are deleted once
  the phase 4 comparison test and the brush goldens pass through the
  adapters.

## Sequencing and effort

| Phase | Depends on | Rough size |
| --- | --- | --- |
| 1 store | nothing | 1 to 2 weeks |
| 2 expressions | 1 | 2 to 3 weeks, fxmath is half of it |
| 3 force rules | 2 | 1 week |
| 4 constraints | 3 | 1 to 2 weeks |
| 5 views | 2 | 1 week, can run alongside 3 and 4 |
| 6 metrics | 4, 5 | 2 weeks |
| 7 fold ddsim | 4 | 1 week |

Phase 1 is deliberately small so the idea space exists before the
mathematics does. Phase 5 is independent of physics and should start as
soon as phase 2 lands if a second person is available.

## Invariants every phase must keep

- No floats, no `<cmath>`, no unordered containers in `include/` or
  `src/`. The gate enforces it.
- Every loop bound is fixed at compile time or by state, never by
  convergence.
- Every iteration over notes, fields, or tuples is in id order or name
  order.
- A rejected action leaves the state byte-identical.
- Two processes replaying the same fixture produce the same hash, in
  Debug and Release, on every commit.
- Rendering and view state never enter the hash.

## Open questions, with the answer I would take

- **Text grammar surface.** Small S-expression-free infix, one field per
  line, as in the design. Take that; it is what a graphing calculator
  looks like.
- **Maximum dimension 8.** Enough for anything a person will type. Raise
  it later by changing one constant and one walk field.
- **Should Tapestry link mathspace directly or through the Wasm C ABI?**
  Directly. Tapestry is native C++ and lives in this repo. The C ABI stays
  for the browser plugin and gets mathspace exports in phase 7.
