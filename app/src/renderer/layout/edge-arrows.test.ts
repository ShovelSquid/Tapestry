/**
 * Edge arrows (02.8 D-16, SC5). What matters here: a card that shows on
 * screen in any way (a rolled card included) never gets an arrow, a card
 * under the open panel counts as off-screen, an arrow sits on the edge the
 * card is past and never under the panel, crowded arrows on one edge never
 * overlap, and nothing is drawn when nothing asks.
 */

import { describe, expect, it } from 'vitest'
import { IDENTITY_CAMERA, type Camera } from './camera'
import {
  ARROW_SPACING,
  EDGE_ARROW_SIZE,
  EDGE_BOTTOM_INSET,
  EDGE_SIDE_INSET,
  EDGE_TOP_INSET,
  PANEL_COLUMN,
  PANEL_OPEN_RIGHT_INSET,
  arrowSpot,
  arrowTrack,
  edgeArrows,
  isOffscreen,
  spreadOnEdge,
  visibleRect,
  type ArrowSpot,
  type EdgeArrowCard,
} from './edge-arrows'

const VIEW = { width: 1000, height: 800 }
const CLOSED = visibleRect(VIEW, false)
const OPEN = visibleRect(VIEW, true)

describe('constants (UI-SPEC § Spacing)', () => {
  it('a 32px arrow, 16px from the sides and bottom, 64px from the top, 452px from the right with the panel open', () => {
    expect(EDGE_ARROW_SIZE).toBe(32)
    expect(EDGE_SIDE_INSET).toBe(16)
    expect(EDGE_BOTTOM_INSET).toBe(16)
    expect(EDGE_TOP_INSET).toBe(64)
    expect(PANEL_COLUMN).toBe(436)
    expect(PANEL_OPEN_RIGHT_INSET).toBe(452)
    expect(ARROW_SPACING).toBe(40)
  })
})

describe('visibleRect', () => {
  it('is the whole viewport with the panel closed, and stops at the panel column when it is open', () => {
    expect(CLOSED).toEqual({ left: 0, top: 0, right: 1000, bottom: 800 })
    expect(OPEN).toEqual({ left: 0, top: 0, right: 1000 - 436, bottom: 800 })
  })
})

describe('isOffscreen', () => {
  it('a card fully left of the viewport is off-screen', () => {
    expect(isOffscreen(IDENTITY_CAMERA, { x: -400, y: 100, width: 360, height: 440 }, CLOSED)).toBe(true)
  })

  it('a card overlapping the viewport by 1px is not', () => {
    expect(isOffscreen(IDENTITY_CAMERA, { x: -359, y: 100, width: 360, height: 440 }, CLOSED)).toBe(false)
  })

  it('a card that only touches the edge is off-screen', () => {
    expect(isOffscreen(IDENTITY_CAMERA, { x: -360, y: 100, width: 360, height: 440 }, CLOSED)).toBe(true)
  })

  it('uses all four corners through the camera, so a rolled card that shows is not off-screen', () => {
    const rect = { x: 200, y: -500, width: 100, height: 50 }
    const level: Camera = { panX: 500, panY: 400, zoom: 1, roll: 0 }
    const rolled: Camera = { ...level, roll: 90 }
    // Without the roll the card is above the viewport...
    expect(isOffscreen(level, rect, CLOSED)).toBe(true)
    // ...but a quarter turn brings it in at the right-hand side.
    expect(isOffscreen(rolled, rect, CLOSED)).toBe(false)
  })

  it('follows zoom', () => {
    const rect = { x: 1200, y: 100, width: 100, height: 100 }
    expect(isOffscreen(IDENTITY_CAMERA, rect, CLOSED)).toBe(true)
    expect(isOffscreen({ ...IDENTITY_CAMERA, zoom: 0.5 }, rect, CLOSED)).toBe(false)
  })

  it('with the panel open, a card under the panel column only is off-screen', () => {
    const underPanel = { x: 600, y: 100, width: 100, height: 100 }
    expect(isOffscreen(IDENTITY_CAMERA, underPanel, CLOSED)).toBe(false)
    expect(isOffscreen(IDENTITY_CAMERA, underPanel, OPEN)).toBe(true)
  })
})

describe('arrowSpot', () => {
  it('a card far to the right gives an arrow on the right edge, centre 32px in, at the ray height', () => {
    const spot = arrowSpot({ x: 5000, y: 400 }, CLOSED)
    expect(spot.edge).toBe('right')
    expect(spot.x).toBe(1000 - 16 - 16)
    expect(spot.y).toBeCloseTo(400)
    expect(spot.angle).toBeCloseTo(0)
  })

  it('follows the ray, not the nearest point', () => {
    // From the centre (500, 400) toward (2500, 1400): slope 0.5, so at x = 968 the ray is at y = 634.
    const spot = arrowSpot({ x: 2500, y: 1400 }, CLOSED)
    expect(spot.edge).toBe('right')
    expect(spot.y).toBeCloseTo(400 + (968 - 500) * 0.5)
  })

  it('a card far above gives an arrow on the top edge, 64 + 16 px down', () => {
    const spot = arrowSpot({ x: 500, y: -5000 }, CLOSED)
    expect(spot.edge).toBe('top')
    expect(spot.y).toBe(64 + 16)
    expect(spot.x).toBeCloseTo(500)
    expect(spot.angle).toBeCloseTo(-90)
  })

  it('far below and far left give the bottom and left edges', () => {
    expect(arrowSpot({ x: 500, y: 9000 }, CLOSED)).toMatchObject({ edge: 'bottom', y: 800 - 16 - 16 })
    expect(arrowSpot({ x: -9000, y: 400 }, CLOSED)).toMatchObject({ edge: 'left', x: 16 + 16 })
  })

  it('with the panel open the right edge moves left of it: 1000 - 452 - 16', () => {
    const spot = arrowSpot({ x: 5000, y: 400 }, OPEN)
    expect(spot.edge).toBe('right')
    expect(spot.x).toBe(1000 - 452 - 16)
  })

  it('a corner-ward card lands on the track, never outside it', () => {
    const track = arrowTrack(CLOSED)
    for (const target of [
      { x: 9000, y: -9000 },
      { x: -9000, y: 9000 },
      { x: 9000, y: 9000 },
      { x: -9000, y: -9000 },
    ]) {
      const spot = arrowSpot(target, CLOSED)
      expect(spot.x).toBeGreaterThanOrEqual(track.left)
      expect(spot.x).toBeLessThanOrEqual(track.right)
      expect(spot.y).toBeGreaterThanOrEqual(track.top)
      expect(spot.y).toBeLessThanOrEqual(track.bottom)
    }
  })
})

