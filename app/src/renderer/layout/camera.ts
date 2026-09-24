/**
 * The canvas camera -- pure functions and one small class, no React, no DOM.
 *
 * Input never moves the screen directly. It moves a *target* camera, and a
 * *drawn* camera follows the target with frame-rate independent exponential
 * smoothing (02.6-3D-FRAMES.md section 4, "The camera eases toward its
 * target"). The screen, and every hit test, always uses the drawn camera, so a
 * click lands where the content appears.
 *
 * Direct manipulation is never eased. A pointer drag or a two-finger pan
 * changes target and drawn together, because lag under the hand feels like
 * the app fighting you (spike 011). Only wheel notches, pinch, flies and roll
 * glide.
 *
 * The ease moves along the similarity geodesic between the drawn and target
 * transforms rather than easing pan, zoom and roll independently. When only
 * pan differs this is exactly a linear ease. When zoom or roll also differ,
 * the one point both transforms share -- the cursor anchor of a zoom, the
 * centre of a roll -- stays fixed on screen for the whole ease, not only at
 * the end. Easing pan linearly beside a log-space zoom would let that anchor
 * wander by hundreds of pixels during a burst of wheel notches. Zoom still
 * eases exactly in log space and roll along the shortest arc.
 *
 * The camera is view state only: nothing here is written to a tree or to
 * settings. At roll 0 every function reproduces the old canvas formulas bit
 * for bit, so an unrolled canvas is drawn exactly as before.
 */

import { clampZoom } from './wheel'

// ---------------------------------------------------------------------------
// Camera and constants
// ---------------------------------------------------------------------------

/**
 * A 2D view: `screen = R(roll) * (world * zoom) + pan`, in viewport-relative
 * screen pixels. `roll` is in degrees, normalised to (-180, 180], and positive
 * turns the canvas clockwise on screen, like CSS `rotate`.
 */
export interface Camera {
  readonly panX: number
  readonly panY: number
  readonly zoom: number
  readonly roll: number
}

export const IDENTITY_CAMERA: Camera = { panX: 0, panY: 0, zoom: 1, roll: 0 }

/** Wheel notches and pinch ticks. */
export const ZOOM_TAU_MS = 70
/** Programmatic flights, such as centring a newly added tree. */
export const FLY_TAU_MS = 200
/** Roll input and the soft quarter-turn snap. */
export const ROLL_TAU_MS = 80

/** Settled when the pan is within half a pixel of the target... */
export const SETTLE_PAN_PX = 0.5
/** ...the zoom within 0.05 % (half a pixel at 1000 px from the anchor)... */
export const SETTLE_ZOOM_REL = 5e-4
/** ...and the roll within 0.05 degrees. */
export const SETTLE_ROLL_DEG = 0.05

const DEG = Math.PI / 180

// ---------------------------------------------------------------------------
// Roll arithmetic
// ---------------------------------------------------------------------------

/**
 * Wraps an angle in degrees into (-180, 180]. Values already in range come
 * back untouched so that exact values, 0 above all, stay exact.
 */
export function normalizeRoll(deg: number): number {
  if (deg > -180 && deg <= 180) return deg
  if (!Number.isFinite(deg)) return deg
  let r = ((deg % 360) + 360) % 360
  if (r > 180) r -= 360
  return r
}

/** The signed turn, in degrees, from `from` to `to` the short way round. */
export function shortestRollDelta(from: number, to: number): number {
  return normalizeRoll(to - from)
}

/** Rotates a vector by `deg` degrees (clockwise on screen). Exact at 0. */
function rotate(x: number, y: number, deg: number): { x: number; y: number } {
  if (deg === 0) return { x, y }
  const c = Math.cos(deg * DEG)
  const s = Math.sin(deg * DEG)
  return { x: c * x - s * y, y: s * x + c * y }
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/** World to viewport-relative screen coordinates. */
export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  const r = rotate(wx * cam.zoom, wy * cam.zoom, cam.roll)
  return { x: r.x + cam.panX, y: r.y + cam.panY }
}

/**
 * Viewport-relative screen coordinates to world coordinates: the exact
 * inverse of worldToScreen. The caller subtracts the viewport's left and top.
 */
export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  const r = rotate(sx - cam.panX, sy - cam.panY, -cam.roll)
  return { x: r.x / cam.zoom, y: r.y / cam.zoom }
}

