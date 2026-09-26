/**
 * Edge arrows: pure geometry for the attention cue that reaches past the
 * viewport (02.8 D-16, SC5). No React, no DOM.
 *
 * A session card that lies entirely outside the visible canvas area and holds
 * an unacknowledged state at level 2 or more (Done, Needs you, Failed, a new
 * chat) gets one arrow on the edge of that area, where the line from the
 * area's centre to the card's centre leaves it. Clicking the arrow is the
 * person's own action; nothing here, and nothing an agent does, moves the
 * camera.
 *
 * All values are CSS pixels relative to the canvas viewport. The rules:
 *  - the visible area is the viewport minus the ChatPanel's column
 *    (420 + 16 px) when the panel is open
 *  - a card is off-screen when the screen bounding box of its four corners,
 *    taken through the camera (so roll is handled), does not touch the
 *    visible area; a card drawn too small to read still counts as visible
 *  - an arrow's centre sits 16 + 16 px in from the sides and the bottom and
 *    64 + 16 px down from the top (the forest bar row), and 16 + 16 px left
 *    of the panel when it is open
 *  - arrows on one edge are spread along it in their order, at least
 *    ARROW_SPACING apart centre to centre
 *
 * Arrows are view state: they never reach a tree, a commit or a hash.
 */

import { worldToScreen, type Camera } from './camera'
import type { Attention, AttentionKind } from '../../shared/chat/session-status'

/** The arrow's diameter. */
export const EDGE_ARROW_SIZE = 32
/** From the left and right edges of the visible area to the arrow's edge. */
export const EDGE_SIDE_INSET = 16
/** From the top: clears the forest bar row. */
export const EDGE_TOP_INSET = 64
export const EDGE_BOTTOM_INSET = 16
/** The ChatPanel's column: its 420 px width plus its 16 px right margin. */
export const PANEL_COLUMN = 436
/** From the viewport's right edge to the arrow's edge while the panel is open (420 + 16 + 16). */
export const PANEL_OPEN_RIGHT_INSET = PANEL_COLUMN + EDGE_SIDE_INSET
/** Centre to centre on one edge: the 32 px arrow plus the 8 px gap. */
export const ARROW_SPACING = EDGE_ARROW_SIZE + 8
/** The lowest level that earns an arrow (D-14 levels table). */
export const ARROW_MIN_LEVEL = 2

const HALF = EDGE_ARROW_SIZE / 2

export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface WorldRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

export type Edge = 'top' | 'right' | 'bottom' | 'left'

/** Where an arrow's centre sits, on which edge, and its heading in degrees (0 = right, clockwise). */
export interface ArrowSpot {
  x: number
  y: number
  edge: Edge
  angle: number
}

/** The part of the canvas the person can see: the viewport, less the panel's column when it is open. */
export function visibleRect(viewport: ViewportSize, panelOpen: boolean): ScreenRect {
  const width = Math.max(0, viewport.width)
  const height = Math.max(0, viewport.height)
  return { left: 0, top: 0, right: panelOpen ? Math.max(0, width - PANEL_COLUMN) : width, bottom: height }
}

/** The screen bounding box of a world rect's four corners under the camera. */
export function screenBounds(camera: Camera, rect: WorldRect): ScreenRect {
  const corners = [
    worldToScreen(camera, rect.x, rect.y),
    worldToScreen(camera, rect.x + rect.width, rect.y),
    worldToScreen(camera, rect.x, rect.y + rect.height),
    worldToScreen(camera, rect.x + rect.width, rect.y + rect.height),
  ]
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}

/**
 * Whether a card lies entirely outside the visible area. Its screen bounding
 * box has to miss the area; a box that only touches an edge has no area in
 * common, so it is off-screen too.
 */
export function isOffscreen(camera: Camera, worldRect: WorldRect, visible: ScreenRect): boolean {
  const box = screenBounds(camera, worldRect)
  return box.right <= visible.left || box.left >= visible.right || box.bottom <= visible.top || box.top >= visible.bottom
}

