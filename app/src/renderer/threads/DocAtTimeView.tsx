/**
 * DocAtTimeView -- the read-only past stage (D-08, D-18; UI-SPEC "Side view
 * read-back": "Past stage (read-only) treatment").
 *
 * Clicking any point on the side-view line shows the document as it was at
 * that moment, read-only, with the letter at that moment highlighted. Text
 * stays selectable and copyable (D-08); writing from a past stage is not in
 * this phase -- it branches the thread, which is Phase 3 -- so a keystroke
 * here commits nothing and shows the branching notice instead.
 *
 * Built as a real `EditorView` with `editable: () => false`, not a plain
 * `<div>`: this is a deliberate `<verify>` requirement of the plan this
 * component ships in (a real editor gives the standard selection, copy and
 * focus behaviors of every other Tapestry text surface for free, rather
 * than reimplementing them for one read-only case).
 */

import React, { useEffect, useRef, useState } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { tapestrySchema } from '../editor/schema'
import type { ReplayResult } from '../../shared/threads/replay'

// 02.1's active-passage wash, taken from tokens rather than written as a
// literal here -- UI-SPEC "Ghost letters"/"Two colour channels" names this
// exact value for the past-stage highlight (`rgba(74,124,255,0.25)` is
// `--tap-accent` at 25% alpha; kept inline because CSS custom properties
// cannot be blended with an alpha channel in a `background` shorthand
// without a second token, and no such token exists yet in App.css).
const HIGHLIGHT_BACKGROUND = 'rgba(74, 124, 255, 0.25)'
const HIGHLIGHT_BORDER = '2px solid var(--tap-accent)'

/** UI-SPEC "Copywriting" § Side view read-back, verbatim. Shown once, on
 * the first keystroke in a past stage -- writing here does nothing else. */
export const BRANCHING_NOTICE =
  "Writing from an earlier moment will branch the thread. That's coming with branching history. Choose Return to now to keep writing."

export const EMPTY_STATE_TEXT = 'Nothing had been written yet at [time].'

export interface DocAtTimeViewProps {
  /** The moment being viewed -- for the header/notice copy this component's
   * caller (`ThreadOverlay.tsx`) renders around it; this component itself
   * only needs `replay` and `atMs` for the document and its highlight. */
  atMs: number
  replay: ReplayResult
  /** Called the first time a keystroke lands in this read-only view, so the
   * caller can show the branching notice (§ Copywriting) -- this component
   * never shows its own notice UI, it only reports the attempt. */
  onWriteAttempt: () => void
}

// ---------------------------------------------------------------------------
// Flat text -> a single-paragraph-per-line doc, with a position for the
// highlighted letter (D-18) -- mirrors use-thread-editor.ts's own
// plainTextToDoc convention for displaying flat/legacy text, since docAt's
// ReplayResult only carries flat text (rich structure/marks are a later
// plan's concern, per replay.ts's own header).
// ---------------------------------------------------------------------------

function buildDoc(text: string): ProseMirrorNode {
  const lines = text.split('\n')
  const paragraphs = lines.map((line) =>
    line ? tapestrySchema.node('paragraph', null, [tapestrySchema.text(line)]) : tapestrySchema.node('paragraph'),
  )
  return tapestrySchema.node('doc', null, paragraphs.length > 0 ? paragraphs : [tapestrySchema.node('paragraph')])
}

/** The ProseMirror position of UTF-16 offset `charIndex` into `text`,
 * accounting for the paragraph-per-line split `buildDoc` performs: each
 * paragraph node contributes its own open/close tokens (2 position units)
 * around its text content, mirroring where each `\n` in `text` became a
 * paragraph boundary instead of a literal character. */
function positionForCharIndex(text: string, charIndex: number): number {
  const lines = text.split('\n')
  let flatOffset = 0
  let pmOffset = 1 // position 0 is before the doc; a top-level paragraph's own content starts at 1
  for (const line of lines) {
    const lineLen = line.length
    if (charIndex <= flatOffset + lineLen) {
      return pmOffset + (charIndex - flatOffset)
    }
    flatOffset += lineLen + 1 // + the '\n' this line's own split consumed
    pmOffset += lineLen + 2 // + this paragraph's own open/close tokens
  }
  return Math.max(1, pmOffset - 2)
}

/**
 * Finds "the letter at this moment" (D-18): among every letter live at
 * `atMs` (i.e. present in `replay.liveOrder`), the one with the greatest
 * `insertedAtMs` not exceeding `atMs` -- the most recently typed letter as
 * of the clicked point, which is what a click on the line's own dots means.
 * Returns the letter's UTF-16 char range within `replay.document`, or
 * `null` when nothing had been written yet (the empty-state case).
 */
function highlightRangeAt(replay: ReplayResult, atMs: number): { from: number; to: number } | null {
  let bestId: number | null = null
  let bestInsertedAtMs = -Infinity
  const liveSet = new Set(replay.liveOrder)
  for (const id of replay.liveOrder) {
    const letter = replay.letters[id]
    if (letter.insertedAtMs <= atMs && letter.insertedAtMs > bestInsertedAtMs) {
      bestId = id
      bestInsertedAtMs = letter.insertedAtMs
    }
  }
  if (bestId === null || !liveSet.has(bestId)) return null

  let charOffset = 0
  for (const id of replay.liveOrder) {
    const grapheme = replay.letters[id].grapheme
    if (id === bestId) return { from: charOffset, to: charOffset + grapheme.length }
    charOffset += grapheme.length
  }
  return null
}

function highlightDecorations(doc: ProseMirrorNode, text: string, range: { from: number; to: number } | null): DecorationSet {
  if (!range) return DecorationSet.empty
  const from = positionForCharIndex(text, range.from)
  const to = positionForCharIndex(text, range.to)
  if (to <= from) return DecorationSet.empty
  return DecorationSet.create(doc, [
    Decoration.inline(from, to, { style: `background: ${HIGHLIGHT_BACKGROUND}; border-bottom: ${HIGHLIGHT_BORDER};` }),
  ])
}

export default function DocAtTimeView({ atMs, replay, onWriteAttempt }: DocAtTimeViewProps): React.ReactElement {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onWriteAttemptRef = useRef(onWriteAttempt)
  onWriteAttemptRef.current = onWriteAttempt
  const [isEmpty] = useState(() => replay.document.length === 0)

  useEffect(() => {
    if (!editorRef.current) return

    const text = replay.document
    const doc = buildDoc(text)
    const range = highlightRangeAt(replay, atMs)
    const decorations = highlightDecorations(doc, text, range)

    const state = EditorState.create({ doc, schema: tapestrySchema })

    const view = new EditorView(editorRef.current, {
      state,
      editable: () => false,
      decorations: () => decorations,
      // D-08: writing from a past stage is not in this phase -- it commits
      // nothing and never silently swallows the keystroke (UI-SPEC "Loading
      // and catch-up" companion rule for the live view, applied here to the
      // read-only one): every dispatched transaction is reported once via
      // `onWriteAttempt`, then discarded (the view's own state never
      // changes, so the document displayed never drifts from the moment
      // being read).
      dispatchTransaction() {
        onWriteAttemptRef.current()
      },
    })

    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // atMs/replay identify the moment being shown; a new moment gets a
    // fresh read-only view (this component never re-syncs a live document).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atMs, replay])

  return (
    <div>
      {isEmpty && (
        <p style={{ fontSize: 13, color: 'var(--tap-muted)', margin: 0, padding: '4px 0' }}>{EMPTY_STATE_TEXT}</p>
      )}
      <div ref={editorRef} className="tap-thread-past-stage" />
    </div>
  )
}
