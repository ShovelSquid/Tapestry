import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CONNECTION_FLASH_WINDOW_MS,
  CONNECTION_SAG_MAX_PX,
  connectionPts,
  connectionShape,
  connectionWaveScale,
} from './connection'
import { inkLinePaths } from './InkLine'
import ConnectionLine from '../components/ConnectionLine'

describe('connection ink (wave 4)', () => {
  it('runs from end to end and sags to the lower side', () => {
    const pts = connectionPts({ x: 0, y: 0 }, { x: 200, y: 0 })
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 0 })
    const mid = pts[Math.floor(pts.length / 2)]
    expect(mid.y).toBeGreaterThan(0)
    expect(mid.y).toBeCloseTo(16, 5)
    // Drawn right to left it sags the same way.
    const back = connectionPts({ x: 200, y: 0 }, { x: 0, y: 0 })
    expect(back[Math.floor(back.length / 2)].y).toBeGreaterThan(0)
  })

  it('caps the sag on long lines', () => {
    const pts = connectionPts({ x: 0, y: 0 }, { x: 5000, y: 0 })
    expect(Math.max(...pts.map((p) => p.y))).toBeLessThanOrEqual(CONNECTION_SAG_MAX_PX + 1e-9)
  })

  it('is a pure function of its ends and seed', () => {
    const a = connectionShape({ x: 10, y: 20 }, { x: 300, y: 140 }, 5)
    const b = connectionShape({ x: 10, y: 20 }, { x: 300, y: 140 }, 5)
    expect(a).toEqual(b)
    expect(a.closed).toBe(false)
    expect(connectionWaveScale(a)).toBeGreaterThan(0)
  })

  it('a waving connection keeps its ends still (pinEnds)', () => {
    const shape = connectionShape({ x: 0, y: 0 }, { x: 400, y: 0 }, 3)
    const at = (nowMs: number, pinEnds: boolean): string =>
      inkLinePaths({ shape, seed: 3, grow: 0, fromT: 0, waveAmp: 1, nowMs, pinEnds, waveScale: 0.5 }).base
    const first = (d: string): string => d.slice(0, d.indexOf('L'))
    // The path starts at the line's first point on one side: pinned, it
    // doesn't move as the wave travels; unpinned, it does.
    expect(first(at(0, true))).toBe(first(at(700, true)))
    expect(first(at(0, false))).not.toBe(first(at(700, false)))
    // The middle waves either way.
    expect(at(0, true)).not.toBe(at(700, true))
  })

  it('renders blue ink; the live line ends in a dot; a new line flashes', () => {
    const rest = renderToStaticMarkup(createElement(ConnectionLine, { x1: 0, y1: 0, x2: 100, y2: 50, seedKey: 'e1' }))
    expect(rest).toContain('var(--tap-select)')
    // Drawn straight into the connections SVG: a nested <svg> there would sit
    // at the wrong origin.
    expect(rest).toContain('<g class="ink-line connection-ink">')
    expect(rest).not.toContain('<svg')
    expect(rest).not.toContain('connection-drag-dot')
    expect(rest).not.toContain('connection-landed')

    const live = renderToStaticMarkup(createElement(ConnectionLine, { x1: 0, y1: 0, x2: 100, y2: 50, isTemporary: true }))
    expect(live).toContain('connection-drag-dot')

    const landed = renderToStaticMarkup(
      createElement(ConnectionLine, { x1: 0, y1: 0, x2: 100, y2: 50, seedKey: 'e2', landedAt: performance.now() }),
    )
    expect(landed).toContain('connection-landed')

    const stale = renderToStaticMarkup(
      createElement(ConnectionLine, {
        x1: 0,
        y1: 0,
        x2: 100,
        y2: 50,
        seedKey: 'e3',
        landedAt: performance.now() - CONNECTION_FLASH_WINDOW_MS - 1,
      }),
    )
    expect(stale).not.toContain('connection-landed')
  })
})
