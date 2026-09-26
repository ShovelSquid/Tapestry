/**
 * The ink line (Line Lab v2, Part 2 wave 1): Line Lab's hand-drawn line,
 * ported from canvas strokes to one filled SVG outline path.
 *
 * Line Lab draws a line as many short round-capped canvas strokes, one per
 * segment, each with its own width. Here the same line is one closed shape:
 * both sides of the line (centre ± half the width, along each point's
 * normal) joined by round caps, so a note outline is one `<path>` the
 * browser fills once. It lives in the note card's DOM, so it tilts with the
 * card in pull-back (see the plan's ground truth).
 *
 * Static weight (Kaelen, 2026-09-25): every number here is in world units,
 * 1 px of weight at 100% zoom. The path scales with the card like the text
 * on it, and nothing in this file knows the zoom, so zooming can't rebuild
 * a path. Only animated lines (the selection wave, a hovered button) build
 * a new path, once per frame.
 *
 * Everything is a pure function of its inputs: the same shape, seed and
 * time give the same path string. Render-only; nothing here reaches the
 * `.tree`, so it may use floating point freely.
 */

import { LOOK, type LookValues } from './values'

export interface Pt {
  readonly x: number
  readonly y: number
}

/** A resampled, wobbled point with its normal and the per-point look inputs. */
export interface InkPoint extends Pt {
  readonly nx: number
  readonly ny: number
  /** Position along the line, 0..1 (a closed loop never reaches 1). */
  readonly t: number
  /** 0..1, how sharply the line turns here (drives corner swell). */
  readonly corner: number
  /** -1..1, the width-variation noise at this point. */
  readonly wv: number
}

export interface InkShape {
  readonly pts: readonly InkPoint[]
  readonly closed: boolean
  /** Length of the source line, before wobble. */
  readonly L: number
}

export interface ShapeOptions {
  /** Resample spacing in world px. */
  readonly step?: number
  /** Scales curvature into cornerness; larger rounds count as sharper. */
  readonly cornerRadius?: number
  /** Scales the wobble (buttons use less than notes). */
  readonly wobbleScale?: number
}

type LineValues = LookValues['line']
type WaveValues = LookValues['selectionWaves']

// ---------- seeded noise (Line Lab's, bit for bit) ----------

