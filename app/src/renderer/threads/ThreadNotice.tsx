/**
 * ThreadNotice -- the phase's two failure notices, on the visual shape of
 * `PluginErrorNotification` (fixed card, message, named action buttons).
 *
 * Per UI-SPEC's Copywriting Contract, every failure *word* renders in the
 * `--tap-destructive-text` token (6.00:1 on paper, per UI-SPEC TA-20); the
 * carried `--tap-destructive` fill is reserved for the delete button and is
 * not used here. This component takes tokens by name (`var(--tap-*)`) and
 * never writes a colour literal itself -- token values live in App.css's
 * `:root` block.
 *
 * Not yet wired into ThreadOverlay: this plan ships the component with its
 * exact copy and tokens; the later plan that adds the read-only past-stage
 * view and time-out detection is what actually triggers these two states.
 */

import React from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThreadNoticeKind = 'history-unreadable' | 'graphics-lost'

export interface ThreadNoticeProps {
  kind: ThreadNoticeKind
  /** Why the history could not be read (history-unreadable only). Falls
   * back to a generic phrase when omitted, so the notice never reads as an
   * incomplete sentence. */
  reason?: string
  onShowTreeFileInFinder?: () => void
  onCloseThreadView?: () => void
  onRedrawThread?: () => void
}

// ---------------------------------------------------------------------------
// Styles -- token names only, never a raw hex literal at this use site
// ---------------------------------------------------------------------------

const CARD_STYLE: React.CSSProperties = {
  background: 'var(--tap-surface)',
  border: '1px solid var(--tap-destructive-text)',
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  padding: '12px 20px',
  maxWidth: 480,
}

const MESSAGE_STYLE: React.CSSProperties = {
  margin: 0,
  color: 'var(--tap-destructive-text)',
  fontSize: 14,
  lineHeight: 1.5,
}

const ACTIONS_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 12,
}

const ACTION_BUTTON_STYLE: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid var(--tap-destructive-text)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--tap-destructive-text)',
  cursor: 'pointer',
}

// ---------------------------------------------------------------------------
// ThreadNotice
// ---------------------------------------------------------------------------

export default function ThreadNotice({
  kind,
  reason,
  onShowTreeFileInFinder,
  onCloseThreadView,
  onRedrawThread,
}: ThreadNoticeProps): React.ReactElement {
  if (kind === 'history-unreadable') {
    const why = reason && reason.trim().length > 0 ? reason : 'the record could not be read'
    return (
      <div className="thread-notice thread-notice-history-unreadable" style={CARD_STYLE} role="alert">
        <p style={MESSAGE_STYLE}>
          {`Part of this thread's history can't be read — ${why}. The text is still here and is read-only, so nothing gets overwritten. Choose Show tree file in Finder to look at it.`}
        </p>
        <div style={ACTIONS_STYLE}>
          <button type="button" style={ACTION_BUTTON_STYLE} onClick={onShowTreeFileInFinder}>
            Show tree file in Finder
          </button>
          <button type="button" style={ACTION_BUTTON_STYLE} onClick={onCloseThreadView}>
            Close thread view
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="thread-notice thread-notice-graphics-lost" style={CARD_STYLE} role="alert">
      <p style={MESSAGE_STYLE}>
        The thread view lost its graphics connection. Your text and history are safe. Choose Redraw thread.
      </p>
      <div style={ACTIONS_STYLE}>
        <button type="button" style={ACTION_BUTTON_STYLE} onClick={onRedrawThread}>
          Redraw thread
        </button>
      </div>
    </div>
  )
}
