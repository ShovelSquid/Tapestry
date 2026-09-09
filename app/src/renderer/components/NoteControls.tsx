/**
 * NoteControls -- bubbly round controls around a note's edges (D-06).
 *
 * Two mandatory controls:
 *   1. Connection handle -- circular, 28px, accent #4A7CFF, scales to 32px on hover
 *   2. Delete bubble -- circular, 28px, destructive #E5484D, scales to 32px on hover
 *
 * Controls appear on note hover or selection and remain reachable while
 * the pointer moves from the note body to the controls (hover group with
 * 300ms hide delay managed by NoteCard).
 *
 * Per D-07: controls do not move the caret or lose text selection. They
 * use onPointerDown + preventDefault to avoid stealing focus from ProseMirror.
 */

import React, { useCallback } from 'react'

interface NoteControlsProps {
  onConnect: () => void
  onDelete: () => void
}

export default function NoteControls({
  onConnect,
  onDelete,
}: NoteControlsProps): React.ReactElement {
  const handleConnectDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault() // Prevent focus steal (D-07)
      onConnect()
    },
    [onConnect],
  )

  const handleDeleteDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      onDelete()
    },
    [onDelete],
  )

  return (
    <div className="tapestry-note-controls">
      {/* Connection handle -- right edge */}
      <button
        className="tapestry-control-bubble tapestry-control-bubble--connect"
        onPointerDown={handleConnectDown}
        title="Connect to another note"
        tabIndex={-1}
      >
        {/* Link icon glyph (simple SVG) */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </button>

      {/* Delete bubble -- top-right corner */}
      <button
        className="tapestry-control-bubble tapestry-control-bubble--delete"
        onPointerDown={handleDeleteDown}
        title="Delete note"
        tabIndex={-1}
      >
        {/* X icon glyph */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
