/**
 * SessionList -- the stage's accessible and visual equivalent (UI-SPEC
 * "No-stage fallback", "Visual Hierarchy"): one row per session with date,
 * duration, letter count and authors, initial focus on the most recent
 * session, each row expanding to its `MarkerList`.
 *
 * This is the component `StageFallbackPanel.tsx` mounts when the stage
 * cannot draw at all -- "a machine with no WebGL loses no meaning at all"
 * -- but it is also the keyboard-reachable, always-correct path a
 * screen-reader user takes even when the stage *is* drawn (UI-SPEC "Marker
 * meaning without the stage" route 2), so it never depends on WebGL being
 * present or absent.
 */

import React, { useEffect, useRef, useState } from 'react'
import MarkerList from './MarkerList'
import { sessionAccessibleName, sessionAnnouncement, useSessions } from './SessionBridge'
import type { DerivedSession, SessionMarker } from '../../shared/threads/sessions'

export interface SessionListProps {
  treeId: string
  nodeId: string
  /** Called when a session or marker row is opened (`Enter`, or clicking a
   * marker row). Opening the document read-only at that exact moment is
   * D-18's side view, which does not exist yet (a later plan's job) -- this
   * plan's own scope for the no-stage fallback is staying fully writable
   * and fully navigable, so this is a no-op seam for now (Known Stub, see
   * SUMMARY). */
  onOpenMoment?: (atMs: number) => void
}

/** Visually hidden but still reachable by assistive tech (no new CSS class
 * needed, since App.css is outside this task's own file list). */
const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

function sessionRowLabel(session: DerivedSession): string {
  return `Session ${session.index} · ${session.letterCount} letters · ${session.authors.join(', ')}`
}

export default function SessionList({ treeId, nodeId, onOpenMoment }: SessionListProps): React.ReactElement {
  const sessions = useSessions(treeId, nodeId)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  // UI-SPEC "Visual Hierarchy": "initial focus on the most recent session."
  useEffect(() => {
    if (sessions.length === 0 || focusedIndex !== -1) return
    const lastIndex = sessions.length - 1
    setFocusedIndex(lastIndex)
    setExpandedIndex(lastIndex)
  }, [sessions.length, focusedIndex])

  function moveFocus(direction: 1 | -1): void {
    if (sessions.length === 0) return
    const next = Math.max(0, Math.min(sessions.length - 1, focusedIndex + direction))
    setFocusedIndex(next)
    setExpandedIndex(next)
    setAnnouncement(sessionAnnouncement(sessions[next]))
    rowRefs.current[next]?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === '[') {
      e.preventDefault()
      moveFocus(-1)
    } else if (e.key === ']') {
      e.preventDefault()
      moveFocus(1)
    }
  }

  function handleOpenMarker(marker: SessionMarker): void {
    onOpenMoment?.(marker.atMs)
  }

  if (sessions.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--tap-muted)', padding: '8px 16px' }}>No sessions yet</p>
  }

  return (
    <div onKeyDown={handleKeyDown} style={{ width: '100%', overflowY: 'auto' }}>
      <div aria-live="polite" style={visuallyHiddenStyle}>
        {announcement}
      </div>
      {sessions.map((session, i) => {
        const isExpanded = expandedIndex === i
        return (
          <div key={session.index}>
            <div
              ref={(el) => {
                rowRefs.current[i] = el
              }}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={sessionAccessibleName(session)}
              onFocus={() => setFocusedIndex(i)}
              onClick={() => setExpandedIndex(isExpanded ? null : i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onOpenMoment?.(session.startMs)
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px',
                fontSize: 13,
                color: 'var(--tap-ink)',
                cursor: 'pointer',
                background: i === focusedIndex ? 'var(--tap-surface-sunk)' : 'transparent',
                outline: i === focusedIndex ? '2px solid var(--tap-accent)' : 'none',
                outlineOffset: -2,
              }}
            >
              <span>{sessionRowLabel(session)}</span>
            </div>
            {isExpanded && <MarkerList markers={session.markers} onOpen={handleOpenMarker} />}
          </div>
        )
      })}
    </div>
  )
}
