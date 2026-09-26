/**
 * Entering a note. What matters: the flight's progress follows the drawn
 * camera (0 at the start, 1 on landing, monotonic through an eased glide),
 * a card-to-card flight leaves the camera to do all the work (scale 1), and
 * a flight out of the chip starts at exactly the chip's size on screen and
 * grows steadily into the card, so nothing pops or cross-fades.
 */

import { describe, expect, it } from 'vitest'
import { CameraRig, FLY_TAU_MS, type Camera } from '../layout/camera'
import { CIRCLE, DOT_R, collapseForm } from './collapse'
import { flightProgress, flightScale, formScreenWidth } from './enter'

const cam = (zoom: number, panX = 0, panY = 0): Camera => ({ panX, panY, zoom, roll: 0 })

describe('flightProgress', () => {
  it('is 0 at the start and 1 on landing, by zoom in log space', () => {
    const from = cam(0.2)
    const to = cam(3.2)
    expect(flightProgress(from, to, from)).toBe(0)
    expect(flightProgress(from, to, to)).toBe(1)
    expect(flightProgress(from, to, cam(0.8))).toBeCloseTo(0.5, 10)
  })

  it('reads pan when the zoom does not change, and is 1 with nowhere to go', () => {
    expect(flightProgress(cam(1, 0, 0), cam(1, 100, 0), cam(1, 25, 40))).toBeCloseTo(0.25, 10)
    expect(flightProgress(cam(1), cam(1), cam(1))).toBe(1)
  })

  it('never leaves 0..1 and only climbs through a real eased glide', () => {
    const rig = new CameraRig(cam(0.15, 300, 200))
    const from = { ...rig.drawn }
    rig.easeTo(() => cam(2.4, -900, -400), FLY_TAU_MS)
    const to = { ...rig.target }
    let last = 0
    let now = 0
    for (let i = 0; i < 200 && !rig.settled; i += 1) {
      now += 16.7
      rig.tick(now, 16.7)
      const p = flightProgress(from, to, rig.drawn)
      expect(p).toBeGreaterThanOrEqual(last)
      expect(p).toBeLessThanOrEqual(1)
      last = p
    }
    expect(last).toBe(1)
  })
})

describe('flightScale', () => {
  const W = 280

  it('is 1 all the way when the note is a card at both ends', () => {
    const z0 = 0.6
    const z1 = 2.5
    for (let p = 0; p <= 1; p += 0.1) {
      const zoom = Math.exp(Math.log(z0) * (1 - p) + Math.log(z1) * p)
      expect(flightScale(W * z0, W * z1, W, zoom, p)).toBeCloseTo(1, 10)
    }
  })

  it('starts the card at the chip’s size and grows it steadily into the full view', () => {
    const z0 = 0.25 // 70 px on screen: a circle
    const z1 = 2.5
    expect(collapseForm(W * z0)).toBe('circle')
    const fromW = formScreenWidth('circle', W, z0)
    expect(fromW).toBe(CIRCLE.r * 2)
    const toW = formScreenWidth('note', W, z1)
    let lastOnScreen = 0
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const zoom = Math.exp(Math.log(z0) * (1 - p) + Math.log(z1) * p)
      const onScreen = flightScale(fromW, toW, W, zoom, p) * W * zoom
      if (p === 0) expect(onScreen).toBeCloseTo(CIRCLE.r * 2, 8)
      expect(onScreen).toBeGreaterThan(lastOnScreen)
      lastOnScreen = onScreen
    }
    expect(lastOnScreen).toBeCloseTo(W * z1, 6)
  })

  it('lands a leaving card on the dot’s size, and is safe with no size', () => {
    const z0 = 2
    const z1 = 0.05
    const toW = formScreenWidth('dot', W, z1)
    expect(toW).toBe(DOT_R * 2)
    expect(flightScale(W * z0, toW, W, z1, 1) * W * z1).toBeCloseTo(DOT_R * 2, 8)
    expect(formScreenWidth('hidden', W, z1)).toBe(DOT_R * 2)
    expect(flightScale(W, W, 0, 1, 0.5)).toBe(1)
  })
})
