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

/** Vertical gutter between stacked cards: the gutter the 02.2 vault layout uses. */
export const STACK_GAP = 24

/**
 * How many downward steps a resolver tries before giving up (D-09). Step 0 is
 * the start spot, so the lowest candidate is `MAX_PLACE_STEPS - 1` card
 * heights (plus gutters) below it. A discretion value: large enough for a
 * crowded column, small enough that every resolve is cheap.
 */
export const MAX_PLACE_STEPS = 64

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
  const parentId = grewFromParent(node, edges)
  const parent = parentId === null ? undefined : nodes.find((candidate) => candidate.id === parentId)
  return followsParent(node, parent)
}

/** The rule behind `isFollowing`, given the parent already looked up (or undefined). */
function followsParent(node: PlacementNode, parent: PlacementNode | undefined): boolean {
  if (isKnot(node)) return false
  const pinned = node.props['pinned']
  if (!pinned || pinned.type !== 'bool' || pinned.value !== false) return false
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

// ---------------------------------------------------------------------------
// Resolvers (D-09, D-10)
// ---------------------------------------------------------------------------

/** Why a resolver found no spot. */
export type SpotFailure = 'no-clear-spot' | 'no-line' | 'not-finite'

/** A resolved top-left corner, or the reason there is none. */
export type SpotResult = { ok: true; x: number; y: number } | { ok: false; reason: SpotFailure }

/**
 * From `start`, try each step down in turn — one card height plus
 * `STACK_GAP` each — and return the first spot whose rectangle overlaps no
 * obstacle. Bounded by `MAX_PLACE_STEPS`.
 */
function stepDown(start: PlacementPoint, size: PlacementSize, obstacles: readonly PlacementRect[]): SpotResult {
  const stride = size.height + STACK_GAP
  for (let k = 0; k < MAX_PLACE_STEPS; k++) {
    const x = start.x
    const y = start.y + k * stride
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'not-finite' }
    const candidate = rectAt({ x, y }, size)
    let clear = true
    for (const obstacle of obstacles) {
      if (overlaps(candidate, obstacle)) {
        clear = false
        break
      }
    }
    if (clear) return { ok: true, x, y }
  }
  return { ok: false, reason: 'no-clear-spot' }
}

/**
 * Where a card of `size` goes near `anchor` (D-09): `CHILD_GAP` right of the
 * anchor, level with its top — the spot `create_note` has always used — then
 * down in steps until its footprint overlaps nothing.
 */
export function resolveNear(anchor: PlacementRect, size: PlacementSize, obstacles: readonly PlacementRect[]): SpotResult {
  return stepDown({ x: anchor.x + anchor.width + CHILD_GAP, y: anchor.y }, size, obstacles)
}

/**
 * Where a card of `size` goes beyond `beyond`, seen from `from` (D-10): the
 * line from `from`'s centre through `beyond`'s centre is extended past
 * `beyond`'s centre by `CHILD_GAP` plus one card width, which gives the new
 * card's centre; then the same downward steps as `resolveNear`.
 *
 * Self-check: with cards of equal width on a horizontal line, the new card's
 * left edge is `beyond.x + beyond.width + CHILD_GAP`, exactly `resolveNear`'s
 * start. Equal centres have no line and are refused.
 */
export function resolveBeyond(
  beyond: PlacementRect,
  from: PlacementRect,
  size: PlacementSize,
  obstacles: readonly PlacementRect[],
): SpotResult {
  const origin = centreOf(from)
  const through = centreOf(beyond)
  const dx = through.x - origin.x
  const dy = through.y - origin.y
  const length2 = dx * dx + dy * dy
  if (!Number.isFinite(length2)) return { ok: false, reason: 'not-finite' }
  if (length2 === 0) return { ok: false, reason: 'no-line' }
  const scale = (CHILD_GAP + size.width) / Math.sqrt(length2)
  const start = {
    x: through.x + dx * scale - size.width / 2,
    y: through.y + dy * scale - size.height / 2,
  }
  return stepDown(start, size, obstacles)
}

// ---------------------------------------------------------------------------
// Draw-time positions (D-05)
// ---------------------------------------------------------------------------

