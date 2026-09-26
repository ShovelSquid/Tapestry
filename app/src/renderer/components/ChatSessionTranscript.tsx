/**
 * ChatSessionTranscript — one session's conversation (02.8 D-07, D-09).
 *
 * Committed turns are drawn from the session note's own text, parsed by
 * `parseTranscript`, so the panel reads exactly what the `.tree` file holds
 * and nothing re-asks the model for a past turn. Only the turn in progress
 * comes from live engine events, folded as the 02.7 panel folded them, until
 * its commit lands and the note's turn replaces it.
 *
 * Read-only (UI-SPEC A-09): nothing here can change the note.
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { toolLabel, toolSummary, type RecordedTurn, type TurnItem } from '../../shared/chat/transcript'
import type { ChatItem } from '../state/chat'

/** What to do next, for the failures a person can fix themselves. */
const errorHints: Partial<Record<string, string>> = {
  'signed-out': 'Open a terminal, run claude, and type /login.',
  'not-installed': 'After installing it, run claude once in a terminal to sign in, then send again.',
}

function ErrorBox({ message, errorKind }: { message: string; errorKind: string | null }): React.ReactElement {
  const hint = errorKind !== null ? errorHints[errorKind] : undefined
  return (
    <div className="tapestry-chat-error" role="alert">
      <div>{message}</div>
      {hint && <div className="tapestry-chat-error-hint">{hint}</div>}
    </div>
  )
}

function CommittedItem({ item }: { item: TurnItem }): React.ReactElement {
  switch (item.kind) {
    case 'you':
      return (
        <div className="tapestry-chat-user">
          <span className="tapestry-visually-hidden">You said: </span>
          {item.text}
        </div>
      )
    case 'claude':
      return (
        <div className="tapestry-chat-assistant">
          <span className="tapestry-visually-hidden">Claude said: </span>
          {item.text}
        </div>
      )
    case 'tool':
      return (
        <div className={item.refused ? 'tapestry-chat-tool tapestry-chat-tool--refused' : 'tapestry-chat-tool'}>
          · {item.summary}
        </div>
      )
    case 'note':
      return <div className="tapestry-chat-notice">{item.text}</div>
    case 'error':
      return <ErrorBox message={item.text} errorKind={item.errorKind} />
    case 'stopped':
      return <div className="tapestry-chat-notice">Stopped</div>
    case 'other':
      return <div className="tapestry-chat-other">{item.text}</div>
  }
}

function LiveItem({ item }: { item: ChatItem }): React.ReactElement {
  switch (item.kind) {
    case 'user':
      return (
        <div className="tapestry-chat-user">
          <span className="tapestry-visually-hidden">You said: </span>
          {item.text}
        </div>
      )
    case 'assistant':
      return (
        <div className="tapestry-chat-assistant">
          <span className="tapestry-visually-hidden">Claude said: </span>
          {item.text}
          {/* A static trailing "…" while the reply is still being written. */}
          {item.streaming ? ' …' : ''}
        </div>
      )
    case 'tool': {
      const line = item.result
        ? toolSummary(item.name, item.input, item.result)
        : `${toolLabel(item.name, item.input)} …`
      return (
        <div
          className={item.result?.isError ? 'tapestry-chat-tool tapestry-chat-tool--refused' : 'tapestry-chat-tool'}
        >
          · {line}
        </div>
      )
    }
    case 'notice':
      return <div className="tapestry-chat-notice">{item.text}</div>
    case 'error':
      return <ErrorBox message={item.message} errorKind={item.errorKind} />
  }
}

/** Within this many px of the bottom, the transcript follows new text. */
const FOLLOW_PX = 48

/**
 * The transcript and its own scroller. It follows new text only while the
 * reader is at (or near) the bottom, so reading an older turn is never
 * interrupted. A wheel turn over it scrolls it and never pans the canvas;
 * pinch-zoom (ctrlKey) passes through.
 */
export default function ChatSessionTranscript({
  turns,
  live,
  error,
  className,
  ariaLive,
}: {
  /** The committed turns, parsed from the session note's text. */
  turns: RecordedTurn[]
  /** The turn in progress, folded from live events. */
  live: ChatItem[]
  /** Why the last request to main failed, if it did. */
  error: string | null
  /** The scroller's class (the card's or the panel's). */
  className: string
  ariaLive?: 'polite'
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const empty = turns.length === 0 && live.length === 0

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return undefined
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) e.stopPropagation()
    }
    scroller.addEventListener('wheel', onWheel, { passive: true })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [])

  // New text: follow it only while the reader is at the bottom.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller && atBottomRef.current) scroller.scrollTop = scroller.scrollHeight
  }, [turns, live, error])

  return (
    <div
      ref={scrollRef}
      className={className}
      aria-live={ariaLive}
      onScroll={(e) => {
        const el = e.currentTarget
        atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_PX
      }}
    >
      {empty && (
        <div className="tapestry-chat-empty">
          <div className="tapestry-chat-empty-heading">No messages yet</div>
          <div className="tapestry-chat-empty-body">Write below to ask Claude about this workspace.</div>
        </div>
      )}
      {turns.map((turn, turnIndex) =>
        turn.turn === 0 ? (
          // Text found before the first turn: shown plainly, not as a turn.
          <div key={`t${turnIndex}`} className="tapestry-chat-turn">
            {turn.items.map((item, index) => (
              <CommittedItem key={index} item={item} />
            ))}
          </div>
        ) : (
          <div key={`t${turnIndex}`} className="tapestry-chat-turn" role="group" aria-label={`Turn ${turn.turn}`}>
            {turn.items.map((item, index) => (
              <CommittedItem key={index} item={item} />
            ))}
          </div>
        ),
      )}
      {live.length > 0 && (
        <div className="tapestry-chat-turn tapestry-chat-turn--live">
          {live.map((item, index) => (
            <LiveItem key={index} item={item} />
          ))}
        </div>
      )}
      {error && (
        <div className="tapestry-chat-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
