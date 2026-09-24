/**
 * `thread.log` grammar — the D-06 record codec.
 *
 * Locked by Kaelen's checkpoint decision (02.3-02-PLAN.md, "Decision: lock
 * the thread.log grammar and the thread node type", answered 2026-09-16,
 * "approve as is"): the `proposed` grammar from 02.3-RESEARCH.md Pattern 1,
 * verbatim, including its terse verb tokens and cause tokens.
 *
 * This is a **one-way door** (D-06): the shape here goes into append-only
 * `.tree` journals, so every thread ever saved keeps this format forever.
 * `tapestry/docs/tree/threads.md`, `FORMAT.md` and `example.tree` document
 * the same grammar and must change in the same commit as this file.
 *
 * Pure TypeScript: no Electron, Node or DOM import, so main, renderer and
 * vitest all load the identical module (RESEARCH Pattern 1, "Architectural
 * Responsibility Map": "Grammar parse/format, replay ... Shared pure TS").
 *
 * Shape, one thread commit's value:
 *
 *   thread 1 v118
 *   at 2026-09-15T21:04:10.250Z
 *   +0.000 in 3
 *   +0.000 ins 14 "H"
 *   +0.182 ins 15 "e" strong
 *   +0.950 del 15 17 "ey"
 *   +1.420 paste ins 15 "llo world"
 *   +2.004 format mark+ strong 1 12
 *   +2.300 undo del 1 12 "Hello world"
 *   +3.100 link marker e12
 *   +4.000 enter step {"stepType":"replace", ...} ""
 *   +154.000 out
 *
 * Grammar rules (RESEARCH Pattern 1):
 *  1. Line 1: `thread <grammar-version> v<collab version before the first
 *     step>`. Line 2: `at <RFC 3339 UTC, exactly 3 fraction digits>`. Every
 *     later line starts `+<seconds>.<3-digit millis>`, parsed as integer
 *     milliseconds — an offset is never routed through a float.
 *  2. One step = one line. An optional cause token precedes the verb; no
 *     cause means typed.
 *  3. Verbs: `ins`, `del`, `mark+`/`mark-`, `step`, `marker`, `in`, `out`,
 *     `cont` (a continuation line for a line that would otherwise exceed
 *     the kernel's 1 MiB line limit).
 *  4. Letters (D-06 grapheme awareness) are the caller's concern — this
 *     module records and replays exact strings; grapheme segmentation
 *     happens in the recorder before a record ever reaches here.
 *  5. Author (D-21) is never a field here: it is the enclosing commit's
 *     `actor` line.
 *  6. Replay order is commit order, then line order within a commit; line
 *     position is recorded time. This module only formats/parses one
 *     block — ordering across blocks is the caller's concern.
 *  7. `out` is written only when a time-out was actually detected.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The `thread.log` grammar version this module reads and writes. */
export const THREAD_GRAMMAR_VERSION = 1

/** The kernel's line-length ceiling (tapestry/kernel/tree/Codec.hpp:20). A
 * record line that would exceed this is split across `cont` lines instead. */
const K_MAX_LINE_BYTES = 1 * 1024 * 1024

/** Code points per `cont` chunk. Conservative against `\u00XX` escape
 * expansion (up to 6 bytes per raw byte < 0x20) so a chunk's encoded line
 * always stays comfortably under K_MAX_LINE_BYTES even in the worst case. */
const CHUNK_CODE_POINTS = 100_000

/** Optional cause token that may precede a verb; absent means typed. */
export type ThreadCause =
  | 'paste'
  | 'drop'
  | 'cut'
  | 'undo'
  | 'redo'
  | 'ime'
  | 'format'
  | 'link'
  | 'enter'
  | 'observed'

const CAUSES: ReadonlySet<string> = new Set<ThreadCause>([
  'paste',
  'drop',
  'cut',
  'undo',
  'redo',
  'ime',
  'format',
  'link',
  'enter',
  'observed',
])

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

