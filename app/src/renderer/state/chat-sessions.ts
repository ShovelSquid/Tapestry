/**
 * Every chat session the renderer draws, in one store (02.8 D-04, D-06).
 *
 * The session card on the canvas and the docked panel (its enlarged view)
 * read the same snapshot, keyed `<treeId>:<noteId>`, so they can never
 * disagree: the same live turn, the same busy flag, and one draft per session
 * (text typed on the card is there when the panel opens).
 *
 * Follows state/workspace-status.ts: module-level maps, a listener set, one
 * lazy `onChatEvent` subscription for the whole renderer, and
 * `useSyncExternalStore` over snapshots that are replaced, never mutated, so
 * React sees a new reference exactly when something changed.
 *
 * The 02.7 rule stays: a session's events heard before its `chat.open`
 * answers are dropped, because the `live` list open returns already holds
 * them. Committed turns are not here: they are the note's own text (D-09).
 *
 * Nothing in this store is written anywhere. The draft and attachment are
 * view state; the renderer never sees a token or a config path.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { composeFirstMessage, type ChatAttachment, type LiveEntry } from './chat'

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** Which composer a focus request is for. */
export type ComposerPlace = 'card' | 'panel'

export interface ChatSessionSnapshot {
  /** True once `chat.open` has answered (or failed). Before that, events are dropped. */
  readonly loaded: boolean
  /** The workspace's name. */
  readonly workspace: string
  /** The session's agent name, without the `agent.` prefix. */
  readonly agent: string
  /** Events not yet committed into the note, each with its turn. */
  readonly entries: readonly LiveEntry[]
  readonly busy: boolean
  /** A send is on its way to main. */
  readonly sending: boolean
  /** The chat's Allow shell (not sandboxed) switch (02.7 D-15). */
  readonly allowShell: boolean
  /** What the person has typed and not sent, shared by card and panel. */
  readonly draft: string
  /** What Ask Claude… attached, sent with the next message. */
  readonly attachment: ChatAttachment | null
  /** Why the last request to main failed, if it did. */
  readonly error: string | null
  /** Bumped to ask a composer to take focus once. */
  readonly focusNonce: number
  readonly focusPlace: ComposerPlace
}

export const EMPTY_CHAT_SESSION: ChatSessionSnapshot = Object.freeze({
  loaded: false,
  workspace: '',
  agent: '',
  entries: Object.freeze([]) as readonly LiveEntry[],
  busy: false,
  sending: false,
  allowShell: false,
  draft: '',
  attachment: null,
  error: null,
  focusNonce: 0,
  focusPlace: 'card' as ComposerPlace,
})

/** The store key for one session. */
export function chatSessionKey(treeId: string, noteId: string): string {
  return `${treeId}:${noteId}`
}

/** Whether a turn is running after this event. */
export function busyAfter(busy: boolean, event: TapestryChatEvent): boolean {
  if (event.type === 'user') return true
  if (event.type === 'done') return false
  return busy
}

/**
 * A snapshot with one more live event. Returns a new snapshot; the old one is
 * left as it was.
 *
 * When a new turn starts (its `user` event), entries two or more turns older
 * are dropped: they were committed into the note long ago, and the renderer
 * draws them from its text. The previous turn's entries are kept one turn
 * longer, so a slow tree refresh never leaves a gap.
 */
