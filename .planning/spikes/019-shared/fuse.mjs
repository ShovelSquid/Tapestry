// Two views, one stem: an ink stroke drawn on one plane and another drawn on
// a perpendicular plane, fused into one 3D polyline (spike 019).
//
// Two planes that are not parallel meet in a line; its direction is the
// axis both views share (front and side share "up"). Each view knows the
// shared coordinate plus one of its own; fusion decides which sample of one
// view goes with which sample of the other.
//
//   height (019a)   for each sample of A, the first point of B at the same shared coordinate
//   arc (019b)      samples at the same fraction of each stroke's drawn length
//   align (019c)    a monotone alignment (dynamic time warping) minimising the
//                   shared-coordinate mismatch, with a small arc-length term to
//                   break ties on flat runs
//
// Deterministic: exact ops, fixed tie-breaking, samples in drawing order.

import { points } from '../018-strokes-as-seeds/strokes.mjs'

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a) => Math.sqrt(dot(a, a))

// The axis two stroke planes share, or null when they're parallel.
export function sharedAxis(a, b) {
  const na = cross(a.right, a.up), nb = cross(b.right, b.up)
  const d = cross(na, nb)
  const l = len(d)
  if (l < 1e-9) return null
  let axis = mul(d, 1 / l)
  // Point it the way a person reads the shared direction (mostly +y, +x or +z).
  const k = Math.abs(axis[1]) >= Math.abs(axis[0]) && Math.abs(axis[1]) >= Math.abs(axis[2]) ? 1 : Math.abs(axis[0]) >= Math.abs(axis[2]) ? 0 : 2
  if (axis[k] < 0) axis = mul(axis, -1)
  return axis
}

// A view's samples as (shared coordinate s, its own offset e, weight),
// where own = the plane's in-plane direction perpendicular to the axis.
function view(stroke, axis) {
  const n = cross(stroke.right, stroke.up)
  const own = cross(n, axis) // in the plane, perpendicular to the shared axis
  return { own, pts: points(stroke).map((q) => ({ s: dot(q.p, axis), e: dot(q.p, own), w: q.w, p: q.p })) }
}

// Where along axis `s` does each view put its origin offset? A point is
// s·axis + eA·ownA + eB·ownB when ownA ⟂ ownB ⟂ axis.
const compose = (axis, A, B, s, eA, eB) => add(mul(axis, s), add(mul(A.own, eA), mul(B.own, eB)))

function cumulative(pts) {
  const out = [0]
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + len(sub(pts[i].p, pts[i - 1].p)))
  const total = out[out.length - 1] || 1
  return out.map((d) => d / total)
}

function heightMatch(axis, A, B) {
  const out = []
  for (const a of A.pts) {
    // first segment of B, in drawing order, that spans a.s
    for (let j = 0; j + 1 < B.pts.length; j++) {
      const b0 = B.pts[j], b1 = B.pts[j + 1]
      const lo = Math.min(b0.s, b1.s), hi = Math.max(b0.s, b1.s)
      if (a.s < lo || a.s > hi) continue
      const t = b1.s === b0.s ? 0 : (a.s - b0.s) / (b1.s - b0.s)
      out.push({ p: compose(axis, A, B, a.s, a.e, b0.e + (b1.e - b0.e) * t), w: (a.w + b0.w + (b1.w - b0.w) * t) / 2 })
      break
    }
  }
  return out
}

function arcMatch(axis, A, B) {
  const fa = cumulative(A.pts), fb = cumulative(B.pts)
  const out = []
  let j = 0
  for (let i = 0; i < A.pts.length; i++) {
    while (j + 2 < B.pts.length && fb[j + 1] < fa[i]) j++
    const t = fb[j + 1] === fb[j] ? 0 : Math.min(1, Math.max(0, (fa[i] - fb[j]) / (fb[j + 1] - fb[j])))
    const b0 = B.pts[j], b1 = B.pts[Math.min(j + 1, B.pts.length - 1)]
    const s = (A.pts[i].s + b0.s + (b1.s - b0.s) * t) / 2
    out.push({ p: compose(axis, A, B, s, A.pts[i].e, b0.e + (b1.e - b0.e) * t), w: (A.pts[i].w + b0.w) / 2 })
  }
  return out
}

