/**
 * TreeFrame — one tree drawn inside its own named frame (D-15).
 *
 * A tree's notes store frame-local positions, so the frame is the thing that
 * places them in the world: the content layer is translated so local (0, 0)
 * lands at the frame's origin. Notes therefore keep their stored coordinates
 * when a frame moves, which is what lets a whole tree be dragged as one piece
 * without rewriting every note's position.
 *
 * Connections are drawn per tree, inside that tree's own SVG layer, so a line
 * can never imply a relationship across two worlds (cross-tree links are
 * D-16, Plan 15).
 */

import React, { useState, useEffect, useRef } from 'react'
import { useAnnounce } from './LiveAnnouncer'
import NoteCard from './NoteCard'
import VaultNoteCard from './VaultNoteCard'
import WorkspaceFileCard from './WorkspaceFileCard'
import FolderFrame from './FolderFrame'
import FallbackNodeView from './FallbackNodeView'
import ConnectionLine from './ConnectionLine'
import KnotNode, { KNOT_TYPE, KNOT_TIE_LABEL } from './KnotNode'
import FrameHeader from './FrameHeader'
import ThreadCard, { THREAD_TYPE } from '../threads/ThreadCard'
import SessionBridge from '../threads/SessionBridge'
import ThreadSettingsPopover from '../threads/ThreadSettingsPopover'
import type { ForestTree, NodeRef } from '../state/use-forest'
import { nodeKey } from '../state/use-forest'
import type { FrameRect } from '../layout/frames'
import type { DisplaySpot } from '../layout/placement'
import {
  absolutePositions,
  isFolderNode,
  storedPosition,
  type Point,
  type SubspaceLayout,
} from '../layout/subspaces'
import type { NodeInfo } from './Canvas'
import {
  FALLBACK_SIZE,
  absolutePositions as nestedPositions,
  buildNesting,
  clampToSurface,
  containerMinSizes,
  dropContainer,
  isNestable,
  moveIntoOps,
  newChildSpot,
  outlineState,
  type NestingOp,
  type Size,
} from '../layout/nesting'
import { FormFades, formsToDraw, type ShownForm } from '../look/collapse'
import { flightScale, formScreenWidth, type FlightFrame } from '../look/enter'
import { CollapsedNote } from '../look/CollapsedNote'
import { seedFromId } from '../look/ink'
import { effectStrength, readMotionSettings } from '../look/motion'
import { LOOK } from '../look/values'

/** Fallback knot size until the node registers its real dims. */
const KNOT_FALLBACK_WIDTH = 200
const KNOT_FALLBACK_HEIGHT = 44

function isKnot(n: NodeInfo): boolean {
  return n.type === KNOT_TYPE
}

function isThread(n: NodeInfo): boolean {
  return n.type === THREAD_TYPE
}

/**
 * The component names this build can draw, by the name a plugin registers.
 *
 * A plugin contributes a node view as a *string*, so the host is never handed
 * code to execute. Until this plan that string was only ever checked for
 * existence and every registered type rendered as a NoteCard — which would have
 * drawn a vault note through a ProseMirror editor and let a keystroke commit
 * editor JSON into `md.text`.
 *
 * A name with no component here is not an error: it falls through to
 * FallbackNodeView, which is how `FolderGroup`, `FileNote` and
 * `PlaceholderNote` stay readable until Plan 09 draws them (D-33/D-35).
 *
 * The workspace-files plugin still registers `WorkspaceFolderLabel` for folder
 * nodes; it maps to nothing now, and is never reached for a workspace tree,
 * whose folders are drawn as FolderFrames from the hierarchy (02.7 D-21).
 */

const NODE_VIEW_COMPONENTS = {
  NoteCard,
  VaultNoteCard,
  WorkspaceFileCard,
} as const

type NodeViewComponentName = keyof typeof NODE_VIEW_COMPONENTS

function mappedNodeView(name: string | undefined): NodeViewComponentName | null {
  return name !== undefined && name in NODE_VIEW_COMPONENTS
    ? (name as NodeViewComponentName)
    : null
}

/** The tree file's own name, which is what the error copy names. */
function treeFileName(path: string): string {
  return path.split('/').pop() ?? path
}

/**
 * What an unavailable frame says (UI-SPEC "Copywriting Contract" error rows).
 *
 * Each line says what happened, what was *not* changed, and what to do next.
 * "Nothing in the vault was changed" is load-bearing: the first thing anyone
 * wants to know when a tree will not open is whether their notes are gone.
 */
function unavailableCopy(tree: ForestTree): string {
  const file = treeFileName(tree.path)
  switch (tree.status) {
    case 'damaged':
      return (
        `${file} is damaged, so Tapestry won't write to this tree. ` +
        'Nothing in the vault was changed. Choose Show tree file in Finder to find it; ' +
        'after restoring or repairing the file, reopen it from Add tree.'
      )
    case 'locked':
      return `${file} is open in another Tapestry window. Close it there, then choose Reopen tree.`
    case 'missing':
      return `${file} can't be found at ${tree.path}. It may have been moved or renamed.`
    default:
      return ''
  }
}

/** The ways out of each state. The first is the primary action. */
function unavailableActions(
  tree: ForestTree,
  onCloseTree: (treeId: string) => void,
): Array<{ label: string; run: () => void }> {
  const closeTree = {
    label: 'Close tree',
    run: (): void => {
      onCloseTree(tree.id)
    },
  }

  switch (tree.status) {
    case 'damaged':
      return [
        {
          label: 'Show tree file in Finder',
          run: (): void => {
            void window.tapestry.trees.reveal(tree.id)
          },
        },
        closeTree,
      ]
    case 'locked':
      return [
        {
          label: 'Reopen tree',
          run: (): void => {
            void window.tapestry.trees.reopen(tree.id)
          },
        },
        closeTree,
      ]
    default:
      // Missing: a vault folder gains Locate folder... in Plan 08.
      return [closeTree]
  }
}

