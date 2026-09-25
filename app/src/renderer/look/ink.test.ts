import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  blueReach,
  circlePts,
  inkPath,
  inkShape,
  loopWave,
  makeNoise,
  nearestT,
  noteOutlinePts,
  seedFromId,
  type InkShape,
} from './ink'
import { InkLine, inkLinePaths } from './InkLine'
import { LOOK } from './values'

const note = (w = 300, h = 200, seed = 7): InkShape =>
  inkShape(noteOutlinePts(w, h, seed), true, seed, { step: 2, cornerRadius: 16 })

/** Every coordinate pair in a path `d`, in order. */
function coords(d: string): [number, number][] {
  const out: [number, number][] = []
  for (const m of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) out.push([Number(m[1]), Number(m[2])])
  return out
}

describe('ink shape and path', () => {
  it('the same seed gives the same path, and another seed a different one', () => {
    const a = inkPath(note(300, 200, 7), { seed: 7 })
    const b = inkPath(note(300, 200, 7), { seed: 7 })
    const c = inkPath(note(300, 200, 8), { seed: 8 })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toMatch(/NaN|Infinity/)
  })

  it('seeds from a note id are stable 32-bit integers', () => {
    expect(seedFromId('note-1')).toBe(seedFromId('note-1'))
    expect(seedFromId('note-1')).not.toBe(seedFromId('note-2'))
    expect(Number.isInteger(seedFromId('x'))).toBe(true)
    expect(seedFromId('x')).toBeGreaterThanOrEqual(0)
  })

  it('a whole closed loop is two rings, one per side of the line', () => {
    const d = inkPath(note())
    expect(d.match(/M/g)).toHaveLength(2)
    expect(d.match(/Z/g)).toHaveLength(2)
  })

  it('the line is the tuned weight wide, in world units, give or take the variation', () => {
    const s = note()
    const pts = coords(inkPath(s))
    const n = s.pts.length
    // Outer ring point i and inner ring point i (the inner ring runs backwards).
    const widths = s.pts.map((_, i) => {
      const [ox, oy] = pts[i]
      const [ix, iy] = pts[2 * n - 1 - i]
      return Math.hypot(ox - ix, oy - iy)
    })
    const w = LOOK.line.weightPx
    const lo = w * (1 - LOOK.line.widthVariationPct / 100) - 0.02
    const hi = w * (1 + LOOK.line.widthVariationPct / 100) * (1 + LOOK.line.cornerSwellPct / 100) + 0.02
    for (const x of widths) {
      expect(x).toBeGreaterThanOrEqual(lo)
      expect(x).toBeLessThanOrEqual(hi)
    }
    // Corners swell: the widest point is well above the straight-edge weight.
    expect(Math.max(...widths)).toBeGreaterThan(w * 1.2)
  })

  it('wobble noise is periodic, so a closed loop has no seam', () => {
    const f = makeNoise(99, 3, 1)
    expect(f(0)).toBeCloseTo(f(1), 10)
  })

  it('a closed wave meets itself without a seam at any time', () => {
    const s = note()
    for (const now of [0, 137, 1000, 4321.5]) {
      const wave = loopWave(1, now)
      expect(wave(0)).toBeCloseTo(wave(1), 10)
      // Scaled-down loops (red dot, circle) keep whole wave counts too.
      const small = loopWave(0.13, now)
      expect(small(0)).toBeCloseTo(small(1), 10)

      const outer = coords(inkPath(s, { wave })).slice(0, s.pts.length)
      const gaps = outer.map((p, i) => {
        const q = outer[(i + 1) % outer.length]
        return Math.hypot(q[0] - p[0], q[1] - p[1])
      })
      const seam = gaps[gaps.length - 1]
      const typical = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
      expect(seam).toBeLessThan(typical * 1.6)
    }
  })

  it('the wave stays within the tuned height', () => {
    const wave = loopWave(1, 812)
    for (let i = 0; i <= 100; i++) expect(Math.abs(wave(i / 100))).toBeLessThanOrEqual(LOOK.selectionWaves.heightPx + 1e-9)
  })

  it('an open line is one closed shape with round caps', () => {
    const rule = inkShape(
      [
        { x: 22, y: 62 },
        { x: 260, y: 60 },
      ],
      false,
      3,
      { step: 2, wobbleScale: 0.6 },
    )
    const d = inkPath(rule)
    expect(d.match(/M/g)).toHaveLength(1)
    expect(d.endsWith('Z')).toBe(true)
    // Both sides plus two caps of five points each.
    expect(coords(d)).toHaveLength(rule.pts.length * 2 + 10)
  })
})

