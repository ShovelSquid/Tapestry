---
spike: 019b
idea: generative-vectors
name: arc-length
type: comparison
validates: "Given a front and a side ink stroke of one stem, when samples at the same fraction of each stroke's drawn length are paired, then the fused 3D stem matches the true curve"
verdict: INVALIDATED
related: [019a, 019c]
tags: [two-view, fusion, sketch, strokes]
---

# Spike 019b: Arc-Length Correspondence

Pair samples at the same fraction of each stroke's length, averaging the
shared coordinate. Code: `../019-shared/fuse.mjs` (`arcMatch`).

## Results

**INVALIDATED.** The hypothesis going in was that it would fail on strokes
drawn at different paces. It doesn't: arc length is independent of pace
(uneven pace: worst 0.032). It fails because **the two projections of one
curve spend their length in different places**:

| Curve | Mean / worst distance to the true curve |
|---|---|
| lean | 0.008 / 0.019 |
| **helix** | 0.042 / **0.108**: the side view is mostly sideways sweeps, the front mostly rise |
| **hook** | 0.032 / **0.097** |
| **flat run** | 0.029 / **0.149**: the front spends half its length on a run the side view barely shows |
| uneven pace | 0.013 / 0.032 |
