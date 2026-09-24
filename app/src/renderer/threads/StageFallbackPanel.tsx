/**
 * StageFallbackPanel -- the D-09 stage area's readable equivalent when the
 * stage cannot draw (no WebGL, or the context was lost and never
 * recovered). The project's readability constraint applies to this feature
 * itself, not only to its files: with no stage, writing and history
 * recording must keep working exactly as they do with one (UI-SPEC
 * "No-stage fallback").
 *
 * A later plan replaces the placeholder body below with the real
 * `SessionList` (one row per session, expanding to a `MarkerList`) --
 * that data model (sessions, markers) does not exist yet; this plan's job
 * is only to make sure the stage area is never a blank rectangle when
 * WebGL is unavailable, and that the typer above stays full width and
 * fully writable regardless (verified by this component taking the stage
 * area's space without touching typer layout).
 */

import React from 'react'

export interface StageFallbackPanelProps {
  /** Why the stage isn't drawing, when known (e.g. from a
   * `webglcontextlost` that never recovered). Omitted for "no WebGL on
   * this machine at all". */
  reason?: string
}

export default function StageFallbackPanel({ reason }: StageFallbackPanelProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="Thread stage unavailable"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 24,
        textAlign: 'center',
        background: 'var(--tap-paper, #F7F5F0)',
      }}
    >
      <p style={{ fontSize: 16, lineHeight: 1.5, color: 'var(--tap-ink, #2C2C2C)', margin: 0, maxWidth: 480 }}>
        This machine can't draw the thread line. You can still read and write the document, and the sessions below
        list every stage of it.
      </p>
      {reason && (
        <p style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--tap-muted, #6B6B6B)', margin: 0 }}>{reason}</p>
      )}
    </div>
  )
}
