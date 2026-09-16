/**
 * Placement geometry — pure functions, no React, no DOM, no Node, no Electron.
 *
 * Every position here is frame-local (02.2 D-15): a note's `position.x` and
 * `position.y` are measured from its tree's frame origin, so two notes can be
 * compared only when they belong to the same tree.
 *
 * This module is imported by main (`commands/spatial.ts`, `commands/notes.ts`)
 * as well as by the renderer. That makes it the first file main imports from
 * the renderer's folder (Phase 2.5 D-18). The alternative — repeating the
 * numbers on both sides, as `app/src/main/index.ts` does for the frame
 * constants — lets two similar-looking values drift apart; one module keeps
 * `create_note`, `look` and the canvas agreeing by construction.
 *
 * Sizes come only from a note's stored `width`/`height`, or the defaults
 * below. Never from measured DOM sizes (D-07): main cannot see the DOM, and a
 * relation must not change because a window was resized.
 *
 * Determinism rules, so every caller gets the same answer on every machine:
 *  - only `+ - * /`, `Math.sqrt`, `Math.abs`, `Math.min`, `Math.max` and
 *    `Math.floor`; no trigonometric or hypot calls — square by multiplying
 *  - no clock and no randomness
 *  - iterate and sort by numeric id, never by bare string order
 *  - every loop is bounded by its input
 *  - every output is a finite number (or a fixed string)
 */

import type { ContentBox } from './frames'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Card width used when a note has never been resized (moved from notes.ts). */
export const DEFAULT_NOTE_WIDTH = 280

/**
 * Card height used when a note has no stored height: 40px of card padding and
 * border, a title row, one editor line and the provenance footer an agent note
 * always shows. An estimate, not a measurement (D-07).
 */
export const DEFAULT_NOTE_HEIGHT = 120

/** Horizontal gap between a parent note and the note grown from it. */
export const CHILD_GAP = 80

/** Edge-to-edge gap still read as near: a grown child and one stacking step both qualify. */
export const NEAR_GAP = 2 * CHILD_GAP

/** The edge label for a grown note; the edge runs from the child to its parent. */
export const GREW_FROM_LABEL = 'grew-from'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One stored property, as both main and the renderer carry it. */
export interface PlacementProp {
  type: string
  value: string | number | boolean
}

/** The part of a node placement reads. Main's NodeData and the renderer's NodeInfo both fit. */
export interface PlacementNode {
  id: string
  type: string
  props: Readonly<Record<string, PlacementProp>>
}

/** The part of an edge placement reads. */
export interface PlacementEdge {
  id: string
  from: string
  to: string
  label: string
}

/** A frame-local rectangle. */
export type PlacementRect = ContentBox

/** A frame-local point. */
export interface PlacementPoint {
  x: number
  y: number
}

/** A card size. */
export interface PlacementSize {
  width: number
  height: number
}

/** How one note's rectangle sits relative to another's. */
export type Relation = 'near' | 'beyond' | 'overlapping' | 'contains' | 'contained-by'

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const ID_RE = /^[ne]([1-9][0-9]*)$/

