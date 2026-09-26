/**
 * The status reducer (02.8-04, D-10..D-14, SC4): five states observed from
 * events, never guessed from reply text; the status line; levels; and the last
 * status text main keeps across a relaunch.
 */

import { describe, expect, it } from 'vitest'
import {
  attentionOf,
  clampLevel,
  FAILED_PHRASES,
  failedPhrase,
  initialStatus,
  NEW_CHAT_TEXT,
  READING_TEXT,
  reduceStatus,
  shouldAnimate,
  STATE_WORDS,
  STATUS_LEVEL_CEILING,
  statusLine,
  statusTextAfterTurn,
  STOPPED_TEXT,
  type SessionStatus,
  type StatusEvent,
} from './session-status'

/** Feed events (and acks) in order, one millisecond apart. */
function run(start: SessionStatus, inputs: Array<StatusEvent | 'ack'>): SessionStatus {
  let status = start
  inputs.forEach((input, index) => {
    status = reduceStatus(status, input === 'ack' ? { kind: 'ack' } : { kind: 'event', event: input }, index + 1)
  })
  return status
}

const idle = (): SessionStatus => initialStatus({ busy: false, lastStatus: null })
const user = (text = 'hi'): StatusEvent => ({ type: 'user', text })
const doneOk: StatusEvent = { type: 'done', ok: true, reason: 'success' }
const status = (text: string, extra: { needs?: boolean; level?: number } = {}): StatusEvent => ({
  type: 'status',
  text,
  needs: extra.needs ?? false,
  level: extra.level ?? 1,
})

describe('initialStatus (D-12)', () => {
  it('after a relaunch a session is Idle with its last status text, never a stale Working', () => {
    const s = initialStatus({ busy: false, lastStatus: 'write_file a.ts' })
    expect(s.state).toBe('idle')
    expect(s.text).toBe('write_file a.ts')
    expect(s.cardText).toBe('write_file a.ts')
    expect(s.needs).toBe(false)
  })

  it('a busy session opens as Working, reading your message', () => {
    const s = initialStatus({ busy: true, lastStatus: null })
    expect(s.state).toBe('working')
    expect(s.text).toBe(READING_TEXT)
    expect(READING_TEXT).toBe('Reading your message')
  })

  it("a session with no turns says 'New chat'", () => {
    expect(idle().text).toBe(NEW_CHAT_TEXT)
    expect(NEW_CHAT_TEXT).toBe('New chat')
  })
})

describe('reduceStatus: status text (D-13)', () => {
  it('user gives Working, then the latest tool label, then the first line of the latest reply', () => {
    let s = run(idle(), [user()])
    expect(s.state).toBe('working')
    expect(s.text).toBe('Reading your message')
    s = run(s, [{ type: 'tool-call', id: 't1', name: 'write_file', input: { path: 'a.ts', text: 'secret' } }])
    expect(s.text).toBe('write_file a.ts')
    s = run(s, [{ type: 'text', text: 'Done.\nMore' }])
    expect(s.text).toBe('Done.')
    expect(s.state).toBe('working')
  })

  it('the tool label drops the MCP prefix and never holds a payload', () => {
    const s = run(idle(), [
      user(),
      { type: 'tool-call', id: 't1', name: 'mcp__tapestry__edit_file', input: { path: 'src/x.ts', new_string: 'SECRET' } },
    ])
    expect(s.text).toBe('edit_file src/x.ts')
  })

  it('a set_status text earlier in the turn keeps its place over later tool calls and replies', () => {
    const s = run(idle(), [
      user(),
      status('Reading the parser'),
      { type: 'tool-call', id: 't1', name: 'read_file', input: { path: 'p.ts' } },
      { type: 'text', text: 'Here it is' },
    ])
    expect(s.text).toBe('Reading the parser')
  })

  it('a new turn forgets the last turn’s set_status text', () => {
    const s = run(idle(), [
      user(),
      status('Reading'),
      doneOk,
      user(),
      { type: 'tool-call', id: 't2', name: 'list_files', input: {} },
    ])
    expect(s.text).toBe('list_files')
  })

  it('a set_status call is never its own status text; its status event is', () => {
    const s = run(idle(), [
      user(),
      { type: 'tool-call', id: 't1', name: 'mcp__tapestry__set_status', input: { text: 'x' } },
    ])
    expect(s.text).toBe(READING_TEXT)
  })

  it('never guesses Needs you from reply text', () => {
    const s = run(idle(), [user(), { type: 'text', text: 'Do you need me? I need you to answer, please?' }, doneOk])
    expect(s.state).toBe('done')
    expect(s.needs).toBe(false)
  })
})

