# Mathspace — the mutable mathematical space under Tapestry

A design sketch. Nothing here is built yet. The goal is one substrate that
is at once a graphing calculator, a physics engine, and the renderer's
source of truth, with nothing about geometry, dimension, or physical law
hardcoded in C++.

## The one idea

**Everything is a note, every note is fields plus expressions, and physics
is a general constraint solver over those expressions.**

That single sentence covers every item on the wish list:

| Wish | What it becomes |
| --- | --- |
| A point | A note with a `pos` field of dimension N |
| A plane, a sphere, any shape | A note whose `shape` field is an expression `f(x) = 0` or `f(x) <= 0` |
| A 3D / N-D space | A note of kind Space with a `dim` and a metric expression `g(x)` |
| A non-Euclidean space | Same, with a non-identity metric (Poincaré disk, sphere chart, …) |
| Gravity as a "world note" | A note of kind Rule with a selector (`has(mass)`) and a contribution expression |
| Things interacting | Rules whose scope is pairwise, plus contact constraints from shape expressions |
| Graphing-calculator feel | Typing `y = sin(x)` is creating a shape note in the current space |
| Rendering defined by the notes | A note of kind View holds a projection expression from N-D to the page plane |

The engine never knows what gravity, a sphere, or hyperbolic space is. It
knows how to evaluate expressions, differentiate them symbolically, and run
a fixed-iteration position-based solver against them. Every physical
concept lives in the document as text, and is therefore mutable, saveable
in the `.tapestry` delta format, and replayable.

## Why this fits what exists

`ddsim` already runs a hardcoded special case of exactly this solver.
`rules/constraints.hpp` projects particles onto the manifold
`|x_a - x_b| - L = 0` by moving along the gradient, weighted by inverse
mass, a fixed number of passes, in id order. That is Position-Based
Dynamics with one constraint type baked in. XPBD (the extended,
compliance-based version) generalizes it: any scalar constraint
`C(x_1..x_k) = 0` with a known gradient can be solved by the same loop.

So the generalization is not "add more constraint kinds in C++". It is
"let the constraint be an expression, and get the gradient by
differentiating the expression tree". Distance, contact, sphere-surface,
rod, hinge, and "stay on this manifold" are then all one line of user text
each, and the C++ solver never changes.

Everything else inherited stays: `fx64` Q32.32 as the only numeric type,
fixed pass counts, seeded PRNG, canonical byte walk, SHA-256 hash, the
forbidden-token gate against floats. Expressions add one more thing to the
walk: their compiled bytecode. A changed formula changes the hash, which is
correct.

## The five layers

```
math/expr     AST, parser, symbolic diff, bytecode, fx64 VM, transcendentals
space         charts: dimension, metric g_ij(x), identifications, geodesic step
notes         the entity store: id, kind, fields (fx64 vectors), bindings
rules         selectors, contributions, the XPBD loop, force accumulation
view          samplers: implicit-shape tracing, projection, output to nanovg
bridge        Tapestry document lines <-> notes; actions <-> ddsim action log
```

Dependencies point downward only. `view` reads state and never writes it.
`bridge` is the only layer that knows Tapestry's page model.

### 1. `math/expr` — the atom

A small expression language over `fx64` scalars and fixed-dimension
vectors. Enough for physics and plotting, no more:

- Arithmetic, comparison, `min`/`max`/`abs`/`clamp`, piecewise (`if`).
- `sqrt`, `sin`, `cos`, `atan2`, `exp`, `log`, `pow` — all currently
  missing from `fx64.hpp` and needed by anything non-Euclidean or
  inverse-square. Implement as fixed-iteration CORDIC and range-reduced
  polynomials in integer arithmetic, so they meet the same determinism
  contract as `div_q32` and `isqrt128` (fixed op count, floor rounding).
- Vector ops: `dot`, `norm`, component access, construction, and a metric-
  aware `len(a, b)` that the Space layer supplies.
- Reductions: `sum over notes where <predicate>` in ascending id order.
  This is the only loop construct, and its order is fixed, so the sum is
  deterministic.
- References: `self.mass`, `other.pos`, `space.g`, `world.tick`.

Pipeline: parse to AST → symbolic differentiate on demand (`grad(C, x_i)`
is just AST rewriting, and the result is cached and compiled once) →
compile to a flat bytecode → evaluate on a stack VM with no allocation per
call. The bytecode is what enters the canonical walk.

Symbolic differentiation is the load-bearing choice. Numerical gradients
in fixed point are noisy and cost extra evaluations. Symbolic gradients
are exact up to `fx64` rounding and are computed once per rule edit.

### 2. `space` — a chart, not a hardcoded geometry

