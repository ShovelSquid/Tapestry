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
  acknowledgeChatSnapshot,
  acknowledgeSession,
  applyChatPayload,
  busyAfter,
  chatSessionFor,
  chatSessionKey,
  forgetChatSession,
  markNewSession,
  sessionAttention,
  sessionAttentions,
  openedStatus,
  recordChatPayload,
  requestComposerFocus,
  retainChatSessions,
  setChatAttachment,
  setChatDraft,
  sessionAuthorToken,
  setSessionAgentOrder,
  statusAnnouncement,
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

describe('the status in each snapshot (02.8-05, D-11, D-12)', () => {
  const status = (text: string, needs = false, level = 1): TapestryChatEvent => ({ type: 'status', text, needs, level })

  it('a needs status makes the session Needs you, a later done keeps it, and a user event clears it', () => {
    let s = applyChatPayload(loaded, { turn: 1, event: { type: 'user', text: 'hi' } }, 10)
    expect(s.status.state).toBe('working')
    s = applyChatPayload(s, { turn: 1, event: status('Which file should I read?', true) }, 20)
    expect(s.status.state).toBe('needs')
    expect(s.status.needs).toBe(true)
    s = applyChatPayload(s, { turn: 1, event: { type: 'done', ok: true } }, 30)
    expect(s.status.state).toBe('needs')
    expect(s.status.text).toBe('Which file should I read?')
    s = applyChatPayload(s, { turn: 2, event: { type: 'user', text: 'a.ts' } }, 40)
    expect(s.status.state).toBe('working')
    expect(s.status.needs).toBe(false)
  })

  it('never mutates the previous snapshot or its status', () => {
    const before = applyChatPayload(loaded, { turn: 1, event: { type: 'user', text: 'hi' } }, 10)
    const beforeStatus = before.status
    const frozen = JSON.stringify(before)
    const after = applyChatPayload(before, { turn: 1, event: status('Reading the parser') }, 20)
    expect(after.status).not.toBe(beforeStatus)
    expect(after.status.text).toBe('Reading the parser')
    expect(before.status).toBe(beforeStatus)
    expect(JSON.stringify(before)).toBe(frozen)
  })

  it('a done turn is Done, a failed one Failed, and a stopped one Idle with "Stopped"', () => {
    const working = applyChatPayload(loaded, { turn: 1, event: { type: 'user', text: 'hi' } }, 10)
    expect(applyChatPayload(working, { turn: 1, event: { type: 'done', ok: true } }, 20).status.state).toBe('done')
    const failed = applyChatPayload(
      working,
      { turn: 1, event: { type: 'error', kind: 'signed-out', message: 'x' } },
      20,
    )
    expect(failed.status.state).toBe('failed')
    expect(failed.status.text).toBe('Claude Code is signed out')
    const stopped = applyChatPayload(working, { turn: 1, event: { type: 'done', ok: false, reason: 'stopped' } }, 20)
    expect(stopped.status.state).toBe('idle')
    expect(stopped.status.text).toBe('Stopped')
  })

  it('a session loaded with { busy: false, lastStatus } starts Idle with that text (a relaunch)', () => {
    const s = openedStatus({ busy: false, lastStatus: 'write_file a.ts', live: [] }, 5)
    expect(s.state).toBe('idle')
    expect(s.text).toBe('write_file a.ts')
    expect(s.cardText).toBe('write_file a.ts')
    expect(s.needs).toBe(false)
    expect(s.level).toBe(0)
  })

  it('a session with no last status text starts with no text (the header says "New chat" for no turns)', () => {
    expect(openedStatus({ busy: false, lastStatus: null, live: [] }, 5).text).toBe('')
    expect(EMPTY_CHAT_SESSION.status.state).toBe('idle')
    expect(EMPTY_CHAT_SESSION.status.text).toBe('')
  })

  it('a session opened mid-turn folds that turn only', () => {
    const s = openedStatus(
      {
        busy: true,
        lastStatus: 'old',
        live: [
          { turn: 1, event: { type: 'user', text: 'one' } },
          { turn: 1, event: { type: 'done', ok: true } },
          { turn: 2, event: { type: 'user', text: 'two' } },
          { turn: 2, event: { type: 'tool-call', id: 't', name: 'mcp__tapestry__read_file', input: { path: 'a.ts' } } },
        ],
      },
      5,
    )
    expect(s.state).toBe('working')
    expect(s.text).toContain('read_file')
  })
})

