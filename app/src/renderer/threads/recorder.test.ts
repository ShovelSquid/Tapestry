/**
 * Recorder helpers: cause classification and grapheme segmentation.
 *
 * Tests run at `EditorState` level throughout -- no real `EditorView`/DOM is
 * ever created. Where a helper's signature takes an `EditorView` (the
 * toolbar/link commands), a small object satisfying only the `state`/
 * `dispatch`/`focus` shape those functions actually use stands in for one.
 */

import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import { history, undo } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'
import { tapestrySchema } from '../editor/schema'
import { toggleBold } from '../editor/toolbar-commands'
import { applyPassageLink } from '../editor/passage-plugin'
import { LetterIndex } from '../../shared/threads/letters'
import { causeOf, collapsedCompositionStep, graphemes, insertedTextOf, threadRedo, threadUndo } from './recorder'

function freshState(): EditorState {
  return EditorState.create({ schema: tapestrySchema, plugins: [history()] })
}

/** A minimal stand-in for `EditorView`, satisfying only what
 * `toolbar-commands.ts`/`passage-plugin.ts` actually read: `state`,
 * `dispatch` (capturing every dispatched transaction) and `focus`. */
function fakeView(state: EditorState): { view: EditorView; dispatched: Transaction[] } {
  const dispatched: Transaction[] = []
  const view = {
    state,
    dispatch: (tr: Transaction) => dispatched.push(tr),
    focus: () => {},
  } as unknown as EditorView
  return { view, dispatched }
}

function docWithText(text: string) {
  return tapestrySchema.node('doc', null, [tapestrySchema.node('paragraph', null, [tapestrySchema.text(text)])])
}

describe('causeOf', () => {
  it('reads paste/cut/drop from the uiEvent meta', () => {
    const state = freshState()
    const tr = state.tr.insertText('x').setMeta('uiEvent', 'paste')
    expect(causeOf(tr)).toBe('paste')
  })

  it('reads cut from the uiEvent meta', () => {
    const state = freshState()
    expect(causeOf(state.tr.insertText('x').setMeta('uiEvent', 'cut'))).toBe('cut')
  })

  it('reads drop from the uiEvent meta', () => {
    const state = freshState()
    expect(causeOf(state.tr.insertText('x').setMeta('uiEvent', 'drop'))).toBe('drop')
  })

  it('classifies a history-plugin transaction as undo', () => {
    let state = freshState()
    state = state.apply(state.tr.insertText('a'))
    const undoTr = state.tr
    // isHistoryTransaction checks a meta key the history plugin itself sets;
    // simplest reliable way to get a real one is to dispatch undo() and
    // capture the transaction it produces via a local dispatch shim.
    let captured: typeof undoTr | null = null
    undo(state, (tr) => {
      captured = tr
    })
    expect(captured).not.toBeNull()
    expect(causeOf(captured!)).toBe('undo')
  })

  it('reads ime from the composition meta', () => {
    const state = freshState()
    const tr = state.tr.insertText('x').setMeta('composition', 42)
    expect(causeOf(tr)).toBe('ime')
  })

  it('is null for ordinary typing', () => {
    const state = freshState()
    const tr = state.tr.insertText('x')
    expect(causeOf(tr)).toBeNull()
  })
})

describe('threadUndo / threadRedo (D-04: Cmd+Z is ordinary editor history, never the kernel history-rewind channel)', () => {
  it('threadUndo produces a transaction causeOf classifies as undo', () => {
    let state = freshState()
    state = state.apply(state.tr.insertText('a'))
    let captured: Transaction | null = null
    threadUndo(state, (tr) => {
      captured = tr
    })
    expect(captured).not.toBeNull()
    expect(causeOf(captured!)).toBe('undo')
  })

  it('threadRedo produces a transaction causeOf classifies as redo, distinct from undo', () => {
    let state = freshState()
    state = state.apply(state.tr.insertText('a'))
    let undoTr: Transaction | null = null
    threadUndo(state, (tr) => {
      undoTr = tr
    })
    state = state.apply(undoTr!)

    let redoTr: Transaction | null = null
    threadRedo(state, (tr) => {
      redoTr = tr
    })
    expect(redoTr).not.toBeNull()
    expect(causeOf(redoTr!)).toBe('redo')
  })

  it('an undo produces a deletion, and LetterIndex retains every affected letter with a deletedAtMs (D-03)', () => {
    const index = new LetterIndex()
    let state = freshState()

    const insertTr = state.tr.insertText('hi')
    index.applyStep(insertTr.steps[0], insertedTextOf(insertTr.steps[0]), 'human.kaelen', 10)
    state = state.apply(insertTr)
    expect(index.letterCount).toBe(2)

    let undoTr: Transaction | null = null
    threadUndo(state, (tr) => {
      undoTr = tr
    })
    expect(undoTr).not.toBeNull()
    expect(causeOf(undoTr!)).toBe('undo')

    for (const step of undoTr!.steps) {
      index.applyStep(step, insertedTextOf(step), 'human.kaelen', 20)
    }

    // Nothing removed -- still 2 letters -- both now deleted at 20.
    expect(index.letterCount).toBe(2)
    expect(index.letterAt(0)!.deletedAtMs).toBe(20)
    expect(index.letterAt(1)!.deletedAtMs).toBe(20)
  })
})