function alignMatch(axis, A, B, { lambda = 0.25 } = {}) {
  const n = A.pts.length, m = B.pts.length
  const fa = cumulative(A.pts), fb = cumulative(B.pts)
  const span = Math.max(...A.pts.map((p) => p.s)) - Math.min(...A.pts.map((p) => p.s)) || 1
  const cost = (i, j) => {
    const ds = (A.pts[i].s - B.pts[j].s) / span
    const df = fa[i] - fb[j]
    return ds * ds + lambda * lambda * df * df
  }
  const D = new Float64Array(n * m)
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const c = cost(i, j)
    if (i === 0 && j === 0) { D[0] = c; continue }
    let best = Infinity
    if (i > 0 && j > 0) best = D[(i - 1) * m + j - 1]
    if (i > 0 && D[(i - 1) * m + j] < best) best = D[(i - 1) * m + j]
    if (j > 0 && D[i * m + j - 1] < best) best = D[i * m + j - 1]
    D[i * m + j] = c + best
  }
  const path = []
  let i = n - 1, j = m - 1
  while (true) {
    path.push([i, j])
    if (i === 0 && j === 0) break
    // ties prefer the diagonal, then advancing A, then B
    const diag = i > 0 && j > 0 ? D[(i - 1) * m + j - 1] : Infinity
    const up = i > 0 ? D[(i - 1) * m + j] : Infinity
    const left = j > 0 ? D[i * m + j - 1] : Infinity
    if (diag <= up && diag <= left) { i--; j-- } else if (up <= left) i--; else j--
  }
  path.reverse()
  return path.map(([a, b]) => ({
    p: compose(axis, A, B, (A.pts[a].s + B.pts[b].s) / 2, A.pts[a].e, B.pts[b].e),
    w: (A.pts[a].w + B.pts[b].w) / 2,
    mismatch: Math.abs(A.pts[a].s - B.pts[b].s),
  }))
}

export const METHODS = { height: heightMatch, arc: arcMatch, align: alignMatch }

// Fuses stroke a with stroke b. If b was drawn the other way along the shared
// axis, it's reversed first. Returns 3D points (with pressure weight) and the
// mean |shared-coordinate mismatch|, which needs no ground truth.
export function fuse(a, b, method = 'align') {
  const axis = sharedAxis(a, b)
  if (!axis) return null
  const A = view(a, axis)
  const B = view(b, axis)
  const dirA = A.pts[A.pts.length - 1].s - A.pts[0].s
  const dirB = B.pts[B.pts.length - 1].s - B.pts[0].s
  if (dirA * dirB < 0) B.pts.reverse()
  const pts = METHODS[method](axis, A, B)
  let mismatch = 0
  if (method === 'align') mismatch = pts.reduce((m, q) => m + q.mismatch, 0) / (pts.length || 1)
  // Drop consecutive duplicates (alignment repeats a sample on flat runs).
  const out = []
  for (const q of pts) if (!out.length || len(sub(q.p, out[out.length - 1].p)) > 1e-9) out.push(q)
  return { axis, points: out, mismatch, reversed: dirA * dirB < 0 }
}

// Which ink strokes belong together: planes that share an axis, extents on
// that axis overlapping by at least `minOverlap` (intersection over union).
// `order`: each stroke pairs with the next-drawn unpaired partner that
// overlaps, the convention "draw a stem in one view, then the other".
// `overlap`: globally best overlap first, drawing order breaking ties.
// `mismatch`: see below.
export function pairStrokes(strokes, { rule = 'order', minOverlap = 0.5 } = {}) {
  const ink = strokes.filter((s) => s.brush.description === 'ink')
  const extent = (s, axis) => {
    const v = points(s).map((q) => dot(q.p, axis))
    return [Math.min(...v), Math.max(...v)]
  }
  const candidates = []
  for (let i = 0; i < ink.length; i++) for (let j = i + 1; j < ink.length; j++) {
    const axis = sharedAxis(ink[i], ink[j])
    if (!axis) continue
    const [a0, a1] = extent(ink[i], axis), [b0, b1] = extent(ink[j], axis)
    const inter = Math.min(a1, b1) - Math.max(a0, b0)
    const union = Math.max(a1, b1) - Math.min(a0, b0)
    const iou = inter > 0 ? inter / union : 0
    if (iou >= minOverlap) candidates.push({ a: ink[i], b: ink[j], iou, gap: j - i })
  }
  // `mismatch`: fuse every candidate and pair lowest mean shared-coordinate
  // mismatch first; right pairs agree along the aligned path (0.007 in spike
  // 019) where wrong ones don't (0.015–0.037).
  if (rule === 'mismatch') for (const c of candidates) c.mismatch = fuse(c.a, c.b, 'align').mismatch
  candidates.sort(rule === 'mismatch'
    ? (x, y) => x.mismatch - y.mismatch || x.a.id - y.a.id || x.b.id - y.b.id
    : rule === 'order'
    ? (x, y) => x.a.id - y.a.id || x.gap - y.gap || y.iou - x.iou
    : (x, y) => y.iou - x.iou || x.a.id - y.a.id || x.b.id - y.b.id)
  const used = new Set()
  const pairs = []
  for (const c of candidates) {
    if (used.has(c.a.id) || used.has(c.b.id)) continue
    used.add(c.a.id); used.add(c.b.id)
    pairs.push(c)
  }
  return pairs
}
