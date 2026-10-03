// Every view is more data, measured against ground truth:
//   - views added one at a time (front, side, top, 45° oblique, 30° tilt)
//   - two oblique planes alone as the first pair
//   - a sloppy view (5× the hand drift): residual weights vs uniform
//   - how far the stem moves when a view is added (refinement, not jumps)
//   - grouping: which strokes belong to which stem, drawn in shuffled order
// Writes results/check.json.
//
//   node check.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { BRUSHES, PLANES, stroke } from '../018-strokes-as-seeds/sessions.mjs'
import { readActions } from '../018-strokes-as-seeds/strokes.mjs'
import { CURVES } from '../019-shared/check-curves.mjs'
import { fuseViews } from './multiview.mjs'
import { groupStrokes } from './group.mjs'

const S = 0.7071067811865476
PLANES.oblique45 = [0, 0, 0, S, 0, -S, 0, 1, 0] // front turned 45° about height
PLANES.tilt30 = [0, 0, 0, 1, 0, 0, 0, 0.8660254037844387, 0.5] // front tipped 30° toward the viewer
const ORDER = ['front', 'side', 'top', 'oblique45', 'tilt30']

// A human's error is mostly slow drift, not jitter: a smooth offset per
// stroke, amplitude `drift`, with frequency and phase from the stroke id.
function drawView(id, curve, planeName, drift = 0.06) {
  const p = PLANES[planeName]
  const R = p.slice(3, 6), U = p.slice(6, 9)
  const f = 0.6 + ((id * 7919) % 97) / 97, ph1 = ((id * 104729) % 89) / 89, ph2 = ((id * 1299709) % 83) / 83
  return stroke(id, 'ink', planeName, (t) => {
    const P = curve(t)
    return [P[0] * R[0] + P[1] * R[1] + P[2] * R[2] + drift * Math.sin(6.2832 * (f * t + ph1)),
      P[0] * U[0] + P[1] * U[1] + P[2] * U[2] + drift * Math.sin(6.2832 * (f * t + ph2))]
  }, { seconds: 1.0 })
}

function error(points, curve) {
  const truth = Array.from({ length: 600 }, (_, i) => curve(i / 599))
  const d = (p, poly) => {
    let best = Infinity
    for (let i = 0; i + 1 < poly.length; i++) {
      const a = poly[i], b = poly[i + 1], ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
      const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, t = l2 ? Math.min(1, Math.max(0, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / l2)) : 0
      best = Math.min(best, Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t))
    }
    return best
  }
  const fused = points.map((q) => q.p)
  const d1 = fused.map((p) => d(p, truth))
  const d2 = truth.filter((_, i) => i % 6 === 0).map((p) => d(p, fused))
  return { mean: +(d1.reduce((a, b) => a + b, 0) / d1.length).toFixed(4), worst: +Math.max(...d1, ...d2).toFixed(3) }
}

const report = { add_views: {}, averages: {}, oblique_only: {}, sloppy: {}, movement: {}, grouping: {} }
const mean = (xs) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4)

// 1. Views added one at a time.
const perCount = { 2: [], 3: [], 4: [], 5: [] }
const perUniform = { 2: [], 3: [], 4: [], 5: [] }, perResidual = { 2: [], 3: [], 4: [], 5: [] }, perClean = { 2: [], 3: [], 4: [], 5: [] }
for (const [name, curve] of Object.entries(CURVES)) {
  const strokes = readActions([...BRUSHES, ...ORDER.flatMap((pl, i) => drawView(i + 1, curve, pl))])
  const clean = readActions([...BRUSHES, ...ORDER.flatMap((pl, i) => drawView(i + 1, curve, pl, 0))])
  report.add_views[name] = {}
  let prev = null
  for (let n = 2; n <= 5; n++) {
    const f = fuseViews(strokes.slice(0, n))
    const e = error(f.points, curve)
    report.add_views[name][n] = { ...e, uniform: error(fuseViews(strokes.slice(0, n), { weighting: 'uniform' }).points, curve).mean,
      residual: error(fuseViews(strokes.slice(0, n), { weighting: 'residual' }).points, curve).mean,
      no_drift: error(fuseViews(clean.slice(0, n)).points, curve).mean, views: f.views }
    perUniform[n].push(report.add_views[name][n].uniform); perResidual[n].push(report.add_views[name][n].residual); perClean[n].push(report.add_views[name][n].no_drift)
    perCount[n].push(e.mean)
    if (prev) {
      const moved = f.points.map((q, k) => Math.hypot(...q.p.map((x, a) => x - prev[k].p[a])))
      report.movement[`${name}_${n - 1}to${n}`] = { mean: mean(moved), max: +Math.max(...moved).toFixed(3) }
    }
    prev = f.points
  }
  console.log(name.padEnd(8), [2, 3, 4, 5].map((n) => `${n} views: mean ${report.add_views[name][n].mean} worst ${report.add_views[name][n].worst}`).join(' | '))
}
for (const n of [2, 3, 4, 5]) report.averages[n] = { robust: mean(perCount[n]), uniform: mean(perUniform[n]), residual: mean(perResidual[n]), no_drift: mean(perClean[n]) }
console.log('mean error over all curves by view count:')
for (const n of [2, 3, 4, 5]) console.log(`  ${n} views  robust ${report.averages[n].robust}  uniform ${report.averages[n].uniform}  residual ${report.averages[n].residual}  (no hand drift: ${report.averages[n].no_drift})`)
console.log('movement when a view is added (mean over curves):', JSON.stringify(Object.fromEntries(['2to3', '3to4', '4to5'].map((k) => [k, mean(Object.entries(report.movement).filter(([x]) => x.endsWith(k)).map(([, v]) => v.mean))]))))

