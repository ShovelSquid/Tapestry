import { describe, expect, it } from 'vitest'
import {
  createTracker,
  liveParticles,
  particleStreak,
  spawnParticles,
  trackMotion,
  trackerAtRest,
  tuningFromLook,
  type Kick,
} from './particles'
import { LOOK } from './values'

/** Feed a path of positions at 60 fps; return every kick with its frame. */
function run(path: Array<{ x: number; y: number }>, zoom = 1, strength = 1): Array<{ i: number; kick: Kick }> {
  const tuning = tuningFromLook(strength)
  const m = createTracker(path[0].x, path[0].y)
  const out: Array<{ i: number; kick: Kick }> = []
  const dt = 1000 / 60
  path.forEach((p, i) => {
    const k = trackMotion(m, p.x, p.y, zoom, i * dt, i === 0 ? 0 : dt, tuning)
    if (k) out.push({ i, kick: k })
  })
  return out
}

function hold(p: { x: number; y: number }, frames: number): Array<{ x: number; y: number }> {
  return Array.from({ length: frames }, () => ({ ...p }))
}

function line(from: { x: number; y: number }, vx: number, vy: number, frames: number): Array<{ x: number; y: number }> {
  return Array.from({ length: frames }, (_, i) => ({ x: from.x + vx * (i + 1), y: from.y + vy * (i + 1) }))
}

describe('move particles', () => {
  it('a still note throws nothing', () => {
    expect(run(hold({ x: 0, y: 0 }, 120))).toEqual([])
  })

  it('starting a fast drag throws specks in the direction of motion, capped by the setting', () => {
    const kicks = run([...hold({ x: 0, y: 0 }, 5), ...line({ x: 0, y: 0 }, 20, 0, 40)])
    expect(kicks.length).toBeGreaterThan(0)
    const first = kicks[0].kick
    expect(first.dx).toBeGreaterThan(0)
    expect(Math.abs(first.dy)).toBeLessThan(1e-9)
    expect(first.count).toBeLessThanOrEqual(LOOK.motion.moveParticles)
  })

  it('a steady drag throws none once it is going', () => {
    const kicks = run([...hold({ x: 0, y: 0 }, 5), ...line({ x: 0, y: 0 }, 6, 0, 200)])
    // Only the start (a change from zero) kicks; nothing after the first 40 frames.
    expect(kicks.every((k) => k.i < 45)).toBe(true)
  })

  it('stopping is a change toward zero: specks fly backward', () => {
    const moving = line({ x: 0, y: 0 }, 20, 0, 60)
    const kicks = run([...moving, ...hold(moving[moving.length - 1], 60)])
    const stop = kicks.find((k) => k.i >= 60)
    expect(stop).toBeDefined()
    expect(stop!.kick.dx).toBeLessThan(0)
  })

  it('a gentle change throws none', () => {
    expect(run([...hold({ x: 0, y: 0 }, 5), ...line({ x: 0, y: 0 }, 1, 0, 60)])).toEqual([])
  })

  it('the cooldown spaces kicks out', () => {
    // A shaky drag: direction flips every 3 frames.
    const path: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }]
    for (let i = 1; i < 120; i++) path.push({ x: path[i - 1].x + (Math.floor(i / 3) % 2 ? 25 : -25), y: 0 })
    const kicks = run(path)
    const dt = 1000 / 60
    for (let j = 1; j < kicks.length; j++) {
      expect((kicks[j].i - kicks[j - 1].i) * dt).toBeGreaterThan(LOOK.detail.particleCooldownMs)
    }
  })

  it('strength 0 means no specks at all', () => {
    expect(tuningFromLook(0).maxCount).toBe(0)
    expect(run([...hold({ x: 0, y: 0 }, 5), ...line({ x: 0, y: 0 }, 30, 0, 40)], 1, 0)).toEqual([])
  })

  it('the tracker comes to rest after the drop', () => {
    const tuning = tuningFromLook(1)
    const m = createTracker(0, 0)
    for (let i = 1; i < 30; i++) trackMotion(m, i * 20, 0, 1, i * 16, 16, tuning)
    for (let i = 30; i < 200; i++) trackMotion(m, 29 * 20, 0, 1, i * 16, 16, tuning)
    expect(trackerAtRest(m)).toBe(true)
  })

  it('specks leave from the two corners facing the change', () => {
    const seq = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    let i = 0
    const ps = spawnParticles(200, 100, { dx: 1, dy: 0, count: 2 }, 0, () => seq[i++ % seq.length])
    expect(ps.map((p) => p.x)).toEqual([200, 200])
    expect(new Set(ps.map((p) => p.y))).toEqual(new Set([0, 100]))
    expect(ps[0].vx).toBeCloseTo(1)
  })

  it('a streak flies out, fades, and keeps its screen size at any zoom', () => {
    const [p] = spawnParticles(100, 100, { dx: 0, dy: 1, count: 1 }, 0, () => 0.5)
    expect(particleStreak(p, -1, 1)).toBeNull()
    const a = particleStreak(p, 50, 1)!
    const b = particleStreak(p, 50, 2)!
    expect(a.alpha).toBeGreaterThan(0)
    expect(a.alpha).toBeLessThanOrEqual(0.5)
    expect(b.y2 - b.y1).toBeCloseTo((a.y2 - a.y1) / 2)
    expect(particleStreak(p, p.life + 1, 1)).toBeNull()
    expect(liveParticles([p], p.life + 1)).toEqual([])
  })
})