describe('spreadOnEdge', () => {
  const on = (x: number): ArrowSpot => ({ x, y: 80, edge: 'top', angle: -90 })
  const segment = { min: 32, max: 968 }

  it('three arrows 10px apart end up at least 40px apart, in the same order, inside the segment', () => {
    const spread = spreadOnEdge([on(510), on(500), on(520)], ARROW_SPACING, segment)
    const xs = spread.map((s) => s.x)
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(40 - 1e-9)
    expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(40 - 1e-9)
    // Same order as they came along the edge, centred on where they wanted to be.
    expect(xs[0]).toBeLessThan(xs[1])
    expect(xs[1]).toBeCloseTo(510)
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(segment.min)
      expect(x).toBeLessThanOrEqual(segment.max)
    }
    // The other coordinate is untouched.
    expect(spread.every((s) => s.y === 80)).toBe(true)
  })

  it('crowded arrows at the end of an edge stay inside it', () => {
    const xs = spreadOnEdge([on(960), on(965), on(968)], ARROW_SPACING, segment).map((s) => s.x)
    expect(xs[2]).toBeLessThanOrEqual(968)
    expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(40 - 1e-9)
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(40 - 1e-9)
  })

  it('arrows already far enough apart do not move', () => {
    expect(spreadOnEdge([on(100), on(300)], ARROW_SPACING, segment).map((s) => s.x)).toEqual([100, 300])
  })

  it('spreads along y on a side edge', () => {
    const side = (y: number): ArrowSpot => ({ x: 968, y, edge: 'right', angle: 0 })
    const ys = spreadOnEdge([side(400), side(401)], ARROW_SPACING, { min: 80, max: 768 }).map((s) => s.y)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(40 - 1e-9)
  })
})

describe('edgeArrows', () => {
  const card = (key: string, x: number, y: number, attention: EdgeArrowCard['attention']): EdgeArrowCard => ({
    key,
    worldRect: { x, y, width: 360, height: 440 },
    attention,
    title: key,
    author: '--tap-author-1',
  })
  const done = { kind: 'done' as const, level: 2 }

  it('returns nothing when no card is off-screen', () => {
    expect(edgeArrows([card('a', 100, 100, done)], IDENTITY_CAMERA, VIEW, false)).toEqual([])
  })

  it('returns nothing when the off-screen cards ask for nothing at level 2 or more', () => {
    const cards = [card('a', 3000, 100, null), card('b', 3000, 900, { kind: 'done', level: 1 })]
    expect(edgeArrows(cards, IDENTITY_CAMERA, VIEW, false)).toEqual([])
  })

  it('gives one arrow per off-screen card that asks, on the edge it is past, pointing at it', () => {
    const arrows = edgeArrows(
      [card('far-right', 3000, 180, done), card('visible', 100, 100, done), card('above', 320, -3000, { kind: 'needs', level: 3 })],
      IDENTITY_CAMERA,
      VIEW,
      false,
    )
    expect(arrows.map((a) => a.key).sort()).toEqual(['above', 'far-right'])
    const right = arrows.find((a) => a.key === 'far-right')!
    expect(right.edge).toBe('right')
    expect(right.kind).toBe('done')
    expect(Math.abs(right.angle)).toBeLessThan(10)
    const up = arrows.find((a) => a.key === 'above')!
    expect(up.edge).toBe('top')
    expect(up.kind).toBe('needs')
  })

  it('keeps arrows out from under the open panel', () => {
    const arrows = edgeArrows([card('a', 3000, 180, done)], IDENTITY_CAMERA, VIEW, true)
    expect(arrows).toHaveLength(1)
    expect(arrows[0].x + EDGE_ARROW_SIZE / 2).toBeLessThanOrEqual(1000 - PANEL_COLUMN - EDGE_SIDE_INSET)
  })

  it('spreads several arrows on one edge at least 40px apart', () => {
    const arrows = edgeArrows(
      [card('a', 3000, 180, done), card('b', 3000, 190, done), card('c', 3000, 200, { kind: 'failed', level: 2 })],
      IDENTITY_CAMERA,
      VIEW,
      false,
    )
    const ys = arrows.filter((a) => a.edge === 'right').map((a) => a.y).sort((p, q) => p - q)
    expect(ys).toHaveLength(3)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(40 - 1e-9)
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(40 - 1e-9)
  })
})
