---
spike: 016b
idea: generative-vectors
name: swept-tubes
type: comparison
validates: "Given spike 015's expanded vectors, when each continuation chain is swept as one smooth tube (Catmull-Rom centreline, rotation-minimising frames) and side branches start their own capped tube with a flared collar, then joints are smooth, the mesh is watertight, it rebuilds deterministically, and it can be built for one region"
verdict: PARTIAL
related: [015, 016a]
tags: [tubes, surface, meshing, determinism, generative]
---

# Spike 016b: Swept Tubes

## What This Validates

Given spike 015's expanded vectors, when each continuation chain (a branch
and its continuing last child, and so on) is swept as one smooth tube, and
side branches start their own capped tube with a flared collar, then joints
are smooth, the mesh is watertight, it rebuilds deterministically, and it can
be built for one region.

## How It Works

- **Chains.** The last child continues its parent (it starts at the parent's
  end), so following last children turns a limb into one polyline.
- **Centreline.** Catmull-Rom through the chain's joints, 4 samples per
  vector, with radii interpolated.
- **Frames.** Rotation-minimising, by double reflection (dot products only).
  Rings use a 12-sided table of cos/sin written as literals, not
  `Math.cos`/`Math.sin`.
- **Joints.** Each tube is capped at both ends. A side branch's first ring is
  flared to `min(parent radius, 1.6 × own radius)` and sits inside the
  parent.

## How to Run

Shared with 016a: `node 016-shared/check.mjs`, and the viewer at
`/016-shared/index.html`.

## Investigation Trail

1. **Along a limb it works.** There are no bamboo seams: one continuous tube
   bends through each joint.
2. **Every tube is closed** (0 boundary and 0 non-manifold edges), so the
   *mesh* passes the watertight check. But the *object* isn't one surface:
   side branches overlap their parents (240 overlaps at level 4, 483 at level
   5). A single watertight skin would need a mesh boolean union.
3. **Looked at the fork, and it's worse than 015's cylinders.** The collar
   is a lump, and where the overlapping tubes cut through each other the
   shading breaks up. The flare meant to hide the join draws attention to it.
4. **Fast, deterministic, regional.** 10–60 ms, 13k–93k triangles.
   Rebuilds are identical, and a region's tubes land on the whole mesh's
   vertices (0 missing). A chain's frames depend on the whole chain, so a
   region must build whole chains, not cut them.

## Results

**PARTIAL.** It solves bamboo along a limb, but not at forks, which is where
the question was. About 100× cheaper than 016a:

| Description | Level | Build | Triangles | Overlapping joints |
|---|---:|---:|---:|---:|
| tree | 4 | 16–59 ms | 40,680 | 240 |
| tree | 5 | 28 ms | 93,168 | 483 |
| bridge | 5 | 17 ms | 44,088 | 214 |

**Signal for the build**

- Good for distant levels of detail, where forks are a pixel or two, and
  for previews while a distance-field surface builds.
- Don't try to hide joints with collars. A real weld needs either a boolean
  union or the field approach (016a).
- Build regions by whole chains: frames propagate from a chain's start.
