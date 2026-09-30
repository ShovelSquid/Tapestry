// Ground truth: known 3D stems, drawn as a front stroke and a side stroke
// (projections, with pen pacing, pressure and hand wobble as in spike 018),
// fused by each method and compared with the true curve.
//
//   node check.mjs
//
// Writes results/check.json.

import { mkdirSync, writeFileSync } from 'node:fs'
import { canonical, expand } from '../015-generative-vectors/gen.mjs'
import { BRUSHES, stroke } from '../018-strokes-as-seeds/sessions.mjs'
import { readActions } from '../018-strokes-as-seeds/strokes.mjs'
import { buildFastSdfMesh } from '../017-fast-sdf/fast.mjs'
import { topology } from '../016-shared/mesh-stats.mjs'
import { METHODS, fuse, pairStrokes } from './fuse.mjs'
import { fitSession } from './session.mjs'

import { CURVES } from './check-curves.mjs'
const PACE = { uneven: (t) => Math.pow(t, 0.5) } // side stroke's time → curve parameter

function drawPair(name, curve, idA = 1, idB = 2, sideReversed = false) {
  const pace = PACE[name] || ((t) => t)
  return [
    ...stroke(idA, 'ink', 'front', (t) => { const p = curve(t); return [p[0], p[1]] }, { seconds: 1.0 }),
    ...stroke(idB, 'ink', 'side', (t) => { const q = sideReversed ? 1 - pace(t) : pace(t); const p = curve(q); return [p[2], p[1]] }, { seconds: 0.9 }),
  ]
}

// Two-way distance between a fused polyline and the true curve.
function error(points, curve) {
  const truth = Array.from({ length: 800 }, (_, i) => curve(i / 799))
  const segDist = (p, poly) => {
    let best = Infinity
    for (let i = 0; i + 1 < poly.length; i++) {
      const a = poly[i], b = poly[i + 1]
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
      const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
      const t = l2 ? Math.min(1, Math.max(0, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / l2)) : 0
      best = Math.min(best, Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t))
    }
    return best
  }
  const fused = points.map((q) => q.p)
  if (fused.length < 2) return { mean: null, worst: null, coverage_worst: null }
  const d1 = fused.map((p) => segDist(p, truth))
  const d2 = truth.filter((_, i) => i % 8 === 0).map((p) => segDist(p, fused))
  const r = (x) => +x.toFixed(3)
  return { mean: r(d1.reduce((a, b) => a + b, 0) / d1.length), worst: r(Math.max(...d1)), coverage_worst: r(Math.max(...d2)) }
}

const report = { curves: {}, reversed: {}, pairing: {}, pipeline: {} }
for (const [name, curve] of Object.entries(CURVES)) {
  const strokes = readActions([...BRUSHES, ...drawPair(name, curve)])
  const row = {}
  for (const method of Object.keys(METHODS)) {
    const t = performance.now()
    const f = fuse(strokes[0], strokes[1], method)
    row[method] = { ...error(f.points, curve), points: f.points.length, ms: +(performance.now() - t).toFixed(1), ...(method === 'align' ? { mismatch: +f.mismatch.toFixed(3) } : {}) }
  }
  report.curves[name] = row
  console.log(name.padEnd(8), Object.entries(row).map(([m, r]) => `${m}: mean ${r.mean} worst ${r.worst} cover ${r.coverage_worst}${r.mismatch !== undefined ? ` (mismatch ${r.mismatch})` : ''}`).join(' | '))
}

// The side view drawn tip to root: fusion must notice and reverse it.
{
  const strokes = readActions([...BRUSHES, ...drawPair('lean', CURVES.lean, 1, 2, true)])
  const f = fuse(strokes[0], strokes[1], 'align')
  report.reversed = { detected: f.reversed, ...error(f.points, CURVES.lean) }
  console.log('reversed side view:', JSON.stringify(report.reversed))
}

