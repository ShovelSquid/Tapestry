# 0006 — Organic objects: structure → field → appearance, and derivable detail

**Date:** 2026-10-05
**Status:** **Proposed**
**Spec impact:** notes in §8.5 and on open questions §12.3 and §12.11. Adds a requirement to the log 0003 proposal.

## Question

The `unity` branch's generative-vectors spikes (015–020) grew 3D forms from seeds and rendered them as SDF surfaces. How does that fit here, given the goal of painting 3D objects not as meshes but as **organic point fields**?

## Prior work (unity branch, `.planning/spikes/`)

- **015, generative vectors.** Seed vectors plus **knots** (attract, repel, align relationships between seeds) plus rules, grown level by level. A 457 B description grows into 3,765 vectors at L7.
  - **Deterministic**, bit for bit: only `+ − × ÷ √` touch geometry, and randomness is a hash of each vector's ID.
  - **Additive**: level N+1 never moves level N.
  - **Local**: growing a region gives exactly the same result as growing the whole thing.
  - **IDs are structural paths** (`trunk.2.0.1`), never counters.
  - Relaxation is Jacobi: every force is computed from the same state, then applied.
- **016a / 017, SDF surfaces.** A smooth union of capsules in a distance field, meshed by marching tetrahedra in a narrow band. The surface is a regenerated view, never stored. In JS: a tree at L4 in about 0.3 s, regions in 11–72 ms, L7 in 1.1 s. Open artifact: bulging rings where a branch meets its continuation.
- **018, strokes as seeds.** `data-drawing` pen action lists are fitted into seeds. The **brush decides the role**: ink → stem, lead → anchor, clay → mass, rust → knot. 0.2 s from pen-up to surface.
- **019 / 020** fuse strokes drawn in two or more views into one 3D stem.
- **Caveat:** determinism was shown only within V8 (Node and Chromium). It is unproven across engines.

## Proposal

### 1. Organic objects are descriptions that generate a field

```
strokes (cause keys)
  → seeds and mass (points)                 brush role decides which
  → growth rules (deterministic, additive, local)
  → bonds (links: parent–child vectors, or neighbors in a mass)
  → physics (bonds stretch and break; log 0005)
  → field (smooth union of capsules and blobs)
  → appearance: splats on the surface · mesh · ray-marched field · neural
```

**Shapes have two kinds of source:**
- **Captured or imported** shapes are splat sets.
- **Painted or organic** shapes are descriptions (seeds, knots, rules) that generate a field.

Splats are then **one way of drawing a field**: sampled onto its surface, oriented by its gradient. Because splats don't need a watertight mesh, the meshing constraint that drove 016a doesn't apply to splat rendering. The narrow-band bricks from 017 still locate the surface.

### 2. Bonds come with the structure

- In **branching structures**, the parent–child links between vectors are the bonds. Breaking one drops the subtree as a new piece, and the field regenerates around the break.
- In **bulk mass** (clay, a mug), bonds are neighbor links, as in log 0005.

### 3. Paint is anchored to structure

Pigment and other painted properties are anchored to a **structural ID plus a position along it** (for example `trunk.2.0` at 0.4), not to a point in space. Paint then stays attached when the form grows a level, bends or deforms.

### 4. Painting relationships

The brush roles from spike 018 confirm log 0005's "what the brush carries." A rust stroke making a knot is **painting a relationship**, which means painting a rule.

### 5. Three tiers of detail (refines log 0004)

Growth that is additive and local is a third category, between authority and appearance:

| Tier | What it is | Can depend on the view | Can cause things |
|---|---|---|---|
| **Authoritative** | simulation at an **authored causal level** (e.g. L3) | no | yes |
| **Derivable** | deterministic, additive, local detail grown on demand (e.g. L4–L7 where the camera looks) | yes, *which regions* are grown | **no** |
| **Appearance** | previews, styles, neural rendering | yes | no |

**The rule:** anything causal (physics, collision, fracture, other rules) reads detail only down to the authored causal level. Finer detail is real and repeatable, but it never causes anything, so looking at it can't change the story.

### 6. Stable identity for created points (open question 11)

Adopt the spike rule: **IDs are structural paths, never counters.**
- Grown points are named by their path (`trunk.2.0.1`).
- Fracture pieces are named by the stable things they contain (such as the part `handle`) or by the smallest original structural ID they contain.
- Seed IDs come from the stroke's ordinal, so adding strokes never renames earlier ones (spike 018).

### 7. Addition to the log 0003 proposal

**Every spatial index is checked against a brute-force reference** in tests, including a negative control that should fail. In spike 015, a grid cell key past 2⁵³ was silently rounded, neighboring cells merged, and forces were counted twice without any error.

## Open

- Bulging rings at branch continuations (spike 017).
- Determinism across JS engines and the Rust port, still to be proven.
- How much faster the Rust port is than the JS measurements, still to be measured.
- Real-pen feel for strokes as seeds (spike 018), awaiting Kaelen's hand check.
- How bulk-mass objects (a mug) are described generatively, as opposed to branching ones.
