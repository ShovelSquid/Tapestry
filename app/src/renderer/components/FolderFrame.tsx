/**
 * FolderFrame — a workspace folder drawn as a frame inside its workspace frame
 * (02.7 D-21).
 *
 * It is the tree frame's design one level down: the same FrameHeader (variant
 * 'folder'), the same `.tapestry-tree-frame` border treatment, and a content
 * layer translated to the folder's origin, so the cards and child folders
 * inside keep their folder-local positions when the folder moves. Subfolders
 * are FolderFrames too, so the nesting is recursive.
 *
 * The geometry is not computed here. The rect comes from subspaceRects (which
 * sizes an open folder with computeFrameBounds(origin, boxes, FOLDER_FRAME)),
 * and whatever a move or an expand displaces is settled by settleSubspace(...)
 * in App before the one commit is sent, so the canvas and main agree by
 * construction.
 *
 * A collapsed folder is its header band and nothing else: its cards are not
 * rendered at all, which is what keeps a ~740-file repository cheap to draw.
 */

import React from 'react'
import FrameHeader from './FrameHeader'
import type { NodeInfo } from './Canvas'
import type { TreeSaveState } from '../state/use-forest'
import type { Point, SubspaceLayout } from '../layout/subspaces'

export interface FolderFrameProps {
  treeId: string
  folder: NodeInfo
  nodesById: ReadonlyMap<string, NodeInfo>
  /** Every folder rect and the hierarchy, from subspaceRects. */
  layout: SubspaceLayout
  /** A node's local position, honouring any live drag. */
  localOf: (nodeId: string) => Point
  saveState: TreeSaveState
  zoom: number
  /** Draws one workspace card, exactly as the tree frame draws its root cards. */
  renderCard: (node: NodeInfo) => React.ReactNode
  /** The header's collapse/expand button; `collapsed` is the state wanted. */
  onToggleFolder: (folderId: string, collapsed: boolean) => void
  /** Pointer down on a folder header (the start of a folder drag). */
  onHeaderPointerDown: (folderId: string, e: React.PointerEvent<HTMLDivElement>) => void
  /** The folder being dragged right now, if any. */
  draggingFolderId: string | null
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Files under a folder at any depth. */
function countFiles(layout: SubspaceLayout, folderId: string): number {
  const { childrenOf, folders } = layout.hierarchy
  let count = 0
  const stack = [folderId]
  for (let guard = 0; stack.length > 0 && guard < 100000; guard += 1) {
    const id = stack.pop() as string
    for (const child of childrenOf.get(id) ?? []) {
      if (folders.has(child)) stack.push(child)
      else count += 1
    }
  }
  return count
}

export default function FolderFrame(props: FolderFrameProps): React.ReactElement | null {
  const {
    treeId,
    folder,
    nodesById,
    layout,
    localOf,
    saveState,
    zoom,
    renderCard,
    onToggleFolder,
    onHeaderPointerDown,
    draggingFolderId,
  } = props

  const rect = layout.folderRects.get(folder.id)
  if (!rect) return null

  const path = String(folder.props['file.path']?.value ?? '')
  const name = baseName(path)
  const isOpen = layout.expanded.has(folder.id)
  const origin = localOf(folder.id)
  const children = layout.hierarchy.childrenOf.get(folder.id) ?? []
  const isDragging = draggingFolderId === folder.id

  const frameStyle: React.CSSProperties = {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  }

  // Local (0, 0) of the folder lands on its origin, as in TreeFrame.
  const contentStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    transform: `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px)`,
  }

  return (
    <div
      className={
        `tapestry-tree-frame tapestry-tree-frame--folder` +
        (isOpen ? '' : ' tapestry-tree-frame--collapsed') +
        (isDragging ? ' tapestry-tree-frame--dragging' : '')
      }
      data-folder-id={folder.id}
      data-folder-path={path}
      style={frameStyle}
    >
      <FrameHeader
        variant="folder"
        treeId={treeId}
        name={name}
        kind="workspace"
        saveState={saveState}
        zoom={zoom}
        collapsed={!isOpen}
        fileCount={countFiles(layout, folder.id)}
        onToggleCollapsed={() => onToggleFolder(folder.id, isOpen)}
        onPointerDown={(e) => onHeaderPointerDown(folder.id, e)}
      />

      {isOpen && (
        <div className="tapestry-tree-frame-content" style={contentStyle}>
          {children.map((childId) => {
            const child = nodesById.get(childId)
            if (!child) return null
            if (!layout.hierarchy.folders.has(childId)) return null
            return <FolderFrame key={childId} {...props} folder={child} />
          })}
          {children.map((childId) => {
            const child = nodesById.get(childId)
            if (!child || layout.hierarchy.folders.has(childId)) return null
            return <React.Fragment key={childId}>{renderCard(child)}</React.Fragment>
          })}
        </div>
      )}
    </div>
  )
}
