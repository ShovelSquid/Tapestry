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
 *
 * Each snapshot also carries the session's status (02.8 D-10..D-14): the
 * state, status text and level that `reduceStatus` (shared/chat/
 * session-status.ts) derives from every event heard, plus the person's
 * acknowledgement. It is chrome: never written to a tree, a commit or a hash.
 * After a relaunch a session starts Idle with the last status text main kept
 * (D-12), never a stale Working.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { composeFirstMessage, type ChatAttachment, type LiveEntry } from './chat'
import {
  attentionOf,
  initialStatus,
  reduceStatus,
  type Attention,
  type SessionStatus,
} from '../../shared/chat/session-status'
import { authorToken, type AuthorToken } from '../threads/author-palette'

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
  /**
   * What the card and the enlarged view show: state, status text and level
   * (D-11, D-13, D-14). Renderer state only (D-10).
   */
  readonly status: SessionStatus
  /**
   * Made by the person just now (a new chat, a fork) and not yet looked at:
   * an arrival like a level-2 Done, so a card that landed off-screen gets an
   * edge arrow instead of the camera moving (A-08). Renderer state only.
   */
  readonly isNew: boolean
}

/**
 * A session's status when main answers `open` (D-12). A relaunch has no
 * engine, so a session that is not busy is Idle with its last status text.
 * A busy one (the renderer reloaded mid-turn) is folded from its running
 * turn's events, so its text is the turn's, not "Reading your message".
 *
 * The store does not know the note's committed turns (the note is the
 * tree's, and a composer may ask for the session before its card does), so
 * a session with no last status text starts with an empty text here, and
 * ChatSessionHeader shows "New chat" for it while the note has no turns.
 */
export function openedStatus(
  opened: { busy: boolean; lastStatus: string | null; live: readonly LiveEntry[] },
  now: number,
): SessionStatus {
  // turns: 1 means "not known to be empty": no text rather than 'New chat'.
  let status = initialStatus({ busy: opened.busy, lastStatus: opened.lastStatus, turns: 1 })
  if (!opened.busy || opened.live.length === 0) return status
  const current = opened.live[opened.live.length - 1].turn
  for (const entry of opened.live) {
    if (entry.turn === current) status = reduceStatus(status, { kind: 'event', event: entry.event }, now)
  }
  return status
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
  status: Object.freeze(initialStatus({ busy: false, lastStatus: null, turns: 1 })),
  isNew: false,
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
 *
 * Every event also runs the status reducer, so the state is what was
 * observed (D-11): Needs you persists through `done` and clears only on a
 * `user` event in this session.
 */
export function applyChatPayload(
  snapshot: ChatSessionSnapshot,
  payload: { turn: number; event: TapestryChatEvent },
  now: number = Date.now(),
): ChatSessionSnapshot {
  const kept =
    payload.event.type === 'user'
      ? snapshot.entries.filter((entry) => entry.turn >= payload.turn - 1)
      : snapshot.entries
  return {
    ...snapshot,
    entries: [...kept, { turn: payload.turn, event: payload.event }],
    busy: busyAfter(snapshot.busy, payload.event),
    status: reduceStatus(snapshot.status, { kind: 'event', event: payload.event }, now),
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
              status: openedStatus(result.value, Date.now()),
            }
          : { ...s, loaded: true, error: result.error },
      )
    })
}

/** A session, live: the card and the panel both read this. */
export function useChatSession(treeId: string, noteId: string): ChatSessionSnapshot {
  const snapshot = useSyncExternalStore(subscribe, () => chatSessionFor(treeId, noteId))
  // Once per key; checked again when the snapshot changes, so a session
  // forgotten while its card stays drawn (its tree closed and reopened) loads
  // afresh.
  useEffect(() => {
    loadChatSession(treeId, noteId)
  }, [treeId, noteId, snapshot])
  return snapshot
}

// ---------------------------------------------------------------------------
// Acknowledgement and announcements (D-11, UI-SPEC § Leaving a state)
// ---------------------------------------------------------------------------

/**
 * The person looked at a session: Done and Failed become Idle, keeping their
 * status text, and a new chat is no longer new. Needs you clears only on a
 * reply, and Working and Idle have nothing to acknowledge, so those return
 * the same snapshot.
 *
 * `keepNew` leaves a new chat's arrival alone: focus alone does not count
 * for it, because a new chat's composer takes focus by itself (the person
 * has not seen where the card landed yet).
 */
export function acknowledgeChatSnapshot(
  snapshot: ChatSessionSnapshot,
  now: number,
  options: { keepNew?: boolean } = {},
): ChatSessionSnapshot {
  const status = reduceStatus(snapshot.status, { kind: 'ack' }, now)
  const isNew = options.keepNew === true ? snapshot.isNew : false
  if (status === snapshot.status && isNew === snapshot.isNew) return snapshot
  return { ...snapshot, status, isNew }
}

/**
 * Acknowledge a session: the pointer rested on its card for 1000 ms, focus
 * went into the card, it was enlarged, or the person sent in it. Renderer
 * state only; nothing is written.
 */
