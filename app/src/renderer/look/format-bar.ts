/**
 * The format bar's model (Line Lab v2, Part 2 wave 3). Replaces the old
 * FloatingToolbar's layout of submenus.
 *
 * A selected note shows a small pencil `f` in its top-right corner. With
 * text selected (or the `f` hovered) it opens into a pill along the note's
 * top edge: `f i b u ✱` (sketch 3). Each icon either acts (`i`, `b`) or
 * opens a section, which replaces the icons in the same pill; the last icon
 * of a section, `‹`, goes back. `✱` is the "etc." overflow: headings,
 * lists, alignment and colour, everything else the old toolbar did.
 *
 * Underline and strikethrough are ⚠ gate 1: new marks change what a `.tree`
 * records, so their names wait for Kaelen. Until then they are shown and
 * disabled, and the schema doesn't have them at all (a paste of `<u>` would
 * otherwise write one).
 *
 * This file is pure: no React, no ProseMirror. `FormatBar.tsx` maps each
 * `FormatCommand` to `editor/toolbar-commands.ts`.
 */

export type FormatCommand =
  | { readonly kind: 'italic' }
  | { readonly kind: 'bold' }
  | { readonly kind: 'underline' }
  | { readonly kind: 'strikethrough' }
  | { readonly kind: 'font'; readonly family: string }
  | { readonly kind: 'heading'; readonly level: number }
  | { readonly kind: 'paragraph' }
  | { readonly kind: 'bulletList' }
  | { readonly kind: 'orderedList' }
  | { readonly kind: 'align'; readonly align: string | null }
  | { readonly kind: 'color'; readonly color: string }

export interface FormatItem {
  readonly id: string
  /** What the pill shows: a letter or symbol, set in a font. */
  readonly glyph: string
  readonly label: string
  /** Acts when pressed. Absent on a section. */
  readonly command?: FormatCommand
  /** Opens in place, replacing the pill's icons. */
  readonly children?: readonly FormatItem[]
  /** Shown but not pressable (gate 1). */
  readonly disabled?: boolean
  /** A colour swatch instead of a glyph. */
  readonly swatch?: string
}

/** The back icon at the end of every section. */
export const BACK_GLYPH = '‹'

/** Top-level glyphs, in the sketch's order. */
export const TOP_GLYPHS = ['f', 'i', 'b', 'u', '✱'] as const

export function buildFormatTree(
  fonts: ReadonlyArray<{ label: string; family: string }>,
  colors: ReadonlyArray<{ label: string; color: string }>,
): readonly FormatItem[] {
  return [
    {
      id: 'font',
      glyph: 'f',
      label: 'Font',
      children: fonts.map((f) => ({
        id: `font:${f.label}`,
        glyph: f.label,
        label: `${f.label} font`,
        command: { kind: 'font', family: f.family },
      })),
    },
    { id: 'italic', glyph: 'i', label: 'Italic', command: { kind: 'italic' } },
    { id: 'bold', glyph: 'b', label: 'Bold', command: { kind: 'bold' } },
    {
      id: 'lines',
      glyph: 'u',
      label: 'Underline and strikethrough',
      children: [
        { id: 'underline', glyph: 'u', label: 'Underline (coming)', command: { kind: 'underline' }, disabled: true },
        { id: 'strikethrough', glyph: 's', label: 'Strikethrough (coming)', command: { kind: 'strikethrough' }, disabled: true },
      ],
    },
    {
      id: 'more',
      glyph: '✱',
      label: 'More formatting',
      children: [
        {
          id: 'heading',
          glyph: 'H',
          label: 'Heading',
          children: [
            { id: 'h1', glyph: 'H1', label: 'Heading 1', command: { kind: 'heading', level: 1 } },
            { id: 'h2', glyph: 'H2', label: 'Heading 2', command: { kind: 'heading', level: 2 } },
            { id: 'h3', glyph: 'H3', label: 'Heading 3', command: { kind: 'heading', level: 3 } },
            { id: 'paragraph', glyph: '¶', label: 'Paragraph', command: { kind: 'paragraph' } },
          ],
        },
        {
          id: 'list',
          glyph: '≡',
          label: 'List',
          children: [
            { id: 'bullet', glyph: '•', label: 'Bulleted list', command: { kind: 'bulletList' } },
            { id: 'ordered', glyph: '1.', label: 'Numbered list', command: { kind: 'orderedList' } },
          ],
        },
        {
          id: 'align',
          glyph: '⫶',
          label: 'Alignment',
          children: [
            { id: 'align-left', glyph: '⇤', label: 'Align left', command: { kind: 'align', align: null } },
            { id: 'align-center', glyph: '↔', label: 'Align centre', command: { kind: 'align', align: 'center' } },
            { id: 'align-right', glyph: '⇥', label: 'Align right', command: { kind: 'align', align: 'right' } },
          ],
        },
        {
          id: 'color',
          glyph: 'A',
          label: 'Text colour',
          children: colors.map((c) => ({
            id: `color:${c.label}`,
            glyph: '',
            label: `${c.label} text`,
            swatch: c.color,
            command: { kind: 'color', color: c.color },
          })),
        },
      ],
    },
  ]
}