A Space note declares:

- `dim N`
- `metric g(x)` — an N×N matrix of expressions. Euclidean is the identity
  and the default. Poincaré disk is `4 / (1 - |x|^2)^2 * I`. A sphere in
  angular coordinates is `diag(1, sin^2(theta))`.
- `identify` — optional maps that glue the chart to itself (wrap x at ±L
  gives a cylinder or torus). This is how topology enters without a mesh.
- Optional `embed(x)` — a map into a higher-dimensional Euclidean space,
  used by View for drawing curved spaces convincingly and never by physics.

Physics in a curved chart uses the metric in two places: distances and
inner products go through `g`, and free motion follows geodesics. The
geodesic equation needs Christoffel symbols, which are first derivatives
of `g`. Those come from the same symbolic differentiator, so a user can
type a metric and get correct free-fall in it with no new C++.

Notes inside a Space are stored in that Space's chart coordinates. A note
can only interact with notes in the same Space. Moving a note between
Spaces is an explicit action.

### 3. `notes` — fields plus bindings

A note is: an id, a kind, a parent Space, and a map from field name to
either a stored `fx64` vector (state) or a bound expression (derived,
recomputed each tick, never stored, never hashed). Kinds are just
conventions about which fields are present:

| Kind | Typical fields |
| --- | --- |
| Point | `pos`, `vel`, `mass` |
| Shape | `shape(x)` expression, optionally `pos`/`vel`/`mass` for a moving body |
| Rule | `scope`, `select`, `apply` (see below) |
| Space | `dim`, `metric`, `identify`, `embed` |
| View | `project(x)` expression, `sample` settings |

The kind is not an enum the solver switches on. A rule that selects
`has(mass)` picks up Points and moving Shapes alike.

ddsim's `Particle` becomes a Point note. `BrushBody` becomes a Point note
with a spring Rule attached. `Node` (an emitted stroke sample) stays as
inert data owned by the data-drawing plugin, with a Shape note wrapping a
whole stroke as a polyline for collision when wanted.

### 4. `rules` — laws as notes

A Rule note has three parts:

- `scope`: `unary` (each selected note), `pair` (each unordered pair of
  selected notes, ascending id order), or `global` (once per tick).
- `select`: a predicate over fields, e.g. `has(mass) and mass > 0`.
- `apply`: one of
  - `force = <vector expr>` — accumulated into the note's velocity before
    integration (gravity fields, drag, springs, N-body attraction).
  - `constraint C = <scalar expr>` with `compliance` — solved in the XPBD
    loop (rods, contacts, "stay on the manifold", hinges).
  - `set field = <expr>` — a direct assignment after the solve (colour by
    speed, teleport on wrap).

Because a Rule is a note, it can have a `pos` and a `shape` too. A gravity
Rule whose `select` includes `inside(rule.shape, other.pos)` is gravity
that only acts within a region, which is the "laws can change over space"
requirement from the semantic-world plan, with no special mechanism.

The tick is fixed and order-locked:

```
1. for each Rule (id order), scope unary/pair/global: accumulate forces
2. for each Point (id order): prev = pos; vel += force * h; pos += vel * h
   (in a curved Space this is one geodesic step using the Christoffel
   symbols; in Euclidean it reduces to the line above)
3. for k in 0 .. ITERATIONS: for each constraint Rule (id order), for each
   selected tuple (id order): XPBD projection using the symbolic gradient
4. for each Point: vel = (pos - prev) / h
5. for each `set` Rule: assign
6. tick += 1; rebuild snapshot bytes
```

Steps 2 and 4 are ddsim's existing integrator, verbatim. Step 3 is ddsim's
existing loop with the constraint function and gradient looked up instead
of inlined.

**Contacts between arbitrary shapes** need no new solver. For a Point
against a Shape, the constraint is `C = max(0, shape(pos))` with gradient
`grad(shape)` at `pos`. For Shape against Shape, sample the boundary of
one at a fixed count of points (deterministic) and treat each sample as a
Point-vs-Shape contact. Crude, but general, and it is a Rule the user can
read and replace.

Pair scope is O(n²). That is fine for the hundreds to low thousands of
notes this needs first. When it is not, the answer is a deterministic
spatial hash keyed on floored chart coordinates, still iterated in id
order, and still not a change to any expression.

### 5. `view` — the notes draw themselves

A View note holds `project(x)`, an expression from the Space's N
coordinates (or its `embed` image) to the 2D page plane, plus a camera.
The default for a 2D Euclidean space is the identity, which is how a
Tapestry page today already draws. For 3D it is a perspective expression.
For a Poincaré disk it is the identity too, since the chart is already a
disk, and the metric makes things visibly shrink toward the rim on their
own, because the physics moved them that way.

