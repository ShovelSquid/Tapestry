/**
 * Sessions as recorded outcomes (D-07, D-10).
 *
 * A session runs from a time-in to a time-out. The rule this module is built
 * around, and the one the whole plan pins: **recorded outcomes, not
 * re-derivation**. An `out` record is written when the time-out was actually
 * detected, under the `thread.timeout` setting in force at that moment.
 * Changing the setting afterwards must never move a dash already on the
 * line, so `deriveSessions` reads the `in` and `out` records that exist —
 * it never recomputes a boundary from timestamps and the *current* setting.
 * Its signature has no `timeoutSeconds` parameter at all: there is no code
 * path by which a later settings change could move a past boundary, because
 * the function has nothing to read the new setting from.
 *
 * Only where an `out` is missing (a crash before it could be written) does a
 * reader derive one — `deriveSessions` marks that session `closed: false`
 * with its `endMs` at the last record it actually saw. `ThreadService`
 * (`thread-service.ts`) is the writer half of that rule: it calls
 * `detectTimeout` against the crashed session's own last known moment and,
 * once it is unambiguously in the past, writes the missing `out` on the
 * very next write (D-06/D-07, RESEARCH Pitfall 9).
 *
 * Pure TypeScript: no Electron, Node or DOM import (grammar.ts's header
 * explains why that matters — main, renderer and vitest all load the
 * identical module). In particular this module does not import
 * `renderer/threads/stage/markers.ts`, which pulls in `three`: the five
 * marker kinds are duplicated here in the same shape (`SessionMarker` is
 * structurally assignable to that module's `MarkerInstance`), the same way
 * `replay.ts` duplicates `recorder.ts`'s grapheme segmentation rather than
 * importing a renderer-only module from a shared one.
 */

import type { ThreadCause } from './grammar'
import type { TimedThreadRecord } from './replay'
import { THREAD_DEFAULT_TIMEOUT_SECONDS } from './settings'

// ---------------------------------------------------------------------------
// Default timeout (D-10)
// ---------------------------------------------------------------------------

/**
 * 2.5 minutes, matching Apple Messages' timestamp spacing (D-10). Written as
 * a literal, not re-exported from `settings.ts`'s `THREAD_DEFAULT_TIMEOUT_SECONDS`,
 * because this module's own default must be readable and grep-able on its
 * own; the equality test in `sessions.test.ts` pins the two constants
 * together so they can never silently drift apart.
 */
export const DEFAULT_TIMEOUT_SECONDS = 150

// A drift guard, evaluated at module load: if `settings.ts`'s default ever
// changes without this one changing too, every consumer of either constant
// would quietly disagree about what "the default" means.
if (DEFAULT_TIMEOUT_SECONDS !== THREAD_DEFAULT_TIMEOUT_SECONDS) {
  throw new Error(
    `sessions.ts's DEFAULT_TIMEOUT_SECONDS (${DEFAULT_TIMEOUT_SECONDS}) has drifted from ` +
      `settings.ts's THREAD_DEFAULT_TIMEOUT_SECONDS (${THREAD_DEFAULT_TIMEOUT_SECONDS})`,
  )
}

// ---------------------------------------------------------------------------
// detectTimeout
// ---------------------------------------------------------------------------

/**
 * Whether `timeoutSeconds` has elapsed between `lastActivityMs` and
 * `nowMs`. Pure arithmetic — this is the one place "has a time-out actually
 * happened" is decided, so both the live pause-detection path and a reopen's
 * crash-recovery path ask the identical question.
 */
export function detectTimeout(lastActivityMs: number, nowMs: number, timeoutSeconds: number): boolean {
  return nowMs - lastActivityMs >= timeoutSeconds * 1000
}

// ---------------------------------------------------------------------------
// Authored records: a TimedThreadRecord plus the actor of the commit that
// wrote it (D-21) -- deriveSessions' input shape.
// ---------------------------------------------------------------------------

/**
 * One `thread.log` record with its absolute time (`replay.ts`'s
 * `TimedThreadRecord`) and the actor id of the commit that wrote it. A
 * record itself never carries an author field (grammar.ts rule 5: "Author
 * is never a field here: it is the enclosing commit's `actor` line") — the
 * caller (`ThreadService` in main, or a renderer loader) is the one that
 * knows which commit a record came from, so it is the caller's job to
 * annotate each record with that commit's actor before calling
 * `deriveSessions`.
 */
