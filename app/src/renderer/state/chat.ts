/**
 * The renderer's side of the in-app chats (02.7 D-12, 02.8 D-02, D-04).
 *
 * A chat is a session note in a workspace tree, drawn on the canvas as its
 * session card. ChatContext lets any component start one (a frame header's
 * New chat, Ask Claude… on a note, a file or the canvas) and open one in the
 * docked panel, its enlarged view, without threading props through the
 * canvas. Each session's live state is in state/chat-sessions.ts, the one
 * store the card and the panel both read. Committed turns are not there:
 * they are the note's own text (D-09), and only the turn in progress comes
 * from live events.
 *
 * The renderer never sees a token or a config path: it sends text, a tree id
 * and a note id, and main does the rest.
 */

import { createContext } from 'react'
import { isStatusTool } from '../../shared/chat/transcript'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ChatContextValue {
  /** The session the enlarged view (the docked panel) shows, or null. */
  openSession: { treeId: string; noteId: string } | null
  /**
   * Start a chat for where the person asked (D-19): which workspace that
   * means is chatWorkspaceFor's rule. In that workspace a new session note is
   * made (at `target.at`, or at the next free spot), its card's composer
   * takes focus, and the camera does not move. Resolves to the new session,
   * or null when the chooser or the no-workspace panel opened instead, or
   * main refused.
   */
  openChat: (target?: ChatTarget) => Promise<{ treeId: string; noteId: string } | null>
  /** Open a session in the enlarged view. */
  enlarge: (treeId: string, noteId: string) => void
  /** Close the enlarged view. A running turn keeps running (UI-SPEC A-12). */
  backToCard: () => void
  /** A tree's name, for building an attachment; '' when it is not open. */
  treeName: (treeId: string) => string
}

export const ChatContext = createContext<ChatContextValue>({
  openSession: null,
  openChat: async () => null,
  enlarge: () => undefined,
  backToCard: () => undefined,
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
  /** Where to put the new session, frame-local to `treeId` (the pointer). */
  at?: { x: number; y: number }
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
 * and their results pair by id. `set_status` calls and `status` events are
 * left out, as the committed passage leaves them out (D-10).
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
        // set_status is status, never a transcript row: the committed
        // passage leaves it out, so the live turn does too (D-10).
        if (isStatusTool(event.name)) break
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
      case 'status':
        break
    }
  }
  return items
}

/** One live event with the turn it belongs to. */
export interface LiveEntry {
  turn: number
  event: TapestryChatEvent
}

/**
 * The live events still worth showing: those of turns the note does not hold
 * yet. Keyed on the note's committed turn count rather than on `done`, so a
 * turn is never shown twice or missing while the tree refresh is in flight.
 */
export function liveAfter<E extends { turn: number }>(entries: readonly E[], committedTurns: number): E[] {
  return entries.filter((entry) => entry.turn > committedTurns)
}
