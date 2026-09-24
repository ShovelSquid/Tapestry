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
  /**
   * Open the chat for where the person asked (D-19): a tree clicked in and
   * what was clicked. Which workspace that means is chatWorkspaceFor's rule.
   */
  openChat: (target?: ChatTarget) => void
  closeChat: () => void
  /** A tree's name, for building an attachment; '' when it is not open. */
  treeName: (treeId: string) => string
}

export const ChatContext = createContext<ChatContextValue>({
  openTreeId: null,
  openChat: () => undefined,
  closeChat: () => undefined,
  treeName: () => '',
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

/** A title as one line, safe inside double quotes. */
function quoteTitle(title: string): string {
  return title.replace(/\r\n|\r|\n/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * The attachment as the line that starts the first message. Text only: an
 * attachment never goes anywhere but the message the person sends.
 */
export function formatAttachment(attachment: ChatAttachment): string {
  if (attachment.kind === 'file') {
    return `Context: the file ${attachment.path} in the workspace ${attachment.workspaceName}.`
  }
  return `Context: the note ${attachment.noteId} "${quoteTitle(attachment.title)}" in the tree ${attachment.treeName} (${attachment.treeId}). Read it with read_note.`
}

/** The attachment line, a blank line, then what the person typed. */
export function composeFirstMessage(attachment: ChatAttachment | null, text: string): string {
  return attachment ? `${formatAttachment(attachment)}\n\n${text}` : text
}

/**
 * Which workspace's chat a click opens (D-19): a file's own workspace, else
 * the workspace clicked in, else the last chat used while it is still open,
 * else the only open workspace; several open means asking, none means saying so.
 */
export function chatWorkspaceFor(
  target: ChatTarget,
  openTrees: ChatTreeRef[],
  lastChatTreeId: string | null,
): ChatWorkspaceChoice {
  const workspaces = openTrees.filter((tree) => tree.kind === 'workspace')
  const isOpen = (id: string | null | undefined): id is string =>
    typeof id === 'string' && workspaces.some((tree) => tree.id === id)

  if (target.attachment?.kind === 'file' && isOpen(target.attachment.workspaceTreeId)) {
    return { treeId: target.attachment.workspaceTreeId }
  }
  if (isOpen(target.treeId)) return { treeId: target.treeId }
  if (isOpen(lastChatTreeId)) return { treeId: lastChatTreeId }
  if (workspaces.length === 1) return { treeId: workspaces[0].id }
  if (workspaces.length > 1) {
    return { choose: workspaces.map((tree) => ({ treeId: tree.id, name: tree.name })) }
  }
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
  /** The chat's Allow shell (not sandboxed) switch (D-15). */
  allowShell: boolean
  /** Change the switch; the panel confirms before turning it on. */
  setAllowShell: (on: boolean) => Promise<void>
}

export function useChat(treeId: string): UseChat {
  const [events, setEvents] = useState<TapestryChatEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [workspace, setWorkspace] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [allowShell, setAllowShellState] = useState(false)

  useEffect(() => {
    let loaded = false
    let cancelled = false
    setEvents([])
    setBusy(false)
    setError(null)
    setAllowShellState(false)

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
        setAllowShellState(result.value.allowShell)
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
      // A new chat starts sandboxed.
      setAllowShellState(false)
    } else {
      setError(result.error)
    }
  }, [treeId])

  const setAllowShell = useCallback(
    async (on: boolean) => {
      setError(null)
      const result = await window.tapestry.chat.setAllowShell(treeId, on)
      if (result.ok) setAllowShellState(on)
      else setError(result.error)
    },
    [treeId],
  )

  const transcript = useMemo(() => foldChatEvents(events), [events])

  return { workspace, transcript, busy, error, send, stop, newChat, allowShell, setAllowShell }
}
