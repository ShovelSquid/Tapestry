---
spike: 016a
idea: generative-vectors
name: sdf-surface-nets
type: comparison
validates: "Given spike 015's expanded vectors, when they are blended as capsules in one signed distance field (smooth minimum) and meshed on a global lattice, then joints are smooth, the mesh is watertight, it rebuilds deterministically, and a region's surface lands on the whole surface's vertices"
verdict: WINNER
related: [015, 016b]
tags: [sdf, surface, meshing, marching-tetrahedra, determinism, generative]
---

# Spike 016a: A Distance-Field Surface

## What This Validates

Given spike 015's expanded vectors, when they are blended as capsules in one
signed distance field (smooth minimum) and meshed on a global lattice, then
joints are smooth, the mesh is watertight, it rebuilds deterministically, and
a region's surface lands on the whole surface's vertices.

## Research

| Mesher | Watertight | Notes | Status |
|---|---|---|---|
| Surface nets (one vertex per crossed cell) | ✗ | Compact and smooth, but two sheets through one cell share a vertex: 33–257 non-manifold edges on the tree, even with twigs 2 voxels thick | **Dead end** for a watertight surface |
| Marching cubes (256-case table) | Only with a consistent ambiguity rule | A large table to get right | Not tried |
| **Marching tetrahedra on the Freudenthal split** | ✓ by construction | Each cube becomes the same 6 tetrahedra around its 0→7 diagonal, so neighbours split shared faces alike; no ambiguous cases; about 3× surface nets' triangles | **Chosen** |

The field is a polynomial smooth minimum over capsule distances, with a
fillet width of 1.2× the capsule's radius. It's summed in vector order-key
order: the smooth minimum isn't associative, so the order is part of the
answer.

## How to Run

```bash
cd .planning/spikes && npm install
node 016-shared/check.mjs 3,4,5 0.04      # both surfaces, all measurements → 016-shared/results/check.json
node 015-generative-vectors/serve.mjs     # then open /016-shared/index.html on the printed host
```

## Investigation Trail

1. **Surface nets first.** Deterministic and regional, but not watertight:
   46 non-manifold edges at level 3 and 257 at level 4 with twigs 0.6 voxel
   thick. Thickening twigs helped (0.6× → 2× cell: 257 → 33) but never
   reached zero. Two sheets passing through one cell (twigs close together,
   fillet saddles) is inherent to the method.
2. **Marching tetrahedra: watertight at every level.** 0 boundary and 0
   non-manifold edges for the tree and bridge at levels 3–5. Vertices sit on
   lattice edges keyed by their two global corners, so neighbouring cells
   share them exactly.
3. **Thin twigs vanish between lattice points.** A capsule thinner than the
   voxel may cross no lattice point. `minRadius` (1.0× the voxel) thickens
   them, which makes the voxel size a level-of-detail control: coarser
   voxels mean thicker twigs and fewer triangles.
4. **Looked at the fork.** The limb is welded into the trunk with a smooth
   fillet; the bridge is one continuous object, with the ground anchor
   filleted into both stalks. Faint stair-step shading comes from normals
   averaged over thin triangles, not from the geometry.
5. **Corrected by spike 017.** 016a padded its capsule buckets by
   `r + k + 2h` from the axis, one radius short of its own reach test (which
   is on distance to the surface). A capsule in that band counted in one
   bucket and not the next, so the field depended on the bucket grid (by
   about 3×10⁻⁵). Now padded by `2r + k + 2h`. All checks still pass after
   the fix: watertight, deterministic and regional at every level. The
   numbers below are from before the fix; after it the tree takes
   2.3/2.7/3.3 s at levels 3/4/5.
6. **Crease statistics weren't useful.** The largest angle between
   neighbouring faces (~170°) comes from near-degenerate slivers where the
   field is almost zero at a lattice point. Judge smoothness by eye;
   dihedral p99 is 57–77°.

## Results

**WINNER.** The only surface with genuinely welded joints, and watertight by
construction. Measured on a 4-core Xeon @ 2.1 GHz, single-threaded JS,
voxel 0.04:

| Description | Level | Vectors | Build | Triangles | Watertight | Rebuild identical | Region (r = 0.8) |
|---|---:|---:|---:|---:|---|---|---|
| tree | 3 | 120 | 2.3 s | 212,620 | ✓ | ✓ | 125 ms; 0 of 4,411 vertices differ |
| tree | 4 | 363 | 2.5 s | 299,892 | ✓ | ✓ | 153 ms; 0 of 6,161 |
| tree | 5 | 849 | 4.0 s | 412,652 | ✓ | ✓ | 151 ms; 0 of 7,907 |
| bridge | 5 | 405 | 1.4 s | 257,232 | ✓ | ✓ | 153 ms; 0 of 15,361 |

**Signal for the build**

- Build the surface as a field of the vectors, not as geometry per vector.
  The weld is free, and a region is exact because lattice points are global
  and each field value depends only on capsules within a fixed reach.
- **Don't use surface nets** where watertight matters. Use marching
  tetrahedra, or marching cubes with a consistent ambiguity rule.
- **Cost is the risk:** 2–4 s and 200k–400k triangles in JS at voxel 0.04.
  Most of the time is field evaluation (0.7M points at level 4). The next
  steps are an adaptive lattice (coarse far from the surface, fine near
  thin twigs), simplifying the mesh, running the field on the GPU or in
  WASM, and normals from the field gradient to remove the stair-step shading.
- The surface isn't additive the way the vectors are: adding a level adds
  capsules, which reshapes the fillets near them. It's a view of the
  vectors, regenerated per level of detail and per region, never stored.
