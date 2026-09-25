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

/** Sizes a frame other than a tree frame may use (02.7 D-21). */
export interface FrameBoundsOptions {
  minWidth?: number
  minHeight?: number
  headerHeight?: number
  padding?: number
}

/** A frame's world rect together with the tree id that owns it. */
export interface PositionedRect extends FrameRect {
  id: string
}

/** Safety valve for the push-apart work queue (T-02.2-27). */
const MAX_PUSH_STEPS = 200

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
 *
 * `options` lets a lighter frame (a workspace folder, 02.7 D-21) reuse the same
 * arithmetic with its own sizes; every field defaults to the tree-frame
 * constant, so a call without options returns exactly what it always has.
 */
export function computeFrameBounds(
  frame: FramePosition,
  boxes: ContentBox[],
  options: FrameBoundsOptions = {},
): FrameRect {
  const minWidth = options.minWidth ?? FRAME_MIN_WIDTH
  const minHeight = options.minHeight ?? FRAME_MIN_HEIGHT
  const headerHeight = options.headerHeight ?? FRAME_HEADER_HEIGHT
  const padding = options.padding ?? FRAME_PADDING

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
    x: frame.x + minX - padding,
    y: frame.y + minY - padding - headerHeight,
    width: Math.max(minWidth, contentWidth + padding * 2),
    height: Math.max(minHeight, contentHeight + padding * 2 + headerHeight),
  }
}

/**
 * Separate frames until no two are closer than `gap` (D-15).
 *
 * The frame named by `movedId` never moves: the person just put it where they
 * want it, so everything else yields around it. Each displaced frame is then
 * itself treated as a mover, because pushing B clear of A can push it into C,
 * and stopping after one pass would leave the overlap it just created.
 *
 * A frame yields along whichever axis costs it the smaller move, which keeps
 * a frame nudged off a corner from flying across the space. Frames are
 * considered in id order so the result is the same every time rather than
 * depending on which tree happened to be opened first.
 *
 * Returns the new top-left positions of the frames that moved, and only those.
 * The caller applies the same delta to each frame's origin (a frame's rect is
 * offset from its origin by its content bounds, so the delta transfers but the
 * absolute position does not).
 */
export function pushApart(
  rects: PositionedRect[],
  movedId: string,
  gap: number = FRAME_GAP,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  for (const rect of rects) positions.set(rect.id, { x: rect.x, y: rect.y })

  const byId = new Map(rects.map((rect) => [rect.id, rect]))
  // Deterministic order: the same drop always settles the same way.
  const ordered = [...rects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const displaced = new Map<string, { x: number; y: number }>()
  const queue: string[] = [movedId]
  let steps = 0

  while (queue.length > 0 && steps < MAX_PUSH_STEPS) {
    steps += 1

    const aId = queue.shift() as string
    const aSize = byId.get(aId)
    const aPos = positions.get(aId)
    if (!aSize || !aPos) continue
    const a = { x: aPos.x, y: aPos.y, width: aSize.width, height: aSize.height }

    for (const candidate of ordered) {
      if (candidate.id === aId) continue
      // The dropped frame is the fixed point of the whole settlement.
      if (candidate.id === movedId) continue

      const bPos = positions.get(candidate.id)
      if (!bPos) continue
      const b = { x: bPos.x, y: bPos.y, width: candidate.width, height: candidate.height }

      // Does A, grown by the gap on every side, reach B? Touching at exactly
      // the gap is close enough, so the comparison is strict.
      const overlapsX = a.x - gap < b.x + b.width && b.x < a.x + a.width + gap
      const overlapsY = a.y - gap < b.y + b.height && b.y < a.y + a.height + gap
      if (!overlapsX || !overlapsY) continue

      // Push B to whichever side of A it already leans toward, so a frame
      // never crosses over the frame that displaced it.
      const dx =
        b.x + b.width / 2 >= a.x + a.width / 2
          ? a.x + a.width + gap - b.x
          : a.x - gap - (b.x + b.width)
      const dy =
        b.y + b.height / 2 >= a.y + a.height / 2
          ? a.y + a.height + gap - b.y
          : a.y - gap - (b.y + b.height)

      const next =
        Math.abs(dx) <= Math.abs(dy) ? { x: b.x + dx, y: b.y } : { x: b.x, y: b.y + dy }

      positions.set(candidate.id, next)
      displaced.set(candidate.id, next)
      queue.push(candidate.id)
    }
  }

  return displaced
}

/**
 * Where a newly opened tree's frame goes: clear of everything, to the right.
 *
 * Measured from the rightmost edge rather than the rightmost origin, so a wide
 * frame cannot have a new one dropped on top of it.
 */
export function placeNewFrame(rects: PositionedRect[]): FramePosition {
  if (rects.length === 0) return { x: 0, y: 0 }

  let rightmost = rects[0]
  for (const rect of rects) {
    if (rect.x + rect.width > rightmost.x + rightmost.width) rightmost = rect
  }

  return { x: rightmost.x + rightmost.width + FRAME_GAP, y: rightmost.y }
}
