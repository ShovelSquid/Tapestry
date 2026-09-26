/**
 * Nesting — notes inside notes. Pure functions, no React, no DOM.
 *
 * A note holds its own 2D surface: any note can sit anywhere inside another,
 * to any depth, like folders but spatial. The file records it readably on the
 * inner note, as one property:
 *
 *   set n5 inside ref n2
 *
 * and the inner note's `position.x`/`position.y` are then measured from its
 * container's top-left corner, not from the tree frame. That is the whole
 * model; everything below derives from it:
 *
 *  - moving a container moves everything inside it, with no writes to them
 *  - a container is drawn at least large enough to hold its contents, plus
 *    CONTAINER_PADDING; a stored width/height smaller than that is kept, not
 *    overwritten, so emptying a container lets it shrink back
 *  - zoomed out, a note too small on screen collapses to a circle or a dot
 *    (look/collapse.ts decides which), and nothing inside it is drawn at all
 *
 * The tunable numbers are the exported constants. This is stage 1 of making
 * notes the only core concept (world_space_design.md): it works inside
 * today's trees, and a tree frame is the root surface.
 *
 * Determinism: id order everywhere, every walk bounded by MAX_NESTING_DEPTH or
 * the node count, and a malformed `inside` (missing target, not a note, a
 * cycle, too deep) leaves the note at the top level rather than failing.
 */

import { collapseForm, thresholdsFor, type CollapsedForm } from '../look/collapse'

export const INSIDE_KEY = 'inside'

/** The one type that can hold and be held, in this stage. */
export const NESTABLE_TYPE = 'tapestry.notes/note@1'

/**
 * How far below a container's top edge its contents start, so a note never
 * covers the title of the note it is in (the card's padding plus one title row).
 */
export const CHILD_TOP = 56

/** Space kept to the right of and below a container's contents. */
export const CONTAINER_PADDING = 24

/** Deeper than this, a note is treated as top-level (and so is any cycle). */
export const MAX_NESTING_DEPTH = 32

/** The size a note is assumed to have before it has been measured (placement.ts's defaults). */
export const FALLBACK_SIZE = Object.freeze({ width: 280, height: 120 })

export interface NestingNode {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Nesting {
  /** Every nestable note's container, null at the top level. */
  containerOf: ReadonlyMap<string, string | null>
  /** Each container's direct contents, in id order; null is the top level. */
  childrenOf: ReadonlyMap<string | null, readonly string[]>
  /** 0 at the top level. */
  depthOf: ReadonlyMap<string, number>
}

function idNumber(id: string): number {
  const n = Number(id.replace(/^[a-z]+/, ''))
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

function compareIds(a: string, b: string): number {
  return idNumber(a) - idNumber(b) || (a < b ? -1 : a > b ? 1 : 0)
}

export function isNestable(node: NestingNode): boolean {
  return node.type === NESTABLE_TYPE
}

/** The container a note names, before any validation. */
function declaredContainer(node: NestingNode): string | null {
  const prop = node.props[INSIDE_KEY]
  return prop && prop.type === 'ref' && typeof prop.value === 'string' ? prop.value : null
}

/** Who holds whom, from the `inside` refs of a tree's nestable notes. */
export function buildNesting(nodes: readonly NestingNode[]): Nesting {
  const notes = new Map<string, NestingNode>()
  for (const node of nodes) if (isNestable(node) && !notes.has(node.id)) notes.set(node.id, node)

  // Pass one: a declared container counts only if it is a nestable note.
  const declared = new Map<string, string | null>()
  for (const [id, node] of notes) {
    const target = declaredContainer(node)
    declared.set(id, target !== null && target !== id && notes.has(target) ? target : null)
  }

  // Pass two: walk up from each note. A cycle or an over-deep chain puts the
  // note at the top level.
  const containerOf = new Map<string, string | null>()
  const depthOf = new Map<string, number>()
  const ids = [...notes.keys()].sort(compareIds)
  for (const id of ids) {
    let depth = 0
    let at = declared.get(id) ?? null
    const seen = new Set<string>([id])
    let valid = true
    while (at !== null) {
      if (seen.has(at) || depth >= MAX_NESTING_DEPTH) {
        valid = false
        break
      }
      seen.add(at)
      depth += 1
      at = declared.get(at) ?? null
    }
    containerOf.set(id, valid ? (declared.get(id) ?? null) : null)
    depthOf.set(id, valid ? depth : 0)
  }
  // A note whose own container was demoted by pass two is still inside it;
  // recompute depths top-down so every depth agrees with containerOf.
  const childrenOf = new Map<string | null, string[]>()
  for (const id of ids) {
    const parent = containerOf.get(id) ?? null
    const list = childrenOf.get(parent)
    if (list) list.push(id)
    else childrenOf.set(parent, [id])
  }
  const queue: string[] = [...(childrenOf.get(null) ?? [])]
  for (const id of queue) depthOf.set(id, 0)
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i]
    for (const child of childrenOf.get(id) ?? []) {
      depthOf.set(child, (depthOf.get(id) ?? 0) + 1)
      queue.push(child)
    }
  }
  return { containerOf, childrenOf, depthOf }
}