describe('reduceStatus: Needs you (D-11)', () => {
  it('needs raises Needs you at level 3; it persists through done and ack and clears only on user', () => {
    let s = run(idle(), [user(), status('Which file?', { needs: true, level: 1 })])
    expect(s.state).toBe('needs')
    expect(s.level).toBe(3)
    expect(s.needs).toBe(true)
    s = run(s, [doneOk])
    expect(s.state).toBe('needs')
    s = run(s, ['ack'])
    expect(s.state).toBe('needs')
    s = run(s, [user('src/a.ts')])
    expect(s.state).toBe('working')
    expect(s.needs).toBe(false)
  })

  it('level 3 without needs also raises Needs you (A-04)', () => {
    const s = run(idle(), [user(), status('Look', { level: 3 })])
    expect(s.state).toBe('needs')
    expect(s.needs).toBe(true)
  })

  it('persists through Stop, a failure and a later status', () => {
    const asked = run(idle(), [user(), status('Which?', { needs: true })])
    expect(run(asked, [{ type: 'done', ok: false, reason: 'stopped' }]).state).toBe('needs')
    expect(run(asked, [{ type: 'error', kind: 'crashed', message: 'x' }, { type: 'done', ok: false }]).state).toBe(
      'needs',
    )
    expect(run(asked, [status('Still waiting', { level: 1 })]).state).toBe('needs')
  })
})

describe('reduceStatus: Done, Failed, Stopped, acknowledgement', () => {
  it('done with no status this turn is Done at level 2', () => {
    const s = run(idle(), [user(), doneOk])
    expect(s.state).toBe('done')
    expect(s.level).toBe(2)
  })

  it("done takes the level of the turn's last set_status (A-04)", () => {
    expect(run(idle(), [user(), status('a', { level: 1 }), doneOk]).level).toBe(1)
    expect(run(idle(), [user(), status('a', { level: 2 }), status('b', { level: 0 }), doneOk]).level).toBe(0)
  })

  it('an error then a failed done is Failed with the short phrase', () => {
    const s = run(idle(), [
      user(),
      { type: 'error', kind: 'signed-out', message: 'Claude Code is signed out. Open a terminal…' },
      { type: 'done', ok: false },
    ])
    expect(s.state).toBe('failed')
    expect(s.text).toBe('Claude Code is signed out')
    expect(s.cardText).toBe('Claude Code is signed out')
    expect(s.level).toBe(2)
  })

  it("a failed done with no error is Failed: 'The turn didn't finish'", () => {
    const s = run(idle(), [user(), { type: 'done', ok: false }])
    expect(s.state).toBe('failed')
    expect(s.text).toBe("The turn didn't finish")
  })

  it('Failed can never come out as Done', () => {
    const s = run(idle(), [user(), { type: 'error', kind: 'crashed', message: 'x' }, doneOk])
    expect(s.state).toBe('failed')
    expect(s.text).toBe('Claude Code stopped unexpectedly')
  })

  it("a stopped done is Idle with 'Stopped'", () => {
    const s = run(idle(), [user(), { type: 'text', text: 'Partly' }, { type: 'done', ok: false, reason: 'stopped' }])
    expect(s.state).toBe('idle')
    expect(s.text).toBe(STOPPED_TEXT)
    expect(STOPPED_TEXT).toBe('Stopped')
  })

  it('ack turns Done or Failed into Idle and keeps the text', () => {
    const done = run(idle(), [user(), { type: 'text', text: 'All set' }, doneOk, 'ack'])
    expect(done.state).toBe('idle')
    expect(done.text).toBe('All set')
    const failed = run(idle(), [user(), { type: 'error', kind: 'timeout', message: 'x' }, { type: 'done', ok: false }, 'ack'])
    expect(failed.state).toBe('idle')
    expect(failed.text).toBe('The turn ran over 30 minutes')
  })

  it('ack on Working or Idle changes nothing', () => {
    const working = run(idle(), [user()])
    expect(reduceStatus(working, { kind: 'ack' }, 99)).toBe(working)
    const quiet = idle()
    expect(reduceStatus(quiet, { kind: 'ack' }, 99)).toBe(quiet)
  })

  it('a state change stamps arrivedAt; a text change within the state does not', () => {
    let s = reduceStatus(idle(), { kind: 'event', event: user() }, 10)
    expect(s.arrivedAt).toBe(10)
    s = reduceStatus(s, { kind: 'event', event: { type: 'text', text: 'x' } }, 20)
    expect(s.arrivedAt).toBe(10)
    s = reduceStatus(s, { kind: 'event', event: doneOk }, 30)
    expect(s.arrivedAt).toBe(30)
  })

  it('events that say nothing about status leave it as it was', () => {
    const s = run(idle(), [user(), { type: 'text', text: 'Hello' }])
    for (const event of [
      { type: 'session', sessionId: 'abc' },
      { type: 'text-delta', text: 'Something else' },
      { type: 'tool-result', id: 't1', isError: false, text: 'ok' },
      { type: 'notice', text: 'Shell access is on' },
    ] as StatusEvent[]) {
      expect(reduceStatus(s, { kind: 'event', event }, 50)).toEqual(s)
    }
  })
})

