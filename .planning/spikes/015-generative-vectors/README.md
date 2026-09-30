---
spike: 015
idea: generative-vectors
name: generative-vectors
type: standard
validates: "Given 3–10 hand-placed seed vectors and four knot rules (attraction, repulsion, alignment, branching), when expanded for 4 levels, then the result is a legible 3D form, re-expanding gives the identical result, and level N+1 only adds to level N (nothing already generated moves)"
verdict: VALIDATED
related: []
tags: [procedural, geometry, lod, determinism, three, generative]
---

# Spike 015: Generative Vectors

## What This Validates

Given 3–10 hand-placed seed vectors and four knot rules (attraction,
repulsion, alignment, branching), when expanded for 4 levels, then the result
is a legible 3D form, re-expanding gives the identical result, and level N+1
only adds to level N (nothing already generated moves).

This is the first prototype from Kaelen's "Generative Vector Neural
Rendering" note (2026-09-30): *store the rules that make the object, not the
object*. It also tests a fourth property the note implies: **local**. Detail
grown in one region only must equal the whole expansion there, or "what
geometry should exist here at this resolution" can't be answered without
growing everything.

## Research

**Prior art in this repo.** The `data-drawing` branch (a separate project,
"expected to relate to Tapestry later") paints pen strokes as nodes with a
deterministic fixed-point simulation: Q32.32 on `int64`, a seeded random
generator, a state hash, and a CI check that rejects floats. Its marks get ids
"derived from the stroke ordinal and emission index, never from a counter"
(STRK-03). Its painted strokes are exactly section 5 of the note (painting as
structural input). This spike borrows the id rule and the hash, and leaves
fixed point to `data-drawing`.

| Approach | Pros | Cons | Status |
|---|---|---|---|
| L-system (string rewriting, then turtle geometry) | Classic, compact grammar | Children don't respond to neighbours or relationships; no knots | Rejected: the note's point is that relationships generate geometry |
| Space colonization (branches grow toward attractor points) | Natural crowns | Global: every branch competes for the same points, so a region can't be grown alone | Borrowed as the `attractors` field only |
| Force-relaxed branching with path ids and freeze-per-level | Knots are forces; ids are structural; levels are frozen, so growth is additive and local | Forces have a reach, which sets the regional halo | **Chosen** |
| Fixed-point integer maths (as in `data-drawing`) | Bit-identical on every machine and engine | Slow in JS, and heavy for a first prototype | Deferred. Doubles restricted to `+ − × ÷ √` (correctly rounded by IEEE 754) instead |

## How to Run

```bash
cd .planning/spikes && npm install                   # three, once
node 015-generative-vectors/check.mjs 4              # the claims, per preset → results/check.json
node 015-generative-vectors/serve.mjs                # open the URL it prints
```

On the page: pick a description, drag **Levels** from 0 to 7, move the rule
sliders, **nudge a seed**, and double-click the object to grow detail only
around that point. The HUD shows the description size, the vector count, the
compression ratio, the time and the geometry hash.

## What to Expect

- **tree:** 3 seeds and 2 repel knots give 3,765 vectors at level 7, a
  legible trunk, limbs and crown.
- **coral:** 5 seeds and no knots give a dense fanned shrub.
- **bridge:** two stalks with an `attract` knot between them grow toward each
  other into an arch and a woven canopy, over an anchor seed that repels
  growth but never grows. The arch exists only because of the relationship.
- **Nudge a seed:** tilting one limb reorganises everything downstream of it.
- The same description always shows the same hash, in Node and in Chromium.

## Investigation Trail

1. **Design for the properties, not the look.** Ids are paths
   (`trunk.2.0.1`). Randomness is a hash of the id. A child starts on its
   parent's segment, and forces bend only the new children (Jacobi, so the
   order children are visited doesn't matter). A level is frozen into the
   neighbour index only once it's complete.
2. **All claims held for all three presets at level 4**: two independent
   module instances hash the same; every vector of expand(N) is bit-identical
   in expand(N+1); a region grown alone reproduces every vector inside it
   (0 missing, 0 different).
