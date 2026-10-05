# 0005 — Painting as spatial authoring, and fracture by bonds

**Date:** 2026-10-05
**Status:** Bonds chosen for fracture (user decision). The rest is **proposed**.
**Spec impact:** open questions §12.9–§12.11.

## Questions

1. How does painting 3D objects with splats work in this system?
2. Can you paint physical properties or rules, for example cracks in a mug?

## Painting is authoring keys with a footprint

A brush stroke is a **cause key** whose path sweeps out a region. What changes between kinds of painting is what the brush carries:

| Brush carries | Result |
|---|---|
| pigment | color on a surface |
| matter (splats or particles with a material) | new shape, so sculpting by painting |
| any property (`brittleness`, `heat`, `rust`, `dread`) | properties painted onto a region |
| a rule | a region where a rule is active |

## Painting onto a 3D object

- **Contact:** the world BVH finds the overlapping object. The object's shape asset has its own **static BVH over its splats**, built once, which finds the splats under each bristle in O(log S + k).
- **Overlay on shared shapes:** a per-object, copy-on-write **overlay** (per-splat changes plus added paint splats) sits on top of the shared asset. Painting one mug never paints every mug that uses the same asset.
- **Wet paint on curved surfaces:** a one-time nearest-neighbor **graph of surface splats** replaces the flat grid. Water and pigment flow along the graph with gravity projected onto the surface, so drips run down the side of a mug. The cost is O(wet surface particles × neighbors) per step, and only while wet.

## Painting shape

The brush deposits matter as child points of the object being painted. Wet material such as clay is soft and slumps under gravity; once dry it becomes rigid.

## Three ways to paint a crack

1. **Describe it:** a state key, "there is a crack here."
   - If it's part of the object's initial state, it is a description and needs no cause.
   - If the object was known to be intact before, it is an **unexplained change**, and the engine asks what cracked it. This follows from principles 2 and 5 with no special handling.
2. **Paint the predisposition:** a flaw, or a `toughness` map. Nothing happens until stress arrives, and then the crack **emerges** from the flaw.
3. **Paint an expectation:** "a crack here at tick 40," which the simulation must then produce from causes. This requires a tolerance (see Open).

## Decision: fracture by bonds (peridynamics)

**Chosen over pre-fractured Voronoi pieces**, which can't respond to painted flaws.

- Simulation particles are connected to their neighbors by **bonds**. Bonds are links in our model, computed once when the shape is created.
- A bond **breaks when stretched past its strength**. A crack is a line of broken bonds, and a piece is a connected group of particles.
- Painted `toughness` sets bond strengths, so painted flaws really do decide where it breaks.
- Visual splats ride on their simulation particles into the shards. Splats lying across a crack are split or shrunk along it.
- Hairline cracks are broken bonds that haven't separated yet. A rendering style can draw them.
- **Cost:** about 3,000 particles × 30 bonds gives ~10⁵ bond checks per step, and only while the object is under stress. Otherwise it sleeps.
- **Shards become new child points** (such as `mug/shard-3`), created by the fracture rule and traced back to its cause.

## Open

- **Tolerance on state keys about emergent results:** how close counts as satisfied?
- **Promoting an overlay to a new shared asset**, as in "save this painted mug as a new kind of mug."
- **Stable identity for points created by rules.** Which shard is "the piece with the handle" after an edit upstream changes how the mug breaks? Leading idea, from the generative-vectors spikes: IDs are structural paths, never counters, and a piece is named by the stable things it contains (such as the part `handle`).
