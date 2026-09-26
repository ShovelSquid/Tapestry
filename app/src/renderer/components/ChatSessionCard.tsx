/**
 * ChatSessionCard — a chat session note, drawn on the canvas (02.8 D-02,
 * D-05, D-06).
 *
 * The card is the session: its title, its conversation (the note's own text
 * plus the turn in progress) scrolling inside it, and a composer you can
 * reply from. Its position is the note's real placement. Its size is the
 * note's (360 × 440 by default); the conversation never grows it.
 *
 * Resizing it (280 × 240 to 720 × 960), closing it to its header and
 * scrolling its transcript are view state (layout/session-card.ts): kept in
 * localStorage by tree and note, never a commit, never the note's
 * `width`/`height`.
 *
 * It reads the same store as the enlarged view (state/chat-sessions.ts), so
 * both show one live turn and one draft.
 *
 * Keys, presses, double-clicks and right-clicks inside the transcript and the
 * composer stay there (as in the chat panel and file windows), so typing can
 * never delete the note. A wheel turn over the transcript scrolls it; a wheel
 * turn anywhere else on the card pans the canvas like any note.
 *
 * The transcript is read-only (UI-SPEC A-09): the only writes this card can
 * make are its title, its position and its connections, which the workspace
 * guard allows. Main refuses any renderer write to its body or `chat.*` keys.
 */

import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { NodeInfo } from './Canvas'
import NoteControls from './NoteControls'
import ChatSessionTranscript from './ChatSessionTranscript'
import ChatSessionComposer from './ChatSessionComposer'
import { ChatContext, foldChatEvents, liveAfter } from '../state/chat'
import { useChatSession } from '../state/chat-sessions'
import { screenDeltaToWorld } from '../layout/camera'
import {
  browserCardViewStorage,
  clampCardSize,
  readCardView,
  writeCardView,
  type CardView,
} from '../layout/session-card'
import {
  NEW_SESSION_TITLE,
  SESSION_HEIGHT,
  SESSION_WIDTH,
  committedTurns,
  parseTranscript,
  sessionBody,
} from '../../shared/chat/transcript'

export interface ChatSessionCardProps {
  treeId: string
  node: NodeInfo
  isSelected: boolean
  isConnectTarget: boolean
  isConnecting: boolean
  zoom: number
  roll: number
  /** Where the note is drawn when it follows another (D-05 placement), else undefined. */
  displayPosition?: { x: number; y: number }
  onBorderSelect: () => void
  onHover: (hovered: boolean) => void
  onHoverDuringConnection: () => void
  onLeaveDuringConnection: () => void
  onPositionChange: (nodeId: string, x: number, y: number) => void
  onRegisterDims: (nodeId: string, width: number, height: number) => void
  onDragMove: (nodeId: string, x: number, y: number) => void
  onDragEnd: (nodeId: string) => void
  onDeleteNote: () => void
  onStartConnection: () => void
  /** A title edit, committed on blur or Enter (an ordinary `title` change). */
  onTitleChange: (title: string) => void
}

function numberProp(node: NodeInfo, key: string): number {
  const value = Number(node.props[key]?.value ?? 0)
  return Number.isFinite(value) ? value : 0
}

function titleOf(node: NodeInfo): string {
  const raw = node.props['title']?.value
  return typeof raw === 'string' ? raw : ''
}