/** True when the note sits inside another note. */
export function isNested(nesting: Nesting, id: string): boolean {
  return (nesting.containerOf.get(id) ?? null) !== null
}

/** The note and everything inside it, at any depth, deepest first. */
export function subtreeDeepestFirst(nesting: Nesting, id: string): string[] {
  const order: string[] = [id]
  for (let i = 0; i < order.length; i += 1) {
    for (const child of nesting.childrenOf.get(order[i]) ?? []) order.push(child)
  }
  return order.reverse()
}

/** True when `candidate` is `id` or inside it at any depth. */
export function isWithin(nesting: Nesting, candidate: string, id: string): boolean {
  let at: string | null = candidate
  for (let depth = 0; at !== null && depth <= MAX_NESTING_DEPTH; depth += 1) {
    if (at === id) return true
    at = nesting.containerOf.get(at) ?? null
  }
  return false
}

/**
 * Where each note is in its tree's frame-local coordinates: its local spot
 * plus every container's, walked from the top level down. A note that is not
 * nestable or not nested keeps its local spot.
 */
export function absolutePositions(
  nesting: Nesting,
  localOf: (id: string) => Point,
): Map<string, Point> {
  const out = new Map<string, Point>()
  const queue: string[] = [...(nesting.childrenOf.get(null) ?? [])]
  for (const id of queue) out.set(id, localOf(id))
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i]
    const base = out.get(id) as Point
    for (const child of nesting.childrenOf.get(id) ?? []) {
      const local = localOf(child)
      out.set(child, { x: base.x + local.x, y: base.y + local.y })
      queue.push(child)
    }
  }
  return out
}

/**
 * The smallest size each container must be drawn at to hold its contents,
 * computed deepest first so a grown child grows its container too. Only
 * containers get an entry.
 *
 * `sizeOf` is a note's drawn size as last measured (or its stored/default
 * size). A child's own minimum is folded in, so the answer does not lag a
 * render behind when two levels grow at once.
 */
export function containerMinSizes(
  nesting: Nesting,
  localOf: (id: string) => Point,
  sizeOf: (id: string) => Size,
): Map<string, Size> {
  const byDepth = [...nesting.depthOf.entries()].sort((a, b) => b[1] - a[1] || compareIds(a[0], b[0]))
  const mins = new Map<string, Size>()
  for (const [id] of byDepth) {
    const children = nesting.childrenOf.get(id)
    if (!children || children.length === 0) continue
    let width = 0
    let height = 0
    for (const child of children) {
      const at = localOf(child)
      const measured = sizeOf(child)
      const min = mins.get(child)
      const w = Math.max(measured.width, min?.width ?? 0)
      const h = Math.max(measured.height, min?.height ?? 0)
      width = Math.max(width, at.x + w + CONTAINER_PADDING)
      height = Math.max(height, at.y + h + CONTAINER_PADDING)
    }
    mins.set(id, { width, height })
  }
  return mins
}

/**
 * The note a drop at `point` lands inside: the deepest note whose drawn rect
 * holds the point, never the dragged note or anything inside it. Ties at one
 * depth go to the higher id, which is drawn on top. Null is the top level.
 */
