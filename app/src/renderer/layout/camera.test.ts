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
  ROLL_SNAP_IDLE_MS,
  layoutSize,
  panBy,
  rollAbout,
  rollDeltaFromWheel,
  rollTo,
  screenDeltaToWorld,
  screenToElementLocal,
  screenToWorld,
  shortestRollDelta,
  snapRoll,
  step,
  worldToScreen,
  zoomAbout,
  type Camera,
} from './camera'
import { PIXELS_PER_LINE, clampZoom } from './wheel'

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

describe('roll about a point', () => {
  const sx = 512.5
  const sy = 300.25

  it('rollAbout keeps the world point under (sx, sy) fixed', () => {
    for (const delta of [15, -90, 137, 180]) {
      const c = cam(-40, 220, 1.6, 25)
      const before = screenToWorld(c, sx, sy)
      const after = screenToWorld(rollAbout(c, delta, sx, sy), sx, sy)
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9)
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9)
    }
  })

  it('+90 then -90 returns the original camera', () => {
    const c = cam(-40, 220, 1.6, 25)
    expectCameraClose(rollAbout(rollAbout(c, 90, sx, sy), -90, sx, sy), c, 9)
  })

  it('rollTo lands on the exact angle', () => {
    const c = cam(-40, 220, 1.6, 33.3333)
    expect(rollTo(c, 0, sx, sy).roll).toBe(0)
    expect(rollTo(c, -180, sx, sy).roll).toBe(180)
  })

  it('step takes the short way across the seam', () => {
    const tau = 80
    const first = step(cam(0, 0, 1, 170), cam(0, 0, 1, -170), 16, tau).camera
    expect(first.roll > 170 || first.roll < -170).toBe(true)
    let c = cam(0, 0, 1, 170)
    let travelled = 0
    for (let i = 0; i < 200; i += 1) {
      const out = step(c, cam(0, 0, 1, -170), 16, tau)
      travelled += Math.abs(shortestRollDelta(c.roll, out.camera.roll))
      c = out.camera
      if (out.settled) break
    }
    expect(c.roll).toBe(-170)
    expect(Math.abs(travelled - 20)).toBeLessThan(1e-9)
  })
})

describe('snapRoll', () => {
  it('snaps within 4 degrees of a quarter turn, inclusive', () => {
    expect(snapRoll(3)).toBe(0)
    expect(snapRoll(-4)).toBe(0)
    expect(snapRoll(4.01)).toBeNull()
    expect(snapRoll(88)).toBe(90)
    expect(snapRoll(-92)).toBe(-90)
    expect(snapRoll(178)).toBe(180)
    expect(snapRoll(-177)).toBe(180)
    expect(snapRoll(45)).toBeNull()
  })
})

describe('rollDeltaFromWheel', () => {
  it('turns 0.25 degrees per pixel on the dominant axis', () => {
    expect(rollDeltaFromWheel(0, 100, 0)).toBe(25)
    expect(rollDeltaFromWheel(100, 0, 0)).toBe(25)
    expect(rollDeltaFromWheel(10, -100, 0)).toBe(-25)
  })

  it('normalises line-mode deltas first', () => {
    expect(rollDeltaFromWheel(0, 3, 1)).toBe(3 * PIXELS_PER_LINE * 0.25)
  })
})

