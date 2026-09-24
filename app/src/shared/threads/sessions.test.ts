/**
 * sessions.ts: recorded-outcome session derivation and time-out detection
 * (D-07, D-10). See sessions.ts's own header for the rule this pins.
 */

import { describe, expect, it } from 'vitest'
import type { ThreadCause } from './grammar'
import { THREAD_DEFAULT_TIMEOUT_SECONDS } from './settings'
import { DEFAULT_TIMEOUT_SECONDS, deriveSessions, detectTimeout, type AuthoredThreadRecord } from './sessions'

const KAELEN = 'user.kaelen'
const CLAUDE = 'agent.claude'

function ins(atMs: number, text: string, actor = KAELEN): AuthoredThreadRecord {
  return { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text, marks: [], atMs, actor }
}

function del(
  atMs: number,
  from: number,
  to: number,
  text: string,
  cause: ThreadCause | null = null,
  actor = KAELEN,
): AuthoredThreadRecord {
  return { verb: 'del', offsetMs: 0, cause, from, to, text, atMs, actor }
}

function inRecord(atMs: number, session: number, actor = KAELEN): AuthoredThreadRecord {
  return { verb: 'in', offsetMs: 0, session, atMs, actor }
}

function outRecord(atMs: number, actor = KAELEN): AuthoredThreadRecord {
  return { verb: 'out', offsetMs: 0, atMs, actor }
}

describe('DEFAULT_TIMEOUT_SECONDS', () => {
  it('matches settings.ts THREAD_DEFAULT_TIMEOUT_SECONDS (150s, D-10)', () => {
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(150)
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(THREAD_DEFAULT_TIMEOUT_SECONDS)
  })
})

describe('detectTimeout', () => {
  it('is false right up to the threshold and true once it is reached', () => {
    expect(detectTimeout(0, 149_999, 150)).toBe(false)
    expect(detectTimeout(0, 150_000, 150)).toBe(true)
  })

  it('a gap shorter than the timeout is not a timeout', () => {
    expect(detectTimeout(1_000_000, 1_060_000, 150)).toBe(false) // 60s gap, 150s timeout
  })

  it('a gap longer than the timeout is a timeout', () => {
    expect(detectTimeout(1_000_000, 1_200_000, 150)).toBe(true) // 200s gap, 150s timeout
  })
})

describe('deriveSessions', () => {
  it('reconstructs session boundaries, letter counts, authors and markers from records alone', () => {
    const records: AuthoredThreadRecord[] = [
      inRecord(1_000, 1),
      ins(1_000, 'Hi'),
      del(1_500, 1, 2, 'H', 'undo'),
      outRecord(2_000),
      inRecord(200_000, 2, CLAUDE),
      ins(200_000, 'Yo', CLAUDE),
    ]

    const sessions = deriveSessions(records)

    expect(sessions).toHaveLength(2)

    expect(sessions[0]).toMatchObject({
      index: 1,
      startMs: 1_000,
      endMs: 2_000,
      closed: true,
      letterCount: 2,
      authors: [KAELEN],
    })
    expect(sessions[0].markers).toEqual([{ kind: 'undo', atMs: 1_500, ref: undefined }])

    expect(sessions[1]).toMatchObject({
      index: 2,
      startMs: 200_000,
      endMs: 200_000,
      closed: false,
      letterCount: 2,
      authors: [CLAUDE],
    })
  })

  it('a session with no closing out is derived open (closed: false) at its last known record', () => {
    // A crash: session 1 has an `in` and one `ins`, but the process died
    // before an `out` could ever be written -- there is no next `in` either,
    // because nothing else was ever recorded.
    const records: AuthoredThreadRecord[] = [inRecord(0, 1), ins(500, 'x')]
    const sessions = deriveSessions(records)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ index: 1, startMs: 0, endMs: 500, closed: false })
  })

  it('a session that crashed is still correctly closed off by the next in, honoring its own last record as its end', () => {
    // Session 1 crashed (no `out`); session 2 starts later. Session 1's
    // recorded end is its own last record's time, never re-derived from
    // session 2's start time or from any timeout arithmetic.
    const records: AuthoredThreadRecord[] = [inRecord(0, 1), ins(300, 'ab'), inRecord(999_999, 2), ins(999_999, 'c')]
    const sessions = deriveSessions(records)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({ index: 1, startMs: 0, endMs: 300, closed: false, letterCount: 2 })
    expect(sessions[1]).toMatchObject({ index: 2, startMs: 999_999, closed: false, letterCount: 1 })
  })

  it('multiple authors within a session are all recorded, in order of first appearance', () => {
    const records: AuthoredThreadRecord[] = [
      inRecord(0, 1),
      ins(0, 'a', KAELEN),
      ins(10, 'b', CLAUDE),
      ins(20, 'c', KAELEN),
    ]
    const sessions = deriveSessions(records)
    expect(sessions[0].authors).toEqual([KAELEN, CLAUDE])
  })

  it('an empty record list derives no sessions', () => {
    expect(deriveSessions([])).toEqual([])
  })

  // T-02.3-06-02 / the rule this whole module exists to pin: deriveSessions'
  // signature carries no timeoutSeconds parameter at all, so there is no
  // code path by which "the property changed from 150 to 600" could reach
  // this function and move a boundary it already derived. Calling it twice
  // on the identical records -- the only thing a caller *can* do, since
  // there is nothing else to vary -- must always agree with itself.
  it('the same records always derive the same session boundaries, regardless of any later settings change', () => {
    const records: AuthoredThreadRecord[] = [inRecord(0, 1), ins(0, 'Hello'), outRecord(150_000), inRecord(155_000, 2), ins(155_000, 'again')]

    const derivedUnderOldSetting = deriveSessions(records)
    // "Kaelen changes thread.timeout from 150 to 600" has no representation
    // in this call at all -- the exact same records are the only input.
    const derivedAfterSettingsChange = deriveSessions(records)

    expect(derivedAfterSettingsChange).toEqual(derivedUnderOldSetting)
    expect(derivedUnderOldSetting[0].endMs).toBe(150_000)
    expect(derivedUnderOldSetting[1].startMs).toBe(155_000)
  })
})
