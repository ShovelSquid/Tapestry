/**
 * replay.ts tests (D-08, D-18, RESEARCH Pitfall 3).
 *
 * These pin the exact invariants 02.3-03-PLAN.md Task 2 calls out: `docAt`
 * at a checkpoint equals the stored checkpoint body exactly; `docAt` between
 * checkpoints equals the state after replaying the prefix; and the
 * interleaving case a time-sorted implementation gets wrong.
 */

import { describe, expect, it } from 'vitest'
import { formatBlock } from './grammar'
import { createDocAtCache, docAt, replayTo, type ThreadCommitEntry, type TimedThreadRecord } from './replay'

describe('replayTo', () => {
  it('replays ins/del onto an empty checkpoint, in the order given', () => {
    const records: TimedThreadRecord[] = [
      { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: 'H', marks: [], atMs: 0 },
      { verb: 'ins', offsetMs: 100, cause: null, pos: 2, text: 'i', marks: [], atMs: 100 },
    ]
    const result = replayTo('', records, Infinity)
    expect(result.document).toBe('Hi')
    expect(result.letters.map((l) => l.grapheme)).toEqual(['H', 'i'])
    expect(result.letters.every((l) => l.deletedAtMs === null)).toBe(true)
  })

  it('stops applying records once past untilMs, without reordering them', () => {
    const records: TimedThreadRecord[] = [
      { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: 'a', marks: [], atMs: 0 },
      { verb: 'ins', offsetMs: 500, cause: null, pos: 2, text: 'b', marks: [], atMs: 500 },
      { verb: 'ins', offsetMs: 1000, cause: null, pos: 3, text: 'c', marks: [], atMs: 1000 },
    ]
    expect(replayTo('', records, 0).document).toBe('a')
    expect(replayTo('', records, 499).document).toBe('a')
    expect(replayTo('', records, 500).document).toBe('ab')
    expect(replayTo('', records, Infinity).document).toBe('abc')
  })

  it('tracks a deleted letter rather than dropping it from the table (D-03)', () => {
    const records: TimedThreadRecord[] = [
      { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: 'Hey', marks: [], atMs: 0 },
      { verb: 'del', offsetMs: 100, cause: 'undo', from: 1, to: 4, text: 'Hey', atMs: 100 },
    ]
    const result = replayTo('', records, Infinity)
    expect(result.document).toBe('')
    expect(result.letters).toHaveLength(3)
    expect(result.letters.map((l) => l.grapheme)).toEqual(['H', 'e', 'y'])
    expect(result.letters.every((l) => l.insertedAtMs === 0)).toBe(true)
    expect(result.letters.every((l) => l.deletedAtMs === 100)).toBe(true)
  })

  it('seeds letters from a non-empty checkpoint so replay can continue past it', () => {
    const records: TimedThreadRecord[] = [{ verb: 'ins', offsetMs: 0, cause: null, pos: 3, text: '!', marks: [], atMs: 0 }]
    const result = replayTo('Hi', records, Infinity)
    expect(result.document).toBe('Hi!')
    // The two checkpoint-seeded letters carry -Infinity: their real
    // insertion time is not recoverable from the checkpoint text alone.
    expect(result.letters[0].insertedAtMs).toBe(-Infinity)
    expect(result.letters[1].insertedAtMs).toBe(-Infinity)
    expect(result.letters[2].insertedAtMs).toBe(0)
  })

  it('is exactly the interleaving case a time-sorted implementation gets wrong', () => {
    // Commit order: record A (an agent's write, committed first) then
    // record B (a person's write, committed second but carrying an EARLIER
    // time -- exactly the shape a rebase produces: the person typed it
    // before the agent's commit landed, but it was only written down
    // afterward). Correct replay applies A before B (commit order), which
    // this array's own order already encodes.
    const recordA: TimedThreadRecord = { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: 'X', marks: [], atMs: 1000 }
    const recordB: TimedThreadRecord = { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: 'Y', marks: [], atMs: 500 }

    const commitOrder = replayTo('', [recordA, recordB], Infinity)
    expect(commitOrder.document).toBe('YX')

    // A time-sorted implementation would apply B (atMs 500) before A (atMs
    // 1000) and get 'XY' instead -- the wrong document. Proving replayTo
    // does NOT do this: sorting the very same two records by time and
    // replaying in that order gives the different, wrong answer.
    const timeSorted = replayTo('', [recordA, recordB].sort((a, b) => a.atMs - b.atMs), Infinity)
    expect(timeSorted.document).toBe('XY')
    expect(timeSorted.document).not.toBe(commitOrder.document)
  })

  it('liveOrder gives the document-order id sequence, distinct from insertion order (D-18 highlight)', () => {
    // Insert "b" first, then insert "a" *before* it -- insertion order is
    // [b, a] (ids 0, 1) but document order is "ab" (ids [1, 0]).
    const records: TimedThreadRecord[] = [
      { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: 'b', marks: [], atMs: 0 },
      { verb: 'ins', offsetMs: 100, cause: null, pos: 1, text: 'a', marks: [], atMs: 100 },
    ]
    const result = replayTo('', records, Infinity)
    expect(result.document).toBe('ab')
    expect(result.liveOrder).toEqual([1, 0])
    expect(result.liveOrder.map((id) => result.letters[id].grapheme).join('')).toBe(result.document)
  })

  it('liveOrder excludes deleted letters', () => {
    const records: TimedThreadRecord[] = [
      { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: 'Hey', marks: [], atMs: 0 },
      { verb: 'del', offsetMs: 100, cause: null, from: 2, to: 3, text: 'e', atMs: 100 },
    ]
    const result = replayTo('', records, Infinity)
    expect(result.document).toBe('Hy')
    // 'e' (id 1) was deleted -- liveOrder holds only ids 0 ('H') and 2 ('y').
    expect(result.liveOrder).toEqual([0, 2])
  })
})

