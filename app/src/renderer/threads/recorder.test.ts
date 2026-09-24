/**
 * Recorder helpers: cause classification and grapheme segmentation.
 */

import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { history, undo } from 'prosemirror-history'
import { tapestrySchema } from '../editor/schema'
import { causeOf, graphemes } from './recorder'

function freshState(): EditorState {
  return EditorState.create({ schema: tapestrySchema, plugins: [history()] })
}

describe('causeOf', () => {
  it('reads paste/cut/drop from the uiEvent meta', () => {
    const state = freshState()
    const tr = state.tr.insertText('x').setMeta('uiEvent', 'paste')
    expect(causeOf(tr)).toBe('paste')
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
