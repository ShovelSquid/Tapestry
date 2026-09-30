// A drawing session where any number of views of a stem are just more data:
// ink strokes are grouped into stems (group.mjs), each stem of two or more
// views is fused by least squares (multiview.mjs), and every other stroke
// is fitted exactly as spike 018 fits it.

import { fitStrokes, readActions, simplify } from '../018-strokes-as-seeds/strokes.mjs'
import { groupStrokes } from './group.mjs'
import { fuseViews } from './multiview.mjs'

export function fitSessionMulti(actions, { tolerance = 0.05, radius = 0.32, minRadius = 0.035, drawingTolerance = 0.1 } = {}) {
  const strokes = readActions(actions)
  const stems = groupStrokes(strokes).filter((g) => g.length >= 2)
  const inStem = new Set(stems.flat().map((s) => s.id))
  const rest = actions.filter((a) => !('strokeId' in a) || !inStem.has(a.strokeId))
  const { description, fit } = fitStrokes(rest, { tolerance, radius, minRadius })
  const fused = []
  for (const g of stems) {
    const f = fuseViews(g, { tolerance: drawingTolerance })
    const kept = simplify(f.points, tolerance)
    const name = `s${g.map((s) => s.id).join('+')}`
    for (let k = 0; k + 1 < kept.length; k++) {
      const a = f.points[kept[k]].p, b = f.points[kept[k + 1]].p
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
      if (l === 0) continue
      let w = 0
      for (let i = kept[k]; i <= kept[k + 1]; i++) w += f.points[i].w
      w /= kept[k + 1] - kept[k] + 1
      description.seeds.push({ id: `${name}.${k}`, start: a, dir: d.map((x) => x / l), len: l, radius: Math.max(minRadius, radius * w), grow: true, stroke: g[0].id })
    }
    fused.push({ stem: g.map((s) => s.id), points: f.points, views: f.views })
  }
  return { description, fused, fit: { ...fit, stems: stems.length, seeds: description.seeds.length } }
}
