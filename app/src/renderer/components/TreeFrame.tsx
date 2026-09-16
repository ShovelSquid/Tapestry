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

import React from 'react'
import NoteCard from './NoteCard'
import FallbackNodeView from './FallbackNodeView'
import ConnectionLine from './ConnectionLine'
import KnotNode from './KnotNode'
import FrameHeader from './FrameHeader'
import type { ForestTree, NodeRef } from '../state/use-forest'
import { nodeKey } from '../state/use-forest'
import type { FrameRect } from '../layout/frames'
import type { NodeInfo } from './Canvas'

/** Fallback thread-center size until the node registers its real dims. */
const THREAD_CENTER_FALLBACK_WIDTH = 200
const THREAD_CENTER_FALLBACK_HEIGHT = 44

function isThreadCenter(node: NodeInfo): boolean {
  return node.type.includes('thread-center')
}

/** Everything a note inside a frame can ask the space to do. */
export interface TreeFrameHandlers {
  onStartEditing: (ref: NodeRef) => void
  onSave: (ref: NodeRef, body: string, title: string) => Promise<void>
  onMarkDirty: (ref: NodeRef) => void
  onMarkClean: (ref: NodeRef) => void
  onPositionChange: (ref: NodeRef, x: number, y: number) => void
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
}

interface TreeFrameProps {
  tree: ForestTree
  /** The frame's world rect, already computed from content bounds. */
  rect: FrameRect
  zoom: number
  /** Per-note UI state, keyed by nodeKey so two trees cannot collide. */
  editingKey: string | null
  hoveredKey: string | null
  selectedKey: string | null
  connectingHoverKey: string | null
  /** True while any connection drag is in progress, in any tree. */
  isConnecting: boolean
  pluginNodeViews: Record<string, string>
  currentUserActorId: string | null
  /** Live drag positions, keyed by nodeKey. */
  dragPositions: Record<string, { x: number; y: number }>
  getDims: (key: string) => { width: number; height: number } | undefined
  /** Frame-level state, which drives the border treatment (UI-SPEC). */
  isSelected: boolean
  isHovered: boolean
  isDragging: boolean
  /** Pointer down on the header band: the start of a frame drag. */
  onHeaderPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onFrameHover: (hovered: boolean) => void
  handlers: TreeFrameHandlers
}