/** The integer k of `n<k>` or `e<k>`; positive infinity for anything else. */
export function idNumber(id: string): number {
  const match = ID_RE.exec(id)
  if (!match) return Number.POSITIVE_INFINITY
  const value = Number(match[1])
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

/** Numeric id order (`n9` before `n10`), then plain string order as a final tie-break. */
export function compareIds(a: string, b: string): number {
  const na = idNumber(a)
  const nb = idNumber(b)
  if (na < nb) return -1
  if (na > nb) return 1
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

// ---------------------------------------------------------------------------
// Node predicates
// ---------------------------------------------------------------------------

/**
 * Whether a node is a knot (a thread center). The same predicate as
 * `TreeFrame.tsx` `isThreadCenter`; it must follow 02.3's knot rename when
 * that merges.
 */
export function isKnot(node: PlacementNode): boolean {
  return node.type.includes('thread-center')
}

function finiteNumberProp(node: PlacementNode, key: string): number | null {
  const prop = node.props[key]
  if (!prop) return null
  const value = prop.value
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

/** Whether a node has a stored position: both keys present, each a finite number. */
export function isPlaced(node: PlacementNode): boolean {
  return finiteNumberProp(node, 'position.x') !== null && finiteNumberProp(node, 'position.y') !== null
}

/** Stored size when each value is a finite number above 0, otherwise the defaults (D-07). */
export function noteSize(node: PlacementNode): PlacementSize {
  const width = finiteNumberProp(node, 'width')
  const height = finiteNumberProp(node, 'height')
  return {
    width: width !== null && width > 0 ? width : DEFAULT_NOTE_WIDTH,
    height: height !== null && height > 0 ? height : DEFAULT_NOTE_HEIGHT,
  }
}

/** The rectangle a card of `size` covers with its top-left corner at `point`. */
export function rectAt(point: PlacementPoint, size: PlacementSize): PlacementRect {
  return { x: point.x, y: point.y, width: size.width, height: size.height }
}

/** The stored rectangle of a node, or null when it is not placed. */
export function storedRect(node: PlacementNode): PlacementRect | null {
  const x = finiteNumberProp(node, 'position.x')
  const y = finiteNumberProp(node, 'position.y')
  if (x === null || y === null) return null
  return rectAt({ x, y }, noteSize(node))
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

/**
 * The parent a node grew from: the `to` of its `grew-from` edge. When several
 * exist, the one with the lowest edge id wins. Null when there is none.
 */
export function grewFromParent(node: PlacementNode, edges: readonly PlacementEdge[]): string | null {
  let best: PlacementEdge | null = null
  for (const edge of edges) {
    if (edge.label !== GREW_FROM_LABEL || edge.from !== node.id) continue
    if (best === null || compareIds(edge.id, best.id) < 0) best = edge
  }
  return best === null ? null : best.to
}

/**
 * Whether a note follows its parent (D-01, D-02).
 *
 * True only when the note is not a knot, its `pinned` property is the bool
 * `false` exactly, and its grew-from parent is a live, placed, non-knot note
 * with a lower id. A missing key, `true`, or the text "false" all mean fixed.
 * This is deliberately the opposite of the knot default, where a missing
 * `pinned` means the knot follows its threads.
 */
export function isFollowing(
  node: PlacementNode,
  nodes: readonly PlacementNode[],
  edges: readonly PlacementEdge[],
): boolean {
  if (isKnot(node)) return false
  const pinned = node.props['pinned']
  if (!pinned || pinned.type !== 'bool' || pinned.value !== false) return false
  const parentId = grewFromParent(node, edges)
  if (parentId === null) return false
  const parent = nodes.find((candidate) => candidate.id === parentId)
  if (!parent) return false
  if (isKnot(parent) || !isPlaced(parent)) return false
  return idNumber(parent.id) < idNumber(node.id)
}

// ---------------------------------------------------------------------------
// Rectangles
// ---------------------------------------------------------------------------

/** The centre point of a rectangle. */
export function centreOf(rect: PlacementRect): PlacementPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/** Edge-to-edge gap, measured on the larger axis (Chebyshev); 0 when the rectangles meet. */
export function rectGap(a: PlacementRect, b: PlacementRect): number {
  const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width))
  const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height))
  return Math.max(0, gapX, gapY)
}

/** Strict positive-area intersection; rectangles that only touch do not overlap. */
export function overlaps(a: PlacementRect, b: PlacementRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

function inside(inner: PlacementRect, outer: PlacementRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y >= outer.y &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/** How `other` sits relative to `from`. The first matching rule wins. */
export function classifyRelation(from: PlacementRect, other: PlacementRect): Relation {
  if (inside(other, from)) return 'contains'
  if (inside(from, other)) return 'contained-by'
  if (overlaps(from, other)) return 'overlapping'
  if (rectGap(from, other) <= NEAR_GAP) return 'near'
  return 'beyond'
}

/**
 * Whether `other` lies toward `toward`, seen from `from`: inside a cone with
 * a 45-degree half-angle around the line between the two centres. Tested
 * without trigonometry or square roots: the dot product is positive and twice
 * its square is at least the product of the two squared lengths.
 */
export function liesToward(from: PlacementRect, other: PlacementRect, toward: PlacementRect): boolean {
  const origin = centreOf(from)
  const target = centreOf(other)
  const goal = centreOf(toward)
  const vx = target.x - origin.x
  const vy = target.y - origin.y
  const aimX = goal.x - origin.x
  const aimY = goal.y - origin.y
  const dot = vx * aimX + vy * aimY
  if (dot <= 0) return false
  const vLen2 = vx * vx + vy * vy
  const aimLen2 = aimX * aimX + aimY * aimY
  return 2 * dot * dot >= vLen2 * aimLen2
}

function centreDistance2(a: PlacementRect, b: PlacementRect): number {
  const ca = centreOf(a)
  const cb = centreOf(b)
  const dx = cb.x - ca.x
  const dy = cb.y - ca.y
  return dx * dx + dy * dy
}

/**
 * Neighbours of `from`, nearest first: by edge gap, then squared centre
 * distance, then numeric id. Returns a new array; the input is not changed.
 */
export function orderNeighbours(
  from: PlacementRect,
  candidates: ReadonlyArray<{ id: string; rect: PlacementRect }>,
): Array<{ id: string; rect: PlacementRect; relation: Relation }> {
  const scored = candidates.map((candidate) => ({
    id: candidate.id,
    rect: candidate.rect,
    relation: classifyRelation(from, candidate.rect),
    gap: rectGap(from, candidate.rect),
    distance2: centreDistance2(from, candidate.rect),
  }))
  scored.sort((a, b) => {
    if (a.gap !== b.gap) return a.gap < b.gap ? -1 : 1
    if (a.distance2 !== b.distance2) return a.distance2 < b.distance2 ? -1 : 1
    return compareIds(a.id, b.id)
  })
  return scored.map(({ id, rect, relation }) => ({ id, rect, relation }))
}