/** mulberry32: a small seeded generator in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer hash to [0, 1). */
export function hash(i: number): number {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** A note id (or any string) to a stable 32-bit seed (FNV-1a). */
export function seedFromId(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Periodic noise in [-1, 1] over t in [0, 1): four integer harmonics near
 * `base`. Whole harmonics mean noise(0) === noise(1), so a closed loop's
 * wobble meets itself without a seam.
 */
export function makeNoise(seed: number, base: number, spread: number): (t: number) => number {
  const r = rng(seed)
  const terms: [number, number, number][] = []
  let sum = 0
  for (let j = 0; j < 4; j++) {
    const k = Math.max(1, base - 1 + j * spread)
    const a = 0.35 + r() * 0.65
    terms.push([k, a, r() * Math.PI * 2])
    sum += a
  }
  return (t) => {
    let v = 0
    for (const [k, a, ph] of terms) v += a * Math.sin(2 * Math.PI * k * t + ph)
    return v / sum
  }
}

// ---------- source shapes ----------

/** Evenly spaced points along a polyline (closed loops don't repeat the first). */
export function resample(pts: readonly Pt[], closed: boolean, step: number): { pts: Pt[]; L: number } {
  const src = closed ? [...pts, pts[0]] : pts
  const segs: number[] = []
  let L = 0
  for (let i = 0; i < src.length - 1; i++) {
    const d = Math.hypot(src[i + 1].x - src[i].x, src[i + 1].y - src[i].y)
    segs.push(d)
    L += d
  }
  const n = Math.max(2, Math.round(L / step))
  const out: Pt[] = []
  let si = 0
  let acc = 0
  const count = closed ? n : n + 1
  for (let i = 0; i < count; i++) {
    const s = (i * L) / n
    while (si < segs.length - 1 && acc + segs[si] < s) {
      acc += segs[si]
      si++
    }
    const f = segs[si] ? (s - acc) / segs[si] : 0
    const a = src[si]
    const b = src[si + 1]
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
  }
  return { pts: out, L }
}

/** A rounded rectangle from (0, 0), radii clockwise from top-left. */
export function roundedRectPts(w: number, h: number, radii: readonly [number, number, number, number]): Pt[] {
  const [tl, tr, br, bl] = radii
  const pts: Pt[] = []
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number): void => {
    for (let i = 0; i <= 10; i++) {
      const a = a0 + ((a1 - a0) * i) / 10
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    }
  }
  arc(tl, tl, tl, Math.PI, Math.PI * 1.5)
  arc(w - tr, tr, tr, -Math.PI / 2, 0)
  arc(w - br, h - br, br, 0, Math.PI / 2)
  arc(bl, h - bl, bl, Math.PI / 2, Math.PI)
  return pts
}

/** A circle starting at the top, clockwise on screen. */
export function circlePts(cx: number, cy: number, r: number): Pt[] {
  const p: Pt[] = []
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2 - Math.PI / 2
    p.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return p
}

/**
 * A note's outline: a rounded rectangle whose corner radii are drawn from
 * the seed (16 ± 4.5 px, as in Line Lab), clamped so small notes stay
 * closed shapes.
 */
export function noteOutlinePts(w: number, h: number, seed: number): Pt[] {
  const r = rng(seed * 101 + 3)
  const cap = Math.max(0, Math.min(w, h) / 2)
  const rad = (): number => Math.min(cap, 16 + (r() - 0.5) * 9)
  return roundedRectPts(w, h, [rad(), rad(), rad(), rad()])
}

// ---------- the shaped line ----------

/**
 * Resample `raw`, then give every point its normal, cornerness and wobble
 * (Line Lab's `shape`). The result is in the input's units, which for the
 * app are the card's world px.
 */
export function inkShape(
  raw: readonly Pt[],
  closed: boolean,
  seed: number,
  opts: ShapeOptions = {},
  line: LineValues = LOOK.line,
): InkShape {
  const { pts, L } = resample(raw, closed, opts.step ?? 2)
  const n = pts.length
  const at = (i: number): Pt => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))])
  const bumps = closed ? line.wobbleBumpsPerLoop : Math.max(1, Math.round((line.wobbleBumpsPerLoop * L) / 900))
  const wob = makeNoise(seed * 7 + 1, bumps, 1)
  const wid = makeNoise(seed * 13 + 5, Math.max(3, bumps * 3), 2)

  const curv: number[] = []
  for (let i = 0; i < n; i++) {
    const a = at(i - 2)
    const b = at(i)
    const c = at(i + 2)
    const a1 = Math.atan2(b.y - a.y, b.x - a.x)
    const a2 = Math.atan2(c.y - b.y, c.x - b.x)
    let d = a2 - a1
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    const ds = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y) || 1
    curv.push(!closed && (i < 2 || i > n - 3) ? 0 : Math.abs(d) / ds)
  }
  const R = 4
  const cornerK = opts.cornerRadius ?? 14
  const corner = curv.map((_, i) => {
    let s = 0
    for (let j = -R; j <= R; j++) {
      const k = closed ? (i + j + n) % n : Math.max(0, Math.min(n - 1, i + j))
      s += curv[k]
    }
    return Math.min(1, (s / (2 * R + 1)) * cornerK)
  })

  const wobble = line.wobblePx * (opts.wobbleScale ?? 1)
  const out: InkPoint[] = []
  for (let i = 0; i < n; i++) {
    const a = at(i - 1)
    const c = at(i + 1)
    let tx = c.x - a.x
    let ty = c.y - a.y
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    const t = i / (closed ? n : n - 1)
    const off = wob(t) * wobble * (closed ? 1 : Math.sin(Math.PI * t) * 0.6 + 0.4)
    const nx = -ty
    const ny = tx
    out.push({ x: pts[i].x + nx * off, y: pts[i].y + ny * off, nx, ny, t, corner: corner[i], wv: wid(t) })
  }
  return { pts: out, closed, L }
}

// ---------- the selection wave and the grow mask ----------

/** Offset along the normal, in world px, at position t. */
export type Wave = (t: number) => number

/**
 * The one selection wave (Line Lab's `loopWave`). `scale` is this loop's
 * length over a note outline's, so a shorter loop (the red dot, the circle)
 * gets fewer waves of the same size. Wave counts stay whole, so a closed
 * loop meets itself without a seam at any time.
 */