/** `+<offset> in <session#>` — session time-in (D-07/D-10). */
export interface ThreadInRecord {
  verb: 'in'
  offsetMs: number
  session: number
}

/** `+<offset> out` — session time-out (D-07/D-10). */
export interface ThreadOutRecord {
  verb: 'out'
  offsetMs: number
}

/**
 * `+<offset> [cause] ins <pos> "<text>" [attr-less marks…]` — a flat
 * single-text-node insertion (`from === to`).
 */
export interface ThreadInsRecord {
  verb: 'ins'
  offsetMs: number
  cause: ThreadCause | null
  pos: number
  text: string
  marks: string[]
}

/**
 * `+<offset> [cause] del <from> <to> "<deleted text>"` — always quotes what
 * was removed, taken from the document before the step (D-03 readable).
 */
export interface ThreadDelRecord {
  verb: 'del'
  offsetMs: number
  cause: ThreadCause | null
  from: number
  to: number
  text: string
}

/** `+<offset> [cause] mark+|mark- <mark> <from> <to>` — attr-less marks only. */
export interface ThreadMarkRecord {
  verb: 'mark+' | 'mark-'
  offsetMs: number
  cause: ThreadCause | null
  mark: string
  from: number
  to: number
}

/**
 * `+<offset> [cause] step <exact Step JSON> "<readable text of the slice>"`
 * — everything a flat `ins`/`del`/`mark` cannot express: structure changes,
 * attr marks (`textColor`, `link`), `ReplaceAroundStep`.
 */
export interface ThreadStepRecord {
  verb: 'step'
  offsetMs: number
  cause: ThreadCause | null
  stepJson: string
  text: string
}

/** `+<offset> [cause] marker <ref>` — D-02 link marker onto an edge id. */
export interface ThreadMarkerRecord {
  verb: 'marker'
  offsetMs: number
  cause: ThreadCause | null
  ref: string
}

/** The complete v1 record vocabulary (`cont` lines are a serialization
 * detail folded transparently into the record whose text they continue —
 * see formatBlock/parseBlock — and are never a record of their own). */
export type ThreadRecord =
  | ThreadInRecord
  | ThreadOutRecord
  | ThreadInsRecord
  | ThreadDelRecord
  | ThreadMarkRecord
  | ThreadStepRecord
  | ThreadMarkerRecord

/** A record type that carries a quoted, possibly-split text field. */
type TextBearingRecord = ThreadInsRecord | ThreadDelRecord | ThreadStepRecord

function hasTextField(record: ThreadRecord): record is TextBearingRecord {
  return record.verb === 'ins' || record.verb === 'del' || record.verb === 'step'
}

// ---------------------------------------------------------------------------
// String escaping (FORMAT.md's inline escape set)
// ---------------------------------------------------------------------------

/**
 * Double-quoted, JSON-style escapes for quote, backslash, LF, tab, CR and
 * `\u00XX` for any other byte below 0x20 (tapestry/kernel/Value.hpp
 * `quoteText`). Every other character, including non-ASCII, is written raw.
 *
 * This is what makes T-02.3-02-01 (record-line injection) impossible: a raw
 * line feed can never appear inside a record, so pasted text can never forge
 * a new record line or a `TEXT` block-delimiter line.
 */
export function quoteText(text: string): string {
  let out = '"'
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const code = text.charCodeAt(i)
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (code < 0x20) out += '\\u' + code.toString(16).padStart(4, '0')
    else out += ch
  }
  return out + '"'
}

/**
 * Reads one double-quoted, escaped string starting at index 0 of `input`.
 * Returns the decoded text and whatever text remains after the closing
 * quote. Strict inverse of quoteText.
 */
