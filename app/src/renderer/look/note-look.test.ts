import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DARK, aimLight, lightAt, lightRadius, lightSettled } from './bloom'
import { fillPath, inkPath } from './ink'
import { NoteInk, noteShape } from './NoteInk'
import { CornerCluster, redDotShape } from './CornerCluster'

const MS = 770

describe('hover bloom light', () => {
  it('blooms in from the entry point and grows to full size', () => {
    const tw = aimLight(DARK, 10, 20, 1, 1000, MS)
    const start = lightAt(tw, 1000, MS)
    expect(start).toEqual({ x: 10, y: 20, a: 0 })
    const end = lightAt(tw, 1000 + MS, MS)
    expect(end).toEqual({ x: 10, y: 20, a: 1 })
    expect(lightSettled(tw, 1000 + MS, MS)).toBe(true)
    expect(lightSettled(tw, 1000 + MS / 2, MS)).toBe(false)
  })

  it('drains out toward the exit point, continuing from the current light', () => {
    const lit = aimLight(DARK, 10, 20, 1, 0, MS)
    const out = aimLight(lit, 290, 100, 0, MS, MS)
    expect(lightAt(out, MS, MS)).toEqual({ x: 10, y: 20, a: 1 })
    const mid = lightAt(out, MS + MS / 2, MS)
    expect(mid.x).toBeGreaterThan(10)
    expect(mid.x).toBeLessThan(290)
    expect(mid.a).toBeGreaterThan(0)
    expect(mid.a).toBeLessThan(1)
    expect(lightAt(out, 2 * MS, MS)).toEqual({ x: 290, y: 100, a: 0 })
  })

  it('re-entering mid-exit continues from the current light rather than resetting', () => {
    const lit = aimLight(DARK, 0, 0, 1, 0, MS)
    const out = aimLight(lit, 300, 0, 0, MS, MS)
    const cur = lightAt(out, MS + 100, MS)
    const back = aimLight(out, 150, 150, 1, MS + 100, MS)
    expect(lightAt(back, MS + 100, MS)).toEqual(cur)
  })

  it('a fully drained light starts its next bloom at the new entry point', () => {
    const lit = aimLight(DARK, 0, 0, 1, 0, MS)
    const out = aimLight(lit, 300, 0, 0, MS, MS)
    const again = aimLight(out, 50, 60, 1, 5000, MS)
    expect(lightAt(again, 5000, MS)).toEqual({ x: 50, y: 60, a: 0 })
  })

  it('motion off jumps straight to the target', () => {
    const tw = aimLight(DARK, 5, 5, 1, 0, 0)
    expect(lightAt(tw, 0, 0).a).toBe(1)
    expect(lightSettled(tw, 0, 0)).toBe(true)
  })

  it('radius is 1.1 diagonals at full size', () => {
    expect(lightRadius({ x: 0, y: 0, a: 1 }, 300, 400)).toBeCloseTo(550)
    expect(lightRadius({ x: 0, y: 0, a: 0 }, 300, 400)).toBe(0)
  })
})

describe('note look components', () => {
  const shape = noteShape(300, 200, 7)

  it('the paper fill follows the wobbled outline and is stable per seed', () => {
    const d = fillPath(shape)
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d).toBe(fillPath(noteShape(300, 200, 7)))
    expect(d).not.toMatch(/NaN|Infinity/)
  })

  it('NoteInk draws paper, bloom and a pencil outline with no blue when not selected', () => {
    const html = renderToStaticMarkup(
      createElement(NoteInk, { shape, w: 300, h: 200, seed: 7, light: DARK, blue: false, blueFromT: 0 }),
    )
    expect(html).toContain('var(--tap-note)')
    expect(html).toContain('clip-path="url(#note-clip-')
    expect(html).not.toContain(':r')
    expect(html).toContain(`d="${inkPath(shape, { seed: 7 })}"`)
    // The blue path is empty until the takeover grows.
    expect(html).toMatch(/<path d="" fill="var\(--tap-select\)"/)
  })

  it('NoteInk drawn already selected has no pencil left under the blue', () => {
    const html = renderToStaticMarkup(
      createElement(NoteInk, { shape, w: 300, h: 200, seed: 7, light: DARK, blue: true, blueFromT: 0.3 }),
    )
    expect(html).toMatch(/<path d="" fill="var\(--tap-pencil\)"/)
  })

  it('the corner cluster has a red delete dot and a blue connect dot', () => {
    const noop = (): void => {}
    const html = renderToStaticMarkup(
      createElement(CornerCluster, { onConnect: noop, onDelete: noop, seed: 7, noteLength: shape.L }),
    )
    expect(html).toContain('aria-label="Delete note"')
    expect(html).toContain('aria-label="Connect to another note"')
    expect(html).toContain('var(--tap-delete)')
    expect(redDotShape(7).L).toBeLessThan(shape.L)
  })
})
