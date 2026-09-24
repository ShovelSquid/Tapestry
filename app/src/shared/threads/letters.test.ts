/**
 * LetterIndex property test (02.3-PATTERNS.md's "No Analog Found" oracle
 * approach): a naive, deliberately slow oracle re-implements grapheme
 * identity as a plain array with one entry per UTF-16 code unit -- the
 * "obvious way" -- and 10,000 randomized insert/delete operations are
 * checked to agree with `LetterIndex` on letter ids, authorship and
 * deletion times after every single operation.
 *
 * The random loop drives real ProseMirror `ReplaceStep`s against a real,
 * growing single-paragraph document (mirroring `thread-service.ts`'s own
 * flat-document tracer convention: position `p` addresses flat index
 * `p - 1`), so `LetterIndex.applyStep` is exercised through its real
 * `step.getMap()` path, never through a hand-built range tuple.
 *
 * Multi-paragraph structure edits (the other half of this task's corpus
 * requirement) are proven separately, in `describe('structural steps')`
 * below: rather than teaching the naive oracle multi-paragraph position
 * semantics (an easy place for a *test* bug to hide, since the oracle
 * would have to reproduce the exact position accounting the pitfall is
 * about), that test builds a real Enter-like structural step and checks
 * `LetterIndex`'s reported positions directly against `doc.textBetween`,
 * which is the more direct proof of the property the pitfall cares about:
 * "positions after a structural step point at the right text".
 */

import { describe, expect, it } from 'vitest'
import { Fragment, Slice } from 'prosemirror-model'
import { ReplaceStep } from 'prosemirror-transform'
import { tapestrySchema } from '../../renderer/editor/schema'
import { LetterIndex, type LetterInfo } from './letters'

// ---------------------------------------------------------------------------
// Seeded PRNG (CONVENTIONS.md's mulberry32 pattern, duplicated locally --
// this is a shared/ test and must not import from app/test/bench)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Corpus (the plan's own required set)
// ---------------------------------------------------------------------------

const ASCII_ALPHABET = 'abcdefghijklmnopqrstuvwxyz ABCDEFG'
/** Woman + ZWJ + woman + ZWJ + girl -- a family emoji, one grapheme, 8 UTF-16 units. */
const ZWJ_FAMILY = '\u{1F469}‍\u{1F469}‍\u{1F467}'
/** New Zealand flag -- two regional-indicator surrogate pairs, one grapheme, 4 UTF-16 units. */
const REGIONAL_FLAG = '\u{1F1F3}\u{1F1FF}'
/** "e" + combining acute accent -- one grapheme, 2 UTF-16 units. */
const COMBINING_ACCENT = 'é'

function graphemesOf(text: string): string[] {
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (entry) => entry.segment)
}

function randomInsertText(rng: () => number): string {
  const r = rng()
  if (r < 0.7) {
    const n = 1 + Math.floor(rng() * 4)
    let s = ''
    for (let i = 0; i < n; i++) s += ASCII_ALPHABET[Math.floor(rng() * ASCII_ALPHABET.length)]
    return s
  }
  if (r < 0.8) return ZWJ_FAMILY
  if (r < 0.9) return REGIONAL_FLAG
  return COMBINING_ACCENT
}

// ---------------------------------------------------------------------------
// Naive oracle: one array entry per live UTF-16 code unit, "the slow,
// obvious way" -- a full linear scan to find a touched letter's whole span,
// exactly the brute-force approach LetterIndex's run table exists to avoid.
// ---------------------------------------------------------------------------

interface OracleUnit {
  letterId: number
  char: string
}

class Oracle {
  units: OracleUnit[] = []
  letters: LetterInfo[] = []

  private mintFromText(text: string, actor: string, tMs: number): number[] {
    const ids: number[] = []
    for (const grapheme of graphemesOf(text)) {
      ids.push(this.letters.length)
      this.letters.push({ id: this.letters.length, grapheme, actor, insertedAtMs: tMs, deletedAtMs: null })
    }
    return ids
  }

