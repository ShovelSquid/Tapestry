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

import React, { useEffect } from 'react'
import { useAnnounce } from './LiveAnnouncer'
import NoteCard from './NoteCard'
import VaultNoteCard from './VaultNoteCard'
import WorkspaceFileCard from './WorkspaceFileCard'
import FolderFrame from './FolderFrame'
import FallbackNodeView from './FallbackNodeView'
import ConnectionLine from './ConnectionLine'
import ThreadCenterNode from './ThreadCenterNode'
import FrameHeader from './FrameHeader'
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

/** Fallback thread-center size until the node registers its real dims. */
const THREAD_CENTER_FALLBACK_WIDTH = 200
const THREAD_CENTER_FALLBACK_HEIGHT = 44

function isThreadCenter(node: NodeInfo): boolean {
  return node.type.includes('thread-center')
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
  /** A folder frame's collapse/expand button; `collapsed` is the state wanted (D-21). */
  onToggleFolder: (ref: NodeRef, collapsed: boolean) => void
  /** Pointer down on a folder frame's header: the start of a folder drag (D-21). */
  onFolderHeaderPointerDown: (ref: NodeRef, e: React.PointerEvent<HTMLDivElement>) => void
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
  displayPositions,
  getDims,
  isSelected,
  isHovered,
  isDragging,
  onHeaderPointerDown,
  onFrameHover,
  handlers,
  subspaces,
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
    const drag = dragPositions[keyFor(nodeId)]
    const spot = displayPositions.get(nodeId)
    const px = spot ? spot.x : drag ? drag.x : Number(node.props['position.x']?.value ?? 0)
    const py = spot ? spot.y : drag ? drag.y : Number(node.props['position.y']?.value ?? 0)
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

  const nodesById = new Map(tree.nodes.map((node) => [node.id, node]))

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
      isSelected={selectedKey === keyFor(node.id)}
      zoom={zoom}
      provenance={tree.history?.nodes[node.id]}
      onBorderSelect={() => handlers.onBorderSelect(refFor(node.id))}
      onHover={(hovered) => handlers.onHover(refFor(node.id), hovered)}
      onPositionChange={(nodeId, x, y) => handlers.onPositionChange(refFor(nodeId), x, y)}
      onRegisterDims={(nodeId, w, h) => handlers.onRegisterDims(refFor(nodeId), w, h)}
      onDragMove={(nodeId, x, y) => handlers.onDragMove(refFor(nodeId), x, y)}
      onDragEnd={(nodeId) => handlers.onDragEnd(refFor(nodeId))}
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
            if (isInsideCollapsed(edge.from) || isInsideCollapsed(edge.to)) return null
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
            <ThreadCenterNode
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
        {tree.nodes.filter((n) => !isThreadCenter(n) && !isNestedInSubspace(n)).map((node) => {
          const key = keyFor(node.id)
          const view = mappedNodeView(pluginNodeViews[node.type])

          if (view === 'WorkspaceFileCard') return renderWorkspaceCard(node)

          if (view === 'VaultNoteCard') {
            return (
              <VaultNoteCard
                key={node.id}
                treeId={tree.id}
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
                treeId={tree.id}
                node={node}
                displayPosition={displayPositions.get(node.id)?.followSpot ?? undefined}
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
                onPositionChange={writePosition}
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
              displayPosition={displayPositions.get(node.id)?.followSpot ?? undefined}
              isSelected={selectedKey === key}
              isHovered={hoveredKey === key}
              zoom={zoom}
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
