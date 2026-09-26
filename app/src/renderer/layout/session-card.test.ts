/**
 * A session card's view state (02.8 D-05): its size, open or closed, and its
 * transcript scroll live in renderer storage, keyed by tree and note, and are
 * never a commit.
 *
 * What matters: a size never escapes the limits, a storage that throws never
 * breaks a card (it just forgets), one note's view never leaks to another,
 * and "near the bottom" is exactly within 48px.
 */

import { describe, expect, it } from 'vitest'
import {
  CARD_VIEW_STORAGE_KEY,
  NEAR_BOTTOM_PX,
  SESSION_CARD_MAX,
  SESSION_CARD_MIN,
  clampCardSize,
  isNearBottom,
  readCardView,
  writeCardView,
} from './session-card'

const TREE = `sha256:${'a'.repeat(64)}`

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('storage is off')
  },
  setItem: () => {
    throw new Error('storage is full')
  },
}

describe('clampCardSize', () => {
  it('keeps a size inside 280 x 240 to 720 x 960', () => {
    expect(SESSION_CARD_MIN).toEqual({ width: 280, height: 240 })
    expect(SESSION_CARD_MAX).toEqual({ width: 720, height: 960 })
    expect(clampCardSize({ width: 100, height: 5000 })).toEqual({ width: 280, height: 960 })
    expect(clampCardSize({ width: 5000, height: 100 })).toEqual({ width: 720, height: 240 })
  })

  it('leaves a size inside the limits unchanged', () => {
    expect(clampCardSize({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 })
  })

  it('falls back to 360 x 440 for values that are not finite numbers', () => {
    expect(clampCardSize({ width: Number.NaN, height: Number.POSITIVE_INFINITY })).toEqual({
      width: 360,
      height: 440,
    })
    expect(clampCardSize({ width: 'wide' as unknown as number, height: 500 })).toEqual({ width: 360, height: 500 })
  })
})

describe('readCardView and writeCardView', () => {
  it('reads back what was written for the same note, and defaults for another', () => {
    const storage = memoryStorage()
    writeCardView(storage, TREE, 'n5', { closed: true })
    expect(readCardView(storage, TREE, 'n5').closed).toBe(true)
    expect(readCardView(storage, TREE, 'n6')).toEqual({})
    expect(readCardView(storage, `sha256:${'b'.repeat(64)}`, 'n5')).toEqual({})
  })

  it('merges a patch into what is there', () => {
    const storage = memoryStorage()
    writeCardView(storage, TREE, 'n5', { width: 400, height: 500 })
    writeCardView(storage, TREE, 'n5', { scrollTop: 120, atBottom: false })
    expect(readCardView(storage, TREE, 'n5')).toEqual({ width: 400, height: 500, scrollTop: 120, atBottom: false })
    expect(storage.map.has(CARD_VIEW_STORAGE_KEY)).toBe(true)
  })

  it('clamps a stored size on the way in and on the way out', () => {
    const storage = memoryStorage()
    writeCardView(storage, TREE, 'n5', { width: 10, height: 99999 })
    expect(readCardView(storage, TREE, 'n5')).toEqual({ width: 280, height: 960 })
    storage.map.set(CARD_VIEW_STORAGE_KEY, JSON.stringify({ [`${TREE}:n5`]: { width: 5000, height: 50 } }))
    expect(readCardView(storage, TREE, 'n5')).toEqual({ width: 720, height: 240 })
  })

  it('drops fields of the wrong type and survives garbage in storage', () => {
    const storage = memoryStorage()
    storage.map.set(
      CARD_VIEW_STORAGE_KEY,
      JSON.stringify({ [`${TREE}:n5`]: { closed: 'yes', scrollTop: -4, atBottom: true, extra: 1 } }),
    )
    expect(readCardView(storage, TREE, 'n5')).toEqual({ atBottom: true })
    storage.map.set(CARD_VIEW_STORAGE_KEY, '{not json')
    expect(readCardView(storage, TREE, 'n5')).toEqual({})
    writeCardView(storage, TREE, 'n5', { closed: false })
    expect(readCardView(storage, TREE, 'n5')).toEqual({ closed: false })
  })

  it('never throws when storage does, and reads defaults', () => {
    expect(() => writeCardView(throwing, TREE, 'n5', { closed: true })).not.toThrow()
    expect(readCardView(throwing, TREE, 'n5')).toEqual({})
  })
})

describe('isNearBottom', () => {
  it('is near within 48px of the bottom and not beyond', () => {
    expect(NEAR_BOTTOM_PX).toBe(48)
    // scrollHeight 1000, viewport 0: 952 is exactly 48 above the bottom.
    expect(isNearBottom(952, 1000, 0)).toBe(true)
    expect(isNearBottom(951, 1000, 0)).toBe(false)
    expect(isNearBottom(700, 1000, 300)).toBe(true)
    expect(isNearBottom(651, 1000, 300)).toBe(false)
    expect(isNearBottom(652, 1000, 300)).toBe(true)
  })

  it('treats content shorter than the viewport as at the bottom', () => {
    expect(isNearBottom(0, 200, 300)).toBe(true)
  })
})
