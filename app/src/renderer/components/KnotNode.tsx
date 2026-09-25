/**
 * KnotNode -- an editable node sitting between two linked notes: the knot of
 * a connection, holding text about the relationship it ties together.
 *
 * Per D-16: Knots hold text about the connection and are ordinary
 * editable/connectable nodes using the same ProseMirror editor as notes.
 *
 * Per D-17: Auto-positioned at the midpoint between endpoints until manually
 * dragged. The drag is tracked locally and committed ONCE on pointer-up via
 * onPinnedPositionChange, which writes position.x/position.y AND pinned=true
 * in a single kernel commit. After that the node keeps the user's position.
 *
 * Per D-18: Empty knots appear on connection hover/selection; once they
 * have text they remain visible.
 *
 * Per 02.3 D-26: this is the knot and its two edges are knot-ties. The word
 * "thread" now names a time thread only, and never this feature.
 *
 * Per D-26: Same editor behavior as NoteCard via shared useProseMirror hook.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import { useProseMirror } from '../editor/use-prosemirror'
import { tapestrySchema } from '../editor/schema'
import { FormatPill, useTextSelected } from '../look/FormatBar'
import { seedFromId } from '../look/ink'
import { layoutSize, screenDeltaToWorld } from '../layout/camera'

interface KnotProps {
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
  /**
   * The drawn camera roll, in degrees. With zoom, it turns screen deltas into
   * world deltas, so a drag stays under the pointer on a rolled canvas.
   * Defaults to 0 (unrolled).
   */
  roll?: number
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

export const KNOT_WIDTH = 200
export const KNOT_MIN_HEIGHT = 44

/**
 * The knot's node type and its tie edge label (D-26). One module owns both
 * spellings so a second copy cannot drift away from this one. Consumers must
 * compare the node type with `===` against KNOT_TYPE — a substring test on the
 * four-letter word would also match unrelated future types.
 */
export const KNOT_TYPE = 'tapestry.notes/knot@1'
export const KNOT_TIE_LABEL = 'knot-tie'

/**
 * D-18 is about TEXT, not serialization shape: a knot that had a character
 * typed and deleted is saved as an empty ProseMirror doc and must return to
 * the ghost state. Plain-text (legacy) bodies count as text if non-blank.
 */
function bodyHasText(body: string): boolean {
  if (!body) return false
  try {
    const json = JSON.parse(body)
    if (json && typeof json === 'object' && json.type === 'doc') {
      return tapestrySchema.nodeFromJSON(json).textContent.trim().length > 0
    }
  } catch {
    // not JSON (or not a valid doc) -- fall through to the plain-text test
  }
  return body.trim().length > 0
}

export default function KnotNode({
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
  roll = 0,
  onStartEditing,
  onSave,
  onMarkDirty,
  onMarkClean,
  onPinnedPositionChange,
  onHover,
  onRegisterDims,
}: KnotProps): React.ReactElement {
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

  const { editorRef, viewRef } = useProseMirror({
    nodeId,
    initialBody: body,
    isEditing,
    onSave: handleEditorSave,
    onMarkDirty,
    onMarkClean,
  })

  // Expose the EditorView (created in the hook's effect) for the toolbar (D-26).
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  useEffect(() => {
    setEditorView(viewRef.current)
  }, [nodeId, viewRef])

  useEffect(() => {
    if (cardRef.current) {
      const size = layoutSize(cardRef.current, zoom, roll)
      onRegisterDims(nodeId, size.width, size.height)
    }
  }, [nodeId, zoom, roll, body, onRegisterDims])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Do not start a drag from inside the editor or the floating toolbar.
      if ((e.target as HTMLElement).closest('.ProseMirror, .floating-toolbar')) return
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
      const d = screenDeltaToWorld(
        e.clientX - dragStartRef.current.mx,
        e.clientY - dragStartRef.current.my,
        zoom,
        roll,
      )
      setLocalPos({ x: dragStartRef.current.ox + d.x, y: dragStartRef.current.oy + d.y })
    },
    [zoom, roll],
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

  // The format pill (Line Lab v2 wave 3) sits on the knot's top edge while
  // text in it is selected; a knot has no corner buttons to open it from.
  const textSelected = useTextSelected(isEditing ? editorView : null)

  const isEmpty = !bodyHasText(body)
  const showOnlyOnHover = isEmpty && !isEditing

  return (
    <div
      ref={cardRef}
      className={[
        'knot-node',
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
        width: KNOT_WIDTH,
        minHeight: KNOT_MIN_HEIGHT,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div ref={editorRef} className="knot-editor" />
      {/* The format pill (D-24/D-26) */}
      {isEditing && textSelected && editorView && (
        <FormatPill view={editorView} seed={seedFromId(nodeId)} x={8} y={-18} minW={KNOT_WIDTH - 16} h={28} />
      )}
    </div>
  )
}
