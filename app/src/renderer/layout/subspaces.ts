/**
 * Folder subspaces — pure geometry, no React, no DOM, no Node, no Electron
 * (02.7 D-21).
 *
 * A workspace folder is drawn as a frame inside its workspace frame, with the
 * tree frame's design. It works the way a tree frame does one level down
 * (02.2 D-15): a note's `position.x/y` is local to its parent folder's content
 * origin, and a folder's own position is that origin, local to *its* parent.
 * The workspace root is the tree frame. Dragging a folder therefore writes one
 * folder position rather than every descendant's.
 *
 * Main imports this module as it imports `placement.ts` (02.5 D-18), so the
 * first-import layout, appends, the one-time migration, `look`, `place` and the
 * canvas all share one geometry rather than several similar-looking copies.
 * Frame arithmetic is reused from `frames.ts` (computeFrameBounds with
 * FOLDER_FRAME sizes, and pushApart), never forked.
 *
 * `subspace` and `collapsed` are Tapestry's keys by the `file.*` rule: neither
 * is ever read from or written to disk. Nothing here emits any other key.
 */

import {
  FRAME_HEADER_HEIGHT,
  computeFrameBounds,
  pushApart,
  type ContentBox,
  type FrameRect,
  type PositionedRect,
} from './frames'
import type { PlacementNode } from './placement'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Every workspace node type starts with this (02.7-01 record shapes). */
export const WORKSPACE_TYPE_PREFIX = 'tapestry.workspace/'

/** The folder node type; mirrors WORKSPACE_FOLDER_TYPE in main's shapes.ts. */
export const WORKSPACE_FOLDER_NODE_TYPE = 'tapestry.workspace/folder@1'

/** The key holding a workspace node's relative path. */
export const FILE_PATH_KEY = 'file.path'

/** Tapestry key: this folder's children are positioned relative to it. */
export const SUBSPACE_KEY = 'subspace'

/** Tapestry key: this folder is drawn as its header only. */
export const COLLAPSED_KEY = 'collapsed'

/**
 * A folder frame's sizes: lighter than a tree frame (480 x 320, 48 padding),
 * with the same 64px header band so the two read as one design.
 */
export const FOLDER_FRAME = Object.freeze({
  minWidth: 320,
  minHeight: FRAME_HEADER_HEIGHT + 96,
  headerHeight: FRAME_HEADER_HEIGHT,
  padding: 24,
})

/**
 * The size assumed for a card that has not been measured (main never measures).
 * 280 wide like a text card; 280 tall because a collapsed text card — title,
 * eight preview lines capped at 128px, the Open file button and the provenance
 * footer — measures about 270px on the canvas.
 */
export const CARD_ESTIMATE = Object.freeze({ width: 280, height: 280 })

/** Folder depth is bounded by paths, but loops stay bounded regardless. */
const MAX_DEPTH = 256

/** The id push-apart uses for a parent's cards, moved as one block. */
const CARD_BLOCK_ID = '\u0000cards'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Point {
  x: number
  y: number
}

export type SubspaceNode = PlacementNode

/** A card's measured size, or undefined for the estimate. */
export type DimsOf = (nodeId: string) => { width: number; height: number } | undefined

/** A setProperty a subspace change writes. Only position.x/y, subspace and collapsed. */
export type SubspaceOp = {
  op: 'setProperty'
  target: string
  key: string
  type: 'real' | 'bool'
  value: number | boolean
}

export interface FolderHierarchy {
  /** Each workspace node's parent folder id; null is the workspace root. */
  parentOf: Map<string, string | null>
  /** Children per folder id (null is the root), in path order. */
  childrenOf: Map<string | null, string[]>
  /** Every folder node id. */
  folders: Set<string>
  /** Each workspace node's path. */
  pathOf: Map<string, string>
}

export interface SubspaceLayout {
  hierarchy: FolderHierarchy
  /** Each folder's rect in its parent's local coordinates. */
  folderRects: Map<string, FrameRect>
  /** Folders drawn open (not collapsed, or expanded by override). */
  expanded: Set<string>
  /** The root's cards plus the top-level folder rects, for the tree frame. */
  rootBoxes: ContentBox[]
}

