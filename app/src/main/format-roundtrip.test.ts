/**
 * Formatting survives save and reopen (Line Lab v2 wave 3, "Done when").
 *
 * Every command the format bar can run is applied to a real EditorState,
 * the body is serialized the way the note saves it, written through the
 * real kernel into a temp `.tree`, the world is closed and reopened, and
 * the body read back parses to the same document with the same marks.
 */

import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { KernelBridge } from './kernel-bridge'
import { humanActor } from './commands/actor'
import { createTempTree } from '../../test/helpers/temp-tree'
import { FONT_FAMILIES, TEXT_COLORS, tapestrySchema } from '../renderer/editor/schema'
import { deserializeBody } from '../renderer/editor/use-prosemirror'
import {
  setAlignment,
  setFontFamily,
  setHeading,
  setTextColor,
  toggleBold,
  toggleBulletList,
  toggleItalic,
} from '../renderer/editor/toolbar-commands'

/** Just enough of an EditorView for the toolbar commands. */
function fakeView(text: string[]): EditorView & { state: EditorState } {
  const doc = tapestrySchema.node(
    'doc',
    null,
    text.map((t) => tapestrySchema.node('paragraph', null, t ? [tapestrySchema.text(t)] : [])),
  )
  const view = {
    state: EditorState.create({ doc }),
    dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
      view.state = view.state.apply(tr)
    },
    focus() {},
  }
  return view as unknown as EditorView & { state: EditorState }
}

function select(view: EditorView & { state: EditorState }, from: number, to: number): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
}

function marksAt(doc: ReturnType<typeof tapestrySchema.node>, pos: number): string[] {
  return doc
    .resolve(pos)
    .marks()
    .map((m) => (m.type.name === 'textColor' ? `textColor:${m.attrs.color}` : m.type.name === 'fontFamily' ? `fontFamily:${m.attrs.family}` : m.type.name))
    .sort()
}

describe('formatting round-trips through save and reopen', () => {
  it('keeps italic, bold, font, colour, heading, list and alignment', () => {
    const view = fakeView(['Title line', 'plain italic bold serif red', 'a list item'])
    // "Title line" is 1..11; the second paragraph starts at 13.
    select(view, 3, 5)
    setHeading(view, 2)
    setAlignment(view, 'center')
    const p2 = 13
    select(view, p2 + 6, p2 + 12) // "italic"
    toggleItalic(view)
    select(view, p2 + 13, p2 + 17) // "bold"
    toggleBold(view)
    const serif = FONT_FAMILIES.find((f) => f.label === 'Serif')!.family
    select(view, p2 + 18, p2 + 23) // "serif"
    setFontFamily(view, serif)
    const red = TEXT_COLORS.find((c) => c.label === 'Red')!.color
    select(view, p2 + 24, p2 + 27) // "red"
    setTextColor(view, red)
    select(view, 44, 46) // inside "a list item"
    toggleBulletList(view)

    const body = JSON.stringify(view.state.doc.toJSON())
    const before = view.state.doc

    const tree = createTempTree('format-roundtrip')
    let reopened: KernelBridge | null = null
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create note', [
        {
          op: 'createNode',
          type: 'tapestry.notes/note@1',
          props: {
            'position.x': { type: 'real', value: 0 },
            'position.y': { type: 'real', value: 0 },
            body: { type: 'text', value: '' },
            title: { type: 'text', value: '' },
          },
        },
      ] as any)
      tree.bridge.submitAs(humanActor('kaelen'), 'Format note', [
        { op: 'setProperty', target: 'n1', key: 'body', type: 'text', value: body },
      ] as any)
      tree.bridge.close()

      reopened = new KernelBridge()
      reopened.open(tree.path)
      const saved = reopened.getNode('n1')
      expect(saved).not.toBeNull()
      const stored = String(saved!.props.body.value)
      expect(stored).toBe(body)

      const { doc, schemaError } = deserializeBody(stored)
      expect(schemaError).toBe(false)
      expect(doc).not.toBeNull()
      expect(doc!.eq(before)).toBe(true)

      const after = doc!
      expect(after.child(0).type.name).toBe('heading')
      expect(after.child(0).attrs).toMatchObject({ level: 2, align: 'center' })
      expect(marksAt(after, p2 + 8)).toEqual(['em'])
      expect(marksAt(after, p2 + 15)).toEqual(['strong'])
      expect(marksAt(after, p2 + 20)).toEqual([`fontFamily:${serif}`])
      expect(marksAt(after, p2 + 25)).toEqual([`textColor:${red}`])
      expect(marksAt(after, p2 + 2)).toEqual([])
      expect(after.child(2).type.name).toBe('bullet_list')
    } finally {
      try {
        reopened?.close()
      } catch {
        // already closed
      }
      tree.cleanup()
    }
  })
})
