import { describe, expect, it } from 'vitest'
import {
  MOTION_EFFECTS,
  MOTION_LABELS,
  MOTION_STORAGE_KEY,
  allStill,
  defaultMotionSettings,
  loadMotionSettings,
  motionCssVars,
  readMotionSettings,
  setMotionSettings,
  subscribeMotionSettings,
  withAll,
  withEffect,
} from './motion'
import { motionLevel, waveGlyphPath } from './MotionPanel'

class MemoryStorage {
  map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
}

describe('motion settings panel', () => {
  it('labels every effect', () => {
    for (const e of MOTION_EFFECTS) expect(MOTION_LABELS[e].length).toBeGreaterThan(0)
  })

  it('rifling and text bob start on at low strength (gate 4)', () => {
    const d = defaultMotionSettings(false)
    expect(d.rifling.on).toBe(true)
    expect(d.textBob.on).toBe(true)
    expect(d.rifling.strength).toBeLessThan(0.5)
    expect(d.textBob.strength).toBeLessThan(0.5)
  })

  it('one switch or slider changes one effect', () => {
    const d = defaultMotionSettings(false)
    const off = withEffect(d, 'particles', { on: false })
    expect(off.particles.on).toBe(false)
    expect(off.particles.strength).toBe(d.particles.strength)
    expect(off.bob).toEqual(d.bob)
    expect(withEffect(d, 'bob', { strength: 2 }).bob.strength).toBe(1)
  })

  it('all off is a still app, and all on keeps the strengths', () => {
    const d = withEffect(defaultMotionSettings(false), 'bob', { strength: 0.4 })
    const off = withAll(d, false)
    expect(allStill(off)).toBe(true)
    expect(motionLevel(off)).toBe(0)
    expect(motionCssVars(off)['--tap-motion-swell']).toBe('0')
    const on = withAll(off, true)
    expect(on.bob.strength).toBe(0.4)
    expect(allStill(on)).toBe(false)
  })

  it('every effect off one at a time also ends still', () => {
    let s = defaultMotionSettings(false)
    for (const e of MOTION_EFFECTS) s = withEffect(s, e, { on: false })
    expect(allStill(s)).toBe(true)
  })

  it('saves for the person and tells listeners', () => {
    const storage = new MemoryStorage()
    let told = 0
    const off = subscribeMotionSettings(() => told++)
    const next = withAll(defaultMotionSettings(false), false)
    setMotionSettings(next, storage)
    off()
    expect(told).toBe(1)
    expect(readMotionSettings()).toEqual(next)
    expect(storage.map.has(MOTION_STORAGE_KEY)).toBe(true)
    expect(loadMotionSettings(storage, false)).toEqual(next)
  })

  it('the button glyph flattens as motion goes off', () => {
    expect(waveGlyphPath(0)).toBe('M2 10 C5 10 7 10 10 10 S15 10 18 10')
    expect(waveGlyphPath(1)).not.toBe(waveGlyphPath(0))
  })
})
