// Which ink strokes are views of which stem. A stroke that fits no stem
// stays a single planar stem (spike 018). Deterministic: strokes in id
// order, ties to the lower id.

import { pairStrokes } from '../019-shared/fuse.mjs'
import { fitResidual, fuseViews } from './multiview.mjs'

// `reach` is deliberately looser than the drawing tolerance (0.1): a stroke
// that plausibly belongs to a stem joins it and the view weights decide how
// much it counts. At 0.15, a 5×-sloppy view was left out and grew as its own
// flat stem (spike 020).
export function groupStrokes(strokes, { reach = 0.3 } = {}) {
  const ink = strokes.filter((s) => s.brush.description === 'ink')
  const free = new Set(ink.map((s) => s.id))
  const groups = []
  // Grow one stem at a time: start from the best remaining pair (lowest
  // mismatch), then attach every free stroke that fits its estimate within
  // `reach`, best fit first, re-fusing after each. Pairing everything first
  // split one stem into two pairs (spike 020).
  for (;;) {
    const pairs = pairStrokes(ink.filter((s) => free.has(s.id)), { rule: 'mismatch' })
    if (!pairs.length) break
    const group = [pairs[0].a, pairs[0].b]
    free.delete(pairs[0].a.id); free.delete(pairs[0].b.id)
    for (;;) {
      const P = fuseViews(group).points.map((q) => q.p)
      let best = null
      for (const s of ink) {
        if (!free.has(s.id)) continue
        const r = fitResidual(s, P)
        if (r <= reach && (!best || r < best.r)) best = { s, r }
      }
      if (!best) break
      group.push(best.s)
      free.delete(best.s.id)
    }
    groups.push(group.sort((x, y) => x.id - y.id))
  }
  for (const s of ink) if (free.has(s.id)) groups.push([s])
  return groups
}
