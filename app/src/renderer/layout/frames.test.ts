/**
 * Frame geometry is what keeps a tree's notes inside its own frame and keeps
 * two frames from overlapping (D-15). It is pure arithmetic, so it is pinned
 * here rather than discovered by dragging frames around by hand.
 *
 * The cases that matter are the ones where a sign is easy to get wrong: an
 * empty frame, content at negative local coordinates, and the frame origin
 * offset being applied once rather than twice.
 */

import { describe, expect, it } from 'vitest'
import {
  FRAME_HEADER_HEIGHT,
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
  FRAME_PADDING,
  computeFrameBounds,
} from './frames'

describe('computeFrameBounds', () => {
  it('gives an empty frame the minimum rect at its origin', () => {
    const rect = computeFrameBounds({ x: 0, y: 0 }, [])

    // The header band sits above the padded (empty) content bounds.
    expect(rect).toEqual({
      x: -FRAME_PADDING,
      y: -FRAME_PADDING - FRAME_HEADER_HEIGHT,
      width: FRAME_MIN_WIDTH,
      height: FRAME_MIN_HEIGHT,
    })
  })

  it('pads a single note and still respects the minimum size', () => {
    const rect = computeFrameBounds({ x: 0, y: 0 }, [
      { x: 0, y: 0, width: 280, height: 160 },
    ])

    expect(rect.x).toBe(-FRAME_PADDING)
    expect(rect.y).toBe(-FRAME_PADDING - FRAME_HEADER_HEIGHT)
    // 280 + 96 = 376, under the 480 minimum.
    expect(rect.width).toBe(FRAME_MIN_WIDTH)
    // 160 + 96 + 64 = 320, exactly the minimum.
    expect(rect.height).toBe(FRAME_MIN_HEIGHT)
  })

  it('grows past the minimum once the content is large enough', () => {
    const rect = computeFrameBounds({ x: 0, y: 0 }, [
      { x: 0, y: 0, width: 600, height: 400 },
    ])

    expect(rect.width).toBe(600 + FRAME_PADDING * 2)
    expect(rect.height).toBe(400 + FRAME_PADDING * 2 + FRAME_HEADER_HEIGHT)
  })

  it('follows content to negative local coordinates', () => {
    const rect = computeFrameBounds({ x: 0, y: 0 }, [
      { x: -100, y: -50, width: 280, height: 160 },
      { x: 200, y: 0, width: 280, height: 160 },
    ])

    // The rect starts at the leftmost/topmost content, not at the origin.
    expect(rect.x).toBe(-100 - FRAME_PADDING)
    expect(rect.y).toBe(-50 - FRAME_PADDING - FRAME_HEADER_HEIGHT)
    // Content spans x -100..480 (580) and y -50..160 (210), so both axes are
    // past their minimums and the negative origin is really being carried.
    expect(rect.width).toBe(580 + FRAME_PADDING * 2)
    expect(rect.height).toBe(210 + FRAME_PADDING * 2 + FRAME_HEADER_HEIGHT)
    expect(rect.width).toBeGreaterThan(FRAME_MIN_WIDTH)
    expect(rect.height).toBeGreaterThan(FRAME_MIN_HEIGHT)
  })

  it('applies the frame position exactly once', () => {
    const boxes = [{ x: 0, y: 0, width: 280, height: 160 }]
    const atOrigin = computeFrameBounds({ x: 0, y: 0 }, boxes)
    const moved = computeFrameBounds({ x: 300, y: 200 }, boxes)

    expect(moved.x).toBe(atOrigin.x + 300)
    expect(moved.y).toBe(atOrigin.y + 200)
    // Moving a frame never resizes it.
    expect(moved.width).toBe(atOrigin.width)
    expect(moved.height).toBe(atOrigin.height)
  })
})