  private unitsFor(text: string, ids: number[]): OracleUnit[] {
    const units: OracleUnit[] = []
    let gi = 0
    for (const grapheme of graphemesOf(text)) {
      for (let i = 0; i < grapheme.length; i++) units.push({ letterId: ids[gi], char: grapheme[i] })
      gi++
    }
    return units
  }

  private retagRange(from: number, to: number, actor: string, tMs: number): void {
    if (to <= from) return
    const text = this.units
      .slice(from, to)
      .map((u) => u.char)
      .join('')
    const ids = this.mintFromText(text, actor, tMs)
    const units = this.unitsFor(text, ids)
    for (let i = 0; i < units.length; i++) this.units[from + i] = units[i]
  }

  /**
   * `docPosFrom`/`docPosTo` are raw ProseMirror doc positions (1-based: doc
   * position 1 addresses `units[0]`, matching `thread-service.ts`'s own
   * flat-document convention "position p addresses flat index p - 1") --
   * converted to 0-based array indices once, up front, so every other line
   * in this method works in plain array-index space.
   */
  applyRange(docPosFrom: number, docPosTo: number, insertedText: string, actor: string, tMs: number): void {
    const from = docPosFrom - 1
    const to = docPosTo - 1

    const touched = new Set<number>()
    if (to === from) {
      // Zero-width range (a pure insert): the naive [from, to) scan is
      // empty, so a mid-letter insertion has to be detected by checking
      // whether the units immediately before and after the insertion point
      // belong to the very same (multi-unit) letter.
      const before = this.units[from - 1]
      const after = this.units[from]
      if (before && after && before.letterId === after.letterId) touched.add(before.letterId)
    } else {
      for (let i = from; i < to; i++) touched.add(this.units[i].letterId)
    }

    for (const id of touched) {
      let gStart = -1
      let gEnd = -1
      for (let i = 0; i < this.units.length; i++) {
        if (this.units[i].letterId === id) {
          if (gStart === -1) gStart = i
          gEnd = i + 1
        }
      }
      const originalActor = this.letters[id].actor
      this.letters[id].deletedAtMs = tMs
      if (gStart < from) this.retagRange(gStart, from, originalActor, tMs)
      if (gEnd > to) this.retagRange(to, gEnd, originalActor, tMs)
    }

    const insertedIds = this.mintFromText(insertedText, actor, tMs)
    const insertedUnits = this.unitsFor(insertedText, insertedIds)
    this.units.splice(from, to - from, ...insertedUnits)
  }
}

// ---------------------------------------------------------------------------
// LetterIndex-side helpers
// ---------------------------------------------------------------------------

/** Expands LetterIndex's live runs into one entry per UTF-16 code unit, in
 * document order -- the same granularity the oracle's `units` array uses,
 * so the two can be compared directly with `toEqual`. */
function liveIdSequence(index: LetterIndex): number[] {
  const ids: number[] = []
  for (const run of index.runsForDecorations()) {
    for (let i = 0; i < run.graphemeCount; i++) {
      const id = run.firstLetterId + i
      const info = index.letterAt(id)!
      for (let u = 0; u < info.grapheme.length; u++) ids.push(id)
    }
  }
  return ids
}

/**
 * Compares every letter the oracle has ever minted (its count only grows,
 * so this is unavoidably O(total letters so far) on every call) plus the
 * live document-order sequence, throwing a plain `Error` on the first
 * mismatch. Deliberately avoids `expect()`/`toEqual()` in this hot loop:
 * vitest's matcher machinery carries enough per-call overhead that calling
 * it inside an O(total letters) comparison, itself inside a 10,000-
 * iteration loop over a letter count that grows into the tens of
 * thousands, turns a sub-second check into a multi-minute one. A thrown
 * `Error` still fails the `it(...)` with a readable message.
 */
