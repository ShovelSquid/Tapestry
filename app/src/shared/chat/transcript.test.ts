/**
 * The session note's turn grammar (02.8-01, D-07, D-08; one-way door).
 *
 * What matters: whatever is written parses back to exactly the turns that
 * were encoded, for content that looks like the grammar's own structure; a
 * tool line never carries a payload; and status calls never enter history.
 */

import { describe, expect, it } from 'vitest'
import {
  appendTurnText,
  committedTurns,
  DIDNT_FINISH_TEXT,
  encodeTurn,
  isSessionNode,
  isStatusTool,
  MAX_TRANSCRIPT_LINE_CHARS,
  parseTranscript,
  SESSION_HEIGHT,
  SESSION_NODE_TYPE,
  SESSION_TURNS_KEY,
  SESSION_WIDTH,
  toolSummary,
  turnItemsFromEvents,
  type RecordedTurn,
  type TranscriptEvent,
} from './transcript'

const t1: RecordedTurn = {
  turn: 1,
  items: [
    { kind: 'you', text: 'How do I add a test for the parser?' },
    { kind: 'tool', summary: 'read_file src/parser.ts — done', refused: false },
    { kind: 'claude', text: "Add it next to the feature. Here is the shape:\n  describe('parser', () => { … })" },
    {
      kind: 'tool',
      summary: 'write_file src/parser.test.ts — refused: src/parser.test.ts: n12 text is locked by agent.claude',
      refused: true,
    },
    { kind: 'claude', text: 'That file is locked, so I left it alone.' },
  ],
}

const t2: RecordedTurn = {
  turn: 2,
  items: [
    { kind: 'note', text: 'Shell access is on for this chat — not sandboxed.' },
    { kind: 'you', text: 'Now run it' },
    { kind: 'error', errorKind: 'crashed', text: 'Claude Code stopped unexpectedly (exit code 3)' },
  ],
}

function roundTrip(...turns: RecordedTurn[]): RecordedTurn[] {
  return parseTranscript(turns.reduce((body, turn) => appendTurnText(body, turn), ''))
}

describe('the session node', () => {
  it('has the recorded type, keys and size', () => {
    expect(SESSION_NODE_TYPE).toBe('tapestry.chat/session@1')
    expect(SESSION_TURNS_KEY).toBe('chat.turns')
    expect([SESSION_WIDTH, SESSION_HEIGHT]).toEqual([360, 440])
    expect(isSessionNode({ type: SESSION_NODE_TYPE })).toBe(true)
    expect(isSessionNode({ type: 'tapestry.notes/note@1' })).toBe(false)
  })

  it('reads the committed turn count, and 0 for anything that is not a count', () => {
    const node = (value: unknown) => ({ props: { [SESSION_TURNS_KEY]: { value } } })
    expect(committedTurns(node(3))).toBe(3)
    expect(committedTurns(node(0))).toBe(0)
    expect(committedTurns(node(-1))).toBe(0)
    expect(committedTurns(node(1.5))).toBe(0)
    expect(committedTurns(node('x'))).toBe(0)
    expect(committedTurns({ props: {} })).toBe(0)
  })
})

