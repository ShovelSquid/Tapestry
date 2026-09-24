/**
 * Wheel math drives how fast the canvas pans and zooms, so it is pinned here
 * rather than discovered by scrolling and squinting. The cases that matter
 * are the ones a raw eyeball check would miss: each deltaMode branch
 * (pixel/line/page) actually changes the output, the pinch/wheel rate split
 * produces genuinely different factors for the same input delta (not just
 * differently-rounded ones), and the pinch boundary is exclusive (`<`, not
 * `<=`) so a value exactly at the threshold reads as a wheel notch.
 */

import { describe, expect, it } from 'vitest'
import {
  PIXELS_PER_LINE,
  clampZoom,
  isZoomPinchDelta,
  normalizeWheelDelta,
  panDelta,
  zoomFactor,
} from './wheel'

describe('normalizeWheelDelta', () => {
  it('passes pixel-mode deltas through unchanged, including negative values', () => {
    expect(normalizeWheelDelta(10, 0)).toBe(10)
    expect(normalizeWheelDelta(-5, 0)).toBe(-5)
  })

  it('scales line-mode deltas by PIXELS_PER_LINE', () => {
    expect(normalizeWheelDelta(3, 1)).toBe(3 * PIXELS_PER_LINE)
    expect(normalizeWheelDelta(3, 1)).toBe(48)
  })

  it('scales page-mode deltas by the 800px defensive fallback', () => {
    expect(normalizeWheelDelta(2, 2)).toBe(1600)
  })
})

describe('isZoomPinchDelta', () => {
  it('treats small normalized deltas as a pinch', () => {
    expect(isZoomPinchDelta(5)).toBe(true)
    expect(isZoomPinchDelta(24)).toBe(true)
  })

  it('treats the threshold and above as a wheel notch, not a pinch (boundary is exclusive)', () => {
    expect(isZoomPinchDelta(25)).toBe(false)
    expect(isZoomPinchDelta(100)).toBe(false)
  })
})

describe('zoomFactor', () => {
  it('uses independently tuned rates for pinch vs wheel at the same input delta', () => {
    expect(zoomFactor(5, true)).toBe(Math.exp(-5 * 0.035))
    expect(zoomFactor(5, false)).toBe(Math.exp(-5 * 0.0022))
    expect(zoomFactor(5, true)).not.toBe(zoomFactor(5, false))
  })

  it('is more sensitive for pinch than for wheel at the same magnitude', () => {
    expect(Math.abs(1 - zoomFactor(20, true))).toBeGreaterThan(Math.abs(1 - zoomFactor(20, false)))
  })
})

describe('clampZoom', () => {
  it('clamps below-min, above-max, and passes in-range values through', () => {
    expect(clampZoom(0.05, 0.1, 5)).toBe(0.1)
    expect(clampZoom(10, 0.1, 5)).toBe(5)
    expect(clampZoom(2, 0.1, 5)).toBe(2)
  })
})

describe('panDelta', () => {
  it('scales pixel-mode deltas by PAN_SENSITIVITY', () => {
    expect(panDelta(10, 0)).toBe(16)
  })

  it('normalizes line-mode deltas before scaling by PAN_SENSITIVITY', () => {
    expect(panDelta(2, 1)).toBe(51.2)
  })
})