export function applyChatPayload(
  snapshot: ChatSessionSnapshot,
  payload: { turn: number; event: TapestryChatEvent },
): ChatSessionSnapshot {
  const kept =
    payload.event.type === 'user'
      ? snapshot.entries.filter((entry) => entry.turn >= payload.turn - 1)
      : snapshot.entries
  return {
    ...snapshot,
    entries: [...kept, { turn: payload.turn, event: payload.event }],
    busy: busyAfter(snapshot.busy, payload.event),
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const sessions = new Map<string, ChatSessionSnapshot>()
/** Keys whose `chat.open` has been asked for. */
const requested = new Set<string>()
const listeners = new Set<() => void>()
let subscribed = false

function notify(): void {
  for (const listener of listeners) listener()
}

/** One session's snapshot (EMPTY_CHAT_SESSION before anything is known). */
export function chatSessionFor(treeId: string, noteId: string): ChatSessionSnapshot {
  return sessions.get(chatSessionKey(treeId, noteId)) ?? EMPTY_CHAT_SESSION
}

function update(treeId: string, noteId: string, change: (s: ChatSessionSnapshot) => ChatSessionSnapshot): void {
  const key = chatSessionKey(treeId, noteId)
  const before = sessions.get(key) ?? EMPTY_CHAT_SESSION
  const after = change(before)
  if (after === before) return
  sessions.set(key, after)
  notify()
}

/** One chat event from main. Exported for tests; the subscription calls it. */
export function recordChatPayload(payload: TapestryChatEventPayload): void {
  const current = sessions.get(chatSessionKey(payload.treeId, payload.noteId))
  // Not loaded yet: open's `live` list will hold this event.
  if (!current || !current.loaded) return
  update(payload.treeId, payload.noteId, (s) => applyChatPayload(s, payload))
}

/** Install the renderer's one chat-event subscription. Called once from App. */
export function ensureChatSessionsSubscribed(): void {
  if (subscribed) return
  if (typeof window === 'undefined' || !window.tapestry?.onChatEvent) return
  subscribed = true
  window.tapestry.onChatEvent(recordChatPayload)
}

function subscribe(listener: () => void): () => void {
  ensureChatSessionsSubscribed()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Ask main for a session's state, once per key. Its answer replaces the live
 * list and busy flag and keeps the draft, attachment and focus request, which
 * may have been set before it answered (a new chat's chip).
 */
export function loadChatSession(treeId: string, noteId: string): void {
  const key = chatSessionKey(treeId, noteId)
  if (requested.has(key)) return
  if (typeof window === 'undefined' || !window.tapestry?.chat) return
  requested.add(key)
  ensureChatSessionsSubscribed()
  void window.tapestry.chat
    .open(treeId, noteId)
    .then(
      (result) => result,
      (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
    )
    .then((result) => {
      // Forgotten while open was in flight (deleted, or its tree closed).
      if (!requested.has(key)) return
      update(treeId, noteId, (s) =>
        result.ok
          ? {
              ...s,
              loaded: true,
              workspace: result.value.workspace,
              agent: result.value.agent,
              entries: result.value.live,
              busy: result.value.busy,
              allowShell: result.value.allowShell,
            }
          : { ...s, loaded: true, error: result.error },
      )
    })
}

/** A session, live: the card and the panel both read this. */
export function useChatSession(treeId: string, noteId: string): ChatSessionSnapshot {
  useEffect(() => {
    loadChatSession(treeId, noteId)
  }, [treeId, noteId])
  return useSyncExternalStore(subscribe, () => chatSessionFor(treeId, noteId))
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function setChatDraft(treeId: string, noteId: string, draft: string): void {
  update(treeId, noteId, (s) => (s.draft === draft ? s : { ...s, draft }))
}

export function setChatAttachment(treeId: string, noteId: string, attachment: ChatAttachment | null): void {
  update(treeId, noteId, (s) => (s.attachment === attachment ? s : { ...s, attachment }))
}

/** Ask the session's composer (on its card unless said otherwise) to take focus once. */
export function requestComposerFocus(treeId: string, noteId: string, place: ComposerPlace = 'card'): void {
  update(treeId, noteId, (s) => ({ ...s, focusNonce: s.focusNonce + 1, focusPlace: place }))
}

/**
 * Send the draft, with the attachment's line first when there is one. The
 * draft and attachment are cleared only once main accepts the message.
 */
export async function sendChatSession(treeId: string, noteId: string): Promise<boolean> {
  const s = chatSessionFor(treeId, noteId)
  if (s.draft.trim().length === 0 || s.busy || s.sending) return false
  const sentDraft = s.draft
  const sentAttachment = s.attachment
  update(treeId, noteId, (c) => ({ ...c, sending: true, error: null }))
  let result: TapestryChatResult<null>
  try {
    result = await window.tapestry.chat.send(treeId, noteId, composeFirstMessage(sentAttachment, sentDraft))
  } catch (err) {
    result = { ok: false, error: errorText(err) }
  }
  update(treeId, noteId, (c) => {
    if (!result.ok) return { ...c, sending: false, error: result.error }
    // Keep anything typed while the send was on its way.
    return {
      ...c,
      sending: false,
      draft: c.draft === sentDraft ? '' : c.draft,
      attachment: c.attachment === sentAttachment ? null : c.attachment,
    }
  })
  return result.ok
}

/** Stop reply: the only thing that stops a turn (UI-SPEC A-12). */
export async function stopChatSession(treeId: string, noteId: string): Promise<void> {
  let result: TapestryChatResult<null>
  try {
    result = await window.tapestry.chat.stop(treeId, noteId)
  } catch (err) {
    result = { ok: false, error: errorText(err) }
  }
  if (!result.ok) {
    const error = result.error
    update(treeId, noteId, (s) => ({ ...s, error }))
  }
}

/** The chat's shell switch (02.7 D-15); the panel confirms before turning it on. */
export async function setChatShell(treeId: string, noteId: string, on: boolean): Promise<void> {
  update(treeId, noteId, (s) => (s.error === null ? s : { ...s, error: null }))
  let result: TapestryChatResult<null>
  try {
    result = await window.tapestry.chat.setAllowShell(treeId, noteId, on)
  } catch (err) {
    result = { ok: false, error: errorText(err) }
  }
  if (result.ok) update(treeId, noteId, (s) => ({ ...s, allowShell: on }))
  else {
    const error = result.error
    update(treeId, noteId, (s) => ({ ...s, error }))
  }
}

/**
 * New chat: main writes a session note into the workspace (at `at`, a
 * frame-local point, or at its next free spot), the attachment goes into the
 * new session's draft, and its card's composer is asked to take focus. The
 * camera is never moved (D-16). Returns the new ids, or the refusal.
 */
export async function createChatSession(
  treeId: string,
  at?: { x: number; y: number },
  attachment?: ChatAttachment | null,
  focusPlace: ComposerPlace = 'card',
): Promise<{ ok: true; treeId: string; noteId: string } | { ok: false; error: string }> {
  let result: TapestryChatResult<{ noteId: string; agent: string }>
  try {
    result = await window.tapestry.chat.create(treeId, at ? { at } : undefined)
  } catch (err) {
    result = { ok: false, error: errorText(err) }
  }
  if (!result.ok) return { ok: false, error: result.error }
  const noteId = result.value.noteId
  if (attachment) setChatAttachment(treeId, noteId, attachment)
  requestComposerFocus(treeId, noteId, focusPlace)
  return { ok: true, treeId, noteId }
}

/** Drop a session from the store (deleted). A later use loads it afresh. */
export function forgetChatSession(treeId: string, noteId: string): void {
  const key = chatSessionKey(treeId, noteId)
  requested.delete(key)
  if (sessions.delete(key)) notify()
}

/**
 * Drop every session whose tree is no longer open, so a workspace closed and
 * opened again loads its sessions afresh from main.
 */
export function retainChatSessions(openTreeIds: ReadonlySet<string>): void {
  let changed = false
  const treeOf = (key: string): string => key.slice(0, key.lastIndexOf(':'))
  for (const key of [...requested]) {
    if (!openTreeIds.has(treeOf(key))) requested.delete(key)
  }
  for (const key of [...sessions.keys()]) {
    if (openTreeIds.has(treeOf(key))) continue
    sessions.delete(key)
    changed = true
  }
  if (changed) notify()
}
