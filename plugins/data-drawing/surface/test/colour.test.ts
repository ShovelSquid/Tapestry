/**
 * The node colour is a pure function of the brush description's UTF-8
 * bytes: FNV-1a 32 (Math.imul, unsigned) -> hue. The frozen values below are
 * the reference FNV-1a 32 results; 'ink' and 'ink ' are different brushes to
 * the sim (byte-wise comparison) and must be different colours here.
 */
import { describe, expect, it } from 'vitest'

import { colourFor, fnv1a32 } from '../src/stage/colour'

describe('fnv1a32', () => {
  it('of the empty string is the FNV offset basis 0x811c9dc5', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
  })

  it("of 'ink' is the frozen reference value", () => {
    // Computed once from the reference algorithm and frozen here.
    expect(fnv1a32('ink')).toBe(0xa0e98faf)
  })

  it('of the FNV test vector "a" is 0xe40c292c', () => {
    expect(fnv1a32('a')).toBe(0xe40c292c)
  })

  it('is unsigned and 32-bit for every input', () => {
    for (const s of ['', 'ink', 'rust', 'clay', 'lead', 'loneliness', 'ink ', 'ï', 'ï']) {
      const h = fnv1a32(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it('hashes UTF-8 bytes, so NFC and NFD descriptions differ', () => {
    expect(fnv1a32('ï')).not.toBe(fnv1a32('ï'))
  })
})

describe('colourFor', () => {
  it("gives 'ink' and 'ink ' different colours", () => {
    expect(colourFor('ink').getHex()).not.toBe(colourFor('ink ').getHex())
  })

  it('is deterministic: the same description twice gives the same hex', () => {
    expect(colourFor('rust').getHex()).toBe(colourFor('rust').getHex())
    expect(colourFor('loneliness').getHex()).toBe(colourFor('loneliness').getHex())
  })

  it('uses hue = hash mod 360 / 360 at saturation 0.6 and lightness 0.5', () => {
    const c = colourFor('ink')
    const hsl = c.getHSL({ h: 0, s: 0, l: 0 })
    expect(hsl.h).toBeCloseTo((fnv1a32('ink') % 360) / 360, 6)
    expect(hsl.s).toBeCloseTo(0.6, 6)
    expect(hsl.l).toBeCloseTo(0.5, 6)
  })

  it('the four presets are four distinct colours', () => {
    const hexes = new Set(['ink', 'rust', 'clay', 'lead'].map((d) => colourFor(d).getHex()))
    expect(hexes.size).toBe(4)
  })
})
