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

import React from 'react'
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

export default function ChatSessionTranscript({
  turns,
  live,
  error,
}: {
  /** The committed turns, parsed from the session note's text. */
  turns: RecordedTurn[]
  /** The turn in progress, folded from live events. */
  live: ChatItem[]
  /** Why the last request to main failed, if it did. */
  error: string | null
}): React.ReactElement {
  const empty = turns.length === 0 && live.length === 0

  return (
    <>
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
    </>
  )
}