function assertMatches(index: LetterIndex, oracle: Oracle, iter: number): void {
  if (index.letterCount !== oracle.letters.length) {
    throw new Error(`iter ${iter}: letterCount mismatch: index=${index.letterCount} oracle=${oracle.letters.length}`)
  }
  for (let id = 0; id < oracle.letters.length; id++) {
    const actual = index.letterAt(id)!
    const expected = oracle.letters[id]
    if (
      actual.grapheme !== expected.grapheme ||
      actual.actor !== expected.actor ||
      actual.insertedAtMs !== expected.insertedAtMs ||
      actual.deletedAtMs !== expected.deletedAtMs
    ) {
      throw new Error(`iter ${iter}: letter ${id} mismatch: ${JSON.stringify(actual)} vs oracle ${JSON.stringify(expected)}`)
    }
  }
  const liveIndex = liveIdSequence(index)
  const liveOracle = oracle.units.map((u) => u.letterId)
  if (liveIndex.length !== liveOracle.length || liveIndex.some((v, i) => v !== liveOracle[i])) {
    throw new Error(
      `iter ${iter}: live sequence mismatch:\n  index=${JSON.stringify(liveIndex)}\n oracle=${JSON.stringify(liveOracle)}`,
    )
  }
}

function insertStep(pos: number, text: string): ReplaceStep {
  return new ReplaceStep(pos, pos, new Slice(Fragment.from(tapestrySchema.text(text)), 0, 0))
}

function deleteStep(from: number, to: number): ReplaceStep {
  return new ReplaceStep(from, to, Slice.empty)
}

// ---------------------------------------------------------------------------
// The property test
// ---------------------------------------------------------------------------

