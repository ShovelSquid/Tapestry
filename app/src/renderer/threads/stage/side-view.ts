/**
 * The side view — the whole thread left to right, honest about every gap
 * (D-15..D-19, D-27; ROADMAP Phase 2.3 Success Criterion 6; spike 001
 * thread.js:632-657 "side" branch, quoted in 02.3-07-PLAN.md's interfaces
 * block).
 *
 * Ports the orthographic branch's extents and uniforms from the spike
 * verbatim — `uPixelScale = (2 * half) / innerWidth`, `uFadeOn = 0`,
 * `uSideGlyphPx = 14` — but never its camera basis. The spike predates D-27
 * and fixes the side camera's eye, up and look-at target each to a literal
 * world-space triple, against an implicit fixed thread axis of world
 * `(0, 0, -1)`. D-27 makes that axis an explicit per-thread property
 * (`origin`, `direction`, `roll`), read through `parseThreadFrame`, and
 * ROADMAP Success Criterion 6 requires **both** the live and side cameras to
 * derive their basis from the thread's own stored frame — `live-view.ts`
 * already does this for the live camera (Plan 04); this module reuses the
 * identical reasoning for the side camera.
 *
 * The eye is built as an offset in the thread's own (right, up, forward)
 * basis rather than a raw world-space triple: `forward` is the stored
 * `direction`, `right`/`up` are derived from it and rotated by `roll`, the
 * eye sits at `origin + right * SIDE_EYE_DISTANCE`, and the camera looks at
 * `origin` with `up` as its own up vector. At the D-27 default
 * (`origin 0 0 0`, `direction 0 0 -1`, `roll 0`) this reduces — by
 * construction, not by coincidence — to exactly the spike's own numbers:
 * `right` comes out as world +x, so the eye lands 10 world units out along
 * +x, and `up` comes out as world +y. Every thread in this phase renders on
 * that default, so this generalization carries no visual risk (CONTEXT.md
 * D-27).
 *
 * A consequence worth stating plainly: the camera's own screen-right axis
 * always equals the thread's `direction` (a short proof from the basis
 * construction above — rotating `right`/`up` together by `roll` around
 * `forward` leaves `cross(up, right) = forward` invariant). That is what
 * makes `timeToScreenX`/`screenXToTime` below simple, exact linear maps with
 * no dependency on `roll`.
 *
 * The view centre (`centerSeconds`) is float64 on the CPU and reaches the
 * shader only through `setOrigin`'s hour-block split — the whole D-16
 * week-scale precision mechanism (RESEARCH Pattern 5): float32 represents
 * integers exactly only to 2^24, so a raw two-week offset would quantise
 * into visibly clumped dots without this recentering.
 */

import * as THREE from 'three'
import type { ThreadFrame } from '../../../shared/threads/settings'
import { setOrigin, setThreadFrame, SPEED, type StageUniforms } from './ribbon'

// Ported verbatim from spike 001 thread.js:655 — the side view's fixed
// screen-space glyph legibility gate threshold (glyphs.ts's `uSideGlyphPx`
// branch). A data/legibility constant, never a camera-basis literal.
const SIDE_GLYPH_LEGIBILITY_PX = 14

// The spike's own side-camera distance from the thread's origin, along the
// perpendicular ("right") axis (thread.js:649 places the ortho camera 10
// world units out along the default right axis). Kept as a plain scalar
// distance: the actual eye position below is computed as
// `origin + right * SIDE_EYE_DISTANCE` from the thread's own D-27 basis,
// never assigned to the camera as a literal world-space triple.
const SIDE_EYE_DISTANCE = 10

const SIDE_NEAR = 0.1
const SIDE_FAR = 1000

/** D-17: zoom spans continuously from about 1.1x the thread's total
 * duration down to 0.5s across the view (single dots), clamped at both
 * ends. */
export const SIDE_MIN_SPAN_SECONDS = 0.5
export const SIDE_ZOOM_DURATION_FACTOR = 1.1

/**
 * Clamps a candidate zoom span (seconds of thread time across the full view
 * width) to `[0.5s, 1.1 * threadDurationSeconds]` — shared by `SideView`'s
 * own `setView` and by `navigation.ts`'s `zoomStep`, so a wheel zoom and a
 * `+`/`-` keypress can never disagree about the limit.
 */
export function clampSpanSeconds(span: number, threadDurationSeconds: number): number {
  const maxSpan = Math.max(SIDE_MIN_SPAN_SECONDS, threadDurationSeconds * SIDE_ZOOM_DURATION_FACTOR)
  if (!Number.isFinite(span) || span <= 0) return SIDE_MIN_SPAN_SECONDS
  return Math.min(maxSpan, Math.max(SIDE_MIN_SPAN_SECONDS, span))
}

/**
 * The view centre (absolute thread-time seconds) that keeps `atSeconds`
 * projected at the same screen-space x coordinate (`pointerXPx`, in a view
 * `widthPx` wide) after the span changes to `newSpanSeconds` — the "zoom
 * around the focused point" arithmetic the wheel handler and `+`/`-` both
 * need (UI-SPEC "Side view read-back").
 */
export function centerForZoomAroundScreenX(
  pointerXPx: number,
  widthPx: number,
  atSeconds: number,
  newSpanSeconds: number,
): number {
  if (widthPx <= 0) return atSeconds
  return atSeconds - newSpanSeconds * ((pointerXPx - widthPx / 2) / widthPx)
}

function referenceUp(forward: THREE.Vector3): THREE.Vector3 {
  return Math.abs(forward.y) > 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
}

interface ThreadBasis {
  origin: THREE.Vector3
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
}

