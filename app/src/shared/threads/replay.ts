/**
 * `thread.log` replay — checkpoint + records -> document at time T, and
 * deleted-letter times (D-08, D-18).
 *
 * Pure TypeScript: no Electron, Node or DOM import (grammar.ts's header
 * explains why that matters here too — main, renderer and vitest must all
 * load the identical module).
 *
 * Two rules this module is built around (grammar.ts rule 6, RESEARCH
 * Pitfall 3):
 *
 *  1. Replay order is commit order, then line order within a commit; a
 *     record's position in the document is always determined by that order,
 *     never by sorting every record by its own `atMs`. `replayTo` applies
 *     `records` in exactly the order given and only ever *filters* by time
 *     (dropping anything after `untilMs`) — it never reorders.
 *  2. The document at time T is the last `body` checkpoint at or before T,
 *     plus the records after it replayed up to T (D-08). Because a
 *     checkpoint already reflects every record before it, `docAt` never
 *     replays more than one checkpoint interval's worth of records — the
 *     checkpoint itself *is* the cache; there is no separate memoization
 *     structure to maintain.
 *
 * Deleted letters are tracked, never removed (D-03): every grapheme cluster
 * ever inserted gets a stable id and an `insertedAtMs`; a deletion sets
 * `deletedAtMs` on the letters it removes rather than dropping them from the
 * table, so a caller can draw ghosts (faded, struck through) at the moment
 * they were typed and the moment they went.
 */

import { parseBlock, parseBlockHeader, type ThreadRecord } from './grammar'

// ---------------------------------------------------------------------------
// Grapheme segmentation (mirrors renderer/threads/recorder.ts's `graphemes`,
// grammar rule 4: "the k-th grapheme inserted in thread record order is
// letter k" — duplicated rather than imported, because a shared module must
// never depend on a renderer-only one; see this file's own header)
// ---------------------------------------------------------------------------

function graphemesOf(text: string): string[] {
  if (text.length === 0) return []
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (entry) => entry.segment)
}

// ---------------------------------------------------------------------------
// Letters
// ---------------------------------------------------------------------------

/** One grapheme cluster, addressable across the whole replay (D-03, D-21). */
export interface ThreadLetter {
  /** Insertion order across the whole replay: the k-th grapheme inserted is letter k. */
  id: number
  grapheme: string
  /** Absolute ms this letter was inserted. `-Infinity` for a letter seeded from a checkpoint's own text, whose exact original insertion time is not recoverable from the checkpoint alone. */
  insertedAtMs: number
  /** Absolute ms this letter was deleted, or null while it is still live (D-03: nothing is ever dropped from this table). */
  deletedAtMs: number | null
}

export interface ReplayResult {
  /** The live document's flat text — every letter whose `deletedAtMs` is still null, in document order. */
  document: string
  /** Every letter ever seen in this replay, live or deleted, in insertion order. */
  letters: ThreadLetter[]
}

// ---------------------------------------------------------------------------
// Timed records: a parsed thread.log record plus its absolute time
// ---------------------------------------------------------------------------

/**
 * A `ThreadRecord` (grammar.ts) annotated with its absolute time
 * (`block's "at" anchor + the record's own offsetMs`) — the "recorded time"
 * D-15 positions a letter by. `parseTimedRecords` is the usual way to build
 * these from a raw `thread.log` block; `replayTo`'s caller is responsible
 * for handing records to it in commit-order-then-line-order (rule 6) and
 * never resorting them by `atMs`.
 */
export type TimedThreadRecord = ThreadRecord & { atMs: number }

/**
 * Parses one `thread.log` block and returns its records annotated with
 * absolute time, in the block's own line order.
 */
export function parseTimedRecords(block: string): TimedThreadRecord[] {
  const { anchorMs } = parseBlockHeader(block)
  return parseBlock(block).map((record) => ({ ...record, atMs: anchorMs + record.offsetMs }))
}

// ---------------------------------------------------------------------------
// replayTo
// ---------------------------------------------------------------------------

