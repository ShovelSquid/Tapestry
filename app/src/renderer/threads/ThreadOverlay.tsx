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
import { GlyphLayer, GlyphUnderlayLayer } from './stage/glyphs'
import { getGlyphCache } from './stage/glyph-cache'
import { createLiveView, type LiveViewHandle } from './stage/live-view'
import { SideView, SIDE_ZOOM_DURATION_FACTOR, centerForZoomAroundScreenX, clampSpanSeconds } from './stage/side-view'
import { stepMarker, markerLabel } from './stage/markers'
import { getStageRenderer, isWebglAvailable } from './stage/renderer'
import { readAuthorPalette, readStageTokens } from './stage/tokens'
import { StrandLayer, deriveAuthorSpans, separationChipText, SEPARATION_BOOST_MAX_PX } from './stage/strands'
import { loadSessions, formatDuration, useSessions } from './SessionBridge'
import DateScrubber from './DateScrubber'
import { NAV_KEYS, dayIndexOf, dayStartMs, flyTo, gravityStep, zoomStep, type NavAction } from './navigation'
import DocAtTimeView, { BRANCHING_NOTICE } from './DocAtTimeView'
import AuthorsLegend, { type AuthorLegendRow } from './AuthorsLegend'
import AuthorChip from './AuthorChip'
import { authorPaletteIndex, orderAgentsByConnection } from './author-palette'
import { parseThreadFrame, parseThreadSettings, type ThreadFrame, type ThreadNodeProps } from '../../shared/threads/settings'
import { parseSlowdown, type SlowdownCurve } from '../../shared/threads/slowdown'
import { createDocAtCache, docAt, type DocAtCache, type ReplayResult, type ThreadCommitEntry, type ThreadLetter } from '../../shared/threads/replay'
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
    // D-21: the commit's own actor id travels with its log entry, so
    // replay.ts's docAt/replayTo can attribute every letter it mints to
    // who actually wrote it -- read straight off the record, never a claim
    // a writer could make about itself.
    ...logEntries.map((e) => ({
      seq: e.seq,
      entry: { kind: 'log' as const, value: String(e.value.value), actor: e.actor.id },
    })),
    ...bodyEntries.map((e) => ({ seq: e.seq, entry: { kind: 'checkpoint' as const, value: String(e.value.value) } })),
  ]
  tagged.sort((a, b) => a.seq - b.seq)
  return tagged.map((t) => t.entry)
}

interface StageHistory {
  frame: ThreadFrame
  slowdown: SlowdownCurve
  timeoutSeconds: number
  /** Live (non-deleted) letters, in the order `docAt` returned them
   * (insertion order, not document order -- fine for the stage, since a
   * glyph's screen position comes from its own `insertedAtMs`, never from
   * reading order). */
  letters: ThreadLetter[]
  /** Live letter ids in **document order** (`ReplayResult.liveOrder`): the
   * order `use-thread-editor.ts` needs to seed its own `LetterIndex`
   * correctly, since that seeding inserts each letter sequentially at an
   * increasing position to reconstruct the flat document. */
  liveOrder: number[]
  /** Every letter this replay ever saw, live or deleted (D-21): the source
   * `deriveAuthorSpans` reads for the strand layer -- a deleted letter still
   * represents real writing activity at the moment it happened. */
  allLetters: ThreadLetter[]
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
  const { letters, liveOrder } = docAt(commits, Date.now())
  return {
    frame,
    slowdown: parseSlowdown(settings.slowdown),
    timeoutSeconds: settings.timeout,
    letters: letters.filter((l) => l.deletedAtMs === null),
    liveOrder,
    allLetters: letters,
    sessions,
  }
}

// ---------------------------------------------------------------------------
// Authors legend data (D-21, D-22, TA-07): agent connection order, live
// per-actor letter counts, and this session's refusal counts.
// ---------------------------------------------------------------------------

async function loadAuthorData(
  treeId: string,
  nodeId: string,
  liveLetters: readonly ThreadLetter[],
): Promise<{ orderedAgentNames: string[]; rows: AuthorLegendRow[] }> {
  const [agents, refusedCounts] = await Promise.all([
    window.tapestry.agents.list(),
    window.tapestry.thread.getRefusedCounts(treeId, nodeId),
  ])
  const orderedAgentNames = orderAgentsByConnection(agents)

  const letterCounts = new Map<string, number>()
  for (const letter of liveLetters) {
    letterCounts.set(letter.actor, (letterCounts.get(letter.actor) ?? 0) + 1)
  }

  // Every actor with either a letter or a refusal gets a row -- an agent
  // that has only ever been refused (never actually landed a letter) still
  // needs to be visible, since the refusal is the one thing TA-07 promises
  // is never silent.
  const actorIds = new Set<string>([...letterCounts.keys(), ...Object.keys(refusedCounts)])
  const rows: AuthorLegendRow[] = [...actorIds].map((actorId) => ({
    actorId,
    letterCount: letterCounts.get(actorId) ?? 0,
    refusedCount: refusedCounts[actorId] ?? 0,
  }))

  // Self first, then agents in connection order, then anything unrecognized.
  rows.sort((a, b) => {
    const rank = (id: string): number => {
      if (id.startsWith('user.')) return -1
      const agentIndex = orderedAgentNames.indexOf(id.replace(/^agent\./, ''))
      return id.startsWith('agent.') && agentIndex !== -1 ? agentIndex : orderedAgentNames.length
    }
    return rank(a.actorId) - rank(b.actorId)
  })

  return { orderedAgentNames, rows }
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
  underlay: GlyphUnderlayLayer
  strands: StrandLayer
  /** D-21: agent names in first-connected order (`agents:list`'s own
   * `createdAt`), the ordering `author-palette.ts` assigns colour/pattern
   * slots by. Read once per stage build; a mid-session new connection
   * appears on this thread's next open, not live (a documented, honest
   * simplification -- matching the rest of this file's "records, not
   * screens" rebuild discipline). */
  orderedAgentNames: string[]
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

  // D-23/L-2 (Task 3): the drag-apart / `A`-key display transform. Pure
  // render state -- strands.ts itself carries no commit path, so none of
  // this can ever reach the document no matter how it is driven.
  /** Latched by the `A` key (or held while actively dragging); the target
   * `renderFrame` eases `separationCurrentPx` toward every frame. */
  separationTargetPx: number
  /** The actual boost applied to `StrandLayer` this frame -- eases toward
   * `separationTargetPx` (240ms-ish) unless reduced motion is active, in
   * which case it jumps straight to the target (UI-SPEC "release snaps
   * instead of springing"). */
  separationCurrentPx: number
  /** True only while a drag gesture (not the `A` latch) is actively pulling
   * the strands apart -- on release, the target returns to whatever the `A`
   * latch alone would call for. */
  separationDragActive: boolean
  /** `A` toggles this; independent of a drag, so releasing a drag while
   * latched leaves the strands apart. */
  separationLatched: boolean
}

