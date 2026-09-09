/**
 * Canvas -- infinite 2D canvas with CSS-transform pan/zoom (D-05).
 *
 * Pan: drag empty canvas space.
 * Zoom: scroll wheel, scaling around the pointer position.
 *
 * Notes are positioned at world-space coordinates inside the transformed
 * container. Connection lines pan/zoom with the canvas because the SVG
 * overlay lives inside the same transformed container.
 *
 * Coordinate helpers:
 *   screenToWorld(sx, sy) -- convert screen px to world-space
 *   worldToScreen(wx, wy) -- convert world-space to screen px
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import NoteCard from './NoteCard'
import ConnectionLine from './ConnectionLine'

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

interface CanvasProps {
  nodes: NodeInfo[]
  edges: EdgeInfo[]
  editingNodeId: string | null
  isFileLoaded: boolean
  onStartEditing: (nodeId: string) => void
  onStopEditing: () => void
  onCanvasDoubleClick: (worldX: number, worldY: number) => void
  onSave: (nodeId: string, body: string, title: string) => Promise<void>
  onMarkDirty: (nodeId: string) => void
  onMarkClean: (nodeId: string) => void
  onPositionChange: (
    nodeId: string,
    x: number,
    y: number,
  ) => void
  onEdgeCreate: (fromId: string, toId: string) => void
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

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export default function Canvas({
  nodes,
  edges,
  editingNodeId,
  isFileLoaded,
  onStartEditing,
  onStopEditing,
  onCanvasDoubleClick,
  onSave,
  onMarkDirty,
  onMarkClean,
  onPositionChange,
  onEdgeCreate,
}: CanvasProps): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ViewTransform>({
    panX: 0,
    panY: 0,
    zoom: 1,
  })

  // Panning state
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Connection-creation state
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [connectingLine, setConnectingLine] = useState<{
    x: number
    y: number
  } | null>(null)
  const [connectingHover, setConnectingHover] = useState<string | null>(null)

  // Hovered / selected note (hover vs focus distinction, D-07)
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)

  // Node dimensions cache for connection line center computation
  const nodeDimsRef = useRef<
    Map<string, { width: number; height: number }>
  >(new Map())

  const registerNodeDims = useCallback(
    (id: string, width: number, height: number) => {
      nodeDimsRef.current.set(id, { width, height })
    },
    [],
  )

  // -----------------------------------------------------------------------
  // Helper: get node center in world space
  // -----------------------------------------------------------------------

  const getNodeCenter = useCallback(
    (nodeId: string): { x: number; y: number } | null => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return null
      const px = Number(node.props['position.x']?.value ?? 0)
      const py = Number(node.props['position.y']?.value ?? 0)
      const dims = nodeDimsRef.current.get(nodeId)
      const w = dims?.width ?? 240
      const h = dims?.height ?? 80
      return { x: px + w / 2, y: py + h / 2 }
    },
    [nodes],
  )

  // -----------------------------------------------------------------------
  // Pan handlers
  // -----------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only pan on primary button and when clicking on the viewport/container
      // background, not on a note card.
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (
        target !== viewportRef.current &&
        !target.classList.contains('tapestry-canvas-container')
      ) {
        return
      }

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
      // Handle connection-creation line following cursor
      if (connectingFrom && viewportRef.current) {
        const rect = viewportRef.current.getBoundingClientRect()
        const world = screenToWorld(
          e.clientX,
          e.clientY,
          view.panX,
          view.panY,
          view.zoom,
          rect,
        )
        setConnectingLine(world)
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
    [connectingFrom, view.panX, view.panY, view.zoom],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isPanningRef.current) {
        isPanningRef.current = false
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      }

      // End connecting mode if pointer released on empty space
      if (connectingFrom) {
        if (connectingHover) {
          // Create edge from connectingFrom to connectingHover
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
      const rect = viewport.getBoundingClientRect()

      // Pointer position relative to viewport
      const pointerX = e.clientX - rect.left
      const pointerY = e.clientY - rect.top

      setView((prev) => {
        const delta = -e.deltaY * ZOOM_SPEED
        const newZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, prev.zoom * (1 + delta)),
        )
        const ratio = newZoom / prev.zoom

        // Adjust pan so the point under the pointer stays fixed
        const newPanX = pointerX - ratio * (pointerX - prev.panX)
        const newPanY = pointerY - ratio * (pointerY - prev.panY)

        return { panX: newPanX, panY: newPanY, zoom: newZoom }
      })
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [])

  // -----------------------------------------------------------------------
  // Click handlers
  // -----------------------------------------------------------------------

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      if (
        target === viewportRef.current ||
        target.classList.contains('tapestry-canvas-container')
      ) {
        onStopEditing()
        setSelectedNoteId(null)
      }
    },
    [onStopEditing],
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      if (
        target !== viewportRef.current &&
        !target.classList.contains('tapestry-canvas-container')
      ) {
        return
      }

      if (!viewportRef.current) return
      const rect = viewportRef.current.getBoundingClientRect()
      const world = screenToWorld(
        e.clientX,
        e.clientY,
        view.panX,
        view.panY,
        view.zoom,
        rect,
      )
      onCanvasDoubleClick(world.x, world.y)
    },
    [view.panX, view.panY, view.zoom, onCanvasDoubleClick],
  )

  // -----------------------------------------------------------------------
  // Connection creation: start from a note's connection handle
  // -----------------------------------------------------------------------

  const handleStartConnection = useCallback((nodeId: string) => {
    setConnectingFrom(nodeId)
  }, [])

  const handleNoteHoverDuringConnection = useCallback(
    (nodeId: string | null) => {
      if (connectingFrom) {
        setConnectingHover(
          nodeId && nodeId !== connectingFrom ? nodeId : null,
        )
      }
    },
    [connectingFrom],
  )

  // -----------------------------------------------------------------------
  // Border select (D-08)
  // -----------------------------------------------------------------------

  const handleBorderSelect = useCallback(
    (nodeId: string) => {
      setSelectedNoteId((prev) => (prev === nodeId ? null : nodeId))
    },
    [],
  )

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

  // Build connecting-mode temporary line data
  let tempConnectionLine: {
    x1: number
    y1: number
    x2: number
    y2: number
  } | null = null
  if (connectingFrom && connectingLine) {
    const fromCenter = getNodeCenter(connectingFrom)
    if (fromCenter) {
      tempConnectionLine = {
        x1: fromCenter.x,
        y1: fromCenter.y,
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
      {!isFileLoaded && nodes.length === 0 && (
        <div className="tapestry-empty-state">
          <h2 className="tapestry-empty-heading">
            Double-click anywhere to start
          </h2>
          <p className="tapestry-empty-body">
            Create notes, connect ideas, and build your world of thought.
          </p>
        </div>
      )}

      {/* Transformed container: notes and connections pan/zoom together */}
      <div className="tapestry-canvas-container" style={containerStyle}>
        {/* SVG overlay for connection lines */}
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
          {edges.map((edge) => {
            const from = getNodeCenter(edge.from)
            const to = getNodeCenter(edge.to)
            if (!from || !to) return null
            return (
              <ConnectionLine
                key={edge.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            )
          })}
          {/* Temporary connection line during drag-connect */}
          {tempConnectionLine && (
            <ConnectionLine
              x1={tempConnectionLine.x1}
              y1={tempConnectionLine.y1}
              x2={tempConnectionLine.x2}
              y2={tempConnectionLine.y2}
              isTemporary
            />
          )}
        </svg>

        {/* Note cards */}
        {nodes.map((node) => (
          <NoteCard
            key={node.id}
            node={node}
            isEditing={editingNodeId === node.id}
            isHovered={hoveredNoteId === node.id}
            isSelected={selectedNoteId === node.id}
            isConnectTarget={connectingHover === node.id}
            isConnecting={connectingFrom !== null}
            zoom={view.zoom}
            onStartEditing={() => onStartEditing(node.id)}
            onBorderSelect={() => handleBorderSelect(node.id)}
            onSave={onSave}
            onMarkDirty={onMarkDirty}
            onMarkClean={onMarkClean}
            onPositionChange={onPositionChange}
            onHover={(hovered) =>
              setHoveredNoteId(hovered ? node.id : null)
            }
            onHoverDuringConnection={() =>
              handleNoteHoverDuringConnection(node.id)
            }
            onLeaveDuringConnection={() =>
              handleNoteHoverDuringConnection(null)
            }
            onStartConnection={() => handleStartConnection(node.id)}
            onRegisterDims={registerNodeDims}
          />
        ))}
      </div>
    </div>
  )
}