describe('the selection grow mask', () => {
  it('reaches nothing at 0, everything at 1, and grows both ways from the click', () => {
    expect(blueReach(0, 0.3, 1)).toBeNull()
    const all = blueReach(1, 0.3, 1)!
    expect([0, 0.3, 0.8, 0.99].every(all)).toBe(true)
    const half = blueReach(0.4, 0.3, 1)!
    expect(half(0.3)).toBe(true)
    expect(half(0.35)).toBe(true)
    expect(half(0.25)).toBe(true)
    expect(half(0.8)).toBe(false)
  })

  it('wraps across t = 0', () => {
    const r = blueReach(0.2, 0.02, 5)!
    expect(r(0.98)).toBe(true)
    expect(r(0.06)).toBe(true)
    expect(r(0.5)).toBe(false)
  })

  it('the blue replaces the pencil: the two paths never share a segment', () => {
    const s = note()
    const fromT = nearestT(s, 150, 0)
    for (const g of [0.1, 0.5]) {
      const { base, active } = inkLinePaths({ shape: s, grow: g, fromT, waveAmp: 0, nowMs: 0 })
      // One pencil run and one blue run that meet end to end: the blue is
      // never drawn on top of the pencil.
      expect(base.match(/M/g)).toHaveLength(1)
      expect(active.match(/M/g)).toHaveLength(1)
      const sides = (coords(base).length - 10) / 2 + (coords(active).length - 10) / 2
      expect(sides).toBe(s.pts.length + 2)
    }
    const full = inkLinePaths({ shape: s, grow: 1, fromT, waveAmp: 1, nowMs: 0 })
    expect(full.base).toBe('')
    expect(full.active.match(/M/g)).toHaveLength(2)
  })

  it('nearestT finds the click point on the outline', () => {
    const s = inkShape(circlePts(0, 0, 50), true, 1, { wobbleScale: 0 })
    // circlePts starts at the top, so the top is t = 0 and the right side ~ 0.25.
    expect(nearestT(s, 0, -60)).toBeCloseTo(0, 1)
    expect(nearestT(s, 60, 0)).toBeCloseTo(0.25, 1)
  })
})

describe('<InkLine>', () => {
  const render = (scale: number, shape: InkShape): string =>
    renderToStaticMarkup(
      createElement(
        'div',
        { style: { transform: `scale(${scale})` } },
        createElement(InkLine, { shape, seed: 7, takeover: { on: false, fromT: 0 } }),
      ),
    )
  const d = (html: string): string[] => [...html.matchAll(/ d="([^"]*)"/g)].map((m) => m[1])

  it('draws in world units: the path is the same at every zoom', () => {
    const s = note()
    const [a, b, c] = [0.08, 1, 2.5].map((z) => d(render(z, s)))
    expect(a).toEqual(b)
    expect(b).toEqual(c)
    expect(b[0]).toBe(inkPath(s, { seed: 7 }))
  })

  it('uses the pencil and select tokens', () => {
    const html = render(1, note())
    expect(html).toContain('fill="var(--tap-pencil)"')
    expect(html).toContain('fill="var(--tap-select)"')
    expect(html).toContain('pointer-events:none')
  })

  it('starts fully selected when mounted selected', () => {
    const s = note()
    const html = renderToStaticMarkup(createElement(InkLine, { shape: s, takeover: { on: true, fromT: 0.2 } }))
    const [base, active] = d(html)
    expect(base).toBe('')
    expect(active.match(/M/g)).toHaveLength(2)
  })
})

describe('frame budget (200 notes, 3 selected)', () => {
  it('builds 200 outlines once, then 3 waving outlines per frame well inside 16 ms', () => {
    const t0 = performance.now()
    const shapes: InkShape[] = []
    for (let i = 0; i < 200; i++) {
      const s = inkShape(noteOutlinePts(240 + (i % 5) * 20, 160, i), true, i, { step: 2, cornerRadius: 16 })
      inkPath(s, { seed: i })
      shapes.push(s)
    }
    const build = performance.now() - t0

    const frames = 60
    const t1 = performance.now()
    for (let f = 0; f < frames; f++) {
      for (let k = 0; k < 3; k++) {
        inkLinePaths({ shape: shapes[k], seed: k, grow: 1, fromT: 0, waveAmp: 1, nowMs: f * 16.7 })
      }
    }
    const perFrame = (performance.now() - t1) / frames
    // Loose ceilings so a busy test machine doesn't flake: the real numbers
    // are far lower (see the wave 1 notes in autonomy/STATE.md).
    expect(build).toBeLessThan(2000)
    expect(perFrame).toBeLessThan(4)
  })
})
