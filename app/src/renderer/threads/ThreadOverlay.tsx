/**
 * ThreadOverlay -- the D-09 live writing view: the DOM typer on top, the
 * canvas dimmed behind it (D-09's dimming is load-bearing: this overlay
 * paints an opaque scrim so the typer is always readable regardless of what
 * is behind it), and an empty stage area below for Plan 03's WebGL ribbon.
 *
 * Implements UI-SPEC "Loading and catch-up" rules 1-4 for the open path:
 *  1. Nothing blank, ever -- the typer shows the node's last checkpoint text
 *     immediately, before `thread:open` has even resolved.
 *  2. Read first, write a moment later -- the typer is read-only until
 *     replay finishes; the under-typer line is on screen throughout, so a
 *     keystroke attempted during catch-up is never met with silence.
 *  3. No status appears before STATUS_DELAY_MS (400ms): a short thread opens
 *     with no status at all.
 *  4. The `[total] changes` count is the number of `thread.log` values the
 *     addon returned on open, taken up front -- never an estimate.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useThreadEditor, type ThreadPushResult, type ThreadReadyState } from './use-thread-editor'

const STATUS_DELAY_MS = 400

export interface ThreadOverlayProps {
  treeId: string
  nodeId: string
  title: string
  /** The node's last `body` checkpoint -- shown immediately, read-only,
   * before the authoritative replayed document arrives (rule 1). */
  checkpointBody: string
  onClose: () => void
}

type SaveState = 'saved' | 'saving' | 'not-saved'

