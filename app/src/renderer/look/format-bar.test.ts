import { describe, expect, it } from 'vitest'
import { FONT_FAMILIES, TEXT_COLORS } from '../editor/schema'
import { BAR, TOP_GLYPHS, back, barLayout, buildFormatTree, enter, itemsAt, pillOpen, type FormatItem } from './format-bar'

const tree = buildFormatTree(FONT_FAMILIES, TEXT_COLORS)

function walk(items: readonly FormatItem[], out: FormatItem[] = []): FormatItem[] {
  for (const it of items) {
    out.push(it)
    if (it.children) walk(it.children, out)
  }
  return out
}

describe('the format tree', () => {
  it('shows f i b u ✱ on the top row, in the sketch order', () => {
    expect(tree.map((it) => it.glyph)).toEqual([...TOP_GLYPHS])
  })

  it('makes every item either a command or a section, never both', () => {
    for (const it of walk(tree)) {
      expect(Boolean(it.command) !== Boolean(it.children)).toBe(true)
      if (it.children) expect(it.children.length).toBeGreaterThan(0)
    }
  })

  it('keeps underline and strikethrough disabled (gate 1) and nothing else', () => {
    const disabled = walk(tree).filter((it) => it.disabled).map((it) => it.command?.kind)
    expect(disabled.sort()).toEqual(['strikethrough', 'underline'])
  })

  it('keeps everything the old toolbar did', () => {
    const kinds = new Set(walk(tree).filter((it) => !it.disabled).map((it) => it.command?.kind))
    for (const k of ['italic', 'bold', 'font', 'heading', 'paragraph', 'bulletList', 'orderedList', 'align', 'color']) {
      expect(kinds.has(k as never)).toBe(true)
    }
    const colors = walk(tree).filter((it) => it.command?.kind === 'color')
    expect(colors).toHaveLength(TEXT_COLORS.length)
    const fonts = walk(tree).filter((it) => it.command?.kind === 'font')
    expect(fonts).toHaveLength(FONT_FAMILIES.length)
  })

  it('gives every item a unique id', () => {
    const ids = walk(tree).map((it) => it.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('moving through sections', () => {
  it('opens a section in place and goes back with ‹', () => {
    let path = enter(tree, [], 'more')
    expect(path).toEqual(['more'])
    expect(itemsAt(tree, path).map((it) => it.id)).toEqual(['heading', 'list', 'align', 'color'])
    path = enter(tree, path, 'heading')
    expect(itemsAt(tree, path).map((it) => it.glyph)).toEqual(['H1', 'H2', 'H3', '¶'])
    path = back(path)
    expect(path).toEqual(['more'])
    expect(back(back(path))).toEqual([])
  })

  it('ignores entering a command or an id that is not on the row', () => {
    expect(enter(tree, [], 'bold')).toEqual([])
    expect(enter(tree, [], 'heading')).toEqual([])
  })

  it('falls back to the top row for a stale path', () => {
    expect(itemsAt(tree, ['nope'])).toBe(tree)
  })
})

describe('when the pill opens', () => {
  const base = { editing: true, textSelected: false, pointerOnBar: false, redHover: false }

  it('opens for a text selection or the pointer on the f', () => {
    expect(pillOpen(base)).toBe(false)
    expect(pillOpen({ ...base, textSelected: true })).toBe(true)
    expect(pillOpen({ ...base, pointerOnBar: true })).toBe(true)
  })

  it('folds back while the red dot is hovered', () => {
    expect(pillOpen({ ...base, textSelected: true, redHover: true })).toBe(false)
  })

  it('stays shut on a note that is not being edited', () => {
    expect(pillOpen({ ...base, editing: false, textSelected: true, pointerOnBar: true })).toBe(false)
  })
})

describe('bar layout', () => {
  it('puts f and settings where Line Lab draws them', () => {
    const l = barLayout(300)
    expect(l.f).toEqual({ x: 238, y: 22, r: 13 })
    expect(l.settings).toEqual({ x: 272, y: 22, r: 13 })
  })

  it('lays the pill on the top edge, clear of the blue dot and the settings circle', () => {
    const l = barLayout(300)
    expect(l.pill.x).toBe(BAR.pillLeft)
    expect(l.pill.y + l.pill.h / 2).toBe(0)
    expect(l.pill.x + l.pill.w).toBeLessThanOrEqual(l.settings.x - l.settings.r)
  })

  it('keeps a usable pill on a narrow note', () => {
    const l = barLayout(150)
    expect(l.pill.w).toBeGreaterThanOrEqual(BAR.minPillW - 1e-9)
    expect(l.pill.x).toBeGreaterThanOrEqual(0)
  })
})
