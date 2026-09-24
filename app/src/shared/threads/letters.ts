/**
 * `LetterIndex` — stable grapheme identity across every edit (D-03, D-21,
 * D-22, Pitfall 4).
 *
 * The "no analog" module for this phase (02.3-PATTERNS.md lines 599-606):
 * nothing else in the repo maps ProseMirror step positions to
 * grapheme-identified authorship runs. Positions inside a ProseMirror step
 * are UTF-16 code units — one emoji spans eight of them (RESEARCH probe) —
 * so a "letter" is a grapheme cluster, not a code point or a position.
 *
 * Letter ids are **implicit and never written to the file** (D-06): the
 * k-th grapheme inserted in thread record order is letter k. `LetterIndex`
 * assigns ids in exactly that order (`mintLetters`, called once per newly
 * created grapheme, in the order edits are applied), so replaying the same
 * sequence of steps always reproduces the same ids.
 *
 * Positions are updated exclusively through `step.getMap().forEach(...)`
 * (grep-enforced by this plan's `<verify>` block) — never by hand-rolled
 * offset arithmetic, because structure steps shift positions in ways that
 * arithmetic gets wrong (the probed Enter step maps 10 to 12, RESEARCH
 * Pattern 2).
 *
 * Deletion never removes a letter from the index: it stamps `deletedAtMs`
 * and the letter stays forever, which is what lets the stage draw a ghost
 * at the moment the letter was typed (D-03). A deletion that cuts a
 * grapheme in half marks the *whole* old letter deleted and mints the
 * surviving code units as a brand new letter at the same moment (Pitfall
 * 4) — a partial grapheme is never addressable on its own.
 *
 * Pure TypeScript: imports only `prosemirror-transform`'s `Step` type (a
 * pure library, no Electron/Node/DOM), so main, renderer and vitest all
 * load the identical module.
 */

import type { Step } from 'prosemirror-transform'

// ---------------------------------------------------------------------------
// Grapheme segmentation
// ---------------------------------------------------------------------------

/**
 * Segments `text` into grapheme clusters. Duplicated rather than imported
 * from `renderer/threads/recorder.ts` (this module must never depend on a
 * renderer-only one) — the same duplication `replay.ts` already carries for
 * the identical reason.
 */
function graphemesOf(text: string): string[] {
  if (text.length === 0) return []
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (entry) => entry.segment)
}

/** Cumulative UTF-16 offsets of `graphemes`, one more entry than the array:
 * `offsets[i]` is where grapheme `i` starts, `offsets[graphemes.length]` is
 * the total UTF-16 width. */
function offsetsOf(graphemes: readonly string[]): number[] {
  const offsets = [0]
  for (const g of graphemes) offsets.push(offsets[offsets.length - 1] + g.length)
  return offsets
}

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** A run of live, contiguous letters at their current document position —
 * `runsForDecorations()`'s shape, the per-letter author wash Plan 08 draws. */
export interface LetterRun {
  firstLetterId: number
  graphemeCount: number
  utf16Length: number
  actor: string
  insertedAtMs: number
  /** Current live document position (UTF-16/ProseMirror position units) this run starts at. */
  pos: number
}

/** Everything permanently known about one letter, live or deleted. */
export interface LetterInfo {
  id: number
  grapheme: string
  actor: string
  insertedAtMs: number
  /** Absolute ms this letter was deleted, or null while it is still live. */
  deletedAtMs: number | null
}

// ---------------------------------------------------------------------------
// Internal representation
// ---------------------------------------------------------------------------

/** One contiguous run of letters, all minted by the same operation (one
 * flat insert, or one split-grapheme leftover), in document order. Runs
 * split when a later deletion cuts through their middle. */
interface InternalRun {
  pos: number
  firstLetterId: number
  /** The literal grapheme text of each letter in this run, in order — kept
   * (not just counted) so a later split can re-derive exact leftover text. */
  graphemes: string[]
  actor: string
  insertedAtMs: number
}

function runWidth(run: InternalRun): number {
  let width = 0
  for (const g of run.graphemes) width += g.length
  return width
}

// ---------------------------------------------------------------------------
// LetterIndex
// ---------------------------------------------------------------------------

export class LetterIndex {
  /** Live runs only, always kept sorted by `pos` ascending. */
  private runs: InternalRun[] = []
  /** Every letter ever minted, live or deleted, indexed by id (insertion order). */
  private letters: LetterInfo[] = []

