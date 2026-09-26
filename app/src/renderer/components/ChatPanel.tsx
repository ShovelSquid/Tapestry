/**
 * ChatPanel — Claude, docked beside the canvas, for one chat session note
 * (02.7 D-12, 02.8 D-02, D-04).
 *
 * The panel runs the person's own Claude Code (main owns the process). Its
 * Claude reaches files only through Tapestry's workspace tools, so every edit
 * it makes lands in the file windows and the tree as the session's own agent,
 * `agent.claude-chat-<8 hex>-<note id>`. The conversation it shows is the
 * session note's text (committed turns) plus the turn in progress.
 *
 * It sits outside the canvas transform, fixed to the right edge. Keys,
 * pointer presses and wheel scrolling inside it stay inside it, as in a file
 * window, so typing never deletes a note and scrolling never pans the space.
 *
 * Its header holds the chat's shell switch (D-15). Turning it on needs a
 * confirmation that states the risk, and a banner shows while it is on. Main
 * turns it off for every new chat and after every relaunch.
 */

import React, { useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Dialog from './Dialog'
import ChatSessionTranscript from './ChatSessionTranscript'
import {
  ChatContext,
  composeFirstMessage,
  foldChatEvents,
  liveAfter,
  useChat,
  type ChatAttachment,
} from '../state/chat'
import {
  committedTurns,
  NEW_SESSION_TITLE,
  parseTranscript,
  sessionBody,
  type SessionNodeLike,
} from '../../shared/chat/transcript'

/** What the panel shows: a session note's chat, a chooser, or that none is open (D-19). */
export type ChatPanelState =
  | { kind: 'chat'; treeId: string; noteId: string; attachment: ChatAttachment | null; seq: number }
  | {
      kind: 'choose'
      options: Array<{ treeId: string; name: string }>
      attachment: ChatAttachment | null
    }
  | { kind: 'none' }

export const NO_WORKSPACE_CHAT_TEXT =
  'Open a workspace folder first (Add tree > Add Workspace Folder...). The chat runs inside a workspace.'

/** How an attachment reads on its chip. */
function attachmentLabel(attachment: ChatAttachment): string {
  return attachment.kind === 'file' ? attachment.path : `"${attachment.title}"`
}

/**
 * The panel's frame. Keys, presses and wheel turns inside it stay inside it,
 * so typing never deletes a note and scrolling never pans the space.
 */
function PanelShell({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null)

  // Pinch-zoom (ctrlKey) is left alone, as in a file window.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) e.stopPropagation()
    }
    panel.addEventListener('wheel', onWheel, { passive: true })
    return () => panel.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      ref={panelRef}
      className="tapestry-chat-panel"
      role="complementary"
      aria-label={label}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

function PanelHeader({
  title,
  children,
}: {
  title: string
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="tapestry-chat-header">
      <div className="tapestry-chat-title-row">
        <span className="tapestry-chat-title" title={title}>
          {title}
        </span>
        {children}
        <CloseChatButton />
      </div>
    </div>
  )
}

function Conversation({
  treeId,
  noteId,
  sessionNode,
  attachment: initialAttachment,
  seq,
}: {
  treeId: string
  noteId: string
  /** The session note as the canvas has it, or null before the tree refreshes. */
  sessionNode: SessionNodeLike | null
  attachment: ChatAttachment | null
  seq: number
}): React.ReactElement {
  const { openChat } = useContext(ChatContext)
  const { workspace, agent, live, busy, error, send, stop, allowShell, setAllowShell } = useChat(treeId, noteId)
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<ChatAttachment | null>(initialAttachment)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Committed turns are the note's own text (D-09); only later turns are live.
  const body = sessionNode ? sessionBody(sessionNode) : ''
  const committed = sessionNode ? committedTurns(sessionNode) : 0
  const turns = useMemo(() => parseTranscript(body), [body])
  const liveItems = useMemo(
    () => foldChatEvents(liveAfter(live, committed).map((entry) => entry.event)),
    [live, committed],
  )
  const rawTitle = sessionNode?.props['title']?.value
  const title = typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle : NEW_SESSION_TITLE

  // Each Ask Claude… brings its own attachment.
  useEffect(() => {
    setAttachment(initialAttachment)
    inputRef.current?.focus()
    // Keyed on seq alone: the same attachment asked for twice still resets.
  }, [seq])

  // Follow the reply as it is written.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [turns, liveItems])

  const submit = async (): Promise<void> => {
    const text = draft
    if (text.trim().length === 0 || busy) return
    // The attachment goes nowhere but the text of this message.
    const ok = await send(composeFirstMessage(attachment, text))
    if (ok) {
      setDraft('')
      setAttachment(null)
    }
  }

  return (
    <PanelShell label={`${title} — ${workspace}`}>
      <div className="tapestry-chat-header">
        <div className="tapestry-chat-title-row">
          <span className="tapestry-chat-title" title={`${title} — ${workspace}`}>
            {title}
          </span>
          <button type="button" className="tapestry-button--secondary" onClick={() => openChat({ treeId })}>
            New chat
          </button>
          <CloseChatButton />
        </div>
        <div className="tapestry-chat-subtitle">
          {agent ? `Edits go through Tapestry's workspace tools as agent.${agent}` : workspace}
        </div>
        <ShellSwitch on={allowShell} onChange={setAllowShell} />
      </div>
      {allowShell && (
        <div className="tapestry-chat-shell-banner" role="status">
          Shell on — not sandboxed
        </div>
      )}

      <div ref={scrollRef} className="tapestry-chat-transcript" aria-live="polite">
        <ChatSessionTranscript turns={turns} live={liveItems} error={error} />
      </div>

      <div className="tapestry-chat-composer">
        {attachment && (
          <div className="tapestry-chat-chip">
            <span className="tapestry-chat-chip-text" title={attachmentLabel(attachment)}>
              Attached: {attachmentLabel(attachment)}
            </span>
            <button
              type="button"
              className="tapestry-chat-chip-remove"
              onClick={() => setAttachment(null)}
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
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="tapestry-chat-actions">
          {busy && (
            <button type="button" className="tapestry-button--secondary" onClick={() => void stop()}>
              Stop
            </button>
          )}
          <button
            type="button"
            className="tapestry-button--primary"
            disabled={busy || draft.trim().length === 0}
            onClick={() => void submit()}
          >
            Send
          </button>
        </div>
      </div>
    </PanelShell>
  )
}

/**
 * The shell switch, with the line that says what it risks. Turning it on
 * opens the confirmation; turning it off applies at once.
 */
function ShellSwitch({
  on,
  onChange,
}: {
  on: boolean
  onChange: (on: boolean) => Promise<void>
}): React.ReactElement {
  const riskId = useId()
  const [confirming, setConfirming] = useState(false)
  const keepOffRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="tapestry-chat-shell-row">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={riskId}
        className={on ? 'tapestry-chat-shell-switch tapestry-chat-shell-switch--on' : 'tapestry-chat-shell-switch'}
        onClick={() => {
          if (on) void onChange(false)
          else setConfirming(true)
        }}
      >
        <span className="tapestry-chat-shell-track" aria-hidden="true">
          <span className="tapestry-chat-shell-thumb" />
        </span>
        Allow shell (not sandboxed)
      </button>
      <span id={riskId} className="tapestry-chat-shell-risk">
        Lets Claude run commands outside Tapestry's workspace rules
      </span>

      {confirming &&
        // Portalled, so the panel's own stacking context cannot bury the modal.
        createPortal(
          <Dialog
            title="Allow shell for this chat?"
            // Escape keeps the shell off: the safe answer is the default one.
            onDismiss={() => setConfirming(false)}
            initialFocusRef={keepOffRef as React.RefObject<HTMLElement>}
            buttons={
              <>
                <button
                  ref={keepOffRef}
                  type="button"
                  className="tapestry-button--secondary"
                  onClick={() => setConfirming(false)}
                >
                  Keep shell off
                </button>
                <button
                  type="button"
                  className="tapestry-button--destructive"
                  onClick={() => {
                    setConfirming(false)
                    void onChange(true)
                  }}
                >
                  Allow shell
                </button>
              </>
            }
          >
            <p className="tapestry-dialog-text">
              Claude will be able to run commands and change any file your account can reach, outside
              Tapestry's workspace rules. Its file changes are recorded as observed changes, author
              unknown. This lasts until you turn it off or restart Tapestry.
            </p>
          </Dialog>,
          document.body,
        )}
    </div>
  )
}

function CloseChatButton(): React.ReactElement {
  const { closeChat } = useContext(ChatContext)
  return (
    <button type="button" className="tapestry-button--secondary" onClick={closeChat}>
      Close chat
    </button>
  )
}

export default function ChatPanel({
  state,
  sessionNode,
}: {
  state: ChatPanelState
  /** The session note the panel shows, as the canvas has it (null until it is there). */
  sessionNode: SessionNodeLike | null
}): React.ReactElement {
  const { openChat } = useContext(ChatContext)

  if (state.kind === 'chat') {
    return (
      <Conversation
        key={`${state.treeId}#${state.noteId}`}
        treeId={state.treeId}
        noteId={state.noteId}
        sessionNode={sessionNode}
        attachment={state.attachment}
        seq={state.seq}
      />
    )
  }

  if (state.kind === 'choose') {
    return (
      <PanelShell label="Claude">
        <PanelHeader title="Claude" />
        <div className="tapestry-chat-transcript">
          <div className="tapestry-chat-choose-heading">Chat in which workspace?</div>
          {state.options.map((option) => (
            <button
              key={option.treeId}
              type="button"
              className="tapestry-button--secondary tapestry-chat-choice"
              onClick={() => openChat({ treeId: option.treeId, attachment: state.attachment ?? undefined })}
            >
              {option.name}
            </button>
          ))}
        </div>
      </PanelShell>
    )
  }

  return (
    <PanelShell label="Claude">
      <PanelHeader title="Claude" />
      <div className="tapestry-chat-transcript">
        <div className="tapestry-chat-notice">{NO_WORKSPACE_CHAT_TEXT}</div>
      </div>
    </PanelShell>
  )
}
