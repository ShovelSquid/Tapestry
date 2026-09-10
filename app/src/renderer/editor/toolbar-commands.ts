import { EditorView } from 'prosemirror-view'
import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands'
import { wrapInList } from 'prosemirror-schema-list'
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

export function setHeading(view: EditorView, level: number) {
  const node = tapestrySchema.nodes.heading
  setBlockType(node, { level })(view.state, view.dispatch)
  view.focus()
}

export function setParagraph(view: EditorView) {
  setBlockType(tapestrySchema.nodes.paragraph)(view.state, view.dispatch)
  view.focus()
}

export function toggleBulletList(view: EditorView) {
  const listType = tapestrySchema.nodes.bullet_list
  if (isInList(view, listType)) {
    lift(view.state, view.dispatch)
  } else {
    wrapInList(listType)(view.state, view.dispatch)
  }
  view.focus()
}

export function toggleOrderedList(view: EditorView) {
  const listType = tapestrySchema.nodes.ordered_list
  if (isInList(view, listType)) {
    lift(view.state, view.dispatch)
  } else {
    wrapInList(listType)(view.state, view.dispatch)
  }
  view.focus()
}

function isInList(view: EditorView, listType: NodeType): boolean {
  const { $from } = view.state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === listType) return true
  }
  return false
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
