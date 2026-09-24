/**
 * panels.ts — one panel per view, dots at project(pos), plain canvas 2D.
 *
 * Pure layout and drawing over a Projection: no kernel, no engine, so a
 * test can call it with a fake canvas context. Each panel fits its own
 * points (with a margin) so a view is readable whatever its scale; the
 * y axis grows down, as the app's canvas does. A view that failed shows
 * its error instead of dots. Points are drawn in id order, as they arrive.
 */
import type { Projection } from './engine'

export interface PanelBox {
  id: string
  x: number
  y: number
  w: number
  h: number
}

const GAP = 12
const MARGIN = 24
const DOT = 4

/** Panels in a near-square grid over `width` × `height`, in view order. */
export function layout(views: Projection['views'], width: number, height: number): PanelBox[] {
  const n = views.length
  if (n === 0) return []
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const w = (width - GAP * (cols + 1)) / cols
  const h = (height - GAP * (rows + 1)) / rows
  return views.map((v, i) => ({
    id: v.id,
    x: GAP + (i % cols) * (w + GAP),
    y: GAP + Math.floor(i / cols) * (h + GAP),
    w,
    h,
  }))
}

/** Bounding box of the points a view places, or null when it places none. */
function bounds(points: Projection['points'], view: string): [number, number, number, number] | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    const q = p.byView[view]
    if (!q) continue
    minX = Math.min(minX, q[0])
    minY = Math.min(minY, q[1])
    maxX = Math.max(maxX, q[0])
    maxY = Math.max(maxY, q[1])
  }
  return minX === Infinity ? null : [minX, minY, maxX, maxY]
}

/** Uniform scale and offset taking `bounds` into the panel with a margin. */
export function fit(box: PanelBox, b: [number, number, number, number]): (p: [number, number]) => [number, number] {
  const spanX = Math.max(b[2] - b[0], 1e-9)
  const spanY = Math.max(b[3] - b[1], 1e-9)
  const s = Math.min((box.w - 2 * MARGIN) / spanX, (box.h - 2 * MARGIN) / spanY)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const mx = (b[0] + b[2]) / 2
  const my = (b[1] + b[3]) / 2
  return (p) => [cx + (p[0] - mx) * s, cy + (p[1] - my) * s]
}

/** Draw every panel; `ctx` is already scaled for the device pixel ratio. */
export function draw(ctx: CanvasRenderingContext2D, proj: Projection, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height)
  ctx.font = '12px ui-monospace, Menlo, monospace'
  ctx.textBaseline = 'top'
  if (proj.views.length === 0) {
    ctx.fillStyle = '#9a9a9a'
    ctx.fillText('no mathspace/view@1 nodes in this tree', GAP, GAP)
    return
  }
  for (const [i, box] of layout(proj.views, width, height).entries()) {
    const view = proj.views[i]!
    ctx.strokeStyle = '#3a3a3a'
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1)
    ctx.fillStyle = '#cfcfcf'
    ctx.fillText(view.id, box.x + 6, box.y + 6)
    if (view.error !== undefined) {
      ctx.fillStyle = '#e08080'
      ctx.fillText(view.error, box.x + 6, box.y + 22)
      continue
    }
    const b = bounds(proj.points, view.id)
    if (b === null) {
      ctx.fillStyle = '#9a9a9a'
      ctx.fillText('nothing in this view', box.x + 6, box.y + 22)
      continue
    }
    const to = fit(box, b)
    for (const p of proj.points) {
      const q = p.byView[view.id]
      if (!q) continue
      const [x, y] = to(q)
      ctx.fillStyle = '#f0ede6'
      ctx.beginPath()
      ctx.arc(x, y, DOT, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#9a9a9a'
      ctx.fillText(p.id, x + DOT + 2, y - 6)
    }
  }
}
