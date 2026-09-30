---
spike: 019c
idea: generative-vectors
name: monotone-alignment
type: comparison
validates: "Given a front and a side ink stroke of one stem (data-drawing action lists), when they are aligned monotonically on the shared axis (dynamic time warping), paired automatically, fitted as seeds, grown and surfaced, then the 3D stem matches the true curve, pairs are found, and the pipeline is deterministic and interactive"
verdict: WINNER
related: [019a, 019b, 018, 015, 017]
tags: [two-view, fusion, sketch, strokes, dtw, pairing]
---

# Spike 019c: Monotone Alignment on the Shared Axis

## What This Validates

Given a front and a side ink stroke of one stem (data-drawing action lists),
when they are aligned monotonically on the shared axis, paired
automatically, fitted as seeds, grown and surfaced, then the 3D stem matches
the true curve, pairs are found, and the pipeline is deterministic and
interactive.

## How It Works

The code is in `../019-shared/`: `fuse.mjs` (the shared axis, the three
fusion methods, pairing), `session.mjs` (a whole session: pairs fused,
everything else fitted as in spike 018), `check.mjs` (ground truth) and
`index.html` (drawing in two views).

1. **The shared axis** of two stroke planes is the cross product of their
   normals, pointed the way a person reads it (+y for front and side). Each
   view gives, per sample, the shared coordinate `s` and its own offset `e`
   along the in-plane direction perpendicular to the axis. A point is
   `s·axis + e_front·own_front + e_side·own_side`, which assumes the planes
   are perpendicular.
2. **Direction.** If one stroke runs the other way along the axis, it's
   reversed first. That's detected, and the fused stem matches the one-way
   stroke (worst 0.014).
3. **Alignment.** Dynamic time warping over the two sample sequences.
   - The cost is `(Δs / span)² + λ²·(Δarc fraction)²` with λ = 0.25; the
     small arc-length term breaks ties on flat runs.
   - Backtracking prefers the diagonal, then advancing the front, then the
     side, which makes it deterministic.
   - Each path step gives a 3D point, and consecutive duplicates are
     dropped.
4. **Mismatch.** The mean |Δs| along the path needs no ground truth. It's
   the agreement between the two views.
5. **Pairing.** Candidates are ink strokes on planes that share an axis, with
   height ranges overlapping by at least 50% (intersection over union).
   Fuse each candidate and pair the **lowest mismatch first**.
6. **Seeds.** Simplify the fused points at tolerance 0.05 (as in spike 018).
   Seeds are named `s<a>+<b>.<k>` after the pair, so they stay stable as
   strokes are added.

## How to Run

```bash
node .planning/spikes/019-shared/check.mjs               # ground truth, pairing, pipeline → results/check.json
node .planning/spikes/015-generative-vectors/serve.mjs   # then open /019-shared/index.html
```

Draw a stem in the front view and again in the side view (same height).
The 3D view shows both strokes on their planes, the fused stem in white, and
the grown surface. The method and pairing rule can be switched live.

## Investigation Trail

1. **Ground truth.** Five known 3D curves were drawn as front and side
   strokes, with spike 018's pen model: 120 samples/s, pressure ramp, hand
   wobble, Q16.16 quantization. Alignment's worst distance to the true curve
   is at most 0.047 on every curve, about the wobble plus the fitting
   tolerance. Height matching fails on the hook (0.53), and arc length on
   the helix (0.11); see 019a and 019b.
2. **Pairing by drawing order is fragile.** It works when each stem's views
   are drawn back to back, and gets **0/3** once the side views come in a
   different order.
3. **Pairing by overlap got lucky.** 3/3 on shuffled sides only because the
   stems' heights differed by about 7%. With identical heights it got 1/3.
4. **Mismatch is a pairing signal.** Right pairs scored 0.007, wrong pairs
   0.015–0.037. Pairing lowest mismatch first gets **3/3 in every case the
   strokes can decide**: shuffled, different heights, and identical heights
   with different profiles.
5. **The truly ambiguous case.** Identical heights and identical linear
   profiles give every pairing the same mismatch, and it got 1/3 (chance).
   Nothing in the strokes links them, so this has to come from the
   interface: draw a stem's views back to back, or link them explicitly.
6. **The whole pipeline.** Helix + hook: 2 fused stems → 20 seeds → 900
   vectors (level 4) → a watertight surface. Fuse and fit take 2 ms, growth
   78 ms, the surface 0.27–0.29 s, and it's deterministic.
7. **Drawn by pointer.** An S drawn in front and a curve drawn from the
   side, both through real pointer events, fuse into a leaning 3D S-stem.
   Replayed in Node from the exported actions, it gives **identical vector
   hashes**.

## Results

**WINNER.** Measured in Node 22 on a 4-core Xeon @ 2.1 GHz:

| Curve | 019a height (worst) | 019b arc (worst) | **019c align** (mean / worst) | Mismatch |
|---|---:|---:|---:|---:|
| lean | 0.014 | 0.019 | 0.008 / 0.015 | 0.009 |
| helix | 0.018 | 0.108 | 0.009 / 0.023 | 0.009 |
| hook | 0.527 | 0.097 | 0.010 / 0.045 | 0.012 |
| flat run | 0.105 | 0.149 | 0.016 / 0.044 | 0.009 |
| uneven pace | 0.014 | 0.032 | 0.009 / 0.047 | 0.016 |

| Pairing case | By order | By overlap | **By mismatch** |
|---|---:|---:|---:|
| each stem's views back to back | 3/3 | 3/3 | — |
| all fronts, then sides in the same order | 3/3 | 3/3 | — |
| sides shuffled | 0/3 | 3/3 | 3/3 |
| sides shuffled, different heights | 3/3 | 3/3 | 3/3 |
| identical heights, different profiles | 0/3 | 1/3 | **3/3** |
| identical heights, identical profiles (ambiguous) | 0/3 | 1/3 | 1/3 |

**Signal for the build**

- **Fuse two views by monotone alignment on the shared axis,** never by
  height lookup or arc length. Drawing order along a stem is the one thing
  both views agree on.
- **Pair by mismatch,** and show the proposed pairs, because some sets are
  genuinely ambiguous. The interface should let the artist see and change
  them. Drawing a stem's views back to back is the convention to teach.
- **Show the mismatch while drawing.** It needs no ground truth and says how
  well the two views agree.
- **Limits:** assumes perpendicular planes through a shared axis, and
  alignment is O(n·m) (about 100×100 samples here, well under 20 ms). Long
  strokes want a band-limited alignment.
- **Next:** fuse more than two views, a learned model that proposes pairs
  and roles, and branch points drawn in two views (where a limb leaves a
  fused stem).