export function loopWave(scale: number, nowMs: number, amp = 1, waves: WaveValues = LOOK.selectionWaves): Wave {
  const n = Math.max(1, Math.round(waves.wavesPerLoop * scale))
  let m = Math.max(1, Math.round((waves.wavesPerLoop + 3) * scale))
  if (m === n) m = n + 1
  const tm = (nowMs / 1000) * waves.speed
  const h = waves.heightPx * amp
  const meet = waves.counterWave
  return (t) => {
    let v = Math.sin(2 * Math.PI * (n * t - tm))
    if (meet) v = (v + 0.6 * Math.sin(2 * Math.PI * (m * t + tm * 0.7))) / 1.6
    return v * h
  }
}

/**
 * Which part of a loop the blue has reached at grow amount `g` (0..1): it
 * grows both ways from `fromT`, each side at its own seeded speed, and
 * covers the loop exactly at g = 1. Null means none of it.
 */
export function blueReach(g: number, fromT: number, seed: number): ((t: number) => boolean) | null {
  if (!(g > 0)) return null
  if (g >= 1) return () => true
  const fL = 1 + hash(seed + 11) * 0.4
  const fR = 1 + hash(seed + 17) * 0.4
  const rL = 0.5 * Math.min(1, g * fL)
  const rR = 0.5 * Math.min(1, g * fR)
  return (t) => {
    let d = t - fromT
    if (d > 0.5) d -= 1
    if (d < -0.5) d += 1
    return d >= 0 ? d <= rR : -d <= rL
  }
}

/** The point of a shape nearest to (x, y), as its t (where a click lands). */
export function nearestT(shape: InkShape, x: number, y: number): number {
  let best = 0
  let bd = Infinity
  for (const p of shape.pts) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < bd) {
      bd = d
      best = p.t
    }
  }
  return best
}

// ---------- the filled outline path ----------

export interface PathOptions {
  /** Line weight in world px (default: the tuned 1 px). */
  readonly weight?: number
  /** Seeds the edge grain. */
  readonly seed?: number
  readonly wave?: Wave | null
  /** Keep only segments whose starting t passes (the grow mask). */
  readonly filter?: ((t: number) => boolean) | null
  readonly line?: LineValues
}

const CAP_STEPS = 6

const fmt = (v: number): string => (Math.round(v * 100) / 100).toString()

/**
 * One SVG path `d` for the filled outline of `shape`. A whole closed loop
 * is two rings (the outer side, then the inner side reversed, so the
 * nonzero fill leaves the middle empty). Anything else, an open line or
 * the parts of a loop a filter keeps, is one closed shape per run: one
 * side forward, a round cap, the other side back, a round cap.
 */
export function inkPath(shape: InkShape, opts: PathOptions = {}): string {
  const pts = shape.pts
  const n = pts.length
  if (n < 2) return ''
  const line = opts.line ?? LOOK.line
  const weight = opts.weight ?? line.weightPx
  const seed = opts.seed ?? 0
  const wave = opts.wave ?? null
  const filter = opts.filter ?? null

  // Centre points (with the wave) and half-widths, as Line Lab's widthAt.
  const cx = new Float64Array(n)
  const cy = new Float64Array(n)
  const hw = new Float64Array(n)
  const wVar = line.widthVariationPct / 100
  const swell = line.cornerSwellPct / 100
  const grain = (line.edgeGrainPct / 100) * 0.45
  const floor = weight * 0.25
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const w = wave ? wave(p.t) : 0
    cx[i] = p.x + p.nx * w
    cy[i] = p.y + p.ny * w
    const width = weight * (1 + wVar * p.wv) * (1 + swell * p.corner) * (1 + grain * (hash(i * 31 + seed) * 2 - 1))
    hw[i] = Math.max(floor, width) / 2
  }

  const segs = shape.closed ? n : n - 1
  if (shape.closed && !filter) return ring(pts, cx, cy, hw)

  // Runs of kept segments; a run of segments s..e spans points s..e+1.
  const keep = (i: number): boolean => !filter || filter(pts[i].t)
  const runs: [number, number][] = []
  if (shape.closed) {
    let start = -1
    for (let i = 0; i < segs; i++) if (!keep(i)) start = i
    if (start < 0) return ring(pts, cx, cy, hw)
    // Walk once around from just after a dropped segment, so a run that
    // crosses the seam stays one run.
    let runStart = -1
    for (let k = 1; k <= segs; k++) {
      const i = (start + k) % segs
      if (keep(i)) {
        if (runStart < 0) runStart = k
      } else if (runStart >= 0) {
        runs.push([start + runStart, start + k - 1])
        runStart = -1
      }
    }
  } else {
    let runStart = -1
    for (let i = 0; i <= segs; i++) {
      if (i < segs && keep(i)) {
        if (runStart < 0) runStart = i
      } else if (runStart >= 0) {
        runs.push([runStart, i - 1])
        runStart = -1
      }
    }
  }

  let d = ''
  for (const [s, e] of runs) {
    const idx: number[] = []
    for (let k = s; k <= e + 1; k++) idx.push(k % n)
    d += stroke(pts, cx, cy, hw, idx)
  }
  return d
}