function readQuoted(input: string): { text: string; rest: string } {
  if (input[0] !== '"') {
    throw new Error(`expected a quoted string, got: ${input.slice(0, 40)}`)
  }
  let out = ''
  let i = 1
  while (i < input.length) {
    const ch = input[i]
    if (ch === '"') {
      return { text: out, rest: input.slice(i + 1) }
    }
    if (ch === '\\') {
      const next = input[i + 1]
      if (next === '"') {
        out += '"'
        i += 2
        continue
      }
      if (next === '\\') {
        out += '\\'
        i += 2
        continue
      }
      if (next === 'n') {
        out += '\n'
        i += 2
        continue
      }
      if (next === 't') {
        out += '\t'
        i += 2
        continue
      }
      if (next === 'r') {
        out += '\r'
        i += 2
        continue
      }
      if (next === 'u') {
        const hex = input.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new Error(`malformed \\u escape at index ${i}: ${input.slice(0, 40)}`)
        }
        out += String.fromCharCode(parseInt(hex, 16))
        i += 6
        continue
      }
      throw new Error(`unknown escape sequence \\${next} at index ${i}`)
    }
    out += ch
    i++
  }
  throw new Error(`unterminated quoted string: ${input.slice(0, 40)}`)
}

/** UTF-8 byte length, matching the kernel's own byte-counted line limit. */
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

/**
 * Splits `text` into `cont`-continued lines when the single-line encoding
 * would exceed the kernel's 1 MiB line limit. `head` is everything on the
 * first line before the opening quote (offset, cause, verb, other args);
 * `suffix` (e.g. an `ins` record's trailing marks) is emitted once, after
 * the very last chunk, so it always describes the whole record rather than
 * one chunk of it.
 */
function splitQuoted(head: string, text: string, suffix: string): string[] {
  const whole = head + quoteText(text) + suffix
  if (byteLength(whole) <= K_MAX_LINE_BYTES) {
    return [whole]
  }
  const codePoints = Array.from(text)
  const chunks: string[] = []
  for (let i = 0; i < codePoints.length; i += CHUNK_CODE_POINTS) {
    chunks.push(codePoints.slice(i, i + CHUNK_CODE_POINTS).join(''))
  }
  if (chunks.length === 0) chunks.push('')
  const lines: string[] = [head + quoteText(chunks[0])]
  for (let i = 1; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    lines.push('cont ' + quoteText(chunks[i]) + (isLast ? suffix : ''))
  }
  return lines
}

// ---------------------------------------------------------------------------
// Offset formatting: integer milliseconds only, never a float
// ---------------------------------------------------------------------------

/** Clamp to zero: a wall clock jumping backwards must never write a
 * negative offset (D-06 crash/clock pitfall). */
function formatOffset(ms: number): string {
  const clamped = Math.max(0, Math.round(ms))
  const seconds = Math.floor(clamped / 1000)
  const millis = clamped - seconds * 1000
  return `+${seconds}.${String(millis).padStart(3, '0')}`
}

const OFFSET_RE = /^\+(\d+)\.(\d{3}) (.*)$/

/** Parses a `+<seconds>.<millis>` prefix as integer milliseconds — never
 * through parseFloat, so a boundary like `+0.999` never rounds away. */
function parseOffsetPrefix(line: string): { offsetMs: number; rest: string } {
  const m = OFFSET_RE.exec(line)
  if (!m) {
    throw new Error(`malformed thread.log record line (no offset prefix): ${line}`)
  }
  const seconds = Number(m[1])
  const millis = Number(m[2])
  return { offsetMs: seconds * 1000 + millis, rest: m[3] }
}

function takeWord(s: string): { word: string; rest: string } {
  const idx = s.indexOf(' ')
  if (idx === -1) return { word: s, rest: '' }
  return { word: s.slice(0, idx), rest: s.slice(idx + 1) }
}

/**
 * Reads a balanced JSON object/array token from the start of `s`, honoring
 * quoted-string contents (which may themselves contain literal spaces and
 * braces) so a Step's JSON blob — always compact, no embedded raw newline —
 * can sit on the same line as a following quoted readable-text field.
 */
