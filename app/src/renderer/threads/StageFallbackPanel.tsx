/**
 * StageFallbackPanel -- the D-09 stage area's readable equivalent when the
 * stage cannot draw (no WebGL, or the context was lost and never
 * recovered). The project's readability constraint applies to this feature
 * itself, not only to its files: with no stage, writing and history
 * recording must keep working exactly as they do with one (UI-SPEC
 * "No-stage fallback").
 *
 * Mounts `SessionList` -- the stage's accessible and visual equivalent --
 * so "a machine with no WebGL loses no meaning at all" (UI-SPEC): every
 * session and every marker stays reachable, and the typer above stays full
 * width and fully writable regardless (this component only ever occupies
 * the stage area, never the typer's).
 */

import React from 'react'
import SessionList from './SessionList'

export interface StageFallbackPanelProps {
  /** Why the stage isn't drawing, when known (e.g. from a
   * `webglcontextlost` that never recovered). Omitted for "no WebGL on
   * this machine at all". */
  reason?: string
  /** Present whenever the caller knows which thread this fallback stands
   * in for -- omitted only by a caller with no thread context at all, in
   * which case the explanatory notice still renders on its own. */
  treeId?: string
  nodeId?: string
  /** True for a vault thread (D-25) -- adds one sentence naming the extra
   * guarantee a vault note carries that an ordinary thread does not: its
   * current text also reaches a real file on disk, kept in sync the same
   * way as every other flush. Callers that don't yet know (no wiring exists
   * today that reads a node's own thread/vault properties from here) simply
   * omit this prop; the panel remains fully correct either way. */
  isVaultThread?: boolean
}

export default function StageFallbackPanel({
  reason,
  treeId,
  nodeId,
  isVaultThread,
}: StageFallbackPanelProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="Thread stage unavailable"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
        padding: 24,
        overflowY: 'auto',
        background: 'var(--tap-paper)',
      }}
    >
      <p style={{ fontSize: 16, lineHeight: 1.5, color: 'var(--tap-ink)', margin: 0, textAlign: 'center' }}>
        This machine can't draw the thread line. You can still read and write the document, and the sessions below
        list every stage of it.
      </p>
      {reason && (
        <p style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--tap-muted)', margin: 0, textAlign: 'center' }}>
          {reason}
        </p>
      )}
      {isVaultThread && (
        <p style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--tap-muted)', margin: 0, textAlign: 'center' }}>
          This is a vault note. Its current text also stays mirrored to the file on disk; timings, deleted letters
          and authors stay here in Tapestry, not in that file.
        </p>
      )}
      {treeId && nodeId && <SessionList treeId={treeId} nodeId={nodeId} />}
    </div>
  )
}
