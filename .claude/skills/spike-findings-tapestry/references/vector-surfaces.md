# Surfaces From Vectors

## Requirements

- **The surface is a field of the vectors,** a smooth union of capsules meshed on a global lattice. That welds joints for free and keeps a region exact (spike 016a).
- **A watertight surface needs a mesher with no ambiguous cases:** marching tetrahedra on the Freudenthal split, not surface nets (spike 016a).
- **The surface is a view, regenerated per level of detail and region, never stored.** It isn't additive: new capsules reshape nearby fillets (spike 016a).
- **Build only in a narrow band.** Skip bricks whose centre value exceeds their half-diagonal (the field changes no faster than distance), and keep the reference traversal order so the output is bit-identical (spike 017).
- **A capsule's index reach is `2r + k + 2h` from its axis,** because the reach test is on distance to the capsule's *surface* (spike 017, fixing 016a).

## How to Build It

The source is `sources/017-fast-sdf/fast.mjs` (the fast path) and `sources/016a-sdf-surface-nets/sdf.mjs` (the reference, and surface nets).

1. **Capsules.** For each vector: axis from `start` to `start + dir·len`, radius `max(radius, minRadius·h)` (twigs thinner than a voxel vanish otherwise, so `minRadius = 1`), blend `k = 1.2·r`. Sort by the vector's order key.
2. **The field** at p: walk capsules in order, skip any with `capsuleDistance > r + k + 2h`, and fold the rest with the polynomial smooth minimum `smin(a, b, k) = min(a, b) − (max(k − |a − b|, 0)/k)² · k/4`. Order matters: the smooth minimum isn't associative. With no capsule in reach, return `FAR = max(r + k) + 2h`.
3. **Bricks of 4³ cells.**
   - The candidates are bricks that overlap any capsule's axis box padded by `r + k + h`.
   - Each brick gets its own capsule list: every capsule whose axis box padded by `2r + k + 2h` reaches the brick, in ascending order.
   - Evaluate the field at the brick's centre, and skip the brick if `|f| > √3·2h + h`.
4. **Dense corners.** For each kept brick, fill a `Float64Array(5³)` of lattice values. Keep only the cells whose 8 corners change sign, then sort their keys. The key `((i + 2¹⁵)·2¹⁶ + (j + 2¹⁵))·2¹⁶ + (k + 2¹⁵)` sorts in (i, j, k) order.
5. **Marching tetrahedra.** Split each cell into the six tetrahedra `[0,1,3,7] [0,1,5,7] [0,2,3,7] [0,2,6,7] [0,4,5,7] [0,4,6,7]` (bit 0 = x, 1 = y, 2 = z). For 1 or 3 corners inside, emit one triangle; for 2 inside, emit a quad as two triangles. Put vertices on edges at `t = v₁/(v₁ − v₂)` from the lower corner, keyed `lowerCornerKey·8 + (a xor b)`, so neighbouring cells share them. Orient each triangle from the inside corners' mean toward the outside corners' mean.
6. **Normals from the field's gradient** (central differences at h/2) for smooth shading. Face-averaged normals show stair-steps.
7. **Regions.** Mesh only cells whose centre is in the sphere, and skip bricks farther than `radius + brick half-diagonal` before evaluating anything. Vertices land exactly on the whole mesh's vertices, because the lattice is global.

## What to Avoid

- **Surface nets for watertight output.** Two sheets through one cell share a vertex, which left 33–257 non-manifold edges on the tree even with twigs 2 voxels thick.
- **Swept tubes for forks.** Tubes along a continuation chain remove seams along a limb, but side branches only overlap their parent (240 overlaps at level 4), and a flared collar looks worse than plain cylinders. Tubes are fine for distant levels of detail (10–60 ms).
- **Padding the index from the axis by the surface reach.** One radius short made the field depend on where the bucket grid fell. Only an independent second index revealed it.
- **Filling every brick and then dropping cells outside a region.** Cull bricks first.
- **Dihedral-angle statistics as a smoothness metric.** They measure ring facets and slivers. Judge by eye.

## Constraints

Measured on a 4-core Xeon @ 2.1 GHz, single-threaded JS, voxel 0.04:

| Description | Level | Reference (016a) | Narrow band (017) | Region (r 0.8) | Triangles |
|---|---:|---:|---:|---:|---:|
| tree | 4 | 2.3 s | 0.32 s | 35 ms | 300k |
| tree | 5 | 2.9 s | 0.45 s | 72 ms | 413k |
| tree | 7 | — | 1.1 s | — | 657k |
| coral | 7 | — | 1.4 s | — | 1.0M |

- The output is watertight (0 boundary, 0 non-manifold edges) and bit-identical between 016a and 017, whole and regional, for 3 presets × levels 3–5.
- Gradient normals currently cost 1–3 s extra, because they go through the slow bucket path.
- **Bulging rings** appear where a branch meets its continuing child: the smooth union adds material where two end-to-end capsules overlap. Join continuations with a plain minimum.
- **Next steps, in order of payoff:**
  1. worker threads per brick range (merge by sorted key)
  2. normals through the per-brick lists
  3. a plain minimum for continuations
  4. simplification for distant views
  5. the field on the GPU or in WASM

## Origin

Synthesized from spikes: 016a, 016b, 017.
Source files: `sources/016-shared/`, `sources/016a-sdf-surface-nets/`, `sources/016b-swept-tubes/`, `sources/017-fast-sdf/`.