/** The section path, outermost first: `[]` is the top row. */
export type FormatPath = readonly string[]

/** The items the pill shows for `path`. An unknown step falls back to the top. */
export function itemsAt(tree: readonly FormatItem[], path: FormatPath): readonly FormatItem[] {
  let items = tree
  for (const id of path) {
    const next = items.find((it) => it.id === id)
    if (!next || !next.children) return tree
    items = next.children
  }
  return items
}

/** Open a section in place. Only sections open; anything else is a no-op. */
export function enter(tree: readonly FormatItem[], path: FormatPath, id: string): FormatPath {
  const item = itemsAt(tree, path).find((it) => it.id === id)
  return item && item.children ? [...path, id] : path
}

/** The back icon: one section up. */
export function back(path: FormatPath): FormatPath {
  return path.slice(0, -1)
}

/**
 * Whether the pill is open. It opens for a text selection while editing,
 * or while the pointer is on the `f` or the pill. Hovering the red delete
 * dot folds it back to the `f` in the corner (spec §4).
 */
export function pillOpen(s: {
  readonly editing: boolean
  readonly textSelected: boolean
  readonly pointerOnBar: boolean
  readonly redHover: boolean
}): boolean {
  if (!s.editing || s.redHover) return false
  return s.textSelected || s.pointerOnBar
}

/**
 * Where the corner buttons and the pill sit, in the card's px. The `f` and
 * settings circles are Line Lab's (`drawNote`: (w-62, 22) and (w-28, 22),
 * r 13). The pill straddles the top edge like sketch 3, from just past the
 * blue connect dot to clear of the settings circle.
 */
export const BAR = Object.freeze({
  circleR: 13,
  fFromRight: 62,
  settingsFromRight: 28,
  circleY: 22,
  pillLeft: 44,
  pillRightGap: 44,
  pillH: 28,
  pillY: 0,
  /** The pill's least width: on a narrow note it starts further left, and
   *  on the narrowest it runs on past the settings circle. */
  minPillW: 120,
})

export interface BarLayout {
  readonly f: { readonly x: number; readonly y: number; readonly r: number }
  readonly settings: { readonly x: number; readonly y: number; readonly r: number }
  readonly pill: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

export function barLayout(w: number): BarLayout {
  const r = BAR.circleR
  const f = { x: w - BAR.fFromRight, y: BAR.circleY, r }
  const settings = { x: w - BAR.settingsFromRight, y: BAR.circleY, r }
  const right = w - BAR.pillRightGap
  const left = right - BAR.pillLeft >= BAR.minPillW ? BAR.pillLeft : Math.max(0, right - BAR.minPillW)
  return {
    f,
    settings,
    pill: { x: left, y: BAR.pillY - BAR.pillH / 2, w: Math.max(BAR.minPillW, right - left), h: BAR.pillH },
  }
}
