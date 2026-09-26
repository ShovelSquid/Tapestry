/**
 * EdgeArrowLayer — the screen-space arrows that point at session cards
 * waiting off-screen (02.8 D-16, SC5).
 *
 * It sits over the canvas, outside the camera transform, as the canvas's last
 * child: after the canvas in DOM order and before the ChatPanel. A session
 * whose card lies entirely outside the visible area and that asks for
 * attention at level 2 or more (Done, Needs you, Failed, a new chat) gets one
 * 32px arrow on the edge facing it, drawn in its author colour. The geometry
 * is layout/edge-arrows.ts; what each session asks for comes from the store.
 *
 * Clicking an arrow (or Enter or Space on it) asks the canvas to pan there.
 * That is the person's own action, and the only way this layer ever touches
 * the camera. It does not acknowledge the state: looking at the card does.
 *
 * Everything here is view state; nothing is written.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Camera } from '../layout/camera'
import { edgeArrows, type EdgeArrow, type ViewportSize, type WorldRect } from '../layout/edge-arrows'
import { useSessionAttentions } from '../state/chat-sessions'
import type { AttentionKind } from '../../shared/chat/session-status'

/** One session card the layer may point at. */
export interface EdgeArrowSessionCard {
  /** The store key, `<treeId>:<noteId>`. */
  key: string
  treeId: string
  noteId: string
  worldRect: WorldRect
  title: string
}

export interface EdgeArrowLayerProps {
  cards: readonly EdgeArrowSessionCard[]
  camera: Camera
  viewport: ViewportSize
  panelOpen: boolean
  /** Pan so the card is centred in the visible area: the person asked. */
  onGo: (treeId: string, noteId: string) => void
}

/** The state word each arrow's label ends with. */
const KIND_WORDS: Readonly<Record<AttentionKind, string>> = Object.freeze({
  done: 'Done',
  needs: 'Needs you',
  failed: 'Failed',
  new: 'New chat',
})

/** How long a leaving arrow fades before it is gone (UI-SPEC § Motion). */
const FADE_MS = 150

/** A chevron pointing right, turned toward the card. */
function Chevron({ angle }: { angle: number }): React.ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={`rotate(${angle.toFixed(1)} 8 8)`}
      />
    </svg>
  )
}

/** The badge's "!", white on the filled disc. */
function Bang(): React.ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M6.8 2.2h2.4l-.45 7.6h-1.5L6.8 2.2ZM8 11.2a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z" />
    </svg>
  )
}

/** Failed: a ×. The arrow says which session; the card says what went wrong. */
function Cross(): React.ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function glyphFor(arrow: EdgeArrow): React.ReactElement {
  if (arrow.kind === 'needs') return <Bang />
  if (arrow.kind === 'failed') return <Cross />
  return <Chevron angle={arrow.angle} />
}

/** Stop an event here, so the canvas never pans, selects or opens a menu for it. */
function stop(e: React.SyntheticEvent): void {
  e.stopPropagation()
}

export default function EdgeArrowLayer({
  cards,
  camera,
  viewport,
  panelOpen,
  onGo,
}: EdgeArrowLayerProps): React.ReactElement | null {
  const keys = useMemo(() => cards.map((card) => card.key), [cards])
  const attentions = useSessionAttentions(keys)

  const arrows = useMemo(() => {
    if (attentions.size === 0) return []
    const asking = cards.flatMap((card) => {
      const attention = attentions.get(card.key)
      return attention ? [{ key: card.key, worldRect: card.worldRect, attention, title: card.title, author: attention.author }] : []
    })
    return edgeArrows(asking, camera, viewport, panelOpen)
  }, [cards, attentions, camera, viewport, panelOpen])

  // An arrow that goes (its card came into view, or it was looked at) fades
  // out where it last was, then is dropped. Its timer lives in a ref, not in
  // an effect cleanup, because the arrows change on every camera frame.
  const [leaving, setLeaving] = useState<readonly EdgeArrow[]>([])
  const shownRef = useRef<readonly EdgeArrow[]>([])
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const now = new Set(arrows.map((a) => a.key))
    const gone = shownRef.current.filter((a) => !now.has(a.key))
    shownRef.current = arrows
    // An arrow that came back is no longer leaving.
    for (const key of now) {
      const timer = timersRef.current.get(key)
      if (timer === undefined) continue
      clearTimeout(timer)
      timersRef.current.delete(key)
    }
    setLeaving((prev) => {
      const kept = prev.filter((a) => !now.has(a.key) && !gone.some((g) => g.key === a.key))
      return gone.length === 0 && kept.length === prev.length ? prev : [...kept, ...gone]
    })
    for (const arrow of gone) {
      const previous = timersRef.current.get(arrow.key)
      if (previous !== undefined) clearTimeout(previous)
      timersRef.current.set(
        arrow.key,
        setTimeout(() => {
          timersRef.current.delete(arrow.key)
          setLeaving((prev) => prev.filter((a) => a.key !== arrow.key))
        }, FADE_MS),
      )
    }
  }, [arrows])
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const byKey = useMemo(() => new Map(cards.map((card) => [card.key, card])), [cards])

  if (arrows.length === 0 && leaving.length === 0) return null

  const render = (arrow: EdgeArrow, isLeaving: boolean): React.ReactElement | null => {
    const card = byKey.get(arrow.key)
    if (!card) return null
    const label = `Go to ${arrow.title} — ${KIND_WORDS[arrow.kind]}`
    let className = `tapestry-edge-arrow tapestry-edge-arrow--${arrow.kind}`
    if (isLeaving) className += ' tapestry-edge-arrow--leaving'
    return (
      <button
        key={isLeaving ? `leaving:${arrow.key}` : arrow.key}
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-hidden={isLeaving ? true : undefined}
        tabIndex={isLeaving ? -1 : undefined}
        style={
          {
            left: `${arrow.x}px`,
            top: `${arrow.y}px`,
            '--tap-session-author': `var(${arrow.author})`,
          } as React.CSSProperties
        }
        onPointerDown={stop}
        onDoubleClick={stop}
        onContextMenu={stop}
        onKeyDown={stop}
        onClick={(e) => {
          e.stopPropagation()
          if (!isLeaving) onGo(card.treeId, card.noteId)
        }}
      >
        {glyphFor(arrow)}
      </button>
    )
  }

  return (
    <div className="tapestry-edge-arrows">
      {arrows.map((arrow) => render(arrow, false))}
      {leaving.map((arrow) => render(arrow, true))}
    </div>
  )
}
