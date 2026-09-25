import { describe, expect, it } from 'vitest'
import { DEFAULT_SLOWDOWN, HZ, dotRateAt, parseSlowdown, type SlowdownCurve } from './slowdown'

describe('parseSlowdown', () => {
  it('parses the "<seconds>:<rate> ..." property form, sorted ascending', () => {
    expect(parseSlowdown('30:10 10:30 60:1')).toEqual([
      { afterSeconds: 10, ratePerSecond: 30 },
      { afterSeconds: 30, ratePerSecond: 10 },
      { afterSeconds: 60, ratePerSecond: 1 },
    ])
  })

  it('parses the D-11 default text into DEFAULT_SLOWDOWN', () => {
    expect(parseSlowdown('10:30 30:10 60:1')).toEqual(DEFAULT_SLOWDOWN)
  })

  it('throws on a malformed breakpoint', () => {
    expect(() => parseSlowdown('not-a-breakpoint')).toThrow()
    expect(() => parseSlowdown('10:thirty')).toThrow()
  })

  it('tolerates surrounding and repeated whitespace', () => {
    expect(parseSlowdown('  10:30   30:10  60:1  ')).toEqual(DEFAULT_SLOWDOWN)
  })
})

describe('dotRateAt', () => {
  it('returns 60, ~30, ~10 and 1 at 0s, 10s, 30s and 60s since last input (D-11)', () => {
    expect(dotRateAt(DEFAULT_SLOWDOWN, 0)).toBe(60)
    expect(dotRateAt(DEFAULT_SLOWDOWN, 10)).toBe(30)
    expect(dotRateAt(DEFAULT_SLOWDOWN, 30)).toBe(10)
    expect(dotRateAt(DEFAULT_SLOWDOWN, 60)).toBe(1)
  })

  it('holds the rate between breakpoints', () => {
    expect(dotRateAt(DEFAULT_SLOWDOWN, 5)).toBe(60)
    expect(dotRateAt(DEFAULT_SLOWDOWN, 20)).toBe(30)
    expect(dotRateAt(DEFAULT_SLOWDOWN, 45)).toBe(10)
  })

  it('holds at the last breakpoint rate indefinitely (until the caller times out the session)', () => {
    expect(dotRateAt(DEFAULT_SLOWDOWN, 60 * 60)).toBe(1)
  })

  it('is HZ before the first breakpoint on an empty curve', () => {
    expect(dotRateAt([], 1000)).toBe(HZ)
  })
})

// ---------------------------------------------------------------------------
// D-12/D-13: the accumulated dot count over a pause is a Riemann sum of
// dotRateAt sampled at real-seconds intervals. Because the D-11 default
// breakpoints (10s, 30s, 60s) are whole seconds, they land exactly on the
// sample grid for both a 60Hz and a 120Hz step, so a left Riemann sum over
// either grid lands on the exact same total — this is the sense in which
// "a 120Hz display draws the same line" a 60Hz display does (D-13).
// ---------------------------------------------------------------------------

function accumulatedDots(curve: SlowdownCurve, totalSeconds: number, hz: number): number {
  const dt = 1 / hz
  const steps = Math.round(totalSeconds * hz)
  let total = 0
  for (let i = 0; i < steps; i++) {
    const t = i * dt
    total += dotRateAt(curve, t) * dt
  }
  return total
}

describe('the slowdown integral (D-12/D-13)', () => {
  it('is identical when sampled at 60Hz and at 120Hz over the same interval', () => {
    const at60 = accumulatedDots(DEFAULT_SLOWDOWN, 90, 60)
    const at120 = accumulatedDots(DEFAULT_SLOWDOWN, 90, 120)
    expect(at60).toBeCloseTo(at120, 6)
  })

  it('is continuous at each breakpoint: the accumulated total does not jump beyond one sample step\'s worth of rate change', () => {
    const hz = 600 // fine enough to bound the discrete step size tightly
    const dt = 1 / hz
    for (const breakpoint of DEFAULT_SLOWDOWN) {
      const before = accumulatedDots(DEFAULT_SLOWDOWN, breakpoint.afterSeconds - dt, hz)
      const at = accumulatedDots(DEFAULT_SLOWDOWN, breakpoint.afterSeconds, hz)
      const jump = at - before
      // One sample's worth of the higher of the two surrounding rates is the
      // largest a single discrete step can contribute; a true discontinuity
      // in the accumulated total would be orders of magnitude larger.
      const rateBefore = dotRateAt(DEFAULT_SLOWDOWN, breakpoint.afterSeconds - dt)
      expect(jump).toBeLessThanOrEqual(rateBefore * dt * 1.001)
    }
  })
})