describe('CameraRig soft snap', () => {
  const sx = 400
  const sy = 300

  function tickTo(rig: CameraRig, from: number, to: number): boolean {
    let more = false
    for (let t = from + 10; t <= to; t += 10) more = rig.tick(t, 10)
    return more
  }

  it('snaps a near-level roll to level after the idle time, not before', () => {
    const rig = new CameraRig(IDENTITY_CAMERA)
    rig.roll(3, sx, sy, 0)
    tickTo(rig, 0, 100)
    expect(rig.target.roll).toBe(3)
    // The drawn roll has settled at 3 by now, but a snap is still pending.
    expect(tickTo(rig, 100, 140)).toBe(true)
    tickTo(rig, 140, 160)
    expect(rig.target.roll).toBe(0)
  })

  it('never snaps a roll outside the window', () => {
    const rig = new CameraRig(IDENTITY_CAMERA)
    rig.roll(10, sx, sy, 0)
    tickTo(rig, 0, 1000)
    expect(rig.target.roll).toBe(10)
    expect(rig.tick(1010, 10)).toBe(false)
  })

  it('never snaps while roll input continues', () => {
    const rig = new CameraRig(IDENTITY_CAMERA)
    for (let t = 0; t <= 400; t += 50) {
      rig.roll(0.3, sx, sy, t)
      tickTo(rig, t, t + 50)
      if (t + 50 < 400 + ROLL_SNAP_IDLE_MS) expect(rig.target.roll).not.toBe(0)
    }
    tickTo(rig, 450, 400 + ROLL_SNAP_IDLE_MS)
    expect(rig.target.roll).toBe(0)
  })

  it('a direct move or a grab cancels a pending snap', () => {
    const a = new CameraRig(IDENTITY_CAMERA)
    a.roll(3, sx, sy, 0)
    tickTo(a, 0, 50)
    a.direct((c) => panBy(c, 5, 0))
    tickTo(a, 50, 500)
    expect(a.target.roll).toBe(3)

    const b = new CameraRig(IDENTITY_CAMERA)
    b.roll(3, sx, sy, 0)
    tickTo(b, 0, 50)
    b.hold()
    tickTo(b, 50, 500)
    expect(b.target.roll).not.toBe(0)
  })

  it('resetRoll eases to exactly level and arms no snap', () => {
    const rig = new CameraRig(cam(10, 20, 1.3, 47))
    rig.resetRoll(sx, sy)
    expect(rig.target.roll).toBe(0)
    let t = 0
    while (rig.tick((t += 16), 16)) expect(t).toBeLessThan(3000)
    expect(rig.drawn.roll).toBe(0)
  })
})

describe('layoutSize', () => {
  const el = {
    getBoundingClientRect: () => ({ width: 301.7, height: 123.3 }),
    offsetWidth: 240,
    offsetHeight: 98,
  }

  it('is the bounding size over zoom at roll 0', () => {
    expect(layoutSize(el, 1.3, 0)).toEqual({ width: 301.7 / 1.3, height: 123.3 / 1.3 })
  })

  it('is the layout size when rolled', () => {
    expect(layoutSize(el, 1.3, 30)).toEqual({ width: 240, height: 98 })
  })
})

describe('screenToElementLocal', () => {
  it('is (p - topLeft) / zoom at roll 0', () => {
    const local = screenToElementLocal({ x: 300.3, y: 91.1 }, { left: 120.7, top: 40.2 }, { width: 200, height: 80 }, 1.7, 0)
    expect(local.x).toBe((300.3 - 120.7) / 1.7)
    expect(local.y).toBe((91.1 - 40.2) / 1.7)
  })

  it('recovers a local point inside a rotated element from its bounding box', () => {
    const w = 260
    const h = 110
    const originWorld = { x: 75, y: -30 }
    for (const roll of [30, 135, -60, 180]) {
      const c = cam(410, 260, 1.4, roll)
      const corners = [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ].map(([x, y]) => worldToScreen(c, originWorld.x + x, originWorld.y + y))
      const left = Math.min(...corners.map((p) => p.x))
      const top = Math.min(...corners.map((p) => p.y))
      for (const [lx, ly] of [[0, 0], [37.5, 12.25], [w, h], [130, 90]]) {
        const p = worldToScreen(c, originWorld.x + lx, originWorld.y + ly)
        const local = screenToElementLocal(p, { left, top }, { width: w, height: h }, 1.4, roll)
        expect(Math.abs(local.x - lx)).toBeLessThan(1e-6)
        expect(Math.abs(local.y - ly)).toBeLessThan(1e-6)
      }
    }
  })
})