export type AuthoredThreadRecord = TimedThreadRecord & { actor: string }

// ---------------------------------------------------------------------------
// Session markers (duplicated shape from stage/markers.ts's MarkerInstance —
// see module header)
// ---------------------------------------------------------------------------

export type SessionMarkerKind = 'deletion' | 'undo' | 'paste' | 'format' | 'link'

export interface SessionMarker {
  kind: SessionMarkerKind
  atMs: number
  ref?: string
}

/** Mirrors stage/markers.ts's `markerKindForRecord` exactly (cause takes
 * priority over verb, `cut` reads as a deletion, `drop` reads as a paste) —
 * see this module's header for why it is a duplicate rather than an import. */
function classifyMarker(verb: string, cause: ThreadCause | null): SessionMarkerKind | null {
  switch (cause) {
    case 'undo':
      return 'undo'
    case 'format':
      return 'format'
    case 'link':
      return 'link'
    case 'paste':
    case 'drop':
      return 'paste'
    default:
      break
  }
  if (verb === 'del') return 'deletion'
  return null
}

// ---------------------------------------------------------------------------
// Letter counting (D-17: session pills are weighted by how much was written)
// ---------------------------------------------------------------------------

/** Duplicated from replay.ts's graphemesOf (itself duplicated from
 * recorder.ts) — see this module's header for why. */
function graphemeCount(text: string): number {
  if (text.length === 0) return 0
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
  let count = 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _entry of segmenter.segment(text)) count++
  return count
}

// ---------------------------------------------------------------------------
// deriveSessions
// ---------------------------------------------------------------------------

export interface DerivedSession {
  /** The session number from its own `in` record (D-07) — never recomputed,
   * always the number that was actually written. */
  index: number
  /** The `in` record's absolute time. */
  startMs: number
  /** The last record's absolute time: either the closing `out`'s moment, or
   * (when `closed` is false) the last record this reader ever saw for it. */
  endMs: number
  /** True when an explicit `out` record closed this session. False means
   * either it is still the live, currently-open session, or it crashed
   * before an `out` could be written — `ThreadService` is the one that
   * knows which, by asking `detectTimeout` against `endMs`. */
  closed: boolean
  /** Total graphemes inserted during the session (`ins` records only, not
   * net of later deletions) — "how much was written here" (spike 011). */
  letterCount: number
  /** Distinct actor ids that wrote in this session, in order of first
   * appearance. */
  authors: string[]
  /** This session's markers, in time order. */
  markers: SessionMarker[]
}

/**
 * Reconstructs session boundaries from `in`/`out` records alone (recorded
 * outcomes, never re-derived from a setting — see this module's header).
 * `records` must already be in commit-order-then-line-order (replay.ts rule
 * 6); this function only ever groups and aggregates, it never reorders.
 */
export function deriveSessions(records: readonly AuthoredThreadRecord[]): DerivedSession[] {
  const sessions: DerivedSession[] = []
  let current: DerivedSession | null = null

  for (const record of records) {
    if (record.verb === 'in') {
      // A fresh `in` always starts a new session, even when the previous one
      // never got an explicit `out` (a crash): that previous session's own
      // last record already stands as its honest, un-moved end.
      current = {
        index: record.session,
        startMs: record.atMs,
        endMs: record.atMs,
        closed: false,
        letterCount: 0,
        authors: [],
        markers: [],
      }
      sessions.push(current)
      continue
    }

    if (!current) continue // Defensive: a record before any `in` at all.

    current.endMs = record.atMs
    if (!current.authors.includes(record.actor)) {
      current.authors.push(record.actor)
    }

    if (record.verb === 'out') {
      current.closed = true
      continue
    }

    if (record.verb === 'ins') {
      current.letterCount += graphemeCount(record.text)
    }

    const cause = 'cause' in record ? record.cause : null
    const kind = classifyMarker(record.verb, cause)
    if (kind) {
      current.markers.push({
        kind,
        atMs: record.atMs,
        ref: record.verb === 'marker' ? record.ref : undefined,
      })
    }
  }

  return sessions
}
