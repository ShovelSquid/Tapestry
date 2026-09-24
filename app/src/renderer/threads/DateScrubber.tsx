/**
 * DateScrubber — the thin, always-visible bar along the bottom of the side
 * view (D-17; UI-SPEC "Gap and scrubber honesty", "Sessions, gaps and
 * times", "Spacing": "Scrubber bar 32px tall").
 *
 * Linear in true time, with a 1px tick per day and an ink bar on days that
 * carry writing (height relative to the busiest day) — the scrubber is the
 * one view where hours of gaps and sessions are legible at once (spike 011:
 * "the scrubber carries the sessions themselves"). Dragging moves the view
 * window; the timeline itself never rescales (D-16, D-17) — this component
 * only ever calls `onScrub` with a new centre; it never touches zoom.
 */

import React, { useRef } from 'react'
import { dayIndexOf, dayIndexToCenterMs, dayStartMs, MS_PER_DAY } from './navigation'

export interface DateScrubberProps {
  /** The thread's own first and last recorded moment (absolute ms) — the
   * scrubber's own domain ends (UI-SPEC "Scrubber ends"). */
  firstDateMs: number
  lastDateMs: number
  /** The side view's current centre and span, in absolute ms, so the accent
   * bracket (UI-SPEC: "a 2px accent bracket") can be drawn over the current
   * window. */
  viewCenterMs: number
  viewSpanMs: number
  /** Letters written per day, indexed from day 0 = the day containing
   * `firstDateMs` (UI-SPEC: "an Ink bar whose height is that day's letters
   * relative to the busiest day"). A day with no entry is treated as 0. */
  dailyLetterCounts: readonly number[]
  /** Called with a new view centre (absolute ms) from a drag, click, or
   * scrubber-focused keyboard action. Never called with a new span. */
  onScrub: (centerMs: number) => void
}

const BAR_HEIGHT_PX = 32
const TICK_INSET_PX = 4

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DateScrubber({
  firstDateMs,
  lastDateMs,
  viewCenterMs,
  viewSpanMs,
  dailyLetterCounts,
  onScrub,
}: DateScrubberProps): React.ReactElement {
  const trackRef = useRef<HTMLDivElement>(null)

  const firstDay = dayStartMs(firstDateMs)
  const lastDay = dayStartMs(lastDateMs)
  const domainMs = Math.max(MS_PER_DAY, lastDay - firstDay + MS_PER_DAY)
  const totalDays = Math.max(1, dayIndexOf(lastDay, firstDay) + 1)
  const busiestDay = Math.max(1, ...dailyLetterCounts, 0)

  function xToMs(clientX: number, rect: DOMRect): number {
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left - TICK_INSET_PX) / Math.max(1, rect.width - 2 * TICK_INSET_PX)))
    return firstDay + fraction * domainMs
  }

  function handlePointer(e: React.PointerEvent<HTMLDivElement>): void {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onScrub(xToMs(e.clientX, rect))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onScrub(viewCenterMs - (e.shiftKey ? 7 * MS_PER_DAY : MS_PER_DAY))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onScrub(viewCenterMs + (e.shiftKey ? 7 * MS_PER_DAY : MS_PER_DAY))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onScrub(dayIndexToCenterMs(0, firstDay))
    } else if (e.key === 'End') {
      e.preventDefault()
      onScrub(dayIndexToCenterMs(totalDays - 1, firstDay))
    }
  }

  const accentLeftPct = Math.min(100, Math.max(0, ((viewCenterMs - viewSpanMs / 2 - firstDay) / domainMs) * 100))
  const accentWidthPct = Math.max(0.3, Math.min(100, (viewSpanMs / domainMs) * 100))

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={`Date scrubber: ${formatDate(firstDateMs)} to ${formatDate(lastDateMs)}, showing ${formatDate(viewCenterMs)}`}
      aria-valuemin={firstDay}
      aria-valuemax={lastDay}
      aria-valuenow={Math.round(viewCenterMs)}
      aria-valuetext={formatDate(viewCenterMs)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        handlePointer(e)
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) handlePointer(e)
      }}
      onKeyDown={handleKeyDown}
      className="tap-thread-scrubber"
      style={{
        position: 'relative',
        height: BAR_HEIGHT_PX,
        width: '100%',
        cursor: 'pointer',
        outline: 'none',
        touchAction: 'none',
      }}
    >
      {/* The scrubber's own centre rule -- day ticks and the ink bar sit on
          this line. --tap-border is this codebase's existing equivalent of
          the UI-SPEC's narratively-named `--tap-line` (2.06:1 non-text
          contrast, the 02.1 divider token); no new colour token is declared
          for it. */}
      <div
        style={{
          position: 'absolute',
          left: TICK_INSET_PX,
          right: TICK_INSET_PX,
          top: BAR_HEIGHT_PX / 2,
          height: 1,
          background: 'var(--tap-border)',
        }}
      />
      {Array.from({ length: totalDays }, (_, day) => {
        const letters = dailyLetterCounts[day] ?? 0
        const leftPct = totalDays > 1 ? (day / (totalDays - 1)) * 100 : 0
        const inkHeightPx = letters > 0 ? Math.max(2, (letters / busiestDay) * (BAR_HEIGHT_PX - 8)) : 0
        return (
          <div
            key={day}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `calc(${TICK_INSET_PX}px + ${leftPct}% * (100% - ${2 * TICK_INSET_PX}px) / 100%)`,
              bottom: 4,
              width: 1,
              height: inkHeightPx > 0 ? inkHeightPx : 4,
              background: inkHeightPx > 0 ? 'var(--tap-ink)' : 'var(--tap-border)',
            }}
          />
        )
      })}
      {/* UI-SPEC: "The current view is a 2px accent bracket." */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: `${accentLeftPct}%`,
          width: `${accentWidthPct}%`,
          top: 0,
          bottom: 0,
          border: '2px solid var(--tap-accent)',
          borderRadius: 2,
          pointerEvents: 'none',
        }}
      />
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: -14, fontSize: 11, color: 'var(--tap-muted)' }}>
        {formatDate(firstDateMs)}
      </span>
      <span aria-hidden="true" style={{ position: 'absolute', right: 0, bottom: -14, fontSize: 11, color: 'var(--tap-muted)' }}>
        {formatDate(lastDateMs)}
      </span>
    </div>
  )
}