function readJsonToken(s: string): { json: string; rest: string } {
  let depth = 0
  let inString = false
  let i = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === '{' || c === '[') {
      depth++
    } else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
  }
  if (depth !== 0) {
    throw new Error(`unbalanced step JSON token: ${s.slice(0, 60)}`)
  }
  const json = s.slice(0, i)
  const rest = s[i] === ' ' ? s.slice(i + 1) : s.slice(i)
  return { json, rest }
}

// ---------------------------------------------------------------------------
// formatBlock
// ---------------------------------------------------------------------------

/** Exactly what `Date.prototype.toISOString()` produces: RFC 3339 UTC with
 * exactly 3 fraction digits and a `Z` suffix. */
function formatAnchor(anchorMs: number): string {
  return new Date(anchorMs).toISOString()
}

function formatRecordLines(record: ThreadRecord): string[] {
  const cause = 'cause' in record && record.cause ? `${record.cause} ` : ''
  const prefix = `${formatOffset(record.offsetMs)} ${cause}`

  switch (record.verb) {
    case 'in':
      return [`${prefix}in ${record.session}`]
    case 'out':
      return [`${prefix}out`]
    case 'ins': {
      const head = `${prefix}ins ${record.pos} `
      const suffix = record.marks.length > 0 ? ' ' + record.marks.join(' ') : ''
      return splitQuoted(head, record.text, suffix)
    }
    case 'del': {
      const head = `${prefix}del ${record.from} ${record.to} `
      return splitQuoted(head, record.text, '')
    }
    case 'mark+':
    case 'mark-':
      return [`${prefix}${record.verb} ${record.mark} ${record.from} ${record.to}`]
    case 'step': {
      const head = `${prefix}step ${record.stepJson} `
      return splitQuoted(head, record.text, '')
    }
    case 'marker':
      return [`${prefix}marker ${record.ref}`]
  }
}

/**
 * Formats a `thread.log` block's full text: the two header lines followed
 * by one line (or more, for an oversized insert/delete/step) per record.
 *
 * `versionBefore` is the collab version before the first step in `records`
 * (grammar rule 1) — it lets a replayer verify no step is missing between
 * commits. `anchorMs` is the wall-clock instant every `+offset` line in this
 * block is measured from.
 */