describe('LetterIndex property test (10,000 randomized edits vs a naive oracle)', () => {
  it('agrees with a naive per-UTF-16-unit oracle on ids, authorship and deletion times after every operation', () => {
    const ITERATIONS = 10_000
    const rng = mulberry32(7)
    const actors = ['human.kaelen', 'agent.claude']

    const index = new LetterIndex()
    const oracle = new Oracle()

    let doc = tapestrySchema.node('doc', null, [tapestrySchema.node('paragraph')])
    let actor = actors[0]
    let tMs = 0
    let sawFamily = false
    let sawFlag = false
    let sawCombining = false

    for (let iter = 0; iter < ITERATIONS; iter++) {
      tMs += 1 + Math.floor(rng() * 50)
      if (rng() < 0.1) actor = actors[Math.floor(rng() * actors.length)]

      const textLen = doc.child(0).content.size
      // A hard cap bounds the naive oracle's per-operation O(n) scan cost
      // over 10,000 iterations, deterministically rather than merely
      // probabilistically -- once the doc reaches CAP, only deletes happen
      // until it shrinks back down.
      const CAP = 300
      const wantsInsert = textLen === 0 ? true : textLen < CAP && rng() < 0.45

      let step: ReplaceStep
      let insertedText: string
      if (wantsInsert) {
        const pos = 1 + Math.floor(rng() * (textLen + 1))
        insertedText = randomInsertText(rng)
        step = insertStep(pos, insertedText)
      } else {
        insertedText = ''
        // 15% of deletes clear everything, bounding growth over 10k iterations
        // without ever special-casing state -- this is an ordinary delete op.
        if (rng() < 0.15) {
          step = deleteStep(1, textLen + 1)
        } else {
          const from = 1 + Math.floor(rng() * textLen)
          const maxLen = textLen - (from - 1)
          const len = 1 + Math.floor(rng() * maxLen)
          step = deleteStep(from, from + len)
        }
      }

      const result = step.apply(doc)
      if (result.failed) continue // a generated position was invalid; skip, state unchanged

      if (insertedText === ZWJ_FAMILY) sawFamily = true
      if (insertedText === REGIONAL_FLAG) sawFlag = true
      if (insertedText === COMBINING_ACCENT) sawCombining = true

      let oldStart = -1
      let oldEnd = -1
      step.getMap().forEach((a, b) => {
        oldStart = a
        oldEnd = b
      })

      index.applyStep(step, insertedText, actor, tMs)
      oracle.applyRange(oldStart, oldEnd, insertedText, actor, tMs)
      doc = result.doc!

      assertMatches(index, oracle, iter)
    }

    // The corpus requirement: over 10,000 iterations, every special sequence
    // in it was actually exercised at least once (not just theoretically
    // reachable) -- and by construction, some of those insertions will later
    // be cut by a randomly-placed delete boundary, exercising Pitfall 4.
    expect(sawFamily).toBe(true)
    expect(sawFlag).toBe(true)
    expect(sawCombining).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Split-grapheme deletion (Pitfall 4), proven explicitly and deterministically
// ---------------------------------------------------------------------------

describe('split-grapheme deletion', () => {
  it('marks the whole old letter deleted and mints the surviving code units as a new letter', () => {
    const index = new LetterIndex()
    let doc = tapestrySchema.node('doc', null, [tapestrySchema.node('paragraph')])

    // Insert "a<flag>b" -- flag is one grapheme spanning positions [2, 6).
    const ins = insertStep(1, 'a' + REGIONAL_FLAG + 'b')
    let result = ins.apply(doc)
    expect(result.failed).toBeNull()
    doc = result.doc!
    index.applyStep(ins, 'a' + REGIONAL_FLAG + 'b', 'human.kaelen', 100)

    // Letter 0 = 'a', letter 1 = the flag (4 units), letter 2 = 'b'.
    expect(index.letterAt(1)!.grapheme).toBe(REGIONAL_FLAG)
    expect(index.letterAt(1)!.deletedAtMs).toBeNull()

    // Delete positions [3, 5) -- strictly inside the flag's [2, 6) span: cuts
    // it in half, with 1 surviving UTF-16 unit on each side.
    const del = deleteStep(3, 5)
    result = del.apply(doc)
    expect(result.failed).toBeNull()
    doc = result.doc!
    index.applyStep(del, '', 'human.kaelen', 200)

    // The whole original flag letter is deleted, not just the covered part.
    expect(index.letterAt(1)!.deletedAtMs).toBe(200)

    // Two brand new letters were minted for the surviving code units (ids 3
    // and 4 -- id 2 is 'b', already minted before the split).
    expect(index.letterCount).toBe(5)
    const prefixLeftover = index.letterAt(3)!
    const suffixLeftover = index.letterAt(4)!
    expect(prefixLeftover.deletedAtMs).toBeNull()
    expect(prefixLeftover.insertedAtMs).toBe(200)
    expect(suffixLeftover.deletedAtMs).toBeNull()
    expect(suffixLeftover.insertedAtMs).toBe(200)
    // No partial grapheme is ever addressable: each leftover is a whole,
    // freshly-segmented grapheme (here, one lone surrogate half each).
    expect(prefixLeftover.grapheme.length).toBe(1)
    expect(suffixLeftover.grapheme.length).toBe(1)

    // 'a' and 'b' (letters 0 and 2) are untouched by the split.
    expect(index.letterAt(0)!.deletedAtMs).toBeNull()
    expect(index.letterAt(2)!.deletedAtMs).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Deletion never removes a letter (D-03)
// ---------------------------------------------------------------------------

describe('deletion retention (D-03)', () => {
  it('keeps a deleted letter in the index with deletedAtMs set, never removing it', () => {
    const index = new LetterIndex()
    let doc = tapestrySchema.node('doc', null, [tapestrySchema.node('paragraph')])

    const ins = insertStep(1, 'hello')
    let result = ins.apply(doc)
    doc = result.doc!
    index.applyStep(ins, 'hello', 'human.kaelen', 10)
    expect(index.letterCount).toBe(5)

    const del = deleteStep(1, 6)
    result = del.apply(doc)
    doc = result.doc!
    index.applyStep(del, '', 'human.kaelen', 20)

    // Still 5 letters -- nothing removed -- every one now deleted at 20.
    expect(index.letterCount).toBe(5)
    for (let id = 0; id < 5; id++) {
      expect(index.letterAt(id)!.deletedAtMs).toBe(20)
    }
    expect(index.lettersIn(0, doc.content.size)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Structure steps (multi-paragraph edits): positions after an Enter-like
// split are proven directly against doc.textBetween, never against a second
// hand-rolled oracle for structural position math (see file header).
// ---------------------------------------------------------------------------

describe('structural steps (multi-paragraph edits)', () => {
  it('keeps every live letter position correct across a paragraph split', () => {
    const index = new LetterIndex()
    let doc = tapestrySchema.node('doc', null, [tapestrySchema.node('paragraph')])
    let actor = 'human.kaelen'
    let tMs = 0

    function insert(pos: number, text: string) {
      const step = insertStep(pos, text)
      const result = step.apply(doc)
      expect(result.failed).toBeNull()
      doc = result.doc!
      tMs += 10
      index.applyStep(step, text, actor, tMs)
    }

    insert(1, 'HelloWorld') // positions 1..11 inside the one paragraph

    // Split "HelloWorld" into "Hello" | "World" at position 6 (an Enter
    // between 'o' and 'W') -- the exact probed shape from RESEARCH Pattern 2:
    // {"stepType":"replace",...,"content":[{"type":"paragraph"},{"type":"paragraph"}],
    //  "openStart":1,"openEnd":1,"structure":true}.
    const splitFragment = Fragment.from([tapestrySchema.node('paragraph'), tapestrySchema.node('paragraph')])
    const enterStep = new ReplaceStep(6, 6, new Slice(splitFragment, 1, 1), true)
    const enterResult = enterStep.apply(doc)
    expect(enterResult.failed).toBeNull()
    doc = enterResult.doc!
    tMs += 10
    // A structural step inserts no addressable letters of its own.
    index.applyStep(enterStep, '', actor, tMs)

    expect(doc.childCount).toBe(2)
    expect(doc.child(0).textContent).toBe('Hello')
    expect(doc.child(1).textContent).toBe('World')

    // Type more after the split, into the second paragraph.
    insert(doc.child(0).nodeSize + doc.child(1).content.size + 1, '!')
    expect(doc.child(1).textContent).toBe('World!')

    // Every live run's reported position must point at exactly its own text.
    for (const run of index.runsForDecorations()) {
      const text = doc.textBetween(run.pos, run.pos + run.utf16Length, '\n')
      const expected = Array.from({ length: run.graphemeCount }, (_, i) => index.letterAt(run.firstLetterId + i)!.grapheme).join('')
      expect(text).toBe(expected)
    }
  })
})

// ---------------------------------------------------------------------------
// runsForDecorations / lettersIn basic shape
// ---------------------------------------------------------------------------

describe('runsForDecorations / lettersIn', () => {
  it('reports live runs in document order and resolves a range to live letter ids', () => {
    const index = new LetterIndex()
    let doc = tapestrySchema.node('doc', null, [tapestrySchema.node('paragraph')])

    const ins = insertStep(1, 'abc')
    const result = ins.apply(doc)
    doc = result.doc!
    index.applyStep(ins, 'abc', 'human.kaelen', 5)

    const runs = index.runsForDecorations()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ firstLetterId: 0, graphemeCount: 3, utf16Length: 3, pos: 1, actor: 'human.kaelen' })

    expect(index.lettersIn(1, 3)).toEqual([0, 1])
    expect(index.authorOf(0)).toBe('human.kaelen')
    expect(index.authorOf(99)).toBeUndefined()
  })
})
