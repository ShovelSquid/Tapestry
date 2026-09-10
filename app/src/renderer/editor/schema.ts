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

// ---------------------------------------------------------------------------
// Text color / font family allow-lists (D-23)
//
// These attrs are interpolated into inline `style`. Pasted HTML (and, in
// principle, a hand-edited .tree file) can carry arbitrary values, and the
// renderer has no CSP, so `color: red; background: url(https://...)` would
// persist into the world and issue a network request on every render. Only
// values that are provably a color / a known font stack are accepted, both
// when parsing (paste) and when rendering (already-stored data).
// ---------------------------------------------------------------------------

/** Sentinel for "no color mark": selecting it removes the mark. */
export const DEFAULT_TEXT_COLOR = '#2C2C2C'

export const TEXT_COLORS: ReadonlyArray<{ label: string; color: string }> = [
  { label: 'Default', color: DEFAULT_TEXT_COLOR },
  { label: 'Red', color: '#E5484D' },
  { label: 'Orange', color: '#E76F00' },
  { label: 'Green', color: '#2D8A4E' },
  { label: 'Blue', color: '#4A7CFF' },
  { label: 'Purple', color: '#7C3AED' },
  { label: 'Light Gray', color: '#B0ADA6' },
  { label: 'Dark Gray', color: '#6B6B6B' },
]

export const FONT_FAMILIES: ReadonlyArray<{ label: string; family: string }> = [
  { label: 'System', family: '' },
  { label: 'Serif', family: 'Georgia, serif' },
  { label: 'Mono', family: "'SF Mono', 'Fira Code', monospace" },
]

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const ALLOWED_FONT_FAMILIES = new Set(FONT_FAMILIES.map((f) => f.family).filter(Boolean))

export function isValidTextColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

export function isValidFontFamily(value: unknown): value is string {
  return typeof value === 'string' && ALLOWED_FONT_FAMILIES.has(value)
}

/**
 * Text color mark -- user-applied text coloring (D-23).
 */
export const textColorMark: MarkSpec = {
  attrs: { color: { default: DEFAULT_TEXT_COLOR } },
  parseDOM: [
    {
      tag: 'span[data-text-color]',
      getAttrs(dom: HTMLElement) {
        const color = dom.getAttribute('data-text-color')
        // `false` = this rule does not match; the span's content is kept unmarked.
        return isValidTextColor(color) ? { color } : false
      },
    },
  ],
  toDOM(mark) {
    const color = mark.attrs.color
    const attrs: Record<string, string> = { 'data-text-color': String(color) }
    if (isValidTextColor(color)) attrs.style = `color: ${color}`
    return ['span', attrs, 0]
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
        const family = dom.getAttribute('data-font-family')
        return isValidFontFamily(family) ? { family } : false
      },
    },
  ],
  toDOM(mark) {
    const family = mark.attrs.family
    const attrs: Record<string, string> = { 'data-font-family': String(family) }
    if (isValidFontFamily(family)) attrs.style = `font-family: ${family}`
    return ['span', attrs, 0]
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
