/**
 * The camera decides where every click lands and how every gesture feels,
 * and the failures it can have are invisible to a quick look: a zoom anchor
 * that drifts a few pixels during a glide, an ease that runs faster on a
 * 120 Hz display, a roll that goes the long way round, a loop that never
 * stops and keeps the page awake, or a roll-0 canvas that is drawn one
 * rounding step differently from before. Each case below pins one of those.
 *
 * The roll-0 cases use toBe, not toBeCloseTo, on purpose: at roll 0 the
 * camera must reproduce the old formulas bit for bit, so nothing about an
 * unrolled canvas changes.
 */

import { describe, expect, it } from 'vitest'
import {
  CameraRig,
  IDENTITY_CAMERA,
  cameraTransformCss,
  centerOn,
  normalizeRoll,
  panBy,
  screenDeltaToWorld,
  screenToWorld,
  shortestRollDelta,
  step,
  worldToScreen,
  zoomAbout,
  type Camera,
} from './camera'
import { clampZoom } from './wheel'

const MIN = 0.1
const MAX = 5

function cam(panX: number, panY: number, zoom: number, roll: number): Camera {
  return { panX, panY, zoom, roll }
}

function expectCameraClose(a: Camera, b: Camera, digits: number): void {
  const eps = 10 ** -digits
  expect(Math.abs(a.panX - b.panX)).toBeLessThan(eps)
  expect(Math.abs(a.panY - b.panY)).toBeLessThan(eps)
  expect(Math.abs(a.zoom - b.zoom)).toBeLessThan(eps)
  expect(Math.abs(shortestRollDelta(a.roll, b.roll))).toBeLessThan(eps)
}

/** Runs step at the given frame intervals and returns the final drawn camera. */
function runSteps(drawn: Camera, target: Camera, dts: number[], tau: number): Camera {
  let c = drawn
  for (const dt of dts) c = step(c, target, dt, tau).camera
  return c
}

describe('cameraTransformCss', () => {
  it('produces exactly the old string at roll 0', () => {
    expect(cameraTransformCss(cam(12.5, -3, 1.25, 0))).toBe('translate(12.5px, -3px) scale(1.25)')
  })

  it('inserts the rotation between translate and scale when rolled', () => {
    expect(cameraTransformCss(cam(12.5, -3, 1.25, 30))).toBe(
      'translate(12.5px, -3px) rotate(30deg) scale(1.25)',
    )
  })
})

describe('roll-0 identity with the old formulas', () => {
  const c = cam(37.25, -112.5, 1.7, 0)

  it('screenToWorld is (s - pan) / zoom exactly', () => {
    const w = screenToWorld(c, 413.3, 91.7)
    expect(w.x).toBe((413.3 - 37.25) / 1.7)
    expect(w.y).toBe((91.7 - -112.5) / 1.7)
  })

  it('zoomAbout is the old anchored-zoom formula exactly', () => {
    const factor = 1.37
    const sx = 300.5
    const sy = 211.25
    const next = zoomAbout(c, factor, sx, sy, MIN, MAX)
    const newZoom = clampZoom(c.zoom * factor, MIN, MAX)
    const ratio = newZoom / c.zoom
    expect(next.zoom).toBe(newZoom)
    expect(next.panX).toBe(sx - ratio * (sx - c.panX))
    expect(next.panY).toBe(sy - ratio * (sy - c.panY))
    expect(next.roll).toBe(0)
  })

  it('centerOn is viewport / 2 - world * zoom exactly', () => {
    const next = centerOn(c, 120.5, -40.25, 1280, 777)
    expect(next.panX).toBe(1280 / 2 - 120.5 * 1.7)
    expect(next.panY).toBe(777 / 2 - -40.25 * 1.7)
    expect(next.zoom).toBe(1.7)
  })
})