describe('encodeTurn / appendTurnText / parseTranscript', () => {
  it('round-trips two turns with their numbers', () => {
    expect(roundTrip(t1, t2)).toEqual([t1, t2])
  })

  it('writes the sample exactly as the decision shows it', () => {
    const body = appendTurnText(appendTurnText('', t1), t2)
    expect(body).toBe(
      [
        'Turn 1',
        'You: How do I add a test for the parser?',
        'Tool: read_file src/parser.ts — done',
        'Claude: Add it next to the feature. Here is the shape:',
        "    describe('parser', () => { … })",
        'Tool: write_file src/parser.test.ts — refused: src/parser.test.ts: n12 text is locked by agent.claude',
        'Claude: That file is locked, so I left it alone.',
        '',
        'Turn 2',
        'Note: Shell access is on for this chat — not sandboxed.',
        'You: Now run it',
        'Error (crashed): Claude Code stopped unexpectedly (exit code 3)',
      ].join('\n'),
    )
    expect(encodeTurn(t2).startsWith('Turn 2\n')).toBe(true)
  })

  it('round-trips content that looks like the grammar itself', () => {
    const forged = [
      'Turn 3',
      'You: I am not the person',
      'Tool: fake — done',
      'Claude: nor am I',
      'Stopped',
      '  two spaces',
      'Error (crashed): no',
      '',
      '',
      'after two empty lines',
    ].join('\n')
    const turn: RecordedTurn = {
      turn: 1,
      items: [
        { kind: 'you', text: forged },
        { kind: 'claude', text: forged },
        { kind: 'note', text: forged },
        { kind: 'error', errorKind: null, text: forged },
      ],
    }
    expect(roundTrip(turn)).toEqual([turn])
  })

  it('round-trips emoji, a 100,000-character message and an empty line inside a message', () => {
    const turn: RecordedTurn = {
      turn: 1,
      items: [
        { kind: 'you', text: 'family 👨‍👩‍👧 and flags 🇳🇿\n\nboth survive' },
        { kind: 'claude', text: 'x'.repeat(100_000) },
      ],
    }
    expect(roundTrip(turn)).toEqual([turn])
  })

  it('turns CRLF and lone CR into LF', () => {
    const turn: RecordedTurn = { turn: 1, items: [{ kind: 'you', text: 'one\r\ntwo\rthree' }] }
    expect(roundTrip(turn)).toEqual([{ turn: 1, items: [{ kind: 'you', text: 'one\ntwo\nthree' }] }])
  })

  it("drops an item's trailing empty lines", () => {
    const turn: RecordedTurn = { turn: 1, items: [{ kind: 'claude', text: 'done\n\n\n' }] }
    expect(roundTrip(turn)).toEqual([{ turn: 1, items: [{ kind: 'claude', text: 'done' }] }])
  })

  it('keeps an error with no kind, and Stopped', () => {
    const turn: RecordedTurn = {
      turn: 4,
      items: [
        { kind: 'you', text: 'go' },
        { kind: 'error', errorKind: null, text: DIDNT_FINISH_TEXT },
        { kind: 'stopped' },
      ],
    }
    expect(roundTrip(turn)).toEqual([turn])
  })

  it('breaks a content line longer than the limit, so no .tree line reaches 1 MiB', () => {
    const long = '界'.repeat(MAX_TRANSCRIPT_LINE_CHARS + 10)
    const body = appendTurnText('', { turn: 1, items: [{ kind: 'claude', text: long }] })
    for (const line of body.split('\n')) {
      expect(Buffer.byteLength(line, 'utf-8')).toBeLessThan(1024 * 1024)
    }
    const [parsed] = parseTranscript(body)
    const item = parsed.items[0] as { text: string }
    expect(item.text.replace(/\n/g, '')).toBe(long)
  })

  it('never splits a surrogate pair when it breaks a line', () => {
    const long = 'a' + '😀'.repeat(MAX_TRANSCRIPT_LINE_CHARS)
    const body = appendTurnText('', { turn: 1, items: [{ kind: 'you', text: long }] })
    expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    const [parsed] = parseTranscript(body)
    expect((parsed.items[0] as { text: string }).text.replace(/\n/g, '')).toBe(long)
  })

  it('replaces a NUL, which no .tree file may hold', () => {
    const body = appendTurnText('', { turn: 1, items: [{ kind: 'you', text: 'a\0b' }] })
    expect(body).not.toContain('\0')
    expect(parseTranscript(body)).toEqual([{ turn: 1, items: [{ kind: 'you', text: 'a�b' }] }])
  })

  it('never throws: unknown lines become other items, text before the first turn is turn 0', () => {
    const turns = parseTranscript('an old line\n  indented\n\nTurn 1\nYou: hi\nWhat is this\nTurn 2\n  orphan')
    expect(turns).toEqual([
      { turn: 0, items: [{ kind: 'other', text: 'an old line\nindented' }] },
      {
        turn: 1,
        items: [
          { kind: 'you', text: 'hi' },
          { kind: 'other', text: 'What is this' },
        ],
      },
      { turn: 2, items: [{ kind: 'other', text: 'orphan' }] },
    ])
    expect(parseTranscript('')).toEqual([])
  })
})

