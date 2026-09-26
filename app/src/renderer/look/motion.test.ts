import { describe, expect, it } from 'vitest'
import {
  Amount,
  MOTION_EFFECTS,
  MOTION_STORAGE_KEY,
  approach,
  bobScale,
  createScheduler,
  defaultMotionSettings,
  easeOutCubic,
  effectStrength,
  loadMotionSettings,
  saveMotionSettings,
  smoothstep,
  type FrameSource,
} from './motion'
import { LOOK } from './values'

class MemoryStorage {
  map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
}

/** A frame source the test steps by hand. */
function manualFrames(): FrameSource & { fire(now: number): void; pending: number } {
  let next = 1
  const cbs = new Map<number, (now: number) => void>()
  return {
    request(cb) {
      const h = next++
      cbs.set(h, cb)
      return h
    },
    cancel(h) {
      cbs.delete(h)
    },
    fire(now) {
      const all = [...cbs.values()]
      cbs.clear()
      for (const cb of all) cb(now)
    },
    get pending() {
      return cbs.size
    },
  }
}

describe('easing', () => {
  it('clamps and hits both ends', () => {
    for (const f of [easeOutCubic, smoothstep]) {
      expect(f(-1)).toBe(0)
      expect(f(0)).toBe(0)
      expect(f(1)).toBe(1)
      expect(f(2)).toBe(1)
    }
  })
  it('smoothstep is symmetric, so in and out follow the same curve', () => {
    for (const t of [0.1, 0.25, 0.4]) expect(smoothstep(t) + smoothstep(1 - t)).toBeCloseTo(1, 12)
  })
  it('approach never overshoots', () => {
    expect(approach(0, 1, 50, 100)).toBeCloseTo(0.5)
    expect(approach(0.9, 1, 50, 100)).toBe(1)
    expect(approach(0.1, 0, 50, 100)).toBe(0)
  })
})

describe('Amount', () => {
  it('reaches its target in its duration', () => {
    const a = new Amount(180)
    a.set(1)
    expect(a.step(90)).toBe(true)
    expect(a.raw).toBeCloseTo(0.5)
    expect(a.step(90)).toBe(false)
    expect(a.value).toBe(1)
  })
  it('reverses from where it is, without a jump', () => {
    const a = new Amount(180)
    a.set(1)
    a.step(60)
    const before = a.value
    a.set(0)
    a.step(0)
    expect(a.value).toBe(before)
    a.step(30)
    expect(a.value).toBeLessThan(before)
    expect(a.value).toBeGreaterThan(0)
  })
  it('jumps to its target at strength 0', () => {
    const a = new Amount(670)
    a.set(1)
    expect(a.step(16, 0)).toBe(false)
    expect(a.value).toBe(1)
  })
})

describe('bobScale', () => {
  const { bobKeyframes, bobMs } = LOOK.motion
  it('starts and ends at 1 and hits each keyframe', () => {
    expect(bobScale(bobKeyframes, bobMs, 0)).toBe(1)
    expect(bobScale(bobKeyframes, bobMs, bobMs)).toBe(1)
    expect(bobScale(bobKeyframes, bobMs, -5)).toBe(1)
    const step = bobMs / bobKeyframes.length
    bobKeyframes.forEach((k, i) => {
      if (i < bobKeyframes.length - 1) expect(bobScale(bobKeyframes, bobMs, step * (i + 1))).toBeCloseTo(k, 10)
    })
  })
  it('scales with strength and is still at 0', () => {
    const t = bobMs / bobKeyframes.length
    expect(bobScale(bobKeyframes, bobMs, t, 0.5) - 1).toBeCloseTo((bobKeyframes[0] - 1) / 2, 10)
    expect(bobScale(bobKeyframes, bobMs, t, 0)).toBe(1)
  })
})

describe('motion settings', () => {
  it('every effect starts on, rifling and text bob at low strength', () => {
    const s = defaultMotionSettings(false)
    for (const e of MOTION_EFFECTS) expect(s[e].on).toBe(true)
    expect(s.rifling.strength).toBeLessThan(1)
    expect(s.textBob.strength).toBeLessThan(1)
    expect(s.bob.strength).toBe(1)
  })
  it('reduce motion starts every effect at off', () => {
    const s = defaultMotionSettings(true)
    for (const e of MOTION_EFFECTS) expect(effectStrength(s, e)).toBe(0)
    expect(loadMotionSettings(new MemoryStorage(), true).bob.on).toBe(false)
  })
  it("the person's saved choice wins over reduce motion", () => {
    const store = new MemoryStorage()
    const s = { ...defaultMotionSettings(true), bob: { on: true, strength: 0.5 } }
    saveMotionSettings(store, s)
    const back = loadMotionSettings(store, true)
    expect(back.bob).toEqual({ on: true, strength: 0.5 })
    expect(back.particles.on).toBe(false)
  })
  it('ignores junk in storage', () => {
    const store = new MemoryStorage()
    store.setItem(MOTION_STORAGE_KEY, '{not json')
    expect(loadMotionSettings(store, false)).toEqual(defaultMotionSettings(false))
    store.setItem(MOTION_STORAGE_KEY, JSON.stringify({ bob: { on: 'yes', strength: 7 }, gone: { on: false } }))
    const s = loadMotionSettings(store, false)
    expect(s.bob).toEqual({ on: true, strength: 1 })
    expect('gone' in s).toBe(false)
  })
})

describe('scheduler', () => {
  it('runs only while subscribed and hands out clamped dt', () => {
    const frames = manualFrames()
    const sched = createScheduler(frames)
    expect(sched.running).toBe(false)
    const seen: number[] = []
    const off = sched.subscribe((_now, dt) => seen.push(dt))
    expect(sched.running).toBe(true)
    frames.fire(1000)
    frames.fire(1016)
    frames.fire(5000)
    expect(seen).toEqual([0, 16, 100])
    off()
    expect(sched.running).toBe(false)
    expect(frames.pending).toBe(0)
  })
  it('shares one frame request between subscribers', () => {
    const frames = manualFrames()
    const sched = createScheduler(frames)
    let a = 0
    let b = 0
    const offA = sched.subscribe(() => a++)
    const offB = sched.subscribe(() => b++)
    expect(frames.pending).toBe(1)
    frames.fire(0)
    offA()
    frames.fire(16)
    expect([a, b]).toEqual([1, 2])
    offB()
    expect(frames.pending).toBe(0)
  })
  it('a subscriber can leave during its own frame', () => {
    const frames = manualFrames()
    const sched = createScheduler(frames)
    let n = 0
    const off = sched.subscribe(() => {
      n++
      off()
    })
    frames.fire(0)
    frames.fire(16)
    expect(n).toBe(1)
    expect(sched.running).toBe(false)
  })
})

describe('look values', () => {
  it("match Kaelen's tuned JSON (2026-09-25)", () => {
    expect(LOOK.line.weightPx).toBe(1)
    expect(LOOK.line.wobblePx).toBe(1.4)
    expect(LOOK.selectionWaves.wavesPerLoop).toBe(2)
    expect(LOOK.motion.bobKeyframes).toEqual([1.01, 0.97, 1.015, 0.995, 1])
    expect(LOOK.motion.selectionGrowMs).toBe(670)
    expect(LOOK.collapse).toEqual({ circleBelowPx: 110, dotBelowPx: 28 })
  })
})
