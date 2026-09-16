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
  FRAME_GAP,
  FRAME_HEADER_HEIGHT,
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
  FRAME_PADDING,
  computeFrameBounds,
  placeNewFrame,
  pushApart,
  type PositionedRect,
} from './frames'

/** A frame-sized rect, so the numbers below read as real frames. */
function frame(id: string, x: number, y: number): PositionedRect {
  return { id, x, y, width: FRAME_MIN_WIDTH, height: FRAME_MIN_HEIGHT }
}

/** The smallest distance between two rects, negative when they overlap. */
function gapBetween(a: PositionedRect, b: PositionedRect): number {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width))
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height))
  // Separated on either axis is enough to be clear of each other.
  return Math.max(dx, dy)
}

/** Apply a pushApart result to the input rects. */
function settle(
  rects: PositionedRect[],
  moved: Map<string, { x: number; y: number }>,
): PositionedRect[] {
  return rects.map((rect) => {
    const next = moved.get(rect.id)
    return next ? { ...rect, x: next.x, y: next.y } : rect
  })
}

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

/**
 * Push-apart is D-15's "trees never overlap" made mechanical. The rules that
 * matter: the frame the person just dropped is the one that stays put, the
 * other frame yields along whichever axis costs it less, and the result is
 * settled -- no pair is left closer than the gap, even in a chain.
 */
describe('pushApart', () => {
  it('pushes an overlapping frame right when that is the smaller move', () => {
    // B overlaps A's 64px margin by 44px horizontally, but clearing it
    // vertically would cost 384px, so the horizontal move wins.
    const rects = [frame('a', 0, 0), frame('b', 500, 0)]

    const moved = pushApart(rects, 'a')

    expect(moved.get('b')).toEqual({ x: 544, y: 0 })
    const [a, b] = settle(rects, moved)
    expect(gapBetween(a, b)).toBe(FRAME_GAP)
  })

  it('pushes down instead when the vertical move is the smaller one', () => {
    const rects = [frame('a', 0, 0), frame('b', 0, 340)]

    const moved = pushApart(rects, 'a')

    expect(moved.get('b')).toEqual({ x: 0, y: 384 })
    const [a, b] = settle(rects, moved)
    expect(gapBetween(a, b)).toBe(FRAME_GAP)
  })

  it('pushes a chain until every pair is clear', () => {
    // A displaces B, and B in turn displaces C: without the work queue, C
    // would be left overlapping the frame that was just pushed into it.
    const rects = [frame('a', 0, 0), frame('b', 500, 0), frame('c', 1044, 0)]

    const moved = pushApart(rects, 'a')

    expect(moved.get('b')).toEqual({ x: 544, y: 0 })
    expect(moved.get('c')).toEqual({ x: 1088, y: 0 })

    const settled = settle(rects, moved)
    for (let i = 0; i < settled.length; i += 1) {
      for (let j = i + 1; j < settled.length; j += 1) {
        expect(gapBetween(settled[i], settled[j])).toBeGreaterThanOrEqual(FRAME_GAP)
      }
    }
  })

  it('never moves the dropped frame, and leaves frames that already fit', () => {
    // Exactly FRAME_GAP apart is far enough: the rule is a minimum, not a
    // margin to re-assert on every drop.
    const rects = [frame('a', 0, 0), frame('b', FRAME_MIN_WIDTH + FRAME_GAP, 0)]

    const moved = pushApart(rects, 'a')

    expect(moved.has('a')).toBe(false)
    expect(moved.size).toBe(0)
  })

  it('moves the other frame even when the dropped frame is on the right', () => {
    // The moved frame never yields, so B is pushed left rather than A right.
    const rects = [frame('b', 0, 0), frame('a', 440, 0)]

    const moved = pushApart(rects, 'a')

    expect(moved.has('a')).toBe(false)
    expect(moved.get('b')).toEqual({ x: 440 - FRAME_GAP - FRAME_MIN_WIDTH, y: 0 })
  })
})

describe('placeNewFrame', () => {
  it('puts the first frame at the origin', () => {
    expect(placeNewFrame([])).toEqual({ x: 0, y: 0 })
  })

  it('places a new frame a gap right of the rightmost edge, top-aligned', () => {
    expect(placeNewFrame([frame('a', 0, 0)])).toEqual({
      x: FRAME_MIN_WIDTH + FRAME_GAP,
      y: 0,
    })
  })

  it('measures from the rightmost edge, not the rightmost origin', () => {
    // 'b' starts further left but is wider, so it owns the right edge.
    const rects: PositionedRect[] = [
      { id: 'a', x: 0, y: 0, width: 480, height: 320 },
      { id: 'b', x: 400, y: 120, width: 900, height: 320 },
    ]

    expect(placeNewFrame(rects)).toEqual({ x: 1300 + FRAME_GAP, y: 120 })
  })
})
