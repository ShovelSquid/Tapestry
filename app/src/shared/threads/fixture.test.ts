/**
 * Cross-layer golden (D-06, T-02.3-03-04): the committed `example.tree`
 * parses and replays to its own checkpoint body.
 *
 * This reads the real, committed `tapestry/docs/tree/example.tree` from
 * disk — never an inline copy of its bytes — so a change on either side of
 * the C++ writer / TypeScript reader boundary fails this test. The plan's
 * own acceptance criteria (02.3-03-PLAN.md Task 2) requires exactly that:
 * "the test is not reading the committed fixture" would otherwise be
 * silently possible if this pinned a copy instead.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseTimedRecords, replayTo } from './replay'

const FIXTURE_PATH = resolve(__dirname, '../../../../tapestry/docs/tree/example.tree')

// ---------------------------------------------------------------------------
// Minimal .tree line extraction — just enough to pull out one node's
// `thread.log` blocks and its last `body` checkpoint, per FORMAT.md's own
// block/inline value grammar. This is not a general .tree parser: it is the
// smallest amount of scanning that lets this test read the real committed
// file rather than a copy of its bytes.
// ---------------------------------------------------------------------------

/** Reads lines `startIndex..` up to (not including) a line that equals
 * `delimiter` exactly, per FORMAT.md's block-text rule. */
function readBlockBody(lines: string[], startIndex: number, delimiter: string): { text: string; nextIndex: number } {
  const body: string[] = []
  let i = startIndex
  while (i < lines.length && lines[i] !== delimiter) {
    body.push(lines[i])
    i++
  }
  if (i >= lines.length) {
    throw new Error(`unterminated <<${delimiter} block starting at line ${startIndex}`)
  }
  return { text: body.join('\n'), nextIndex: i + 1 }
}

/** Inverse of grammar.ts's `quoteText` / FORMAT.md's inline text escapes,
 * for a `"…"` token this fixture's own values use (no surrogate pairs, no
 * escape this golden file doesn't already exercise in grammar.test.ts). */
function unquoteInline(token: string): string {
  if (!token.startsWith('"') || !token.endsWith('"')) {
    throw new Error(`expected an inline quoted string: ${token}`)
  }
  const inner = token.slice(1, -1)
  let out = ''
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = inner[i + 1]
    if (next === '"' || next === '\\') {
      out += next
      i++
    } else if (next === 'n') {
      out += '\n'
      i++
    } else if (next === 't') {
      out += '\t'
      i++
    } else if (next === 'r') {
      out += '\r'
      i++
    } else if (next === 'u') {
      out += String.fromCharCode(parseInt(inner.slice(i + 2, i + 6), 16))
      i += 5
    } else {
      throw new Error(`unknown escape \\${next} in ${token}`)
    }
  }
  return out
}

/** Every `set <nodeId> thread.log text <<DELIM …` block's raw value, for
 * `nodeId`, in file order. */
function extractThreadLogBlocks(fileText: string, nodeId: string): string[] {
  const lines = fileText.split('\n')
  const opRe = new RegExp(`^set ${nodeId} thread\\.log text <<(\\S+)$`)
  const blocks: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = opRe.exec(lines[i])
    if (!match) continue
    const { text, nextIndex } = readBlockBody(lines, i + 1, match[1])
    blocks.push(text)
    i = nextIndex - 1
  }
  return blocks
}

/** The LAST `set <nodeId> body text …` value for `nodeId` — inline or
 * block form — since a body checkpoint is set more than once over a
 * thread's life and only the most recent one is "current" (FORMAT.md: "the
 * latest set wins for the current value"). */
function extractLastBodyCheckpoint(fileText: string, nodeId: string): string {
  const lines = fileText.split('\n')
  const inlineRe = new RegExp(`^set ${nodeId} body text (".*")$`)
  const blockRe = new RegExp(`^set ${nodeId} body text <<(\\S+)$`)
  let found: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const inlineMatch = inlineRe.exec(lines[i])
    if (inlineMatch) {
      found = unquoteInline(inlineMatch[1])
      continue
    }
    const blockMatch = blockRe.exec(lines[i])
    if (blockMatch) {
      const { text, nextIndex } = readBlockBody(lines, i + 1, blockMatch[1])
      found = text
      i = nextIndex - 1
    }
  }
  if (found === null) {
    throw new Error(`no body checkpoint found for ${nodeId} in ${FIXTURE_PATH}`)
  }
  return found
}

describe('fixture: example.tree thread commits replay to their own checkpoint', () => {
  it('reads the real committed file, not a copy of its bytes', () => {
    const fileText = readFileSync(FIXTURE_PATH, 'utf8')
    expect(fileText).toContain('tapestry.threads/thread@1')
    expect(fileText).toContain('thread.log')
  })

  it('replays every thread.log block for the thread node onto an empty document and equals its body checkpoint', () => {
    const fileText = readFileSync(FIXTURE_PATH, 'utf8')

    const blocks = extractThreadLogBlocks(fileText, 'n3')
    expect(blocks.length).toBe(2) // commits 8 and 9

    const records = blocks.flatMap((block) => parseTimedRecords(block))
    const replayed = replayTo('', records, Infinity)

    const checkpoint = extractLastBodyCheckpoint(fileText, 'n3')
    expect(checkpoint).toBe('Hi Sam')
    expect(replayed.document).toBe(checkpoint)
  })
})