describe('levels (D-14)', () => {
  it('a level-0 status changes text but not cardText', () => {
    const s = run(idle(), [user(), status('Shown', { level: 1 }), status('Quiet', { level: 0 })])
    expect(s.text).toBe('Quiet')
    expect(s.cardText).toBe('Shown')
    expect(statusLine(s)).toBe('Working · Quiet')
    expect(statusLine(s, true)).toBe('Working · Shown')
  })

  it('clampLevel keeps levels between 0 and the ceiling 3', () => {
    expect(STATUS_LEVEL_CEILING).toBe(3)
    expect(clampLevel(50)).toBe(3)
    expect(clampLevel(-1)).toBe(0)
    expect(clampLevel(2)).toBe(2)
    expect(clampLevel(Number.NaN)).toBe(0)
  })

  it('a status level above the ceiling is clamped by the reducer too', () => {
    expect(run(idle(), [user(), status('a', { level: 2 }), { type: 'status', text: 'b', needs: false, level: 9 }]).state).toBe(
      'needs',
    )
  })

  it('shouldAnimate is true only at level 1 or more and at or above the threshold', () => {
    expect(shouldAnimate(2, 2)).toBe(true)
    expect(shouldAnimate(3, 2)).toBe(true)
    expect(shouldAnimate(1, 2)).toBe(false)
    expect(shouldAnimate(0, 1)).toBe(false)
    expect(shouldAnimate(0, 0)).toBe(false)
    expect(shouldAnimate(1, 1)).toBe(true)
  })
})

describe('statusLine', () => {
  it('is "<State word> · <text>", or the text alone for Idle', () => {
    const working = run(idle(), [user(), status('x')])
    expect(statusLine(working)).toBe('Working · x')
    expect(statusLine(initialStatus({ busy: false, lastStatus: 'x' }))).toBe('x')
    expect(statusLine(run(idle(), [user(), status('Which?', { needs: true })]))).toBe('Needs you · Which?')
    expect(statusLine(run(idle(), [user(), status('ok'), doneOk]))).toBe('Done · ok')
    expect(statusLine(run(idle(), [user(), { type: 'done', ok: false }]))).toBe("Failed · The turn didn't finish")
  })

  it('has a word for every state but Idle', () => {
    expect(STATE_WORDS).toEqual({ idle: null, working: 'Working', needs: 'Needs you', done: 'Done', failed: 'Failed' })
  })
})

