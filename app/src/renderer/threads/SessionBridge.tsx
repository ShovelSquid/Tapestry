/**
 * SessionBridge -- "a bridge of session notes joined by the drawn line"
 * (D-07), below the ThreadCard on the 2D canvas.
 *
 * This is a plain 2D DOM element, not the WebGL stage: the canvas has no
 * time axis of its own (UI-SPEC "Bridge time scale" reconciliation table),
 * so the bridge is a small, ordinary absolutely-positioned layout rather
 * than a second three.js scene. It reuses `stage/ribbon.ts`'s `CHUNK_KIND`
 * vocabulary (session/gap) for its own two segment kinds so "the dashes are
 * the existing vocabulary for 'time passed here'" is one vocabulary, not two.
 *
 * Spacing (UI-SPEC "Bridge time scale", "Spacing"):
 *  - 2px per minute of thread time at 100% canvas zoom.
 *  - A gap with no writing for more than 30 minutes squashes to a fixed
 *    52px dash run (`time-out dash · 48px dotted · time-in dash`),
 *    labelled "Away [duration] — shortened here" -- the "shortened here"
 *    clause is canvas-only (never in the side view, which keeps true
 *    length always, D-16).
 *  - Minimum pill centre-to-centre is `r1 + r2 + 8px`; where real time
 *    would put two pills closer, they are pushed to the minimum and that
 *    segment draws solid (no dashes) -- the mirror of the squash.
 *  - Session pills are 12-32px on a log scale from <=100 to >=5,000 letters.
 *  - Above 9 sessions: first 4, a "+[n]" pill, last 4 (simplified here to
 *    opening the thread rather than a focused Sessions list -- Known Stub,
 *    see SUMMARY).
 *
 * `loadSessions` and the formatting helpers below are also used by
 * `SessionList.tsx` (02.3-06 Task 3) so the canvas bridge and the no-stage
 * fallback describe the identical sessions in the identical words.
 */

import React, { useEffect, useState } from 'react'
import SessionPill from './SessionPill'
import { CHUNK_KIND } from './stage/ribbon'
import { parseBlock, parseBlockHeader } from '../../shared/threads/grammar'
import { deriveSessions, type AuthoredThreadRecord, type DerivedSession } from '../../shared/threads/sessions'

// ---------------------------------------------------------------------------
// Loading (shared with SessionList.tsx)
// ---------------------------------------------------------------------------

/**
 * Reads every `thread.log` value for `nodeId` (in commit order, as the
 * kernel already returns them) and derives its sessions. Never reads
 * `node.props['thread.log']` from a node snapshot -- that only ever holds
 * the *latest* batch (a `set` replaces the property's current value), never
 * the accumulated history `deriveSessions` needs.
 */
export async function loadSessions(treeId: string, nodeId: string): Promise<DerivedSession[]> {
  const entries = await window.tapestry.kernel.getPropertyValues(treeId, nodeId, 'thread.log')
  const authored: AuthoredThreadRecord[] = []
  for (const entry of entries) {
    const block = String(entry.value.value)
    const header = parseBlockHeader(block)
    for (const record of parseBlock(block)) {
      authored.push({ ...record, atMs: header.anchorMs + record.offsetMs, actor: entry.actor.id })
    }
  }
  return deriveSessions(authored)
}

/** Live-updates whenever this thread's own commits flush -- the same
 * broadcast `ThreadOverlay`'s save-state listens to (`thread:confirmed`
 * reaches every window, not just the one with the overlay open). */
export function useSessions(treeId: string, nodeId: string): DerivedSession[] {
  const [sessions, setSessions] = useState<DerivedSession[]>([])

  useEffect(() => {
    let cancelled = false
    loadSessions(treeId, nodeId)
      .then((s) => {
        if (!cancelled) setSessions(s)
      })
      .catch((err: unknown) => console.error('[SessionBridge] failed to load sessions:', err))
    return () => {
      cancelled = true
    }
  }, [treeId, nodeId])

  useEffect(() => {
    return window.tapestry.onThreadConfirmed((confirmedTreeId, confirmedNodeId) => {
      if (confirmedTreeId !== treeId || confirmedNodeId !== nodeId) return
      loadSessions(treeId, nodeId)
        .then((s) => setSessions(s))
        .catch((err: unknown) => console.error('[SessionBridge] failed to refresh sessions:', err))
    })
  }, [treeId, nodeId])

  return sessions
}

// ---------------------------------------------------------------------------
// Formatting (shared with SessionList.tsx / MarkerList.tsx)
// ---------------------------------------------------------------------------