describe('docAt', () => {
  const ANCHOR_A = Date.parse('2026-01-01T00:00:00.000Z')
  const ANCHOR_B = Date.parse('2026-01-01T00:05:00.000Z')

  function block(anchorMs: number, versionBefore: number, lines: string[]): string {
    return [`thread 1 v${versionBefore}`, `at ${new Date(anchorMs).toISOString()}`, ...lines].join('\n')
  }

  it('at a checkpoint, returns the stored checkpoint body exactly', () => {
    const log = block(ANCHOR_A, 0, ['+0.000 ins 1 "a"', '+0.100 ins 2 "b"'])
    const commits: ThreadCommitEntry[] = [
      { kind: 'log', value: log },
      { kind: 'checkpoint', value: 'ab' },
    ]
    const checkpointMomentMs = ANCHOR_A + 100
    const result = docAt(commits, checkpointMomentMs)
    expect(result.document).toBe('ab')
  })

  it('between checkpoints, equals the state after replaying the prefix', () => {
    const log1 = block(ANCHOR_A, 0, ['+0.000 ins 1 "a"', '+0.100 ins 2 "b"'])
    const log2 = block(ANCHOR_B, 2, ['+0.000 ins 3 "c"', '+0.200 ins 4 "d"'])
    const commits: ThreadCommitEntry[] = [
      { kind: 'log', value: log1 },
      { kind: 'checkpoint', value: 'ab' },
      { kind: 'log', value: log2 },
      { kind: 'checkpoint', value: 'abcd' },
    ]

    // Squarely between the two checkpoints: only log2's first record (at
    // ANCHOR_B + 0) has happened; its second (at ANCHOR_B + 200) has not.
    const result = docAt(commits, ANCHOR_B)
    expect(result.document).toBe('abc')
  })

  it('before the first checkpoint, replays from the implicit empty document', () => {
    const log = block(ANCHOR_A, 0, ['+0.000 ins 1 "a"'])
    const commits: ThreadCommitEntry[] = [
      { kind: 'log', value: log },
      { kind: 'checkpoint', value: 'a' },
    ]
    const result = docAt(commits, ANCHOR_A - 1)
    expect(result.document).toBe('')
  })

  it('replays a real formatBlock/parseBlock round trip, not just hand-built records', () => {
    const log = formatBlock(
      [
        { verb: 'in', offsetMs: 0, session: 1 },
        { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: 'Hi', marks: [] },
        { verb: 'out', offsetMs: 5000 },
      ],
      ANCHOR_A,
      0,
    )
    const commits: ThreadCommitEntry[] = [
      { kind: 'log', value: log },
      { kind: 'checkpoint', value: 'Hi' },
    ]
    expect(docAt(commits, ANCHOR_A + 5000).document).toBe('Hi')
  })
})