/** Two arrows apart: open this chat beside the canvas. */
function EnlargeGlyph(): React.ReactElement {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A chevron: down while the card is open (closes it), right while closed. */
function ChevronGlyph({ closed }: { closed: boolean }): React.ReactElement {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d={closed ? 'M6 3.5 10.5 8 6 12.5' : 'M3.5 6 8 10.5 12.5 6'}
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Stop an event here, so the canvas never acts on it. */
function stop(e: React.SyntheticEvent): void {
  e.stopPropagation()
}

function ChatSessionCardView({
  treeId,
  node,
  isSelected,
  isConnectTarget,
  isConnecting,
  zoom,
  roll,
  displayPosition,
  onBorderSelect,
  onHover,
  onHoverDuringConnection,
  onLeaveDuringConnection,
  onPositionChange,
  onRegisterDims,
  onDragMove,
  onDragEnd,
  onDeleteNote,
  onStartConnection,
  onTitleChange,
}: ChatSessionCardProps): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null)
  const session = useChatSession(treeId, node.id)
  const { openSession, enlarge } = useContext(ChatContext)
  const isEnlarged = openSession?.treeId === treeId && openSession.noteId === node.id

  // ----- Position and drag (as WorkspaceFileCard, in the card's own axes) -----
  const storedX = numberProp(node, 'position.x')
  const storedY = numberProp(node, 'position.y')
  const baseX = displayPosition?.x ?? storedX
  const baseY = displayPosition?.y ?? storedY
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null)
  const isDraggingRef = useRef(false)
  const draggedRef = useRef(false)
  const x = localPos?.x ?? baseX
  const y = localPos?.y ?? baseY

  useEffect(() => {
    if (!isDraggingRef.current && localPos) setLocalPos(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedX, storedY])

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      isDraggingRef.current = true
      draggedRef.current = false
      const start = { mouseX: e.clientX, mouseY: e.clientY, x, y }
      let last: { x: number; y: number } | null = null

      const onMove = (me: PointerEvent): void => {
        if (!isDraggingRef.current) return
        const d = screenDeltaToWorld(me.clientX - start.mouseX, me.clientY - start.mouseY, zoom, roll)
        if (!draggedRef.current && Math.abs(d.x) + Math.abs(d.y) < 1) return
        draggedRef.current = true
        last = { x: start.x + d.x, y: start.y + d.y }
        setLocalPos(last)
        onDragMove(node.id, last.x, last.y)
      }
      const onUp = (): void => {
        isDraggingRef.current = false
        document.removeEventListener('pointermove', onMove, true)
        document.removeEventListener('pointerup', onUp, true)
        onDragEnd(node.id)
        if (last) onPositionChange(node.id, last.x, last.y)
      }
      document.addEventListener('pointermove', onMove, true)
      document.addEventListener('pointerup', onUp, true)
    },
    [x, y, zoom, roll, node.id, onDragMove, onDragEnd, onPositionChange],
  )

  // ----- View state (D-05): size, closed and scroll, never a commit -----
  const storage = useMemo(() => browserCardViewStorage(), [])
  const [view, setView] = useState<CardView>(() => (storage ? readCardView(storage, treeId, node.id) : {}))
  const remember = useCallback(
    (patch: CardView) => {
      if (storage) writeCardView(storage, treeId, node.id, patch)
    },
    [storage, treeId, node.id],
  )
  // The last scroll, for a transcript drawn again after the card reopens.
  const scrollRef = useRef({ scrollTop: view.scrollTop, atBottom: view.atBottom })

  // Size: the view's if resized, else the note's (360 x 440 by default).
  const storedWidth = numberProp(node, 'width')
  const storedHeight = numberProp(node, 'height')
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null)
  const { width, height } =
    liveSize ??
    clampCardSize({
      width: view.width ?? (storedWidth > 0 ? storedWidth : SESSION_WIDTH),
      height: view.height ?? (storedHeight > 0 ? storedHeight : SESSION_HEIGHT),
    })
  const closed = view.closed === true

  // Resize from the right edge, the bottom edge or the bottom-right corner.
  // It changes only the view's size: this card has no width or height
  // handler, so a resize can never commit.
  const handleResizeStart = useCallback(
    (e: React.PointerEvent, edges: { right: boolean; bottom: boolean }) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      const start = { mouseX: e.clientX, mouseY: e.clientY, width, height }
      let last: { width: number; height: number } | null = null
      const onMove = (me: PointerEvent): void => {
        const d = screenDeltaToWorld(me.clientX - start.mouseX, me.clientY - start.mouseY, zoom, roll)
        last = clampCardSize({
          width: edges.right ? start.width + d.x : start.width,
          height: edges.bottom ? start.height + d.y : start.height,
        })
        setLiveSize(last)
      }
      const onUp = (): void => {
        document.removeEventListener('pointermove', onMove, true)
        document.removeEventListener('pointerup', onUp, true)
        setLiveSize(null)
        if (!last) return
        const size = last
        setView((v) => ({ ...v, ...size }))
        remember(size)
      }
      document.addEventListener('pointermove', onMove, true)
      document.addEventListener('pointerup', onUp, true)
    },
    [width, height, zoom, roll, remember],
  )

  const toggleClosed = (): void => {
    const next = !closed
    setView((v) => ({ ...v, closed: next }))
    remember({ closed: next })
  }

  const handleScrollChange = useCallback(
    (scrollTop: number, atBottom: boolean) => {
      scrollRef.current = { scrollTop, atBottom }
      remember({ scrollTop, atBottom })
    },
    [remember],
  )

  // Layout size, unaffected by the camera's zoom and roll.
  useEffect(() => {
    const el = cardRef.current
    if (el) onRegisterDims(node.id, el.offsetWidth, el.offsetHeight)
  })

  // ----- Title (A-05: an ordinary editable note title) -----
  const storedTitle = titleOf(node)
  const [localTitle, setLocalTitle] = useState(storedTitle)
  const titleFocusedRef = useRef(false)
  useEffect(() => {
    if (!titleFocusedRef.current) setLocalTitle(storedTitle)
  }, [storedTitle])
  const commitTitle = (): void => {
    const next = localTitle.replace(/[\r\n]+/g, ' ')
    if (next.trim().length === 0) {
      setLocalTitle(storedTitle)
      return
    }
    if (next !== storedTitle) onTitleChange(next)
  }
  const shownTitle = storedTitle.trim().length > 0 ? storedTitle : NEW_SESSION_TITLE

  // ----- Conversation: committed turns from the note, the rest live -----
  const body = sessionBody(node)
  const committed = committedTurns(node)
  const turns = useMemo(() => parseTranscript(body), [body])
  const liveItems = useMemo(
    () => foldChatEvents(liveAfter(session.entries, committed).map((entry) => entry.event)),
    [session.entries, committed],
  )

  // ----- Hover: controls stay reachable for a moment after leaving -----
  const [showControls, setShowControls] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    },
    [],
  )
  const handleEnter = (): void => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    setShowControls(true)
    onHover(true)
    if (isConnecting) onHoverDuringConnection()
  }
  const handleLeave = (): void => {
    hideTimerRef.current = setTimeout(() => {
      setShowControls(false)
      onHover(false)
    }, 300)
    if (isConnecting) onLeaveDuringConnection()
  }

  let className = 'tapestry-note-card tapestry-session-card'
  if (isSelected || isConnectTarget) className += ' tapestry-note-card--selected'
  if (isConnectTarget) className += ' tapestry-note-card--connect-target'
  if (closed) className += ' tapestry-session-card--closed'
  const showControlsNow = showControls || isSelected

  return (
    <div
      ref={cardRef}
      className={className}
      role="article"
      aria-label={`Chat: ${shownTitle}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${width}px`, height: closed ? undefined : `${height}px` }}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
      <div
        className="tapestry-note-drag-handle"
        onPointerDown={handleDragStart}
        onClick={(e) => {
          e.stopPropagation()
          if (draggedRef.current) {
            draggedRef.current = false
            return
          }
          onBorderSelect()
        }}
      />

      <div className="tapestry-session-header">
        <input
          type="text"
          className="tapestry-note-title-input tapestry-session-title"
          value={localTitle}
          placeholder={NEW_SESSION_TITLE}
          aria-label="Chat title"
          title={shownTitle}
          onChange={(e) => setLocalTitle(e.target.value)}
          onFocus={() => {
            titleFocusedRef.current = true
          }}
          onBlur={() => {
            titleFocusedRef.current = false
            commitTitle()
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setLocalTitle(storedTitle)
              titleFocusedRef.current = false
              e.currentTarget.blur()
            }
          }}
          onPointerDown={stop}
          onDoubleClick={stop}
          onClick={stop}
        />
        <button
          type="button"
          className="tapestry-ask-claude-button"
          aria-label={closed ? 'Open chat card' : 'Close chat card'}
          title={closed ? 'Open chat card' : 'Close chat card'}
          aria-expanded={!closed}
          onPointerDown={stop}
          onDoubleClick={stop}
          onKeyDown={stop}
          onClick={(e) => {
            e.stopPropagation()
            toggleClosed()
          }}
        >
          <ChevronGlyph closed={closed} />
        </button>
        <button
          type="button"
          className="tapestry-ask-claude-button"
          aria-label="Open beside the canvas"
          title="Open beside the canvas"
          aria-pressed={isEnlarged}
          onPointerDown={stop}
          onDoubleClick={stop}
          onKeyDown={stop}
          onClick={(e) => {
            e.stopPropagation()
            enlarge(treeId, node.id)
          }}
        >
          <EnlargeGlyph />
        </button>
      </div>

      {/* The conversation and the composer keep their input (PanelShell rule). */}
      {!closed && (
        <div
          className="tapestry-session-body"
          onKeyDown={stop}
          onPointerDown={stop}
          onDoubleClick={stop}
          onContextMenu={stop}
        >
          <ChatSessionTranscript
            className="tapestry-session-transcript"
            turns={turns}
            live={liveItems}
            error={session.error}
            initialScroll={scrollRef.current}
            onScrollChange={handleScrollChange}
          />
          <div className="tapestry-session-composer">
            <ChatSessionComposer treeId={treeId} noteId={node.id} place="card" />
          </div>
        </div>
      )}

      {showControlsNow && <NoteControls onConnect={onStartConnection} onDelete={onDeleteNote} />}

      {/* Resize handles: view state only (D-05). */}
      {showControlsNow && (
        <>
          <div
            className="tapestry-resize-handle tapestry-resize-handle--right"
            onPointerDown={(e) => handleResizeStart(e, { right: true, bottom: false })}
          />
          {!closed && (
            <>
              <div
                className="tapestry-resize-handle tapestry-resize-handle--bottom"
                onPointerDown={(e) => handleResizeStart(e, { right: false, bottom: true })}
              />
              <div
                className="tapestry-resize-handle tapestry-resize-handle--corner-br"
                onPointerDown={(e) => handleResizeStart(e, { right: true, bottom: true })}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Memoisation: the frame re-renders on every pointer move of any drag in its
// tree; a card redraws only when what it shows changed.
// ---------------------------------------------------------------------------

const DRAWN_KEYS = ['position.x', 'position.y', 'width', 'height', 'title', 'body', 'chat.turns']

export function sameSessionCardData(a: ChatSessionCardProps, b: ChatSessionCardProps): boolean {
  if (
    a.treeId !== b.treeId ||
    a.isSelected !== b.isSelected ||
    a.isConnectTarget !== b.isConnectTarget ||
    a.isConnecting !== b.isConnecting ||
    a.zoom !== b.zoom ||
    a.roll !== b.roll ||
    a.displayPosition?.x !== b.displayPosition?.x ||
    a.displayPosition?.y !== b.displayPosition?.y
  ) {
    return false
  }
  const n = a.node
  const m = b.node
  if (n === m) return true
  if (n.id !== m.id || n.type !== m.type) return false
  return DRAWN_KEYS.every((key) => n.props[key]?.value === m.props[key]?.value)
}

const MemoChatSessionCard = memo(ChatSessionCardView, sameSessionCardData)

/**
 * The card as TreeFrame renders it. The frame recreates every handler on each
 * render; the memoised card gets stable forwarders that read the latest props
 * through a ref, so a skipped render never acts through an old closure.
 */
export default function ChatSessionCard(props: ChatSessionCardProps): React.ReactElement {
  const latest = useRef(props)
  latest.current = props
  const forwarded = useMemo(
    () => ({
      onBorderSelect: () => latest.current.onBorderSelect(),
      onHover: (hovered: boolean) => latest.current.onHover(hovered),
      onHoverDuringConnection: () => latest.current.onHoverDuringConnection(),
      onLeaveDuringConnection: () => latest.current.onLeaveDuringConnection(),
      onPositionChange: (nodeId: string, x: number, y: number) => latest.current.onPositionChange(nodeId, x, y),
      onRegisterDims: (nodeId: string, width: number, height: number) =>
        latest.current.onRegisterDims(nodeId, width, height),
      onDragMove: (nodeId: string, x: number, y: number) => latest.current.onDragMove(nodeId, x, y),
      onDragEnd: (nodeId: string) => latest.current.onDragEnd(nodeId),
      onDeleteNote: () => latest.current.onDeleteNote(),
      onStartConnection: () => latest.current.onStartConnection(),
      onTitleChange: (title: string) => latest.current.onTitleChange(title),
    }),
    [],
  )
  return <MemoChatSessionCard {...props} {...forwarded} />
}
