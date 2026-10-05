# 0003 — Neighborhoods and conflicts

**Date:** 2026-10-05
**Status:** Conflicts decided. Neighborhood architecture **proposed**, pending review.
**Spec impact:** §9 note on dismissal. Open questions §12.3 and §12.4 now point here.

## Questions

1. What does "competing causes" mean, when overlapping causes happen all the time?
2. How does a rule like "big things crush little things" find the points it applies to? Is it an ECS query?
3. When a rule says two things overlap, which shape counts: the body, or one of its auras?
4. Which algorithms are available, and what do they cost?

## Decisions: combining and conflicts

- **Overlapping causes combine.** Two forces on the same thing at the same moment add together. That is normal and is not reported.
- **Incompatible causes or states are conflicts.** Examples are two keys setting different values at the same instant, or two solids asserted into the same space. A conflict is shown as an error.
- **Conflicts can be dismissed**, like telling a spellchecker a word is fine. *(User decision.)*
- *(Proposed)* **A dismissal is itself a key.** It persists, replays and records who dismissed it.
- *(Proposed)* **The world always keeps running.** Each property declares how effects on it combine: increments and forces **add**, while direct sets use a deterministic tie-break, such as the later key wins. Conflicts are reported next to the result and never stop the simulation.

## Proposal: neighborhood architecture

### Rules declare a filter and a relation

```
rule crush
  A: has size, size > big            ← filter (properties)
  B: has size, size < small
  relation: A.body overlaps B.body   ← relation (spatial or structural)
  effect:   B.intact = false
```

### Storage: sparse-set ECS

- **One column per property**, mapping point ID to value. Adding or removing a property is O(1), which suits open-ended properties that change often.
- **A filter query** intersects columns by iterating the smallest one and checking membership in the others in O(1).
- **Value conditions** (`size > big`) are either a scan of the matches, a sorted index for properties that rules query often (O(log n + k)), or a derived property kept up to date by a rule.
- **Archetype ECS is rejected for the core.** With open, frequently changing properties, entities would constantly move between tables and the data would fragment into many small ones.

### The rule names which extent overlaps

A point has several extents: its body and any number of auras. "Overlaps" is ambiguous until the rule names one, for example `A.body`, `A.fear` or `A.light`. Each property used for overlap testing (an **overlap channel**) gets its own spatial index, the same idea as collision layers in game physics.

### Relation kinds, from cheapest to most expensive

| Relation | Cost | Used for |
|---|---|---|
| **Implicit grid adjacency** | O(1) per neighbor | cells in a field (water, heat, dread) |
| **Links** (parent, children, explicit connections) | O(number of connections) | structural meaning: "holds", "fears", bristle to neighboring bristle |
| **Spatial index** | O(log n + k) per query | genuine geometric overlap between entities |

Rules should use the cheapest relation that fits their meaning.

### Spatial indexing

- **A dynamic BVH per frame**, indexing that frame's children by their subtree bounds. The point hierarchy already forms a bounding hierarchy. Queries run in local coordinates and climb to a common ancestor only to cross frames, so a crumb is never tested against a galaxy.
- **One index per overlap channel.**
- **Large, soft auras become field grids**, not shapes. A point samples the field value where it is, in O(1), instead of being paired against the aura.
- **Shapes are tested from coarse to fine:** point bounds, then part bounds, then splats or a collision proxy.
- **Points with nothing acting on them are not re-tested**, like sleeping bodies in physics engines. A step costs about O(a log n + k), where *a* is the number of active points.
- **Candidate pairs are sorted by ID before effects are applied** (O(k log k)), because traversal order isn't guaranteed stable.

### Algorithms considered

*n* = points in the index, *k* = overlapping pairs or results.

| Algorithm | Build / update | Query, or find all pairs | Notes |
|---|---|---|---|
| Brute force | none | O(n²) | fine up to about a thousand points |
| Sweep and prune | O(n log n), then about O(n) per step | about O(n + k) | degrades when objects line up on the sort axis |
| Uniform grid / spatial hash | O(n) | O(n + k) average | breaks when sizes vary widely |
| Hierarchical grid | O(n) | O(n + k) average | handles a wide range of sizes |
| Loose octree | O(n log n) | O(log n + k) | adapts to clustered scenes |
| **Dynamic BVH** | O(log n) per change | O(log n + k), all pairs O(n log n + k) | **chosen**; handles mixed sizes and motion |
| k-d tree | O(n log n) | O(log n) nearest neighbor | only for points with no size |
| **Field grid** | O(cells) | O(1) per sample | **chosen for large, soft auras** |
| Barnes–Hut / fast multipole | O(n log n) / O(n) | all-to-all influence | long-range effects; deferred |

## Worked case: watercolor

Assumptions: 1,000 bristle points (100 bristles × 10 segments); paper at 2048² (4.2M cells); a stroke wets about 5%, so **about 200k cells** (about 200 tiles of 32×32) are awake.

| Interaction | Relation | Cost per step | Approx. operations |
|---|---|---|---|
| Brush and paper vs the world | BVH with a handful of entities | O(a log n + k) | tens |
| Bristle touching paper | BVH says brush overlaps paper; then convert into the paper's frame and compute a cell index | O(B × footprint) | ~10⁴ |
| Bristle against bristle | links | O(B × connections) | ~6×10³ |
| Cell to cell (flow, capillary, evaporation) | implicit grid | O(W × cost per cell) | ~3×10⁷ per substep |
| Tiles waking and sleeping | tile adjacency | O(T) | ~200 |

- The fluid grid is over 99% of the cost. The neighborhood machinery itself is close to free.
- Treating the paint as a million free splats with spatial-index lookups would cost about O(N log N) ≈ 2×10⁷ per step in queries alone, with scattered memory access. That is likely an order of magnitude or more slower than a grid stencil, and it would cost the same whether the paint was wet or dry.
- **Back-of-envelope timing (not a benchmark):**
  - about 150 floating-point operations and 70 bytes of memory traffic per cell per substep, with 5 substeps per frame;
  - for 200k wet cells, about 1.5×10⁸ operations and 70 MB of memory traffic per frame;
  - 8-core desktop CPU: **about 5–20 ms per frame**;
  - a wash over half the page: **about 100 ms per frame**;
  - phone or web: about 4–10× slower than desktop;
  - GPU: well under 1 ms.
- **Determinism constraints:**
  - Double-buffer every update (read the previous state, write a new copy) so cell and thread order can't change the result.
  - Global sums, if a rule ever needs them, use a fixed split into chunks combined in a fixed order, independent of thread count.
