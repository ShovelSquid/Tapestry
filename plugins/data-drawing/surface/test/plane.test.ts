/**
 * plane.ts is pure math, so its numbers are pinned here without a browser:
 * the viewport centre is (0, 0), the edges land where the fixed camera's fov
 * says, a parallel plane scales by its distance, a plane edge-on to the view
 * misses, and the Q16.16 frame encoding is what StrokeBegin expects.
 */
import { describe, expect, it } from 'vitest'

import { FIXED_CAMERA } from '../src/camera'
import { DEFAULT_PLANE, frameToQ16, rayPlane, type PlaneFrame } from '../src/plane'

const VIEWPORT = { width: 1600, height: 1000 }
const ASPECT = VIEWPORT.width / VIEWPORT.height
const DIST = FIXED_CAMERA.position[2] // 120, camera to the default plane
const HALF_TAN = Math.tan((FIXED_CAMERA.fovDeg * Math.PI) / 360) // tan(20 deg)

function hit(frame: PlaneFrame, x: number, y: number): { u: number; v: number } {
  const h = rayPlane(FIXED_CAMERA, VIEWPORT, frame, x, y)
  if (h === null) throw new Error(`expected a hit at (${x}, ${y})`)
  return h
}

describe('rayPlane against the fixed camera', () => {
  it('maps the viewport centre to (0, 0) on the default plane', () => {
    const h = hit(DEFAULT_PLANE, 800, 500)
    expect(Math.abs(h.u)).toBeLessThan(1e-9)
    expect(Math.abs(h.v)).toBeLessThan(1e-9)
  })

  it('maps the right edge middle to u = 120 * tan(20 deg) * 1.6 (~69.88), v = 0', () => {
    const h = hit(DEFAULT_PLANE, 1600, 500)
    const expected = DIST * HALF_TAN * ASPECT
    expect(expected).toBeCloseTo(69.88, 1)
    expect(Math.abs(h.u - expected)).toBeLessThan(1e-3)
    expect(Math.abs(h.v)).toBeLessThan(1e-9)
  })

  it('maps the top edge middle to v = 120 * tan(20 deg) (~43.68), u = 0', () => {
    const h = hit(DEFAULT_PLANE, 800, 0)
    const expected = DIST * HALF_TAN
    expect(expected).toBeCloseTo(43.68, 1)
    expect(Math.abs(h.v - expected)).toBeLessThan(1e-3)
    expect(Math.abs(h.u)).toBeLessThan(1e-9)
  })

  it('a parallel plane at z = 5 scales the same pixel by (120 - 5) / 120', () => {
    const near: PlaneFrame = { origin: [0, 0, 5], right: [1, 0, 0], up: [0, 1, 0] }
    for (const [x, y] of [
      [1200, 300],
      [100, 900],
      [1600, 1000],
    ] as const) {
      const a = hit(DEFAULT_PLANE, x, y)
      const b = hit(near, x, y)
      const k = (DIST - 5) / DIST
      expect(Math.abs(b.u - a.u * k)).toBeLessThan(1e-9)
      expect(Math.abs(b.v - a.v * k)).toBeLessThan(1e-9)
    }
  })

  it('returns null for a plane whose normal is perpendicular to the view direction', () => {
    const edgeOn: PlaneFrame = { origin: [0, 0, 0], right: [1, 0, 0], up: [0, 0, 1] } // normal -y
    expect(rayPlane(FIXED_CAMERA, VIEWPORT, edgeOn, 800, 500)).toBeNull()
  })

  it('returns null when the plane is behind the camera', () => {
    const behind: PlaneFrame = { origin: [0, 0, 200], right: [1, 0, 0], up: [0, 1, 0] }
    expect(rayPlane(FIXED_CAMERA, VIEWPORT, behind, 800, 500)).toBeNull()
  })

  it('returns null for an empty viewport or a non-finite pixel', () => {
    expect(rayPlane(FIXED_CAMERA, { width: 0, height: 1000 }, DEFAULT_PLANE, 0, 0)).toBeNull()
    expect(rayPlane(FIXED_CAMERA, VIEWPORT, DEFAULT_PLANE, Number.NaN, 500)).toBeNull()
    expect(rayPlane(FIXED_CAMERA, VIEWPORT, DEFAULT_PLANE, 800, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('is symmetric: mirrored pixels give mirrored plane coordinates', () => {
    const a = hit(DEFAULT_PLANE, 200, 100)
    const b = hit(DEFAULT_PLANE, 1400, 900)
    expect(Math.abs(a.u + b.u)).toBeLessThan(1e-9)
    expect(Math.abs(a.v + b.v)).toBeLessThan(1e-9)
    expect(a.u).toBeLessThan(0)
    expect(a.v).toBeGreaterThan(0)
  })
})

describe('frameToQ16', () => {
  it('encodes DEFAULT_PLANE as [0,0,0, 65536,0,0, 0,65536,0]', () => {
    expect(Array.from(frameToQ16(DEFAULT_PLANE))).toEqual([0, 0, 0, 65536, 0, 0, 0, 65536, 0])
  })

  it('rounds to the nearest 1/65536 and clamps to int32', () => {
    const f: PlaneFrame = { origin: [1.5, -0.25, 1e9], right: [0.000001, 0, 0], up: [0, -1e9, 0] }
    const q = Array.from(frameToQ16(f))
    expect(q[0]).toBe(98304)
    expect(q[1]).toBe(-16384)
    expect(q[2]).toBe(2147483647)
    expect(q[3]).toBe(0)
    expect(q[7]).toBe(-2147483648)
    expect(frameToQ16(f)).toBeInstanceOf(Int32Array)
    expect(frameToQ16(f).length).toBe(9)
  })
})
