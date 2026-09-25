/**
 * One frame drop is one commit (2.6 D-11), so the renderer hands main one
 * list: the dragged frame first, then every frame the drop pushed aside.
 *
 * The case that matters is the one where a sign or an offset is easy to get
 * wrong: a frame's rect sits away from its origin by its content bounds, so a
 * displaced frame's origin moves by the rect's delta, not to the rect.
 */

import { describe, expect, it } from 'vitest'
import { FRAME_GAP, FRAME_MIN_HEIGHT, FRAME_MIN_WIDTH, type PositionedRect } from './frames'
import { buildFrameMoveBatch, originAfterFit } from './frame-moves'

/** A frame-sized rect, so the numbers below read as real frames. */
function frame(id: string, x: number, y: number): PositionedRect {
  return { id, x, y, width: FRAME_MIN_WIDTH, height: FRAME_MIN_HEIGHT }
}

describe('buildFrameMoveBatch', () => {
  it('returns only the dragged frame when nothing overlaps', () => {
    const trees = [
      { id: 'a', frame: { x: 0, y: 0 } },
      { id: 'b', frame: { x: 2000, y: 0 } },
    ]
    const rects = [frame('a', 0, 0), frame('b', 2000, 0)]

    expect(buildFrameMoveBatch(trees, rects, 'a', { x: 0, y: 0 })).toEqual([
      { treeId: 'a', x: 0, y: 0 },
    ])
  })

  it("moves a displaced frame's origin by its rect delta, not to the rect position", () => {
    // b's rect sits 48 units right of its origin (content at negative local x
    // would do the opposite); only the delta transfers to the origin.
    const trees = [
      { id: 'a', frame: { x: 0, y: 0 } },
      { id: 'b', frame: { x: 152, y: 0 } },
    ]
    const rects = [frame('a', 0, 0), frame('b', 200, 0)]

    const batch = buildFrameMoveBatch(trees, rects, 'a', { x: 0, y: 0 })

    // b is pushed right until its rect clears a by the gap.
    const rectDx = FRAME_MIN_WIDTH + FRAME_GAP - 200
    expect(batch).toEqual([
      { treeId: 'a', x: 0, y: 0 },
      { treeId: 'b', x: 152 + rectDx, y: 0 },
    ])
  })

  it('puts the dragged frame first and sorts displaced frames by tree id, deterministically', () => {
    // 'a' is dropped between three frames it overlaps; they are listed out of
    // order so the result cannot lean on input order.
    const trees = [
      { id: 'z', frame: { x: 100, y: 0 } },
      { id: 'a', frame: { x: 0, y: 0 } },
      { id: 'm', frame: { x: 0, y: 100 } },
      { id: 'c', frame: { x: -100, y: 0 } },
    ]
    const rects = [frame('z', 100, 0), frame('a', 0, 0), frame('m', 0, 100), frame('c', -100, 0)]

    const first = buildFrameMoveBatch(trees, rects, 'a', { x: 0, y: 0 })
    const second = buildFrameMoveBatch(trees, rects, 'a', { x: 0, y: 0 })

    expect(first[0]).toEqual({ treeId: 'a', x: 0, y: 0 })
    const displacedIds = first.slice(1).map((move) => move.treeId)
    expect(displacedIds.length).toBeGreaterThan(0)
    expect(displacedIds).toEqual([...displacedIds].sort())
    expect(second).toEqual(first)
  })

  it('skips a displaced frame with no tree and never lists the dragged frame twice', () => {
    // 'ghost' has a rect but no tree (closed mid-drag); it is displaced but skipped.
    const trees = [
      { id: 'a', frame: { x: 0, y: 0 } },
      { id: 'b', frame: { x: 200, y: 0 } },
    ]
    const rects = [frame('a', 0, 0), frame('b', 200, 0), frame('ghost', 0, 200)]

    const batch = buildFrameMoveBatch(trees, rects, 'a', { x: 10, y: 20 })

    expect(batch.map((move) => move.treeId)).toEqual(['a', 'b'])
    expect(batch[0]).toEqual({ treeId: 'a', x: 10, y: 20 })
  })

  it('returns only the dragged frame when it has no rect yet', () => {
    const trees = [
      { id: 'a', frame: { x: 0, y: 0 } },
      { id: 'b', frame: { x: 0, y: 0 } },
    ]

    expect(buildFrameMoveBatch(trees, [frame('b', 0, 0)], 'a', { x: 5, y: 5 })).toEqual([
      { treeId: 'a', x: 5, y: 5 },
    ])
  })
})

describe('originAfterFit (2.6 WR-05)', () => {
  const fitted = { x: 5, y: 6 }

  it('shows the fitted origin once main committed it', () => {
    expect(originAfterFit({ ok: true, committed: true }, fitted)).toEqual({ x: 5, y: 6 })
  })

  it('shows nothing when main refused the fit (spent, person-moved or unchanged)', () => {
    expect(originAfterFit({ ok: true, committed: false }, fitted)).toBeNull()
  })

  it('shows nothing when main did not say it committed', () => {
    expect(originAfterFit({ ok: true }, fitted)).toBeNull()
  })

  it('shows nothing when the fit failed', () => {
    expect(originAfterFit({ ok: false, error: 'x' }, fitted)).toBeNull()
  })
})