function secondsSince(startMs: number, atMs: number): number {
  return (atMs - startMs) / 1000
}

/** UI-SPEC "Gap and scrubber honesty": "an Ink bar whose height is that
 * day's letters relative to the busiest day." Buckets each session's own
 * letter count into the UTC day its `startMs` falls on -- a session
 * spanning midnight is counted on its start day only, a documented
 * simplification (this bar is a navigational aid, not a byte-exact ledger). */
function dailyLetterCountsFromSessions(sessions: readonly DerivedSession[], firstDateMs: number): number[] {
  if (sessions.length === 0) return []
  const firstDay = dayStartMs(firstDateMs)
  const counts: number[] = []
  for (const session of sessions) {
    const index = dayIndexOf(session.startMs, firstDay)
    if (index < 0) continue
    counts[index] = (counts[index] ?? 0) + session.letterCount
  }
  return counts
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

  // Side-view navigation state (D-17, Task 2): `sideSnapshot` mirrors the
  // SideView's own centre/span in absolute ms, throttled rather than synced
  // every animation frame, purely so the DateScrubber's accent bracket and
  // the polite zoom announcement have something to render from -- the
  // camera itself is never driven by React state (that stays 100% on
  // `stageRuntimeRef.current.sideView`, read every frame in `renderFrame`).
  const [sideSnapshot, setSideSnapshot] = useState<{ centerMs: number; spanMs: number } | null>(null)
  const [focusedSessionIndex, setFocusedSessionIndex] = useState<number | null>(null)
  const [focusedMarkerIndex, setFocusedMarkerIndex] = useState(-1)
  const [announcement, setAnnouncement] = useState('')
  const sessions = useSessions(treeId, nodeId)

  // D-21 (Task 2): the Authors legend and the stage's per-letter colouring
  // both read this same author-row data, refreshed on open and again
  // whenever a refusal might have landed (an agent write always resolves
  // to a confirmed commit or a refusal, never silence).
  const [authorRows, setAuthorRows] = useState<AuthorLegendRow[]>([])
  const [showAuthorsLegend, setShowAuthorsLegend] = useState(false)
  // D-21: the typer's own underlay/caret-readout hook needs this actor's
  // literal id, the agents' connection order, and the thread's live letters
  // at open, all as plain render-time values (not read from a ref, since
  // useThreadEditor consumes them as ordinary hook arguments).
  const [selfActorId, setSelfActorId] = useState('user.unknown')
  const [typerOrderedAgentNames, setTyperOrderedAgentNames] = useState<string[]>([])
  const [initialLiveLetters, setInitialLiveLetters] = useState<Array<{ grapheme: string; actor: string }>>([])

  // D-23/L-2: "Showing agent.[name] on its own. The document hasn't
  // changed." -- visible while the strands are pulled apart, by drag or the
  // `A` key alike.
  const [separationChip, setSeparationChip] = useState<string | null>(null)
  const separationDragStartYRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    window.tapestry.settings
      .getUserName()
      .then(({ userName }) => {
        if (!cancelled && userName) setSelfActorId(`user.${userName}`)
      })
      .catch((err: unknown) => console.error('[ThreadOverlay] getUserName failed:', err))
    return () => {
      cancelled = true
    }
  }, [])

  const dragRef = useRef<{ x: number } | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const lastPointerSampleRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const pointerSpeedRef = useRef(0)
  const lastWheelOrDragAtRef = useRef(-Infinity)
  const lastGravityFrameAtRef = useRef(0)
  const lastSideSnapshotAtRef = useRef(0)
  const lastZoomAnnounceAtRef = useRef(0)
  const flyToCancelRef = useRef<(() => void) | null>(null)
  /** Click vs. drag on the stage: set on pointerdown, compared against
   * pointerup's own position -- a small movement is a click (open the
   * moment under it), a larger one was already handled as a pan. */
  const clickCandidateRef = useRef<{ x: number; y: number } | null>(null)

  // D-08/D-18: the read-only past stage. `pastMomentReplay` is only ever
  // overwritten once a fresh `docAt` result is ready -- while a lookup is
  // in flight the previously shown stage stays exactly as it was (UI-SPEC
  // "Loading and catch-up" rule 5: "the text never blanks or flickers").
  const [pastMomentMs, setPastMomentMs] = useState<number | null>(null)
  const [pastMomentReplay, setPastMomentReplay] = useState<ReplayResult | null>(null)
  const [findingSlow, setFindingSlow] = useState(false)
  const [writeNotice, setWriteNotice] = useState<string | null>(null)
  const docAtCacheRef = useRef<DocAtCache | null>(null)
  const momentRequestIdRef = useRef(0)
  const momentRafRef = useRef<number | null>(null)
  const latestMomentAtMsRef = useRef<number | null>(null)
  const writeNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      // D-18: a new commit landed, so any doc-at-T cache built from the
      // commits fetched before it is now stale -- drop it; the next
      // openMomentAt call rebuilds it from a fresh fetch.
      docAtCacheRef.current = null
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

    // Author index 0 (self) is correct for the person's own local typing,
    // which is what `dispatchTransaction` mostly calls this for. A step
    // that arrived by `receiveTransaction` (a rebased agent write landing
    // while this exact view is open) currently also draws as author 0 --
    // a documented Known Stub: the real-time steps broadcast that would let
    // this callback know it was actually an agent's step does not exist yet
    // (thread-ipc.ts only broadcasts `thread:confirmed`/`thread:flush-error`,
    // never a steps payload). Reopening the thread always attributes every
    // letter correctly, from the authoritative replay (`applyHistory`
    // above), which is the reliable path this stub does not affect.
    for (const grapheme of Array.from(text)) {
      stage.glyphs.add(renderer.renderer, cache, tSeconds, grapheme, { actor: 0 })
    }
  }, [])

  const { editorRef, captionText, hoveredAuthor } = useThreadEditor({
    nodeId,
    checkpointBody,
    ready,
    onPush: handlePush,
    onLocalInsert: handleLocalInsert,
    selfActorId,
    orderedAgentNames: typerOrderedAgentNames,
    initialLiveLetters,
  })

  // -------------------------------------------------------------------
  // "Read the thread back" / "Return to now" (D-09, D-15): switches which
  // camera renderFrame draws, and frames the side view on the whole thread
  // the first time it opens in a given session (spike 001's own
  // `state.sideCenter = t0/2; state.sideSeconds = max(60, t0*1.05)`,
  // generalized to this plan's 1.1x duration factor).
  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // "Return to now" (D-09, D-15, D-18): the one handler both the header's
  // side-view toggle and a past stage's own "Return to now" call --
  // UI-SPEC's side-view table describes leaving a past stage as returning
  // "to the live document", exactly what leaving the side view itself does,
  // so there is only one real action here, not two.
  // -------------------------------------------------------------------
  const handleReturnToNow = useCallback(() => {
    viewRef.current = 'live'
    setViewState('live')
    setFocusedSessionIndex(null)
    setFocusedMarkerIndex(-1)
    momentRequestIdRef.current += 1 // invalidate any in-flight doc-at-T lookup
    if (momentRafRef.current !== null) {
      cancelAnimationFrame(momentRafRef.current)
      momentRafRef.current = null
    }
    setPastMomentMs((was) => {
      if (was !== null) setAnnouncement('Back to now. You can write again.')
      return null
    })
    setPastMomentReplay(null)
    setFindingSlow(false)
  }, [])

  const handleToggleView = useCallback(() => {
    if (viewRef.current === 'side') {
      handleReturnToNow()
      return
    }
    const stage = stageRuntimeRef.current
    if (!stage) return
    const nowSeconds = secondsSince(stage.threadStartMs, Date.now())
    const initialSpan = Math.max(60, nowSeconds * SIDE_ZOOM_DURATION_FACTOR)
    stage.sideView.setView(nowSeconds / 2, initialSpan, nowSeconds)
    viewRef.current = 'side'
    setViewState('side')
    setSideSnapshot({ centerMs: stage.threadStartMs + (nowSeconds / 2) * 1000, spanMs: initialSpan * 1000 })
  }, [handleReturnToNow])

  // -------------------------------------------------------------------
  // D-18: the document at any moment, read-only. `ensureDocAtCache` fetches
  // the thread's full commit history once per open (cached in
  // `docAtCacheRef`, invalidated whenever a new commit lands); `openMomentAt`
  // throttles the actual replay to at most one per animation frame no
  // matter how many times a drag or scrub calls it within that frame
  // (`latestMomentAtMsRef` always holds the most recent request, so a
  // frame that fires after several calls replays only the last one).
  // -------------------------------------------------------------------
  const ensureDocAtCache = useCallback(async (): Promise<DocAtCache> => {
    if (docAtCacheRef.current) return docAtCacheRef.current
    const commits = await loadThreadCommits(treeId, nodeId)
    const cache = createDocAtCache(commits)
    docAtCacheRef.current = cache
    return cache
  }, [treeId, nodeId])

  const computeMoment = useCallback(
    async (atMs: number) => {
      const requestId = ++momentRequestIdRef.current
      const findingTimer = setTimeout(() => {
        if (momentRequestIdRef.current === requestId) setFindingSlow(true)
      }, STATUS_DELAY_MS)
      try {
        const cache = await ensureDocAtCache()
        if (momentRequestIdRef.current !== requestId) return // superseded while awaiting
        const result = cache.docAt(atMs)
        if (momentRequestIdRef.current === requestId) {
          setPastMomentReplay(result)
          setFindingSlow(false)
        }
      } catch (err: unknown) {
        console.error('[ThreadOverlay] doc-at-time lookup failed:', err)
      } finally {
        clearTimeout(findingTimer)
      }
    },
    [ensureDocAtCache],
  )

  const openMomentAt = useCallback(
    (atMs: number) => {
      setPastMomentMs((was) => {
        if (was === null) {
          setAnnouncement(
            `Showing the document as it was on ${new Date(atMs).toLocaleDateString()} at ${new Date(atMs).toLocaleTimeString()}. Read-only.`,
          )
        }
        return atMs
      })
      latestMomentAtMsRef.current = atMs
      if (momentRafRef.current !== null) return
      momentRafRef.current = requestAnimationFrame(() => {
        momentRafRef.current = null
        const latest = latestMomentAtMsRef.current
        if (latest !== null) void computeMoment(latest)
      })
    },
    [computeMoment],
  )

  const handlePastStageWriteAttempt = useCallback(() => {
    setWriteNotice(BRANCHING_NOTICE)
    if (writeNoticeTimerRef.current) clearTimeout(writeNoticeTimerRef.current)
    writeNoticeTimerRef.current = setTimeout(() => setWriteNotice(null), 6000)
  }, [])

  // -------------------------------------------------------------------
  // Side-view navigation (D-17, Task 2): fly-to, wheel/drag pan+zoom, the
  // keyboard map, and hover gravity. All of it reads/writes the SideView
  // instance directly through `stageRuntimeRef` -- React state below exists
  // only for what must actually re-render (the scrubber, announcements,
  // focus rings), never to drive the camera itself.
  // -------------------------------------------------------------------

  const syncSideSnapshot = useCallback(() => {
    const stage = stageRuntimeRef.current
    if (!stage) return
    setSideSnapshot({
      centerMs: stage.threadStartMs + stage.sideView.centerSeconds * 1000,
      spanMs: stage.sideView.spanSeconds * 1000,
    })
  }, [])

  const announceZoomThrottled = useCallback((spanSeconds: number) => {
    const now = performance.now()
    if (now - lastZoomAnnounceAtRef.current < 500) return
    lastZoomAnnounceAtRef.current = now
    setAnnouncement(`Showing ${formatDuration(spanSeconds * 1000)} across the view`)
  }, [])

  const flyToSession = useCallback(
    (session: DerivedSession, reducedMotion: boolean) => {
      const stage = stageRuntimeRef.current
      if (!stage) return
      flyToCancelRef.current?.()
      const durationSeconds = secondsSince(stage.threadStartMs, Date.now())
      const targetSeconds = secondsSince(stage.threadStartMs, session.startMs)
      const targetSpan = clampSpanSeconds(60, durationSeconds)
      const from = { centerSeconds: stage.sideView.centerSeconds, spanSeconds: stage.sideView.spanSeconds }
      const to = { centerSeconds: targetSeconds, spanSeconds: targetSpan }
      flyToCancelRef.current = flyTo(
        from,
        to,
        (v) => {
          stage.sideView.setView(v.centerSeconds, v.spanSeconds, durationSeconds)
          syncSideSnapshot()
        },
        () => {
          const when = new Date(session.startMs)
          setAnnouncement(
            `Session ${session.index}, ${when.toLocaleDateString()} ${when.toLocaleTimeString()}, ${session.letterCount} letters, by ${session.authors.join(', ')}`,
          )
        },
        { reducedMotion },
      )
    },
    [syncSideSnapshot],
  )

  const handleStageWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const stage = stageRuntimeRef.current
      if (!stage || viewRef.current !== 'side') return
      e.preventDefault()
      lastWheelOrDragAtRef.current = performance.now()
      const rect = e.currentTarget.getBoundingClientRect()
      const pointerX = e.clientX - rect.left
      const durationSeconds = secondsSince(stage.threadStartMs, Date.now())
      const atSeconds = stage.sideView.screenXToTime(pointerX)
      // spike 001's own wheel-to-zoom curve (thread.js:778): exponential in
      // deltaY, so a fast fling zooms further than a slow nudge.
      const zoomFactor = Math.exp(e.deltaY * 0.002)
      const newSpan = clampSpanSeconds(stage.sideView.spanSeconds * zoomFactor, durationSeconds)
      const newCenter = centerForZoomAroundScreenX(pointerX, rect.width, atSeconds, newSpan)
      stage.sideView.setView(newCenter, newSpan, durationSeconds)
      syncSideSnapshot()
      announceZoomThrottled(newSpan)
    },
    [announceZoomThrottled, syncSideSnapshot],
  )

  const handleStagePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (viewRef.current !== 'side') return
    dragRef.current = { x: e.clientX }
    // D-23/L-2: every drag's vertical component is a candidate strand
    // separation, independent of the existing horizontal pan above -- a
    // diagonal drag can do both, which is the honest reading of an
    // inherently ambiguous gesture.
    separationDragStartYRef.current = e.clientY
    clickCandidateRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const handleStagePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const stage = stageRuntimeRef.current
      if (!stage) return
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const nowPerf = performance.now()
      const last = lastPointerSampleRef.current
      if (last) {
        const dt = (nowPerf - last.t) / 1000
        if (dt > 0) pointerSpeedRef.current = Math.hypot(x - last.x, y - last.y) / dt
      }
      lastPointerSampleRef.current = { x, y, t: nowPerf }
      pointerRef.current = { x, y }

      if (viewRef.current === 'side' && dragRef.current && e.buttons === 1) {
        lastWheelOrDragAtRef.current = nowPerf
        const dx = e.clientX - dragRef.current.x
        dragRef.current = { x: e.clientX }
        const durationSeconds = secondsSince(stage.threadStartMs, Date.now())
        const newCenter = stage.sideView.panByPixels(dx)
        stage.sideView.setView(newCenter, stage.sideView.spanSeconds, durationSeconds)
        syncSideSnapshot()
      }

      // D-23/L-2: dragging a strand perpendicular to the line separates the
      // strands, up to 120px (UI-SPEC "Spacing"). No commit path exists
      // anywhere in this gesture -- it only ever calls
      // `StrandLayer.setSeparationBoost`, a per-frame uniform write.
      if (
        viewRef.current === 'side' &&
        separationDragStartYRef.current !== null &&
        e.buttons === 1 &&
        stage.strands.chunkCount > 0
      ) {
        const dy = Math.abs(e.clientY - separationDragStartYRef.current)
        stage.separationDragActive = dy > 2
        stage.separationTargetPx = stage.separationLatched
          ? SEPARATION_BOOST_MAX_PX
          : Math.min(SEPARATION_BOOST_MAX_PX, dy)
        if (stage.separationDragActive && !separationChip) {
          const firstAgent = stage.orderedAgentNames[0]
          if (firstAgent) setSeparationChip(separationChipText(firstAgent))
        }
      }
    },
    [separationChip, syncSideSnapshot],
  )

  // D-18: "click any point on the line opens the document at that moment."
  // A pointerup within a small radius of its own pointerdown (never moved
  // enough to count as a pan) is a click; anything further was already
  // handled as a drag by handleStagePointerMove.
  const CLICK_MOVEMENT_THRESHOLD_PX = 5

  /** D-23/L-2: releasing a drag springs the strands back over ~240ms unless
   * the `A` key has latched them apart, in which case they stay apart --
   * `renderFrame`'s own easing (or an instant snap under reduced motion) is
   * what actually moves `separationCurrentPx`; this only sets the target. */
  const endSeparationDrag = useCallback(() => {
    separationDragStartYRef.current = null
    const stage = stageRuntimeRef.current
    if (!stage || !stage.separationDragActive) return
    stage.separationDragActive = false
    stage.separationTargetPx = stage.separationLatched ? SEPARATION_BOOST_MAX_PX : 0
    if (!stage.separationLatched) setSeparationChip(null)
  }, [])

  const handleStagePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const stage = stageRuntimeRef.current
      const candidate = clickCandidateRef.current
      dragRef.current = null
      clickCandidateRef.current = null
      endSeparationDrag()
      if (!stage || viewRef.current !== 'side' || !candidate) return
      const movedPx = Math.hypot(e.clientX - candidate.x, e.clientY - candidate.y)
      if (movedPx > CLICK_MOVEMENT_THRESHOLD_PX) return
      const rect = e.currentTarget.getBoundingClientRect()
      const atSeconds = stage.sideView.screenXToTime(e.clientX - rect.left)
      openMomentAt(stage.threadStartMs + atSeconds * 1000)
    },
    [endSeparationDrag, openMomentAt],
  )

  const handleStagePointerLeave = useCallback(() => {
    pointerRef.current = null
    dragRef.current = null
    endSeparationDrag()
  }, [endSeparationDrag])

  const handleScrub = useCallback(
    (centerMs: number) => {
      const stage = stageRuntimeRef.current
      if (!stage) return
      lastWheelOrDragAtRef.current = performance.now()
      const durationSeconds = secondsSince(stage.threadStartMs, Date.now())
      const centerSeconds = secondsSince(stage.threadStartMs, centerMs)
      stage.sideView.setView(centerSeconds, stage.sideView.spanSeconds, durationSeconds)
      syncSideSnapshot()
    },
    [syncSideSnapshot],
  )

  const handleStageKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const stage = stageRuntimeRef.current
      if (!stage || viewRef.current !== 'side') return
      const action: NavAction | undefined = NAV_KEYS[e.key]
      if (!action) return
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      const durationSeconds = secondsSince(stage.threadStartMs, Date.now())

      switch (action) {
        case 'return-to-now': {
          e.preventDefault()
          handleReturnToNow()
          return
        }
        case 'prev-session':
        case 'next-session': {
          e.preventDefault()
          if (stage.sessions.length === 0) return
          const direction = action === 'next-session' ? 1 : -1
          const nextIndex =
            focusedSessionIndex === null
              ? direction > 0
                ? 0
                : stage.sessions.length - 1
              : Math.min(stage.sessions.length - 1, Math.max(0, focusedSessionIndex + direction))
          setFocusedSessionIndex(nextIndex)
          flyToSession(stage.sessions[nextIndex], reducedMotion)
          return
        }
        case 'prev-marker':
        case 'next-marker': {
          e.preventDefault()
          const allMarkers = stage.sessions.flatMap((s) => s.markers)
          if (allMarkers.length === 0) return
          const direction = action === 'next-marker' ? 1 : -1
          const nextIndex = stepMarker(allMarkers, focusedMarkerIndex, direction)
          setFocusedMarkerIndex(nextIndex)
          setAnnouncement(markerLabel(allMarkers[nextIndex]))
          return
        }
        case 'zoom-in':
        case 'zoom-out': {
          e.preventDefault()
          const direction = action === 'zoom-in' ? -1 : 1
          const newSpan = zoomStep(stage.sideView.spanSeconds, direction, durationSeconds)
          stage.sideView.setView(stage.sideView.centerSeconds, newSpan, durationSeconds)
          syncSideSnapshot()
          announceZoomThrottled(newSpan)
          return
        }
        case 'pan-left':
        case 'pan-right': {
          e.preventDefault()
          const fraction = e.shiftKey ? 1 : 0.1
          const delta = stage.sideView.spanSeconds * fraction * (action === 'pan-right' ? 1 : -1)
          stage.sideView.setView(stage.sideView.centerSeconds + delta, stage.sideView.spanSeconds, durationSeconds)
          syncSideSnapshot()
          return
        }
        case 'home': {
          e.preventDefault()
          stage.sideView.setView(0, stage.sideView.spanSeconds, durationSeconds)
          syncSideSnapshot()
          return
        }
        case 'end': {
          e.preventDefault()
          stage.sideView.setView(durationSeconds, stage.sideView.spanSeconds, durationSeconds)
          syncSideSnapshot()
          return
        }
        case 'open-focused': {
          // D-18: "Enter on a focused point or session: the same as
          // clicking it." A focused marker is the more specific fact when
          // both exist (the marker itself is a specific moment on the
          // line); otherwise fall back to the focused session's own start.
          e.preventDefault()
          const allMarkers = stage.sessions.flatMap((s) => s.markers)
          if (focusedMarkerIndex >= 0 && focusedMarkerIndex < allMarkers.length) {
            openMomentAt(allMarkers[focusedMarkerIndex].atMs)
          } else if (focusedSessionIndex !== null && focusedSessionIndex < stage.sessions.length) {
            openMomentAt(stage.sessions[focusedSessionIndex].startMs)
          }
          return
        }
        case 'toggle-separate-authors': {
          // D-23/L-2: the keyboard equal of the drag -- a drag-only action
          // would fail DRAW-04. Latching is independent of any drag in
          // progress, so releasing a drag while latched leaves the strands
          // apart.
          e.preventDefault()
          if (stage.strands.chunkCount === 0) return // nothing to separate: no agent has written here
          stage.separationLatched = !stage.separationLatched
          stage.separationTargetPx = stage.separationLatched || stage.separationDragActive ? SEPARATION_BOOST_MAX_PX : 0
          const firstAgent = stage.orderedAgentNames[0]
          setSeparationChip(
            stage.separationLatched && firstAgent ? separationChipText(firstAgent) : null,
          )
          setAnnouncement(
            stage.separationLatched
              ? 'Showing each author on its own line.'
              : 'Twisting the authors back together.',
          )
          return
        }
        default:
          return
      }
    },
    [announceZoomThrottled, flyToSession, focusedMarkerIndex, focusedSessionIndex, handleReturnToNow, openMomentAt, syncSideSnapshot],
  )

  const handleClose = useCallback(() => {
    window.tapestry.thread
      .close(treeId, nodeId)
      .catch((err: unknown) => console.error('[ThreadOverlay] close failed:', err))
      .finally(onClose)
  }, [treeId, nodeId, onClose])

  // Cleans up the doc-at-T rAF throttle and the branching-notice timer on
  // unmount -- neither has any other owner.
  useEffect(() => {
    return () => {
      if (momentRafRef.current !== null) cancelAnimationFrame(momentRafRef.current)
      if (writeNoticeTimerRef.current) clearTimeout(writeNoticeTimerRef.current)
    }
  }, [])

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
    const authorColors = readAuthorPalette().map((c) => new THREE.Vector3(c.r, c.g, c.b))
    const ribbon = new Ribbon()
    ribbon.setUniforms(uniforms)
    const strands = new StrandLayer()
    strands.setUniforms(uniforms, authorColors)
    const glyphs = new GlyphLayer()
    glyphs.setUniforms(uniforms)
    // D-21: the underlay band draws *behind* the glyph, never over it
    // (UI-SPEC "Two colour channels") -- scene order plus depthTest:false on
    // both materials makes that a painter's-order guarantee, not a shader
    // trick. Strands sit below both: they read as the line's own geometry,
    // never as a wash on top of the letters.
    const underlay = new GlyphUnderlayLayer(glyphs)
    underlay.setUniforms(uniforms, authorColors)
    scene.add(ribbon.mesh, strands.mesh, underlay.mesh, glyphs.mesh)
    const liveView = createLiveView(uniforms)
    const sideView = new SideView(uniforms)

    const cache = getGlyphCache()

    let unsubscribeLost: (() => void) | null = null
    let unsubscribeRestored: (() => void) | null = null

    // Rebuilds every buffer from the thread's own records -- used both for
    // the initial open and for a `webglcontextlost` recovery, so a lost
    // context is never repaired from whatever pixels happened to be on
    // screen (T-02.3-04-03).
    function applyHistory(history: StageHistory, orderedAgentNames: string[]): void {
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
        const actorIndex = authorPaletteIndex(letter.actor, orderedAgentNames)
        glyphs.add(rendererHandle.renderer, cache, tSeconds, letter.grapheme, { bulk: true, actor: actorIndex })
        built++
      }
      glyphs.markBulkUploaded()
      cache.markPagesClean()
      setStageBuiltCount(built)
      setStageBuilding(false)

      // D-21: two coloured strands, twisting where two authors wrote close
      // together. Built from every letter this replay ever saw (including
      // deleted ones -- a strand represents when someone wrote, not just
      // what survived), independent of the glyph loop just above.
      const spans = deriveAuthorSpans(history.allLetters, threadStartMs)
      strands.buildFromSpans(spans, (actor) => authorPaletteIndex(actor, orderedAgentNames))

      liveView.applyFrame(history.frame)
      sideView.applyFrame(history.frame)

      const firstBreakpointSeconds = history.slowdown[0]?.afterSeconds ?? Number.POSITIVE_INFINITY
      stageRuntimeRef.current = {
        scene,
        ribbon,
        glyphs,
        underlay,
        strands,
        orderedAgentNames,
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
        separationTargetPx: 0,
        separationCurrentPx: 0,
        separationDragActive: false,
        separationLatched: false,
      }
    }

    Promise.all([loadStageHistory(treeId, nodeId), window.tapestry.agents.list()])
      .then(([history, agents]) => {
        const orderedAgentNames = orderAgentsByConnection(agents)
        if (!cancelled) applyHistory(history, orderedAgentNames)
        if (!cancelled) {
          // D-21: the typer's own underlay/caret readout (useThreadEditor)
          // needs this same agent order and the thread's live letters, in
          // document order, at the moment this view opened.
          setTyperOrderedAgentNames(orderedAgentNames)
          setInitialLiveLetters(history.liveOrder.map((id) => history.allLetters[id]).map((l) => ({ grapheme: l.grapheme, actor: l.actor })))
          loadAuthorData(treeId, nodeId, history.letters)
            .then(({ rows }) => {
              if (!cancelled) setAuthorRows(rows)
            })
            .catch((err: unknown) => console.error('[ThreadOverlay] loadAuthorData failed:', err))
        }
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

      // D-23/L-2: ease the drag-apart/`A`-key separation toward its target
      // every frame (a ~240ms spring at 60fps); reduced motion snaps
      // straight to the target instead (UI-SPEC "release snaps instead of
      // springing"). A pure uniform write on strands.ts's own material --
      // never anything that could reach the document.
      if (stage.separationCurrentPx !== stage.separationTargetPx) {
        stage.separationCurrentPx = reducedMotion
          ? stage.separationTargetPx
          : stage.separationCurrentPx + (stage.separationTargetPx - stage.separationCurrentPx) * 0.15
        if (Math.abs(stage.separationTargetPx - stage.separationCurrentPx) < 0.5) {
          stage.separationCurrentPx = stage.separationTargetPx
        }
        stage.strands.setSeparationBoost(stage.separationCurrentPx)
      }

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
      } else if (viewRef.current === 'side' && pointerRef.current && stage.sessions.length > 0 && container) {
        // D-17 hover gravity: pulls the view centre toward the nearest
        // session only while the pointer is actually hovering near one --
        // gravityStep itself returns 0 whenever the pointer is moving too
        // fast, too far away, or a wheel/drag happened too recently, so
        // "there is no pull while moving freely" holds by construction, not
        // by a separate check here.
        const pointer = pointerRef.current
        const stageWidth = container.clientWidth
        const stageHeight = container.clientHeight
        const pillY = stageHeight / 2
        let nearestDistancePx = Infinity
        let nearestSeconds = 0
        let nearestLetterCount = 0
        for (const session of stage.sessions) {
          const x = stage.sideView.timeToScreenX(secondsSince(stage.threadStartMs, session.startMs))
          if (x < 0 || x > stageWidth) continue
          const distancePx = Math.hypot(x - pointer.x, pillY - pointer.y)
          if (distancePx < nearestDistancePx) {
            nearestDistancePx = distancePx
            nearestSeconds = secondsSince(stage.threadStartMs, session.startMs)
            nearestLetterCount = session.letterCount
          }
        }
        const frameDeltaSeconds = (performance.now() - lastGravityFrameAtRef.current) / 1000
        lastGravityFrameAtRef.current = performance.now()
        if (Number.isFinite(nearestDistancePx)) {
          const fraction = gravityStep({
            distancePx: nearestDistancePx,
            pointerSpeedPxPerSec: pointerSpeedRef.current,
            msSinceLastWheelOrDrag: performance.now() - lastWheelOrDragAtRef.current,
            frameDeltaSeconds,
            letterCount: nearestLetterCount,
          })
          if (fraction > 0) {
            const newCenter = stage.sideView.centerSeconds + (nearestSeconds - stage.sideView.centerSeconds) * fraction
            stage.sideView.setView(newCenter, stage.sideView.spanSeconds, nowSeconds)
            if (performance.now() - lastSideSnapshotAtRef.current > 100) {
              lastSideSnapshotAtRef.current = performance.now()
              setSideSnapshot({
                centerMs: stage.threadStartMs + newCenter * 1000,
                spanMs: stage.sideView.spanSeconds * 1000,
              })
            }
          }
        }
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
      // A lost/restored context rebuilds from the thread's own records,
      // never from the screen (T-02.3-04-03) -- the agent order is re-read
      // too, in case a new agent connected while this context was lost.
      Promise.all([loadStageHistory(treeId, nodeId), window.tapestry.agents.list()])
        .then(([history, agents]) => {
          if (!cancelled) applyHistory(history, orderAgentsByConnection(agents))
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
      scene.remove(ribbon.mesh, strands.mesh, underlay.mesh, glyphs.mesh)
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
          {pastMomentMs !== null ? (
            <>
              {/* D-08/D-18: "Reading [date], [time] — read-only" replaces the
                  ordinary title while a past stage is open (UI-SPEC "Thread
                  overlay header"). */}
              <span style={styles.title}>
                {`Reading ${new Date(pastMomentMs).toLocaleDateString()}, ${new Date(pastMomentMs).toLocaleTimeString()} — read-only`}
              </span>
              <button type="button" onClick={handleReturnToNow} style={styles.closeButton}>
                Return to now
              </button>
            </>
          ) : (
            <>
              <span style={styles.title}>{title || 'Untitled thread'}</span>

              {showStatus && ready === null && (
                <span style={styles.statusLabel}>{`Catching up (${totalChanges} of ${totalChanges} changes)`}</span>
              )}

              {ready !== null && <span style={styles.statusLabel}>{saveLabel}</span>}

              {/* D-09/D-15: "Read the thread back" in the live view, "Return
                  to now" in the side view (UI-SPEC "Thread overlay header"). */}
              <button type="button" onClick={handleToggleView} disabled={ready === null} style={styles.closeButton}>
                {view === 'live' ? 'Read the thread back' : 'Return to now'}
              </button>
            </>
          )}

          {/* D-21: "Authors · [n]" (UI-SPEC "Thread overlay header"). */}
          <button
            type="button"
            onClick={() => setShowAuthorsLegend((was) => !was)}
            style={styles.closeButton}
          >
            {`Authors · ${authorRows.length}`}
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

        {showAuthorsLegend && (
          <div style={styles.authorsLegendWrap}>
            <AuthorsLegend
              rows={authorRows}
              orderedAgentNames={stageRuntimeRef.current?.orderedAgentNames ?? []}
            />
          </div>
        )}

        {openError && <div style={styles.error}>Couldn't finish reading this thread's history — {openError}</div>}

        {/* D-08/D-18: the live typer never unmounts (its own EditorView
            lifecycle is unrelated to browsing history) -- a past stage
            overlays it instead, so ProseMirror's collab-bound view is never
            torn down and recreated just for reading an old moment. */}
        <div style={styles.typerWrap}>
          <div ref={editorRef} style={{ ...styles.typer, visibility: pastMomentMs !== null ? 'hidden' : 'visible' }} />
          {pastMomentMs !== null && (
            <div style={styles.pastStageOverlay}>
              {pastMomentReplay ? (
                <DocAtTimeView atMs={pastMomentMs} replay={pastMomentReplay} onWriteAttempt={handlePastStageWriteAttempt} />
              ) : (
                findingSlow && (
                  <div style={styles.underTyperLine}>{`Finding the document at ${new Date(pastMomentMs).toLocaleTimeString()}…`}</div>
                )
              )}
            </div>
          )}
        </div>

        {/* D-21: the caret authorship readout, a live region updated on
            every selection change, throttled to 300ms -- names the author
            at the caret in words at all times, no key held (UI-SPEC
            "Screen-reader announcements", "Author of the text at the
            caret"). */}
        {pastMomentMs === null && ready !== null && (
          <div aria-live="polite" style={styles.underTyperLine}>
            {captionText}
          </div>
        )}

        {hoveredAuthor && (
          <AuthorChip actorId={hoveredAuthor.actorId} x={hoveredAuthor.x} y={hoveredAuthor.y} orderedAgentNames={typerOrderedAgentNames} />
        )}

        {pastMomentMs === null && showStatus && ready === null && !openError && (
          <div style={styles.underTyperLine}>
            This is the last saved text. Writing starts when the history has finished loading.
          </div>
        )}

        {pastMomentMs !== null && writeNotice && <div style={styles.underTyperLine}>{writeNotice}</div>}

        {notSavedReason && <div style={styles.error}>Not saved — {notSavedReason}</div>}

        {/* D-09 stage area: paper with the ribbon and glyphs, or the
            no-WebGL / context-lost fallback (UI-SPEC "No-stage fallback"). */}
        <div
          ref={stageContainerRef}
          style={styles.stage}
          className="tap-thread-nav-focusable"
          tabIndex={view === 'side' ? 0 : -1}
          onWheel={handleStageWheel}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerLeave={handleStagePointerLeave}
          onKeyDown={handleStageKeyDown}
        >
          {stageAvailable === false && <StageFallbackPanel treeId={treeId} nodeId={nodeId} />}
          {stageAvailable !== false && stageError && (
            <StageFallbackPanel reason={stageError} treeId={treeId} nodeId={nodeId} />
          )}
          {stageAvailable !== false && !stageError && stageStatus && (
            <div style={styles.stageStatus} aria-hidden="false">
              {stageStatus}
            </div>
          )}

          {/* D-23/L-2: "Showing agent.[name] on its own. The document
              hasn't changed." -- visible while the strands are pulled
              apart, by drag or the `A` key alike. */}
          {separationChip && (
            <div style={styles.separationChip} role="status">
              {separationChip}
            </div>
          )}

          {/* D-17: the date scrubber, only in the side view, once the
              thread has at least one recorded session to scrub across. */}
          {view === 'side' && sessions.length > 0 && sideSnapshot && (
            <div style={styles.scrubberWrap}>
              <DateScrubber
                firstDateMs={sessions[0].startMs}
                lastDateMs={sessions[sessions.length - 1].endMs}
                viewCenterMs={sideSnapshot.centerMs}
                viewSpanMs={sideSnapshot.spanMs}
                dailyLetterCounts={dailyLetterCountsFromSessions(sessions, sessions[0].startMs)}
                onScrub={handleScrub}
              />
            </div>
          )}
        </div>

        {/* UI-SPEC "Screen-reader announcements for visual-only cues": one
            polite live region for session/marker focus moves, zoom changes
            and view-mode transitions. */}
        <div aria-live="polite" style={styles.visuallyHidden}>
          {announcement}
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
  typerWrap: {
    position: 'relative',
    flex: '0 1 auto',
    width: 'min(688px, 92vw)',
    alignSelf: 'center',
  },
  typer: {
    maxHeight: '44vh',
    minHeight: 160,
    width: '100%',
    overflowY: 'auto',
    padding: '12px 16px',
    fontSize: 16,
    lineHeight: 1.5,
    background: 'var(--tap-surface, #FFFFFF)',
    borderRadius: 12,
  },
  pastStageOverlay: {
    position: 'absolute',
    inset: 0,
    maxHeight: '44vh',
    minHeight: 160,
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
  separationChip: {
    position: 'absolute',
    left: '50%',
    top: 12,
    transform: 'translateX(-50%)',
    fontSize: 13,
    padding: '4px 10px',
    borderRadius: 6,
    background: 'var(--tap-surface, #FFFFFF)',
    color: 'var(--tap-ink, #2C2C2C)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    pointerEvents: 'none',
  },
  scrubberWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 8,
  },
  authorsLegendWrap: {
    position: 'absolute',
    top: 96,
    right: 16,
    zIndex: 10,
  },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
}