  /** Mints one fresh letter id per grapheme in `graphemes`, in order, and
   * returns the id of the first one (ids are sequential, so callers can
   * derive the rest as `firstId + index`). */
  private mintLetters(graphemes: readonly string[], actor: string, tMs: number): number {
    const firstId = this.letters.length
    for (const grapheme of graphemes) {
      this.letters.push({ id: this.letters.length, grapheme, actor, insertedAtMs: tMs, deletedAtMs: null })
    }
    return firstId
  }

  /** Mints letters for `text`, segmented fresh, and returns the resulting
   * run's grapheme array (empty if `text` is empty). */
  private mintRunGraphemes(text: string, actor: string, tMs: number): { firstLetterId: number; graphemes: string[] } {
    const graphemes = graphemesOf(text)
    if (graphemes.length === 0) return { firstLetterId: this.letters.length, graphemes }
    const firstLetterId = this.mintLetters(graphemes, actor, tMs)
    return { firstLetterId, graphemes }
  }

  /**
   * Applies one ProseMirror step. `insertedText` is the step's flat
   * inserted text (`recorder.ts`'s `insertedTextOf`) for a simple
   * single-text-node replace; pass `''` for a step that inserts no
   * addressable letters (a structural step such as Enter, or a step that
   * only removes marks). Its positions still shift every later run
   * correctly, because that shift comes from the step's own `StepMap`, not
   * from counting letters — a structural insertion simply occupies a span
   * of document positions with no letter living there.
   */
  applyStep(step: Step, insertedText: string, actor: string, tMs: number): void {
    const map = step.getMap()
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      this.applyRange(oldStart, oldEnd, newStart, newEnd, insertedText, actor, tMs)
    })
  }

  private applyRange(
    oldStart: number,
    oldEnd: number,
    newStart: number,
    newEnd: number,
    insertedText: string,
    actor: string,
    tMs: number,
  ): void {
    const delta = newEnd - newStart - (oldEnd - oldStart)
    const nextRuns: InternalRun[] = []

    for (const run of this.runs) {
      const width = runWidth(run)
      const runStart = run.pos
      const runEnd = run.pos + width

      if (runEnd <= oldStart) {
        // Entirely before the change: untouched.
        nextRuns.push(run)
        continue
      }
      if (runStart >= oldEnd) {
        // Entirely at/after the change: shift by the map's own delta.
        nextRuns.push({ ...run, pos: run.pos + delta })
        continue
      }

      // Overlaps [oldStart, oldEnd): split.
      const offsets = offsetsOf(run.graphemes)
      const localFrom = Math.max(0, oldStart - runStart)
      const localTo = Math.min(width, oldEnd - runStart)

      let firstAffected = -1
      let lastAffected = -1
      for (let i = 0; i < run.graphemes.length; i++) {
        const gs = offsets[i]
        const ge = offsets[i + 1]
        if (ge > localFrom && gs < localTo) {
          if (firstAffected === -1) firstAffected = i
          lastAffected = i
        }
      }
      if (firstAffected === -1) {
        // No grapheme is *strictly* touched: this only happens for a
        // zero-width range (a pure insert, localFrom === localTo) landing
        // exactly on an existing grapheme boundary inside the run -- the
        // ordinary "type between two letters" case. Split cleanly there
        // with an empty affected range: `firstAffected..lastAffected`
        // becomes `k..k-1`, so the deletion loop below marks nothing and
        // prefix/suffix-leftover both correctly compute to "no cut" once
        // `k` is the boundary index at `offsets[k] === localFrom`.
        let k = 0
        while (k < offsets.length && offsets[k] < localFrom) k++
        firstAffected = k
        lastAffected = k - 1
      }

      // Left survivor: graphemes [0, firstAffected), identity unchanged.
      if (firstAffected > 0) {
        nextRuns.push({
          pos: run.pos,
          firstLetterId: run.firstLetterId,
          graphemes: run.graphemes.slice(0, firstAffected),
          actor: run.actor,
          insertedAtMs: run.insertedAtMs,
        })
      }

      // Prefix leftover (Pitfall 4: the deletion started mid-grapheme). The
      // surviving code units before the cut are not actually removed by
      // this step -- they stay live, right before it -- but the whole
      // grapheme they belonged to is being marked deleted below, so they
      // are re-minted as a brand new letter at this same moment.
      const prefixCut = offsets[firstAffected] < localFrom
      if (prefixCut) {
        const leftoverText = run.graphemes[firstAffected].slice(0, localFrom - offsets[firstAffected])
        if (leftoverText.length > 0) {
          const minted = this.mintRunGraphemes(leftoverText, run.actor, tMs)
          nextRuns.push({
            pos: runStart + offsets[firstAffected],
            firstLetterId: minted.firstLetterId,
            graphemes: minted.graphemes,
            actor: run.actor,
            insertedAtMs: tMs,
          })
        }
      }

      // Every touched grapheme -- including a partially-cut one at either
      // end -- is marked deleted wholesale (Pitfall 4): the index never
      // removes an entry, it stamps deletedAtMs.
      for (let i = firstAffected; i <= lastAffected; i++) {
        this.letters[run.firstLetterId + i].deletedAtMs = tMs
      }

      // Suffix leftover (the deletion ended mid-grapheme): the surviving
      // code units after the cut land exactly at newEnd, because StepMap
      // maps old position oldEnd to new position newEnd.
      const suffixCut = offsets[lastAffected + 1] > localTo
      let suffixLen = 0
      if (suffixCut) {
        const leftoverText = run.graphemes[lastAffected].slice(localTo - offsets[lastAffected])
        suffixLen = leftoverText.length
        if (leftoverText.length > 0) {
          const minted = this.mintRunGraphemes(leftoverText, run.actor, tMs)
          nextRuns.push({
            pos: newEnd,
            firstLetterId: minted.firstLetterId,
            graphemes: minted.graphemes,
            actor: run.actor,
            insertedAtMs: tMs,
          })
        }
      }

      // Right survivor: graphemes (lastAffected, end], identity unchanged,
      // repositioned right after the suffix leftover (which itself starts
      // exactly at newEnd).
      if (lastAffected < run.graphemes.length - 1) {
        nextRuns.push({
          pos: newEnd + suffixLen,
          firstLetterId: run.firstLetterId + lastAffected + 1,
          graphemes: run.graphemes.slice(lastAffected + 1),
          actor: run.actor,
          insertedAtMs: run.insertedAtMs,
        })
      }
    }

    // The inserted text becomes one new run at newStart, once, regardless
    // of how many existing runs this range overlapped or split.
    if (insertedText.length > 0) {
      const minted = this.mintRunGraphemes(insertedText, actor, tMs)
      if (minted.graphemes.length > 0) {
        nextRuns.push({
          pos: newStart,
          firstLetterId: minted.firstLetterId,
          graphemes: minted.graphemes,
          actor,
          insertedAtMs: tMs,
        })
      }
    }

    nextRuns.sort((a, b) => a.pos - b.pos)
    this.runs = nextRuns
  }

  // -------------------------------------------------------------------------
  // Readers
  // -------------------------------------------------------------------------

  /** The actor who typed `letterId`, live or deleted, or undefined for an
   * id this index never minted. */
  authorOf(letterId: number): string | undefined {
    return this.letters[letterId]?.actor
  }

  /** Full record for `letterId`, live or deleted. */
  letterAt(letterId: number): LetterInfo | undefined {
    return this.letters[letterId]
  }

  /** Every letter ever minted, live or deleted, in insertion (id) order —
   * the source a stage feeds its `aDeletedAtMs` GPU attribute from. */
  allLetters(): readonly LetterInfo[] {
    return this.letters
  }

  /** Total letters ever minted (live + deleted). */
  get letterCount(): number {
    return this.letters.length
  }

  /** Live letter ids whose current document position lies in `[from, to)`,
   * in document order (D-22's own read path: which letters does a proposed
   * agent edit touch). */
  lettersIn(from: number, to: number): number[] {
    const ids: number[] = []
    for (const run of this.runs) {
      const width = runWidth(run)
      if (run.pos >= to || run.pos + width <= from) continue
      const offsets = offsetsOf(run.graphemes)
      for (let i = 0; i < run.graphemes.length; i++) {
        const gs = run.pos + offsets[i]
        const ge = run.pos + offsets[i + 1]
        if (ge > from && gs < to) ids.push(run.firstLetterId + i)
      }
    }
    return ids
  }

  /**
   * Whether every *live* letter in `[from, to)` was authored by `actorId` —
   * the D-22 read path Plan 08's agent thread tools check before a delete or
   * replace is allowed to touch the kernel at all. An empty or all-live-gap
   * range (nothing there to touch) is vacuously true, matching `lettersIn`'s
   * own "no live letters in range" case.
   */
  allAuthoredBy(from: number, to: number, actorId: string): boolean {
    return this.lettersIn(from, to).every((id) => this.authorOf(id) === actorId)
  }

  /** Live runs, in document order — the per-letter author wash Plan 08 renders. */
  runsForDecorations(): LetterRun[] {
    return this.runs.map((run) => ({
      firstLetterId: run.firstLetterId,
      graphemeCount: run.graphemes.length,
      utf16Length: runWidth(run),
      actor: run.actor,
      insertedAtMs: run.insertedAtMs,
      pos: run.pos,
    }))
  }
}
