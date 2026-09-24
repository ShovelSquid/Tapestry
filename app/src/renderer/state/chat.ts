/**
 * The renderer's side of the in-app chat (02.7 D-12).
 *
 * ChatContext says which workspace's chat panel is open and lets any
 * component open one (a frame header's Chat with Claude button) without
 * threading props through the canvas. useChat(treeId) loads one chat from
 * main, follows its events and folds them into what the panel shows.
 *
 * The renderer never sees a token, a config path or an actor: it sends text
 * and a tree id, and main does the rest.
 */

import { createContext, useCallback, useEffect, useMemo, useState } from 'react'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ChatContextValue {
  /** The workspace tree whose chat panel is open, or null. */
  openTreeId: string | null
  openChat: (treeId: string) => void
  closeChat: () => void
}

export const ChatContext = createContext<ChatContextValue>({
  openTreeId: null,
  openChat: () => undefined,
  closeChat: () => undefined,
})

// ---------------------------------------------------------------------------
// Attachments and which workspace a click means (D-19)
// ---------------------------------------------------------------------------

/** What was clicked, carried into the first message as text. */
export type ChatAttachment =
  | { kind: 'file'; workspaceTreeId: string; workspaceName: string; path: string }
  | { kind: 'note'; treeId: string; treeName: string; noteId: string; title: string }

/** Where a chat was asked for: a tree under the pointer, and what was clicked. */
export interface ChatTarget {
  treeId?: string
  attachment?: ChatAttachment
}

/** One tree in the space, as far as choosing a chat is concerned. */
export interface ChatTreeRef {
  id: string
  name: string
  kind: 'native' | 'vault' | 'workspace'
}

export type ChatWorkspaceChoice =
  | { treeId: string }
  | { choose: Array<{ treeId: string; name: string }> }
  | { none: true }

export function formatAttachment(_attachment: ChatAttachment): string {
  return ''
}

export function composeFirstMessage(_attachment: ChatAttachment | null, _text: string): string {
  return ''
}

export function chatWorkspaceFor(
  _target: ChatTarget,
  _openTrees: ChatTreeRef[],
  _lastChatTreeId: string | null,
): ChatWorkspaceChoice {
  return { none: true }
}

// ---------------------------------------------------------------------------
// Folding events into a transcript
// ---------------------------------------------------------------------------

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; streaming: boolean }
  | {
      kind: 'tool'
      id: string
      name: string
      input: unknown
      result: { isError: boolean; text: string } | null
    }
  | { kind: 'notice'; text: string }
  | { kind: 'error'; errorKind: TapestryChatErrorKind; message: string }

/**
 * What the panel shows for a list of events. Text deltas accumulate into the
 * current assistant block until its complete `text` replaces them; tool calls
 * and their results pair by id.
 */
export function foldChatEvents(events: TapestryChatEvent[]): ChatItem[] {
  const items: ChatItem[] = []
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()
  const last = (): ChatItem | undefined => items[items.length - 1]

  for (const event of events) {
    switch (event.type) {
      case 'user':
        items.push({ kind: 'user', text: event.text })
        break
      case 'text-delta': {
        const current = last()
        if (current?.kind === 'assistant' && current.streaming) {
          current.text += event.text
        } else {
          items.push({ kind: 'assistant', text: event.text, streaming: true })
        }
        break
      }
      case 'text': {
        const current = last()
        if (current?.kind === 'assistant' && current.streaming) {
          current.text = event.text
          current.streaming = false
        } else {
          items.push({ kind: 'assistant', text: event.text, streaming: false })
        }
        break
      }
      case 'tool-call': {
        const item: Extract<ChatItem, { kind: 'tool' }> = {
          kind: 'tool',
          id: event.id,
          name: event.name,
          input: event.input,
          result: null,
        }
        tools.set(event.id, item)
        items.push(item)
        break
      }
      case 'tool-result': {
        const item = tools.get(event.id)
        if (item) item.result = { isError: event.isError, text: event.text }
        break
      }
      case 'notice':
        items.push({ kind: 'notice', text: event.text })
        break
      case 'error':
        items.push({ kind: 'error', errorKind: event.kind, message: event.message })
        break
      case 'done':
        for (const item of items) {
          if (item.kind === 'assistant') item.streaming = false
        }
        break
      case 'session':
        break
    }
  }
  return items
}

/** Whether a turn is running after these events. */
function busyAfter(busy: boolean, event: TapestryChatEvent): boolean {
  if (event.type === 'user') return true
  if (event.type === 'done') return false
  return busy
}

// ---------------------------------------------------------------------------
// useChat
// ---------------------------------------------------------------------------

export interface UseChat {
  workspace: string
  transcript: ChatItem[]
  busy: boolean
  /** Why the last request to main failed, if it did. */
  error: string | null
  send: (text: string) => Promise<boolean>
  stop: () => Promise<void>
  newChat: () => Promise<void>
}

export function useChat(treeId: string): UseChat {
  const [events, setEvents] = useState<TapestryChatEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [workspace, setWorkspace] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let loaded = false
    let cancelled = false
    setEvents([])
    setBusy(false)
    setError(null)

    // Subscribe first. Events that arrive before open answers are already in
    // the transcript it returns, so they are dropped rather than doubled.
    const unsubscribe = window.tapestry.onChatEvent(({ treeId: id, event }) => {
      if (id !== treeId || !loaded) return
      setEvents((previous) => [...previous, event])
      setBusy((previous) => busyAfter(previous, event))
    })

    void window.tapestry.chat.open(treeId).then((result) => {
      if (cancelled) return
      loaded = true
      if (result.ok) {
        setWorkspace(result.value.workspace)
        setEvents(result.value.transcript)
        setBusy(result.value.busy)
      } else {
        setError(result.error)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [treeId])

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      setError(null)
      const result = await window.tapestry.chat.send(treeId, text)
      if (!result.ok) setError(result.error)
      return result.ok
    },
    [treeId],
  )

  const stop = useCallback(async () => {
    const result = await window.tapestry.chat.stop(treeId)
    if (!result.ok) setError(result.error)
  }, [treeId])

  const newChat = useCallback(async () => {
    const result = await window.tapestry.chat.newChat(treeId)
    if (result.ok) {
      setEvents([])
      setBusy(false)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [treeId])

  const transcript = useMemo(() => foldChatEvents(events), [events])

  return { workspace, transcript, busy, error, send, stop, newChat }
}