export default function ThreadOverlay({
  treeId,
  nodeId,
  title,
  checkpointBody,
  onClose,
}: ThreadOverlayProps): React.ReactElement {
  const [ready, setReady] = useState<ThreadReadyState | null>(null)
  const [totalChanges, setTotalChanges] = useState(0)
  const [showStatus, setShowStatus] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [notSavedReason, setNotSavedReason] = useState<string | null>(null)

  // The version this window last pushed, so a `thread:confirmed` broadcast
  // knows whether it covers everything this window has sent (rule: "Saved"
  // is never shown while ThreadService holds an unflushed batch).
  const lastPushedVersionRef = useRef(0)

  // ---------------------------------------------------------------------
  // Open: replay thread.log, show the checkpoint immediately (rule 1),
  // gate the catch-up status behind STATUS_DELAY_MS (rule 3).
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const statusTimer = setTimeout(() => {
      if (!cancelled) setShowStatus(true)
    }, STATUS_DELAY_MS)

    window.tapestry.thread
      .open(treeId, nodeId)
      .then((result) => {
        if (cancelled) return
        clearTimeout(statusTimer)
        lastPushedVersionRef.current = result.version
        setReady({ version: result.version, doc: result.doc })
        setTotalChanges(result.totalChanges)
        setShowStatus(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        clearTimeout(statusTimer)
        setOpenError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      clearTimeout(statusTimer)
    }
  }, [treeId, nodeId])

  // ---------------------------------------------------------------------
  // Save state: "Saved" is never shown while ThreadService holds an
  // unflushed batch (Thread overlay header spec). A push starts "Saving…";
  // a matching thread:confirmed broadcast retires it to "Saved".
  // ---------------------------------------------------------------------
  useEffect(() => {
    return window.tapestry.onThreadConfirmed((confirmedTreeId, confirmedNodeId, version) => {
      if (confirmedTreeId !== treeId || confirmedNodeId !== nodeId) return
      if (version >= lastPushedVersionRef.current) {
        setSaveState('saved')
        setNotSavedReason(null)
      }
    })
  }, [treeId, nodeId])

  // T-02.3-02-06: a refused flush must be visible as "Not saved", not left
  // showing "Saving…" forever while ThreadService retries in the background.
  useEffect(() => {
    return window.tapestry.onThreadFlushError((errorTreeId, errorNodeId, reason) => {
      if (errorTreeId !== treeId || errorNodeId !== nodeId) return
      setSaveState('not-saved')
      setNotSavedReason(reason)
    })
  }, [treeId, nodeId])

  const handlePush = useCallback(
    async (
      version: number,
      steps: unknown[],
      times: number[],
      causes: (string | null)[],
    ): Promise<ThreadPushResult> => {
      setSaveState('saving')
      const result = (await window.tapestry.thread.push(
        treeId,
        nodeId,
        version,
        steps,
        times,
        causes,
      )) as ThreadPushResult
      if (result.confirmed) {
        lastPushedVersionRef.current = result.version
      } else if ('rejected' in result && result.rejected) {
        setSaveState('not-saved')
        setNotSavedReason(result.reason)
      }
      return result
    },
    [treeId, nodeId],
  )

  const { editorRef } = useThreadEditor({ nodeId, checkpointBody, ready, onPush: handlePush })

  const handleClose = useCallback(() => {
    window.tapestry.thread
      .close(treeId, nodeId)
      .catch((err: unknown) => console.error('[ThreadOverlay] close failed:', err))
      .finally(onClose)
  }, [treeId, nodeId, onClose])

  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'not-saved' ? 'Not saved' : 'Saved'

  return (
    <div style={styles.overlay}>
      {/* D-09: the canvas dims behind the overlay -- an opaque scrim, not a
          translucent one, because glyphs the later stage draws are near-white
          and would be invisible over the undimmed cream canvas. */}
      <div style={styles.scrim} onClick={handleClose} />

      <div style={styles.panel} role="dialog" aria-label={title || 'Untitled thread'}>
        <header style={styles.header}>
          <span style={styles.title}>{title || 'Untitled thread'}</span>

          {showStatus && ready === null && (
            <span style={styles.statusLabel}>
              {/* rule 4: [total] is the count of thread.log values the addon
                  returned on open, never an estimate. This tracer's replay is
                  not chunked, so there is no incremental "n so far" to show
                  yet -- a later plan streams progress; until then n = total
                  for the whole time this status is visible. */}
              {`Catching up (${totalChanges} of ${totalChanges} changes)`}
            </span>
          )}

          {ready !== null && <span style={styles.statusLabel}>{saveLabel}</span>}

          <button type="button" onClick={handleClose} style={styles.closeButton}>
            Close thread view
          </button>
        </header>

        {openError && <div style={styles.error}>Couldn't finish reading this thread's history — {openError}</div>}

        <div ref={editorRef} style={styles.typer} />

        {/* Gated on the same 400ms threshold as the header status (rule 3):
            a short thread's catch-up finishes before either ever needs to
            appear, so nothing flashes. Once shown, this line is what makes
            rule 2's "a keystroke during catch-up is not swallowed silently"
            true -- it is already on screen throughout the read-only wait. */}
        {showStatus && ready === null && !openError && (
          <div style={styles.underTyperLine}>
            This is the last saved text. Writing starts when the history has finished loading.
          </div>
        )}

        {notSavedReason && <div style={styles.error}>Not saved — {notSavedReason}</div>}

        {/* D-09: the stage area. Left empty in this plan; Plan 03 fills it
            with the WebGL ribbon and glyphs. */}
        <div style={styles.stage} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Minimal inline styling -- visual design (markers, colours, session-note
// geometry) is Claude's discretion per CONTEXT.md and belongs to later plans.
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(20, 18, 14, 0.92)',
  },
  panel: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: 'min(720px, 92vw)',
    height: 'min(600px, 88vh)',
    background: '#FBF9F4',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    borderBottom: '1px solid #E4E0D6',
  },
  title: {
    fontWeight: 600,
    fontSize: 14,
    flex: 1,
  },
  statusLabel: {
    fontSize: 12,
    color: '#8A8578', // --tap-muted
  },
  closeButton: {
    fontSize: 12,
    border: '1px solid #C8C5BE',
    borderRadius: 6,
    background: 'transparent',
    padding: '4px 10px',
    cursor: 'pointer',
  },
  typer: {
    flex: '0 0 auto',
    minHeight: 160,
    maxHeight: '40vh',
    overflowY: 'auto',
    padding: '12px 16px',
    fontSize: 15,
    lineHeight: 1.5,
  },
  underTyperLine: {
    padding: '0 16px 12px',
    fontSize: 12,
    color: '#8A8578', // --tap-muted
  },
  error: {
    padding: '0 16px 12px',
    fontSize: 12,
    color: '#B4232A', // --tap-destructive-text
  },
  stage: {
    flex: 1,
    background: '#141712',
  },
}
