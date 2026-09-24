/**
 * ThreadOverlay -- the D-09 live writing view: the DOM typer on top, the
 * WebGL stage below drawing the procedural ribbon and sharp letters, and
 * the canvas dimmed behind, non-interactive, while the overlay is open.
 *
 * Layout (UI-SPEC "Live writing view"): typer at 48px from the top,
 * horizontally centred, max 688px wide and at most 44% of window height;
 * the stage fills everything below it, 24px below the typer; the
 * vanishing point sits at the stage area's horizontal centre, 38% down it.
 *
 * Implements UI-SPEC "Loading and catch-up" rules 1-4 for the open path
 * (rules 1-3 shipped in Plan 02; this plan adds rule 1's stage half --
 * "the stage area shows paper with the ribbon drawn as soon as session
 * times are parsed... letters fill in behind it" -- via the
 * "Drawing the line ([n] of [total] letters)" status below the line):
 *  1. Nothing blank, ever -- the typer shows the node's last checkpoint
 *     text immediately; the stage shows paper (no spinner, no empty
 *     rectangle) the moment its history is parsed.
 *  2. Read first, write a moment later -- the typer is read-only until
 *     replay finishes.
 *  3. No status appears before STATUS_DELAY_MS (400ms).
 *  4. Both counted statuses ("[total] changes", "[total] letters") take
 *     their total up front -- never an estimate.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThreadEditor, type ThreadPushResult, type ThreadReadyState } from './use-thread-editor'
import StageFallbackPanel from './StageFallbackPanel'
import ThreadSettingsPopover from './ThreadSettingsPopover'
import {
  CHUNK_KIND,
  Ribbon,
  clearPendingFullUpload,
  createStageUniforms,
  type StageUniforms,
} from './stage/ribbon'
import { GlyphLayer } from './stage/glyphs'
import { getGlyphCache } from './stage/glyph-cache'
import { createLiveView, type LiveViewHandle } from './stage/live-view'
import { SideView, SIDE_ZOOM_DURATION_FACTOR } from './stage/side-view'
import { getStageRenderer, isWebglAvailable } from './stage/renderer'
import { readStageTokens } from './stage/tokens'
import { loadSessions } from './SessionBridge'
import { parseThreadFrame, parseThreadSettings, type ThreadFrame, type ThreadNodeProps } from '../../shared/threads/settings'
import { parseSlowdown, type SlowdownCurve } from '../../shared/threads/slowdown'
import { docAt, type ThreadCommitEntry, type ThreadLetter } from '../../shared/threads/replay'
import type { DerivedSession } from '../../shared/threads/sessions'

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

// ---------------------------------------------------------------------------
// History loading: merge thread.log + body commits (in commit order) and
// replay to "now" for the stage's initial bulk build (D-06 SC2: reopening
// redraws the line from saved keystrokes alone).
// ---------------------------------------------------------------------------

async function loadThreadCommits(treeId: string, nodeId: string): Promise<ThreadCommitEntry[]> {
  const [logEntries, bodyEntries] = await Promise.all([
    window.tapestry.kernel.getPropertyValues(treeId, nodeId, 'thread.log'),
    window.tapestry.kernel.getPropertyValues(treeId, nodeId, 'body'),
  ])
  const tagged: Array<{ seq: number; entry: ThreadCommitEntry }> = [
    ...logEntries.map((e) => ({ seq: e.seq, entry: { kind: 'log' as const, value: String(e.value.value) } })),
    ...bodyEntries.map((e) => ({ seq: e.seq, entry: { kind: 'checkpoint' as const, value: String(e.value.value) } })),
  ]
  tagged.sort((a, b) => a.seq - b.seq)
  return tagged.map((t) => t.entry)
}

interface StageHistory {
  frame: ThreadFrame
  slowdown: SlowdownCurve
  timeoutSeconds: number
  /** Live (non-deleted) letters, in the order `docAt` returned them. */
  letters: ThreadLetter[]
  /** D-07/D-16: the thread's own recorded sessions, so the ribbon's
   * historical reconstruction below can draw true-length gaps between them
   * instead of one continuous span standing in for real history. */
  sessions: DerivedSession[]
}

