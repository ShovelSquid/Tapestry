---
spike: 017
idea: generative-vectors
name: fast-sdf
type: standard
validates: "Given 016a's distance-field surface, when the lattice is culled to a narrow band of bricks, corners are stored densely per brick, each brick sums its own capsule list, and keys are numeric, then the mesh is bit-identical to 016a's (so watertight, deterministic and regional carry over) and builds ≥10× faster"
verdict: PARTIAL
related: [016a, 015]
tags: [sdf, performance, narrow-band, meshing, determinism]
---

# Spike 017: A Fast Distance-Field Surface

## What This Validates

Given 016a's distance-field surface, when the lattice is culled to a narrow
band of bricks, corners are stored densely per brick, each brick sums its own
capsule list, and keys are numeric, then the mesh is **bit-identical** to
016a's (so watertight, deterministic and regional carry over by equality)
and builds ≥10× faster.

## Research

The first profile of 016a (tree, level 4, 2.4 s) showed field arithmetic
under 2%. The time went to bookkeeping over **634k active cells**, all cells
inside some capsule's bounding box, of which only 50k are crossed by the
surface: map lookups for corners (24%), string keys for edge vertices (16%),
and garbage from per-cell arrays (17%). So the fixes are about what not to
visit and how to store it, not the maths. GPU, WASM and worker threads were
left out: they're build decisions, and the spike's first question was how
far the algorithm alone goes.

## How to Run

```bash
node .planning/spikes/017-fast-sdf/check.mjs        # 017 vs 016a on 3 presets × levels 3–5 → results/check.json
node .planning/spikes/015-generative-vectors/serve.mjs   # /016-shared/index.html → "017: fast distance field"
```

## Investigation Trail

1. **Narrow band (bricks of 4³ cells).** Evaluate the field at each brick's
   centre and skip the brick when |value| > half its diagonal + one voxel.
   The field changes no faster than distance does, so such a brick can't
   hold the surface. 4,923 of 12,286 candidate bricks kept (tree L4). Only
   cells whose corners change sign are kept, then sorted into 016a's (i, j, k)
   order, so vertices and triangles come out in 016a's order. **Identical
   hash**, 3–5× faster.
2. **Numeric edge keys.** Every tetrahedron edge in the Freudenthal split
   joins a corner to one that dominates it, so `lower corner key × 8 +
   direction` is unique and stays below 2⁵³.
3. **Dense corners per brick.** Corner values live in a flat 5×5×5 array per
   kept brick, filled once. Faces shared by two bricks are evaluated twice,
   giving the same value at the same lattice point. Still identical; 7×.
4. **Per-brick capsule lists broke the hash, and found a bug in 016a.** The
   reach test compares distance to a capsule's *surface* against
   `r + k + 2h`, but 016a padded its bucket boxes by `r + k + 2h` from the
   *axis*, one radius short. A capsule in that band counted in one bucket and
   not the next, so **016a's field depended on where its bucket grid fell**
   (differences of about 3×10⁻⁵). 016a's own tests couldn't see it, because
   whole and regional builds shared the same buckets. It took a second,
   independently built index. With both padded by `2r + k + 2h`, 017 is
   identical to the corrected 016a, and 016a still passes all its checks.
   This is the same lesson as spike 015's doubled forces.
5. **Regions were slower than 016a's** at first, because every brick was
   filled before cells outside the sphere were dropped. Skipping bricks
   outside the sphere first brought regions to 11–72 ms.
6. **Negative control.** A band too thin (margin −3.5 voxels) drops real
   surface, and the hash changes. The mesh stays closed (0 holes): whole
   twigs vanish rather than leaving gaps, a failure that a watertightness
   check alone wouldn't catch.
7. **Gradient normals** (central differences at half a voxel) remove the
   stair-step shading 016a showed at the fork. But they go through the slow
   bucket path with 6 evaluations per vertex and cost 1–3 s at depth.
8. **Looked at level 6.** One welded, organic tree (537k triangles, 0.7 s).
   New artifact: **bulging rings** where a branch meets its continuing child.
   A smooth union of two end-to-end capsules adds material where they
   overlap.

## Results

**PARTIAL.** The mesh is identical everywhere, but the speedup is 4–11×
rather than ≥10× across the board. Measured on a 4-core Xeon @ 2.1 GHz,
single-threaded JS, voxel 0.04 (`results/check.json`):

| Description | Level | 016a | 017 | Speedup | Region (r 0.8) | Identical, whole and region |
|---|---:|---:|---:|---:|---:|---|
| tree | 3 | 2,177 ms | 192 ms | ×11.3 | 43 ms | ✓ |
| tree | 4 | 2,334 ms | 321 ms | ×7.3 | 35 ms | ✓ |
| tree | 5 | 2,937 ms | 453 ms | ×6.5 | 72 ms | ✓ |
| bridge | 5 | 1,477 ms | 243 ms | ×6.1 | 47 ms | ✓ |
| coral | 5 | 2,423 ms | 479 ms | ×5.1 | 56 ms | ✓ |

Deeper (017 only): tree L6 0.7 s (537k triangles), tree L7 1.1 s (657k),
tree L5 at voxel 0.02 1.5 s (1.4M), coral L7 1.4 s (1.0M). All watertight.

**Signal for the build**

- **The narrow band is the win:** most of a capsule's bounding box is empty
  space. Cull by brick with the Lipschitz bound, store corners densely, and
  keep the traversal order so the output is exactly the reference's.
- **A regional rebuild takes tens of milliseconds**, fast enough to regrow
  the surface around the camera's focus as detail is needed.
- **Every spatial index needs an independent twin.** Two index bugs in two
  spikes (015's doubled forces, 016a's short padding) were each invisible to
  the spike's own tests.
- **Next steps, in order of payoff:**
  1. worker threads per brick range; the field is independent per brick,
     so merge by sorted key for identical output
  2. gradient normals through the per-brick lists
  3. a plain minimum between a branch and its continuation, to remove the
     rings
  4. mesh simplification for distant views
  5. the field on the GPU or in WASM