/** Where one note is drawn. */
export interface DisplaySpot {
  /**
   * Where edges, frame bounds and `look` use the note: its live override
   * (a drag in progress) if any, else its derived spot if it follows, else
   * its stored spot.
   */
  x: number
  y: number
  /** The `isFollowing` answer for the note. */
  following: boolean
  /**
   * The spot derived beside the parent, ignoring the note's own override.
   * Null for fixed notes, and for a following note with no clear spot.
   *
   * The renderer hands the card `followSpot`, not `x`/`y`: when the note's
   * own drag ends and its override is dropped, the card is already at the
   * spot it will be drawn at, so it never jumps back.
   */
  followSpot: PlacementPoint | null
}

/**
 * Where every note in one tree is drawn (D-05), with following notes placed
 * beside their grew-from parents at draw time instead of at their stored
 * spots. Moving a parent moves its followers with no write of any kind.
 *
 * `overrides` maps a node id to a live frame-local point (a drag in
 * progress). Returns a new map; the inputs are not changed.
 *
 * Pass one gives every fixed note its override or stored spot (an unplaced
 * fixed note with no override has no entry). Pass two resolves followers in
 * ascending id order; a follower's parent always has a lower id, so it
 * already has an entry. Every non-knot entry becomes an obstacle for the
 * followers resolved after it; knots never block. Sizes come from
 * `noteSize` only (D-07). The cost is one pass per note plus at most
 * `MAX_PLACE_STEPS` checks per follower.
 */
export function displayPositions(
  nodes: readonly PlacementNode[],
  edges: readonly PlacementEdge[],
  overrides: ReadonlyMap<string, PlacementPoint>,
): Map<string, DisplaySpot> {
  const sorted = [...nodes].sort((a, b) => compareIds(a.id, b.id))

  const byId = new Map<string, PlacementNode>()
  for (const node of nodes) {
    // The first node with an id wins, as `Array.prototype.find` does in isFollowing.
    if (!byId.has(node.id)) byId.set(node.id, node)
  }
  const parentOf = new Map<string, PlacementEdge>()
  for (const edge of edges) {
    if (edge.label !== GREW_FROM_LABEL) continue
    const best = parentOf.get(edge.from)
    if (best === undefined || compareIds(edge.id, best.id) < 0) parentOf.set(edge.from, edge)
  }
  const parentNode = (node: PlacementNode): PlacementNode | undefined => {
    const edge = parentOf.get(node.id)
    return edge === undefined ? undefined : byId.get(edge.to)
  }

  const spots = new Map<string, DisplaySpot>()
  const obstacles: PlacementRect[] = []
  const followers: Array<{ node: PlacementNode; parent: PlacementNode }> = []

  for (const node of sorted) {
    const parent = parentNode(node)
    if (parent !== undefined && followsParent(node, parent)) {
      followers.push({ node, parent })
      continue
    }
    const override = overrides.get(node.id)
    let spot: PlacementPoint | null = null
    if (override !== undefined) {
      spot = { x: override.x, y: override.y }
    } else {
      const stored = storedRect(node)
      if (stored !== null) spot = { x: stored.x, y: stored.y }
    }
    if (spot === null) continue
    spots.set(node.id, { x: spot.x, y: spot.y, following: false, followSpot: null })
    if (!isKnot(node)) obstacles.push(rectAt(spot, noteSize(node)))
  }

  for (const { node, parent } of followers) {
    const size = noteSize(node)
    const parentSpot = spots.get(parent.id)
    let parentRect: PlacementRect
    if (parentSpot !== undefined) {
      parentRect = rectAt(parentSpot, noteSize(parent))
    } else {
      // Unreachable while the parent is placed and has a lower id; kept so a
      // malformed world still draws every follower somewhere.
      const stored = storedRect(parent)
      if (stored === null) continue
      parentRect = stored
    }

    const resolved = resolveNear(parentRect, size, obstacles)
    const followSpot: PlacementPoint | null = resolved.ok ? { x: resolved.x, y: resolved.y } : null

    let drawn: PlacementPoint
    const override = overrides.get(node.id)
    const stored = storedRect(node)
    if (override !== undefined) drawn = { x: override.x, y: override.y }
    else if (followSpot !== null) drawn = { x: followSpot.x, y: followSpot.y }
    else if (stored !== null) drawn = { x: stored.x, y: stored.y }
    else drawn = { x: parentRect.x + parentRect.width + CHILD_GAP, y: parentRect.y }

    spots.set(node.id, { x: drawn.x, y: drawn.y, following: true, followSpot })
    obstacles.push(rectAt(drawn, size))
  }

  return spots
}
