/**
 * Zoom collapse. What matters: the form follows the note's width on screen
 * through both thresholds, every note uses the defaults until gate 2, a
 * change of form fades from the old form to the new for the crossfade's
 * length (so neither handoff pops), and with the fade off nothing fades.
 */

import { describe, expect, it } from 'vitest'
import { FormFades, circleLetter, collapseForm, formsToDraw, thresholdsFor, type ShownForm } from './collapse'
import { circleShape } from './CollapsedNote'
import { inkPath } from './ink'
import { LOOK } from './values'

describe('collapseForm', () => {
  it('goes note → circle → dot at 110 and 28 px on screen', () => {
    expect(collapseForm(110)).toBe('note')
    expect(collapseForm(109.9)).toBe('circle')
    expect(collapseForm(28)).toBe('circle')
    expect(collapseForm(27.9)).toBe('dot')
  })

  it('walks the forms in order zooming a 280 px note from 250% to 8%', () => {
    const seen: string[] = []
    for (let zoom = 2.5; zoom >= 0.08; zoom *= 0.97) {
      const form = collapseForm(280 * zoom)
      if (seen[seen.length - 1] !== form) seen.push(form)
    }
    expect(seen).toEqual(['note', 'circle', 'dot'])
  })

  it('gives every note the tuned defaults (gate 2)', () => {
    expect(thresholdsFor('n1')).toEqual(LOOK.collapse)
    expect(thresholdsFor('n99')).toBe(thresholdsFor('n1'))
  })
})

describe('circleLetter', () => {
  it('is the first character of the title, upper-cased, whole graphemes', () => {
    expect(circleLetter('  garden plan')).toBe('G')
    expect(circleLetter('')).toBe('·')
    expect(circleLetter('🌱 seeds')).toBe('🌱')
  })
})

describe('circleShape', () => {
  it('is the same edge for the same seed, and never depends on zoom', () => {
    expect(inkPath(circleShape(7))).toBe(inkPath(circleShape(7)))
    expect(inkPath(circleShape(7))).not.toBe(inkPath(circleShape(8)))
  })
})

describe('FormFades', () => {
  const forms = (entries: Array<[string, ShownForm]>) => new Map(entries)

  it('does not fade on first sight', () => {
    const f = new FormFades()
    expect(f.update(forms([['n1', 'circle']]), 0, 220).size).toBe(0)
  })

  it('fades from the old form to the new for the crossfade length, then stops', () => {
    const f = new FormFades()
    f.update(forms([['n1', 'note']]), 0, 220)
    const running = f.update(forms([['n1', 'circle']]), 1000, 220)
    expect(running.get('n1')).toEqual({ from: 'note', to: 'circle', atMs: 1000 })
    expect(f.nextEndMs(220)).toBe(1220)
    expect(f.update(forms([['n1', 'circle']]), 1100, 220).has('n1')).toBe(true)
    expect(f.update(forms([['n1', 'circle']]), 1220, 220).has('n1')).toBe(false)
    expect(f.nextEndMs(220)).toBeNull()
  })

  it('restarts from the form it was showing when the form changes again mid-fade', () => {
    const f = new FormFades()
    f.update(forms([['n1', 'note']]), 0, 220)
    f.update(forms([['n1', 'circle']]), 100, 220)
    expect(f.update(forms([['n1', 'dot']]), 150, 220).get('n1')).toEqual({ from: 'circle', to: 'dot', atMs: 150 })
  })

  it('never fades with the effect off, and forgets notes that go away', () => {
    const f = new FormFades()
    f.update(forms([['n1', 'note']]), 0, 0)
    expect(f.update(forms([['n1', 'dot']]), 10, 0).size).toBe(0)
    f.update(forms([['n1', 'note']]), 20, 220)
    f.update(forms([]), 30, 220)
    expect(f.update(forms([['n1', 'dot']]), 40, 220).size).toBe(0)
  })
})

describe('formsToDraw', () => {
  it('draws the current form alone when nothing fades', () => {
    expect(formsToDraw('circle', undefined)).toEqual([{ form: 'circle', fade: null }])
    expect(formsToDraw('hidden', undefined)).toEqual([])
  })

  it('draws the old form fading out under the new fading in', () => {
    const fade = { from: 'note', to: 'circle', atMs: 0 } as const
    expect(formsToDraw('circle', fade)).toEqual([
      { form: 'note', fade: 'out' },
      { form: 'circle', fade: 'in' },
    ])
  })

  it('fades a note out when its container collapses, and in when it opens', () => {
    expect(formsToDraw('hidden', { from: 'note', to: 'hidden', atMs: 0 })).toEqual([{ form: 'note', fade: 'out' }])
    expect(formsToDraw('note', { from: 'hidden', to: 'note', atMs: 0 })).toEqual([{ form: 'note', fade: 'in' }])
  })
})