export function formatBlock(records: ThreadRecord[], anchorMs: number, versionBefore: number): string {
  const lines: string[] = [`thread ${THREAD_GRAMMAR_VERSION} v${versionBefore}`, `at ${formatAnchor(anchorMs)}`]
  for (const record of records) {
    lines.push(...formatRecordLines(record))
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// parseBlock
// ---------------------------------------------------------------------------

/** Header fields a block's first two lines carry, alongside its records. */
export interface ThreadBlockHeader {
  grammarVersion: number
  versionBefore: number
  anchorMs: number
}

function parseHeaderLines(lines: readonly string[]): ThreadBlockHeader {
  if (lines.length < 2) {
    throw new Error('thread.log block must have at least a version line and an anchor line')
  }
  const headerMatch = /^thread (\d+) v(\d+)$/.exec(lines[0])
  if (!headerMatch) {
    throw new Error(`malformed thread.log header line: ${lines[0]}`)
  }
  const grammarVersion = Number(headerMatch[1])
  if (grammarVersion !== THREAD_GRAMMAR_VERSION) {
    throw new Error(
      `unsupported thread.log grammar version ${grammarVersion} (this build reads v${THREAD_GRAMMAR_VERSION})`,
    )
  }
  const versionBefore = Number(headerMatch[2])

  const atMatch = /^at (.+)$/.exec(lines[1])
  if (!atMatch) {
    throw new Error(`malformed thread.log anchor line: ${lines[1]}`)
  }
  const anchorDate = new Date(atMatch[1])
  if (Number.isNaN(anchorDate.getTime())) {
    throw new Error(`invalid thread.log anchor timestamp: ${atMatch[1]}`)
  }

  return { grammarVersion, versionBefore, anchorMs: anchorDate.getTime() }
}

function appendContinuation(records: ThreadRecord[], rest: string): void {
  const { text: chunk, rest: after } = readQuoted(rest)
  if (records.length === 0) {
    throw new Error('cont line with no preceding record to continue')
  }
  const last = records[records.length - 1]
  if (!hasTextField(last)) {
    throw new Error(`cont line follows a '${last.verb}' record, which has no text field`)
  }
  last.text += chunk
  if (last.verb === 'ins') {
    const trailing = after.trim()
    if (trailing.length > 0) {
      last.marks = trailing.split(' ')
    }
  }
}

function parseRecordLine(line: string): ThreadRecord {
  const { offsetMs, rest: afterOffset } = parseOffsetPrefix(line)

  let rest = afterOffset
  let cause: ThreadCause | null = null
  const first = takeWord(rest)
  if (CAUSES.has(first.word)) {
    cause = first.word as ThreadCause
    rest = first.rest
  }

  const { word: verb, rest: afterVerb } = takeWord(rest)
  rest = afterVerb

  switch (verb) {
    case 'in': {
      const session = Number(rest)
      if (!Number.isInteger(session)) {
        throw new Error(`malformed 'in' record: ${line}`)
      }
      return { verb: 'in', offsetMs, session }
    }
    case 'out':
      return { verb: 'out', offsetMs }
    case 'ins': {
      const posTok = takeWord(rest)
      const pos = Number(posTok.word)
      const { text, rest: afterQuote } = readQuoted(posTok.rest)
      const trailing = afterQuote.trim()
      const marks = trailing.length > 0 ? trailing.split(' ') : []
      return { verb: 'ins', offsetMs, cause, pos, text, marks }
    }
    case 'del': {
      const fromTok = takeWord(rest)
      const toTok = takeWord(fromTok.rest)
      const { text } = readQuoted(toTok.rest)
      return { verb: 'del', offsetMs, cause, from: Number(fromTok.word), to: Number(toTok.word), text }
    }
    case 'mark+':
    case 'mark-': {
      const markTok = takeWord(rest)
      const fromTok = takeWord(markTok.rest)
      const toTok = takeWord(fromTok.rest)
      return {
        verb,
        offsetMs,
        cause,
        mark: markTok.word,
        from: Number(fromTok.word),
        to: Number(toTok.word),
      }
    }
    case 'step': {
      const { json, rest: afterJson } = readJsonToken(rest)
      const { text } = readQuoted(afterJson)
      return { verb: 'step', offsetMs, cause, stepJson: json, text }
    }
    case 'marker':
      return { verb: 'marker', offsetMs, cause, ref: rest }
    default:
      throw new Error(`unknown thread.log verb '${verb}': ${line}`)
  }
}

/**
 * Parses a `thread.log` block's text back into its records, folding `cont`
 * continuation lines transparently onto the record whose text they extend.
 *
 * Throws on a grammar-version mismatch or a malformed line — a malformed
 * `thread.log` value makes the thread read-only rather than guessing at
 * intent (the same discipline `use-prosemirror.ts`'s `schemaError` uses for
 * a body that fails schema validation).
 */
export function parseBlock(text: string): ThreadRecord[] {
  const lines = text.split('\n')
  parseHeaderLines(lines) // validates the header; header fields are read via parseBlockHeader

  const records: ThreadRecord[] = []
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]
    if (line.length === 0) continue // a lone trailing newline, not a record
    if (line.startsWith('cont ')) {
      appendContinuation(records, line.slice('cont '.length))
      continue
    }
    records.push(parseRecordLine(line))
  }
  return records
}

/**
 * Reads only a block's header (grammar version, the collab version before
 * its first step, and its wall-clock anchor) without parsing every record.
 * `ThreadService` uses this to verify continuity between successive
 * `thread.log` commits and to recover each record's absolute time.
 */
export function parseBlockHeader(text: string): ThreadBlockHeader {
  return parseHeaderLines(text.split('\n'))
}
