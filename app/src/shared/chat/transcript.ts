/**
 * A chat session note's stored shape: its node type, its keys, and the grammar
 * of the conversation written into its `body` (Phase 2.8, D-02, D-07, D-08).
 *
 * Locked by the 02.8-01 checkpoint decision (option a, taken by the unattended
 * driver and queued for Kaelen in autonomy/REVIEW.md item 6): a plain-text
 * line grammar with `Turn k` headers, node type `tapestry.chat/session@1`,
 * keys `chat.turns`, `width` and `height`.
 *
 * This is a **one-way door**: session notes go into append-only workspace
 * `.tree` journals, so every session ever saved keeps this format forever. A
 * different grammar later means a `@2` type read alongside `@1`, never a
 * rewrite of saved sessions.
 *
 * Pure TypeScript: no Electron, Node or DOM import, so main (which writes the
 * turns), the renderer (which draws them) and vitest all load the identical
 * module.
 *
 * Shape, one session note's `body` as the `.tree` file shows it:
 *
 *   Turn 1
 *   You: How do I add a test for the parser?
 *   Tool: read_file src/parser.ts — done
 *   Claude: Add it next to the feature. Here is the shape:
 *     describe('parser', () => { … })
 *   Tool: write_file src/parser.test.ts — refused: src/parser.test.ts: n12 text is locked by agent.claude
 *   Claude: That file is locked, so I left it alone.
 *
 *   Turn 2
 *   Note: Shell access is on for this chat — not sandboxed. …
 *   You: Now run it
 *   Error (crashed): Claude Code stopped unexpectedly (exit code 3)
 *
 * Grammar rules:
 *  1. Column 0 is structure; content is indented. Structural lines are
 *     `Turn <k>`, `You: `, `Claude: `, `Tool: `, `Note: `, `Error: ` or
 *     `Error (<kind>): `, and `Stopped`.
 *  2. Every further line of a You/Claude/Note/Error item starts with two
 *     spaces, including empty ones, so no message can forge a structural line
 *     and an empty line is only ever a turn separator.
 *  3. Turn blocks are separated by exactly one empty line. "Turn k" is the
 *     passage of D-07 and the fork anchor of D-18: the k-th `Turn` block,
 *     named by its number (not a 2.1 ProseMirror passage mark).
 *  4. `\r\n` and lone `\r` become `\n`, and an item's trailing empty lines are
 *     dropped.
 *  5. Lossy, and only to keep the `.tree` file writable: a content line longer
 *     than MAX_TRANSCRIPT_LINE_CHARS is broken into continuation lines (every
 *     `.tree` line stays under the kernel's 1 MiB line limit); a NUL, which no
 *     `.tree` file may contain, and an unpaired surrogate, which has no UTF-8
 *     form, become U+FFFD.
 *  6. A tool call is one line, `Tool: <tool> <path> — done` or
 *     `Tool: <tool> <path> — refused: <first line>` (D-08). No input or result
 *     payload is ever written, and `set_status` calls are left out (D-10:
 *     status is not history).
 *
 * Other keys on a session note: `chat.turns int <k>` (how many turns are
 * committed), `width 360` and `height 440` (the note's size; the card's own
 * resize stays view state, D-05) and an ordinary `title`.
 */

// ---------------------------------------------------------------------------
// The node
// ---------------------------------------------------------------------------

/** The node type of an in-app chat session note. */
export const SESSION_NODE_TYPE = 'tapestry.chat/session@1'

/** How many turns are committed into the note's body. */
export const SESSION_TURNS_KEY = 'chat.turns'

/** The note size written once at creation (UI-SPEC A-02, RESEARCH Pitfall 6). */
export const SESSION_WIDTH = 360
export const SESSION_HEIGHT = 440

/** A new session's title. */
export const NEW_SESSION_TITLE = 'New chat'

/** The part of a node these readers use. Main's NodeData and the renderer's NodeInfo both fit. */
export interface SessionNodeLike {
  type: string
  props: Readonly<Record<string, { value: unknown }>>
}

export function isSessionNode(node: { type: string }): boolean {
  return node.type === SESSION_NODE_TYPE
}

/** The committed turn count: a non-negative integer, else 0. */
export function committedTurns(node: { props: Readonly<Record<string, { value: unknown }>> }): number {
  const raw = node.props[SESSION_TURNS_KEY]?.value
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isInteger(value) && value >= 0 ? value : 0
}

