/** The surface's pure layout: a grid of panels and a uniform fit per view. */
import { describe, expect, it } from 'vitest'

import { fit, layout } from '../surface/src/panels.ts'

describe('panels', () => {
  it('lays views out in a near-square grid in view order', () => {
    expect(layout([], 100, 100)).toEqual([])
    const one = layout([{ id: 'n4' }], 200, 100)
    expect(one).toEqual([{ id: 'n4', x: 12, y: 12, w: 176, h: 76 }])
    const three = layout([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 236, 124)
    expect(three.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(three[0]).toEqual({ id: 'a', x: 12, y: 12, w: 100, h: 44 })
    expect(three[1]).toEqual({ id: 'b', x: 124, y: 12, w: 100, h: 44 })
    expect(three[2]).toEqual({ id: 'c', x: 12, y: 68, w: 100, h: 44 })
  })

  it('fits a bounding box into the panel with the same scale on both axes', () => {
    const box = { id: 'v', x: 0, y: 0, w: 248, h: 148 }
    const to = fit(box, [0, 0, 100, 50])
    // 200 × 100 usable; scale 2 fits both axes; the box is centred.
    expect(to([0, 0])).toEqual([24, 24])
    expect(to([100, 50])).toEqual([224, 124])
    expect(to([50, 25])).toEqual([124, 74])
    // A single point (zero span) lands in the centre and does not divide by zero.
    const one = fit(box, [7, 7, 7, 7])
    expect(one([7, 7])).toEqual([124, 74])
  })
})
