// Any number of views of one stem, each just more data (spike 020).
//
// A view is a stroke on a plane (origin O, right R, up U). It says the
// stem's point P at each moment projects to its sample:
//     R·(P − O) = u,   U·(P − O) = v.
// All views' observations of one point go into one weighted least-squares
// solve: (Σ w (R Rᵀ + U Uᵀ)) P = Σ w (R (u + R·O) + U (v + U·O)), a 3×3
// system, so any plane orientation works and two perpendicular views give
// exactly spike 019c's point.
//
// The stem's common parameter comes from the first two views (019c's
// alignment on their shared axis, but solved by least squares, so oblique
// planes work). Each further view is aligned in 2D to the current estimate
// projected into its plane, then adds its observations. View weights are
// 1 / (the view's own rms residual² + σ₀²), re-estimated each round, so a
// view that disagrees with the rest counts for less.
//
// Deterministic: exact ops (Cramer's rule), fixed tie-breaking, views in
// stroke-id order.

import { points } from '../018-strokes-as-seeds/strokes.mjs'
import { sharedAxis } from '../019-shared/fuse.mjs'

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.sqrt(dot(a, a))

// A stroke as a view: its frame and its samples in plane coordinates.
export function asView(stroke) {
  const pts = points(stroke)
  return {
    id: stroke.id, O: stroke.origin, R: stroke.right, U: stroke.up,
    uv: pts.map((q) => [dot(sub(q.p, stroke.origin), stroke.right), dot(sub(q.p, stroke.origin), stroke.up)]),
    w: pts.map((q) => q.w),
    p3: pts.map((q) => q.p),
  }
}

const project = (view, P) => [dot(sub(P, view.O), view.R), dot(sub(P, view.O), view.U)]

function solve3(M, b) {
  const [a, bb, c, d, e, f, g, h, i] = M
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-12) return null
  return [
    (b[0] * (e * i - f * h) - bb * (b[1] * i - f * b[2]) + c * (b[1] * h - e * b[2])) / det,
    (a * (b[1] * i - f * b[2]) - b[0] * (d * i - f * g) + c * (d * b[2] - b[1] * g)) / det,
    (a * (e * b[2] - b[1] * h) - bb * (d * b[2] - b[1] * g) + b[0] * (d * h - e * g)) / det,
  ]
}

// Least squares for one point from observations [{ view, uv, weight }].
function solvePoint(obs, fallback) {
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const b = [0, 0, 0]
  for (const { view, uv, weight } of obs) {
    const ro = uv[0] + dot(view.R, view.O), uo = uv[1] + dot(view.U, view.O)
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) M[3 * r + c] += weight * (view.R[r] * view.R[c] + view.U[r] * view.U[c])
      b[r] += weight * (view.R[r] * ro + view.U[r] * uo)
    }
  }
  return solve3(M, b) || fallback
}

function cumulative(pts2) {
  const out = [0]
  for (let i = 1; i < pts2.length; i++) out.push(out[i - 1] + Math.hypot(pts2[i][0] - pts2[i - 1][0], pts2[i][1] - pts2[i - 1][1]))
  const t = out[out.length - 1] || 1
  return out.map((x) => x / t)
}

// Monotone alignment of sequences a (n) and b (m) under cost(i, j); returns
// the path as [i, j] pairs, ties preferring the diagonal, then a, then b.
function align(n, m, cost) {
  const D = new Float64Array(n * m)
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const c = cost(i, j)
    if (!i && !j) { D[0] = c; continue }
    let best = Infinity
    if (i && j) best = D[(i - 1) * m + j - 1]
    if (i && D[(i - 1) * m + j] < best) best = D[(i - 1) * m + j]
    if (j && D[i * m + j - 1] < best) best = D[i * m + j - 1]
    D[i * m + j] = c + best
  }
  const path = []
  let i = n - 1, j = m - 1
  for (;;) {
    path.push([i, j])
    if (!i && !j) break
    const diag = i && j ? D[(i - 1) * m + j - 1] : Infinity, up = i ? D[(i - 1) * m + j] : Infinity, left = j ? D[i * m + j - 1] : Infinity
    if (diag <= up && diag <= left) { i--; j-- } else if (up <= left) i--; else j--
  }
  return path.reverse()
}

