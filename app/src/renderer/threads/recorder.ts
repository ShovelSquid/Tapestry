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

import { isHistoryTransaction, redo, undo } from 'prosemirror-history'
import type { Command, Transaction } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { Step } from 'prosemirror-transform'
import { ReplaceStep } from 'prosemirror-transform'
import type { ThreadCause } from '../../shared/threads/grammar'

/**
 * Meta key `threadUndo`/`threadRedo` (below) stamp onto the transaction
 * `undo`/`redo` themselves dispatch, so `causeOf` can distinguish the two --
 * `isHistoryTransaction` alone cannot, since redo replays through the exact
 * same history plugin as undo and carries no separate marker of its own.
 */
export const THREAD_HISTORY_DIRECTION_META = 'threadHistoryDirection'

/**
 * Wraps `prosemirror-history`'s `undo`/`redo` so every transaction either
 * command produces is stamped with which direction it was, before it ever
 * reaches `causeOf`. The thread typer's keymap binds `Mod-z`/`Mod-Shift-z`
 * to these, never to the bare library commands, and never to the kernel's
 * own history-rewind channel -- Cmd+Z in a thread is ordinary editor
 * history (D-04).
 */
export const threadUndo: Command = (state, dispatch) =>
  undo(state, dispatch ? (tr) => dispatch(tr.setMeta(THREAD_HISTORY_DIRECTION_META, 'undo')) : undefined)

export const threadRedo: Command = (state, dispatch) =>
  redo(state, dispatch ? (tr) => dispatch(tr.setMeta(THREAD_HISTORY_DIRECTION_META, 'redo')) : undefined)

/**
 * The cause a transaction carries, or null for ordinary typing. Resolved in
 * a fixed order (RESEARCH Pattern 2, this plan's Task 2 vocabulary):
 *
 *  1. `uiEvent` -- paste/cut/drop (prosemirror-view sets it on the
 *     transaction that performs them; covers the menu, context-menu and
 *     drag paths a key listener would miss).
 *  2. `isHistoryTransaction` -- undo/redo, distinguished by which of
 *     `threadUndo`/`threadRedo` (above) dispatched it.
 *  3. `composition` -- non-null while an IME composition is in flight.
 *  4. `threadCause` -- the escape hatch `toolbar-commands.ts` (`'format'`)
 *     and `passage-plugin.ts` (`'link'`) set on their own transactions.
 */
export function causeOf(tr: Transaction): ThreadCause | null {
  const uiEvent = tr.getMeta('uiEvent') as 'paste' | 'cut' | 'drop' | undefined
  if (uiEvent === 'paste' || uiEvent === 'cut' || uiEvent === 'drop') return uiEvent
  if (isHistoryTransaction(tr)) {
    const direction = tr.getMeta(THREAD_HISTORY_DIRECTION_META)
    return direction === 'redo' ? 'redo' : 'undo'
  }
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

/**
 * Collapses a whole IME composition into the **one** step it should have
 * recorded (Pitfall 5, D-05's "never spread out to look typed" sibling
 * rule for composition): while `view.composing`, kana-preview churn can
 * dispatch several intermediate replace transactions before the user
 * commits a result, and pushing each of those individually would flood
 * `thread.log` with revisions nobody ever actually typed.
 *
 * Diffs `startDoc` (the document immediately before the composition began)
 * against `endDoc` (the document once it ended) using the same
 * `Fragment.findDiffStart`/`findDiffEnd` technique ProseMirror's own DOM
 * change reader uses to turn an arbitrary DOM mutation into one step --
 * never a hand-rolled position walk. Returns `null` when the two documents
 * are identical (a composition that committed no net change).
 */
export function collapsedCompositionStep(startDoc: ProseMirrorNode, endDoc: ProseMirrorNode): ReplaceStep | null {
  const start = startDoc.content.findDiffStart(endDoc.content)
  if (start == null) return null
  const diffEnd = startDoc.content.findDiffEnd(endDoc.content)
  if (!diffEnd) return null
  let { a: endA, b: endB } = diffEnd
  if (endA < start) endA = start
  if (endB < start) endB = start
  const slice = endDoc.slice(start, endB)
  return new ReplaceStep(start, endA, slice)
}