describe('acknowledgement (02.8-05, D-11: the person looked)', () => {
  const user: TapestryChatEvent = { type: 'user', text: 'hi' }
  const working = applyChatPayload(loaded, { turn: 1, event: user }, 10)

  it('after a done payload gives Idle with the same text', () => {
    let s = applyChatPayload(working, { turn: 1, event: { type: 'status', text: 'Wrote plan.md', needs: false, level: 2 } }, 15)
    s = applyChatPayload(s, { turn: 1, event: { type: 'done', ok: true } }, 20)
    expect(s.status.state).toBe('done')
    const acked = acknowledgeChatSnapshot(s, 30)
    expect(acked.status.state).toBe('idle')
    expect(acked.status.text).toBe('Wrote plan.md')
    expect(s.status.state).toBe('done')
  })

  it('after a failed turn gives Idle keeping the short phrase', () => {
    const s = applyChatPayload(working, { turn: 1, event: { type: 'error', kind: 'not-installed', message: 'x' } }, 20)
    const acked = acknowledgeChatSnapshot(s, 30)
    expect(acked.status.state).toBe('idle')
    expect(acked.status.text).toBe("Claude Code isn't installed")
  })

  it('after a needs payload leaves Needs you standing', () => {
    let s = applyChatPayload(working, { turn: 1, event: { type: 'status', text: 'Which file?', needs: true, level: 3 } }, 15)
    s = applyChatPayload(s, { turn: 1, event: { type: 'done', ok: true } }, 20)
    const acked = acknowledgeChatSnapshot(s, 30)
    expect(acked).toBe(s)
    expect(acked.status.state).toBe('needs')
    expect(acked.status.needs).toBe(true)
  })

  it('on a Working session changes nothing', () => {
    expect(acknowledgeChatSnapshot(working, 30)).toBe(working)
  })

  it('on a session the store has not loaded changes nothing', () => {
    acknowledgeSession(TREE, 'n-ack')
    expect(chatSessionFor(TREE, 'n-ack')).toBe(EMPTY_CHAT_SESSION)
  })
})

describe('statusAnnouncement (UI-SPEC § Accessibility)', () => {
  const at = (state: string, text: string, level: number) =>
    ({ ...EMPTY_CHAT_SESSION.status, state, text, cardText: text, level }) as ChatSessionSnapshot['status']

  it('says done, needs you and failed, and nothing for Working or Idle', () => {
    expect(statusAnnouncement('Plan', at('working', 'x', 1), at('done', 'Wrote plan.md', 2))).toEqual({
      tone: 'polite',
      text: 'Plan: done. Wrote plan.md',
    })
    expect(statusAnnouncement('Plan', at('working', 'x', 1), at('needs', 'Which file?', 3))).toEqual({
      tone: 'polite',
      text: 'Plan needs you: Which file?',
    })
    expect(statusAnnouncement('Plan', at('working', 'x', 1), at('failed', 'Claude Code is signed out', 2))).toEqual({
      tone: 'assertive',
      text: 'Plan failed: Claude Code is signed out',
    })
    expect(statusAnnouncement('Plan', at('idle', 'x', 0), at('working', 'Reading your message', 1))).toBeNull()
    expect(statusAnnouncement('Plan', at('done', 'x', 2), at('idle', 'x', 0))).toBeNull()
  })

  it('says nothing at level 0 or when the state did not change', () => {
    expect(statusAnnouncement('Plan', at('working', 'x', 1), at('done', 'quiet', 0))).toBeNull()
    expect(statusAnnouncement('Plan', at('needs', 'a', 3), at('needs', 'b', 3))).toBeNull()
  })
})

describe('the session author colour', () => {
  it('follows the agents’ connection order and is unknown for an agent not in it', () => {
    setSessionAgentOrder(['claude', 'claude-chat-aaaaaaaa-n1', 'claude-chat-aaaaaaaa-n2'])
    expect(sessionAuthorToken('claude-chat-aaaaaaaa-n1')).toBe('--tap-author-2')
    expect(sessionAuthorToken('claude-chat-aaaaaaaa-n2')).toBe('--tap-author-3')
    expect(sessionAuthorToken('someone-else')).toBe('--tap-author-unknown')
    setSessionAgentOrder([])
    expect(sessionAuthorToken('claude-chat-aaaaaaaa-n1')).toBe('--tap-author-unknown')
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

describe('new sessions and attention (02.8-06, D-16, A-08)', () => {
  it('a new chat asks like a level-2 arrival until looked at', () => {
    markNewSession(TREE, 'n20')
    expect(chatSessionFor(TREE, 'n20').isNew).toBe(true)
    expect(sessionAttention(chatSessionKey(TREE, 'n20'))).toMatchObject({ kind: 'new', level: 2 })
    acknowledgeSession(TREE, 'n20', 5)
    expect(chatSessionFor(TREE, 'n20').isNew).toBe(false)
    expect(sessionAttention(chatSessionKey(TREE, 'n20'))).toBeNull()
    forgetChatSession(TREE, 'n20')
  })

  it('focus alone leaves a new chat new (its composer takes focus by itself)', () => {
    const fresh = { ...loaded, isNew: true }
    expect(acknowledgeChatSnapshot(fresh, 1, { keepNew: true })).toBe(fresh)
    expect(acknowledgeChatSnapshot(fresh, 1).isNew).toBe(false)
  })

  it('an empty session starts not new', () => {
    expect(EMPTY_CHAT_SESSION.isNew).toBe(false)
  })

  it('lists only the sessions that ask, with their author colour', () => {
    markNewSession(TREE, 'n21')
    setChatDraft(TREE, 'n22', 'quiet')
    const map = sessionAttentions([chatSessionKey(TREE, 'n21'), chatSessionKey(TREE, 'n22'), chatSessionKey(TREE, 'n23')])
    expect([...map.keys()]).toEqual([chatSessionKey(TREE, 'n21')])
    expect(map.get(chatSessionKey(TREE, 'n21'))?.author).toMatch(/^--tap-author-/)
    forgetChatSession(TREE, 'n21')
    forgetChatSession(TREE, 'n22')
  })
})