export default function TreeFrame({
  tree,
  rect,
  zoom,
  editingKey,
  hoveredKey,
  selectedKey,
  connectingHoverKey,
  isConnecting,
  pluginNodeViews,
  currentUserActorId,
  dragPositions,
  getDims,
  isSelected,
  isHovered,
  isDragging,
  onHeaderPointerDown,
  onFrameHover,
  handlers,
}: TreeFrameProps): React.ReactElement {
  const refFor = (nodeId: string): NodeRef => ({ treeId: tree.id, nodeId })
  const keyFor = (nodeId: string): string => nodeKey(refFor(nodeId))

  /** A note's center in this tree's local coordinates. */
  const getNodeCenter = (nodeId: string): { x: number; y: number } | null => {
    const node = tree.nodes.find((n) => n.id === nodeId)
    if (!node) return null
    const drag = dragPositions[keyFor(nodeId)]
    const px = drag ? drag.x : Number(node.props['position.x']?.value ?? 0)
    const py = drag ? drag.y : Number(node.props['position.y']?.value ?? 0)
    const dims = getDims(keyFor(nodeId))
    return { x: px + (dims?.width ?? 240) / 2, y: py + (dims?.height ?? 80) / 2 }
  }

  // ---------------------------------------------------------------------
  // Thread-center auto positions (D-17), computed ONCE for this tree and
  // shared by its edge layer and its node layer. An unpinned center is
  // RENDERED at the midpoint of its endpoints rather than at its stored
  // position, so edges must resolve it from here or the thread arms end at a
  // phantom point that drifts whenever an endpoint note moves.
  // ---------------------------------------------------------------------

  const threadCenterAuto = new Map<
    string,
    { left: number; top: number; width: number; height: number }
  >()
  for (const node of tree.nodes) {
    if (!isThreadCenter(node)) continue
    const dims = getDims(keyFor(node.id))
    const width = dims?.width ?? THREAD_CENTER_FALLBACK_WIDTH
    const height = dims?.height ?? THREAD_CENTER_FALLBACK_HEIGHT
    const px = Number(node.props['position.x']?.value ?? 0)
    const py = Number(node.props['position.y']?.value ?? 0)
    const isPinned =
      node.props['pinned']?.value === true || node.props['pinned']?.value === 'true'

    let left = px
    let top = py
    if (!isPinned) {
      const sourceEdge = tree.edges.find((e) => e.label === 'thread-arm' && e.to === node.id)
      const destEdge = tree.edges.find((e) => e.label === 'thread-arm' && e.from === node.id)
      const sourceCenter = sourceEdge ? getNodeCenter(sourceEdge.from) : null
      const destCenter = destEdge ? getNodeCenter(destEdge.to) : null
      if (sourceCenter && destCenter) {
        left = (sourceCenter.x + destCenter.x) / 2 - width / 2
        top = (sourceCenter.y + destCenter.y) / 2 - height / 2
      }
    }
    threadCenterAuto.set(node.id, { left, top, width, height })
  }

  /** Node center honoring the displayed (auto) position of thread centers. */
  const resolveNodeCenter = (nodeId: string): { x: number; y: number } | null => {
    const auto = threadCenterAuto.get(nodeId)
    if (auto) return { x: auto.left + auto.width / 2, y: auto.top + auto.height / 2 }
    return getNodeCenter(nodeId)
  }

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

  // Dragging outranks selected, which outranks hovered: the strongest thing
  // true of the frame right now is what its border should say.
  const stateClass = isDragging
    ? ' tapestry-tree-frame--dragging'
    : isSelected
      ? ' tapestry-tree-frame--selected'
      : isHovered
        ? ' tapestry-tree-frame--hovered'
        : ''

  return (
    <div
      className={`tapestry-tree-frame${stateClass}`}
      data-tree-id={tree.id}
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
      <div
        onPointerEnter={() => onFrameHover(true)}
        onPointerLeave={() => onFrameHover(false)}
      >
        <FrameHeader
          name={tree.name}
          kind={tree.kind}
          saveState={tree.saveState}
          onPointerDown={onHeaderPointerDown}
        />
      </div>

      <div className="tapestry-tree-frame-content" style={contentStyle}>
        {/* This tree's connections only (D-16 cross-tree links are Plan 15) */}
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
          {tree.edges.map((edge) => {
            const from = resolveNodeCenter(edge.from)
            const to = resolveNodeCenter(edge.to)
            if (!from || !to) return null
            return (
              <ConnectionLine key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
            )
          })}
        </svg>

        {/* Thread center nodes (D-16/D-17/D-18) */}
        {tree.nodes.filter(isThreadCenter).map((node) => {
          const px = Number(node.props['position.x']?.value ?? 0)
          const py = Number(node.props['position.y']?.value ?? 0)
          const isPinned =
            node.props['pinned']?.value === true || node.props['pinned']?.value === 'true'
          const bodyVal = node.props['body']?.value
          const body = typeof bodyVal === 'string' ? bodyVal : ''

          const sourceEdge = tree.edges.find((e) => e.label === 'thread-arm' && e.to === node.id)
          const destEdge = tree.edges.find((e) => e.label === 'thread-arm' && e.from === node.id)

          const auto = threadCenterAuto.get(node.id)

          // D-18: an empty (ghost) center has pointer-events: none, so it can
          // never hover itself. Reveal it when either endpoint is hovered.
          const endpointKeys = [sourceEdge?.from, destEdge?.to]
            .filter((id): id is string => typeof id === 'string')
            .map(keyFor)
          const isCenterHovered =
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
              isHovered={isCenterHovered}
              zoom={zoom}
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

        {/* Note cards — NoteCard for known types, FallbackNodeView otherwise */}
        {tree.nodes.filter((n) => !isThreadCenter(n)).map((node) => {
          const key = keyFor(node.id)

          if (pluginNodeViews[node.type]) {
            return (
              <NoteCard
                key={node.id}
                node={node}
                isEditing={editingKey === key}
                isHovered={hoveredKey === key}
                isSelected={selectedKey === key}
                isConnectTarget={connectingHoverKey === key}
                isConnecting={isConnecting}
                zoom={zoom}
                provenance={tree.history?.nodes[node.id]}
                currentUserActorId={currentUserActorId}
                onStartEditing={() => handlers.onStartEditing(refFor(node.id))}
                onBorderSelect={() => handlers.onBorderSelect(refFor(node.id))}
                onSave={(nodeId, body, title) => handlers.onSave(refFor(nodeId), body, title)}
                onMarkDirty={(nodeId) => handlers.onMarkDirty(refFor(nodeId))}
                onMarkClean={(nodeId) => handlers.onMarkClean(refFor(nodeId))}
                onPositionChange={(nodeId, x, y) =>
                  handlers.onPositionChange(refFor(nodeId), x, y)
                }
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
                onDragMove={(nodeId, x, y) => handlers.onDragMove(refFor(nodeId), x, y)}
                onDragEnd={(nodeId) => handlers.onDragEnd(refFor(nodeId))}
              />
            )
          }

          // D-33/D-35: FallbackNodeView for missing/disabled plugin nodes
          return (
            <FallbackNodeView
              key={node.id}
              node={node}
              isSelected={selectedKey === key}
              isHovered={hoveredKey === key}
              zoom={zoom}
              onBorderSelect={() => handlers.onBorderSelect(refFor(node.id))}
              onHover={(hovered) => handlers.onHover(refFor(node.id), hovered)}
              onPositionChange={(nodeId, x, y) =>
                handlers.onPositionChange(refFor(nodeId), x, y)
              }
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
