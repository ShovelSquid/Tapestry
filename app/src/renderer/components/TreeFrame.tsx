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

import React, { useState, useEffect } from 'react'
import { useAnnounce } from './LiveAnnouncer'
import NoteCard from './NoteCard'
import VaultNoteCard from './VaultNoteCard'
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
import type { NodeInfo } from './Canvas'

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
 */
const NODE_VIEW_COMPONENTS = {
  NoteCard,
  VaultNoteCard,
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
function unavailableActions(tree: ForestTree): Array<{ label: string; run: () => void }> {
  const closeTree = {
    label: 'Close tree',
    run: (): void => {
      void window.tapestry.trees.close(tree.id)
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
    const actions = unavailableActions(tree)
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

  // ThreadCard menu (D-07 UI-SPEC "The thread on the 2D canvas": "Open
  // thread", "Thread settings", "Delete thread") and the settings popover it
  // opens (UI-SPEC "Thread settings": "opened from ... the ThreadCard menu").
  const [threadMenuOpenFor, setThreadMenuOpenFor] = useState<string | null>(null)
  const [threadSettingsFor, setThreadSettingsFor] = useState<{ nodeId: string; x: number; y: number } | null>(null)

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

        {/* Note cards — ThreadCard for threads, VaultNoteCard/NoteCard for
            other known types, FallbackNodeView otherwise */}
        {tree.nodes.filter((n) => !isKnot(n)).map((node) => {
          const key = keyFor(node.id)
          const view = mappedNodeView(pluginNodeViews[node.type])

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
                  isSelected={selectedKey === key}
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
                node={node}
                isSelected={selectedKey === key}
                zoom={zoom}
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
              treeId={tree.id}
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
