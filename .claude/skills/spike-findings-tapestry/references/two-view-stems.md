# Two Views, One Stem

## Requirements

- **Fuse two views of a stem by monotone alignment (dynamic time warping) on the shared axis.** Height lookup and arc-length correspondence break on hooks, flat runs and helices (spike 019).
- **Pair views by lowest alignment mismatch,** and show the proposed pairs so the artist can change them. Identical heights and identical profiles are ambiguous from the strokes alone (spike 019).
- **Everything unpaired is fitted as in spike 018;** fused seeds are named `s<a>+<b>.<k>` (spike 019).

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

## What to Avoid

- **Height lookup** (019a): 0.53 worst on a hook and 0.105 on a flat run.
- **Arc-length correspondence** (019b): immune to drawing pace, but the projections spend their length differently: 0.108 on a helix, 0.149 on a flat run.
- **Pairing by drawing order alone:** 0/3 once side views come in a different order.
- **Pairing by overlap alone:** it got 1/3 with identical heights.

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

## Origin

Synthesized from spikes: 019a, 019b, 019c.
Source files: `sources/019-shared/`, `sources/019a-height-matching/`, `sources/019b-arc-length/`, `sources/019c-monotone-alignment/`.
