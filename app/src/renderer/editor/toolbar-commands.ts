import { EditorView } from 'prosemirror-view'
import { toggleMark, setBlockType } from 'prosemirror-commands'
import { wrapInList, liftListItem } from 'prosemirror-schema-list'
import { tapestrySchema } from './schema'
import { NodeType } from 'prosemirror-model'

export function toggleBold(view: EditorView) {
  toggleMark(tapestrySchema.marks.strong)(view.state, view.dispatch)
  view.focus()
}

export function toggleItalic(view: EditorView) {
  toggleMark(tapestrySchema.marks.em)(view.state, view.dispatch)
  view.focus()
}

/** Alignment of the block containing the selection head, preserved on block-type changes. */
function currentAlign(view: EditorView): string | null {
  const { $from } = view.state.selection
  return ($from.parent.attrs.align as string | null | undefined) ?? null
}

export function setHeading(view: EditorView, level: number) {
  const node = tapestrySchema.nodes.heading
  setBlockType(node, { level, align: currentAlign(view) })(view.state, view.dispatch)
  view.focus()
}

export function setParagraph(view: EditorView) {
  setBlockType(tapestrySchema.nodes.paragraph, { align: currentAlign(view) })(view.state, view.dispatch)
  view.focus()
}

export function toggleBulletList(view: EditorView) {
  toggleList(view, tapestrySchema.nodes.bullet_list)
}

export function toggleOrderedList(view: EditorView) {
  toggleList(view, tapestrySchema.nodes.ordered_list)
}

/**
 * Toggle the list type of the block containing the selection.
 *
 * - Already in a list of `listType`  -> lift the item out (liftListItem is the
 *   multi-item-aware list command; generic `lift` only lifted one paragraph).
 * - In the *other* list type          -> convert that list in place instead of
 *   nesting a new list inside the current item.
 * - Not in a list                     -> wrap in a new list.
 *
 * Only the immediately enclosing list is considered (not any ancestor), so
 * toggling inside a nested list acts on the nested list.
 */
function toggleList(view: EditorView, listType: NodeType) {
  const { bullet_list, ordered_list, list_item } = tapestrySchema.nodes
  const { $from } = view.state.selection
  const range = $from.blockRange()

  // The block's parent is the list_item (range.depth); its parent is the list.
  const listDepth = range && range.depth >= 1 ? range.depth - 1 : -1
  const parentList = listDepth >= 0 ? $from.node(listDepth) : null

  if (parentList && parentList.type === listType) {
    liftListItem(list_item)(view.state, view.dispatch)
  } else if (
    parentList &&
    listDepth >= 1 &&
    (parentList.type === bullet_list || parentList.type === ordered_list)
  ) {
    view.dispatch(view.state.tr.setNodeMarkup($from.before(listDepth), listType))
  } else {
    wrapInList(listType)(view.state, view.dispatch)
  }
  view.focus()
}

export function setTextColor(view: EditorView, color: string) {
  const mark = tapestrySchema.marks.textColor
  const { from, to } = view.state.selection
  if (from === to) return
  const tr = view.state.tr
  tr.removeMark(from, to, mark)
  if (color !== '#2C2C2C') {
    tr.addMark(from, to, mark.create({ color }))
  }
  view.dispatch(tr)
  view.focus()
}

export function setFontFamily(view: EditorView, family: string) {
  const mark = tapestrySchema.marks.fontFamily
  const { from, to } = view.state.selection
  if (from === to) return
  const tr = view.state.tr
  tr.removeMark(from, to, mark)
  if (family) {
    tr.addMark(from, to, mark.create({ family }))
  }
  view.dispatch(tr)
  view.focus()
}

export function setAlignment(view: EditorView, align: string | null) {
  const { from, to } = view.state.selection
  const tr = view.state.tr
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === tapestrySchema.nodes.paragraph || node.type === tapestrySchema.nodes.heading) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, align })
    }
  })
  view.dispatch(tr)
  view.focus()
}

export function isMarkActive(view: EditorView, markName: string): boolean {
  const { from, $from, to, empty } = view.state.selection
  const markType = tapestrySchema.marks[markName]
  if (!markType) return false
  if (empty) {
    return !!markType.isInSet(view.state.storedMarks || $from.marks())
  }
  return view.state.doc.rangeHasMark(from, to, markType)
}

export function getActiveBlockType(view: EditorView): string {
  const { $from } = view.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type === tapestrySchema.nodes.heading) {
      return `h${node.attrs.level}`
    }
    if (node.type === tapestrySchema.nodes.bullet_list) return 'bullet'
    if (node.type === tapestrySchema.nodes.ordered_list) return 'ordered'
  }
  return 'paragraph'
}