/** The rectangle arrow centres live on: the visible area, inset. Never inside out. */
export function arrowTrack(visible: ScreenRect): ScreenRect {
  let left = visible.left + EDGE_SIDE_INSET + HALF
  let right = visible.right - EDGE_SIDE_INSET - HALF
  let top = visible.top + EDGE_TOP_INSET + HALF
  let bottom = visible.bottom - EDGE_BOTTOM_INSET - HALF
  if (right < left) left = right = (visible.left + visible.right) / 2
  if (bottom < top) top = bottom = (visible.top + visible.bottom) / 2
  return { left, top, right, bottom }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function degrees(dx: number, dy: number): number {
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

/**
 * Where the ray from the visible area's centre toward `target` (a screen
 * point, normally the card's centre) leaves the arrow track. The panel's
 * column is already out of `visible`, so an arrow never sits under the panel.
 */
export function arrowSpot(target: { x: number; y: number }, visible: ScreenRect): ArrowSpot {
  const track = arrowTrack(visible)
  const ox = (visible.left + visible.right) / 2
  const oy = (visible.top + visible.bottom) / 2
  const dx = target.x - ox
  const dy = target.y - oy
  if (dx === 0 && dy === 0) return { x: clamp(ox, track.left, track.right), y: track.top, edge: 'top', angle: -90 }

  // Where the ray meets each edge it heads toward; the nearest one is where it leaves.
  const hits: Array<{ t: number; edge: Edge }> = []
  if (dx > 0) hits.push({ t: (track.right - ox) / dx, edge: 'right' })
  if (dx < 0) hits.push({ t: (track.left - ox) / dx, edge: 'left' })
  if (dy > 0) hits.push({ t: (track.bottom - oy) / dy, edge: 'bottom' })
  if (dy < 0) hits.push({ t: (track.top - oy) / dy, edge: 'top' })
  const hit = hits.reduce((best, h) => (h.t < best.t ? h : best))
  const t = Math.max(0, hit.t)
  const edge = hit.edge

  let x = clamp(ox + t * dx, track.left, track.right)
  let y = clamp(oy + t * dy, track.top, track.bottom)
  // Exactly on the edge it was assigned, whatever rounding did.
  if (edge === 'right') x = track.right
  else if (edge === 'left') x = track.left
  else if (edge === 'bottom') y = track.bottom
  else y = track.top
  return { x, y, edge, angle: degrees(dx, dy) }
}

/** The coordinate that runs along an edge: x on the top and bottom, y on the sides. */
function along(spot: ArrowSpot): number {
  return spot.edge === 'top' || spot.edge === 'bottom' ? spot.x : spot.y
}

function withAlong<T extends ArrowSpot>(spot: T, value: number): T {
  return spot.edge === 'top' || spot.edge === 'bottom' ? { ...spot, x: value } : { ...spot, y: value }
}

/**
 * Spread the arrows of one edge along it, keeping their order and at least
 * `spacing` between centres, each group of crowded arrows centred where they
 * wanted to be, all inside `segment` (the edge's stretch of the track).
 * Returned sorted along the edge, which on one edge is the order of their
 * angles. When the edge is too short for them all, they share it evenly.
 */
export function spreadOnEdge<T extends ArrowSpot>(
  spots: readonly T[],
  spacing: number,
  segment: { min: number; max: number },
): T[] {
  const sorted = [...spots].sort((a, b) => along(a) - along(b))
  const n = sorted.length
  if (n === 0) return []
  const length = Math.max(0, segment.max - segment.min)
  if ((n - 1) * spacing > length) {
    const step = n > 1 ? length / (n - 1) : 0
    return sorted.map((spot, i) => withAlong(spot, n > 1 ? segment.min + i * step : (segment.min + segment.max) / 2))
  }

  // Groups of arrows placed `spacing` apart, each group where its members'
  // wished-for spots average out (the least total movement), merged while
  // two groups overlap.
  interface Group {
    first: number
    count: number
    /** Sum of (wished-for position - index in group * spacing). */
    sum: number
    start: number
  }
  const place = (g: Group): void => {
    g.start = clamp(g.sum / g.count, segment.min, segment.max - (g.count - 1) * spacing)
  }
  const groups: Group[] = []
  sorted.forEach((spot, i) => {
    const g: Group = { first: i, count: 1, sum: along(spot), start: 0 }
    place(g)
    groups.push(g)
    while (groups.length > 1) {
      const cur = groups[groups.length - 1]
      const prev = groups[groups.length - 2]
      if (prev.start + prev.count * spacing <= cur.start + 1e-9) break
      // Merge: cur's members sit after prev's, so each is offset by prev.count more.
      for (let k = 0; k < cur.count; k++) {
        prev.sum += along(sorted[cur.first + k]) - (prev.count + k) * spacing
      }
      prev.count += cur.count
      place(prev)
      groups.pop()
    }
  })

  const out: T[] = []
  for (const g of groups) {
    for (let k = 0; k < g.count; k++) out.push(withAlong(sorted[g.first + k], g.start + k * spacing))
  }
  return out
}

/** One session card as the arrow layer sees it. */
export interface EdgeArrowCard {
  key: string
  worldRect: WorldRect
  attention: Attention | null
  title: string
  /** The CSS variable naming the session's author colour. */
  author: string
}

/** One arrow to draw. */
export interface EdgeArrow extends ArrowSpot {
  key: string
  kind: AttentionKind
  title: string
  author: string
}

/**
 * The arrows to draw: one per card that is off-screen and asks for attention
 * at level 2 or more, spread along each edge, each pointing from where it
 * ended up toward its card. Nothing off-screen, or nothing asking: none.
 */
export function edgeArrows(
  cards: readonly EdgeArrowCard[],
  camera: Camera,
  viewport: ViewportSize,
  panelOpen: boolean,
): EdgeArrow[] {
  const visible = visibleRect(viewport, panelOpen)
  const track = arrowTrack(visible)
  const byEdge: Record<Edge, Array<EdgeArrow & { cx: number; cy: number }>> = { top: [], right: [], bottom: [], left: [] }

  for (const card of cards) {
    const attention = card.attention
    if (!attention || attention.level < ARROW_MIN_LEVEL) continue
    if (!isOffscreen(camera, card.worldRect, visible)) continue
    const centre = worldToScreen(
      camera,
      card.worldRect.x + card.worldRect.width / 2,
      card.worldRect.y + card.worldRect.height / 2,
    )
    const spot = arrowSpot(centre, visible)
    byEdge[spot.edge].push({
      ...spot,
      key: card.key,
      kind: attention.kind,
      title: card.title,
      author: card.author,
      cx: centre.x,
      cy: centre.y,
    })
  }

  const out: EdgeArrow[] = []
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const horizontal = edge === 'top' || edge === 'bottom'
    const segment = horizontal ? { min: track.left, max: track.right } : { min: track.top, max: track.bottom }
    for (const spread of spreadOnEdge(byEdge[edge], ARROW_SPACING, segment)) {
      const { cx, cy, ...arrow } = spread
      out.push({ ...arrow, angle: degrees(cx - arrow.x, cy - arrow.y) })
    }
  }
  return out
}