/**
 * Builds the same orthonormal (right, up, forward) basis `live-view.ts`'s
 * own (private) `threadBasis` does, from the identical `ThreadFrame` shape.
 * Duplicated rather than imported — `live-view.ts` exports no such helper,
 * it is a private detail of that module's own camera derivation — and both
 * modules independently reduce to the spike's validated numbers at the D-27
 * default, which this file's own header derivation proves for the side
 * camera specifically.
 */
function threadBasis(frame: ThreadFrame): ThreadBasis {
  const origin = new THREE.Vector3(frame.origin.x, frame.origin.y, frame.origin.z)
  const forward = new THREE.Vector3(frame.direction.x, frame.direction.y, frame.direction.z).normalize()
  const worldUp = referenceUp(forward)
  const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize()
  const up = new THREE.Vector3().crossVectors(right, forward).normalize()

  if (frame.roll !== 0) {
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(forward, THREE.MathUtils.degToRad(frame.roll))
    right.applyQuaternion(rollQuat)
    up.applyQuaternion(rollQuat)
  }

  return { origin, forward, right, up }
}

/**
 * The D-15..D-19 side view: an orthographic camera looking at the thread
 * from the side, perpendicular to its stored `direction` (D-27), with
 * continuous zoom and a float64 view centre.
 */
export class SideView {
  readonly camera: THREE.OrthographicCamera
  private readonly uniforms: StageUniforms
  private basis: ThreadBasis = {
    origin: new THREE.Vector3(0, 0, 0),
    forward: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
  }
  private width = 1
  private height = 1
  private _centerSeconds = 0
  private _spanSeconds = 60

  constructor(uniforms: StageUniforms) {
    this.uniforms = uniforms
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, SIDE_NEAR, SIDE_FAR)
  }

  get centerSeconds(): number {
    return this._centerSeconds
  }

  get spanSeconds(): number {
    return this._spanSeconds
  }

  /** Repositions the camera from the thread's own stored frame (D-27) —
   * call once when the side view opens, and again only if the thread's
   * frame itself changes (a later anchor-cursor phase's concern; every
   * thread in this plan keeps the D-27 default for its whole life). */
  applyFrame(frame: ThreadFrame): void {
    setThreadFrame(this.uniforms, frame)
    this.basis = threadBasis(frame)
    this.updateCamera()
  }

  /** Updates the camera's aspect ratio for a resized stage area. */
  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.updateCamera()
  }

  /**
   * Sets the view centre (absolute thread-time seconds) and zoom span
   * (seconds of thread time across the full view width), clamped via
   * `clampSpanSeconds`. Recentres the floating origin through `setOrigin`
   * (the D-16 precision mechanism) and rewrites the ortho frustum plus the
   * `uPixelScale`/`uFadeOn`/`uSideGlyphPx` uniforms (spike 001
   * thread.js:642-656, ported verbatim; never the camera basis).
   */
  setView(centerSeconds: number, spanSeconds: number, threadDurationSeconds: number): void {
    this._centerSeconds = centerSeconds
    this._spanSeconds = clampSpanSeconds(spanSeconds, threadDurationSeconds)
    setOrigin(this.uniforms, centerSeconds)
    // The side view centres on a fixed point in (possibly past) thread
    // time, not "now" — relative to that centre, the centre itself is
    // rel 0, so uNowRel is always 0 while side-viewing (contrast
    // live-view.ts's tick(), which recenters on the live "now" every frame).
    this.uniforms.uNowRel.value = 0
    this.updateCamera()
  }

  private updateCamera(): void {
    const half = (this._spanSeconds * SPEED) / 2
    const halfHeight = (half * this.height) / this.width
    this.camera.left = -half
    this.camera.right = half
    this.camera.top = halfHeight
    this.camera.bottom = -halfHeight
    this.camera.updateProjectionMatrix()

    const eye = this.basis.origin.clone().addScaledVector(this.basis.right, SIDE_EYE_DISTANCE)
    this.camera.position.copy(eye)
    this.camera.up.copy(this.basis.up)
    this.camera.lookAt(this.basis.origin)

    this.uniforms.uOrtho.value = 1
    this.uniforms.uPixelScale.value = (2 * half) / this.width
    this.uniforms.uFadeOn.value = 0
    this.uniforms.uSideGlyphPx.value = SIDE_GLYPH_LEGIBILITY_PX
  }

  /**
   * Converts an absolute thread-time (seconds since the thread's own start)
   * to a screen-space x coordinate in CSS pixels, for DOM overlays that
   * must align with the drawn line (session pills, gap labels, the date
   * scrubber's accent bracket, click-to-open hit testing). Screen-right is
   * always the thread's own `direction` axis (this file's header proof), so
   * increasing thread time moves right — "the whole thread left (oldest) to
   * right (newest)" (D-15).
   */
  timeToScreenX(atSeconds: number): number {
    return this.width / 2 + ((atSeconds - this._centerSeconds) / this._spanSeconds) * this.width
  }

  /** Inverse of `timeToScreenX`: the absolute thread-time (seconds) under a
   * screen-space x coordinate. */
  screenXToTime(x: number): number {
    return this._centerSeconds + ((x - this.width / 2) / this.width) * this._spanSeconds
  }

  /** The new view centre after panning by `dxPixels` of pointer movement
   * (spike 001 thread.js:772's own drag arithmetic, generalized to any
   * span). Does not mutate state itself — the caller applies it via
   * `setView`, the same way every other navigation action does. */
  panByPixels(dxPixels: number): number {
    return this._centerSeconds - (dxPixels / this.width) * this._spanSeconds
  }
}
