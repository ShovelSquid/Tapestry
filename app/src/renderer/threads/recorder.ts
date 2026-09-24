/**
 * Recorder — pure helpers for turning a ProseMirror transaction into the
 * cause and grapheme information the thread grammar cares about.
 *
 * Ports spike 004's `dispatchTransaction` recognition logic (RESEARCH
 * Pattern 2: `causeOf`, `linesFor`). The readable `ins`/`del`/`mark`/`step`
 * line itself is derived in main (`thread-service.ts`'s `deriveRecord`),
 * because main is the one applying steps and therefore the one that
 * actually has the document immediately before and after each step; this
 * module only classifies *why* a transaction happened, from metadata a view
 * sets, and segments text into the letters D-01 draws one at a time.
 */

import { isHistoryTransaction } from 'prosemirror-history'
import type { Transaction } from 'prosemirror-state'
import type { Step } from 'prosemirror-transform'
import type { ThreadCause } from '../../shared/threads/grammar'

/**
 * The cause a transaction carries, or null for ordinary typing.
 *
 * `uiEvent` covers paste/cut/drop (prosemirror-view sets it on the
 * transaction that performs them); `isHistoryTransaction` covers undo (redo
 * is not distinguished from undo here -- both replay through the same
 * history plugin and neither carries a separate marker on the transaction
 * itself); `composition` covers IME; `threadCause` is the escape hatch for
 * a formatting or link command to tag its own transaction once
 * `toolbar-commands.ts`/`passage-plugin.ts` are wired to do so (a later
 * plan -- this tracer never sets it).
 */
export function causeOf(tr: Transaction): ThreadCause | null {
  const uiEvent = tr.getMeta('uiEvent') as 'paste' | 'cut' | 'drop' | undefined
  if (uiEvent === 'paste' || uiEvent === 'cut' || uiEvent === 'drop') return uiEvent
  if (isHistoryTransaction(tr)) return 'undo'
  if (tr.getMeta('composition') != null) return 'ime'
  const threadCause = tr.getMeta('threadCause') as ThreadCause | undefined
  return threadCause ?? null
}

/**
 * Segments `text` into grapheme clusters (D-06: "letter ids are implicit:
 * the k-th grapheme inserted in thread record order is letter k").
 *
 * Positions inside a ProseMirror step are UTF-16 code units, and one emoji
 * spans eight of them (RESEARCH probe), so counting positions as letters
 * would misplace every glyph after it once the WebGL stage (a later plan)
 * starts drawing one dot per letter. This tracer's own `ins`/`del` records
 * never need to split a step's text into per-grapheme records -- one step
 * is one record regardless of how many graphemes it inserts -- but the
 * primitive is exported here, alongside `causeOf`, so IME composition
 * handling (which commits potentially many graphemes as one transaction)
 * and the later LetterIndex module share the same segmentation rule rather
 * than each re-deriving it.
 */
export function graphemes(text: string): string[] {
  if (text.length === 0) return []
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (entry) => entry.segment)
}

/**
 * The text one step inserts, read from its `slice` (RESEARCH Pattern 2's
 * `linesFor`: "inserted text via `slice.content.textBetween(0, size, '\n')`").
 * Every step this app produces is a `ReplaceStep` (the schema has no
 * structure-only step types in play here); a step with no `slice` (or an
 * empty one) inserted nothing, so this returns `''` rather than throwing --
 * the live stage (`ThreadOverlay`) treats an empty result as "nothing to
 * draw for this step", the same way it already skips a step that only
 * deletes.
 */
export function insertedTextOf(step: Step): string {
  const slice = (step as unknown as { slice?: { content: { textBetween(from: number, to: number, blockSeparator?: string): string; size: number } } })
    .slice
  if (!slice) return ''
  return slice.content.textBetween(0, slice.content.size, '\n')
}
