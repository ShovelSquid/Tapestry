/**
 * Canvas -- the space the trees live in: one infinite 2D plane with
 * CSS-transform pan/zoom (D-05), holding one frame per open tree (D-15).
 *
 * Pan: drag empty space, or a frame's background.
 * Zoom: scroll wheel, scaling around the pointer position.
 *
 * Canvas owns what is global to the space -- the view transform, which note is
 * hovered, selected or being connected -- and TreeFrame owns what belongs to
 * one tree. Every piece of per-note state is keyed by `nodeKey` rather than by
 * node id, because ids are only unique inside a tree: two worlds both have an
 * `n1`, and a bare id would make one note's hover highlight another's.
 *
 * Coordinate helpers:
 *   screenToWorld(sx, sy) -- convert screen px to world-space
 *   worldToScreen(wx, wy) -- convert world-space to screen px
 * Frame-local coordinates are world coordinates minus the frame's origin.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import ConnectionLine from './ConnectionLine'
import TreeFrame, { type TreeFrameHandlers } from './TreeFrame'
import type { ForestTree, NodeRef } from '../state/use-forest'
import { nodeKey } from '../state/use-forest'
import {
  FRAME_GAP,
  computeFrameBounds,
  placeNewFrame,
  pushApart,
  type ContentBox,
  type FrameRect,
  type PositionedRect,
} from '../layout/frames'
import { displayPositions, type DisplaySpot } from '../layout/placement'
import { clampZoom, isZoomPinchDelta, normalizeWheelDelta, panDelta, zoomFactor } from '../layout/wheel'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeInfo {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

export interface EdgeInfo {
  id: string
  from: string
  to: string
  label: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

interface ViewTransform {
  panX: number
  panY: number
  zoom: number
}

/**
 * What the space can be asked to do from outside it.
 *
 * Canvas owns the view transform, so panning is its to perform: App knows
 * which tree it just added, not where that tree's frame ended up.
 */
export interface CanvasHandle {
  /** Center a tree's frame in the viewport at the current zoom. */
  panToFrame(treeId: string): void
}

/** Where a double-click landed: inside a frame, or nowhere in particular. */
export interface DoubleClickTarget {
  /** Null when no tree is open at all. */
  treeId: string | null
  /** Frame-local coordinates when treeId is set. */
  x: number
  y: number
}

interface CanvasProps {
  trees: ForestTree[]
  editingRef: NodeRef | null
  /** Map of node types to component names from loaded plugins. */
  pluginNodeViews: Record<string, string>
  /** The actor id this person's own changes are signed with (D-07). */
  currentUserActorId: string | null
  onStartEditing: (ref: NodeRef) => void
  onStopEditing: () => void
  onCanvasDoubleClick: (target: DoubleClickTarget) => void
  /** The selected note changed, so undo/redo knows which tree to act on. */
  onSelectedNoteChange: (ref: NodeRef | null) => void
  onSave: (ref: NodeRef, body: string, title: string) => Promise<void>
  onMarkDirty: (ref: NodeRef) => void
  onMarkClean: (ref: NodeRef) => void
  onPositionChange: (ref: NodeRef, x: number, y: number) => void
  /**
   * Called when a person drops, or left/top-resizes, a note that follows its
   * parent (D-03, D-16). Must persist position.x, position.y AND pinned=true
   * in a single commit, so the note stops following.
   */
  onTakeOverPosition: (ref: NodeRef, x: number, y: number) => void
  onWidthChange: (ref: NodeRef, width: number) => void
  onHeightChange: (ref: NodeRef, height: number) => void
  /**
   * Called once when a thread center drag ends (D-17). Must persist
   * position.x, position.y AND pinned=true in a single commit.
   */
  onPinnedPositionChange: (ref: NodeRef, x: number, y: number) => void
  onEdgeCreate: (from: NodeRef, to: NodeRef) => void
  /** Called when a note is deleted via the delete bubble or keyboard. */
  onDeleteNote: (ref: NodeRef) => void
  /** Called when a fallback node property is edited inline (D-35). */
  onPropertyEdit: (
    ref: NodeRef,
    key: string,
    type: string,
    value: string | number | boolean,
  ) => void
  /** Move a frame in renderer state only; the canvas persists the final spot. */
  onFrameMove: (treeId: string, x: number, y: number) => void
  /** The selected frame, which is the space's focal point and undo target. */
  selectedTreeId: string | null
  onSelectTree: (treeId: string | null) => void
}