describe('createDocAtCache', () => {
  const ANCHOR_A = Date.parse('2026-01-01T00:00:00.000Z')
  const ANCHOR_B = Date.parse('2026-01-01T00:05:00.000Z')

  function block(anchorMs: number, versionBefore: number, lines: string[]): string {
    return [`thread 1 v${versionBefore}`, `at ${new Date(anchorMs).toISOString()}`, ...lines].join('\n')
  }

  function twoCheckpointCommits(): ThreadCommitEntry[] {
    const log1 = block(ANCHOR_A, 0, ['+0.000 ins 1 "a"', '+0.100 ins 2 "b"'])
    const log2 = block(ANCHOR_B, 2, ['+0.000 ins 3 "c"', '+0.200 ins 4 "d"'])
    return [
      { kind: 'log', value: log1 },
      { kind: 'checkpoint', value: 'ab' },
      { kind: 'log', value: log2 },
      { kind: 'checkpoint', value: 'abcd' },
    ]
  }

  it('matches plain docAt at every moment tested against it', () => {
    const commits = twoCheckpointCommits()
    const cache = createDocAtCache(commits)
    for (const tMs of [ANCHOR_A - 1, ANCHOR_A + 100, ANCHOR_B, ANCHOR_B + 200]) {
      expect(cache.docAt(tMs).document).toBe(docAt(commits, tMs).document)
    }
  })

  it('docAt at the same moment twice recomputes nothing (same object, by reference)', () => {
    const commits = twoCheckpointCommits()
    const cache = createDocAtCache(commits)
    const first = cache.docAt(ANCHOR_B)
    const second = cache.docAt(ANCHOR_B)
    expect(second).toBe(first) // reference equality: no recomputation happened
  })

  it('a different moment produces a fresh result, not the cached one', () => {
    const commits = twoCheckpointCommits()
    const cache = createDocAtCache(commits)
    const first = cache.docAt(ANCHOR_B)
    const second = cache.docAt(ANCHOR_B + 200)
    expect(second).not.toBe(first)
    expect(second.document).not.toBe(first.document)
  })

  it('a scrub across a checkpoint boundary (forward, then back) replays correctly from the nearer checkpoint each time', () => {
    const commits = twoCheckpointCommits()
    const cache = createDocAtCache(commits)
    // Forward across the boundary at ANCHOR_B (the second checkpoint's own
    // moment is ANCHOR_B + 200): before it, still on the first checkpoint's
    // side; after it, replaying from the second checkpoint.
    expect(cache.docAt(ANCHOR_B - 1).document).toBe('ab')
    expect(cache.docAt(ANCHOR_B + 200).document).toBe('abcd')
    // ...and back again -- the cache must not have latched onto whichever
    // checkpoint the previous call resolved to. ANCHOR_A+50 sits between
    // log1's two records (+0.000 and +0.100), so only the first has landed.
    expect(cache.docAt(ANCHOR_A + 50).document).toBe('a')
  })
})