/** Everything a note inside a frame can ask the space to do. */
export interface TreeFrameHandlers {
  onStartEditing: (ref: NodeRef) => void
  onSave: (ref: NodeRef, body: string, title: string) => Promise<void>
  onMarkDirty: (ref: NodeRef) => void
  onMarkClean: (ref: NodeRef) => void
  onPositionChange: (ref: NodeRef, x: number, y: number) => void
  /** A person moved a following note: position and pinned=true (D-03, D-16). */
  onTakeOverPosition: (ref: NodeRef, x: number, y: number) => void
  onWidthChange: (ref: NodeRef, width: number) => void
  onHeightChange: (ref: NodeRef, height: number) => void
  onPinnedPositionChange: (ref: NodeRef, x: number, y: number) => void
  onDeleteNote: (ref: NodeRef) => void
  onPropertyEdit: (
    ref: NodeRef,
    key: string,
    type: string,
    value: string | number | boolean,
  ) => void
  onBorderSelect: (ref: NodeRef) => void
  onHover: (ref: NodeRef, hovered: boolean) => void
  onHoverDuringConnection: (ref: NodeRef | null) => void
  onStartConnection: (ref: NodeRef) => void
  onRegisterDims: (ref: NodeRef, width: number, height: number) => void
  onDragMove: (ref: NodeRef, x: number, y: number) => void
  onDragEnd: (ref: NodeRef) => void
  /**
   * Close a tree, from Tree options or an unavailable frame's actions. App
   * waits for main and shows a refusal or failure (review WR-03).
   */
  onCloseTree: (treeId: string) => void
  /** A folder frame's collapse/expand button; `collapsed` is the state wanted (D-21). */
  onToggleFolder: (ref: NodeRef, collapsed: boolean) => void
  /** Pointer down on a folder frame's header: the start of a folder drag (D-21). */
  onFolderHeaderPointerDown: (ref: NodeRef, e: React.PointerEvent<HTMLDivElement>) => void
  /** A note moved into or out of another note: one 'Move note' commit (nesting.ts). */
  onNestingMove: (ref: NodeRef, ops: NestingOp[]) => void
  /** "New note inside" a note, at a spot local to it. */
  onCreateInside: (container: NodeRef, x: number, y: number) => void
  /**
   * Fit a frame-local rect to the view ("Zoom into note", a double-click). With
   * `onFlight`, the note flies with the glide and Escape flies back out
   * (look/enter.ts): it hears the flight's progress every frame.
   */
  onZoomToRect: (
    treeId: string,
    rect: { x: number; y: number; width: number; height: number },
    onFlight?: (f: FlightFrame) => void,
  ) => void
}

/** A workspace tree's folder subspaces, computed once in Canvas (02.7 D-21). */
export interface TreeSubspaces {
  layout: SubspaceLayout
  /** Live local positions (drags) the layout was computed with. */
  positions: ReadonlyMap<string, Point>
  /** The folder being dragged, if any. */
  draggingFolderId: string | null
}

interface TreeFrameProps {
  tree: ForestTree
  /** The frame's world rect, already computed from content bounds. */
  rect: FrameRect
  zoom: number
  /**
   * The drawn camera roll, in degrees. Cards need it, with zoom, to turn
   * screen deltas into world deltas; the frame header does not.
   */
  roll: number
  /** Per-note UI state, keyed by nodeKey so two trees cannot collide. */
  editingKey: string | null
  hoveredKey: string | null
  /** Every selected note's nodeKey (this tree's only; see sameFrameProps). */
  selectedKeys: ReadonlySet<string>
  connectingHoverKey: string | null
  /** True while any connection drag is in progress, in any tree. */
  isConnecting: boolean
  /**
   * When a connection last landed in this tree (performance.now()), or null:
   * the canvas's "landed" event, so the new line can flash (wave 4).
   */
  landedAt?: number | null
  pluginNodeViews: Record<string, string>
  currentUserActorId: string | null
  /** Live drag positions, keyed by nodeKey. */
  dragPositions: Record<string, { x: number; y: number }>
  /**
   * Selected notes carried along by another note's drag, keyed by nodeKey, in
   * their own (container-local) coordinates. Kept apart from dragPositions,
   * which a card's own drag writes, so the card being dragged never reads it.
   */
  followerPositions?: Record<string, { x: number; y: number }>
  /**
   * Where each note in this tree is drawn, keyed by bare node id (D-05). The
   * single source of a note's drawn spot, computed once in Canvas so frame
   * bounds, edges and cards agree on where a following note is.
   */
  displayPositions: ReadonlyMap<string, DisplaySpot>
  getDims: (key: string) => { width: number; height: number } | undefined
  /** Frame-level state, which drives the border treatment (UI-SPEC). */
  isSelected: boolean
  isHovered: boolean
  isDragging: boolean
  /** Pointer down on the header band: the start of a frame drag. */
  onHeaderPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onFrameHover: (hovered: boolean) => void
  handlers: TreeFrameHandlers
  /** Set for a workspace tree: its folders are drawn as nested frames. */
  subspaces?: TreeSubspaces
  /** open_file's request to open one file window, keyed `<treeId>:<noteId>` (02.7 SC2). */
  openRequest?: { key: string; nonce: number } | null
}

