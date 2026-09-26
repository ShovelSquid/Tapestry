/**
 * The one store behind every session card and the enlarged view (02.8 D-04).
 *
 * What matters: a live event makes a new snapshot and never changes the old
 * one (useSyncExternalStore relies on it), sessions never share state, and a
 * turn the note already holds is not drawn again from live events.
 *
 * No `window` is stubbed: the store's actions that reach main return early
 * without it, and the pure functions need none.
 */

import { describe, expect, it } from 'vitest'
import {
  EMPTY_CHAT_SESSION,
  applyChatPayload,
  busyAfter,
  chatSessionFor,
  chatSessionKey,
  forgetChatSession,
  recordChatPayload,
  requestComposerFocus,
  retainChatSessions,
  setChatAttachment,
  setChatDraft,
  type ChatSessionSnapshot,
} from './chat-sessions'
import { liveAfter, type ChatAttachment } from './chat'

const TREE = `sha256:${'a'.repeat(64)}`
const OTHER_TREE = `sha256:${'b'.repeat(64)}`

const loaded: ChatSessionSnapshot = { ...EMPTY_CHAT_SESSION, loaded: true }

describe('applyChatPayload', () => {
  it('adds one entry, sets busy on a user event, and leaves the old snapshot unchanged', () => {
    const before = loaded
    const after = applyChatPayload(before, { turn: 2, event: { type: 'user', text: 'hi' } })
    expect(after).not.toBe(before)
    expect(after.entries).toEqual([{ turn: 2, event: { type: 'user', text: 'hi' } }])
    expect(after.busy).toBe(true)
    expect(before.entries).toEqual([])
    expect(before.busy).toBe(false)
  })

  it('sets busy false on done', () => {
    const working = applyChatPayload(loaded, { turn: 1, event: { type: 'user', text: 'hi' } })
    const streaming = applyChatPayload(working, { turn: 1, event: { type: 'text-delta', text: 'Hel' } })
    expect(streaming.busy).toBe(true)
    const done = applyChatPayload(streaming, { turn: 1, event: { type: 'done', ok: true } })
    expect(done.busy).toBe(false)
    expect(done.entries).toHaveLength(3)
  })

  it('keeps the previous turn when a new one starts and drops older ones', () => {
    let s = loaded
    s = applyChatPayload(s, { turn: 1, event: { type: 'user', text: 'one' } })
    s = applyChatPayload(s, { turn: 1, event: { type: 'done', ok: true } })
    s = applyChatPayload(s, { turn: 2, event: { type: 'user', text: 'two' } })
    expect(s.entries.map((e) => e.turn)).toEqual([1, 1, 2])
    s = applyChatPayload(s, { turn: 2, event: { type: 'done', ok: true } })
    s = applyChatPayload(s, { turn: 3, event: { type: 'user', text: 'three' } })
    expect(s.entries.map((e) => e.turn)).toEqual([2, 2, 3])
  })
})

describe('busyAfter', () => {
  it('follows user and done and ignores the rest', () => {
    expect(busyAfter(false, { type: 'user', text: 'x' })).toBe(true)
    expect(busyAfter(true, { type: 'text', text: 'x' })).toBe(true)
    expect(busyAfter(true, { type: 'error', kind: 'crashed', message: 'x' })).toBe(true)
    expect(busyAfter(true, { type: 'done', ok: false })).toBe(false)
    expect(busyAfter(false, { type: 'notice', text: 'x' })).toBe(false)
  })
})

describe('liveAfter with the note turn count', () => {
  it('stops drawing a turn from live events once the note holds it', () => {
    let s = loaded
    s = applyChatPayload(s, { turn: 2, event: { type: 'user', text: 'hi' } })
    s = applyChatPayload(s, { turn: 2, event: { type: 'text', text: 'hello' } })
    s = applyChatPayload(s, { turn: 2, event: { type: 'done', ok: true } })
    // The tree refresh has not landed: the note says 1, so turn 2 is live.
    expect(liveAfter(s.entries, 1)).toHaveLength(3)
    // The note now says chat.turns 2: nothing is drawn twice.
    expect(liveAfter(s.entries, 2)).toEqual([])
  })
})

describe('the store', () => {
  const attachment: ChatAttachment = {
    kind: 'file',
    workspaceTreeId: TREE,
    workspaceName: 'ws',
    path: 'notes.md',
  }

  it('keeps each session’s draft and attachment to itself', () => {
    setChatDraft(TREE, 'n5', 'half a message')
    setChatAttachment(TREE, 'n5', attachment)
    expect(chatSessionFor(TREE, 'n5').draft).toBe('half a message')
    expect(chatSessionFor(TREE, 'n5').attachment).toBe(attachment)
    expect(chatSessionFor(TREE, 'n6').draft).toBe('')
    expect(chatSessionFor(TREE, 'n6').attachment).toBeNull()
    expect(chatSessionFor(OTHER_TREE, 'n5').draft).toBe('')
    forgetChatSession(TREE, 'n5')
    expect(chatSessionFor(TREE, 'n5')).toBe(EMPTY_CHAT_SESSION)
  })

  it('returns the same snapshot until something changes', () => {
    setChatDraft(TREE, 'n7', 'x')
    const first = chatSessionFor(TREE, 'n7')
    expect(chatSessionFor(TREE, 'n7')).toBe(first)
    setChatDraft(TREE, 'n7', 'x')
    expect(chatSessionFor(TREE, 'n7')).toBe(first)
    setChatDraft(TREE, 'n7', 'xy')
    expect(chatSessionFor(TREE, 'n7')).not.toBe(first)
    forgetChatSession(TREE, 'n7')
  })

  it('drops events for a session that has not loaded, and never changes another key', () => {
    setChatDraft(TREE, 'n8', 'draft')
    const other = chatSessionFor(TREE, 'n8')
    recordChatPayload({ treeId: TREE, noteId: 'n9', turn: 1, event: { type: 'user', text: 'hi' } })
    expect(chatSessionFor(TREE, 'n9')).toBe(EMPTY_CHAT_SESSION)
    expect(chatSessionFor(TREE, 'n8')).toBe(other)
    forgetChatSession(TREE, 'n8')
  })

  it('bumps the focus request with where it is for', () => {
    requestComposerFocus(TREE, 'n10')
    expect(chatSessionFor(TREE, 'n10').focusNonce).toBe(1)
    expect(chatSessionFor(TREE, 'n10').focusPlace).toBe('card')
    requestComposerFocus(TREE, 'n10', 'panel')
    expect(chatSessionFor(TREE, 'n10').focusNonce).toBe(2)
    expect(chatSessionFor(TREE, 'n10').focusPlace).toBe('panel')
    forgetChatSession(TREE, 'n10')
  })

  it('forgets the sessions of trees that are no longer open', () => {
    setChatDraft(TREE, 'n11', 'kept')
    setChatDraft(OTHER_TREE, 'n11', 'dropped')
    retainChatSessions(new Set([TREE]))
    expect(chatSessionFor(TREE, 'n11').draft).toBe('kept')
    expect(chatSessionFor(OTHER_TREE, 'n11')).toBe(EMPTY_CHAT_SESSION)
    forgetChatSession(TREE, 'n11')
  })

  it('keys a session by tree and note', () => {
    expect(chatSessionKey(TREE, 'n5')).toBe(`${TREE}:n5`)
  })
})
