---
spike: 020
idea: generative-vectors
name: multi-view
type: standard
validates: "Given strokes of one stem drawn in any number of views (front, side, top, oblique planes), when every view is added as more data to one least-squares solve along a common parameter, then each added view keeps or improves accuracy against ground truth, oblique planes work, a sloppy view is down-weighted, adding a view later only refines the stem, and strokes are grouped into stems automatically"
verdict: VALIDATED
related: [019c, 018, 015, 017]
tags: [multi-view, fusion, least-squares, robust, sketch, strokes]
---

# Spike 020: Many Views, One Stem

## What This Validates

Kaelen: "combining additional views should just add more to the data."
Given strokes of one stem drawn in any number of views, when every view is
added as more data to one least-squares solve, then:

- each added view keeps or improves accuracy
- oblique planes work
- a sloppy view is down-weighted
- adding a view later only refines the stem
- strokes are grouped into stems automatically

## How It Works

The code is `multiview.mjs` (the solve), `group.mjs` (which strokes are one
stem), `session.mjs` (a whole session) and `index.html` (four drawing views
and 3D).

1. **A view is a constraint.** A stroke on a plane (origin O, right R, up U)
   says the stem's point P projects to its sample: `R·(P−O) = u`,
   `U·(P−O) = v`.
2. **One weighted 3×3 least-squares solve per point:**
   `(Σ w (RRᵀ + UUᵀ)) P = Σ w (R(u + R·O) + U(v + U·O))`, by Cramer's rule
   (exact ops). Any plane orientation works. Two perpendicular views give
   019c's point, with no special case.
3. **The common parameter** comes from the best-conditioned pair (the most
   perpendicular planes, with normals normalised first). They're aligned on
   their shared axis as in 019c, one parameter step per path step. A later
   pair takes over only if it's better by more than 0.05, so the parameter
   doesn't change as views are added.
4. **Each further view** is aligned in 2D (monotone dynamic time warping,
   either direction) to the current estimate projected into its plane, and
   adds its observations. Every round re-aligns all views to the refined
   estimate.
5. **Weights come from an absolute drawing tolerance** τ = 0.1 (world
   units): `w = min(1, (τ / residual)⁴)`, over 4 rounds. Views within
   tolerance count equally.
6. **Grouping grows stems.** Start from the best remaining pair (lowest 019
   mismatch), attach every free stroke whose 2D residual against the stem's
   projection is within 0.3 (best first, re-fusing each time), and repeat. A
   stroke that fits nothing stays a single planar stem (018).

## How to Run

```bash
node .planning/spikes/020-multi-view/check.mjs          # ground truth → results/check.json
node .planning/spikes/015-generative-vectors/serve.mjs  # then open /020-multi-view/index.html
```

Draw a stem in any of the four views: front, side, top, and a 45° oblique.
Each view shows the fused stem projected into it as a grey band, so you can
see where to draw next and whether a stroke agrees. The HUD lists each stem's
views with their residual and weight.

## Investigation Trail

1. **The test hand drifts.** A human's error is slow drift, so every
   synthetic stroke gets a smooth offset of ±0.06 (frequency and phase from
   the stroke id) on top of spike 018's wobble. Without drift, more views
   barely matter.
2. **With the first version, more views helped on average**
   (0.060 → 0.045 → 0.041 → 0.040), but not on every curve.
3. **Drift-free control:** every added view helps every curve
   (0.009 → 0.006 → 0.0055 → 0.0048). The solver is sound; the reversals came
   from weighting.
4. **Surprise: quantized frames re-seeded the stem.** Q16.16 plane frames
   aren't exactly unit, so an oblique pair scored "perpendicularity"
   1.000001, beat front + side's exact 1, and silently became the starting
   pair when it was added. The parameter changed from 96 to 102 steps, so
   adding a view didn't just refine. Normalising the normals and making the
   pair sticky fixed it: 96 steps at every view count.