describe('paste lands as one record cluster, one timestamp (D-05)', () => {
  it('a 2000-character paste is a single step with a single paste cause', () => {
    const state = freshState()
    const pasted = 'x'.repeat(2000)
    const tr = state.tr.insertText(pasted).setMeta('uiEvent', 'paste')

    // use-thread-editor.ts's dispatchTransaction stamps every step of ONE
    // dispatched transaction with the SAME capture timestamp (`nowMs`) and
    // the SAME cause (`causeOf(tr)`), so "one transaction, one step" here
    // is exactly D-05's "a tight cluster at the paste time" -- never one
    // record per character.
    expect(tr.steps).toHaveLength(1)
    expect(causeOf(tr)).toBe('paste')
    expect(insertedTextOf(tr.steps[0])).toBe(pasted)
  })
})

describe('toggleBold sets the format cause (D-02)', () => {
  it('tags its transaction threadCause: format', () => {
    const doc = docWithText('hello')
    const state = EditorState.create({ schema: tapestrySchema, doc, selection: TextSelection.create(doc, 1, 6) })
    const { view, dispatched } = fakeView(state)

    toggleBold(view)

    expect(dispatched).toHaveLength(1)
    expect(causeOf(dispatched[0])).toBe('format')
  })
})

describe('applyPassageLink sets the link cause (D-02)', () => {
  it('tags its transaction threadCause: link and applies a passage mark', () => {
    const doc = docWithText('hello')
    const state = EditorState.create({ schema: tapestrySchema, doc })
    const { view, dispatched } = fakeView(state)

    applyPassageLink(view, 'anchor-1', 1, 6)

    expect(dispatched).toHaveLength(1)
    expect(causeOf(dispatched[0])).toBe('link')
    const applied = state.apply(dispatched[0])
    expect(applied.doc.rangeHasMark(1, 6, tapestrySchema.marks.passage)).toBe(true)
  })
})

describe('collapsedCompositionStep (Pitfall 5: an IME composition lands as one cluster)', () => {
  it('collapses a whole composition into one step, regardless of how many intermediate revisions produced it', () => {
    const start = docWithText('hi ')
    // Three IME candidate revisions this composition churned through before
    // committing -- only the first and last matter to the collapse; none of
    // the intermediates are ever passed in.
    void docWithText('hi n')
    void docWithText('hi no')
    const end = docWithText('hi の')

    const step = collapsedCompositionStep(start, end)
    expect(step).not.toBeNull()
    expect(insertedTextOf(step!)).toBe('の')

    const result = step!.apply(start)
    expect(result.failed).toBeNull()
    expect(result.doc!.eq(end)).toBe(true)
  })

  it('returns null when the composition committed no net change', () => {
    const doc = docWithText('hi')
    expect(collapsedCompositionStep(doc, doc)).toBeNull()
  })
})

describe('graphemes', () => {
  it('splits plain ASCII into one grapheme per character', () => {
    expect(graphemes('abc')).toEqual(['a', 'b', 'c'])
  })

  it('keeps a family emoji as one grapheme despite spanning multiple UTF-16 units', () => {
    const family = '\u{1F469}‍\u{1F469}‍\u{1F467}' // woman-woman-girl ZWJ sequence
    expect(family.length).toBeGreaterThan(1) // multiple UTF-16 code units
    expect(graphemes(family)).toEqual([family])
  })

  it('returns an empty array for empty text', () => {
    expect(graphemes('')).toEqual([])
  })
})

describe('insertedTextOf', () => {
  it('reads the inserted text from an ordinary typing step', () => {
    const state = freshState()
    const tr = state.tr.insertText('hi')
    expect(insertedTextOf(tr.steps[0])).toBe('hi')
  })

  it('returns an empty string for a step with no slice (a delete)', () => {
    let state = freshState()
    state = state.apply(state.tr.insertText('hello'))
    const delTr = state.tr.delete(1, 3)
    expect(insertedTextOf(delTr.steps[0])).toBe('')
  })
})