export function acknowledgeSession(
  treeId: string,
  noteId: string,
  now: number = Date.now(),
  options: { keepNew?: boolean } = {},
): void {
  update(treeId, noteId, (s) => acknowledgeChatSnapshot(s, now, options))
}

/**
 * A session the person just made (a new chat, or a fork): it arrives like a
 * level-2 Done until looked at (A-08), so if it landed off-screen it gets an
 * edge arrow. Nothing moves the camera.
 */
export function markNewSession(treeId: string, noteId: string): void {
  update(treeId, noteId, (s) => (s.isNew ? s : { ...s, isNew: true }))
}

// ---------------------------------------------------------------------------
// Attention for edge arrows (D-16)
// ---------------------------------------------------------------------------

/** What one session asks for, with the author colour its arrow is drawn in. */
export interface SessionAttention extends Attention {
  /** The CSS variable naming the session's author colour. */
  author: AuthorToken
}

/** What the session under `key` asks for right now, or null. */
export function sessionAttention(key: string): SessionAttention | null {
  const s = sessions.get(key)
  if (!s) return null
  const attention = attentionOf(s.status, s.isNew)
  return attention ? { ...attention, author: sessionAuthorToken(s.agent) } : null
}

/** Every asking session among `keys`, by key. Keys that ask for nothing are left out. */
export function sessionAttentions(keys: readonly string[]): Map<string, SessionAttention> {
  const out = new Map<string, SessionAttention>()
  for (const key of keys) {
    const attention = sessionAttention(key)
    if (attention) out.set(key, attention)
  }
  return out
}

function attentionsSignature(map: ReadonlyMap<string, SessionAttention>): string {
  let sig = ''
  for (const [key, a] of map) sig += `${key}=${a.kind}/${a.level}/${a.author};`
  return sig
}

/**
 * sessionAttentions, live, for many sessions at once (the edge-arrow layer
 * needs every session card, and hooks cannot run in a loop). One
 * subscription; the map keeps its identity until what it says changes.
 */
export function useSessionAttentions(keys: readonly string[]): ReadonlyMap<string, SessionAttention> {
  const cache = useRef<{ sig: string; map: ReadonlyMap<string, SessionAttention> }>({ sig: '', map: new Map() })
  const read = (): ReadonlyMap<string, SessionAttention> => {
    const map = sessionAttentions(keys)
    const sig = attentionsSignature(map)
    if (sig === cache.current.sig) return cache.current.map
    cache.current = { sig, map }
    return map
  }
  return useSyncExternalStore(subscribe, read)
}

/** What LiveAnnouncer says about a state change, and in which region. */
export interface StatusAnnouncement {
  tone: 'polite' | 'assertive'
  text: string
}

/**
 * The announcement for a change from `before` to `after` (UI-SPEC
 * § Accessibility), or null. Only a change into Done, Needs you or Failed at
 * level 1 or above is announced; Working is continuous and never announced.
 * The card calls this, never the panel, so a session is announced once.
 */
export function statusAnnouncement(
  title: string,
  before: SessionStatus,
  after: SessionStatus,
): StatusAnnouncement | null {
  if (before.state === after.state || after.level < 1) return null
  const text = after.text
  switch (after.state) {
    case 'done':
      return { tone: 'polite', text: text.length > 0 ? `${title}: done. ${text}` : `${title}: done.` }
    case 'needs':
      return { tone: 'polite', text: text.length > 0 ? `${title} needs you: ${text}` : `${title} needs you` }
    case 'failed':
      return { tone: 'assertive', text: `${title} failed: ${text}` }
    case 'idle':
    case 'working':
      return null
  }
}

// ---------------------------------------------------------------------------
// Author colour (UI-SPEC § Author colour for sessions)
// ---------------------------------------------------------------------------

/** Agent names in connection order, as App last passed them. */
let agentOrder: readonly string[] = []

/**
 * The agents' connection order (`orderAgentsByConnection(agents)`), set by
 * App whenever its agent list changes. Each session is its own agent (D-03),
 * so this gives each session its palette slot.
 */
export function setSessionAgentOrder(orderedNames: readonly string[]): void {
  if (orderedNames.length === agentOrder.length && orderedNames.every((name, i) => name === agentOrder[i])) return
  agentOrder = [...orderedNames]
  notify()
}

/**
 * The CSS variable naming a session's author colour, from its agent name
 * (without `agent.`). Set inline as `--tap-session-author`; never written.
 */
export function sessionAuthorToken(agent: string): AuthorToken {
  return authorToken(`agent.${agent}`, agentOrder)
}

/** sessionAuthorToken, live: a card redraws when the agent order changes. */
export function useSessionAuthorToken(agent: string): AuthorToken {
  return useSyncExternalStore(subscribe, () => sessionAuthorToken(agent))
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
  // Sending is looking (D-11): Done and Failed go quiet. Needs you waits for
  // the `user` event main sends back once it accepts the message.
  acknowledgeSession(treeId, noteId)
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
  // An arrival: if the card landed off-screen, an edge arrow says where (A-08).
  markNewSession(treeId, noteId)
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
