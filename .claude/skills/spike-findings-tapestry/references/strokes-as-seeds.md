# Pen Strokes as Seeds

## Requirements

- **Pen input is data-drawing's action list, unchanged:** `DefineBrush`, `StrokeBegin` (with a plane frame per stroke: origin, right and up as i32 Q16.16), `StrokeSamples` (tick, index, u16 pressure, Q16.16 u/v, tilt, twist) and `StrokeEnd` (spike 018).
- **The plane frame per stroke gives 3D:** a sample's point is `origin + u·right + v·up` (data-drawing CANV-01).
- **The brush decides the role:** ink → stem (grows), lead → anchor (`grow: false`), clay → mass (attractors), rust → knot (a drawn relationship) (spike 018).
- **Fit at a tolerance of about one surface voxel (0.05).** 0.18 flattened a drawn curve into one straight seed (spike 018).
- **Seed ids come from the stroke ordinal** (`s<stroke>.<segment>`), so adding strokes never changes earlier strokes' seeds (spike 018).

## How to Build It

The source is `sources/018-strokes-as-seeds/strokes.mjs` (the fitter), `sessions.mjs` (synthetic sessions) and `index.html` (drawing with capture).

1. **Capture as data-drawing's input fence does.**
   - Use pointer capture and coalesced events.
   - Ray-cast to the stroke's plane, and project onto `right` and `up` to get u and v.
   - Quantize once: u and v as `round(x·65536)`, pressure as `round(p·65535)`, tilt clamped to i8.
   - Stamp each sample with the tick and its index, and record the plane frame in `StrokeBegin`.
2. **Read** the actions into ended strokes, sorted by id. Pressure weight goes through the brush's 17-knot curve (`k[i] + floor((k[i+1] − k[i])·frac/4096)` over 65536; the identity curve gives about p/65536).
3. **Stems and anchors.** Drop consecutive duplicate points, then simplify with Ramer–Douglas–Peucker (explicit stack, ties keep the first farthest point). Each kept segment becomes a seed with id `s<stroke>.<k>`, start at the segment's start, unit direction, length, and radius `max(0.035, 0.32 × mean pressure weight)`. Anchors add `grow: false`.
4. **Mass.** Every 6th clay sample is an attractor with weight `0.25 × pressure weight`.
5. **Knots.** A rust stroke's first and last points each pick the nearest growing seed within 1.2 units. If they're on different strokes, every seed of each stroke gets an attract knot (weight `1.6 × mean pressure + 0.4`) to the other stroke's picked seed.
6. **Grow** with spike 015's grower. Pass `fanout: 64`, because drawings exceed 16 seeds; the default of 16 keeps every earlier hash. Then surface with spike 017.

## What to Avoid

- **A coarse simplification tolerance.** At 0.18 a curved trunk became one seed. Check the worst distance from any sample to its fitted chain.
- **Reading an edit's reach as a leak.** Moving a stroke changes exactly what's related to it (knots and proximity). A stroke that touches nothing moves without changing any other vector. For local edits, keep strokes unrelated or give knots a reach.
- **The brush's description as its role in a real build.** Descriptions are free text in data-drawing, so make the role an explicit brush-version property.
- **Radius from pressure for anchors.** Honest to the pen, but a varying pressure makes a lumpy ring. Anchors may want a steady radius.

## Constraints

| Session | Strokes / samples | Actions | Seeds / knots / attractors | Vectors (L4) | Pen-up: fit · grow · surface |
|---|---|---:|---|---:|---|
| sapling (1 plane) | 6 / 600 | 62 KB | 9 / 6 / 24 | 361 | 3.9 · 38 · 194 ms |
| lantern (3 planes) | 7 / 744 | 77 KB | 35 / 16 / 0 | 739 | 0.5 · 65 · 412 ms |

- Strokes drawn by pointer in Chromium and replayed in Node give identical vector and mesh hashes.
- Fidelity at tolerance 0.05: the worst distance from a sample to the chain is 0.041–0.048, and the mean 0.010–0.015.

## Origin

Synthesized from spike: 018.
Source files: `sources/018-strokes-as-seeds/`, and `sources/015-generative-vectors/gen.mjs` (with the `fanout` option).
