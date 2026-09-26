/**
 * ChatSessionComposer — where a person writes to one session (02.8 D-06).
 *
 * The same composer sits on the session card and in the enlarged view, and
 * both read and write the session's one draft in state/chat-sessions.ts, so
 * text typed on the card is there when the panel opens.
 *
 * Enter sends; Shift+Enter makes a new line; while an IME is composing,
 * Enter belongs to the IME. Send message is disabled while the draft is
 * empty or a turn is running, so "still answering" cannot be triggered from
 * here. Stop reply shows only while a turn runs.
 *
 * A focus request (a new chat's composer) is taken once, with
 * `preventScroll`, so the canvas never scrolls to it (D-16).
 */

import React, { useEffect, useRef } from 'react'
import {
  sendChatSession,
  setChatAttachment,
  setChatDraft,
  stopChatSession,
  useChatSession,
  type ComposerPlace,
} from '../state/chat-sessions'
import type { ChatAttachment } from '../state/chat'

/** Five Body lines (24px) plus 8px padding above and below. */
const MAX_INPUT_HEIGHT = 136

/** Focus requests already taken, so a remount never re-focuses. */
const consumedFocus = new Set<string>()

/** How an attachment reads on its chip. */
export function attachmentLabel(attachment: ChatAttachment): string {
  return attachment.kind === 'file' ? attachment.path : `"${attachment.title}"`
}

export default function ChatSessionComposer({
  treeId,
  noteId,
  place,
}: {
  treeId: string
  noteId: string
  /** Which composer this is, for focus requests. */
  place: ComposerPlace
}): React.ReactElement {
  const session = useChatSession(treeId, noteId)
  const { draft, attachment, busy, sending, focusNonce, focusPlace } = session
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Grow with the text from one line to five, then scroll.
  useEffect(() => {
    const area = inputRef.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(MAX_INPUT_HEIGHT, area.scrollHeight + 2)}px`
  }, [draft])

  useEffect(() => {
    if (focusNonce === 0 || focusPlace !== place) return
    const token = `${treeId}:${noteId}#${focusNonce}`
    if (consumedFocus.has(token)) return
    consumedFocus.add(token)
    inputRef.current?.focus({ preventScroll: true })
  }, [focusNonce, focusPlace, place, treeId, noteId])

  const canSend = draft.trim().length > 0 && !busy && !sending
  const submit = (): void => {
    if (!canSend) return
    void sendChatSession(treeId, noteId)
  }

  return (
    <>
      {attachment && (
        <div className="tapestry-chat-chip">
          <span className="tapestry-chat-chip-text" title={attachmentLabel(attachment)}>
            Attached: {attachmentLabel(attachment)}
          </span>
          <button
            type="button"
            className="tapestry-chat-chip-remove"
            onClick={() => setChatAttachment(treeId, noteId, null)}
          >
            Remove attachment
          </button>
        </div>
      )}
      <textarea
        ref={inputRef}
        className="tapestry-chat-input"
        value={draft}
        placeholder="Message Claude"
        aria-label="Message Claude"
        rows={1}
        onChange={(e) => setChatDraft(treeId, noteId, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="tapestry-chat-actions">
        {busy && (
          <button
            type="button"
            className="tapestry-button--secondary"
            onClick={() => void stopChatSession(treeId, noteId)}
          >
            Stop reply
          </button>
        )}
        <button type="button" className="tapestry-button--primary" disabled={!canSend} onClick={submit}>
          Send message
        </button>
      </div>
    </>
  )
}