// The first two views: aligned on their shared axis (019c), one parameter
// step per path step, each solved from both views' observations.
function seedEstimate(A, B, lambda = 0.25) {
  const a0 = { R: A.R, U: A.U, O: A.O }, b0 = { R: B.R, U: B.U, O: B.O }
  const axis = sharedAxis({ right: A.R, up: A.U }, { right: B.R, up: B.U })
  if (!axis) return null
  const sa = A.p3.map((p) => dot(p, axis)), sb0 = B.p3.map((p) => dot(p, axis))
  const reversed = (sa[sa.length - 1] - sa[0]) * (sb0[sb0.length - 1] - sb0[0]) < 0
  const Bi = reversed ? B.uv.map((_, k) => B.uv.length - 1 - k) : B.uv.map((_, k) => k)
  const sb = Bi.map((k) => sb0[k])
  const fa = cumulative(A.uv), fbRaw = cumulative(B.uv), fb = Bi.map((k) => (reversed ? 1 - fbRaw[k] : fbRaw[k]))
  const span = Math.max(...sa) - Math.min(...sa) || 1
  const path = align(A.uv.length, sb.length, (i, j) => { const ds = (sa[i] - sb[j]) / span, df = fa[i] - fb[j]; return ds * ds + lambda * lambda * df * df })
  const matches = new Map([[A.id, path.map(([i]) => i)], [B.id, path.map(([, j]) => Bi[j])]])
  const P = path.map(([i, j]) => solvePoint([{ view: a0, uv: A.uv[i], weight: 1 }, { view: b0, uv: B.uv[Bi[j]], weight: 1 }], null))
  return { P, matches }
}

// A further view: aligned in 2D to the estimate projected into its plane,
// in whichever direction fits better. Returns, per parameter step, the
// view's matched sample index.
function matchView(view, P) {
  const proj = P.map((p) => project(view, p))
  const K = P.length, n = view.uv.length
  const run = (order) => {
    const f = cumulative(order.map((k) => view.uv[k])), g = cumulative(proj)
    const scale = Math.max(1e-6, ...proj.map((q) => Math.hypot(q[0] - proj[0][0], q[1] - proj[0][1])))
    const cost = (k, j) => {
      const q = proj[k], s = view.uv[order[j]]
      const d = Math.hypot(q[0] - s[0], q[1] - s[1]) / scale, df = g[k] - f[j]
      return d * d + 0.0625 * df * df
    }
    const path = align(K, n, cost)
    const pick = new Array(K).fill(-1)
    for (const [k, j] of path) if (pick[k] < 0) pick[k] = order[j]
    let total = 0
    for (const [k, j] of path) total += cost(k, j)
    return { pick, total }
  }
  const fwd = run(view.uv.map((_, k) => k))
  const back = run(view.uv.map((_, k) => n - 1 - k))
  return back.total < fwd.total ? { pick: back.pick, reversed: true } : { pick: fwd.pick, reversed: false }
}

