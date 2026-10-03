# Two Views, One Stem — and Any Number of Views

## Requirements

- **Fuse two views of a stem by monotone alignment (dynamic time warping) on the shared axis.** Height lookup and arc-length correspondence break on hooks, flat runs and helices (spike 019).
- **Pair views by lowest alignment mismatch,** and show the proposed pairs so the artist can change them. Identical heights and identical profiles are ambiguous from the strokes alone (spike 019).
- **Everything unpaired is fitted as in spike 018;** fused seeds are named `s<a>+<b>.<k>` (spike 019).
- **Any number of views is more data in one least-squares solve per point,** along a parameter fixed by the best-conditioned pair, which stays fixed as views are added (Kaelen, 2026-09-30; spike 020).
- **Views are weighted by an absolute drawing tolerance** (τ = 0.1, falloff `min(1, (τ/residual)⁴)`), never relative to the other views; with few views an outlier masks itself (spike 020).
- **Strokes join a stem generously (reach 0.3) and are weighted strictly (0.1),** so a sloppy view is down-weighted rather than grown as its own stem (spike 020).

## How to Build It

The source is `sources/019-shared/fuse.mjs` (shared axis, the three fusion methods, pairing), `session.mjs` (a whole session) and `index.html` (drawing in two views).

1. **The shared axis** of two stroke planes is `normalize(cross(n₁, n₂))`, pointed toward +y (or +x or +z). Per sample, a view gives `s = p·axis` and `e = p·own`, with `own = cross(n, axis)`. A fused point is `s·axis + e₁·own₁ + e₂·own₂`, which assumes perpendicular planes. (Spike 020 generalises this with a least-squares solve over any number of views.)
2. **Direction.** If the two strokes run opposite ways along the axis, reverse one.
3. **Alignment.**
   - Cost is `((s₁ − s₂)/span)² + (0.25·(arc₁ − arc₂))²`, and the path is monotone, from the first sample to the last.
   - Backtracking prefers the diagonal, then the first view, then the second, so it's deterministic.
   - Drop consecutive duplicate points.
4. **Mismatch** = the mean |s₁ − s₂| along the path. It needs no ground truth: right pairs scored 0.007, wrong pairs 0.015–0.037.
5. **Pairing.** Candidates are ink strokes on planes that share an axis, with height ranges overlapping by at least 50% (intersection over union). Fuse each candidate and take the lowest mismatch first.
6. **Seeds.** Simplify the fused points at tolerance 0.05, as spike 018 does.

### Any number of views (spike 020)

The source is `sources/020-multi-view/multiview.mjs` (solve and weights), `group.mjs` (strokes into stems), `session.mjs`, `index.html` (drawing in front, side, top and oblique views).

1. **Seed the parameter from the best-conditioned pair** (most perpendicular planes), aligned as above. **Normalise the plane normals first** and **make the pair sticky.** Q16.16 frames aren't exactly unit: an oblique pair scored "perpendicularity" 1.000001, beat front + side's exact 1, and silently re-seeded the stem (96 → 102 steps) when it was added.
2. **Per parameter step, one least-squares solve** for the 3D point over every view's observations: each view constrains the point's in-plane coordinates. Any plane orientation works, so there are no special cases for oblique planes.
3. **Iteratively reweight by an absolute tolerance** (`fuseViews`, 4 rounds): realign each view to the current stem estimate, take its RMS residual, set its weight to `min(1, (τ/residual)⁴)` with τ = 0.1, and re-solve. Good views keep full weight (equal to unweighted); a 5×-sloppy view falls to 1.6–3.9%.
4. **Grouping:** grow stems from the best pair, then attach strokes whose distance to the stem is under 0.3. Pairing everything first over-split one stem's four views into two pairs. Re-fuse after each attached stroke; incremental updates would be faster.
5. **Show the stem projected into every view.** It tells the artist where the next stroke goes and how well each stroke agrees. A later view is one more data-drawing commit that sharpens the stem.

## What to Avoid

- **Height lookup** (019a): 0.53 worst on a hook and 0.105 on a flat run.
- **Arc-length correspondence** (019b): immune to drawing pace, but the projections spend their length differently: 0.108 on a helix, 0.149 on a flat run.
- **Pairing by drawing order alone:** 0/3 once side views come in a different order.
- **Pairing by overlap alone:** it got 1/3 with identical heights.
- **Relative weighting rules** (spike 020): `1/(residual² + σ₀²)` chases noise (worse than equal weights). "Full weight up to 2× the median" and leave-one-out against the median both *mask* a sloppy view (it keeps 19–25%). `(median/residual)²` always drops a good view when there are three. Among good views the largest residual reached 1.72× the median while a sloppy one sat as low as 1.42×, so relative rules can't separate them; in absolute terms they don't overlap (good ≤ 0.087, sloppy ≥ 0.124).
- **A tight grouping reach (0.15):** the sloppy view was left out and grew as its own flat stem.
- **Two oblique planes alone:** 45° + 30° tilt gives mean 0.08–0.13, worst 0.40 on the helix (poorly conditioned depth). Add a near-perpendicular view.

## Constraints

| Curve | Alignment: mean / worst distance to the true curve |
|---|---|
| lean | 0.008 / 0.015 |
| helix | 0.009 / 0.023 |
| hook | 0.010 / 0.045 |
| flat run | 0.016 / 0.044 |
| uneven pace | 0.009 / 0.047 |

- Pairing by mismatch: 3/3 when sides are shuffled, when heights differ, and when heights are identical but profiles differ. It got 1/3 (chance) with identical heights and identical profiles.
- Pipeline for helix + hook: 20 seeds → 900 vectors → a watertight surface. Fuse and fit 2 ms, grow 78 ms, surface about 0.28 s. A pointer-drawn stem replays in Node with identical hashes.
- Alignment is O(n·m), under 20 ms at about 100 samples. Long strokes want a band-limited alignment.

**Spike 020, mean distance to the true curve over 5 curves, hand drift ±0.06:**

| Views | Robust (τ) | Equal weights | 1/residual² | No hand drift |
|---:|---:|---:|---:|---:|
| 2 (front, side) | 0.060 | 0.060 | 0.060 | 0.009 |
| + top | **0.042** | 0.042 | 0.048 | 0.006 |
| + 45° oblique | **0.037** | 0.037 | 0.043 | 0.005 |
| + 30° tilt | **0.035** | 0.035 | 0.041 | 0.005 |

- Adding a view moves the stem 0.019–0.037 on average, and the parameter never changes.
- A 5×-sloppy view: equal weights nearly double the error (0.058 → 0.107 on the lean curve); robust weights keep it within 0.001–0.006 of the good views alone.
- 2 stems × 4 views drawn shuffled → 2 pure, complete groups.
- Fuse and fit: 125 ms for 4 views, 270 ms for 8 strokes in 2 stems.
- A pointer-drawn S-stem in three views replays in Node with identical vector hashes.
- Next steps named by the spike: incremental grouping, branch points drawn across views, and the drawing tolerance as a per-artist or per-pen setting.

## Origin

Synthesized from spikes: 019a, 019b, 019c, 020.
Source files: `sources/019-shared/`, `sources/019a-height-matching/`, `sources/019b-arc-length/`, `sources/019c-monotone-alignment/`, `sources/020-multi-view/`.