/**
 * A screen-pixel movement as a world-space movement, for drags and resizes:
 * screenToWorld without the pan.
 */
export function screenDeltaToWorld(
  dx: number,
  dy: number,
  zoom: number,
  roll: number,
): { x: number; y: number } {
  const r = rotate(dx, dy, -roll)
  return { x: r.x / zoom, y: r.y / zoom }
}

/** The CSS transform for the canvas container, used with transform-origin 0 0. */
export function cameraTransformCss(cam: Camera): string {
  if (cam.roll === 0) return `translate(${cam.panX}px, ${cam.panY}px) scale(${cam.zoom})`
  return `translate(${cam.panX}px, ${cam.panY}px) rotate(${cam.roll}deg) scale(${cam.zoom})`
}

export function isFiniteCamera(cam: Camera): boolean {
  return (
    Number.isFinite(cam.panX) &&
    Number.isFinite(cam.panY) &&
    Number.isFinite(cam.zoom) &&
    Number.isFinite(cam.roll) &&
    cam.zoom > 0
  )
}

// ---------------------------------------------------------------------------
// Camera changes
// ---------------------------------------------------------------------------

export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { ...cam, panX: cam.panX + dx, panY: cam.panY + dy }
}

/**
 * Zoom by `factor` (clamped to [minZoom, maxZoom]) keeping the world point
 * under (sx, sy) fixed. The rotation cancels out of the anchor equation, so
 * this is the old formula at every roll.
 */
export function zoomAbout(
  cam: Camera,
  factor: number,
  sx: number,
  sy: number,
  minZoom: number,
  maxZoom: number,
): Camera {
  const zoom = clampZoom(cam.zoom * factor, minZoom, maxZoom)
  const ratio = zoom / cam.zoom
  return {
    panX: sx - ratio * (sx - cam.panX),
    panY: sy - ratio * (sy - cam.panY),
    zoom,
    roll: cam.roll,
  }
}

/** Pan so the world point (wx, wy) sits at the viewport's centre. */
export function centerOn(
  cam: Camera,
  wx: number,
  wy: number,
  viewportW: number,
  viewportH: number,
): Camera {
  const r = rotate(wx * cam.zoom, wy * cam.zoom, cam.roll)
  return { ...cam, panX: viewportW / 2 - r.x, panY: viewportH / 2 - r.y }
}

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

/** Complex exp(z) - 1, accurate when z is small. */
function cexpm1(re: number, im: number): { re: number; im: number } {
  const e = Math.exp(re)
  const sinHalf = Math.sin(im / 2)
  return {
    re: Math.expm1(re) * Math.cos(im) - 2 * sinHalf * sinHalf,
    im: e * Math.sin(im),
  }
}

/**
 * One frame of the ease from `drawn` toward `target`.
 *
 * k = 1 - exp(-dt / tau), so the fraction of the remaining distance covered
 * depends only on elapsed time, never on the frame rate. Each camera is the
 * complex similarity `a*w + b` with `a = zoom * e^(i*roll)` and `b = pan`.
 * The relative move M(s) = m*s + c, with m = a_target / a_drawn, is taken to
 * the power k: zoom by zr^k (log space), roll by k*droll (shortest arc) and
 * pan by m^k * b + (1 - m^k) / (1 - m) * c. M's fixed point -- the zoom
 * anchor or roll centre -- therefore stays put on screen throughout, and a
 * pure translation reduces to the linear ease b + k * (b_target - b).
 */
