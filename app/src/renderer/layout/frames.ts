/**
 * Frame geometry — pure functions, no React, no DOM.
 *
 * A tree's notes store frame-local positions (D-15), so a frame is two things:
 * an origin in world space, and a rectangle large enough to hold its content
 * with padding and a header band. Keeping that arithmetic here means the
 * push-apart rule and the hit-testing in Canvas agree by construction rather
 * than by two similar-looking expressions staying in step.
 *
 * Every value is world-space, before the canvas pan/zoom transform.
 */

/** Minimum distance between two frames (D-15: trees never overlap). */
export const FRAME_GAP = 64

/** Inner padding around a frame's content bounds (left, right, bottom). */
export const FRAME_PADDING = 48

/** Height of the frame header band. */
export const FRAME_HEADER_HEIGHT = 64

export const FRAME_MIN_WIDTH = 480
export const FRAME_MIN_HEIGHT = 320

/** Where a frame's local origin sits in world space. */
export interface FramePosition {
  x: number
  y: number
}

/** A frame-local content box: a note, a thread center, a group. */
export interface ContentBox {
  x: number
  y: number
  width: number
  height: number
}

/** A world-space rectangle. */
export interface FrameRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The world rectangle a frame occupies, given its origin and its content.
 *
 * The header band is added above the content, which is why the rect's top is
 * a further FRAME_HEADER_HEIGHT above the padded content bounds: the header
 * is part of the frame's footprint, so push-apart keeps other frames clear of
 * it rather than letting them slide under the name.
 *
 * An empty frame is a minimum-size rect at its origin, so a tree that has just
 * been opened is still a visible, draggable target.
 */
export function computeFrameBounds(frame: FramePosition, boxes: ContentBox[]): FrameRect {
  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0

  if (boxes.length > 0) {
    minX = Infinity
    minY = Infinity
    maxX = -Infinity
    maxY = -Infinity
    for (const box of boxes) {
      minX = Math.min(minX, box.x)
      minY = Math.min(minY, box.y)
      maxX = Math.max(maxX, box.x + box.width)
      maxY = Math.max(maxY, box.y + box.height)
    }
  }

  const contentWidth = maxX - minX
  const contentHeight = maxY - minY

  return {
    x: frame.x + minX - FRAME_PADDING,
    y: frame.y + minY - FRAME_PADDING - FRAME_HEADER_HEIGHT,
    width: Math.max(FRAME_MIN_WIDTH, contentWidth + FRAME_PADDING * 2),
    height: Math.max(FRAME_MIN_HEIGHT, contentHeight + FRAME_PADDING * 2 + FRAME_HEADER_HEIGHT),
  }
}
