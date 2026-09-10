/**
 * ThreadCenterNode -- an editable node positioned between two linked notes,
 * representing a thread's center that can hold text about the relationship.
 *
 * Per D-16: Thread center nodes hold text about the thread and are ordinary
 * editable/connectable nodes using the same ProseMirror editor as notes.
 *
 * Per D-17: Auto-positioned at the midpoint between endpoints until manually
 * dragged. The drag is tracked locally and committed ONCE on pointer-up via
 * onPinnedPositionChange, which writes position.x/position.y AND pinned=true
 * in a single kernel commit. After that the node keeps the user's position.
 *
 * Per D-18: Empty center nodes appear on thread hover/selection; once they
 * have text they remain visible.
 *
 * Per D-26: Same editor behavior as NoteCard via shared useProseMirror hook.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useProseMirror } from '../editor/use-prosemirror'

interface ThreadCenterProps {
  nodeId: string
  body: string
  x: number
  y: number
  isPinned: boolean
  autoX: number
  autoY: number
  isEditing: boolean
  isHovered: boolean
  zoom: number
  onStartEditing: () => void
  onSave: (nodeId: string, body: string, title: string) => Promise<void>
  onMarkDirty: (nodeId: string) => void
  onMarkClean: (nodeId: string) => void
  /**
   * Called once at the end of a drag with the final world position. The
   * handler must persist position.x, position.y AND pinned=true together.
   */
  onPinnedPositionChange: (nodeId: string, x: number, y: number) => void
  onHover: (hovered: boolean) => void
  onRegisterDims: (id: string, w: number, h: number) => void
}

const THREAD_CENTER_WIDTH = 200
const THREAD_CENTER_MIN_HEIGHT = 44

export default function ThreadCenterNode({
  nodeId,
  body,
  x,
  y,
  isPinned,
  autoX,
  autoY,
  isEditing,
  isHovered,
  zoom,
  onStartEditing,
  onSave,
  onMarkDirty,
  onMarkClean,
  onPinnedPositionChange,
  onHover,
  onRegisterDims,
}: ThreadCenterProps): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ mx: 0, my: 0, ox: 0, oy: 0 })

  // Local drag position for immediate feedback; committed once on pointer-up.
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null)

  const posX = localPos ? localPos.x : isPinned ? x : autoX
  const posY = localPos ? localPos.y : isPinned ? y : autoY

  // Clear the local override once the kernel's pinned position converges
  // (same pattern as NoteCard) so there is no flicker back to autoX/autoY.
  useEffect(() => {
    if (!isDraggingRef.current && localPos) setLocalPos(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, isPinned])

  const handleEditorSave = useCallback(
    (nid: string, newBody: string) => {
      onSave(nid, newBody, '')
    },
    [onSave],
  )

  const { editorRef } = useProseMirror({
    nodeId,
    initialBody: body,
    isEditing,
    onSave: handleEditorSave,
    onMarkDirty,
    onMarkClean,
  })

  useEffect(() => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      onRegisterDims(nodeId, rect.width / zoom, rect.height / zoom)
    }
  }, [nodeId, zoom, body, onRegisterDims])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.ProseMirror')) return
      if (e.button !== 0) return
      e.stopPropagation()
      isDraggingRef.current = true
      dragStartRef.current = { mx: e.clientX, my: e.clientY, ox: posX, oy: posY }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [posX, posY],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return
      const dx = (e.clientX - dragStartRef.current.mx) / zoom
      const dy = (e.clientY - dragStartRef.current.my) / zoom
      setLocalPos({ x: dragStartRef.current.ox + dx, y: dragStartRef.current.oy + dy })
    },
    [zoom],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      // Commit the final position exactly once (position + pinned=true).
      setLocalPos((p) => {
        if (p) onPinnedPositionChange(nodeId, p.x, p.y)
        return p
      })
    },
    [nodeId, onPinnedPositionChange],
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('.ProseMirror')) {
        onStartEditing()
      }
    },
    [onStartEditing],
  )

  const isEmpty = !body || body === '""' || body === ''
  const showOnlyOnHover = isEmpty && !isEditing

  return (
    <div
      ref={cardRef}
      className={[
        'thread-center-node',
        isEditing ? 'editing' : '',
        isHovered ? 'hovered' : '',
        showOnlyOnHover ? 'ghost' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        position: 'absolute',
        left: posX,
        top: posY,
        width: THREAD_CENTER_WIDTH,
        minHeight: THREAD_CENTER_MIN_HEIGHT,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div ref={editorRef} className="thread-center-editor" />
    </div>
  )
}