// Pairing: three stems with overlapping heights, each drawn front-then-side.
{
  const stems = [
    (s) => [-1.2 + 0.4 * s, 3 * s, -0.4 * s], (s) => [0.3 * s, 3.2 * s, 0.6 * s], (s) => [1.2 - 0.5 * s * s, 2.8 * s, 0.2 - 0.6 * s],
  ]
  const actions = [...BRUSHES]
  stems.forEach((c, k) => actions.push(...stroke(2 * k + 1, 'ink', 'front', (t) => { const p = c(t); return [p[0], p[1]] }), ...stroke(2 * k + 2, 'ink', 'side', (t) => { const p = c(t); return [p[2], p[1]] })))
  const strokes = readActions(actions)
  for (const rule of ['order', 'overlap']) {
    const pairs = pairStrokes(strokes, { rule })
    const correct = pairs.filter((p) => p.b.id === p.a.id + 1 && p.a.id % 2 === 1).length
    report.pairing[rule] = { pairs: pairs.map((p) => `${p.a.id}+${p.b.id}`), correct, of: stems.length }
    console.log(`pairing by ${rule}:`, JSON.stringify(report.pairing[rule]))
  }
  // Drawn out of order: all fronts, then all sides.
  const outOfOrder = [...BRUSHES]
  stems.forEach((c, k) => outOfOrder.push(...stroke(k + 1, 'ink', 'front', (t) => { const p = c(t); return [p[0], p[1]] })))
  stems.forEach((c, k) => outOfOrder.push(...stroke(k + 4, 'ink', 'side', (t) => { const p = c(t); return [p[2], p[1]] })))
  const s2 = readActions(outOfOrder)
  for (const rule of ['order', 'overlap']) {
    const pairs = pairStrokes(s2, { rule })
    const correct = pairs.filter((p) => p.b.id === p.a.id + 3).length
    report.pairing[`${rule}_all_fronts_first`] = { pairs: pairs.map((p) => `${p.a.id}+${p.b.id}`), correct, of: stems.length }
    console.log(`pairing by ${rule}, all fronts first:`, JSON.stringify(report.pairing[`${rule}_all_fronts_first`]))
  }
  // Shuffled: all fronts, then the sides in a different order (stem 3, 1, 2).
  const shuffled = [...BRUSHES]
  stems.forEach((c, k) => shuffled.push(...stroke(k + 1, 'ink', 'front', (t) => { const p = c(t); return [p[0], p[1]] })))
  ;[2, 0, 1].forEach((k, n) => shuffled.push(...stroke(n + 4, 'ink', 'side', (t) => { const p = stems[k](t); return [p[2], p[1]] })))
  const truth = { 1: 5, 2: 6, 3: 4 }
  for (const rule of ['order', 'overlap', 'mismatch']) {
    const pairs = pairStrokes(readActions(shuffled), { rule })
    const correct = pairs.filter((p) => truth[p.a.id] === p.b.id).length
    report.pairing[`${rule}_shuffled`] = { pairs: pairs.map((p) => `${p.a.id}+${p.b.id}`), correct, of: 3 }
    console.log(`pairing by ${rule}, sides shuffled:`, JSON.stringify(report.pairing[`${rule}_shuffled`]))
  }
  // Different heights: overlap alone can tell them apart.
  const tall = [(s) => [-1 + 0.3 * s, 4 * s, 0.2 * s], (s) => [0.2 * s, 1 + 1.2 * s, -0.3 * s], (s) => [1, 2.5 + 1.5 * s, 0.4 * s]]
  const heights = [...BRUSHES]
  tall.forEach((c, k) => heights.push(...stroke(k + 1, 'ink', 'front', (t) => { const p = c(t); return [p[0], p[1]] })))
  ;[2, 0, 1].forEach((k, n) => heights.push(...stroke(n + 4, 'ink', 'side', (t) => { const p = tall[k](t); return [p[2], p[1]] })))
  for (const rule of ['order', 'overlap', 'mismatch']) {
    const pairs = pairStrokes(readActions(heights), { rule })
    const correct = pairs.filter((p) => truth[p.a.id] === p.b.id).length
    report.pairing[`${rule}_shuffled_different_heights`] = { pairs: pairs.map((p) => `${p.a.id}+${p.b.id}`), correct, of: 3 }
    console.log(`pairing by ${rule}, sides shuffled, different heights:`, JSON.stringify(report.pairing[`${rule}_shuffled_different_heights`]))
  }
  // Identical heights, shuffled. Profiles differ (one stem rises fast, one
  // slow, one sags): overlap can't tell them apart; mismatch might.
  const same = [(s) => [-1 + 0.4 * s, 3 * Math.sqrt(s), 0.3 * s], (s) => [0.3 * s, 3 * s * s, -0.4 * s], (s) => [1 - 0.3 * s, 3 * s, 0.5 * s]]
  const linear = [(s) => [-1 + 0.4 * s, 3 * s, 0.3 * s], (s) => [0.3 * s, 3 * s, -0.4 * s], (s) => [1 - 0.3 * s, 3 * s, 0.5 * s]]
  for (const [label, set] of [['same_heights_different_profiles', same], ['same_heights_same_linear_profile', linear]]) {
    const acts = [...BRUSHES]
    set.forEach((c, k) => acts.push(...stroke(k + 1, 'ink', 'front', (t) => { const p = c(t); return [p[0], p[1]] })))
    ;[2, 0, 1].forEach((k, n) => acts.push(...stroke(n + 4, 'ink', 'side', (t) => { const p = set[k](t); return [p[2], p[1]] })))
    for (const rule of ['order', 'overlap', 'mismatch']) {
      const pairs = pairStrokes(readActions(acts), { rule })
      const correct = pairs.filter((p) => truth[p.a.id] === p.b.id).length
      report.pairing[`${rule}_${label}`] = { pairs: pairs.map((p) => `${p.a.id}+${p.b.id}`), correct, of: 3 }
      console.log(`pairing by ${rule}, ${label}:`, JSON.stringify(report.pairing[`${rule}_${label}`]))
    }
  }

  // Can the mismatch (no ground truth needed) flag a wrong pair?
  const sh = readActions(shuffled)
  const byId = new Map(sh.map((x) => [x.id, x]))
  const right = [[1, 5], [2, 6], [3, 4]].map(([a, b]) => fuse(byId.get(a), byId.get(b), 'align').mismatch)
  const wrong = [[1, 4], [1, 6], [2, 4], [2, 5], [3, 5], [3, 6]].map(([a, b]) => fuse(byId.get(a), byId.get(b), 'align').mismatch)
  report.pairing.mismatch = { right: right.map((x) => +x.toFixed(3)), wrong: wrong.map((x) => +x.toFixed(3)) }
  console.log('mismatch, right pairs vs wrong pairs:', JSON.stringify(report.pairing.mismatch))
}

// The whole pipeline: fused stems → seeds → growth → surface.
{
  const actions = [...BRUSHES, ...drawPair('helix', CURVES.helix, 1, 2), ...drawPair('hook', CURVES.hook, 3, 4)]
  const t0 = performance.now()
  const { description, fit } = fitSession(actions)
  const t1 = performance.now()
  const levels = expand(description, 4).levels
  const t2 = performance.now()
  const mesh = buildFastSdfMesh(levels.flat(), { cell: 0.05 })
  const t3 = performance.now()
  const again = fitSession(actions).description
  report.pipeline = { ...fit, vectors: levels.flat().length, watertight: topology(mesh).watertight,
    deterministic: JSON.stringify(canonical(expand(again, 4).levels).ids) === JSON.stringify(canonical(levels).ids),
    ms: { fuse_and_fit: +(t1 - t0).toFixed(1), grow: Math.round(t2 - t1), surface: Math.round(t3 - t2) } }
  console.log('pipeline:', JSON.stringify(report.pipeline))
}

mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
writeFileSync(new URL('./results/check.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