describe('rotation direction and inverse', () => {
  it('positive roll is clockwise on screen, like CSS rotate', () => {
    const p = worldToScreen(cam(0, 0, 1, 90), 1, 0)
    expect(Math.abs(p.x - 0)).toBeLessThan(1e-12)
    expect(Math.abs(p.y - 1)).toBeLessThan(1e-12)
  })

  it('worldToScreen inverts screenToWorld at every roll and zoom', () => {
    for (const roll of [0, 37, -120, 180]) {
      for (const zoom of [0.1, 1, 4.2]) {
        const c = cam(55.5, -20, zoom, roll)
        for (const [sx, sy] of [[0, 0], [640.25, 380.5], [-90, 1200]]) {
          const w = screenToWorld(c, sx, sy)
          const back = worldToScreen(c, w.x, w.y)
          expect(Math.abs(back.x - sx)).toBeLessThan(1e-9)
          expect(Math.abs(back.y - sy)).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('screenDeltaToWorld matches the difference of two screenToWorld calls', () => {
    const c = cam(10, 20, 1.8, 37)
    const a = screenToWorld(c, 100, 200)
    const b = screenToWorld(c, 100 + 33, 200 - 17)
    const d = screenDeltaToWorld(33, -17, 1.8, 37)
    expect(Math.abs(d.x - (b.x - a.x))).toBeLessThan(1e-9)
    expect(Math.abs(d.y - (b.y - a.y))).toBeLessThan(1e-9)
  })

  it('screenDeltaToWorld is exactly d / zoom at roll 0', () => {
    const d = screenDeltaToWorld(33.3, -17.1, 1.8, 0)
    expect(d.x).toBe(33.3 / 1.8)
    expect(d.y).toBe(-17.1 / 1.8)
  })
})

describe('zoomAbout anchor', () => {
  const sx = 412.5
  const sy = 233.25

  for (const roll of [0, 37]) {
    it(`keeps the world point under the cursor fixed at roll ${roll}, including at the clamps`, () => {
      for (const [zoom, factor] of [[1, 1.4], [1, 0.6], [4.5, 3], [0.15, 0.2]]) {
        const c = cam(-80, 145, zoom, roll)
        const before = screenToWorld(c, sx, sy)
        const next = zoomAbout(c, factor, sx, sy, MIN, MAX)
        const after = screenToWorld(next, sx, sy)
        expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9)
        expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9)
      }
    })
  }

  it('a burst of three notches on the target does not drift', () => {
    let target = cam(-80, 145, 1, 37)
    const anchor = screenToWorld(target, sx, sy)
    for (let i = 0; i < 3; i += 1) target = zoomAbout(target, 1.25, sx, sy, MIN, MAX)
    const after = screenToWorld(target, sx, sy)
    expect(Math.abs(after.x - anchor.x)).toBeLessThan(1e-9)
    expect(Math.abs(after.y - anchor.y)).toBeLessThan(1e-9)
  })
})

describe('roll normalisation', () => {
  it('maps into (-180, 180]', () => {
    expect(normalizeRoll(190)).toBe(-170)
    expect(normalizeRoll(-190)).toBe(170)
    expect(normalizeRoll(-180)).toBe(180)
    expect(normalizeRoll(540)).toBe(180)
    expect(normalizeRoll(720)).toBe(0)
  })

  it('returns in-range values unchanged, bit for bit', () => {
    for (const r of [0, 0.1 + 0.2, -179.999999, 180, 37.123456789]) {
      expect(normalizeRoll(r)).toBe(r)
    }
  })

  it('shortestRollDelta goes the short way across the seam', () => {
    expect(shortestRollDelta(170, -170)).toBe(20)
    expect(shortestRollDelta(-170, 170)).toBe(-20)
  })
})

describe('step', () => {
  it('eases zoom in log space', () => {
    const tau = 70
    const out = step(cam(0, 0, 1, 0), cam(0, 0, 4, 0), tau * Math.LN2, tau)
    expect(Math.abs(out.camera.zoom - 2)).toBeLessThan(1e-12)
  })

  it('eases a pure translation linearly', () => {
    const tau = 200
    const dt = 16
    const k = 1 - Math.exp(-dt / tau)
    const from = cam(10, -40, 1.5, 22)
    const to = cam(1510, 960, 1.5, 22)
    const out = step(from, to, dt, tau).camera
    expect(Math.abs(out.panX - (10 + k * 1500))).toBeLessThan(1e-9)
    expect(Math.abs(out.panY - (-40 + k * 1000))).toBeLessThan(1e-9)
    expect(out.zoom).toBe(1.5)
  })

  it('is independent of frame rate', () => {
    const from = cam(-300, 120, 0.8, -20)
    const to = cam(450, -260, 2.9, 65)
    const tau = 70
    const at60 = runSteps(from, to, Array(6).fill(100 / 6), tau)
    const at120 = runSteps(from, to, Array(12).fill(100 / 12), tau)
    const irregular = runSteps(from, to, [3, 21.5, 9, 30, 0.5, 16, 20], tau)
    expectCameraClose(at60, at120, 6)
    expectCameraClose(at60, irregular, 6)
  })

  it('holds the zoom anchor fixed on screen for the whole ease', () => {
    const sx = 700
    const sy = 150
    const drawn0 = cam(-230, 410, 1.1, 37)
    const anchor = screenToWorld(drawn0, sx, sy)
    const target = zoomAbout(drawn0, 3.2, sx, sy, MIN, MAX)
    let drawn = drawn0
    for (let i = 0; i < 40; i += 1) {
      const out = step(drawn, target, 1000 / 60, 70)
      drawn = out.camera
      const p = worldToScreen(drawn, anchor.x, anchor.y)
      expect(Math.abs(p.x - sx)).toBeLessThan(0.5)
      expect(Math.abs(p.y - sy)).toBeLessThan(0.5)
      if (out.settled) break
    }
  })

  it('jumps to the target when tau is 0', () => {
    const target = cam(5, 6, 2, 45)
    const out = step(cam(0, 0, 1, 0), target, 16, 0)
    expect(out.settled).toBe(true)
    expect(out.camera).toEqual(target)
  })

  it('leaves the drawn camera unchanged when dt is 0', () => {
    const drawn = cam(3, 4, 1.2, 10)
    const out = step(drawn, cam(300, 400, 2.4, 50), 0, 70)
    expect(out.settled).toBe(false)
    expectCameraClose(out.camera, drawn, 12)
  })

  it('settles on a long fly within 3 s and lands exactly on the target', () => {
    const target = cam(5000, 0, 1, 0)
    let drawn = cam(0, 0, 1, 0)
    let settledAt = -1
    for (let i = 1; i <= 180; i += 1) {
      const out = step(drawn, target, 1000 / 60, 200)
      drawn = out.camera
      if (out.settled) {
        settledAt = i
        break
      }
    }
    expect(settledAt).toBeGreaterThan(0)
    expect(drawn).toEqual(target)
  })
})

describe('CameraRig', () => {
  it('direct applies to both target and drawn', () => {
    const rig = new CameraRig(cam(0, 0, 1, 0))
    rig.direct((c) => panBy(c, 12, -7))
    expect(rig.target).toEqual(cam(12, -7, 1, 0))
    expect(rig.drawn).toEqual(cam(12, -7, 1, 0))
    expect(rig.settled).toBe(true)
  })

  it('hold stops an ease where it is drawn', () => {
    const rig = new CameraRig(cam(0, 0, 1, 0))
    rig.easeTo((c) => panBy(c, 1000, 0), 200)
    rig.tick(16, 16)
    const drawn = rig.drawn
    rig.hold()
    expect(rig.target).toEqual(drawn)
    expect(rig.settled).toBe(true)
    expect(rig.tick(32, 16)).toBe(false)
  })

  it('rejects a non-finite target', () => {
    const rig = new CameraRig(IDENTITY_CAMERA)
    rig.easeTo((c) => ({ ...c, zoom: Number.NaN }), 70)
    expect(rig.target).toEqual(IDENTITY_CAMERA)
    rig.easeTo((c) => ({ ...c, panX: Number.POSITIVE_INFINITY }), 70)
    expect(rig.target).toEqual(IDENTITY_CAMERA)
    expect(rig.tick(16, 16)).toBe(false)
  })

  it('stops ticking once settled and then leaves drawn alone', () => {
    const rig = new CameraRig(IDENTITY_CAMERA)
    rig.easeTo((c) => zoomAbout(c, 2, 400, 300, MIN, MAX), 70)
    let t = 0
    let frames = 0
    while (rig.tick((t += 16), 16)) {
      frames += 1
      expect(frames).toBeLessThan(200)
    }
    const settled = rig.drawn
    expect(settled).toEqual(rig.target)
    expect(rig.tick((t += 16), 16)).toBe(false)
    expect(rig.drawn).toEqual(settled)
  })

  it('direct during an ease shifts both cameras and keeps the ease going', () => {
    const rig = new CameraRig(IDENTITY_CAMERA)
    rig.easeTo((c) => panBy(c, 1000, 0), 200)
    rig.tick(16, 16)
    const target = rig.target
    const drawn = rig.drawn
    rig.direct((c) => panBy(c, 5, 9))
    expect(rig.target).toEqual(panBy(target, 5, 9))
    expect(rig.drawn).toEqual(panBy(drawn, 5, 9))
    expect(rig.tick(32, 16)).toBe(true)
  })
})