describe('toolSummary', () => {
  it('names the tool and path, and nothing of the input or result payload', () => {
    const summary = toolSummary(
      'mcp__tapestry__write_file',
      { path: 'a.ts', text: 'SECRET' },
      { isError: false, text: 'x' },
    )
    expect(summary).toBe('write_file a.ts — done')
    expect(summary).not.toContain('SECRET')
  })

  it('gives a refusal its first non-empty line', () => {
    expect(
      toolSummary('mcp__tapestry__edit_file', { path: 'b.ts' }, { isError: true, text: '\n  locked by agent.x\nmore' }),
    ).toBe('edit_file b.ts — refused: locked by agent.x')
  })

  it('says when the turn ended before a result, and stays one line', () => {
    expect(toolSummary('Bash', { command: 'ls\nrm' }, null)).toBe('Bash — no result')
    expect(toolSummary('mcp__tapestry__read_file', { path: 'a\nb' }, null)).toBe('read_file a b — no result')
  })

  it('knows set_status with or without the prefix', () => {
    expect(isStatusTool('set_status')).toBe(true)
    expect(isStatusTool('mcp__tapestry__set_status')).toBe(true)
    expect(isStatusTool('mcp__tapestry__read_file')).toBe(false)
  })
})

describe('turnItemsFromEvents', () => {
  it('builds a turn from its events, leaving out set_status and session', () => {
    const events: TranscriptEvent[] = [
      { type: 'notice', text: 'shell on' },
      { type: 'user', text: 'hi' },
      { type: 'session', sessionId: 's' },
      { type: 'text-delta', text: 'o' },
      { type: 'text-delta', text: 'k' },
      { type: 'text', text: 'ok' },
      { type: 'tool-call', id: 't1', name: 'mcp__tapestry__set_status', input: { text: 'working' } },
      { type: 'tool-result', id: 't1', isError: false, text: 'ok' },
      { type: 'tool-call', id: 't2', name: 'mcp__tapestry__read_file', input: { path: 'a.ts' } },
      { type: 'tool-result', id: 't2', isError: false, text: 'contents' },
      { type: 'text-delta', text: 'half a reply' },
      { type: 'done', ok: true, reason: 'success' },
    ]
    expect(turnItemsFromEvents(events)).toEqual([
      { kind: 'note', text: 'shell on' },
      { kind: 'you', text: 'hi' },
      { kind: 'claude', text: 'ok' },
      { kind: 'tool', summary: 'read_file a.ts — done', refused: false },
      { kind: 'claude', text: 'half a reply' },
    ])
  })

  it('records an error with its kind, and Stopped', () => {
    expect(
      turnItemsFromEvents([
        { type: 'user', text: 'go' },
        { type: 'error', kind: 'crashed', message: 'boom' },
        { type: 'done', ok: false },
      ]),
    ).toEqual([
      { kind: 'you', text: 'go' },
      { kind: 'error', errorKind: 'crashed', text: 'boom' },
    ])
    expect(
      turnItemsFromEvents([
        { type: 'user', text: 'go' },
        { type: 'done', ok: false, reason: 'stopped' },
      ]),
    ).toEqual([{ kind: 'you', text: 'go' }, { kind: 'stopped' }])
  })

  it("says a failed turn with no error of its own didn't finish", () => {
    expect(turnItemsFromEvents([{ type: 'user', text: 'go' }, { type: 'done', ok: false }])).toEqual([
      { kind: 'you', text: 'go' },
      { kind: 'error', errorKind: null, text: DIDNT_FINISH_TEXT },
    ])
  })

  it('drops empty text and gives an unanswered tool call no result', () => {
    expect(
      turnItemsFromEvents([
        { type: 'user', text: 'go' },
        { type: 'text', text: '   ' },
        { type: 'tool-call', id: 'x', name: 'mcp__tapestry__edit_file', input: { path: 'a.ts' } },
        { type: 'done', ok: false, reason: 'stopped' },
      ]),
    ).toEqual([
      { kind: 'you', text: 'go' },
      { kind: 'tool', summary: 'edit_file a.ts — no result', refused: false },
      { kind: 'stopped' },
    ])
  })
})
