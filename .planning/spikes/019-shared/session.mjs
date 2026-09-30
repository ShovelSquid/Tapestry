// A whole drawing session with two-view stems: pairs of ink strokes on
// planes that share an axis are fused into one 3D stem (019); every other
// stroke is fitted exactly as spike 018 fits it.

import { fitStrokes, readActions, simplify } from '../018-strokes-as-seeds/strokes.mjs'
import { fuse, pairStrokes } from './fuse.mjs'

export function fitSession(actions, { method = 'align', rule = 'order', tolerance = 0.05, radius = 0.32, minRadius = 0.035 } = {}) {
  const strokes = readActions(actions)
  const pairs = pairStrokes(strokes, { rule })
  const paired = new Set(pairs.flatMap((p) => [p.a.id, p.b.id]))
  // Everything unpaired goes through 018's fitter untouched.
  const rest = actions.filter((a) => !('strokeId' in a) || !paired.has(a.strokeId))
  const { description, fit } = fitStrokes(rest, { tolerance, radius, minRadius })
  const fused = []
  for (const p of pairs) {
    const f = fuse(p.a, p.b, method)
    const kept = simplify(f.points, tolerance)
    for (let k = 0; k + 1 < kept.length; k++) {
      const a = f.points[kept[k]].p, b = f.points[kept[k + 1]].p
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
      if (l === 0) continue
      let w = 0
      for (let i = kept[k]; i <= kept[k + 1]; i++) w += f.points[i].w
      w /= kept[k + 1] - kept[k] + 1
      // Named after the pair's first stroke, so the id is stable as strokes are added.
      description.seeds.push({ id: `s${p.a.id}+${p.b.id}.${k}`, start: a, dir: d.map((x) => x / l), len: l, radius: Math.max(minRadius, radius * w), grow: true, stroke: p.a.id })
    }
    fused.push({ pair: `${p.a.id}+${p.b.id}`, points: f.points, mismatch: f.mismatch, reversed: f.reversed })
  }
  return { description, fused, fit: { ...fit, pairs: pairs.length, seeds: description.seeds.length } }
}
