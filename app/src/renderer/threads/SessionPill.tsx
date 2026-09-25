/**
 * SessionPill -- one session note on the canvas bridge (D-07, UI-SPEC
 * "Spacing", "The thread on the 2D canvas").
 *
 * A session pill is a **view derived from history, not a node** (UI-SPEC
 * "Pill affordances: None beyond clicking"). It carries no drag, no connect
 * handle, no delete bubble and no context menu -- clicking it opens the
 * thread. It is a plain `<button>`, nothing else: this file deliberately
 * imports no other note-affordance component (the connect/delete bubbles
 * every ordinary note carries).
 */

import React from 'react'

export interface SessionPillProps {
  /** "Session [n] · [date], [time] · [n] letters · [authors] — open the
   * document as it was then" (UI-SPEC "Sessions, gaps and times"). */
  accessibleName: string
  /** The pill's own short date label, always shown beneath it (UI-SPEC
   * "Date readability": "a reader never has to measure the bridge"). */
  dateLabel: string
  /** The disc's own diameter in px (12-32px, log-scaled by letter count). */
  diameterPx: number
  /** The clickable target's diameter -- `max(diameterPx, 24)` (UI-SPEC
   * "pointer target: max(pill radius, 12px)"). */
  hitTargetPx: number
  isFocused: boolean
  onOpen: () => void
}

export default function SessionPill({
  accessibleName,
  dateLabel,
  diameterPx,
  hitTargetPx,
  isFocused,
  onOpen,
}: SessionPillProps): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: -hitTargetPx / 2,
        top: -hitTargetPx / 2,
        width: hitTargetPx,
        height: hitTargetPx,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <button
        type="button"
        title={accessibleName}
        aria-label={accessibleName}
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        style={{
          width: diameterPx,
          height: diameterPx,
          borderRadius: '50%',
          border: `1.5px solid var(--tap-thread-line)`,
          background: 'var(--tap-surface)',
          outline: isFocused ? '2px solid var(--tap-accent)' : 'none',
          outlineOffset: 2,
          cursor: 'pointer',
          padding: 0,
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '100%',
          marginTop: 4,
          fontSize: 11,
          lineHeight: 1.2,
          color: 'var(--tap-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        {dateLabel}
      </span>
    </div>
  )
}