/** "3 days 4 h", "45 min" -- at most two units, always at least one. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours > 0) parts.push(`${hours} h`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`)
  return parts.slice(0, 2).join(' ')
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function authorList(session: DerivedSession): string {
  return session.authors.join(', ')
}

/** "Session [n] · [date], [time] · [n] letters · [authors] — open the
 * document as it was then" (UI-SPEC "Sessions, gaps and times"). */
export function sessionAccessibleName(session: DerivedSession): string {
  return `Session ${session.index} · ${formatDate(session.startMs)}, ${formatTime(session.startMs)} · ${session.letterCount} letters · ${authorList(session)} — open the document as it was then`
}

/** "Session [n], [date] [time], [n] letters, by [authors]" -- the `[`/`]`
 * polite live-region announcement (UI-SPEC "Screen-reader announcements"),
 * deliberately different punctuation from the accessible name above. */
export function sessionAnnouncement(session: DerivedSession): string {
  return `Session ${session.index}, ${formatDate(session.startMs)} ${formatTime(session.startMs)}, ${session.letterCount} letters, by ${authorList(session)}`
}

// ---------------------------------------------------------------------------
// Pill sizing and layout
// ---------------------------------------------------------------------------

const PILL_MIN_PX = 12
const PILL_MAX_PX = 32
const PILL_MIN_LETTERS = 100
const PILL_MAX_LETTERS = 5000
const PX_PER_MINUTE = 2
const SQUASH_THRESHOLD_MINUTES = 30
const SQUASH_RUN_PX = 52
const MIN_EDGE_GAP_PX = 8
const OVERFLOW_THRESHOLD = 9
const OVERFLOW_EDGE_COUNT = 4

/** 12-32px on a log scale from <=100 to >=5,000 letters (UI-SPEC "Spacing"). */
function pillDiameter(letterCount: number): number {
  const clamped = Math.max(PILL_MIN_LETTERS, Math.min(PILL_MAX_LETTERS, Math.max(letterCount, 1)))
  const t = Math.log(clamped / PILL_MIN_LETTERS) / Math.log(PILL_MAX_LETTERS / PILL_MIN_LETTERS)
  return PILL_MIN_PX + t * (PILL_MAX_PX - PILL_MIN_PX)
}

interface PillLayout {
  session: DerivedSession
  x: number
  radius: number
}

interface BridgeSegment {
  x1: number
  x2: number
  kind: (typeof CHUNK_KIND)['SESSION'] | (typeof CHUNK_KIND)['GAP']
  squashLabel?: string
}

interface BridgeLayout {
  pills: PillLayout[]
  segments: BridgeSegment[]
  width: number
}

/**
 * Places each session's pill along the bridge. A gap's ideal spacing is
 * `elapsed minutes * 2px` (the timeline scale); a gap over 30 minutes is
 * squashed to a fixed 52px run regardless of its true length; a gap that
 * would put two pills closer than `r1 + r2 + 8px` is pushed to that
 * minimum and drawn solid (no dashes) rather than dashed.
 */
