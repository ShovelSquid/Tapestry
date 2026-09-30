---
spike: 019a
idea: generative-vectors
name: height-matching
type: comparison
validates: "Given a front and a side ink stroke of one stem, when each front sample takes the side stroke's offset at the same height (the first crossing in drawing order), then the fused 3D stem matches the true curve"
verdict: INVALIDATED
related: [019b, 019c, 018]
tags: [two-view, fusion, sketch, strokes]
---

# Spike 019a: Matching by Shared Height

The classic orthographic reconstruction. For each front sample, find where
the side stroke reaches the same height, and take its depth there. All the
code is in `../019-shared/fuse.mjs` (`heightMatch`); the measurements are
in `../019-shared/results/check.json`.

## Results

**INVALIDATED** as the general method. It's the most accurate on stems that
only ever go up, and it breaks exactly where it was expected to:

| Curve | Mean / worst distance to the true curve |
|---|---|
| lean | 0.007 / 0.014 |
| helix | 0.008 / 0.018 |
| uneven pace | 0.007 / 0.014 |
| **hook** (turns back down) | 0.096 / **0.527**: every front sample on the way down takes the side stroke's *rising* crossing |
| **flat run** (sideways) | 0.026 / **0.105**: a level stretch in one view is a dwell in the other, and "the first crossing" is the wrong one |

Height is ambiguous wherever a stem isn't monotonic along the shared axis,
and real stems hook, droop and run sideways.
