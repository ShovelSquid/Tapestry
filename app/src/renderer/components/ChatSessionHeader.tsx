/**
 * ChatSessionHeader — what a chat session is doing, in a glyph, a word and a
 * status line (02.8 D-11, D-13, D-14; UI-SPEC § States, § Status line).
 *
 * The session card and the enlarged view render this same header from the
 * same snapshot (state/chat-sessions.ts), so they can never disagree about a
 * session's state. Row 1 is the state glyph, the title slot (the card passes
 * its editable title input, the panel plain text) and the caller's buttons.
 * Row 2 is the status line: `<State word> · <status text>`, or the text alone
 * for Idle.
 *
 * Everything here reads the status that 02.8-04's reducer derived from
 * observed events; nothing is guessed from reply text, and nothing here is
 * written anywhere (D-10). The status text is model text, rendered as plain
 * text by React, never as HTML.
 *
 * The card shows `cardText`, which a level-0 status leaves alone (D-14); the
 * enlarged view shows the full `text`.
 */

import React from 'react'
import {
  NEW_CHAT_TEXT,
  statusLine,
  type SessionState,
  type SessionStatus,
} from '../../shared/chat/session-status'

/**
 * The 16px state glyph. Colour is never the only cue: each state has its own
 * shape (UI-SPEC § Accessibility). Idle and Working are the Agents panel's
 * spark in `--tap-muted`; Needs you and Done are in the session's author
 * colour; Failed is in the destructive text colour.
 */
export function SessionStateGlyph({ state }: { state: SessionState }): React.ReactElement {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'currentColor',
    focusable: 'false' as const,
    'aria-hidden': true,
    className: `tapestry-session-glyph tapestry-session-glyph--${state}`,
  }
  switch (state) {
    case 'needs':
      // "!" in a circle.
      return (
        <svg {...common}>
          <path
            fillRule="evenodd"
            d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm-.9 3.2h1.8l-.3 5H7.4l-.3-5ZM8 10.4a1.05 1.05 0 1 1 0 2.1 1.05 1.05 0 0 1 0-2.1Z"
          />
        </svg>
      )
    case 'done':
      // A check in a circle.
      return (
        <svg {...common}>
          <path
            fillRule="evenodd"
            d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm3.3 4.3-.9-.8L7 8.1 5.6 6.7l-.9.9L7 9.9l4.3-4.6Z"
          />
        </svg>
      )
    case 'failed':
      // × in a circle.
      return (
        <svg {...common}>
          <path
            fillRule="evenodd"
            d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1ZM5.6 4.7l-.9.9L7.1 8l-2.4 2.4.9.9L8 8.9l2.4 2.4.9-.9L8.9 8l2.4-2.4-.9-.9L8 7.1 5.6 4.7Z"
          />
        </svg>
      )
    case 'idle':
    case 'working':
      // The Agents panel's spark.
      return (
        <svg {...common}>
          <path d="M8 1.4 9.5 6.5 14.6 8 9.5 9.5 8 14.6 6.5 9.5 1.4 8 6.5 6.5Z" />
        </svg>
      )
  }
}

/**
 * The status line's text. A session whose note has no turns and whose
 * status has no text says "New chat" (the store cannot know the note's
 * turns; see state/chat-sessions.ts `openedStatus`).
 */
export function sessionStatusText(status: SessionStatus, forCard: boolean, turns: number): string {
  const line = statusLine(status, forCard)
  if (line.length === 0 && turns === 0) return NEW_CHAT_TEXT
  return line
}

export interface ChatSessionHeaderProps {
  status: SessionStatus
  /** The card shows `cardText` (level 0 does not change it); the panel shows `text`. */
  forCard: boolean
  /** The note's committed turns, for "New chat". */
  turns: number
  /** The title: the card's editable input, or the panel's plain text. */
  title: React.ReactNode
  /** Row 1's class: the card's `.tapestry-session-header`, the panel's `.tapestry-chat-title-row`. */
  rowClassName?: string
  /** Buttons after the title in row 1. */
  children?: React.ReactNode
}

export function ChatSessionHeader({
  status,
  forCard,
  turns,
  title,
  rowClassName = 'tapestry-session-header',
  children,
}: ChatSessionHeaderProps): React.ReactElement {
  const text = sessionStatusText(status, forCard, turns)
  let statusClass = 'tapestry-session-status'
  if (status.state === 'failed') statusClass += ' tapestry-session-status--failed'
  return (
    <>
      <div className={rowClassName}>
        <SessionStateGlyph state={status.state} />
        {title}
        {children}
      </div>
      {/* Plain text, not a live region: announcements go through LiveAnnouncer. */}
      <div className={statusClass} title={text}>
        {text}
      </div>
    </>
  )
}

export default ChatSessionHeader
