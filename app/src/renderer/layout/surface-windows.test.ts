/**
 * Plugin surfaces open as floating windows. What matters here: a window can
 * never be lost off screen or squeezed to nothing, a west/north resize keeps
 * the opposite edge still, and opening an open surface raises it rather than
 * mounting it twice.
 */

import { describe, expect, it } from 'vitest'
import {
  GRAB_MARGIN,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  TITLE_BAR_HEIGHT,
  clampRect,
  clampWindows,
  defaultRect,
  moveRect,
  openWindow,
  raiseWindow,
  resizeRect,
} from './surface-windows'

const VIEW = { width: 1600, height: 1000 }
const RECT = { x: 200, y: 100, width: 800, height: 600 }

describe('clampRect', () => {
  it('leaves a rect that already fits alone', () => {
    expect(clampRect(RECT, VIEW)).toEqual(RECT)
  })

  it('enforces the minimum size and the viewport size', () => {
    expect(clampRect({ x: 0, y: 0, width: 10, height: 10 }, VIEW)).toMatchObject({
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
    })
    expect(clampRect({ x: 0, y: 0, width: 5000, height: 5000 }, VIEW)).toMatchObject({
      width: VIEW.width,
      height: VIEW.height,
    })
  })

  it('keeps the title bar reachable', () => {
    const far = clampRect({ ...RECT, x: 99999, y: 99999 }, VIEW)
    expect(far.x).toBe(VIEW.width - GRAB_MARGIN)
    expect(far.y).toBe(VIEW.height - TITLE_BAR_HEIGHT)

    const behind = clampRect({ ...RECT, x: -99999, y: -50 }, VIEW)
    expect(behind.x + behind.width).toBe(GRAB_MARGIN)
    expect(behind.y).toBe(0)
  })

  it('fits a viewport smaller than the minimum', () => {
    const tiny = { width: 200, height: 150 }
    expect(clampRect(RECT, tiny)).toEqual({ x: 0, y: 0, width: 200, height: 150 })
  })
})

describe('defaultRect', () => {
  it('centres the first window and cascades the next', () => {
    const first = defaultRect(VIEW, 0)
    expect(first.x * 2 + first.width).toBe(VIEW.width)
    const second = defaultRect(VIEW, 1)
    expect(second.x - first.x).toBeGreaterThan(0)
    expect(second.y - first.y).toBe(second.x - first.x)
  })
})

describe('moveRect', () => {
  it('moves by the pointer delta and keeps the size', () => {
    expect(moveRect(RECT, 50, -20, VIEW)).toEqual({ ...RECT, x: 250, y: 80 })
  })
})

describe('resizeRect', () => {
  it('grows from the south-east corner', () => {
    expect(resizeRect(RECT, 'se', 100, 50, VIEW)).toEqual({ ...RECT, width: 900, height: 650 })
  })

  it('keeps the right edge still on a west drag, stopping at the minimum', () => {
    const right = RECT.x + RECT.width
    const grown = resizeRect(RECT, 'w', -100, 0, VIEW)
    expect(grown.x + grown.width).toBe(right)
    expect(grown.width).toBe(900)

    const shrunk = resizeRect(RECT, 'w', 5000, 0, VIEW)
    expect(shrunk.width).toBe(MIN_WINDOW_WIDTH)
    expect(shrunk.x + shrunk.width).toBe(right)
  })

  it('keeps the bottom edge still on a north drag and stops at the top', () => {
    const bottom = RECT.y + RECT.height
    const r = resizeRect(RECT, 'n', 0, -500, VIEW)
    expect(r.y).toBe(0)
    expect(r.y + r.height).toBe(bottom)
  })

  it('never grows past the viewport', () => {
    const r = resizeRect(RECT, 'e', 5000, 0, VIEW)
    expect(r.x + r.width).toBe(VIEW.width)
  })
})

describe('the open windows', () => {
  const a = { id: 'a' }
  const b = { id: 'b' }

  it('opens at the remembered rect, or the default', () => {
    const one = openWindow([], a, 't1', VIEW, RECT)
    expect(one).toEqual([{ surface: a, treeId: 't1', rect: RECT, maximized: false }])
    const two = openWindow(one, b, 't1', VIEW, null)
    expect(two[1].rect).toEqual(defaultRect(VIEW, 1))
  })

  it('raises an open surface instead of opening it twice', () => {
    const both = openWindow(openWindow([], a, 't1', VIEW, null), b, 't1', VIEW, null)
    const again = openWindow(both, a, 't2', VIEW, null)
    expect(again.map((w) => w.surface.id)).toEqual(['b', 'a'])
    expect(again[1].treeId).toBe('t1')
  })

  it('raising the top window changes nothing', () => {
    const both = openWindow(openWindow([], a, 't', VIEW, null), b, 't', VIEW, null)
    expect(raiseWindow(both, 'b')).toBe(both)
  })

  it('re-clamps every window for a smaller viewport', () => {
    const one = openWindow([], a, 't', VIEW, { x: 1200, y: 700, width: 800, height: 600 })
    const small = { width: 900, height: 700 }
    const [w] = clampWindows(one, small)
    expect(w.rect.width).toBe(800)
    expect(w.rect.x).toBeLessThanOrEqual(small.width - GRAB_MARGIN)
    expect(w.rect.y).toBeLessThanOrEqual(small.height - TITLE_BAR_HEIGHT)
  })
})
