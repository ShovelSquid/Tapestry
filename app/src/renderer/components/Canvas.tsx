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

import React, { useCallback, useEffect, useRef, useState } from 'react'
import ConnectionLine from './ConnectionLine'
import TreeFrame, { type TreeFrameHandlers } from './TreeFrame'
import type { ForestTree, NodeRef } from '../state/use-forest'
import { nodeKey } from '../state/use-forest'
import { computeFrameBounds, type ContentBox, type FrameRect } from '../layout/frames'

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
const ZOOM_SPEED = 0.001

const DEFAULT_NODE_WIDTH = 240
const DEFAULT_NODE_HEIGHT = 80

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

export default function Canvas({
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
  onWidthChange,
  onHeightChange,
  onPinnedPositionChange,
  onEdgeCreate,
  onDeleteNote,
  onPropertyEdit,
}: CanvasProps): React.ReactElement {
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
  for (const tree of trees) {
    const boxes: ContentBox[] = tree.nodes.map((node) => {
      const key = nodeKey({ treeId: tree.id, nodeId: node.id })
      const drag = dragPositions[key]
      const dims = nodeDimsRef.current.get(key)
      return {
        x: drag ? drag.x : Number(node.props['position.x']?.value ?? 0),
        y: drag ? drag.y : Number(node.props['position.y']?.value ?? 0),
        width: dims?.width ?? DEFAULT_NODE_WIDTH,
        height: dims?.height ?? DEFAULT_NODE_HEIGHT,
      }
    })
    frameRects.set(tree.id, computeFrameBounds(tree.frame, boxes))
  }

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
    [connectingFrom, pointerWorld],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isPanningRef.current) {
        isPanningRef.current = false
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
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
    },
    [connectingFrom, connectingHover, onEdgeCreate],
  )

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

        setView((prev) => {
          const delta = -e.deltaY * ZOOM_SPEED
          const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.zoom * (1 + delta)))
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
          panX: prev.panX - e.deltaX,
          panY: prev.panY - e.deltaY,
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
    },
    [onStopEditing, selectNote],
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
    onPositionChange,
    onWidthChange,
    onHeightChange,
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
      const dims = nodeDimsRef.current.get(key)
      const localX = drag ? drag.x : Number(node.props['position.x']?.value ?? 0)
      const localY = drag ? drag.y : Number(node.props['position.y']?.value ?? 0)
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
          <p className="tapestry-empty-body">
            Create notes, connect ideas, and build your world of thought.
          </p>
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
              getDims={getDims}
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