export interface SubspaceOverride {
  /** Folders to treat as expanded whatever their stored `collapsed` says. */
  expanded?: ReadonlySet<string>
  /** Local positions to use instead of the stored ones (a drop, a live drag). */
  positions?: ReadonlyMap<string, Point>
}

// ---------------------------------------------------------------------------
// Reading nodes
// ---------------------------------------------------------------------------

export function isWorkspaceNode(node: SubspaceNode): boolean {
  return node.type.startsWith(WORKSPACE_TYPE_PREFIX)
}

export function isFolderNode(node: SubspaceNode): boolean {
  return node.type === WORKSPACE_FOLDER_NODE_TYPE
}

function boolProp(node: SubspaceNode, key: string): boolean {
  const value = node.props[key]?.value
  return value === true || value === 'true'
}

/** Whether a folder's stored state is collapsed. */
export function isCollapsed(node: SubspaceNode): boolean {
  return boolProp(node, COLLAPSED_KEY)
}

/** Whether a folder already says its children are local to it. */
export function isSubspace(node: SubspaceNode): boolean {
  return boolProp(node, SUBSPACE_KEY)
}

function finiteNumber(node: SubspaceNode, key: string): number {
  const value = Number(node.props[key]?.value ?? 0)
  return Number.isFinite(value) ? value : 0
}

/** A node's stored local position. */
export function storedPosition(node: SubspaceNode): Point {
  return { x: finiteNumber(node, 'position.x'), y: finiteNumber(node, 'position.y') }
}

function pathOfNode(node: SubspaceNode): string | null {
  const value = node.props[FILE_PATH_KEY]?.value
  return typeof value === 'string' ? value : null
}