/** The note's recorded conversation, or '' when it has none. */
export function sessionBody(node: { props: Readonly<Record<string, { value: unknown }>> }): string {
  const raw = node.props['body']?.value
  return typeof raw === 'string' ? raw : ''
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One line (or indented block) of a recorded turn. */
export type TurnItem =
  | { kind: 'you'; text: string }
  | { kind: 'claude'; text: string }
  | { kind: 'tool'; summary: string; refused: boolean }
  | { kind: 'note'; text: string }
  | { kind: 'error'; errorKind: string | null; text: string }
  | { kind: 'stopped' }
  /** A line the grammar does not know, kept and shown plainly. Only parsing makes these. */
  | { kind: 'other'; text: string }

/** One committed turn. Turn 0 holds text found before the first `Turn` line. */
export interface RecordedTurn {
  turn: number
  items: TurnItem[]
}

/**
 * The chat events this module reads. Structural, so main's `ChatEvent` and
 * the renderer's `TapestryChatEvent` both fit; a drift fails typecheck.
 */
export type TranscriptEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'user'; text: string }
  | { type: 'text-delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; isError: boolean; text: string }
  | { type: 'notice'; text: string }
  | { type: 'error'; kind: string; message: string }
  | { type: 'done'; ok: boolean; reason?: string }
  /** set_status (D-13): chrome, never history, so never an item (D-10). */
  | { type: 'status'; text: string; needs: boolean; level: number }

// ---------------------------------------------------------------------------
// Tool lines (D-08), shared by the note, the panel and the card
// ---------------------------------------------------------------------------

const TOOL_PREFIX_RE = /^mcp__tapestry__/

/** The most a tool line may hold; a refusal's first line can be long. */
export const MAX_TOOL_SUMMARY_CHARS = 1000

/** The words a failed turn with no error of its own records. */
export const DIDNT_FINISH_TEXT = "The turn didn't finish."

/** The tool's own name, without the MCP server prefix. */
function shortToolName(name: string): string {
  return name.replace(TOOL_PREFIX_RE, '')
}

function pathArgument(input: unknown): string | null {
  if (input && typeof input === 'object' && 'path' in input) {
    const path = (input as { path?: unknown }).path
    if (typeof path === 'string') return path
  }
  return null
}

function firstLine(text: string): string {
  return text.split(/\r\n|\r|\n/).find((line) => line.trim().length > 0)?.trim() ?? ''
}

function oneLine(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ')
}

/** `set_status` (D-13) with or without the MCP prefix: status, never history. */
export function isStatusTool(name: string): boolean {
  return shortToolName(name) === 'set_status'
}

/** `<tool> <path>`: what a tool line names, with no payload. */
export function toolLabel(name: string, input: unknown): string {
  return oneLine([shortToolName(name), pathArgument(input)].filter(Boolean).join(' '))
}

/**
 * A tool call as one line: `<tool> <path> — done`, `— refused: <first line>`,
 * or `— no result` when the turn ended first. Nothing of the input but its
 * `path`, and nothing of the result but a refusal's first line, is kept.
 */
export function toolSummary(
  name: string,
  input: unknown,
  result: { isError: boolean; text: string } | null | undefined,
): string {
  let status = '— no result'
  if (result) status = result.isError ? `— refused: ${firstLine(result.text)}` : '— done'
  const summary = oneLine(`${toolLabel(name, input)} ${status}`)
  return summary.length > MAX_TOOL_SUMMARY_CHARS
    ? `${summary.slice(0, MAX_TOOL_SUMMARY_CHARS - 1)}…`
    : summary
}

// ---------------------------------------------------------------------------
// Events to items
// ---------------------------------------------------------------------------

type Draft =
  | Exclude<TurnItem, { kind: 'claude' } | { kind: 'tool' }>
  | { kind: 'claude'; text: string; streaming: boolean }
  | { kind: 'tool'; name: string; input: unknown; result: { isError: boolean; text: string } | null }

/**
 * One turn's items, from its events in order: `user` gives You, a complete
 * `text` gives Claude (replacing the deltas streamed for it), deltas with no
 * closing `text` give one Claude item, a tool call and its result give Tool
 * (never `set_status`), `notice` gives Note, `error` gives Error with its
 * kind, a stopped `done` gives Stopped, and a failed `done` with no error of
 * its own gives Error with DIDNT_FINISH_TEXT. Items with empty text are
 * dropped; `session` and `status` events are ignored (status is not history,
 * D-10).
 */
export function turnItemsFromEvents(events: readonly TranscriptEvent[]): TurnItem[] {
  const drafts: Draft[] = []
  const tools = new Map<string, Extract<Draft, { kind: 'tool' }>>()
  const skipped = new Set<string>()
  const last = (): Draft | undefined => drafts[drafts.length - 1]
  let sawError = false

  for (const event of events) {
    switch (event.type) {
      case 'user':
        drafts.push({ kind: 'you', text: event.text })
        break
      case 'text-delta': {
        const current = last()
        if (current?.kind === 'claude' && current.streaming) current.text += event.text
        else drafts.push({ kind: 'claude', text: event.text, streaming: true })
        break
      }
      case 'text': {
        const current = last()
        if (current?.kind === 'claude' && current.streaming) {
          current.text = event.text
          current.streaming = false
        } else {
          drafts.push({ kind: 'claude', text: event.text, streaming: false })
        }
        break
      }
      case 'tool-call': {
        if (isStatusTool(event.name)) {
          skipped.add(event.id)
          break
        }
        const draft: Extract<Draft, { kind: 'tool' }> = {
          kind: 'tool',
          name: event.name,
          input: event.input,
          result: null,
        }
        tools.set(event.id, draft)
        drafts.push(draft)
        break
      }
      case 'tool-result': {
        if (skipped.has(event.id)) break
        const draft = tools.get(event.id)
        if (draft) draft.result = { isError: event.isError, text: event.text }
        break
      }
      case 'notice':
        drafts.push({ kind: 'note', text: event.text })
        break
      case 'error':
        sawError = true
        drafts.push({ kind: 'error', errorKind: event.kind, text: event.message })
        break
      case 'done':
        if (event.reason === 'stopped') drafts.push({ kind: 'stopped' })
        else if (!event.ok && !sawError) {
          drafts.push({ kind: 'error', errorKind: null, text: DIDNT_FINISH_TEXT })
        }
        break
      case 'session':
      case 'status':
        break
    }
  }

  const items: TurnItem[] = []
  for (const draft of drafts) {
    switch (draft.kind) {
      case 'claude':
        if (draft.text.trim().length > 0) items.push({ kind: 'claude', text: draft.text })
        break
      case 'tool':
        items.push({
          kind: 'tool',
          summary: toolSummary(draft.name, draft.input, draft.result),
          refused: draft.result?.isError ?? false,
        })
        break
      case 'you':
      case 'note':
      case 'other':
        if (draft.text.trim().length > 0) items.push(draft)
        break
      case 'error':
        if (draft.text.trim().length > 0) items.push(draft)
        break
      case 'stopped':
        items.push(draft)
        break
    }
  }
  return items
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** The longest content line written as one `.tree` line (at most 3 bytes per unit, under 1 MiB). */
export const MAX_TRANSCRIPT_LINE_CHARS = 200_000

const CONTINUATION = '  '
const TURN_RE = /^Turn ([1-9][0-9]*)$/
const ERROR_KIND_RE = /^[a-z0-9][a-z0-9-]*$/
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** Text a `.tree` block can hold: LF line ends, no NUL, no unpaired surrogate. */
function cleanText(text: string): string {
  return text.replace(/\r\n|\r/g, '\n').replace(/\0/g, '�').replace(LONE_SURROGATE_RE, '�')
}

/** A content line cut into pieces of at most MAX_TRANSCRIPT_LINE_CHARS, never inside a surrogate pair. */
function breakLongLine(line: string): string[] {
  if (line.length <= MAX_TRANSCRIPT_LINE_CHARS) return [line]
  const pieces: string[] = []
  let start = 0
  while (start < line.length) {
    let end = Math.min(start + MAX_TRANSCRIPT_LINE_CHARS, line.length)
    const code = line.charCodeAt(end - 1)
    if (end < line.length && code >= 0xd800 && code <= 0xdbff) end -= 1
    pieces.push(line.slice(start, end))
    start = end
  }
  return pieces
}

/** A multi-line value under its structural prefix, continuations indented. */
function encodeBlock(prefix: string, text: string): string[] {
  const lines = cleanText(text).split('\n').flatMap(breakLongLine)
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((line, index) => (index === 0 ? `${prefix}${line}` : `${CONTINUATION}${line}`))
}

function encodeItem(item: TurnItem): string[] {
  switch (item.kind) {
    case 'you':
      return encodeBlock('You: ', item.text)
    case 'claude':
      return encodeBlock('Claude: ', item.text)
    case 'note':
      return encodeBlock('Note: ', item.text)
    case 'error':
      return encodeBlock(
        item.errorKind !== null && ERROR_KIND_RE.test(item.errorKind) ? `Error (${item.errorKind}): ` : 'Error: ',
        item.text,
      )
    case 'tool':
      return [`Tool: ${cleanText(oneLine(item.summary))}`]
    case 'stopped':
      return ['Stopped']
    case 'other':
      // Only parsing makes these; written back as they were read.
      return encodeBlock('', item.text)
  }
}

/** One turn's block: `Turn <k>`, then its items. No trailing line feed. */
export function encodeTurn(turn: RecordedTurn): string {
  return [`Turn ${turn.turn}`, ...turn.items.flatMap(encodeItem)].join('\n')
}

/** The body with one more turn: the block alone, or the body, one empty line and the block. */
export function appendTurnText(body: string, turn: RecordedTurn): string {
  const block = encodeTurn(turn)
  const trimmed = body.replace(/\n+$/, '')
  return trimmed.length === 0 ? block : `${trimmed}\n\n${block}`
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type TextItem = Extract<TurnItem, { text: string }>

/**
 * The turns recorded in a body. Never throws: an unknown column-0 line inside
 * a turn becomes an `other` item, and text before the first `Turn` line
 * becomes turn 0's `other` items.
 */
export function parseTranscript(body: string): RecordedTurn[] {
  const turns: RecordedTurn[] = []
  /** The turn being read; text before the first `Turn` line goes to a turn 0. */
  let current: RecordedTurn | null = null
  /** The item a continuation line extends, or null after a one-line item. */
  let open: TextItem | null = null

  for (const line of body.replace(/\r\n|\r/g, '\n').split('\n')) {
    const turnMatch = TURN_RE.exec(line)
    if (turnMatch) {
      current = { turn: Number(turnMatch[1]), items: [] }
      turns.push(current)
      open = null
      continue
    }
    if (line.length === 0) {
      // A turn separator. Inside content an empty line is written indented.
      open = null
      continue
    }
    if (line.startsWith(CONTINUATION) && open !== null) {
      open.text += `\n${line.slice(CONTINUATION.length)}`
      continue
    }
    if (current === null) {
      current = { turn: 0, items: [] }
      turns.push(current)
    }
    let item: TurnItem
    if (line.startsWith(CONTINUATION)) {
      // A continuation with nothing to continue is kept as plain text.
      item = { kind: 'other', text: line.slice(CONTINUATION.length) }
    } else if (current.turn === 0) {
      // Before the first turn, everything is kept as plain text.
      item = { kind: 'other', text: line }
    } else {
      item = parseLine(line)
    }
    current.items.push(item)
    open = 'text' in item ? item : null
  }
  return turns
}

function afterPrefix(line: string, prefix: string): string | null {
  if (line === prefix.trimEnd()) return ''
  return line.startsWith(prefix) ? line.slice(prefix.length) : null
}

const ERROR_LINE_RE = /^Error \(([a-z0-9][a-z0-9-]*)\):(?: (.*))?$/

function parseLine(line: string): TurnItem {
  if (line === 'Stopped') return { kind: 'stopped' }
  let rest = afterPrefix(line, 'You: ')
  if (rest !== null) return { kind: 'you', text: rest }
  rest = afterPrefix(line, 'Claude: ')
  if (rest !== null) return { kind: 'claude', text: rest }
  rest = afterPrefix(line, 'Note: ')
  if (rest !== null) return { kind: 'note', text: rest }
  rest = afterPrefix(line, 'Tool: ')
  if (rest !== null) return { kind: 'tool', summary: rest, refused: / — refused: /.test(rest) }
  rest = afterPrefix(line, 'Error: ')
  if (rest !== null) return { kind: 'error', errorKind: null, text: rest }
  const error = ERROR_LINE_RE.exec(line)
  if (error) return { kind: 'error', errorKind: error[1], text: error[2] ?? '' }
  return { kind: 'other', text: line }
}