describe('failed phrases', () => {
  it('names every ChatErrorKind in plain words', () => {
    expect(FAILED_PHRASES).toEqual({
      'not-installed': "Claude Code isn't installed",
      'signed-out': 'Claude Code is signed out',
      crashed: 'Claude Code stopped unexpectedly',
      protocol: 'Claude Code sent something unreadable',
      'bridge-off': 'Agents are turned off',
      'tools-unavailable': "Workspace tools didn't start",
      'session-lost': "The earlier conversation wasn't found",
      timeout: 'The turn ran over 30 minutes',
      'no-key': 'No API key is set',
      refused: 'The request was refused',
    })
  })

  it("falls back to 'The turn didn't finish' for no kind or an unknown one", () => {
    expect(failedPhrase(null)).toBe("The turn didn't finish")
    expect(failedPhrase('something-new')).toBe("The turn didn't finish")
    expect(failedPhrase('bridge-off')).toBe('Agents are turned off')
  })
})

describe('statusTextAfterTurn (the last status text main keeps, D-12)', () => {
  it('is the first line of the reply for a plain turn', () => {
    expect(statusTextAfterTurn([user(), { type: 'text', text: 'ok\nmore' }, doneOk])).toBe('ok')
  })

  it("is 'Stopped' for a stopped turn", () => {
    expect(
      statusTextAfterTurn([user(), { type: 'text', text: 'Partly' }, { type: 'done', ok: false, reason: 'stopped' }]),
    ).toBe('Stopped')
  })

  it('is the set_status text when one arrived, and the short phrase for a failed turn', () => {
    expect(statusTextAfterTurn([user(), status('Reading the parser', { needs: true }), { type: 'text', text: 'Which?' }])).toBe(
      'Reading the parser',
    )
    expect(
      statusTextAfterTurn([user(), { type: 'error', kind: 'bridge-off', message: 'x' }, { type: 'done', ok: false }]),
    ).toBe('Agents are turned off')
  })

  it("is 'Reading your message' for a turn with nothing yet, and 'New chat' for no events", () => {
    expect(statusTextAfterTurn([user()])).toBe(READING_TEXT)
    expect(statusTextAfterTurn([])).toBe(NEW_CHAT_TEXT)
  })
})

describe('attentionOf (D-16, A-07, A-08)', () => {
  const at = (overrides: Partial<SessionStatus>): SessionStatus => ({ ...idle(), ...overrides })

  it('done at level 2 asks for an arrow; done at level 1 does not', () => {
    expect(attentionOf(at({ state: 'done', level: 2 }), false)).toEqual({ kind: 'done', level: 2 })
    expect(attentionOf(at({ state: 'done', level: 1 }), false)).toBeNull()
  })

  it('needs you is level 3 until a reply', () => {
    expect(attentionOf(at({ state: 'needs', level: 3, needs: true }), false)).toEqual({ kind: 'needs', level: 3 })
  })

  it('failed counts as level 2 (A-07)', () => {
    expect(attentionOf(at({ state: 'failed', level: 2 }), false)).toEqual({ kind: 'failed', level: 2 })
  })

  it('a new chat that is still idle counts as a level-2 arrival (A-08); a quiet idle asks for nothing', () => {
    expect(attentionOf(at({ state: 'idle' }), true)).toEqual({ kind: 'new', level: 2 })
    expect(attentionOf(at({ state: 'idle' }), false)).toBeNull()
  })

  it('working asks for nothing', () => {
    expect(attentionOf(at({ state: 'working', level: 1 }), false)).toBeNull()
    expect(attentionOf(at({ state: 'working', level: 1 }), true)).toBeNull()
  })

  it('follows the reducer: a finished turn asks, and looking at it stops the asking', () => {
    const done = run(idle(), [user(), doneOk])
    expect(attentionOf(done, false)).toEqual({ kind: 'done', level: 2 })
    expect(attentionOf(reduceStatus(done, { kind: 'ack' }, 99), false)).toBeNull()
  })
})
