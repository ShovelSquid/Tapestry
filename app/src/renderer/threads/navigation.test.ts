/**
 * navigation.ts tests (D-17, UI-SPEC "Side view read-back" / "Keyboard map"
 * / "Gap and scrubber honesty").
 *
 * Covers the pure functions this plan's own acceptance criteria name
 * directly: `gravityStep`'s suppression conditions and its letter-count
 * weighting, `zoomStep`'s ×2-per-press arithmetic and clamping, and the
 * scrubber's day/centre mapping. `flyTo` itself (the only function here
 * that touches `requestAnimationFrame`) is exercised through its reduced-
 * motion path, which is synchronous and deterministic.
 */

import { describe, expect, it } from 'vitest'
import {
  GRAVITY_MAX_POINTER_SPEED_PX_PER_SEC,
  GRAVITY_RADIUS_PX,
  GRAVITY_SUPPRESS_MS,
  NAV_KEYS,
  dayIndexOf,
  dayIndexToCenterMs,
  dayStartMs,
  flyTo,
  gravityStep,
  gravityWeight,
  zoomStep,
} from './navigation'

function baseGravityInput(overrides: Partial<Parameters<typeof gravityStep>[0]> = {}) {
  return {
    distancePx: 10,
    pointerSpeedPxPerSec: 0,
    msSinceLastWheelOrDrag: Infinity,
    frameDeltaSeconds: 1 / 60,
    letterCount: 500,
    ...overrides,
  }
}

describe('gravityStep', () => {
  it('returns zero beyond the 48px radius', () => {
    expect(gravityStep(baseGravityInput({ distancePx: GRAVITY_RADIUS_PX + 1 }))).toBe(0)
  })

  it('pulls at exactly the radius boundary and within it', () => {
    expect(gravityStep(baseGravityInput({ distancePx: GRAVITY_RADIUS_PX }))).toBeGreaterThanOrEqual(0)
    expect(gravityStep(baseGravityInput({ distancePx: 1 }))).toBeGreaterThan(0)
  })

  it('returns zero at or above 120px/s pointer speed', () => {
    expect(gravityStep(baseGravityInput({ pointerSpeedPxPerSec: GRAVITY_MAX_POINTER_SPEED_PX_PER_SEC }))).toBe(0)
    expect(gravityStep(baseGravityInput({ pointerSpeedPxPerSec: 150 }))).toBe(0)
  })

  it('pulls below the 120px/s threshold', () => {
    expect(gravityStep(baseGravityInput({ pointerSpeedPxPerSec: 50 }))).toBeGreaterThan(0)
  })

  it('returns zero within 150ms of a wheel or drag', () => {
    expect(gravityStep(baseGravityInput({ msSinceLastWheelOrDrag: 0 }))).toBe(0)
    expect(gravityStep(baseGravityInput({ msSinceLastWheelOrDrag: GRAVITY_SUPPRESS_MS - 1 }))).toBe(0)
  })

  it('pulls once 150ms have passed since the last wheel or drag', () => {
    expect(gravityStep(baseGravityInput({ msSinceLastWheelOrDrag: GRAVITY_SUPPRESS_MS }))).toBeGreaterThan(0)
  })

  it('a larger session pulls harder than a smaller one, all else equal', () => {
    const small = gravityStep(baseGravityInput({ letterCount: 5 }))
    const large = gravityStep(baseGravityInput({ letterCount: 5000 }))
    expect(large).toBeGreaterThan(small)
  })

  it('gravityWeight increases monotonically with letter count and stays within its clamp', () => {
    expect(gravityWeight(0)).toBeGreaterThan(0)
    expect(gravityWeight(10)).toBeGreaterThan(gravityWeight(0))
    expect(gravityWeight(100_000)).toBeGreaterThanOrEqual(gravityWeight(10))
    // The clamp is [0.2, 1] on the log term, scaled by k0 (0.22) -- so the
    // weight itself never exceeds k0.
    expect(gravityWeight(100_000)).toBeLessThanOrEqual(0.22 + 1e-9)
  })

  it('never fights the hand: zero frame delta yields zero pull regardless of proximity', () => {
    expect(gravityStep(baseGravityInput({ frameDeltaSeconds: 0 }))).toBe(0)
  })
})

describe('zoomStep', () => {
  const DURATION = 3600 // 1 hour thread

  it('doubles the span per zoom-out press', () => {
    expect(zoomStep(10, 1, DURATION)).toBeCloseTo(20)
  })

  it('halves the span per zoom-in press', () => {
    expect(zoomStep(10, -1, DURATION)).toBeCloseTo(5)
  })

  it('clamps to the 0.5s minimum span', () => {
    expect(zoomStep(0.6, -1, DURATION)).toBeCloseTo(0.5)
  })

  it('clamps to 1.1x the thread duration at the maximum', () => {
    expect(zoomStep(DURATION * 2, 1, DURATION)).toBeCloseTo(DURATION * 1.1)
  })
})

describe('date scrubber day/centre mapping', () => {
  it('dayStartMs floors to the start of the UTC day', () => {
    const noon = Date.UTC(2026, 0, 15, 12, 30, 0)
    const midnight = Date.UTC(2026, 0, 15, 0, 0, 0)
    expect(dayStartMs(noon)).toBe(midnight)
  })

  it('dayIndexOf counts whole days from the first day', () => {
    const firstDay = Date.UTC(2026, 0, 1)
    const tenDaysLater = firstDay + 10 * 86_400_000 + 3_600_000 // + a few hours into day 10
    expect(dayIndexOf(tenDaysLater, firstDay)).toBe(10)
    expect(dayIndexOf(firstDay, firstDay)).toBe(0)
  })

  it('dayIndexToCenterMs lands in the middle of the target day', () => {
    const firstDay = Date.UTC(2026, 0, 1)
    const center = dayIndexToCenterMs(3, firstDay)
    expect(center).toBe(firstDay + 3 * 86_400_000 + 43_200_000)
  })

  it('round-trips: the centre of dayIndexOf(atMs)-th day contains atMs\'s own day', () => {
    const firstDay = Date.UTC(2026, 0, 1)
    const atMs = Date.UTC(2026, 0, 8, 17, 45)
    const index = dayIndexOf(atMs, firstDay)
    const center = dayIndexToCenterMs(index, firstDay)
    expect(dayStartMs(center)).toBe(dayStartMs(atMs))
  })
})

describe('NAV_KEYS', () => {
  it('binds every UI-SPEC keyboard-map row this plan owns', () => {
    const expectedKeys = ['Escape', '[', ']', ',', '.', '+', '-', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'A']
    for (const key of expectedKeys) {
      expect(NAV_KEYS[key]).toBeDefined()
    }
  })

  it('zoom keys map to zoom-in/zoom-out, never swapped', () => {
    expect(NAV_KEYS['+']).toBe('zoom-in')
    expect(NAV_KEYS['-']).toBe('zoom-out')
  })
})

describe('flyTo (reduced motion path)', () => {
  it('jumps instantly to the destination and still announces via onDone', () => {
    const frames: unknown[] = []
    let done = false
    const cancel = flyTo(
      { centerSeconds: 0, spanSeconds: 100 },
      { centerSeconds: 500, spanSeconds: 10 },
      (view) => frames.push(view),
      () => {
        done = true
      },
      { reducedMotion: true },
    )
    expect(frames).toEqual([{ centerSeconds: 500, spanSeconds: 10 }])
    expect(done).toBe(true)
    cancel() // no-op, must not throw
  })
})