export function step(
  drawn: Camera,
  target: Camera,
  dtMs: number,
  tauMs: number,
): { camera: Camera; settled: boolean } {
  if (tauMs <= 0 || !isFiniteCamera(drawn)) return { camera: { ...target }, settled: true }
  if (isSettledAt(drawn, target)) return { camera: { ...target }, settled: true }

  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs)
  const dRoll = shortestRollDelta(drawn.roll, target.roll)

  // L = log m = ln(zr) + i*dtheta; m^k = e^(kL).
  const lRe = Math.log(target.zoom / drawn.zoom)
  const lIm = dRoll * DEG
  const mk1 = cexpm1(k * lRe, k * lIm) // m^k - 1
  const m1 = cexpm1(lRe, lIm) // m - 1

  // f = (1 - m^k) / (1 - m) = (m^k - 1) / (m - 1), or k in the limit m -> 1.
  let fRe = k
  let fIm = 0
  if (lRe !== 0 || lIm !== 0) {
    const den = m1.re * m1.re + m1.im * m1.im
    if (den > 1e-24) {
      fRe = (mk1.re * m1.re + mk1.im * m1.im) / den
      fIm = (mk1.im * m1.re - mk1.re * m1.im) / den
    }
  }

  // c = b_target - m * b_drawn, and b' = m^k * b_drawn + f * c.
  const mRe = m1.re + 1
  const mIm = m1.im
  const cRe = target.panX - (mRe * drawn.panX - mIm * drawn.panY)
  const cIm = target.panY - (mRe * drawn.panY + mIm * drawn.panX)
  const mkRe = mk1.re + 1
  const mkIm = mk1.im

  const next: Camera = {
    panX: mkRe * drawn.panX - mkIm * drawn.panY + (fRe * cRe - fIm * cIm),
    panY: mkRe * drawn.panY + mkIm * drawn.panX + (fRe * cIm + fIm * cRe),
    zoom: drawn.zoom * Math.exp(k * lRe),
    roll: normalizeRoll(drawn.roll + k * dRoll),
  }

  if (isSettledAt(next, target)) return { camera: { ...target }, settled: true }
  return { camera: next, settled: false }
}

function isSettledAt(cam: Camera, target: Camera): boolean {
  return (
    Math.hypot(target.panX - cam.panX, target.panY - cam.panY) < SETTLE_PAN_PX &&
    Math.abs(target.zoom / cam.zoom - 1) < SETTLE_ZOOM_REL &&
    Math.abs(shortestRollDelta(cam.roll, target.roll)) < SETTLE_ROLL_DEG
  )
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a.panX === b.panX && a.panY === b.panY && a.zoom === b.zoom && a.roll === b.roll
}

// ---------------------------------------------------------------------------
// CameraRig
// ---------------------------------------------------------------------------

/**
 * A target camera and the drawn camera chasing it.
 *
 * `direct` is the hand: it moves both cameras at once, so the drawn camera
 * stays 1:1 under the pointer and any ease in progress carries on relative to
 * it. `hold` is a grab: the target becomes whatever is drawn, which stops an
 * ease where it is. `easeTo` moves only the target and lets `tick` glide the
 * drawn camera after it, at the tau of the most recent eased input.
 */
export class CameraRig {
  protected _target: Camera
  protected _drawn: Camera
  protected _tau = 0

  constructor(initial: Camera) {
    this._target = { ...initial }
    this._drawn = { ...initial }
  }

  get target(): Camera {
    return this._target
  }

  get drawn(): Camera {
    return this._drawn
  }

  get tau(): number {
    return this._tau
  }

  /** True when the drawn camera has reached the target. */
  get settled(): boolean {
    return sameCamera(this._drawn, this._target)
  }

  /** Direct manipulation: the same change to target and drawn, never eased. */
  direct(change: (c: Camera) => Camera): void {
    const target = change(this._target)
    const drawn = change(this._drawn)
    if (!isFiniteCamera(target) || !isFiniteCamera(drawn)) return
    this._target = target
    this._drawn = drawn
    this.onHand()
  }

  /** A grab: stop any ease where it is drawn. */
  hold(): void {
    this._target = { ...this._drawn }
    this.onHand()
  }

  /**
   * Move the target, computed against the target (so a burst of wheel notches
   * stays anchored), and glide toward it at `tauMs`. A change that yields a
   * non-finite camera is ignored, so a bad delta cannot spin the loop forever.
   */
  easeTo(change: (c: Camera) => Camera, tauMs: number): boolean {
    const next = change(this._target)
    if (!isFiniteCamera(next)) return false
    this._target = next
    this._tau = tauMs
    return true
  }

  /**
   * Advance the drawn camera by one frame. Returns true while another frame
   * is needed, so the caller's animation loop stops and the page idles once
   * the camera has arrived.
   */
  tick(nowMs: number, dtMs: number): boolean {
    this.beforeStep(nowMs)
    if (this.settled) return this.pending()
    const out = step(this._drawn, this._target, dtMs, this._tau)
    this._drawn = out.camera
    return !out.settled || this.pending()
  }

  /** Hook: the hand has taken over (direct or hold). */
  protected onHand(): void {}

  /** Hook: runs at the start of each tick, before the drawn camera moves. */
  protected beforeStep(_nowMs: number): void {}

  /** Hook: true while something (such as a snap) still needs frames. */
  protected pending(): boolean {
    return false
  }
}