// ---------------------------------------------------------------------------
// Coordinate helpers (exported for reuse)
// ---------------------------------------------------------------------------

export function screenToWorld(
  screenX: number,
  screenY: number,
  panX: number,
  panY: number,
  zoom: number,
  viewportRect: DOMRect,
): { x: number; y: number } {
  return {
    x: (screenX - viewportRect.left - panX) / zoom,
    y: (screenY - viewportRect.top - panY) / zoom,
  }
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  panX: number,
  panY: number,
  zoom: number,
  viewportRect: DOMRect,
): { x: number; y: number } {
  return {
    x: worldX * zoom + panX + viewportRect.left,
    y: worldY * zoom + panY + viewportRect.top,
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.1
const MAX_ZOOM = 5

const DEFAULT_NODE_WIDTH = 240
const DEFAULT_NODE_HEIGHT = 80

/** The drawn-spot map for a tree that has none yet (D-05). */
const NO_DISPLAY_SPOTS: ReadonlyMap<string, DisplaySpot> = new Map()

/**
 * The empty space (UI-SPEC "Empty state body").
 *
 * One string rather than wrapped JSX text, so the approved copy stays one
 * greppable line: it names the way in to a vault, which is the whole point of
 * saying anything here at all.
 */
const EMPTY_BODY =
  'Create notes, connect ideas, and build your world of thought. ' +
  'To bring in an Obsidian vault, choose Add tree, then Add Obsidian Vault.'

/** Backgrounds a pan, a deselect or a create may start from. */
const BACKGROUND_CLASSES = [
  'tapestry-canvas-container',
  'tapestry-tree-frame',
  'tapestry-tree-frame-content',
]

function isBackground(target: HTMLElement, viewport: HTMLElement | null): boolean {
  if (target === viewport) return true
  return BACKGROUND_CLASSES.some((cls) => target.classList.contains(cls))
}

function containsPoint(rect: FrameRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

function Canvas({
  trees,
  editingRef,
  pluginNodeViews,
  currentUserActorId,
  onStartEditing,
  onStopEditing,
  onCanvasDoubleClick,
  onSelectedNoteChange,
  onSave,
  onMarkDirty,
  onMarkClean,
  onPositionChange,
  onTakeOverPosition,
  onWidthChange,
  onHeightChange,
  onPinnedPositionChange,
  onEdgeCreate,
  onDeleteNote,
  onPropertyEdit,
  onFrameMove,
  selectedTreeId,
  onSelectTree,
}: CanvasProps, ref: React.ForwardedRef<CanvasHandle>): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ViewTransform>({ panX: 0, panY: 0, zoom: 1 })

  // Panning state
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Connection-creation state. Refs, not ids: a connection names two notes,
  // and the tree is half of each name.
  const [connectingFrom, setConnectingFrom] = useState<NodeRef | null>(null)
  const [connectingLine, setConnectingLine] = useState<{ x: number; y: number } | null>(null)
  const [connectingHover, setConnectingHover] = useState<NodeRef | null>(null)

  // Hovered / selected note, keyed across every tree in the space.
  const [hoveredRef, setHoveredRef] = useState<NodeRef | null>(null)
  const [selectedRef, setSelectedRef] = useState<NodeRef | null>(null)

  // Live drag positions (frame-local), keyed by nodeKey.
  const [dragPositions, setDragPositions] = useState<
    Record<string, { x: number; y: number }>
  >({})

  // Frame-level state (D-15). A frame is dragged by its header, selected by a
  // click on it, and never deleted by the Delete key.
  const [draggingTreeId, setDraggingTreeId] = useState<string | null>(null)
  const [hoveredTreeId, setHoveredTreeId] = useState<string | null>(null)
  const frameDragRef = useRef({ startX: 0, startY: 0, originX: 0, originY: 0, moved: false })

  // Trees the renderer has already placed with real bounds, so a frame is
  // repositioned once when it appears and not on every later render.
  const placedRef = useRef(new Set<string>())

  // Node dimensions cache for connection-line centers, keyed by nodeKey.
  const nodeDimsRef = useRef<Map<string, { width: number; height: number }>>(new Map())

  const getDims = useCallback(
    (key: string) => nodeDimsRef.current.get(key),
    [],
  )

  const registerNodeDims = useCallback((ref: NodeRef, width: number, height: number) => {
    nodeDimsRef.current.set(nodeKey(ref), { width, height })
  }, [])

  const handleDragMove = useCallback((ref: NodeRef, x: number, y: number) => {
    setDragPositions((prev) => ({ ...prev, [nodeKey(ref)]: { x, y } }))
  }, [])

  const handleDragEnd = useCallback((ref: NodeRef) => {
    setDragPositions((prev) => {
      const next = { ...prev }
      delete next[nodeKey(ref)]
      return next
    })
  }, [])

  const selectNote = useCallback(
    (ref: NodeRef | null) => {
      setSelectedRef(ref)
      onSelectedNoteChange(ref)
    },
    [onSelectedNoteChange],
  )

  // -----------------------------------------------------------------------
  // Frame rects, recomputed from live content bounds every render
  // -----------------------------------------------------------------------

  const frameRects = new Map<string, FrameRect>()
  // D-05: where every note is drawn, computed once per tree so frame bounds,
  // edges, knot midpoints and cards all agree on a following note's spot.
  const treeSpots = new Map<string, ReadonlyMap<string, DisplaySpot>>()
  for (const tree of trees) {
    const overrides = new Map<string, { x: number; y: number }>()
    for (const node of tree.nodes) {
      const drag = dragPositions[nodeKey({ treeId: tree.id, nodeId: node.id })]
      if (drag) overrides.set(node.id, drag)
    }
    const spots = displayPositions(tree.nodes, tree.edges, overrides)
    treeSpots.set(tree.id, spots)
    const boxes: ContentBox[] = tree.nodes.map((node) => {
      const key = nodeKey({ treeId: tree.id, nodeId: node.id })
      const drag = dragPositions[key]
      const spot = spots.get(node.id)
      const dims = nodeDimsRef.current.get(key)
      return {
        x: spot ? spot.x : drag ? drag.x : Number(node.props['position.x']?.value ?? 0),
        y: spot ? spot.y : drag ? drag.y : Number(node.props['position.y']?.value ?? 0),
        width: dims?.width ?? DEFAULT_NODE_WIDTH,
        height: dims?.height ?? DEFAULT_NODE_HEIGHT,
      }
    })
    frameRects.set(tree.id, computeFrameBounds(tree.frame, boxes))
  }

  /**
   * The rects this render computed, readable by an imperative caller later.
   *
   * panToFrame is called after a frame has been added and possibly nudged
   * clear of its neighbours, so it must read the rects as they are at that
   * moment rather than the ones its own closure was created with.
   */
  const frameRectsRef = useRef(frameRects)
  frameRectsRef.current = frameRects

  /**
   * Center a frame in the viewport, keeping the current zoom.
   *
   * worldToScreen is `world * zoom + pan`, so centering the frame's midpoint
   * means solving `mid * zoom + pan = viewport / 2` for pan.
   */
  const panToFrame = useCallback((treeId: string) => {
    const viewport = viewportRef.current
    const rect = frameRectsRef.current.get(treeId)
    if (!viewport || !rect) return

    const { clientWidth, clientHeight } = viewport
    setView((prev) => ({
      ...prev,
      panX: clientWidth / 2 - (rect.x + rect.width / 2) * prev.zoom,
      panY: clientHeight / 2 - (rect.y + rect.height / 2) * prev.zoom,
    }))
  }, [])

  useImperativeHandle(ref, () => ({ panToFrame }), [panToFrame])

  /** The tree whose frame contains a world point, if any. */
  const treeAt = useCallback(
    (worldX: number, worldY: number): ForestTree | null => {
      // Reverse order: the most recently opened frame is on top.
      for (let i = trees.length - 1; i >= 0; i -= 1) {
        const rect = frameRects.get(trees[i].id)
        if (rect && containsPoint(rect, worldX, worldY)) return trees[i]
      }
      return null
    },
    // frameRects is rebuilt each render alongside trees/dragPositions.
    [trees, dragPositions],
  )

  const pointerWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      if (!viewportRef.current) return null
      const rect = viewportRef.current.getBoundingClientRect()
      return screenToWorld(clientX, clientY, view.panX, view.panY, view.zoom, rect)
    },
    [view.panX, view.panY, view.zoom],
  )

  /** Every frame's world rect, in the shape push-apart works on. */
  const positionedRects = (): PositionedRect[] => {
    const rects: PositionedRect[] = []
    for (const tree of trees) {
      const rect = frameRects.get(tree.id)
      if (rect) rects.push({ id: tree.id, ...rect })
    }
    return rects
  }

  /**
   * Settle the space around the frame that just moved (D-15).
   *
   * pushApart works in rect space, but what persists is a frame's origin, so
   * each displaced frame's origin moves by the same delta its rect did. Every
   * frame that yields is written, so the arrangement on screen is the one that
   * reopens next launch.
   */
  const settleFrames = (movedTreeId: string) => {
    const rects = positionedRects()
    const displaced = pushApart(rects, movedTreeId)

    for (const [id, next] of displaced) {
      const before = rects.find((rect) => rect.id === id)
      const tree = trees.find((t) => t.id === id)
      if (!before || !tree) continue

      const x = tree.frame.x + (next.x - before.x)
      const y = tree.frame.y + (next.y - before.y)
      onFrameMove(id, x, y)
      void window.tapestry.trees.setFrame(id, x, y)
    }
  }

  /**
   * A tree the renderer has not placed yet gets a real spot.
   *
   * Main puts a new tree at a provisional frame computed from stored positions
   * alone, which cannot know how large the existing frames actually are. Once
   * the renderer has measured them, a frame that landed within the gap of
   * another is moved clear and the corrected position is persisted.
   */
  useEffect(() => {
    if (trees.length === 0) return
    const rects = positionedRects()

    for (const tree of trees) {
      if (placedRef.current.has(tree.id)) continue
      placedRef.current.add(tree.id)

      const mine = rects.find((rect) => rect.id === tree.id)
      const others = rects.filter((rect) => rect.id !== tree.id)
      if (!mine || others.length === 0) continue

      const clashes = others.some(
        (other) =>
          mine.x - FRAME_GAP < other.x + other.width &&
          other.x < mine.x + mine.width + FRAME_GAP &&
          mine.y - FRAME_GAP < other.y + other.height &&
          other.y < mine.y + mine.height + FRAME_GAP,
      )
      if (!clashes) continue

      const spot = placeNewFrame(others)
      const x = tree.frame.x + (spot.x - mine.x)
      const y = tree.frame.y + (spot.y - mine.y)
      onFrameMove(tree.id, x, y)
      void window.tapestry.trees.setFrame(tree.id, x, y)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trees, onFrameMove])

  /** Pointer down on a frame's header band: the start of a frame drag. */
  const handleFrameHeaderPointerDown = (
    treeId: string,
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (e.button !== 0) return
    const tree = trees.find((t) => t.id === treeId)
    if (!tree) return

    // The header is not canvas background: dragging it must not also pan.
    e.stopPropagation()
    e.preventDefault()
    frameDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: tree.frame.x,
      originY: tree.frame.y,
      moved: false,
    }
    setDraggingTreeId(treeId)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  // -----------------------------------------------------------------------
  // Pan handlers
  // -----------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      if (!isBackground(e.target as HTMLElement, viewportRef.current)) return

      isPanningRef.current = true
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: view.panX,
        panY: view.panY,
      }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      e.preventDefault()
    },
    [view.panX, view.panY],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // A frame drag moves the whole tree with its notes and connections, so
      // it is applied to the frame origin rather than to any note.
      if (draggingTreeId) {
        const dx = (e.clientX - frameDragRef.current.startX) / view.zoom
        const dy = (e.clientY - frameDragRef.current.startY) / view.zoom
        // A few pixels of travel separates a drag from a click that selects.
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) frameDragRef.current.moved = true
        onFrameMove(
          draggingTreeId,
          frameDragRef.current.originX + dx,
          frameDragRef.current.originY + dy,
        )
        return
      }

      if (connectingFrom) {
        const world = pointerWorld(e.clientX, e.clientY)
        if (world) setConnectingLine(world)
      }

      if (!isPanningRef.current) return
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      setView((prev) => ({
        ...prev,
        panX: panStartRef.current.panX + dx,
        panY: panStartRef.current.panY + dy,
      }))
    },
    [connectingFrom, pointerWorld, draggingTreeId, onFrameMove, view.zoom],
  )

  // Not memoised: the drop needs this render's frame rects, and a stale
  // closure would settle the space against where the frames used to be.
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    {
      if (isPanningRef.current) {
        isPanningRef.current = false
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      }

      if (draggingTreeId) {
        const tree = trees.find((t) => t.id === draggingTreeId)
        if (tree) {
          if (frameDragRef.current.moved) {
            void window.tapestry.trees.setFrame(tree.id, tree.frame.x, tree.frame.y)
            settleFrames(draggingTreeId)
          } else {
            // Pressing the header without moving it selects the frame.
            onSelectTree(draggingTreeId)
          }
        }
        setDraggingTreeId(null)
        return
      }

      if (connectingFrom) {
        // A connection joins two notes in one tree. Ending on another tree's
        // note does nothing here; cross-tree links are D-16 (Plan 15), and
        // writing one end of them now would record half a relationship.
        if (connectingHover && connectingHover.treeId === connectingFrom.treeId) {
          onEdgeCreate(connectingFrom, connectingHover)
        }
        setConnectingFrom(null)
        setConnectingLine(null)
        setConnectingHover(null)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Zoom handler (wheel)
  // -----------------------------------------------------------------------

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      if (e.ctrlKey) {
        // Pinch-to-zoom on trackpad (browser sets ctrlKey for pinch gestures)
        const rect = viewport.getBoundingClientRect()
        const pointerX = e.clientX - rect.left
        const pointerY = e.clientY - rect.top
        const normalizedDeltaY = normalizeWheelDelta(e.deltaY, e.deltaMode)

        setView((prev) => {
          const newZoom = clampZoom(
            prev.zoom * zoomFactor(normalizedDeltaY, isZoomPinchDelta(normalizedDeltaY)),
            MIN_ZOOM,
            MAX_ZOOM
          )
          const ratio = newZoom / prev.zoom
          return {
            panX: pointerX - ratio * (pointerX - prev.panX),
            panY: pointerY - ratio * (pointerY - prev.panY),
            zoom: newZoom,
          }
        })
      } else {
        setView((prev) => ({
          ...prev,
          panX: prev.panX - panDelta(e.deltaX, e.deltaMode),
          panY: prev.panY - panDelta(e.deltaY, e.deltaMode),
        }))
      }
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [])

  // -----------------------------------------------------------------------
  // Click handlers
  // -----------------------------------------------------------------------

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isBackground(e.target as HTMLElement, viewportRef.current)) return
      onStopEditing()
      selectNote(null)
      onSelectTree(null)
    },
    [onStopEditing, selectNote, onSelectTree],
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isBackground(e.target as HTMLElement, viewportRef.current)) return

      const world = pointerWorld(e.clientX, e.clientY)
      if (!world) return

      // With no tree open, the carried flow still applies: the app asks where
      // to save, creates a world, and puts the first note at its origin.
      if (trees.length === 0) {
        onCanvasDoubleClick({ treeId: null, x: 0, y: 0 })
        return
      }

      // A note must belong to a tree, so a double-click outside every frame
      // creates nothing (UA-06) rather than making an orphan.
      const tree = treeAt(world.x, world.y)
      if (!tree) return

      onCanvasDoubleClick({
        treeId: tree.id,
        x: world.x - tree.frame.x,
        y: world.y - tree.frame.y,
      })
    },
    [trees, treeAt, pointerWorld, onCanvasDoubleClick],
  )

  // -----------------------------------------------------------------------
  // Connection creation
  // -----------------------------------------------------------------------

  const handleStartConnection = useCallback((ref: NodeRef) => {
    setConnectingFrom(ref)
  }, [])

  const handleNoteHoverDuringConnection = useCallback(
    (ref: NodeRef | null) => {
      if (!connectingFrom) return
      const same = ref && nodeKey(ref) === nodeKey(connectingFrom)
      setConnectingHover(ref && !same ? ref : null)
    },
    [connectingFrom],
  )

  // -----------------------------------------------------------------------
  // Border select (D-08)
  // -----------------------------------------------------------------------

  const handleBorderSelect = useCallback(
    (ref: NodeRef) => {
      const same = selectedRef && nodeKey(selectedRef) === nodeKey(ref)
      selectNote(same ? null : ref)
      onStopEditing()
    },
    [selectedRef, selectNote, onStopEditing],
  )

  const handleHover = useCallback((ref: NodeRef, hovered: boolean) => {
    setHoveredRef((prev) => {
      if (hovered) return ref
      return prev && nodeKey(prev) === nodeKey(ref) ? null : prev
    })
  }, [])

  // -----------------------------------------------------------------------
  // Keyboard Delete/Backspace: delete the selected note (D-21).
  // The Delete key does nothing to frames (UI-SPEC).
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedRef) return
      if (editingRef) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        onDeleteNote(selectedRef)
        selectNote(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedRef, editingRef, onDeleteNote, selectNote])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const containerStyle: React.CSSProperties = {
    transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
    transformOrigin: '0 0',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  }

  const handlers: TreeFrameHandlers = {
    onStartEditing,
    onSave,
    onMarkDirty,
    onMarkClean,
    // A note landing or resizing can grow its frame into a neighbour, so the
    // space re-settles on the same rule a frame drag uses.
    onPositionChange: (ref, x, y) => {
      onPositionChange(ref, x, y)
      settleFrames(ref.treeId)
    },
    onTakeOverPosition: (ref, x, y) => {
      onTakeOverPosition(ref, x, y)
      settleFrames(ref.treeId)
    },
    onWidthChange: (ref, width) => {
      onWidthChange(ref, width)
      settleFrames(ref.treeId)
    },
    onHeightChange: (ref, height) => {
      onHeightChange(ref, height)
      settleFrames(ref.treeId)
    },
    onPinnedPositionChange,
    onDeleteNote,
    onPropertyEdit,
    onBorderSelect: handleBorderSelect,
    onHover: handleHover,
    onHoverDuringConnection: handleNoteHoverDuringConnection,
    onStartConnection: handleStartConnection,
    onRegisterDims: registerNodeDims,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
  }

  // The in-progress connection line is drawn in world space, above the frames,
  // so it stays visible while the pointer is between two of them.
  let tempConnectionLine: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (connectingFrom && connectingLine) {
    const tree = trees.find((t) => t.id === connectingFrom.treeId)
    const node = tree?.nodes.find((n) => n.id === connectingFrom.nodeId)
    if (tree && node) {
      const key = nodeKey(connectingFrom)
      const drag = dragPositions[key]
      const spot = treeSpots.get(tree.id)?.get(node.id)
      const dims = nodeDimsRef.current.get(key)
      const localX = spot ? spot.x : drag ? drag.x : Number(node.props['position.x']?.value ?? 0)
      const localY = spot ? spot.y : drag ? drag.y : Number(node.props['position.y']?.value ?? 0)
      tempConnectionLine = {
        x1: tree.frame.x + localX + (dims?.width ?? DEFAULT_NODE_WIDTH) / 2,
        y1: tree.frame.y + localY + (dims?.height ?? DEFAULT_NODE_HEIGHT) / 2,
        x2: connectingLine.x,
        y2: connectingLine.y,
      }
    }
  }

  return (
    <div
      ref={viewportRef}
      className="tapestry-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Empty state (UI-SPEC copywriting) */}
      {trees.length === 0 && (
        <div className="tapestry-empty-state">
          <h2 className="tapestry-empty-heading">Double-click anywhere to start</h2>
          <p className="tapestry-empty-body">{EMPTY_BODY}</p>
        </div>
      )}

      {/* Transformed container: every frame pans and zooms together */}
      <div className="tapestry-canvas-container" style={containerStyle}>
        {trees.map((tree) => {
          const rect = frameRects.get(tree.id)
          if (!rect) return null
          return (
            <TreeFrame
              key={tree.id}
              tree={tree}
              rect={rect}
              zoom={view.zoom}
              editingKey={editingRef ? nodeKey(editingRef) : null}
              hoveredKey={hoveredRef ? nodeKey(hoveredRef) : null}
              selectedKey={selectedRef ? nodeKey(selectedRef) : null}
              connectingHoverKey={connectingHover ? nodeKey(connectingHover) : null}
              isConnecting={connectingFrom !== null}
              pluginNodeViews={pluginNodeViews}
              currentUserActorId={currentUserActorId}
              dragPositions={dragPositions}
              displayPositions={treeSpots.get(tree.id) ?? NO_DISPLAY_SPOTS}
              getDims={getDims}
              isSelected={selectedTreeId === tree.id}
              isHovered={hoveredTreeId === tree.id}
              isDragging={draggingTreeId === tree.id}
              onHeaderPointerDown={(e) => handleFrameHeaderPointerDown(tree.id, e)}
              onFrameHover={(hovered) => setHoveredTreeId(hovered ? tree.id : null)}
              handlers={handlers}
            />
          )
        })}

        {/* Temporary connection line during drag-connect */}
        {tempConnectionLine && (
          <svg
            className="tapestry-connections-svg"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            <ConnectionLine
              x1={tempConnectionLine.x1}
              y1={tempConnectionLine.y1}
              x2={tempConnectionLine.x2}
              y2={tempConnectionLine.y2}
              isTemporary
            />
          </svg>
        )}
      </div>
    </div>
  )
}

export default forwardRef(Canvas)
