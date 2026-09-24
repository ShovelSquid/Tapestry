/**
 * ChatPanel — Claude, docked beside the canvas, for one workspace (02.7 D-12).
 *
 * The panel runs the person's own Claude Code (main owns the process). Its
 * Claude reaches files only through Tapestry's workspace tools, so every edit
 * it makes lands in the file windows and the tree as agent.claude-chat.
 *
 * It sits outside the canvas transform, fixed to the right edge. Keys,
 * pointer presses and wheel scrolling inside it stay inside it, as in a file
 * window, so typing never deletes a note and scrolling never pans the space.
 */

import React, { useContext, useEffect, useRef, useState } from 'react'
import { ChatContext, useChat, type ChatItem } from '../state/chat'

interface ChatPanelProps {
  treeId: string
}

/** The tool's own name, without the MCP server prefix. */
function shortToolName(name: string): string {
  return name.replace(/^mcp__tapestry__/, '')
}

function pathArgument(input: unknown): string | null {
  if (input && typeof input === 'object' && 'path' in input) {
    const path = (input as { path?: unknown }).path
    if (typeof path === 'string') return path
  }
  return null
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? ''
}

/** What to do next, for the failures a person can fix themselves. */
const errorHints: Partial<Record<TapestryChatErrorKind, string>> = {
  'signed-out': 'Open a terminal, run claude, and type /login.',
  'not-installed': 'After installing it, run claude once in a terminal to sign in, then send again.',
}

function ToolRow({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }): React.ReactElement {
  const path = pathArgument(item.input)
  const label = [shortToolName(item.name), path].filter(Boolean).join(' ')
  let status = '…'
  if (item.result) {
    status = item.result.isError ? `— refused: ${firstLine(item.result.text)}` : '— done'
  }
  return (
    <div
      className={
        item.result?.isError ? 'tapestry-chat-tool tapestry-chat-tool--refused' : 'tapestry-chat-tool'
      }
    >
      {label} {status}
    </div>
  )
}

export default function ChatPanel({ treeId }: ChatPanelProps): React.ReactElement {
  const { closeChat } = useContext(ChatContext)
  const { workspace, transcript, busy, error, send, stop, newChat } = useChat(treeId)
  const [draft, setDraft] = useState('')

  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Wheel scrolling scrolls the transcript, never the canvas; pinch-zoom
  // (ctrlKey) is left alone, as in a file window.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) e.stopPropagation()
    }
    panel.addEventListener('wheel', onWheel, { passive: true })
    return () => panel.removeEventListener('wheel', onWheel)
  }, [])

  // Follow the reply as it is written.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [transcript])

  useEffect(() => {
    inputRef.current?.focus()
  }, [treeId])

  const submit = async (): Promise<void> => {
    const text = draft
    if (text.trim().length === 0 || busy) return
    const ok = await send(text)
    if (ok) setDraft('')
  }

  return (
    <div
      ref={panelRef}
      className="tapestry-chat-panel"
      role="complementary"
      aria-label={`Claude — ${workspace}`}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="tapestry-chat-header">
        <div className="tapestry-chat-title-row">
          <span className="tapestry-chat-title" title={workspace}>
            Claude — {workspace}
          </span>
          <button type="button" className="tapestry-button--secondary" onClick={() => void newChat()}>
            New chat
          </button>
          <button type="button" className="tapestry-button--secondary" onClick={closeChat}>
            Close chat
          </button>
        </div>
        <div className="tapestry-chat-subtitle">
          Edits go through Tapestry's workspace tools as agent.claude-chat
        </div>
      </div>

      <div ref={scrollRef} className="tapestry-chat-transcript" aria-live="polite">
        {transcript.map((item, index) => {
          switch (item.kind) {
            case 'user':
              return (
                <div key={index} className="tapestry-chat-user">
                  {item.text}
                </div>
              )
            case 'assistant':
              return (
                <div key={index} className="tapestry-chat-assistant">
                  {item.text}
                </div>
              )
            case 'tool':
              return <ToolRow key={index} item={item} />
            case 'notice':
              return (
                <div key={index} className="tapestry-chat-notice">
                  {item.text}
                </div>
              )
            case 'error':
              return (
                <div key={index} className="tapestry-chat-error" role="alert">
                  <div>{item.message}</div>
                  {errorHints[item.errorKind] && (
                    <div className="tapestry-chat-error-hint">{errorHints[item.errorKind]}</div>
                  )}
                </div>
              )
          }
        })}
        {error && (
          <div className="tapestry-chat-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="tapestry-chat-composer">
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
    </div>
  )
}