function layoutBridge(sessions: readonly DerivedSession[]): BridgeLayout {
  const pills: PillLayout[] = []
  const segments: BridgeSegment[] = []
  let x = 0

  for (let i = 0; i < sessions.length; i++) {
    const radius = pillDiameter(sessions[i].letterCount) / 2
    if (i === 0) {
      x = radius
    } else {
      const prev = pills[i - 1]
      const gapMs = Math.max(0, sessions[i].startMs - sessions[i - 1].endMs)
      const gapMinutes = gapMs / 60_000

      if (gapMinutes > SQUASH_THRESHOLD_MINUTES) {
        x = prev.x + prev.radius + SQUASH_RUN_PX + radius
        segments.push({
          x1: prev.x + prev.radius,
          x2: x - radius,
          kind: CHUNK_KIND.GAP,
          squashLabel: `Away ${formatDuration(gapMs)} — shortened here`,
        })
      } else {
        const idealEdgeGapPx = gapMinutes * PX_PER_MINUTE
        if (idealEdgeGapPx < MIN_EDGE_GAP_PX) {
          x = prev.x + prev.radius + MIN_EDGE_GAP_PX + radius
          segments.push({ x1: prev.x + prev.radius, x2: x - radius, kind: CHUNK_KIND.SESSION })
        } else {
          x = prev.x + prev.radius + idealEdgeGapPx + radius
          segments.push({ x1: prev.x + prev.radius, x2: x - radius, kind: CHUNK_KIND.GAP })
        }
      }
    }
    pills.push({ session: sessions[i], x, radius })
  }

  const width = pills.length > 0 ? pills[pills.length - 1].x + pills[pills.length - 1].radius : 0
  return { pills, segments, width }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SessionBridgeProps {
  treeId: string
  nodeId: string
  /** The ThreadCard's own local (x, y) and rendered dims, so the bridge sits
   * directly below it with the UI-SPEC "sm" (8px) gap. */
  cardX: number
  cardBottom: number
  focusedSessionIndex: number | null
  onOpenSession: (sessionIndex: number) => void
  /** UI-SPEC "Overflow": "Clicking '+[n]' opens the Sessions list." The full
   * Sessions list is Task 3/07's SessionList; simplified here to opening the
   * thread overlay (Known Stub, see SUMMARY). */
  onShowAllSessions: () => void
}

const BRIDGE_GAP_PX = 8

export default function SessionBridge({
  treeId,
  nodeId,
  cardX,
  cardBottom,
  focusedSessionIndex,
  onOpenSession,
  onShowAllSessions,
}: SessionBridgeProps): React.ReactElement | null {
  const sessions = useSessions(treeId, nodeId)
  if (sessions.length === 0) return null

  // UI-SPEC "Overflow": above 9 sessions, show the first 4, a "+[n]" pill,
  // and the last 4. Simplified here: the "+[n]" pill opens the thread (the
  // full Sessions list it should open is Task 3/07's SessionList -- Known
  // Stub, see SUMMARY).
  const overflowCount = sessions.length > OVERFLOW_THRESHOLD ? sessions.length - OVERFLOW_EDGE_COUNT * 2 : 0
  const visible =
    overflowCount > 0
      ? [...sessions.slice(0, OVERFLOW_EDGE_COUNT), ...sessions.slice(sessions.length - OVERFLOW_EDGE_COUNT)]
      : sessions

  const { pills, segments, width } = layoutBridge(visible)

  return (
    <div
      style={{
        position: 'absolute',
        left: cardX,
        top: cardBottom + BRIDGE_GAP_PX,
        width: Math.max(width, 1),
        height: 1.5,
      }}
    >
      {/* The bridge's own base line -- "a 1.5px --tap-thread-line horizontal
          line carrying one session pill per session, joined end to end"
          (UI-SPEC "The thread on the 2D canvas"). */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height: 1.5,
          background: 'var(--tap-thread-line)',
        }}
      />

      {segments.map((segment, i) => {
        const isSquashed = segment.squashLabel !== undefined
        return (
          <React.Fragment key={i}>
            {segment.kind === CHUNK_KIND.GAP && (
              <div
                style={{
                  position: 'absolute',
                  left: segment.x1,
                  top: 0,
                  width: Math.max(0, segment.x2 - segment.x1),
                  height: 1.5,
                  borderTop: isSquashed
                    ? '2px dotted var(--tap-thread-line)'
                    : '1px dotted var(--tap-thread-line)',
                }}
              />
            )}
            {segment.squashLabel && (
              <span
                style={{
                  position: 'absolute',
                  left: (segment.x1 + segment.x2) / 2,
                  top: 16,
                  transform: 'translateX(-50%)',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  color: 'var(--tap-muted)',
                }}
              >
                {segment.squashLabel}
              </span>
            )}
          </React.Fragment>
        )
      })}

      {pills.map(({ session, x, radius }, i) => (
        <React.Fragment key={session.index}>
          {/* The overflow indicator sits between the first 4 and the last 4
              (UI-SPEC "Overflow"): "+[n]" for the sessions not individually
              shown. */}
          {overflowCount > 0 && i === OVERFLOW_EDGE_COUNT && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onShowAllSessions()
              }}
              title={`${overflowCount} more sessions`}
              aria-label={`${overflowCount} more sessions`}
              style={{
                position: 'absolute',
                left: (pills[OVERFLOW_EDGE_COUNT - 1].x + pills[OVERFLOW_EDGE_COUNT - 1].radius + x - radius) / 2,
                top: -6,
                transform: 'translateX(-50%)',
                fontSize: 11,
                border: 'none',
                background: 'transparent',
                color: 'var(--tap-muted)',
                cursor: 'pointer',
              }}
            >
              +{overflowCount}
            </button>
          )}
          <div style={{ position: 'absolute', left: x, top: 0.75 }}>
            <SessionPill
              accessibleName={sessionAccessibleName(session)}
              dateLabel={formatDate(session.startMs)}
              diameterPx={radius * 2}
              hitTargetPx={Math.max(radius * 2, 24)}
              isFocused={focusedSessionIndex === session.index}
              onOpen={() => onOpenSession(session.index)}
            />
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}