// The pair to start from: the most perpendicular planes (best-conditioned
// depth), ties to drawing order. Two planes at a shallow angle amplify drift.
// Normals are normalised first: a Q16.16 frame isn't exactly unit, and an
// oblique pair scored 1.000001, beat front + side's exact 1, and silently
// re-seeded the stem when it was added (spike 020). A later pair must be
// clearly better (by `margin`) to take over, so adding a view refines.
function seedPair(views, margin = 0.05) {
  let best = null
  for (let i = 0; i < views.length; i++) for (let j = i + 1; j < views.length; j++) {
    const na = unit3(cross(views[i].R, views[i].U)), nb = unit3(cross(views[j].R, views[j].U))
    const sin = len(cross(na, nb))
    if (!best || sin > best.sin + margin) best = { i, j, sin }
  }
  return best
}
const unit3 = (a) => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : a }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// Fuses views of one stem. Options: sigma0 (expected hand error, world units,
// for 'residual'), rounds (re-weighting passes), weighting:
//   'robust'    (default) min(1, (tolerance / residual)⁴), over rounds:
//               full weight for a view within the drawing tolerance
//   'residual'  1 / (residual² + sigma0²): chases noise when views are alike
//   'uniform'   every view counts the same
export function fuseViews(strokes, { sigma0 = 0.03, tolerance = 0.1, rounds = 4, weighting = 'robust', realign = true } = {}) {
  const all = strokes.map(asView)
  const sp = seedPair(all)
  const views = [all[sp.i], all[sp.j], ...all.filter((_, k) => k !== sp.i && k !== sp.j)]
  const seeded = seedEstimate(views[0], views[1])
  if (!seeded) return null
  let P = seeded.P
  const matches = seeded.matches
  for (const v of views.slice(2)) matches.set(v.id, matchView(v, P).pick)
  const weights = new Map(views.map((v) => [v.id, 1]))
  const residuals = new Map()
  const solveAll = () => {
    P = P.map((p, k) => solvePoint(views.map((v) => ({ view: v, uv: v.uv[matches.get(v.id)[k]], weight: weights.get(v.id) })), p))
  }
  solveAll()
  for (let r = 0; r < rounds; r++) {
    // Realigning every view to the refined estimate lets later views correct
    // the first pair's correspondence too.
    if (realign) for (const v of views) matches.set(v.id, matchView(v, P).pick)
    for (const v of views) {
      let s = 0
      const m = matches.get(v.id)
      for (let k = 0; k < P.length; k++) { const q = project(v, P[k]), o = v.uv[m[k]]; s += (q[0] - o[0]) ** 2 + (q[1] - o[1]) ** 2 }
      residuals.set(v.id, Math.sqrt(s / P.length))
      if (weighting === 'residual') weights.set(v.id, 1 / (residuals.get(v.id) ** 2 + sigma0 * sigma0))
    }
    if (weighting === 'robust') {
      // An absolute drawing tolerance, not a rule relative to the other views:
      // with 3–5 views, the largest good residual reached 1.72× the median
      // while a 5× sloppy view sat as low as 1.42×, so no relative threshold
      // separates them. In absolute terms they don't overlap (good ≤ 0.087,
      // sloppy ≥ 0.124). Tried first and rejected: 2× the median (masked),
      // leave-one-out residuals (masked), (median / residual)² (drops a good
      // view whenever there are 3).
      // Fourth power: outside the tolerance, trust falls off fast (a squared
      // falloff still left a 5× sloppy view 9–15% of the weight).
      for (const v of views) weights.set(v.id, Math.min(1, (tolerance / residuals.get(v.id)) ** 4))
    }
    solveAll()
  }
  const wsum = [...weights.values()].reduce((a, b) => a + b, 0)
  return {
    points: P.map((p, k) => ({ p, w: views.reduce((m, v) => m + v.w[matches.get(v.id)[k]] * weights.get(v.id), 0) / wsum })),
    views: views.map((v) => ({ id: v.id, residual: +(residuals.get(v.id) ?? 0).toFixed(4), weight: +(weights.get(v.id) / wsum).toFixed(3) })),
  }
}

// How well a stroke fits an estimated stem: its 2D alignment residual
// against the stem's projection into its plane (no ground truth needed).
export function fitResidual(stroke, P) {
  const v = asView(stroke)
  const { pick } = matchView(v, P)
  let s = 0
  for (let k = 0; k < P.length; k++) { const q = project(v, P[k]), o = v.uv[pick[k]]; s += (q[0] - o[0]) ** 2 + (q[1] - o[1]) ** 2 }
  return Math.sqrt(s / P.length)
}
