/**
 * ThreadSettingsPopover -- D-10/D-13 per-thread settings (UI-SPEC "Thread
 * settings popover").
 *
 * On the `PassageChooser` surface, min width 320px, 24px padding, dismissed
 * by clicking outside or Escape. Opened from the overlay header gear and
 * from the ThreadCard menu. Initial focus goes to the time-out field.
 *
 * Every change here is an ordinary recorded `set` on the thread node --
 * no separate settings store, no file outside the journal (T-02.3-06-04:
 * only this human-driven popover writes these keys; no MCP tool does).
 * Because a session's `out`/`in` are recorded outcomes (sessions.ts), a
 * setting change here can never move a dash already on the line -- that is
 * exactly what makes it safe to commit immediately, with no confirmation.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { dotRateAt, parseSlowdown, HZ, type SlowdownBreakpoint, type SlowdownCurve } from '../../shared/threads/slowdown'
import { parseThreadSettings, type ThreadNodeProps } from '../../shared/threads/settings'

const MIN_TIMEOUT_SECONDS = 10
const MAX_TIMEOUT_SECONDS = 60 * 60
const PREVIEW_WIDTH_PX = 240
const PREVIEW_DURATION_SECONDS = 120

function isTruthyProp(value: string | number | boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === true || value === 'true'
}

/** "10 seconds" / "1 minute" / "2 minutes" -- the exact wording the
 * default curve's copy table uses (`After 10 seconds`, `After 1 minute`). */
