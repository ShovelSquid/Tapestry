/**
 * `thread.log` grammar round-trip tests (D-06, one-way door).
 *
 * These pin exactly the invariants 02.3-02-PLAN.md Task 1 calls out: integer
 * millisecond offsets, the FORMAT.md inline escape set, oversized-insert
 * splitting via `cont`, and negative-offset clamping.
 */

import { describe, expect, it } from 'vitest'
import {
  formatBlock,
  parseBlock,
  parseBlockHeader,
  quoteText,
  THREAD_GRAMMAR_VERSION,
  type ThreadRecord,
} from './grammar'

const ANCHOR_MS = Date.parse('2026-09-15T21:04:10.250Z')

describe('THREAD_GRAMMAR_VERSION', () => {
  it('is 1', () => {
    expect(THREAD_GRAMMAR_VERSION).toBe(1)
  })
})

describe('formatBlock / parseBlock round trip', () => {
  it('round-trips a randomized sequence covering every verb', () => {
    // A fixed (not truly random) but varied sequence, so failures are
    // reproducible: every verb, every cause slot, and boundary offsets.
    const records: ThreadRecord[] = [
      { verb: 'in', offsetMs: 0, session: 3 },
      { verb: 'ins', offsetMs: 0, cause: null, pos: 14, text: 'H', marks: [] },
      { verb: 'ins', offsetMs: 182, cause: null, pos: 15, text: 'e', marks: ['strong'] },
      { verb: 'ins', offsetMs: 301, cause: null, pos: 16, text: 'y', marks: [] },
      { verb: 'del', offsetMs: 950, cause: null, from: 15, to: 17, text: 'ey' },
      { verb: 'ins', offsetMs: 1420, cause: 'paste', pos: 15, text: 'llo world', marks: [] },
      { verb: 'mark+', offsetMs: 2004, cause: 'format', mark: 'strong', from: 1, to: 12 },
      { verb: 'mark-', offsetMs: 2100, cause: 'format', mark: 'em', from: 1, to: 5 },
      { verb: 'del', offsetMs: 2300, cause: 'undo', from: 1, to: 12, text: 'Hello world' },
      { verb: 'marker', offsetMs: 3100, cause: 'link', ref: 'e12' },
      {
        verb: 'step',
        offsetMs: 4000,
        cause: 'enter',
        stepJson: '{"stepType":"replace","from":26,"to":26,"structure":true}',
        text: '',
      },
      { verb: 'out', offsetMs: 154000 },
    ]

    const block = formatBlock(records, ANCHOR_MS, 118)
    const parsed = parseBlock(block)
    expect(parsed).toEqual(records)
  })

  it('parses a golden block field by field', () => {
    const block = [
      'thread 1 v118',
      'at 2026-09-15T21:04:10.250Z',
      '+0.000 in 3',
      '+0.000 ins 14 "H"',
      '+0.182 ins 15 "e" strong',
      '+0.950 del 15 17 "ey"',
      '+1.420 paste ins 15 "llo world"',
      '+2.300 undo del 1 12 "Hello world"',
      '+3.100 link marker e12',
      '+154.000 out',
    ].join('\n')

    const records = parseBlock(block)
    expect(records).toEqual([
      { verb: 'in', offsetMs: 0, session: 3 },
      { verb: 'ins', offsetMs: 0, cause: null, pos: 14, text: 'H', marks: [] },
      { verb: 'ins', offsetMs: 182, cause: null, pos: 15, text: 'e', marks: ['strong'] },
      { verb: 'del', offsetMs: 950, cause: null, from: 15, to: 17, text: 'ey' },
      { verb: 'ins', offsetMs: 1420, cause: 'paste', pos: 15, text: 'llo world', marks: [] },
      { verb: 'del', offsetMs: 2300, cause: 'undo', from: 1, to: 12, text: 'Hello world' },
      { verb: 'marker', offsetMs: 3100, cause: 'link', ref: 'e12' },
      { verb: 'out', offsetMs: 154000 },
    ])

    const header = parseBlockHeader(block)
    expect(header).toEqual({ grammarVersion: 1, versionBefore: 118, anchorMs: ANCHOR_MS })
  })

  it('parses offsets exactly at millisecond boundaries, never through a float', () => {
    const block = formatBlock(
      [
        { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: 'a', marks: [] },
        { verb: 'ins', offsetMs: 999, cause: null, pos: 2, text: 'b', marks: [] },
        { verb: 'ins', offsetMs: 1000, cause: null, pos: 3, text: 'c', marks: [] },
        { verb: 'ins', offsetMs: 1001, cause: null, pos: 4, text: 'd', marks: [] },
      ],
      ANCHOR_MS,
      0,
    )
    const parsed = parseBlock(block)
    expect(parsed.map((r) => r.offsetMs)).toEqual([0, 999, 1000, 1001])
  })

  it('round-trips quote, backslash, newline, tab and a literal "TEXT" line inside one field', () => {
    const tricky = 'line one\nTEXT\nline "three" with \\backslash\\ and\ttab'
    const records: ThreadRecord[] = [{ verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: tricky, marks: [] }]
    const block = formatBlock(records, ANCHOR_MS, 0)

    // The escaped text must never produce a bare line that reads exactly
    // "TEXT" — that would collide with the kernel's own block delimiter.
    const bodyLines = block.split('\n').slice(2)
    expect(bodyLines.every((line) => line !== 'TEXT')).toBe(true)

    const parsed = parseBlock(block)
    expect(parsed).toEqual(records)
  })

  it('splits a single insert over 1 MiB across cont lines and rejoins it exactly', () => {
    const big = 'x'.repeat(1_200_000)
    const records: ThreadRecord[] = [
      { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: big, marks: ['strong'] },
    ]
    const block = formatBlock(records, ANCHOR_MS, 0)

    const contLines = block.split('\n').filter((line) => line.startsWith('cont '))
    expect(contLines.length).toBeGreaterThan(0)

    const parsed = parseBlock(block)
    expect(parsed).toEqual(records)
    expect((parsed[0] as { text: string }).text.length).toBe(big.length)
  })

  it('clamps a negative offset (a backwards wall clock) to zero on format', () => {
    const records: ThreadRecord[] = [{ verb: 'ins', offsetMs: -50, cause: null, pos: 1, text: 'a', marks: [] }]
    const block = formatBlock(records, ANCHOR_MS, 0)
    expect(block).toContain('+0.000 ins 1 "a"')
    const parsed = parseBlock(block)
    expect(parsed[0].offsetMs).toBe(0)
  })

  it('rejects a thread.log written by a newer grammar version', () => {
    const block = ['thread 2 v0', 'at 2026-09-15T21:04:10.250Z', '+0.000 out'].join('\n')
    expect(() => parseBlock(block)).toThrow(/grammar version/)
  })
})

describe('quoteText', () => {
  it('never emits a raw line feed', () => {
    expect(quoteText('a\nb')).not.toContain('\n')
  })
})