async function loadStageHistory(treeId: string, nodeId: string): Promise<StageHistory> {
  const [node, commits, sessions] = await Promise.all([
    window.tapestry.kernel.getNode(treeId, nodeId),
    loadThreadCommits(treeId, nodeId),
    loadSessions(treeId, nodeId),
  ])
  const props: ThreadNodeProps = node?.props ?? {}
  const frame = parseThreadFrame(props)
  const settings = parseThreadSettings(props)
  const { letters } = docAt(commits, Date.now())
  return {
    frame,
    slowdown: parseSlowdown(settings.slowdown),
    timeoutSeconds: settings.timeout,
    letters: letters.filter((l) => l.deletedAtMs === null),
    sessions,
  }
}

// ---------------------------------------------------------------------------
// The stage: one Ribbon + one GlyphLayer + the live-view camera, owned for
// the overlay's lifetime and rebuilt from records on `webglcontextlost`
// (never from the screen -- T-02.3-04-03).
// ---------------------------------------------------------------------------

interface StageRuntime {
  scene: THREE.Scene
  ribbon: Ribbon
  glyphs: GlyphLayer
  liveView: LiveViewHandle
  /** D-15..D-19: the side view's own camera, sharing this stage's ribbon,
   * glyphs and uniforms -- switching views changes the camera and a few
   * uniforms, never the renderer or the geometry (Task 1's action text). */
  sideView: SideView
  uniforms: StageUniforms
  /** The thread's own stored D-27 frame, as last applied to both cameras --
   * kept here so a view switch never needs to re-fetch it. */
  frame: ThreadFrame
  /** D-07/D-16: the thread's own recorded sessions, as last loaded --
   * gravity, fly-to and the side view's honest historical ribbon all read
   * from this same list rather than re-deriving it per interaction. */
  sessions: DerivedSession[]
  threadStartMs: number
  lastActivitySeconds: number
  pauseOpen: boolean
  firstBreakpointSeconds: number
  timeoutSeconds: number
}