function formatAfter(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60
    return `${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  return `${seconds} second${seconds === 1 ? '' : 's'}`
}

/** Tick x-positions (px) where a new dot would land over a
 * `PREVIEW_DURATION_SECONDS`-second pause, from the identical closed-form
 * rate `dotRateAt` already gives the CPU test suite and the GPU shader --
 * a fourth, independent place this exact curve is evaluated, never
 * re-approximated. */
function previewTicks(curve: SlowdownCurve): number[] {
  const ticks: number[] = []
  let phase = 0
  let lastDot = -1
  const dt = 0.05
  for (let t = 0; t <= PREVIEW_DURATION_SECONDS; t += dt) {
    phase += dotRateAt(curve, t) * dt
    const dotIndex = Math.floor(phase)
    if (dotIndex !== lastDot) {
      ticks.push((t / PREVIEW_DURATION_SECONDS) * PREVIEW_WIDTH_PX)
      lastDot = dotIndex
    }
  }
  return ticks
}

export interface ThreadSettingsPopoverProps {
  treeId: string
  nodeId: string
  /** Anchor position (fixed-positioned, like `PassageChooser`). */
  x: number
  y: number
  onClose: () => void
}

export default function ThreadSettingsPopover({
  treeId,
  nodeId,
  x,
  y,
  onClose,
}: ThreadSettingsPopoverProps): React.ReactElement {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const timeoutInputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const [loaded, setLoaded] = useState(false)
  const [timeoutMinutesText, setTimeoutMinutesText] = useState('2.5')
  const [breakpoints, setBreakpoints] = useState<SlowdownBreakpoint[]>([])
  const [gravityOn, setGravityOn] = useState(true)
  const [authorColorsAlways, setAuthorColorsAlways] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.tapestry.kernel
      .getNode(treeId, nodeId)
      .then((node) => {
        if (cancelled) return
        const props = (node?.props ?? {}) as ThreadNodeProps
        const settings = parseThreadSettings(props)
        setTimeoutMinutesText(String(settings.timeout / 60))
        setBreakpoints([...parseSlowdown(settings.slowdown)])
        setGravityOn(isTruthyProp(props['thread.gravity']?.value, true))
        setAuthorColorsAlways(isTruthyProp(props['thread.authorColorsAlways']?.value, false))
        setLoaded(true)
      })
      .catch((err: unknown) => console.error('[ThreadSettingsPopover] failed to load settings:', err))
    return () => {
      cancelled = true
    }
  }, [treeId, nodeId])

  // UI-SPEC "Visual Hierarchy": "the time-out field, with initial focus on it."
  useEffect(() => {
    if (loaded) timeoutInputRef.current?.focus()
  }, [loaded])

  // Dismissed by clicking outside or Escape.
  useEffect(() => {
    function handlePointerDown(e: MouseEvent): void {
      if (surfaceRef.current && !surfaceRef.current.contains(e.target as Node)) onCloseRef.current()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const commit = useCallback(
    (key: string, type: 'real' | 'text' | 'bool', value: string | number | boolean) => {
      window.tapestry.kernel
        .submit(treeId, 'Change thread settings', [{ op: 'setProperty', target: nodeId, key, type, value }])
        .catch((err: unknown) => console.error('[ThreadSettingsPopover] failed to save setting:', err))
    },
    [treeId, nodeId],
  )

  function commitTimeout(): void {
    const minutes = Number(timeoutMinutesText)
    const seconds = Math.round(minutes * 60)
    if (!Number.isFinite(minutes) || seconds < MIN_TIMEOUT_SECONDS || seconds > MAX_TIMEOUT_SECONDS) {
      setValidationError('Choose a pause between 10 seconds and 60 minutes.')
      return
    }
    setValidationError(null)
    commit('thread.timeout', 'real', seconds)
  }

  function commitSlowdown(next: SlowdownBreakpoint[]): void {
    setBreakpoints(next)
    commit(
      'thread.slowdown',
      'text',
      next.map((bp) => `${bp.afterSeconds}:${bp.ratePerSecond}`).join(' '),
    )
  }

  const ticks = previewTicks(breakpoints)

  return (
    <div
      ref={surfaceRef}
      className="passage-chooser"
      role="dialog"
      aria-label="Thread settings"
      style={{ position: 'fixed', left: x, top: y, minWidth: 320, padding: 24 }}
    >
      <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 12, color: 'var(--tap-ink)' }}>Thread settings</div>

      <label style={{ display: 'block', fontSize: 13, color: 'var(--tap-ink)' }}>
        Pause before the line stops
        <input
          ref={timeoutInputRef}
          type="text"
          inputMode="decimal"
          value={timeoutMinutesText}
          onChange={(e) => setTimeoutMinutesText(e.target.value)}
          onBlur={commitTimeout}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 4,
            padding: '4px 8px',
            border: '1px solid var(--tap-border)',
            borderRadius: 6,
          }}
        />
      </label>
      <div style={{ fontSize: 11, color: 'var(--tap-muted)', marginTop: 2 }}>Like the timestamps in Messages.</div>
      {validationError && (
        <div style={{ fontSize: 11, color: 'var(--tap-destructive-text)', marginTop: 4 }}>{validationError}</div>
      )}

      <div style={{ marginTop: 16, fontSize: 13, fontWeight: 600, color: 'var(--tap-ink)' }}>
        How the dots slow while you pause
      </div>
      <div style={{ fontSize: 13, marginTop: 4, color: 'var(--tap-ink)' }}>{`While typing · ${HZ} a second`}</div>
      {breakpoints.map((bp, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 4 }}>
          <span style={{ color: 'var(--tap-ink)' }}>{`After ${formatAfter(bp.afterSeconds)} · ${bp.ratePerSecond} a second`}</span>
          <button
            type="button"
            onClick={() => commitSlowdown(breakpoints.filter((_, j) => j !== i))}
            style={{
              fontSize: 11,
              border: 'none',
              background: 'transparent',
              color: 'var(--tap-muted)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Remove this step
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const last = breakpoints[breakpoints.length - 1]
          const nextAfter = last ? last.afterSeconds + 10 : 10
          commitSlowdown([...breakpoints, { afterSeconds: nextAfter, ratePerSecond: 1 }])
        }}
        style={{
          fontSize: 12,
          marginTop: 8,
          border: '1px solid var(--tap-border)',
          borderRadius: 6,
          background: 'transparent',
          padding: '4px 8px',
          cursor: 'pointer',
          color: 'var(--tap-ink)',
        }}
      >
        Add a step
      </button>

      <svg width={PREVIEW_WIDTH_PX} height={24} style={{ display: 'block', marginTop: 12 }} aria-hidden="true">
        {ticks.map((tickX, i) => (
          <line key={i} x1={tickX} x2={tickX} y1={4} y2={20} stroke="var(--tap-thread-line)" strokeWidth={1} />
        ))}
      </svg>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 16, color: 'var(--tap-ink)' }}>
        <input
          type="checkbox"
          checked={gravityOn}
          onChange={(e) => {
            setGravityOn(e.target.checked)
            commit('thread.gravity', 'bool', e.target.checked)
          }}
        />
        Pull the view toward sessions while hovering
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 8, color: 'var(--tap-ink)' }}>
        <input
          type="checkbox"
          checked={authorColorsAlways}
          onChange={(e) => {
            setAuthorColorsAlways(e.target.checked)
            commit('thread.authorColorsAlways', 'bool', e.target.checked)
          }}
        />
        Always show author colours
      </label>
      <div style={{ fontSize: 11, color: 'var(--tap-muted)', marginTop: 2 }}>Otherwise, hold Option to see them.</div>

      {/* Always visible, never dismissible -- the user-facing statement of
          sessions.ts's own recorded-outcome rule (T-02.3-06-02). */}
      <div style={{ fontSize: 11, color: 'var(--tap-muted)', marginTop: 16 }}>
        New settings apply from now on. Pauses and dots already on the line keep the settings they were written with.
      </div>
    </div>
  )
}