function ring(pts: readonly InkPoint[], cx: Float64Array, cy: Float64Array, hw: Float64Array): string {
  const n = pts.length
  let outer = ''
  let inner = ''
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    outer += (i ? 'L' : 'M') + fmt(cx[i] + p.nx * hw[i]) + ' ' + fmt(cy[i] + p.ny * hw[i])
  }
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i]
    inner += (i === n - 1 ? 'M' : 'L') + fmt(cx[i] - p.nx * hw[i]) + ' ' + fmt(cy[i] - p.ny * hw[i])
  }
  return outer + 'Z' + inner + 'Z'
}

/** One run as a closed shape: side A forward, end cap, side B back, start cap. */
function stroke(
  pts: readonly InkPoint[],
  cx: Float64Array,
  cy: Float64Array,
  hw: Float64Array,
  idx: readonly number[],
): string {
  let d = ''
  const m = idx.length
  for (let k = 0; k < m; k++) {
    const i = idx[k]
    d += (k ? 'L' : 'M') + fmt(cx[i] + pts[i].nx * hw[i]) + ' ' + fmt(cy[i] + pts[i].ny * hw[i])
  }
  d += cap(pts[idx[m - 1]], cx[idx[m - 1]], cy[idx[m - 1]], hw[idx[m - 1]], 1)
  for (let k = m - 1; k >= 0; k--) {
    const i = idx[k]
    d += 'L' + fmt(cx[i] - pts[i].nx * hw[i]) + ' ' + fmt(cy[i] - pts[i].ny * hw[i])
  }
  d += cap(pts[idx[0]], cx[idx[0]], cy[idx[0]], hw[idx[0]], -1)
  return d + 'Z'
}

/**
 * A round cap from the +normal side to the -normal side (dir 1, around the
 * front) or back (dir -1, around the start). Drawn as a short polyline, so
 * there's no arc-flag bookkeeping.
 */
function cap(p: InkPoint, x: number, y: number, r: number, dir: 1 | -1): string {
  // Tangent is the normal turned back a quarter: n = (-ty, tx) → t = (ny, -nx).
  const tx = p.ny
  const ty = -p.nx
  const sx = dir === 1 ? p.nx : -p.nx
  const sy = dir === 1 ? p.ny : -p.ny
  const fx = dir === 1 ? tx : -tx
  const fy = dir === 1 ? ty : -ty
  let d = ''
  for (let k = 1; k < CAP_STEPS; k++) {
    const a = (k / CAP_STEPS) * Math.PI
    const c = Math.cos(a)
    const s = Math.sin(a)
    d += 'L' + fmt(x + r * (sx * c + fx * s)) + ' ' + fmt(y + r * (sy * c + fy * s))
  }
  return d
}

/**
 * The area inside a closed shape, as one polygon `d` through its wobbled
 * centre line: the note's paper fill and the hover bloom's clip, so both
 * follow the pencil outline instead of a CSS rounded rectangle.
 */
export function fillPath(shape: InkShape): string {
  let d = ''
  shape.pts.forEach((p, i) => {
    d += (i ? 'L' : 'M') + fmt(p.x) + ' ' + fmt(p.y)
  })
  return d ? d + 'Z' : ''
}