function secondsSince(startMs: number, atMs: number): number {
  return (atMs - startMs) / 1000
}

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
  const [settingsAnchor, setSettingsAnchor] = useState<{ x: number; y: number } | null>(null)

  const [stageAvailable, setStageAvailable] = useState<boolean | null>(null)
  const [stageBuilding, setStageBuilding] = useState(false)
  const [stageBuiltCount, setStageBuiltCount] = useState(0)
  const [stageTotalCount, setStageTotalCount] = useState(0)
  const [stageError, setStageError] = useState<string | null>(null)

  // D-09/D-15: "Read the thread back" / "Return to now" -- `viewRef` is the
  // render loop's own source of truth (read inside `renderFrame`, which is
  // captured once by the mount effect below and must never see a stale
  // closure over `view`); `view` state exists only to drive the header
  // button's own label and re-render.
  const [view, setViewState] = useState<'live' | 'side'>('live')
  const viewRef = useRef<'live' | 'side'>('live')

  const stageContainerRef = useRef<HTMLDivElement>(null)
  const stageRuntimeRef = useRef<StageRuntime | null>(null)

  const lastPushedVersionRef = useRef(0)

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

  useEffect(() => {
    return window.tapestry.onThreadConfirmed((confirmedTreeId, confirmedNodeId, version) => {
      if (confirmedTreeId !== treeId || confirmedNodeId !== nodeId) return
      if (version >= lastPushedVersionRef.current) {
        setSaveState('saved')
        setNotSavedReason(null)
      }
    })
  }, [treeId, nodeId])

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

  // -------------------------------------------------------------------
  // Live keystroke -> stage: a letter is drawn the moment it is typed,
  // never deferred for the animation (D-09, spike 004).
  // -------------------------------------------------------------------
  const handleLocalInsert = useCallback((tMs: number, text: string) => {
    const stage = stageRuntimeRef.current
    if (!stage) return
    const renderer = getStageRenderer()
    if (!renderer) return
    const cache = getGlyphCache()
    const tSeconds = secondsSince(stage.threadStartMs, tMs)

    // A new keystroke always starts (or resumes) a fresh session chunk at
    // full HZ dot density, closing whatever chunk (session or pause) the
    // tick loop had open -- D-11: the rate resets as soon as typing resumes.
    stage.ribbon.addSpan(tSeconds, tSeconds, 0)
    stage.pauseOpen = false
    stage.lastActivitySeconds = tSeconds

    for (const grapheme of Array.from(text)) {
      stage.glyphs.add(renderer.renderer, cache, tSeconds, grapheme)
    }
  }, [])

  const { editorRef } = useThreadEditor({
    nodeId,
    checkpointBody,
    ready,
    onPush: handlePush,
    onLocalInsert: handleLocalInsert,
  })

  // -------------------------------------------------------------------
  // "Read the thread back" / "Return to now" (D-09, D-15): switches which
  // camera renderFrame draws, and frames the side view on the whole thread
  // the first time it opens in a given session (spike 001's own
  // `state.sideCenter = t0/2; state.sideSeconds = max(60, t0*1.05)`,
  // generalized to this plan's 1.1x duration factor).
  // -------------------------------------------------------------------
  const handleToggleView = useCallback(() => {
    const stage = stageRuntimeRef.current
    if (!stage) return
    if (viewRef.current === 'live') {
      const nowSeconds = secondsSince(stage.threadStartMs, Date.now())
      const initialSpan = Math.max(60, nowSeconds * SIDE_ZOOM_DURATION_FACTOR)
      stage.sideView.setView(nowSeconds / 2, initialSpan, nowSeconds)
      viewRef.current = 'side'
      setViewState('side')
    } else {
      viewRef.current = 'live'
      setViewState('live')
    }
  }, [])

  const handleClose = useCallback(() => {
    window.tapestry.thread
      .close(treeId, nodeId)
      .catch((err: unknown) => console.error('[ThreadOverlay] close failed:', err))
      .finally(onClose)
  }, [treeId, nodeId, onClose])

  // -------------------------------------------------------------------
  // The stage: build once, tear down on unmount. Rebuilds its buffers from
  // the thread's own records on mount; nothing is ever read back from the
  // screen (T-02.3-04-03).
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const container = stageContainerRef.current
    if (!container) return

    if (!isWebglAvailable()) {
      setStageAvailable(false)
      return
    }
    setStageAvailable(true)

    const rendererHandleOrNull = getStageRenderer()
    if (!rendererHandleOrNull) {
      setStageAvailable(false)
      return
    }
    // Narrowed once, outside any nested closure, so functions declared below
    // (which TS cannot otherwise prove never run after a reassignment) see a
    // non-null type without repeating the null check at every call site.
    const rendererHandle = rendererHandleOrNull

    setStageBuilding(true)

    const scene = new THREE.Scene()
    const tokens = readStageTokens()
    const uniforms = createStageUniforms(tokens)
    const ribbon = new Ribbon()
    ribbon.setUniforms(uniforms)
    const glyphs = new GlyphLayer()
    glyphs.setUniforms(uniforms)
    scene.add(ribbon.mesh, glyphs.mesh)
    const liveView = createLiveView(uniforms)
    const sideView = new SideView(uniforms)

    const cache = getGlyphCache()

    let unsubscribeLost: (() => void) | null = null
    let unsubscribeRestored: (() => void) | null = null

    // Rebuilds every buffer from the thread's own records -- used both for
    // the initial open and for a `webglcontextlost` recovery, so a lost
    // context is never repaired from whatever pixels happened to be on
    // screen (T-02.3-04-03).
    function applyHistory(history: StageHistory): void {
      const finiteTimes = history.letters.map((l) => l.insertedAtMs).filter((ms) => Number.isFinite(ms))
      const sessionStarts = history.sessions.map((s) => s.startMs)
      const threadStartMs =
        sessionStarts.length > 0
          ? Math.min(...sessionStarts)
          : finiteTimes.length > 0
            ? Math.min(...finiteTimes)
            : Date.now()

      ribbon.reset()
      glyphs.reset()
      const nowSeconds = secondsSince(threadStartMs, Date.now())

      // D-07/D-16: reconstruct the ribbon's historical structure from the
      // thread's own recorded sessions -- true-length gaps between them,
      // never one continuous span standing in for real history (closing a
      // Plan 04 known stub so the side view has something honest to show).
      let prevEndSeconds: number | null = null
      for (const session of history.sessions) {
        const startSeconds = secondsSince(threadStartMs, session.startMs)
        const endSeconds = Math.max(startSeconds, secondsSince(threadStartMs, session.endMs))
        if (prevEndSeconds !== null && startSeconds > prevEndSeconds) {
          ribbon.addSpan(prevEndSeconds, startSeconds, CHUNK_KIND.GAP)
        }
        ribbon.addSpan(startSeconds, endSeconds, CHUNK_KIND.SESSION)
        prevEndSeconds = Math.max(prevEndSeconds ?? endSeconds, endSeconds)
      }
      if (prevEndSeconds === null) {
        // No recorded sessions yet (a brand-new thread, or one written
        // before sessions existed): fall back to one continuous span,
        // matching this overlay's pre-existing behaviour.
        ribbon.addSpan(0, nowSeconds, CHUNK_KIND.SESSION)
      } else if (nowSeconds > prevEndSeconds) {
        // The most recently recorded session is still open, or the thread
        // has been quiet since it closed: extend a live span to "now" --
        // the tick loop's own extendLast/pause-chunk calls take over from
        // here for the currently-open session's own pause/timeout behaviour.
        ribbon.addSpan(prevEndSeconds, nowSeconds, CHUNK_KIND.SESSION)
      }

      setStageTotalCount(history.letters.length)
      let built = 0
      for (const letter of history.letters) {
        if (!Number.isFinite(letter.insertedAtMs)) continue
        const tSeconds = secondsSince(threadStartMs, letter.insertedAtMs)
        glyphs.add(rendererHandle.renderer, cache, tSeconds, letter.grapheme, { bulk: true })
        built++
      }
      glyphs.markBulkUploaded()
      cache.markPagesClean()
      setStageBuiltCount(built)
      setStageBuilding(false)

      liveView.applyFrame(history.frame)
      sideView.applyFrame(history.frame)

      const firstBreakpointSeconds = history.slowdown[0]?.afterSeconds ?? Number.POSITIVE_INFINITY
      stageRuntimeRef.current = {
        scene,
        ribbon,
        glyphs,
        liveView,
        sideView,
        uniforms,
        frame: history.frame,
        sessions: history.sessions,
        threadStartMs,
        lastActivitySeconds: nowSeconds,
        pauseOpen: false,
        firstBreakpointSeconds,
        timeoutSeconds: history.timeoutSeconds,
      }
    }

    loadStageHistory(treeId, nodeId)
      .then((history) => {
        if (!cancelled) applyHistory(history)
      })
      .catch((err: unknown) => {
        if (!cancelled) setStageError(err instanceof Error ? err.message : String(err))
      })

    rendererHandle.attach(container)
    // The stage canvas carries no independent semantics of its own -- the
    // document text in the typer above is the readable surface.
    rendererHandle.domElement.setAttribute('aria-hidden', 'true')

    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container
      rendererHandle.resize(clientWidth, clientHeight, window.devicePixelRatio)
      liveView.resize(clientWidth, clientHeight)
      sideView.resize(clientWidth, clientHeight)
    })
    resizeObserver.observe(container)
    // Prime the initial size synchronously so the first frame isn't 0x0.
    rendererHandle.resize(container.clientWidth, container.clientHeight, window.devicePixelRatio)
    liveView.resize(container.clientWidth, container.clientHeight)
    sideView.resize(container.clientWidth, container.clientHeight)

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let lastReducedMotionFrame = 0

    function renderFrame(): void {
      const stage = stageRuntimeRef.current
      if (!stage) return
      const nowMs = Date.now()
      const nowSeconds = secondsSince(stage.threadStartMs, nowMs)

      const idle = nowSeconds - stage.lastActivitySeconds
      if (idle < stage.timeoutSeconds) {
        if (idle > stage.firstBreakpointSeconds && !stage.pauseOpen) {
          stage.ribbon.addSpan(stage.lastActivitySeconds, stage.lastActivitySeconds, 2)
          stage.pauseOpen = true
        }
        stage.ribbon.extendLast(nowSeconds)
      }
      // idle >= timeoutSeconds: D-11 "the line stops until typing resumes" --
      // simply stop extending; the next keystroke (handleLocalInsert) opens
      // a fresh chunk regardless of how the previous one ended.

      // The live and side cameras share one uniforms object (StageUniforms):
      // liveView.tick() recenters the floating origin on "now" every frame,
      // which would immediately undo whatever the side view's own setView()
      // last set. So the live camera's tick only runs while it is actually
      // the one being drawn; the side view's own uniforms are only touched
      // by its own setView()/resize() calls, never per frame.
      if (viewRef.current === 'live') {
        stage.liveView.tick(nowSeconds)
      }
      stage.glyphs.syncAtlasTextures(cache)
      const camera = viewRef.current === 'side' ? stage.sideView.camera : stage.liveView.camera
      rendererHandle.renderer.render(stage.scene, camera)
      clearPendingFullUpload()
    }

    if (reducedMotion) {
      // UI-SPEC "Motion and prefers-reduced-motion": no per-frame streaming;
      // redraw on a letter landing (handleLocalInsert calls addSpan/add
      // directly on the buffers, so the *next* scheduled redraw below picks
      // it up) and at most 4 times a second while idle.
      const interval = setInterval(renderFrame, 250)
      lastReducedMotionFrame = interval as unknown as number
      rendererHandle.setAnimationLoop(null)
    } else {
      rendererHandle.setAnimationLoop(renderFrame)
    }

    unsubscribeLost = rendererHandle.onContextLost(() => {
      setStageError('The thread view lost its graphics connection.')
    })
    unsubscribeRestored = rendererHandle.onContextRestored(() => {
      setStageError(null)
      setStageBuilding(true)
      loadStageHistory(treeId, nodeId)
        .then((history) => {
          if (!cancelled) applyHistory(history)
        })
        .catch((err: unknown) => {
          if (!cancelled) setStageError(err instanceof Error ? err.message : String(err))
        })
    })

    return () => {
      cancelled = true
      resizeObserver.disconnect()
      if (reducedMotion) clearInterval(lastReducedMotionFrame)
      rendererHandle.setAnimationLoop(null)
      rendererHandle.detach()
      unsubscribeLost?.()
      unsubscribeRestored?.()
      stageRuntimeRef.current = null
      scene.remove(ribbon.mesh, glyphs.mesh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeId, nodeId])

  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'not-saved' ? 'Not saved' : 'Saved'

  const stageStatus = useMemo(() => {
    if (stageBuilding && stageTotalCount > 0) {
      return `Drawing the line (${stageBuiltCount} of ${stageTotalCount} letters)`
    }
    return null
  }, [stageBuilding, stageBuiltCount, stageTotalCount])

  return (
    <div style={styles.overlay}>
      {/* D-09: the canvas dims behind the overlay -- the 97% overlay
          surface, never fully opaque (the 3% keeps the canvas faintly
          perceptible per UI-SPEC "Overlay backdrop"), and non-interactive
          while the overlay is open. */}
      <div style={styles.scrim} onClick={handleClose} />

      <div style={styles.panel} role="dialog" aria-label={title || 'Untitled thread'}>
        <header style={styles.header}>
          <span style={styles.title}>{title || 'Untitled thread'}</span>

          {showStatus && ready === null && (
            <span style={styles.statusLabel}>{`Catching up (${totalChanges} of ${totalChanges} changes)`}</span>
          )}

          {ready !== null && <span style={styles.statusLabel}>{saveLabel}</span>}

          {/* D-09/D-15: "Read the thread back" in the live view, "Return to
              now" in the side view (UI-SPEC "Thread overlay header"). */}
          <button
            type="button"
            onClick={handleToggleView}
            disabled={ready === null}
            style={styles.closeButton}
          >
            {view === 'live' ? 'Read the thread back' : 'Return to now'}
          </button>

          <button
            type="button"
            aria-label="Thread settings"
            title="Thread settings"
            onClick={(e) => setSettingsAnchor({ x: e.clientX, y: e.clientY })}
            style={styles.closeButton}
          >
            ⚙
          </button>

          <button type="button" onClick={handleClose} style={styles.closeButton}>
            Close thread view
          </button>
        </header>

        {settingsAnchor && (
          <ThreadSettingsPopover
            treeId={treeId}
            nodeId={nodeId}
            x={settingsAnchor.x}
            y={settingsAnchor.y}
            onClose={() => setSettingsAnchor(null)}
          />
        )}

        {openError && <div style={styles.error}>Couldn't finish reading this thread's history — {openError}</div>}

        <div ref={editorRef} style={styles.typer} />

        {showStatus && ready === null && !openError && (
          <div style={styles.underTyperLine}>
            This is the last saved text. Writing starts when the history has finished loading.
          </div>
        )}

        {notSavedReason && <div style={styles.error}>Not saved — {notSavedReason}</div>}

        {/* D-09 stage area: paper with the ribbon and glyphs, or the
            no-WebGL / context-lost fallback (UI-SPEC "No-stage fallback"). */}
        <div ref={stageContainerRef} style={styles.stage}>
          {stageAvailable === false && <StageFallbackPanel treeId={treeId} nodeId={nodeId} />}
          {stageAvailable !== false && stageError && (
            <StageFallbackPanel reason={stageError} treeId={treeId} nodeId={nodeId} />
          )}
          {stageAvailable !== false && !stageError && stageStatus && (
            <div style={styles.stageStatus} aria-hidden="false">
              {stageStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout (UI-SPEC "Live writing view"): typer 48px from the top, centred,
// max 688px wide, at most 44% of window height; the stage fills everything
// below with 24px between them.
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  scrim: {
    position: 'absolute',
    inset: 0,
    // UI-SPEC "Overlay backdrop": --tap-paper at 97% opacity -- the canvas
    // stays faintly perceptible rather than a dark scrim (a dark scrim
    // would push half the author palette under AA, and glyphs are drawn
    // near-white against paper, not against black).
    background: 'var(--tap-paper, #F7F5F0)',
    opacity: 0.97,
  },
  panel: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 48,
    width: 'min(688px, 92vw)',
    alignSelf: 'center',
    padding: '0 4px 8px',
  },
  title: {
    fontWeight: 600,
    fontSize: 18,
    flex: 1,
    color: 'var(--tap-ink, #2C2C2C)',
  },
  statusLabel: {
    fontSize: 13,
    color: 'var(--tap-muted, #6B6B6B)',
  },
  closeButton: {
    fontSize: 13,
    border: '1px solid var(--tap-border, #E0DDD7)',
    borderRadius: 6,
    background: 'transparent',
    padding: '4px 10px',
    cursor: 'pointer',
  },
  typer: {
    flex: '0 1 auto',
    maxHeight: '44vh',
    minHeight: 160,
    width: 'min(688px, 92vw)',
    alignSelf: 'center',
    overflowY: 'auto',
    padding: '12px 16px',
    fontSize: 16,
    lineHeight: 1.5,
    background: 'var(--tap-surface, #FFFFFF)',
    borderRadius: 12,
  },
  underTyperLine: {
    width: 'min(688px, 92vw)',
    alignSelf: 'center',
    padding: '4px 16px 0',
    fontSize: 13,
    color: 'var(--tap-muted, #6B6B6B)',
  },
  error: {
    width: 'min(688px, 92vw)',
    alignSelf: 'center',
    padding: '4px 16px 0',
    fontSize: 13,
    color: 'var(--tap-destructive-text, #B4232A)',
  },
  stage: {
    position: 'relative',
    flex: 1,
    width: '100%',
    marginTop: 24,
    background: 'var(--tap-paper, #F7F5F0)',
    overflow: 'hidden',
  },
  stageStatus: {
    position: 'absolute',
    left: '50%',
    top: '38%',
    transform: 'translate(-50%, -50%)',
    fontSize: 13,
    color: 'var(--tap-muted, #6B6B6B)',
    pointerEvents: 'none',
  },
}
