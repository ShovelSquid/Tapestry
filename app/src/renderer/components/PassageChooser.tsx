/**
 * PassageChooser -- disambiguation popup for overlapping passages (D-15).
 *
 * When the user clicks in a region where multiple passages overlap, this
 * component presents a small list of the overlapping passages sorted by
 * span length so the user can choose which thread to follow or highlight.
 */

import React, { useCallback, useEffect, useRef } from 'react'

interface PassageInfo {
  anchorId: string
  text: string
  spanLength: number
}

interface PassageChooserProps {
  passages: PassageInfo[]
  x: number
  y: number
  onSelect: (anchorId: string) => void
  onDismiss: () => void
}

export default function PassageChooser({
  passages,
  x,
  y,
  onSelect,
  onDismiss,
}: PassageChooserProps): React.ReactElement {
  const sorted = [...passages].sort((a, b) => a.spanLength - b.spanLength)

  // Single cancellable dismiss timer: leaving starts it, re-entering cancels
  // it, unmount clears it (so onDismiss never fires against stale parent state).
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const cancelDismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const scheduleDismiss = useCallback(() => {
    cancelDismiss()
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null
      onDismissRef.current()
    }, 300)
  }, [cancelDismiss])

  useEffect(() => cancelDismiss, [cancelDismiss])

  // Keyboard users need a way out too.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelDismiss()
        onDismissRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [cancelDismiss])

  return (
    <div
      className="passage-chooser"
      role="menu"
      style={{ position: 'fixed', left: x, top: y }}
      onMouseEnter={cancelDismiss}
      onMouseLeave={scheduleDismiss}
    >
      <div className="passage-chooser-header">Select passage</div>
      {sorted.map((p) => (
        <button
          key={p.anchorId}
          className="passage-chooser-item"
          role="menuitem"
          onClick={() => {
            cancelDismiss()
            onSelect(p.anchorId)
          }}
        >
          <span className="passage-chooser-text">
            {p.text.length > 40 ? p.text.slice(0, 40) + '…' : p.text}
          </span>
        </button>
      ))}
    </div>
  )
}