5. **Weighting, five tries:**

   | Rule | Good views only (3 → 5 views) | + one 5×-sloppy view |
   |---|---|---|
   | `1/(residual² + σ₀²)` | 0.048 → 0.041, **worse than equal weights**: chases noise | 0.043–0.069 |
   | full weight up to 2× the median | = equal weights | **masked**: the sloppy view pulled the solve toward itself and kept 19–25% |
   | leave-one-out residual vs 2× median | = equal weights | **masked**: every view's leave-one-out solve still contained the sloppy one, and all weights stayed 25% |
   | `min(1, (median/residual)²)` | **0.057**: always drops a good view when there are 3 | sloppy view at 1–3% |
   | **`min(1, (τ/residual)⁴)`, τ = 0.1** | **= equal weights** | **sloppy view at 1.6–3.9%, within 0.001–0.006 of the 3 good views alone** |

   Measured residuals explain it. Among good views the largest reached 1.72×
   the median, while a sloppy view sat as low as 1.42×, so relative rules
   can't separate them. In absolute terms they don't overlap: good ≤ 0.087,
   sloppy ≥ 0.124. The drawing tolerance is a physical quantity, like 018's
   fitting tolerance.
6. **Grouping over-split at first.** Pairing everything first turned one
   stem's four views into two pairs. Growing stems from the best pair fixed
   it: two stems × four views drawn shuffled came out as 2 pure groups of 4.
7. **Grouping reach vs tolerance.** At a reach of 0.15 the sloppy view was
   left out and grew as its own flat stem. A reach of 0.3 lets it join, and
   weighting decides: sloppy views sit at 0.19–0.23 from their stem, other
   stems' strokes at 2.4–2.7.
8. **Oblique planes.** A 45° plane and a 30° tilted plane alone give mean
   0.08–0.13 (worst 0.40 on the helix). They meet at a shallower angle, so
   depth is less well conditioned. Adding the side view brings it to
   0.045–0.069, so the solve works for any planes.
9. **Drawn by pointer.** One S-stem drawn in front, side and top views:
   the third view changed the stem (it's data), and the Node replay gave
   **identical vector hashes**.

## Results

**VALIDATED.** Mean distance to the true curve, averaged over 5 curves,
with hand drift ±0.06:

| Views | Robust (τ) | Equal weights | 1/residual² | No hand drift |
|---:|---:|---:|---:|---:|
| 2 (front, side) | 0.060 | 0.060 | 0.060 | 0.009 |
| + top | **0.042** | 0.042 | 0.048 | 0.006 |
| + 45° oblique | **0.037** | 0.037 | 0.043 | 0.005 |
| + 30° tilt | **0.035** | 0.035 | 0.041 | 0.005 |

- **Adding a view refines:** the stem moves 0.019–0.037 on average per added
  view, and the parameter never changes.
- **A sloppy view** (5× drift): with equal weights, error nearly doubles
  (0.058 → 0.107 on the lean curve). With robust weights it gets
  1.6–3.9% and stays within 0.001–0.006 of the 3-good result.
- **Grouping:** 2 stems × 4 views drawn shuffled become 2 pure, complete
  groups.
- **Cost:** fuse and fit take 125 ms for 4 views and 270 ms for 8 strokes in
  2 stems. Grouping re-fuses after each attached stroke; incremental updates
  would cut that.

**Signal for the build**

- **A view is data.** One least-squares solve over every view's
  observations, along a parameter fixed by the best-conditioned pair. No
  special cases, any plane orientation, and adding a view refines the stem.
  This matches data-drawing's append-only log: a view drawn later is one more
  commit that sharpens the stem.
- **Weight views by an absolute drawing tolerance,** never relative to the
  other views. With only a few views an outlier hides behind the median.
- **Normalise anything derived from Q16.16 frames** before comparing, and
  make "which pair seeds the stem" sticky.
- **Group generously (0.3) and weight strictly (0.1).** Leaving a stroke out
  turns it into its own stem; including it lets the weights handle it.
- **Show the stem projected into every view.** It tells the artist where
  the next stroke should go and how well each stroke agrees.
- **Next:** incremental grouping, branch points drawn across views (where a
  limb leaves a stem), and the drawing tolerance as a per-artist or per-pen
  setting.