3. **Negative controls.** Growing with no halo makes the locality check fail
   (tree: 10 missing, 3 different; coral: 68 missing). Freezing each child the
   moment it's made did *not* break locality, because the halo covered the
   extra dependencies. What it breaks is order independence: visiting each
   level's parents backwards changes the geometry. So that check was added,
   and it passes for the real design. Every claim now has a control that makes
   it fail.
4. **Surprise: the neighbour index can change the answer.** A faster index
   (a grid per level, numeric cell keys, neighbours fetched once per child)
   changed the hashes. A **brute-force reference** (test every frozen vector)
   showed the *original* index was right and the new one wrong. The numeric
   cell key reached 2⁶³, past the 2⁵³ a double holds exactly, so neighbouring
   cells rounded to one key, a query visited the same list twice, and forces
   were **counted twice**. With keys kept below 2⁵³, the index matches brute
   force exactly at levels 4 and 5, and level 7 went from 1.6 s to 0.35 s. The
   check now compares against brute force every run.
5. **Anchors.** The bridge's ground seed grew its own spray of branches. A
   seed with `grow: false` now takes part in the forces (growth avoids it)
   but never branches. It's a ground, a wall or a skeleton.
6. **The regional halo, derived.** A level-k vector depends on its parent
   (within one length of its start), its siblings, and frozen vectors within
   (reach + 1) lengths. So vectors below level k must be exact within
   `need[k] + (reach + 2) · len[k]`. This replaced a padded guess, stays
   exact, and grows 1,463 of 3,765 vectors (instead of 1,659) to make a
   level-7 sphere exact.
7. **Chromium vs Node:** the page's SHA-256 equals Node's for every preset
   checked (tree L4 and L7, coral L6, bridge L6). Both engines are V8, so this
   isn't proof across engines. Restricting maths to correctly-rounded
   operations is what should make it hold elsewhere, and a Firefox or Safari
   run would confirm it.

## Results

**VALIDATED**, with Kaelen's hand check on the look and on how nudging and
regional detail feel still to do.

`results/check.json` (level 4), `check-L6.json`, `check-L7.json`,
`shots.json` and `shots/*.png`. Measured in Node 22 on a 4-core Xeon @ 2.1 GHz:

| Description | Seeds / knots | Description size | Vectors at L4 / L7 | Compression at L7 | Whole expand at L7 | Region vs whole at L7 |
|---|---|---:|---:|---:|---:|---:|
| tree | 3 / 2 | 457 B | 363 / 3,765 | ×527 | 407 ms | 1,463 / 3,765 in 98 ms |
| coral | 5 / 0 | 530 B | 405 / 4,185 | ×505 | 595 ms | 2,277 / 4,185 in 310 ms |
| bridge | 3 / 2 | 437 B | 189 / 1,701 | ×123 (L6) | 258 ms | 1,511 / 1,701 in 203 ms |

(Compression compares 8 doubles per vector against the JSON description; a
mesh would be many times larger again.)

**Signal for the build**

- The four properties hold together: legible, deterministic, additive and
  local. The design choices that make them hold are path ids, a hash-keyed
  random generator, children starting on their parent, forces bending only
  new children (Jacobi), freezing a level only when it's complete, and summing
  neighbour forces in id order.
- **Relationships generate structure.** The bridge's arch comes from one
  `attract` knot, and nudging one seed reorganises the crown. That's the
  note's editability claim, demonstrated.
- **Locality is bought with force reach.** The halo is about
  (reach + 2) × segment length per level. On one tree that saves roughly
  2–3× at level 7; across a large scene it's close to everything. A
  view-dependent renderer wants forces whose reach shrinks with depth.
- **Always keep a brute-force reference for any spatial index.** The fast
  index silently doubled forces, and only the reference caught it.
- **The surface is the open problem.** Branches are separate cylinders, and
  the joints look like bamboo. The next spike is a surface from the vector
  graph (signed-distance blending or swept tubes with shared joints).
- Fixed-point maths (as in `data-drawing`) is the route to determinism across
  machines if the IEEE-restricted doubles ever disagree between engines.