// 2. Two oblique planes alone (not perpendicular), then plus side.
for (const [name, curve] of Object.entries(CURVES)) {
  const strokes = readActions([...BRUSHES, ...drawView(1, curve, 'oblique45'), ...drawView(2, curve, 'tilt30'), ...drawView(3, curve, 'side')])
  report.oblique_only[name] = { two: error(fuseViews(strokes.slice(0, 2)).points, curve), plus_side: error(fuseViews(strokes).points, curve) }
}
console.log('oblique pair (45° + 30° tilt):', JSON.stringify(Object.fromEntries(Object.entries(report.oblique_only).map(([k, v]) => [k, `${v.two.mean}/${v.two.worst} → +side ${v.plus_side.mean}/${v.plus_side.worst}`]))))

// 3. A sloppy fourth view.
for (const [name, curve] of Object.entries(CURVES)) {
  const actions = [...BRUSHES, ...drawView(1, curve, 'front'), ...drawView(2, curve, 'side'), ...drawView(3, curve, 'top')]
  const three = readActions(actions)
  const withSloppy = readActions([...actions, ...drawView(4, curve, 'oblique45', 0.3)])
  report.sloppy[name] = {
    three_good: error(fuseViews(three).points, curve),
    plus_sloppy_uniform: error(fuseViews(withSloppy, { weighting: 'uniform' }).points, curve),
    plus_sloppy_residual: error(fuseViews(withSloppy, { weighting: 'residual' }).points, curve),
    plus_sloppy_robust: error(fuseViews(withSloppy).points, curve),
    weights: fuseViews(withSloppy).views,
  }
}
console.log('sloppy 4th view (5× drift), mean error: 3 good → +sloppy uniform | residual | robust:')
for (const [k, v] of Object.entries(report.sloppy)) console.log(`  ${k.padEnd(8)} ${v.three_good.mean} → ${v.plus_sloppy_uniform.mean} | ${v.plus_sloppy_residual.mean} | ${v.plus_sloppy_robust.mean}   robust weights ${v.weights.map((w) => w.weight).join(' ')}`)

// 4. Grouping: two stems, four views each, drawn in shuffled order.
{
  const a = CURVES.helix, b = (s) => { const p = CURVES.hook(s); return [p[0] + 1.5, p[1], p[2] - 1] }
  const plan = [[a, 'front'], [b, 'side'], [b, 'front'], [a, 'top'], [b, 'oblique45'], [a, 'side'], [b, 'top'], [a, 'oblique45']]
  const strokes = readActions([...BRUSHES, ...plan.flatMap(([c, pl], i) => drawView(i + 1, c, pl))])
  const truth = new Map(plan.map(([c], i) => [i + 1, c === a ? 'a' : 'b']))
  const groups = groupStrokes(strokes)
  const pure = groups.every((g) => new Set(g.map((s) => truth.get(s.id))).size === 1)
  report.grouping = { groups: groups.map((g) => g.map((s) => `${s.id}${truth.get(s.id)}`)), pure, complete: groups.flat().length === strokes.length }
  console.log('grouping two stems × 4 views, shuffled:', JSON.stringify(report.grouping))
}

mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
writeFileSync(new URL('./results/check.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