The renderer:

- Draws Points as sprites at `project(pos)` (instanced arrays, the same
  path chrono and Tapestry strokes use).
- Draws Shapes by sampling `shape(x)` on a grid in projected space and
  tracing the zero level set (marching squares in 2D; marching cubes into
  line strips for 3D, projected). The sample grid is view state and never
  enters the hash. This is exactly how a graphing calculator plots
  `f(x, y) = 0`, so plotting and rendering are one code path.
- Draws Rules optionally as their `shape` region, faint.

Rendering reads the state; it never writes it. That is the invariant from
semantic-world and it is what lets neural or fancier rendering be bolted
on later without touching truth.

### 6. `bridge` — a Space is a page

In Tapestry, a Space note is a page. Its body text is the note list, one
note per line, in the same one-line-per-field style the `.tapestry` format
already uses:

```
space 1 dim 2 metric I
note 2 point pos (0, 0) vel (1, 0) mass 1
note 3 shape f(x) = x.y - sin(x.x)
note 4 rule pair select has(mass) force = -G * self.mass * other.mass * (self.pos - other.pos) / len(self.pos, other.pos)^3
note 5 rule unary select has(mass) constraint C = shape_3(self.pos) compliance 0
note 6 view project(x) = x
```

Editing a line is an action. Actions go through ddsim's existing action
log so replay, goldens, and two-process determinism checks cover
expressions for free. The `.tapestry` delta format gains one line kind,
`mnote <id> <text>`, and a delta that changes one formula costs one line.

Data drawing sits on top: a brush stroke becomes Point notes with a spring
Rule, driven by pen samples as force contributions. The brush-body rule in
`rules/brush_body.hpp` becomes a text Rule that ships as a preset instead
of C++.

## What is deliberately not in the first version

- General topology. A Space is one chart with identifications. Manifolds
  that need an atlas of overlapping charts are out. This covers every
  space a user is likely to type, and adding an atlas later is additive.
- Rigid-body orientation. Points have no rotation. A rigid body is a
  cluster of Points with rod constraints, which the solver already does.
- Fields on a grid (fluids, cellular automata). That is semantic-world's
  domain and stays there.
- SI units. `fx64` has range ±2.1e9 and resolution 2.3e-10, so `G` in SI
  is not representable. Constants are "world units", as ddsim's gravity
  constant already is, and a unit scale on the Space is the user's
  choice.

## Risks, named

- **Fixed-point transcendentals** are the first real work and the first
  real risk. CORDIC in Q32.32 loses precision near range boundaries;
  range reduction has to be exact integer arithmetic. Test them against a
  high-precision oracle the way `fx64_test.cpp` tests `div_q32`.
- **Expression cost per pair.** A VM eval per pair per tick is fine to a
  few thousand notes. Beyond that, the fix is spatial hashing and, later,
  compiling hot expressions to a straight-line op list, not a language
  change.
- **Symbolic differentiation blowup.** Naive diff of nested expressions
  grows fast. Common-subexpression elimination at compile time keeps it in
  check and is well understood.
- **Stiff constraints in fixed point.** XPBD with compliance 0 is
  unconditionally stable in floating point, but `fx64` division by tiny
  gradients can overflow. Keep ddsim's epsilon guards and add a clamp on
  the per-pass correction magnitude.

## Build order

Each slice is independently useful and independently testable with
golden hashes, in the order that de-risks the scary parts first.

1. **Expression VM + transcendentals.** Parser, symbolic diff, bytecode,
   `fx64` `sin`/`cos`/`atan2`/`exp`/`log`. Ship a graphing-calculator page
   in Tapestry that plots `f(x, y) = 0`. No physics yet. Proves
   determinism of the VM and the view sampler.
2. **Notes and unary rules in Euclidean N-D.** Point notes, force rules,
   the integrator. Reproduce ddsim's `pendulum` golden with the pendulum
   written as text.
3. **Constraint rules with symbolic gradients.** The XPBD loop reads
   `C` and `grad C` from expressions. Delete the hardcoded distance
   constraint once its golden matches. Point-vs-Shape contact.
4. **Pair rules and regional rules.** N-body gravity, drag, gravity
   confined to a Rule's shape.
5. **Metric spaces.** Metric expression, Christoffel symbols by symbolic
   diff, geodesic step. Demo: a Point orbiting in a Poincaré disk, and
   the same text file run in a Euclidean Space for contrast.
6. **Data drawing re-expressed.** Brush body as a preset Rule. Strokes as
   Shape notes. Remove `rules/brush_body.hpp` once its golden matches.
