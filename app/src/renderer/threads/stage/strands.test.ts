/**
 * Pure span/twist derivation for `StrandLayer` (D-20..D-23) — no WebGL, no
 * DOM; `stage/*.test.ts` files stay this way throughout the codebase
 * (vitest's `environment: 'node'` has no DOM, the same constraint every
 * other stage module already lives under).
 */

import { describe, expect, it } from 'vitest'
import { computeTwistWindows, deriveAuthorSpans, splitSpanByTwistWindows, SPAN_GAP_SECONDS } from './strands'

const THREAD_START = 0

describe('deriveAuthorSpans', () => {
  it('groups consecutive same-actor letters within the gap into one span', () => {
    const letters = [
      { insertedAtMs: 0, actor: 'human.kaelen' },
      { insertedAtMs: 500, actor: 'human.kaelen' },
      { insertedAtMs: 1000, actor: 'human.kaelen' },
    ]
    const spans = deriveAuthorSpans(letters, THREAD_START)
    expect(spans).toEqual([{ actor: 'human.kaelen', startSeconds: 0, endSeconds: 1 }])
  })

  it('splits into two spans once the gap between letters exceeds SPAN_GAP_SECONDS', () => {
    const letters = [
      { insertedAtMs: 0, actor: 'human.kaelen' },
      { insertedAtMs: (SPAN_GAP_SECONDS + 5) * 1000, actor: 'human.kaelen' },
    ]
    const spans = deriveAuthorSpans(letters, THREAD_START)
    expect(spans).toHaveLength(2)
    expect(spans[0]).toEqual({ actor: 'human.kaelen', startSeconds: 0, endSeconds: 0 })
    expect(spans[1].startSeconds).toBe(SPAN_GAP_SECONDS + 5)
  })

  it('tracks each actor independently, sorted by start time', () => {
    const letters = [
      { insertedAtMs: 5000, actor: 'agent.claude' },
      { insertedAtMs: 0, actor: 'human.kaelen' },
    ]
    const spans = deriveAuthorSpans(letters, THREAD_START)
    expect(spans.map((s) => s.actor)).toEqual(['human.kaelen', 'agent.claude'])
  })

  it('ignores a letter with a non-finite insertion time (a checkpoint-seeded letter)', () => {
    const letters = [
      { insertedAtMs: -Infinity, actor: 'unknown' },
      { insertedAtMs: 0, actor: 'human.kaelen' },
    ]
    const spans = deriveAuthorSpans(letters, THREAD_START)
    expect(spans).toHaveLength(1)
    expect(spans[0].actor).toBe('human.kaelen')
  })
})

describe('computeTwistWindows', () => {
  it('is empty when only one author has written', () => {
    const spans = deriveAuthorSpans(
      [
        { insertedAtMs: 0, actor: 'human.kaelen' },
        { insertedAtMs: 500, actor: 'human.kaelen' },
      ],
      THREAD_START,
    )
    expect(computeTwistWindows(spans)).toEqual([])
  })

  it('finds a window where two different authors overlap directly', () => {
    const spans = [
      { actor: 'human.kaelen', startSeconds: 0, endSeconds: 10 },
      { actor: 'agent.claude', startSeconds: 5, endSeconds: 15 },
    ]
    const windows = computeTwistWindows(spans, 0)
    expect(windows).toHaveLength(1)
    expect(windows[0].startSeconds).toBeCloseTo(5)
    expect(windows[0].endSeconds).toBeCloseTo(10)
  })

  it('finds a window where two spans are close but not overlapping, within the gap', () => {
    const spans = [
      { actor: 'human.kaelen', startSeconds: 0, endSeconds: 5 },
      { actor: 'agent.claude', startSeconds: 6, endSeconds: 10 },
    ]
    const windows = computeTwistWindows(spans, SPAN_GAP_SECONDS)
    expect(windows).toHaveLength(1)
  })

  it('finds nothing when two different-author spans are far apart', () => {
    const spans = [
      { actor: 'human.kaelen', startSeconds: 0, endSeconds: 5 },
      { actor: 'agent.claude', startSeconds: 100, endSeconds: 110 },
    ]
    expect(computeTwistWindows(spans, SPAN_GAP_SECONDS)).toEqual([])
  })

  it('never treats the same author\'s own two spans as a twist', () => {
    const spans = [
      { actor: 'human.kaelen', startSeconds: 0, endSeconds: 5 },
      { actor: 'human.kaelen', startSeconds: 5.5, endSeconds: 10 },
    ]
    expect(computeTwistWindows(spans, SPAN_GAP_SECONDS)).toEqual([])
  })

  it('merges overlapping windows from more than two authors into one', () => {
    const spans = [
      { actor: 'human.kaelen', startSeconds: 0, endSeconds: 10 },
      { actor: 'agent.claude', startSeconds: 2, endSeconds: 8 },
      { actor: 'agent.gemini', startSeconds: 6, endSeconds: 12 },
    ]
    const windows = computeTwistWindows(spans, 0)
    expect(windows).toHaveLength(1)
    expect(windows[0].startSeconds).toBeCloseTo(2)
    expect(windows[0].endSeconds).toBeCloseTo(10)
  })
})

describe('splitSpanByTwistWindows', () => {
  it('with no windows, returns the whole span as non-twisting', () => {
    const pieces = splitSpanByTwistWindows({ actor: 'human.kaelen', startSeconds: 0, endSeconds: 10 }, [])
    expect(pieces).toEqual([{ startSeconds: 0, endSeconds: 10, twisting: false }])
  })

  it('splits a span into non-twisting/twisting/non-twisting around a window in the middle', () => {
    const span = { actor: 'human.kaelen', startSeconds: 0, endSeconds: 10 }
    const pieces = splitSpanByTwistWindows(span, [{ startSeconds: 4, endSeconds: 6 }])
    expect(pieces).toEqual([
      { startSeconds: 0, endSeconds: 4, twisting: false },
      { startSeconds: 4, endSeconds: 6, twisting: true },
      { startSeconds: 6, endSeconds: 10, twisting: false },
    ])
  })

  it('a window covering the whole span produces one twisting piece', () => {
    const span = { actor: 'human.kaelen', startSeconds: 0, endSeconds: 10 }
    const pieces = splitSpanByTwistWindows(span, [{ startSeconds: -5, endSeconds: 15 }])
    expect(pieces).toEqual([{ startSeconds: 0, endSeconds: 10, twisting: true }])
  })
})
