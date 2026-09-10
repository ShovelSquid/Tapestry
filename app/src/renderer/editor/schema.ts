/**
 * Shared ProseMirror schema for Tapestry editors.
 *
 * Consumed identically by NoteCard and ThreadCenterNode (D-26 universal editing).
 * Defines the passage mark (D-09, D-11, D-12), text formatting marks (D-23),
 * aligned paragraphs, and list nodes.
 *
 * Threat mitigation T-2.1-01: anchorId is an opaque string used only as a
 * data-passage-id attribute -- never in CSS selectors, DOM IDs, or script execution.
 *
 * Threat mitigation T-2.1-02: the schema enforces valid node/mark types. No raw
 * HTML parsing path exists.
 */

import { Schema, MarkSpec, NodeSpec } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'

// ---------------------------------------------------------------------------
// Custom marks
// ---------------------------------------------------------------------------

/**
 * Passage mark -- persistent text bracket for passage-level linking.
 *
 * - excludes: '' allows multiple overlapping passages on the same text (D-12)
 * - inclusive: false prevents new text at boundaries from inheriting the mark (D-11)
 */
export const passageMark: MarkSpec = {
  attrs: {
    anchorId: { default: '' },
  },
  excludes: '',
  inclusive: false,
  parseDOM: [
    {
      tag: 'span[data-passage-id]',
      getAttrs(dom: HTMLElement) {
        return { anchorId: dom.getAttribute('data-passage-id') || '' }
      },
    },
  ],
  toDOM(mark) {
    return [
      'span',
      {
        'data-passage-id': mark.attrs.anchorId,
        class: 'tapestry-passage',
      },
      0,
    ]
  },
}

/**
 * Text color mark -- user-applied text coloring (D-23).
 */
export const textColorMark: MarkSpec = {
  attrs: { color: { default: '#2C2C2C' } },
  parseDOM: [
    {
      tag: 'span[data-text-color]',
      getAttrs(dom: HTMLElement) {
        return { color: dom.getAttribute('data-text-color') }
      },
    },
  ],
  toDOM(mark) {
    return [
      'span',
      {
        'data-text-color': mark.attrs.color,
        style: `color: ${mark.attrs.color}`,
      },
      0,
    ]
  },
}

/**
 * Font family mark -- user-applied font selection (D-23).
 */
export const fontFamilyMark: MarkSpec = {
  attrs: { family: { default: '' } },
  parseDOM: [
    {
      tag: 'span[data-font-family]',
      getAttrs(dom: HTMLElement) {
        return { family: dom.getAttribute('data-font-family') }
      },
    },
  ],
  toDOM(mark) {
    return [
      'span',
      {
        'data-font-family': mark.attrs.family,
        style: mark.attrs.family ? `font-family: ${mark.attrs.family}` : '',
      },
      0,
    ]
  },
}

// ---------------------------------------------------------------------------
// Extended paragraph and heading with alignment (D-23)
// ---------------------------------------------------------------------------

const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify'])

/** Read a text-align value from a parsed element, allow-listed. */
function parseAlign(dom: HTMLElement): string | null {
  const v = dom.style.textAlign
  return v && ALIGN_VALUES.has(v) ? v : null
}

const baseParagraph = basicSchema.spec.nodes.get('paragraph')!
const alignedParagraph: NodeSpec = {
  ...baseParagraph,
  attrs: { align: { default: null } },
  parseDOM: [
    {
      tag: 'p',
      getAttrs(dom: HTMLElement) {
        return { align: parseAlign(dom) }
      },
    },
  ],
  toDOM(node) {
    const align = node.attrs.align
    if (align) {
      return ['p', { style: `text-align: ${align}` }, 0]
    }
    return ['p', 0]
  },
}

// The basic heading spec only declares `level`; NodeType.create() drops any
// undeclared attr, so setAlignment on a heading silently did nothing. Give
// headings the same align attr (and rendering) as paragraphs.
const baseHeading = basicSchema.spec.nodes.get('heading')!
const alignedHeading: NodeSpec = {
  ...baseHeading,
  attrs: { level: { default: 1 }, align: { default: null } },
  parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
    tag: `h${level}`,
    getAttrs(dom: HTMLElement) {
      return { level, align: parseAlign(dom) }
    },
  })),
  toDOM(node) {
    const tag = `h${node.attrs.level}`
    const align = node.attrs.align
    if (align) {
      return [tag, { style: `text-align: ${align}` }, 0]
    }
    return [tag, 0]
  },
}

// ---------------------------------------------------------------------------
// Compose the schema
// ---------------------------------------------------------------------------

// Add list nodes (ordered, bullet, listItem) to basic schema nodes
const listNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block')

// Override paragraph and heading with alignment support
const nodesWithAlign = listNodes
  .update('paragraph', alignedParagraph)
  .update('heading', alignedHeading)

// Compose marks: passage before link, then textColor and fontFamily at the end
const marks = basicSchema.spec.marks
  .addBefore('link', 'passage', passageMark)
  .addToEnd('textColor', textColorMark)
  .addToEnd('fontFamily', fontFamilyMark)

export const tapestrySchema = new Schema({
  nodes: nodesWithAlign,
  marks,
})
