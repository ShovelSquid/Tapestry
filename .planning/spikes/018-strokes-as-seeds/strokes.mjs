// Pen strokes, as data-drawing records them, fitted into a generative-vector
// description (spike 015): painting as structural input.
//
// Input is data-drawing's action list (sim/include/ddsim/action.hpp), in a
// JSON form with the byte grammar's fields:
//   DefineBrush   { brushVersionId, description, massRaw, radiusRaw, spacingRaw, curve[17] }
//   StrokeBegin   { strokeId, brushVersionId, startTick, pressureSource, plane[9] }  plane: origin, right, up as i32 Q16.16
//   StrokeSamples { strokeId, samples: [{ tick, index, pressure, u, v, tiltX, tiltY, twist, flags }] }  u, v as i32 Q16.16
//   StrokeEnd     { strokeId, endTick }
// A sample's 3D point is origin + u·right + v·up (data-drawing CANV-01: the
// plane is recorded per stroke, so strokes on different planes are 3D).
//
// The brush decides what a stroke means:
//   ink   a growing stem: simplified into a chain of seed vectors; pressure sets radius
//   lead  an anchor: the same chain with grow: false (structure growth avoids)
//   clay  mass: its samples become attractor points
//   rust  a relationship: from near one stem to near another is an attract knot
//
// Deterministic: samples are integers, Q16.16 → double is exact, and the
// fitting uses only + − × ÷ √ and fixed traversal orders. Seed ids are
// `s<stroke ordinal>.<segment>`, so a stroke's seeds keep their names when
// other strokes are added (data-drawing ids work the same way).

const Q = 65536
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.sqrt(dot(a, a))

// data-drawing's identity curve maps pressure p to about p / 65536 (emit.hpp).
function curveWeight(curve, p) {
  const i = p >> 12
  const frac = p & 4095
  const value = curve[i] + Math.floor(((curve[i + 1] - curve[i]) * frac) / 4096)
  return value / 65536
}

export const ROLES = { ink: 'stem', lead: 'anchor', clay: 'mass', rust: 'knot' }

// Reads an action list into strokes, the way the sim's state would hold them.
export function readActions(actions) {
  const brushes = new Map()
  const strokes = new Map()
  for (const a of actions) {
    if (a.kind === 'DefineBrush') brushes.set(a.brushVersionId, a)
    else if (a.kind === 'StrokeBegin') {
      const p = a.plane.map((x) => x / Q)
      strokes.set(a.strokeId, { id: a.strokeId, brush: brushes.get(a.brushVersionId), origin: p.slice(0, 3), right: p.slice(3, 6), up: p.slice(6, 9), samples: [], ended: false })
    } else if (a.kind === 'StrokeSamples') strokes.get(a.strokeId).samples.push(...a.samples)
    else if (a.kind === 'StrokeEnd') strokes.get(a.strokeId).ended = true
  }
  return [...strokes.values()].filter((s) => s.ended).sort((a, b) => a.id - b.id)
}

export function points(stroke) {
  const out = []
  for (const s of stroke.samples) {
    const p = add(stroke.origin, add(mul(stroke.right, s.u / Q), mul(stroke.up, s.v / Q)))
    const w = curveWeight(stroke.brush.curve, s.pressure)
    if (out.length && len(sub(p, out[out.length - 1].p)) === 0) continue
    out.push({ p, w })
  }
  return out
}

export function distToSegment(p, a, b) {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0
  return len(sub(p, add(a, mul(ab, t))))
}

// Ramer–Douglas–Peucker with an explicit stack: the indices of the points
// kept, in order. Ties keep the first farthest point, so it's deterministic.
export function simplify(pts, tolerance) {
  if (pts.length < 3) return pts.map((_, i) => i)
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let far = -1, d = tolerance
    for (let i = a + 1; i < b; i++) {
      const di = distToSegment(pts[i].p, pts[a].p, pts[b].p)
      if (di > d) { d = di; far = i }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]) }
  }
  const out = []
  keep.forEach((k, i) => k && out.push(i))
  return out
}

// options: tolerance (simplification, world units; 0.05 keeps every drawn
// sample within ~0.05 of the fitted chain, about one surface voxel, where 0.18
// flattened a curved trunk into one straight seed), radius (per unit pressure),
// minRadius, rules (grower overrides), knotReach (how near a rust end must
// be to a stem), massEvery (keep every Nth clay sample).
export function fitStrokes(actions, {
  tolerance = 0.05, radius = 0.32, minRadius = 0.035, knotReach = 1.2, massEvery = 6, massWeight = 0.25,
  rules = { branching: [2, 3, 2, 2, 2, 2], lenRatio: 0.66, spread: 0.85, repel: 1.0 },
} = {}) {
  const strokes = readActions(actions)
  const seeds = []
  const attractors = []
  const knotStrokes = []
  const fit = { strokes: strokes.length, samples: 0, byRole: {} }
  for (const [ordinal, s] of strokes.entries()) {
    const role = ROLES[s.brush.description] || 'stem'
    fit.byRole[role] = (fit.byRole[role] || 0) + 1
    fit.samples += s.samples.length
    const pts = points(s)
    if (pts.length < 2) continue
    if (role === 'mass') {
      pts.forEach((q, i) => { if (i % massEvery === 0) attractors.push({ p: q.p, w: massWeight * q.w }) })
      continue
    }
    if (role === 'knot') { knotStrokes.push({ from: pts[0].p, to: pts[pts.length - 1].p, w: pts.reduce((m, q) => m + q.w, 0) / pts.length }); continue }
    const kept = simplify(pts, tolerance)
    for (let k = 0; k + 1 < kept.length; k++) {
      const a = pts[kept[k]].p, b = pts[kept[k + 1]].p
      const d = sub(b, a)
      const l = len(d)
      if (l === 0) continue
      let wsum = 0
      for (let i = kept[k]; i <= kept[k + 1]; i++) wsum += pts[i].w
      const w = wsum / (kept[k + 1] - kept[k] + 1)
      seeds.push({ id: `s${s.id}.${k}`, start: a, dir: mul(d, 1 / l), len: l, radius: Math.max(minRadius, radius * w), grow: role !== 'anchor', stroke: s.id })
    }
  }
  // A rust stroke joins the stems nearest its two ends (by seed order on ties).
  const stems = seeds.filter((x) => x.grow)
  const nearest = (p) => {
    let best = null, bd = knotReach
    for (const x of stems) {
      const d = distToSegment(p, x.start, add(x.start, mul(x.dir, x.len)))
      if (d < bd) { bd = d; best = x }
    }
    return best
  }
  const knots = []
  for (const k of knotStrokes) {
    const a = nearest(k.from), b = nearest(k.to)
    if (!a || !b || a.stroke === b.stroke) continue
    // Every seed of each joined stroke feels the other stroke's nearest seed.
    for (const x of stems.filter((y) => y.stroke === a.stroke)) knots.push({ from: x.id, to: b.id, type: 'attract', w: 1.6 * k.w + 0.4 })
    for (const x of stems.filter((y) => y.stroke === b.stroke)) knots.push({ from: x.id, to: a.id, type: 'attract', w: 1.6 * k.w + 0.4 })
  }
  fit.seeds = seeds.length
  fit.knots = knots.length
  fit.attractors = attractors.length
  return { description: { seeds, knots, attractors, rules, fanout: 64 }, fit }
}
