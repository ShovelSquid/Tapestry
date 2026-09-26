import { describe, expect, it } from 'vitest'
import { RIFLE, atRest, drift, rifleTarget, textBobTarget } from './rifle'

const R = { left: 100, top: 100, right: 300, bottom: 200 }

describe('rifling', () => {
  it('pushes a nearby note away from the cursor', () => {
    const left = rifleTarget(R, 80, 150, 1)
    expect(left.x).toBeGreaterThan(0)
    expect(left.y).toBeCloseTo(0)
    const above = rifleTarget(R, 200, 90, 1)
    expect(above.y).toBeGreaterThan(0)
  })

  it('is strongest at the edge, gone past the radius, and never more than the max', () => {
    const near = rifleTarget(R, 99, 150, 1).x
    const far = rifleTarget(R, 100 - RIFLE.radiusPx / 2, 150, 1).x
    expect(near).toBeGreaterThan(far)
    expect(near).toBeLessThanOrEqual(RIFLE.maxPx)
    expect(rifleTarget(R, 100 - RIFLE.radiusPx - 1, 150, 1)).toEqual({ x: 0, y: 0 })
  })

  it('scales with strength and does nothing when off', () => {
    const full = rifleTarget(R, 90, 150, 1).x
    expect(rifleTarget(R, 90, 150, 0.3).x).toBeCloseTo(full * 0.3)
    expect(rifleTarget(R, 90, 150, 0)).toEqual({ x: 0, y: 0 })
  })

  it('leaves a note alone once the cursor is inside it', () => {
    expect(rifleTarget(R, 200, 150, 1)).toEqual({ x: 0, y: 0 })
  })

  it('drifts toward the target and settles back to rest', () => {
    let v = { x: 0, y: 0 }
    for (let i = 0; i < 30; i++) v = drift(v, { x: 3, y: 0 }, 16)
    expect(v.x).toBeGreaterThan(2.5)
    for (let i = 0; i < 120; i++) v = drift(v, { x: 0, y: 0 }, 16)
    expect(atRest(v)).toBe(true)
  })
})

describe('text bob', () => {
  it('only inside the note, barely, and away from the cursor', () => {
    expect(textBobTarget(R, 50, 50, 1)).toEqual({ x: 0, y: 0 })
    const t = textBobTarget(R, 200, 110, 0.3)
    expect(t.y).toBeGreaterThan(0)
    expect(Math.hypot(t.x, t.y)).toBeLessThanOrEqual(RIFLE.textMaxPx * 0.3 + 1e-9)
    expect(textBobTarget(R, 200, 150, 1)).toEqual({ x: 0, y: 0 })
    expect(textBobTarget(R, 200, 110, 0)).toEqual({ x: 0, y: 0 })
  })
})
