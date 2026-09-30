---
spike: 018
idea: generative-vectors
name: strokes-as-seeds
type: standard
validates: "Given pen strokes recorded as data-drawing action lists (integer samples on a recorded plane frame, a brush per stroke), when they are fitted into a generative-vector description (ink → stems, lead → anchors, clay → mass, rust → knots) and grown and surfaced, then a few strokes give a legible 3D form that follows the drawing, the pipeline is deterministic from actions to mesh, earlier strokes' seeds never change when strokes are added, and pen-up to surface is interactive"
verdict: VALIDATED
related: [015, 017]
tags: [strokes, pen, data-drawing, seeds, fitting, generative]
---

# Spike 018: Pen Strokes as Seeds

## What This Validates

Given pen strokes recorded as data-drawing action lists (integer samples on
a recorded plane frame, a brush per stroke), when they are fitted into a
generative-vector description and grown (015) and surfaced (017), then:

- a few strokes give a legible 3D form that follows the drawing
- the pipeline is deterministic from actions to mesh
- earlier strokes' seeds never change when strokes are added
- pen-up to surface is interactive

This is section 5 of Kaelen's note (painting as structural input), and the
first step of its neural half: here the "inference" from strokes to structure
is an explicit fitter, not a learned model.

## Research

**The input is data-drawing's, unchanged** (`origin/data-drawing`,
`sim/include/ddsim/action.hpp`, `state.hpp`, `presets.hpp`). An action list
of `DefineBrush`, `StrokeBegin` (with the stroke's plane frame: origin, right
and up as i32 Q16.16), `StrokeSamples` (tick, index, u16 pressure, Q16.16
u/v, tilt, twist) and `StrokeEnd`. A sample's point is
`origin + u·right + v·up`, so strokes on different planes are already 3D
(CANV-01). Pressure goes through the brush's 17-knot curve, the identity
curve for all four presets, as `emit.hpp` does. The spike reads the JSON form
of these fields; reading the byte grammar is mechanical.

| Fitting approach | Pros | Cons | Status |
|---|---|---|---|
| Ramer–Douglas–Peucker simplification into a chain of seed vectors | Exact ops, deterministic, a tolerance with a meaning (the largest distance from a sample to the chain) | Stroke direction is growth direction (draw root to tip) | **Chosen** |
| Curve fitting (Bézier or spline seeds) | Smoother | The grower takes straight seed vectors | Not needed |
| A learned model | The note's eventual inference step | Needs data; this spike makes the data path | Deferred |

The brush decides a stroke's role:

| Brush | Role |
|---|---|
| ink | A **stem**: seed vectors that grow, radius from pressure. |
| lead (heaviest) | An **anchor**: the same chain with `grow: false`, so growth avoids it. |
| clay | **Mass**: every 6th sample is an attractor, weighted by pressure. |
| rust | A **drawn relationship**: its two ends pick the nearest stems, and every seed of each stroke gets an attract knot to the other. |

## How to Run

```bash
cd .planning/spikes && npm install
node 018-strokes-as-seeds/check.mjs              # determinism, fidelity sweep, stable ids, edit reach → results/check.json
node 015-generative-vectors/serve.mjs            # then open /018-strokes-as-seeds/index.html
```

On the page: pick a brush and a plane, then draw with a pen or mouse. Pen
pressure and tilt are recorded when the device reports them. Every pen-up
refits, regrows and resurfaces. **Undo stroke** and **Export actions**
(data-drawing's action list as JSON) are there; sessions `sapling`,
`lantern` and `blank` load from the menu.

## Investigation Trail

1. **End to end on the first try.** For `sapling` (6 strokes, 600 samples,
   62 KB of actions): fit in about 4 ms, grow in about 25–40 ms, surface in
   about 0.2 s.
2. **The drawing path is real.** Strokes drawn on a blank canvas with
   pointer events (captured through coalesced events, quantized once to
   Q16.16, plane frame recorded) were exported and replayed in Node, and gave
   the **same vector and mesh hashes** as the browser.
3. **Fidelity: the first tolerance lost the drawing.** At 0.18 units a gently
   curved trunk became one straight seed. The sweep (`results/check.json`)
   shows how far drawn samples lie from the fitted chain:

   | Tolerance | sapling seeds | Worst / mean distance | lantern seeds | Worst / mean distance |
   |---:|---:|---|---:|---|
   | 0.02 | 16 | 0.019 / 0.006 | 53 | 0.020 / 0.006 |
   | **0.05** | **9** | **0.041 / 0.015** | **35** | **0.048 / 0.010** |
   | 0.18 | 5 | 0.148 / 0.056 | 18 | 0.178 / 0.051 |
   | 0.3 | 4 | 0.186 / 0.081 | 12 | 0.266 / 0.147 |

   0.05, about one surface voxel, is now the default. The curved trunk
   survives.
4. **Stable ids.** Adding a stroke leaves every earlier seed bit-identical,
   because seed ids are `s<stroke>.<segment>`, as data-drawing's node ids
   are.
5. **Edit reach: through relationships only.** Moving stroke 2 in `sapling`
   changed 177 of 181 vectors, 132 of them grown from other strokes. That
   looked like a leak, so a control followed: moving a stroke that touches
   nothing changes **0 vectors outside it**, both 9 units away and 3.2 units
   away. Stroke 2 changed the rest because it's genuinely connected: it
   starts on the trunk, and a rust knot ties it to stroke 3. Removing the
   rust stroke drops its knots (3 → 0) and regrows most of the object, as it
   should.
6. **Looked at it.** `sapling` keeps the drawn S-curve trunk, the limbs
   follow their strokes, the crown reaches toward the clay cloud, and the
   lead ground line fillets into the trunk. `lantern` (strokes on front,
   side and top planes) is a genuinely 3D woven cage on a ring. The ring is
   lumpy because its drawn pressure varies. Radius from pressure is honest to
   the pen, but anchors may want a steadier radius.

## Results

**VALIDATED**, with Kaelen's hand check on drawing with a real pen still to
do (pressure and tilt from a real device, and whether the roles feel right).

| Session | Strokes / samples | Actions | Seeds / knots / attractors | Vectors (L4) | Triangles | Pen-up: fit · grow · surface |
|---|---|---:|---|---:|---:|---|
| sapling (1 plane) | 6 / 600 | 62 KB | 9 / 6 / 24 | 361 | 127k | 3.9 · 38 · 194 ms |
| lantern (3 planes) | 7 / 744 | 77 KB | 35 / 16 / 0 | 739 | 266k | 0.5 · 65 · 412 ms |
| drawn with the pointer | 4 / 112 | 13 KB | 5 / 4 / 0 | 181 | — | 2.2 · 8 · 289 ms |

**Signal for the build**

- **data-drawing's action list is a sufficient input,** with no new fields.
  The plane frame per stroke gives 3D, pressure gives radius, and the brush
  gives the role. A Data Drawing session can be a generative-vector
  description.
- **Fit at a tolerance of about one voxel (0.05).** Coarser flattens what
  was drawn.
- **Ids from the stroke ordinal** keep earlier strokes' seeds stable, so a
  stroke is an editable object, as data-drawing intends.
- **An edit reaches exactly what's related to it:** knots and proximity. For
  local edits, keep strokes unrelated or give knots a reach.
- **A brush's description is the role today.** A real build wants the role
  as an explicit brush-version property, since brush descriptions are free
  text in data-drawing.
- **Next:** a learned model that proposes knots and roles from strokes (the
  neural step), strokes from two views fused into one 3D stem, and reading
  the byte grammar directly.