function TreeFrame({
  tree,
  rect,
  zoom,
  roll,
  editingKey,
  hoveredKey,
  selectedKeys,
  connectingHoverKey,
  isConnecting,
  landedAt = null,
  pluginNodeViews,
  currentUserActorId,
  dragPositions,
  followerPositions,
  displayPositions,
  getDims,
  isSelected,
  isHovered,
  isDragging,
  onHeaderPointerDown,
  onFrameHover,
  handlers,
  subspaces,
  openRequest,
}: TreeFrameProps): React.ReactElement {
  const announce = useAnnounce()

  const isUnavailable = tree.status !== 'ok'
  const failureLine = isUnavailable ? unavailableCopy(tree) : ''

  // The dashed frame and its copy are a visual cue, so the reason also reaches
  // the assertive region — once, when it appears, rather than on every render.
  useEffect(() => {
    if (failureLine.length > 0) announce.assertive(failureLine)
    // Keyed to the tree and its status on purpose: re-announcing the same
    // failure on every render is exactly what this must not do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.id, tree.status])

  // Dragging outranks selected, which outranks hovered: the strongest thing
  // true of the frame right now is what its border should say.
  const stateClass = isDragging
    ? ' tapestry-tree-frame--dragging'
    : isSelected
      ? ' tapestry-tree-frame--selected'
      : isHovered
        ? ' tapestry-tree-frame--hovered'
        : ''

  const frameStyle: React.CSSProperties = {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  }

  // A tree that would not open keeps its place and its name, and says why.
  // It renders no content layer at all: there is no graph to draw, and nothing
  // here holds a handle through which it could be written to.
  if (isUnavailable) {
    const actions = unavailableActions(tree, handlers.onCloseTree)
    return (
      <div
        className={`tapestry-tree-frame tapestry-tree-frame--unavailable${stateClass}`}
        data-tree-id={tree.id}
        style={frameStyle}
      >
        <div onPointerEnter={() => onFrameHover(true)} onPointerLeave={() => onFrameHover(false)}>
          <FrameHeader
            treeId={tree.id}
            name={tree.name}
            kind={tree.kind}
            saveState={tree.saveState}
            zoom={zoom}
            onPointerDown={onHeaderPointerDown}
            onClose={() => handlers.onCloseTree(tree.id)}
          />
        </div>

        <div className="tapestry-frame-unavailable-body">
          <p className="tapestry-frame-unavailable-text">{failureLine}</p>
          <div className="tapestry-frame-unavailable-actions">
            {actions.map((action, index) => (
              <button
                key={action.label}
                type="button"
                className={
                  index === 0 ? 'tapestry-button--primary' : 'tapestry-button--secondary'
                }
                onClick={action.run}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const refFor = (nodeId: string): NodeRef => ({ treeId: tree.id, nodeId })
  const keyFor = (nodeId: string): string => nodeKey(refFor(nodeId))

  /**
   * A person's drop (or left/top resize) of a note. A note that is visibly
   * following its parent is taken over and pinned (D-03, D-16); any other
   * note moves exactly as before (D-02).
   */
  const writePosition = (nodeId: string, x: number, y: number): void => {
    if (displayPositions.get(nodeId)?.following === true) {
      handlers.onTakeOverPosition(refFor(nodeId), x, y)
    } else {
      handlers.onPositionChange(refFor(nodeId), x, y)
    }
  }

  // A workspace tree stores folder-local positions (D-21): edges are drawn
  // between absolute (tree-frame) centres, and an edge whose end sits inside a
  // collapsed folder is hidden rather than rerouted.
  const hierarchy = subspaces?.layout.hierarchy ?? null
  const absolute = subspaces
    ? absolutePositions(tree.nodes, subspaces.positions, subspaces.layout.hierarchy)
    : null
  const isInsideCollapsed = (nodeId: string): boolean => {
    if (!subspaces || !hierarchy) return false
    let parent = hierarchy.parentOf.get(nodeId) ?? null
    for (let depth = 0; parent !== null && depth < 256; depth += 1) {
      if (!subspaces.layout.expanded.has(parent)) return true
      parent = hierarchy.parentOf.get(parent) ?? null
    }
    return false
  }
  const nodesById = new Map(tree.nodes.map((node) => [node.id, node]))

  // ---------------------------------------------------------------------
  // Notes inside notes (layout/nesting.ts). A nested note's stored position
  // is local to its container; everything here draws it at its frame-local
  // spot and turns a drop back into local coordinates. Workspace trees nest
  // by folder instead, so they skip this.
  // ---------------------------------------------------------------------

  const nesting = subspaces ? null : buildNesting(tree.nodes)

  /** A note's own spot in its container's coordinates (or the frame's). */
  const localSpot = (nodeId: string): Point => {
    const spot = displayPositions.get(nodeId)
    if (spot) return { x: spot.x, y: spot.y }
    const drag = dragPositions[keyFor(nodeId)]
    if (drag) return drag
    const node = nodesById.get(nodeId)
    return node ? storedPosition(node) : { x: 0, y: 0 }
  }

  /** A note's drawn size as last measured, else its stored or default size. */
  const sizeOf = (nodeId: string): Size => {
    const dims = getDims(keyFor(nodeId))
    if (dims) return dims
    const node = nodesById.get(nodeId)
    const w = Number(node?.props['width']?.value ?? 0)
    const h = Number(node?.props['height']?.value ?? 0)
    return { width: w > 0 ? w : FALLBACK_SIZE.width, height: h > 0 ? h : FALLBACK_SIZE.height }
  }

  const nestedAt = nesting ? nestedPositions(nesting, localSpot) : null
  const containerMins = nesting ? containerMinSizes(nesting, localSpot, sizeOf) : null
  // Zoomed out, a note too small to read collapses to a circle or a dot
  // (look/collapse.ts) and its contents are hidden; changes of form crossfade.
  const outlineWidth = (id: string): number => Math.max(sizeOf(id).width, containerMins?.get(id)?.width ?? 0)
  const outlines = nesting
    ? outlineState(nesting, outlineWidth, zoom)
    : { collapsed: new Map<string, 'circle' | 'dot'>(), hidden: new Set<string>() }
  const formAt = (o: typeof outlines, id: string): ShownForm =>
    o.hidden.has(id) ? 'hidden' : (o.collapsed.get(id) ?? 'note')

  // Entering a note (look/enter.ts). While the camera glides in or out, no
  // form crossfades: the entered note, and every other note that is drawn at
  // both ends but in a different form, is drawn as its card the whole way,
  // scaled from the form it left to the form it lands in. A note that is
  // hidden at one end (inside a collapsed container) just changes form.
  const [flyingId, setFlyingId] = useState<string | null>(null)
  const flightRef = useRef<FlightFrame | null>(null)
  const flight = flyingId !== null && nesting?.depthOf.has(flyingId) ? flightRef.current : null
  /** Each flying note's extra scale this frame, and the form it lands in. */
  const flyers = new Map<string, { scale: number; endForm: ShownForm }>()
  /** Notes whose form changes during the flight: none of them fades. */
  const noFade = new Set<string>()
  if (nesting && flight && flyingId) {
    const fromOutlines = outlineState(nesting, outlineWidth, flight.fromZoom)
    const toOutlines = outlineState(nesting, outlineWidth, flight.toZoom)
    for (const id of nesting.depthOf.keys()) {
      const fromForm = formAt(fromOutlines, id)
      const endForm = formAt(toOutlines, id)
      if (id !== flyingId && fromForm === endForm) continue
      noFade.add(id)
      if (id !== flyingId && (fromForm === 'hidden' || endForm === 'hidden')) continue
      const w = outlineWidth(id)
      const scale = flightScale(
        formScreenWidth(fromForm, w, flight.fromZoom),
        formScreenWidth(endForm, w, flight.toZoom),
        w,
        zoom,
        flight.p,
      )
      flyers.set(id, { scale, endForm })
    }
  }

  const shownForms = new Map<string, ShownForm>()
  for (const id of nesting?.depthOf.keys() ?? []) {
    // The tracker hears where a flying note lands, so it has nothing to fade then either.
    shownForms.set(id, flyers.get(id)?.endForm ?? formAt(outlines, id))
  }
  const fadeMs = effectStrength(readMotionSettings(), 'collapseFade') > 0 ? LOOK.detail.formCrossfadeMs : 0
  const formFades = useRef<FormFades | null>(null)
  if (!formFades.current) formFades.current = new FormFades()
  const fades = formFades.current.update(shownForms, performance.now(), fadeMs, noFade)
  // Draw once more when the soonest fade ends, to drop the form it left.
  const [, setFadeTick] = useState(0)
  const fadeEnd = formFades.current.nextEndMs(fadeMs)
  useEffect(() => {
    if (fadeEnd === null) return
    const t = window.setTimeout(() => setFadeTick((n) => n + 1), Math.max(0, fadeEnd - performance.now()) + 16)
    return () => window.clearTimeout(t)
  }, [fadeEnd])
  const containerOf = (nodeId: string): string | null => nesting?.containerOf.get(nodeId) ?? null

  /** Where a note is in the frame, following every container it is in. */
  const frameSpot = (nodeId: string): Point => nestedAt?.get(nodeId) ?? localSpot(nodeId)

  /** The note's drawn rect in the frame, or null while it is not drawn. */
  const drawnRect = (nodeId: string): { x: number; y: number; width: number; height: number } | null => {
    if (outlines.hidden.has(nodeId)) return null
    const at = frameSpot(nodeId)
    const size = sizeOf(nodeId)
    const min = containerMins?.get(nodeId)
    return {
      x: at.x,
      y: at.y,
      width: Math.max(size.width, min?.width ?? 0),
      height: Math.max(size.height, min?.height ?? 0),
    }
  }

  /**
   * A card dropped with its top-left at a frame-local point: the note lands
   * inside whatever note is under its centre (or at the top level), in that
   * note's coordinates. Staying in the same container is an ordinary move,
   * so a following note is still taken over exactly as before.
   */
  const placeNote = (nodeId: string, frameX: number, frameY: number): void => {
    if (!nesting || !nesting.depthOf.has(nodeId)) {
      writePosition(nodeId, frameX, frameY)
      return
    }
    const size = sizeOf(nodeId)
    const centre = { x: frameX + size.width / 2, y: frameY + size.height / 2 }
    const target = dropContainer(nesting, drawnRect, nodeId, centre)
    const current = containerOf(nodeId)
    if (target === current) {
      const origin = current !== null ? frameSpot(current) : { x: 0, y: 0 }
      const local = clampToSurface({ x: frameX - origin.x, y: frameY - origin.y }, current !== null)
      writePosition(nodeId, local.x, local.y)
      return
    }
    const targetAt = target !== null ? frameSpot(target) : null
    handlers.onNestingMove(refFor(nodeId), moveIntoOps(nodeId, target, { x: frameX, y: frameY }, targetAt, current))
  }

  /** A live drag reported in frame coordinates, stored in the note's own. */
  const dragNote = (nodeId: string, frameX: number, frameY: number): void => {
    const current = containerOf(nodeId)
    const origin = current !== null ? frameSpot(current) : { x: 0, y: 0 }
    handlers.onDragMove(refFor(nodeId), frameX - origin.x, frameY - origin.y)
  }

  // The note being dragged in this tree (if any) and the note it would land in.
  const draggingId = nesting
    ? (tree.nodes.find((n) => isNestable(n) && dragPositions[keyFor(n.id)] !== undefined)?.id ?? null)
    : null
  const dropTargetId = (() => {
    if (!nesting || draggingId === null) return null
    const at = frameSpot(draggingId)
    const size = sizeOf(draggingId)
    const target = dropContainer(nesting, drawnRect, draggingId, { x: at.x + size.width / 2, y: at.y + size.height / 2 })
    return target !== containerOf(draggingId) ? target : null
  })()

  const createInside = (nodeId: string): void => {
    if (!nesting) return
    const spot = newChildSpot(nesting, nodeId, localSpot, sizeOf, sizeOf(nodeId).height)
    handlers.onCreateInside(refFor(nodeId), spot.x, spot.y)
  }

  /** Enter a note: zoom in on it with the note flying along (look/enter.ts). */
  const zoomTo = (nodeId: string): void => {
    const rect = drawnRect(nodeId)
    if (!rect) return
    handlers.onZoomToRect(tree.id, rect, (f) => {
      if (f.p >= 1) {
        flightRef.current = null
        setFlyingId(null)
      } else {
        flightRef.current = f
        setFlyingId(nodeId)
      }
    })
  }

  /** Nested notes draw after (over) their containers. */
  const depthOrder = (a: NodeInfo, b: NodeInfo): number =>
    (nesting?.depthOf.get(a.id) ?? 0) - (nesting?.depthOf.get(b.id) ?? 0)

  // ThreadCard menu (D-07 UI-SPEC "The thread on the 2D canvas": "Open
  // thread", "Thread settings", "Delete thread") and the settings popover it
  // opens (UI-SPEC "Thread settings": "opened from ... the ThreadCard menu").
  const [threadMenuOpenFor, setThreadMenuOpenFor] = useState<string | null>(null)
  const [threadSettingsFor, setThreadSettingsFor] = useState<{ nodeId: string; x: number; y: number } | null>(null)

  /** A note's center in this tree's local coordinates. */
  const getNodeCenter = (nodeId: string): { x: number; y: number } | null => {
    const node = tree.nodes.find((n) => n.id === nodeId)
    if (!node) return null
    const inSubspace = absolute !== null && hierarchy !== null && hierarchy.parentOf.has(nodeId)
    if (inSubspace) {
      const at = absolute.get(nodeId) ?? storedPosition(node)
      const dims = getDims(keyFor(nodeId))
      return { x: at.x + (dims?.width ?? 240) / 2, y: at.y + (dims?.height ?? 80) / 2 }
    }
    const nestedSpot = nestedAt?.get(nodeId)
    if (nestedSpot && containerOf(nodeId) !== null) {
      const dims = getDims(keyFor(nodeId))
      return { x: nestedSpot.x + (dims?.width ?? 240) / 2, y: nestedSpot.y + (dims?.height ?? 80) / 2 }
    }
    const drag = dragPositions[keyFor(nodeId)]
    const spot = displayPositions.get(nodeId)
    const px = spot ? spot.x : drag ? drag.x : Number(node.props['position.x']?.value ?? 0)
    const py = spot ? spot.y : drag ? drag.y : Number(node.props['position.y']?.value ?? 0)
    const dims = getDims(keyFor(nodeId))
    return { x: px + (dims?.width ?? 240) / 2, y: py + (dims?.height ?? 80) / 2 }
  }

  // ---------------------------------------------------------------------
  // Knot auto positions (D-17), computed ONCE for this tree and shared by its
  // edge layer and its node layer. An unpinned knot is RENDERED at the
  // midpoint of its endpoints rather than at its stored position, so edges
  // must resolve it from here or the knot-ties end at a phantom point that
  // drifts whenever an endpoint note moves.
  // ---------------------------------------------------------------------

  const knotAuto = new Map<
    string,
    { left: number; top: number; width: number; height: number }
  >()
  for (const node of tree.nodes) {
    if (!isKnot(node)) continue
    const dims = getDims(keyFor(node.id))
    const width = dims?.width ?? KNOT_FALLBACK_WIDTH
    const height = dims?.height ?? KNOT_FALLBACK_HEIGHT
    const px = Number(node.props['position.x']?.value ?? 0)
    const py = Number(node.props['position.y']?.value ?? 0)
    const isPinned =
      node.props['pinned']?.value === true || node.props['pinned']?.value === 'true'

    let left = px
    let top = py
    if (!isPinned) {
      const sourceEdge = tree.edges.find((e) => e.label === KNOT_TIE_LABEL && e.to === node.id)
      const destEdge = tree.edges.find((e) => e.label === KNOT_TIE_LABEL && e.from === node.id)
      const sourceCenter = sourceEdge ? getNodeCenter(sourceEdge.from) : null
      const destCenter = destEdge ? getNodeCenter(destEdge.to) : null
      if (sourceCenter && destCenter) {
        left = (sourceCenter.x + destCenter.x) / 2 - width / 2
        top = (sourceCenter.y + destCenter.y) / 2 - height / 2
      }
    }
    knotAuto.set(node.id, { left, top, width, height })
  }

  /** Node center honoring the displayed (auto) position of knots. */
  const resolveNodeCenter = (nodeId: string): { x: number; y: number } | null => {
    const auto = knotAuto.get(nodeId)
    if (auto) return { x: auto.left + auto.width / 2, y: auto.top + auto.height / 2 }
    return getNodeCenter(nodeId)
  }

  /** A node's local position, honouring a live drag (subspace trees). */
  const localOf = (nodeId: string): Point => {
    const live = subspaces?.positions.get(nodeId)
    if (live) return live
    const node = nodesById.get(nodeId)
    return node ? storedPosition(node) : { x: 0, y: 0 }
  }

  /** Folder nodes, and anything inside a folder, belong to a FolderFrame. */
  const isNestedInSubspace = (node: NodeInfo): boolean => {
    if (!hierarchy) return false
    if (isFolderNode(node)) return true
    return (hierarchy.parentOf.get(node.id) ?? null) !== null
  }

  /** One workspace file card, wherever it sits (the root or a folder). */
  const renderWorkspaceCard = (node: NodeInfo): React.ReactElement => (
    <WorkspaceFileCard
      key={node.id}
      treeId={tree.id}
      node={node}
      isSelected={selectedKeys.has(keyFor(node.id))}
      zoom={zoom}
      provenance={tree.history?.nodes[node.id]}
      onBorderSelect={() => handlers.onBorderSelect(refFor(node.id))}
      onHover={(hovered) => handlers.onHover(refFor(node.id), hovered)}
      onPositionChange={(nodeId, x, y) => handlers.onPositionChange(refFor(nodeId), x, y)}
      onRegisterDims={(nodeId, w, h) => handlers.onRegisterDims(refFor(nodeId), w, h)}
      onDragMove={(nodeId, x, y) => handlers.onDragMove(refFor(nodeId), x, y)}
      onDragEnd={(nodeId) => handlers.onDragEnd(refFor(nodeId))}
      openNonce={openRequest?.key === `${tree.id}:${node.id}` ? openRequest.nonce : undefined}
    />
  )

  // The content layer translates local (0, 0) to the frame origin. It is
  // offset from the frame rect, not the world, because it is a child of the
  // rect-positioned container.
  const contentStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    transform: `translate(${tree.frame.x - rect.x}px, ${tree.frame.y - rect.y}px)`,
  }

  return (
    <div className={`tapestry-tree-frame${stateClass}`} data-tree-id={tree.id} style={frameStyle}>
      <div
        onPointerEnter={() => onFrameHover(true)}
        onPointerLeave={() => onFrameHover(false)}
      >
        <FrameHeader
          treeId={tree.id}
          name={tree.name}
          kind={tree.kind}
          saveState={tree.saveState}
          zoom={zoom}
          onPointerDown={onHeaderPointerDown}
          onClose={() => handlers.onCloseTree(tree.id)}
        />
      </div>

      <div
        className="tapestry-tree-frame-content"
        style={{ ...contentStyle, ['--tap-form-fade-ms' as string]: `${LOOK.detail.formCrossfadeMs}ms` }}
      >
        {/* This tree's connections only (D-16 cross-tree links are Plan 15) */}
        <svg
          className="tapestry-connections-svg"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            // 1 px, not 100%: the parent has no size, and a 0 × 0 SVG draws nothing
            // even with overflow visible.
            width: 1,
            height: 1,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          {tree.edges.map((edge) => {
            if (isInsideCollapsed(edge.from) || isInsideCollapsed(edge.to)) return null
            if (outlines.hidden.has(edge.from) || outlines.hidden.has(edge.to)) return null
            const from = resolveNodeCenter(edge.from)
            const to = resolveNodeCenter(edge.to)
            if (!from || !to) return null
            return (
              <ConnectionLine
                key={edge.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                seedKey={edge.id}
                landedAt={landedAt}
              />
            )
          })}
        </svg>

        {/* Knot nodes (D-16/D-17/D-18) */}
        {tree.nodes.filter(isKnot).map((node) => {
          const px = Number(node.props['position.x']?.value ?? 0)
          const py = Number(node.props['position.y']?.value ?? 0)
          const isPinned =
            node.props['pinned']?.value === true || node.props['pinned']?.value === 'true'
          const bodyVal = node.props['body']?.value
          const body = typeof bodyVal === 'string' ? bodyVal : ''

          const sourceEdge = tree.edges.find((e) => e.label === KNOT_TIE_LABEL && e.to === node.id)
          const destEdge = tree.edges.find((e) => e.label === KNOT_TIE_LABEL && e.from === node.id)

          const auto = knotAuto.get(node.id)

          // D-18: an empty (ghost) knot has pointer-events: none, so it can
          // never hover itself. Reveal it when either endpoint is hovered.
          const endpointKeys = [sourceEdge?.from, destEdge?.to]
            .filter((id): id is string => typeof id === 'string')
            .map(keyFor)
          const isKnotHovered =
            hoveredKey === keyFor(node.id) ||
            (hoveredKey !== null && endpointKeys.includes(hoveredKey))

          return (
            <KnotNode
              key={node.id}
              nodeId={node.id}
              body={body}
              x={px}
              y={py}
              isPinned={isPinned}
              autoX={auto ? auto.left : px}
              autoY={auto ? auto.top : py}
              isEditing={editingKey === keyFor(node.id)}
              isHovered={isKnotHovered}
              zoom={zoom}
              roll={roll}
              onStartEditing={() => handlers.onStartEditing(refFor(node.id))}
              onSave={(nodeId, body2, title) => handlers.onSave(refFor(nodeId), body2, title)}
              onMarkDirty={(nodeId) => handlers.onMarkDirty(refFor(nodeId))}
              onMarkClean={(nodeId) => handlers.onMarkClean(refFor(nodeId))}
              onPinnedPositionChange={(nodeId, x, y) =>
                handlers.onPinnedPositionChange(refFor(nodeId), x, y)
              }
              onHover={(h) => handlers.onHover(refFor(node.id), h)}
              onRegisterDims={(nodeId, w, h) => handlers.onRegisterDims(refFor(nodeId), w, h)}
            />
          )
        })}

        {/* Top-level folder frames of a workspace tree (D-21); each nests its own */}
        {subspaces &&
          (subspaces.layout.hierarchy.childrenOf.get(null) ?? [])
            .filter((id) => subspaces.layout.hierarchy.folders.has(id))
            .map((folderId) => {
              const folder = nodesById.get(folderId)
              if (!folder) return null
              return (
                <FolderFrame
                  key={folderId}
                  treeId={tree.id}
                  folder={folder}
                  nodesById={nodesById}
                  layout={subspaces.layout}
                  localOf={localOf}
                  saveState={tree.saveState}
                  zoom={zoom}
                  renderCard={renderWorkspaceCard}
                  onToggleFolder={(id, collapsed) => handlers.onToggleFolder(refFor(id), collapsed)}
                  onHeaderPointerDown={(id, e) => handlers.onFolderHeaderPointerDown(refFor(id), e)}
                  draggingFolderId={subspaces.draggingFolderId}
                />
              )
            })}

        {/* Note cards — the component a plugin registered, or the fallback.
            In a workspace tree, folders and the cards inside them are drawn by
            their FolderFrame, not here. */}
        {tree.nodes
          .filter(
            (n) =>
              !isKnot(n) &&
              !isNestedInSubspace(n) &&
              (!outlines.hidden.has(n.id) || fades.has(n.id) || flyers.has(n.id)),
          )
          .sort(depthOrder)
          .map((node) => {
          const key = keyFor(node.id)
          const view = mappedNodeView(pluginNodeViews[node.type])

          // A note of this tree's nesting is drawn in its form for this zoom:
          // the card, or a circle or dot at its centre, and while a form
          // changes, the form it left fading out over the new one fading in.
          const shown = shownForms.get(node.id)
          const draws =
            shown && !flyers.has(node.id)
              ? formsToDraw(shown, fades.get(node.id))
              : [{ form: 'note' as const, fade: null }]
          const collapsedEls = draws.flatMap((d) => {
            if (d.form === 'note') return []
            const at = frameSpot(node.id)
            const size = sizeOf(node.id)
            const min = containerMins?.get(node.id)
            const w = Math.max(size.width, min?.width ?? 0)
            const h = Math.max(size.height, min?.height ?? 0)
            return [
              <CollapsedNote
                key={`collapsed-${d.form}`}
                noteId={node.id}
                form={d.form}
                title={String(node.props['title']?.value ?? '')}
                seed={seedFromId(node.id)}
                x={at.x + w / 2}
                y={at.y + h / 2}
                zoom={zoom}
                selected={selectedKeys.has(key)}
                fade={d.fade}
                onSelect={() => handlers.onBorderSelect(refFor(node.id))}
                onZoomTo={() => zoomTo(node.id)}
              />,
            ]
          })
          const noteDraw = draws.find((d) => d.form === 'note')
          if (!noteDraw) return <React.Fragment key={node.id}>{collapsedEls}</React.Fragment>

          if (view === 'WorkspaceFileCard') return renderWorkspaceCard(node)

          if (isThread(node) && pluginNodeViews[node.type]) {
            const px = Number(node.props['position.x']?.value ?? 0)
            const py = Number(node.props['position.y']?.value ?? 0)
            const dims = getDims(key)
            const cardBottom = py + (dims?.height ?? 80)

            // D-24: "Grew from [note title] · started by agent.[name]" --
            // read generically from an ordinary `grew-from` edge and the
            // creating actor, so this renders the moment a later plan
            // (agents starting threads) actually produces that data; no
            // thread today has either, so this is dormant until then.
            const grewFromEdge = tree.edges.find((e) => e.label === 'grew-from' && e.from === node.id)
            const originNode = grewFromEdge ? tree.nodes.find((n) => n.id === grewFromEdge.to) : undefined
            const createdBy = tree.history?.nodes[node.id]?.createdBy
            const isAgentStarted = createdBy?.kind === 'plugin' && createdBy.id.startsWith('agent.')
            const originTitle = originNode ? String(originNode.props['title']?.value ?? 'Untitled') : null

            const dimsWidth = dims?.width ?? 200

            return (
              <React.Fragment key={node.id}>
                <ThreadCard
                  node={node}
                  isEditing={editingKey === key}
                  isHovered={hoveredKey === key}
                  isSelected={selectedKeys.has(key)}
                  zoom={zoom}
                  onStartEditing={() => handlers.onStartEditing(refFor(node.id))}
                  onBorderSelect={() => handlers.onBorderSelect(refFor(node.id))}
                  onSave={(nodeId, body, title) => handlers.onSave(refFor(nodeId), body, title)}
                  onMarkDirty={(nodeId) => handlers.onMarkDirty(refFor(nodeId))}
                  onMarkClean={(nodeId) => handlers.onMarkClean(refFor(nodeId))}
                  onHover={(hovered) => handlers.onHover(refFor(node.id), hovered)}
                  onRegisterDims={(nodeId, w, h) => handlers.onRegisterDims(refFor(nodeId), w, h)}
                />
                {isAgentStarted && originTitle && (
                  <div
                    style={{
                      position: 'absolute',
                      left: px,
                      top: cardBottom + 2,
                      fontSize: 11,
                      color: 'var(--tap-muted)',
                    }}
                  >
                    {`Grew from ${originTitle} · started by ${createdBy!.id}`}
                  </div>
                )}

                {/* ThreadCard menu (UI-SPEC "Card menu"): "Open thread",
                    "Thread settings", "Delete thread". */}
                <button
                  type="button"
                  aria-label="Thread options"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setThreadMenuOpenFor(threadMenuOpenFor === node.id ? null : node.id)
                  }}
                  style={{
                    position: 'absolute',
                    left: px + dimsWidth - 20,
                    top: py + 4,
                    width: 16,
                    height: 16,
                    fontSize: 12,
                    lineHeight: '16px',
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--tap-muted)',
                    cursor: 'pointer',
                  }}
                >
                  ⋯
                </button>
                {threadMenuOpenFor === node.id && (
                  <div
                    role="menu"
                    className="passage-chooser"
                    style={{ position: 'absolute', left: px + dimsWidth - 20, top: py + 20, zIndex: 10 }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="passage-chooser-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        setThreadMenuOpenFor(null)
                        handlers.onStartEditing(refFor(node.id))
                      }}
                    >
                      Open thread
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="passage-chooser-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        setThreadMenuOpenFor(null)
                        setThreadSettingsFor({ nodeId: node.id, x: e.clientX, y: e.clientY })
                      }}
                    >
                      Thread settings
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="passage-chooser-item"
                      onClick={(e) => {
                        e.stopPropagation()
                        setThreadMenuOpenFor(null)
                        handlers.onDeleteNote(refFor(node.id))
                      }}
                    >
                      Delete thread
                    </button>
                  </div>
                )}
                {threadSettingsFor?.nodeId === node.id && (
                  <ThreadSettingsPopover
                    treeId={tree.id}
                    nodeId={node.id}
                    x={threadSettingsFor.x}
                    y={threadSettingsFor.y}
                    onClose={() => setThreadSettingsFor(null)}
                  />
                )}

                <SessionBridge
                  treeId={tree.id}
                  nodeId={node.id}
                  cardX={px}
                  cardBottom={cardBottom}
                  focusedSessionIndex={null}
                  onOpenSession={() => handlers.onStartEditing(refFor(node.id))}
                  onShowAllSessions={() => handlers.onStartEditing(refFor(node.id))}
                />
              </React.Fragment>
            )
          }

          if (view === 'VaultNoteCard') {
            return (
              <VaultNoteCard
                key={node.id}
                treeId={tree.id}
                node={node}
                isSelected={selectedKeys.has(key)}
                zoom={zoom}
                roll={roll}
                provenance={tree.history?.nodes[node.id]}
                onBorderSelect={() => handlers.onBorderSelect(refFor(node.id))}
                onHover={(hovered) => handlers.onHover(refFor(node.id), hovered)}
                onPositionChange={(nodeId, x, y) =>
                  handlers.onPositionChange(refFor(nodeId), x, y)
                }
                onRegisterDims={(nodeId, w, h) => handlers.onRegisterDims(refFor(nodeId), w, h)}
                onDragMove={(nodeId, x, y) => handlers.onDragMove(refFor(nodeId), x, y)}
                onDragEnd={(nodeId) => handlers.onDragEnd(refFor(nodeId))}
              />
            )
          }

          if (view === 'NoteCard') {
            return (
              <React.Fragment key={node.id}>
              {collapsedEls}
              <NoteCard
                key="note"
                formFade={noteDraw.fade}
                flightScale={flyers.get(node.id)?.scale}
                treeId={tree.id}
                node={node}
                displayPosition={
                  containerOf(node.id) !== null
                    ? frameSpot(node.id)
                    : (followerPositions?.[key] ??
                      displayPositions.get(node.id)?.followSpot ??
                      undefined)
                }
                minSize={containerMins?.get(node.id)}
                onCreateInside={nesting ? () => createInside(node.id) : undefined}
                onZoomTo={nesting ? () => zoomTo(node.id) : undefined}
                isEditing={editingKey === key}
                isHovered={hoveredKey === key}
                isSelected={selectedKeys.has(key)}
                isConnectTarget={connectingHoverKey === key || dropTargetId === node.id}
                isConnecting={isConnecting}
                zoom={zoom}
                roll={roll}
                provenance={tree.history?.nodes[node.id]}
                currentUserActorId={currentUserActorId}
                onStartEditing={() => handlers.onStartEditing(refFor(node.id))}
                onBorderSelect={() => handlers.onBorderSelect(refFor(node.id))}
                onSave={(nodeId, body, title) => handlers.onSave(refFor(nodeId), body, title)}
                onMarkDirty={(nodeId) => handlers.onMarkDirty(refFor(nodeId))}
                onMarkClean={(nodeId) => handlers.onMarkClean(refFor(nodeId))}
                onPositionChange={placeNote}
                onWidthChange={(nodeId, width) => handlers.onWidthChange(refFor(nodeId), width)}
                onHeightChange={(nodeId, height) =>
                  handlers.onHeightChange(refFor(nodeId), height)
                }
                onDeleteNote={() => handlers.onDeleteNote(refFor(node.id))}
                onHover={(hovered) => handlers.onHover(refFor(node.id), hovered)}
                onHoverDuringConnection={() =>
                  handlers.onHoverDuringConnection(refFor(node.id))
                }
                onLeaveDuringConnection={() => handlers.onHoverDuringConnection(null)}
                onStartConnection={() => handlers.onStartConnection(refFor(node.id))}
                onRegisterDims={(nodeId, w, h) => handlers.onRegisterDims(refFor(nodeId), w, h)}
                onDragMove={dragNote}
                onDragEnd={(nodeId) => handlers.onDragEnd(refFor(nodeId))}
              />
              </React.Fragment>
            )
          }

          // D-33/D-35: FallbackNodeView for missing/disabled plugin nodes
          return (
            <FallbackNodeView
              key={node.id}
              node={node}
              treeId={tree.id}
              isSelected={selectedKeys.has(key)}
              isHovered={hoveredKey === key}
              zoom={zoom}
              roll={roll}
              onBorderSelect={() => handlers.onBorderSelect(refFor(node.id))}
              onHover={(hovered) => handlers.onHover(refFor(node.id), hovered)}
              onPositionChange={writePosition}
              onRegisterDims={(nodeId, w, h) => handlers.onRegisterDims(refFor(nodeId), w, h)}
              onPropertyEdit={(nodeId, k, t, v) =>
                handlers.onPropertyEdit(refFor(nodeId), k, t, v)
              }
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * Props equal enough to skip a render.
 *
 * Canvas re-renders on every pointer move of a drag, and a space can hold
 * trees of thousands of notes; redrawing all of them per move froze the app.
 * Canvas keeps each prop referentially stable while it is unchanged for this
 * tree (per-tree slices, cached spots, a stable handlers object), so identity
 * is the test for everything but the rect, which is rebuilt every render.
 */
function sameFrameProps(a: TreeFrameProps, b: TreeFrameProps): boolean {
  for (const key of Object.keys(b) as Array<keyof TreeFrameProps>) {
    if (key === 'rect') continue
    if (!Object.is(a[key], b[key])) return false
  }
  if (Object.keys(a).length !== Object.keys(b).length) return false
  return (
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  )
}

export default React.memo(TreeFrame, sameFrameProps)