function parentDir(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

// ---------------------------------------------------------------------------
// Hierarchy and coordinates
// ---------------------------------------------------------------------------

/**
 * Which folder each workspace node sits in, from its path. A node whose
 * folder has no node (it should always have one) belongs to the nearest
 * ancestor that does, and otherwise to the root.
 */
export function folderHierarchy(nodes: readonly SubspaceNode[]): FolderHierarchy {
  const folderByPath = new Map<string, string>()
  const pathOf = new Map<string, string>()
  const folders = new Set<string>()
  for (const node of nodes) {
    if (!isWorkspaceNode(node)) continue
    const path = pathOfNode(node)
    if (path === null) continue
    pathOf.set(node.id, path)
    if (isFolderNode(node)) {
      folderByPath.set(path, node.id)
      folders.add(node.id)
    }
  }

  const parentOf = new Map<string, string | null>()
  const childrenOf = new Map<string | null, string[]>()
  const ordered = [...pathOf.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  for (const [id, path] of ordered) {
    let dir = parentDir(path)
    let parent: string | null = null
    for (let depth = 0; dir !== '' && depth < MAX_DEPTH; depth += 1) {
      const found = folderByPath.get(dir)
      if (found !== undefined && found !== id) {
        parent = found
        break
      }
      dir = parentDir(dir)
    }
    parentOf.set(id, parent)
    const list = childrenOf.get(parent) ?? []
    list.push(id)
    childrenOf.set(parent, list)
  }

  return { parentOf, childrenOf, folders, pathOf }
}

/**
 * Every node's position in workspace-frame coordinates: its local position
 * plus the origin of every folder above it. Nodes outside the hierarchy (a
 * note made in the workspace tree) are already frame-local.
 */
export function absolutePositions(
  nodes: readonly SubspaceNode[],
  positions?: ReadonlyMap<string, Point>,
  hierarchy: FolderHierarchy = folderHierarchy(nodes),
): Map<string, Point> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const out = new Map<string, Point>()
  const localOf = (id: string): Point => {
    const override = positions?.get(id)
    if (override) return override
    const node = byId.get(id)
    return node ? storedPosition(node) : { x: 0, y: 0 }
  }

  const resolve = (id: string, depth: number): Point => {
    const known = out.get(id)
    if (known) return known
    const local = localOf(id)
    const parent = hierarchy.parentOf.get(id) ?? null
    const at =
      parent === null || depth >= MAX_DEPTH
        ? local
        : (() => {
            const origin = resolve(parent, depth + 1)
            return { x: origin.x + local.x, y: origin.y + local.y }
          })()
    out.set(id, at)
    return at
  }

  for (const node of nodes) resolve(node.id, 0)
  return out
}

/**
 * The inverse of absolutePositions for one node: where `absolute` (in
 * workspace-frame coordinates) is, relative to the node's parent folder.
 */
export function toLocalPosition(nodes: readonly SubspaceNode[], nodeId: string, absolute: Point): Point {
  const hierarchy = folderHierarchy(nodes)
  const parent = hierarchy.parentOf.get(nodeId) ?? null
  if (parent === null) return { x: absolute.x, y: absolute.y }
  const origin = absolutePositions(nodes, undefined, hierarchy).get(parent) ?? { x: 0, y: 0 }
  return { x: absolute.x - origin.x, y: absolute.y - origin.y }
}

/** The ids of a note's ancestor folders, outermost first. */
export function revealExpanded(nodes: readonly SubspaceNode[], noteId: string): string[] {
  const hierarchy = folderHierarchy(nodes)
  const chain: string[] = []
  let parent = hierarchy.parentOf.get(noteId) ?? null
  for (let depth = 0; parent !== null && depth < MAX_DEPTH; depth += 1) {
    chain.unshift(parent)
    parent = hierarchy.parentOf.get(parent) ?? null
  }
  return chain
}

// ---------------------------------------------------------------------------
// Rects
// ---------------------------------------------------------------------------

function cardSize(node: SubspaceNode | undefined, dims: ReturnType<DimsOf>): { width: number; height: number } {
  if (dims) return dims
  const stored = node ? Number(node.props['width']?.value ?? 0) : 0
  return {
    width: Number.isFinite(stored) && stored > 0 ? stored : CARD_ESTIMATE.width,
    height: CARD_ESTIMATE.height,
  }
}

interface LayoutParts extends SubspaceLayout {
  /** A child's box in its parent's local space: a card or a folder rect. */
  boxOf: (id: string) => ContentBox
}

function computeLayout(
  nodes: readonly SubspaceNode[],
  hierarchy: FolderHierarchy,
  dimsOf: DimsOf,
  expandedOverride: ReadonlySet<string> | undefined,
  positions: ReadonlyMap<string, Point> | undefined,
): LayoutParts {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const folderRects = new Map<string, FrameRect>()
  const expanded = new Set<string>()

  const localOf = (id: string): Point => {
    const override = positions?.get(id)
    if (override) return override
    const node = byId.get(id)
    return node ? storedPosition(node) : { x: 0, y: 0 }
  }

  const cardBox = (id: string): ContentBox => {
    const at = localOf(id)
    const size = cardSize(byId.get(id), dimsOf(id))
    return { x: at.x, y: at.y, width: size.width, height: size.height }
  }

  const rectOf = (folderId: string, depth: number): FrameRect => {
    const known = folderRects.get(folderId)
    if (known) return known
    const children = depth < MAX_DEPTH ? (hierarchy.childrenOf.get(folderId) ?? []) : []
    const boxes = children.map((child) =>
      hierarchy.folders.has(child) ? rectOf(child, depth + 1) : cardBox(child),
    )
    const full = computeFrameBounds(localOf(folderId), boxes, FOLDER_FRAME)
    const node = byId.get(folderId)
    const open = (node !== undefined && !isCollapsed(node)) || (expandedOverride?.has(folderId) ?? false)
    // A collapsed folder keeps its header where the open frame's header is, so
    // collapsing and expanding never make the name jump.
    const rect = open
      ? full
      : { x: full.x, y: full.y, width: FOLDER_FRAME.minWidth, height: FOLDER_FRAME.headerHeight }
    if (open) expanded.add(folderId)
    folderRects.set(folderId, rect)
    return rect
  }

  const boxOf = (id: string): ContentBox => (hierarchy.folders.has(id) ? rectOf(id, 0) : cardBox(id))

  for (const folderId of hierarchy.folders) rectOf(folderId, 0)
  const rootBoxes = (hierarchy.childrenOf.get(null) ?? []).map(boxOf)

  return { hierarchy, folderRects, expanded, rootBoxes, boxOf }
}

/**
 * Every folder's rect (in its parent's local space), and the boxes the
 * workspace frame is sized around. A collapsed folder is its header band only;
 * an open one is computeFrameBounds over its cards and its child folders'
 * rects, computed deepest first.
 */
export function subspaceRects(
  nodes: readonly SubspaceNode[],
  dimsOf: DimsOf,
  expandedOverride?: ReadonlySet<string>,
  positionOverride?: ReadonlyMap<string, Point>,
): SubspaceLayout {
  const { hierarchy, folderRects, expanded, rootBoxes } = computeLayout(
    nodes,
    folderHierarchy(nodes),
    dimsOf,
    expandedOverride,
    positionOverride,
  )
  return { hierarchy, folderRects, expanded, rootBoxes }
}

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

function boundsOf(boxes: readonly ContentBox[]): ContentBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const box of boxes) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * What must move after a folder moved or expanded, as position ops.
 *
 * The folder is the fixed point: its siblings (in its parent's local space)
 * yield through pushApart, then the parent — which may have grown — is settled
 * among its own siblings, and so on up to the workspace root. A parent's cards
 * yield as one block, so a card grid keeps its shape instead of scattering
 * (cards sit closer together than FRAME_GAP). Each displaced frame's origin
 * moves by its rect's delta, as settleFrames does for tree frames.
 *
 * Every node whose resulting position differs from what it stores gets a
 * position.x/position.y pair, including the moved folder itself when
 * `override.positions` places it somewhere new. No other key is ever emitted.
 */
export function settleSubspace(
  nodes: readonly SubspaceNode[],
  dimsOf: DimsOf,
  movedFolderId: string,
  override?: SubspaceOverride,
): SubspaceOp[] {
  const hierarchy = folderHierarchy(nodes)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const positions = new Map<string, Point>(override?.positions ?? [])
  const localOf = (id: string): Point => {
    const moved = positions.get(id)
    if (moved) return moved
    const node = byId.get(id)
    return node ? storedPosition(node) : { x: 0, y: 0 }
  }

  let current: string | null = hierarchy.folders.has(movedFolderId) ? movedFolderId : null
  for (let depth = 0; current !== null && depth < MAX_DEPTH; depth += 1) {
    const parent: string | null = hierarchy.parentOf.get(current) ?? null
    const layout = computeLayout(nodes, hierarchy, dimsOf, override?.expanded, positions)
    const siblings = hierarchy.childrenOf.get(parent) ?? []

    const rects: PositionedRect[] = []
    const cards: string[] = []
    for (const sibling of siblings) {
      if (hierarchy.folders.has(sibling)) rects.push({ id: sibling, ...layout.boxOf(sibling) })
      else cards.push(sibling)
    }
    if (cards.length > 0) rects.push({ id: CARD_BLOCK_ID, ...boundsOf(cards.map(layout.boxOf)) })

    const displaced = pushApart(rects, current)
    for (const [id, next] of displaced) {
      const before = rects.find((rect) => rect.id === id)
      if (!before) continue
      const dx = next.x - before.x
      const dy = next.y - before.y
      const moved = id === CARD_BLOCK_ID ? cards : [id]
      for (const target of moved) {
        const at = localOf(target)
        positions.set(target, { x: at.x + dx, y: at.y + dy })
      }
    }

    current = parent
  }

  const ops: SubspaceOp[] = []
  const ids = [...positions.keys()].sort()
  for (const id of ids) {
    const node = byId.get(id)
    if (!node) continue
    const at = positions.get(id)!
    const stored = storedPosition(node)
    const hasX = node.props['position.x'] !== undefined
    const hasY = node.props['position.y'] !== undefined
    if (hasX && hasY && stored.x === at.x && stored.y === at.y) continue
    ops.push(
      { op: 'setProperty', target: id, key: 'position.x', type: 'real', value: at.x },
      { op: 'setProperty', target: id, key: 'position.y', type: 'real', value: at.y },
    )
  }
  return ops
}
