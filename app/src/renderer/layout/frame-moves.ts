/**
 * Frame moves for one drop — pure functions, no React, no DOM.
 *
 * One drop is one commit (2.6 D-11): the dragged frame and every frame the
 * drop pushed aside are recorded together, so one undo puts them all back.
 * The renderer therefore hands main a single list rather than one call per
 * frame, and this module builds that list.
 *
 * Every value is world-space, before the canvas pan/zoom transform.
 */

import { pushApart, type FramePosition, type PositionedRect } from './frames'

/** One frame's new origin within a drop batch. */
export interface FrameMove {
  treeId: string
  x: number
  y: number
}

/**
 * The batch for one drop: the dragged frame at `movedOrigin` first, then each
 * frame `pushApart` displaced, sorted by tree id.
 *
 * A displaced frame's rect sits away from its origin by its content bounds, so
 * its origin moves by the rect's delta rather than to the rect's position.
 * Sorting by id means the batch never depends on Map iteration order: equal
 * inputs give equal batches. Ids with no matching tree or rect are skipped.
 */
export function buildFrameMoveBatch(
  trees: ReadonlyArray<{ id: string; frame: FramePosition }>,
  rects: PositionedRect[],
  movedId: string,
  movedOrigin: FramePosition,
): FrameMove[] {
  const dragged: FrameMove = { treeId: movedId, x: movedOrigin.x, y: movedOrigin.y }

  const displaced: FrameMove[] = []
  for (const [id, next] of pushApart(rects, movedId)) {
    if (id === movedId) continue
    const before = rects.find((rect) => rect.id === id)
    const tree = trees.find((t) => t.id === id)
    if (!before || !tree) continue

    displaced.push({
      treeId: id,
      x: tree.frame.x + (next.x - before.x),
      y: tree.frame.y + (next.y - before.y),
    })
  }

  displaced.sort((a, b) => (a.treeId < b.treeId ? -1 : a.treeId > b.treeId ? 1 : 0))
  return [dragged, ...displaced]
}

/**
 * The fitted origin to show, or null when main did not commit it (2.6 D-12).
 *
 * Main allows one fit per member per main session, and never one over a
 * frame the person moved, so a new renderer session (a reload, or a window
 * re-created on macOS) can ask for a fit main refuses. The renderer shows a
 * fit only once the forest holds it, so the screen and the forest never
 * silently disagree (review WR-05).
 */
export function originAfterFit(
  result: { ok: boolean; committed?: boolean; error?: string },
  fitted: FramePosition,
): FramePosition | null {
  return result.ok && result.committed === true ? fitted : null
}