/**
 * Replays `records` onto `checkpointDoc`, applying every record whose
 * absolute time is at or before `untilMs`, in the exact order `records` is
 * given (never resorted — rule 6). Only `ins` and `del` affect the flat
 * document text; `mark+`/`mark-`/`step`/`marker`/`in`/`out` are recorded but
 * do not change it (rich structure and marks are a later plan's concern,
 * matching 02.3-02's `replayFlatText` precedent for this tracer's scope).
 *
 * `ins`/`del` positions are 1-indexed against the *live* document, the same
 * convention `thread-service.ts`'s `replayFlatText` uses: position `p`
 * addresses live index `p - 1`.
 */
export function replayTo(checkpointDoc: string, records: readonly TimedThreadRecord[], untilMs: number): ReplayResult {
  const letters: ThreadLetter[] = []
  let live: number[] = []

  for (const grapheme of graphemesOf(checkpointDoc)) {
    const id = letters.length
    letters.push({ id, grapheme, insertedAtMs: -Infinity, deletedAtMs: null })
    live.push(id)
  }

  for (const record of records) {
    if (record.atMs > untilMs) continue

    if (record.verb === 'ins') {
      const at = Math.max(0, Math.min(live.length, record.pos - 1))
      const insertedIds = graphemesOf(record.text).map((grapheme) => {
        const id = letters.length
        letters.push({ id, grapheme, insertedAtMs: record.atMs, deletedAtMs: null })
        return id
      })
      live.splice(at, 0, ...insertedIds)
    } else if (record.verb === 'del') {
      const from = Math.max(0, Math.min(live.length, record.from - 1))
      const to = Math.max(from, Math.min(live.length, record.to - 1))
      const removed = live.splice(from, to - from)
      for (const id of removed) {
        letters[id].deletedAtMs = record.atMs
      }
    }
    // mark+ / mark- / step / marker / in / out: no effect on flat text.
  }

  return { document: live.map((id) => letters[id].grapheme).join(''), letters }
}

// ---------------------------------------------------------------------------
// docAt
// ---------------------------------------------------------------------------

/** One `thread.log` batch, in commit order. */
export interface ThreadLogCommit {
  kind: 'log'
  /** The raw `thread.log` block text, exactly as committed. */
  value: string
}

/** One `body` checkpoint, in commit order. */
export interface BodyCheckpointCommit {
  kind: 'checkpoint'
  /** The checkpoint's plain text (see threads.md: `body` is never grammared). */
  value: string
}

export type ThreadCommitEntry = ThreadLogCommit | BodyCheckpointCommit

interface CheckpointAnchor {
  /** How many entries of the flattened record list precede this checkpoint. */
  afterRecordCount: number
  value: string
}

/**
 * The document at absolute time `tMs`, from a thread's full commit history
 * in commit order (D-08).
 *
 * Finds the last `body` checkpoint whose own moment is at or before `tMs` —
 * a checkpoint's moment is the time of the last record it reflects (or
 * `-Infinity` for a checkpoint with no records before it at all, which is
 * therefore always valid as a fallback) — then replays only the records
 * after that checkpoint, up to `tMs`. This never replays more than one
 * checkpoint interval: the checkpoint's own stored text already accounts
 * for everything before it.
 */
export function docAt(commits: readonly ThreadCommitEntry[], tMs: number): ReplayResult {
  const allRecords: TimedThreadRecord[] = []
  // The implicit empty checkpoint before any real one is ever written: it is
  // always valid (its moment is -Infinity), so a `tMs` before the thread's
  // first real checkpoint still resolves to something rather than nothing.
  const checkpoints: CheckpointAnchor[] = [{ afterRecordCount: 0, value: '' }]

  for (const commit of commits) {
    if (commit.kind === 'log') {
      allRecords.push(...parseTimedRecords(commit.value))
    } else {
      checkpoints.push({ afterRecordCount: allRecords.length, value: commit.value })
    }
  }

  // "The last checkpoint at or before tMs" means the latest one *in commit
  // order* that qualifies — not the one with the largest moment, which a
  // rebase spanning a checkpoint boundary could make non-monotonic. So this
  // scans every checkpoint rather than stopping at the first failure.
  let chosen = checkpoints[0]
  for (const checkpoint of checkpoints) {
    const momentMs = checkpoint.afterRecordCount === 0 ? -Infinity : allRecords[checkpoint.afterRecordCount - 1].atMs
    if (momentMs <= tMs) {
      chosen = checkpoint
    }
  }

  return replayTo(chosen.value, allRecords.slice(chosen.afterRecordCount), tMs)
}