export function dropContainer(
  nesting: Nesting,
  rectOf: (id: string) => { x: number; y: number; width: number; height: number } | null,
  draggedId: string,
  point: Point,
): string | null {
  let best: string | null = null
  let bestDepth = -1
  for (const [id, depth] of nesting.depthOf) {
    if (isWithin(nesting, id, draggedId)) continue
    const r = rectOf(id)
    if (!r) continue
    if (point.x < r.x || point.y < r.y || point.x > r.x + r.width || point.y > r.y + r.height) continue
    if (depth > bestDepth || (depth === bestDepth && best !== null && compareIds(id, best) > 0)) {
      best = id
      bestDepth = depth
    }
  }
  return best
}

/**
 * The notes drawn collapsed and the notes not drawn at all: a note too small
 * on screen is a circle or a dot (look/collapse.ts), at any depth, and
 * everything inside a collapsed note is hidden.
 */
export function outlineState(
  nesting: Nesting,
  widthOf: (id: string) => number,
  zoom: number,
): { collapsed: Map<string, CollapsedForm>; hidden: Set<string> } {
  const collapsed = new Map<string, CollapsedForm>()
  const hidden = new Set<string>()
  const queue: string[] = [...(nesting.childrenOf.get(null) ?? [])]
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i]
    if (!hidden.has(id)) {
      const form = collapseForm(widthOf(id) * zoom, thresholdsFor(id))
      if (form !== 'note') collapsed.set(id, form)
    }
    const children = nesting.childrenOf.get(id) ?? []
    if (collapsed.has(id) || hidden.has(id)) for (const child of children) hidden.add(child)
    for (const child of children) queue.push(child)
  }
  return { collapsed, hidden }
}

/** One op of the kind App submits. */
export type NestingOp =
  | { op: 'setProperty'; target: string; key: string; type: 'real' | 'ref'; value: number | string }
  | { op: 'unsetProperty'; target: string; key: string }

/**
 * A local spot inside a container, kept on its surface: never left of it and
 * never over its title row. Top-level spots are unchanged.
 */
export function clampToSurface(local: Point, inContainer: boolean): Point {
  if (!inContainer) return { x: Math.round(local.x), y: Math.round(local.y) }
  return { x: Math.max(0, Math.round(local.x)), y: Math.max(CHILD_TOP, Math.round(local.y)) }
}

/**
 * The ops that put `id` inside `container` (null: the top level) with its
 * top-left at `absolute` (frame-local). The new local spot is measured from
 * the container's absolute top-left and kept on its surface (clampToSurface).
 */
export function moveIntoOps(
  id: string,
  container: string | null,
  absolute: Point,
  containerAbsolute: Point | null,
  currentContainer: string | null,
): NestingOp[] {
  const origin = container !== null && containerAbsolute ? containerAbsolute : { x: 0, y: 0 }
  const { x, y } = clampToSurface({ x: absolute.x - origin.x, y: absolute.y - origin.y }, container !== null)
  const ops: NestingOp[] = [
    { op: 'setProperty', target: id, key: 'position.x', type: 'real', value: x },
    { op: 'setProperty', target: id, key: 'position.y', type: 'real', value: y },
  ]
  if (container !== currentContainer) {
    ops.push(
      container === null
        ? { op: 'unsetProperty', target: id, key: INSIDE_KEY }
        : { op: 'setProperty', target: id, key: INSIDE_KEY, type: 'ref', value: container },
    )
  }
  return ops
}

/**
 * Where a new note made inside `container` goes, in its local coordinates:
 * under the lowest thing already inside it, or, when it is empty, under the
 * container's own text (`containerHeight`, its drawn height while empty).
 */
export function newChildSpot(
  nesting: Nesting,
  container: string,
  localOf: (id: string) => Point,
  sizeOf: (id: string) => Size,
  containerHeight: number,
): Point {
  const children = nesting.childrenOf.get(container) ?? []
  let bottom = children.length === 0 ? Math.max(containerHeight, CHILD_TOP) : 0
  for (const child of children) {
    bottom = Math.max(bottom, localOf(child).y + sizeOf(child).height)
  }
  return { x: CONTAINER_PADDING, y: Math.round(bottom + CONTAINER_PADDING / 2) }
}
