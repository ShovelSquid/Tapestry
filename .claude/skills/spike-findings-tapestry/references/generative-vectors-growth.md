# Generative Vectors: Growing Structure From Seeds

## Requirements

- **Store the rules, not the geometry:** a description is a few seed vectors, knots (relationships between seeds) and rules. Everything else is regrown (Kaelen's "Generative Vector Neural Rendering" note, 2026-09-30).
- **Deterministic:** the same description gives the same vectors, bit for bit. Only `+ − × ÷ √` (correctly rounded by IEEE 754) touch geometry. No `Math.sin/cos/pow/hypot`. Randomness is a hash of each vector's id (spike 015).
- **Additive:** growing level N+1 never moves anything in level N (spike 015).
- **Local:** detail grown in one region equals the whole expansion there, bit for bit (spike 015).
- **Ids are structural paths** (`trunk.2.0.1`), never counters, following data-drawing's STRK-03 (spike 015).
- **Any spatial index is checked against a brute-force reference** (spike 015).

## How to Build It

The source is `sources/015-generative-vectors/gen.mjs` (about 300 lines, no dependencies).

1. **A description** is `{ seeds: [{id, start, dir, len, radius, grow?}], knots: [{from, to, type: attract|repel|align, w}], attractors?: [{p, w}], rules }`. Each seed id must be unique, and there are at most 16 seeds.
2. **Growing a level.** For each parent (a vector at level L), create `branching[L]` children:
   - id = `parent.id + '.' + i`
   - the **last child continues the parent** and starts at its end; the others start along it at `t = 0.35 + 0.6 × (i + rand) / n`
   - direction = parent direction + a perpendicular chosen by hash × a spread slope, plus the parent's bend (`curvature`)
   - length = parent length × `lenRatio` × (0.8 + 0.4 × rand)
   - radius = parent radius × `radiusRatio`
3. **Relax only the new children**, for a fixed number of steps. Each step computes every child's force from the same state (Jacobi), then applies them all. The forces are:
   - repulsion from frozen vectors within `reach × len` (nearest point on each segment), and half as strong from siblings
   - alignment with frozen neighbours' mean direction
   - knots of the child's seed: attract toward, or repel from, the nearest point on the target seed; `align` adds the target's direction
   - attractor points
   - a constant `tropism` vector (light or gravity)
4. **Sum neighbour forces in order-key order.** The key is `(parent.order + 1) × 16 + child`, bijective base 16, unique across levels. That way a sum never depends on which index returned the neighbours.
5. **Freeze a level only when it's complete.** Insert all its children into the index after the whole level is built. Freezing each child as it's made makes the result depend on visiting order.
6. **Anchors** (`grow: false`) take part in the forces but never branch: a ground, a wall, a skeleton.
7. **Regional growth** (`expandRegion(desc, maxLevel, center, radius)`). With `need[max] = radius` and `need[k−1] = need[k] + (reach + 2) · maxLen[k]`, grow a parent's children only if its segment comes within `need[level+1] + maxLen[level+1]` of the centre.
8. **The spatial index** is one grid per level, each cell sized to that level's longest vector. Look up neighbours once per child, within `reach·len + len` of its start, because the child's end stays within one length of its start however it turns.

## What to Avoid

- **Grid cell keys past 2⁵³.** A key of `(x·2²¹ + y)·2²¹ + z` rounded, merged neighbouring cells, and made a query visit the same list twice: **forces were counted twice** with no error. Keep keys exact, for example `((x + 2¹⁶)·2¹⁷ + (y + 2¹⁶))·2¹⁷ + (z + 2¹⁶)`, and compare against brute force.
- **Growing with siblings visible mid-level** (freezing as you go): the result depends on visiting order.
- **L-systems**, because their children don't respond to neighbours or knots, and **full space colonization**, because every branch competes for the same points, so a region can't be grown alone.
- **Trusting a zero-mismatch comparison without a negative control.** No halo must make the locality check fail, and freezing mid-level must make the order check fail.

## Constraints

Measured in Node 22 on a 4-core Xeon @ 2.1 GHz:

| Description | Description size | Vectors at L4 / L7 | Compression at L7 | Whole expansion at L7 | Region vs whole at L7 |
|---|---:|---:|---:|---:|---:|
| tree (3 seeds, 2 knots) | 457 B | 363 / 3,765 | ×527 | 0.35–0.41 s | 1,463 / 3,765 |
| coral (5 seeds) | 530 B | 405 / 4,185 | ×505 | 0.6 s | 2,277 / 4,185 |
| bridge (3 seeds, 2 knots, 1 anchor) | 437 B | 189 / 1,701 | ×123 (L6) | 0.26 s | 1,511 / 1,701 |

- **Locality is paid for in force reach.** The halo is about (reach + 2) × segment length per level. On one tree that saves 2–3× at level 7; across a big scene it saves nearly everything. For cheap view-dependent detail, make reach shrink with depth.
- Chromium and Node hash the same, but both are V8, so this isn't proof across engines. If IEEE-restricted doubles ever disagree between engines, the fallback is data-drawing's fixed point (Q32.32 in `int64`).

## Origin

Synthesized from spike: 015.
Source files: `sources/015-generative-vectors/`. Screenshots and results stay in `.planning/spikes/015-generative-vectors/results/`.
