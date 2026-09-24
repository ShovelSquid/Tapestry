/**
 * input.ts — the deterministic fence (CANV-02; the surface half of STRK-01
 * and STRK-06).
 *
 * Everything to the left of this file is floats and browser objects;
 * everything to the right is integers the Worker records forever. The fence
 * is a native pointer listener on the surface canvas with pointer capture
 * and touch-action none. It accepts a pen with the tip down (or the mouse
 * when the setting allows it), records every coalesced sample, hands the
 * predicted samples to the preview only, unprojects each sample through
 * rayPlane against the fixed camera and quantizes it exactly once. No
 * timestamp is read: the Worker stamps (tick, index) at record time (01-07).
 *
 * PEN_FACTS holds what the measurement overlay (measure.ts) actually saw on
 * this Mac. Read its header comment before trusting any pen-specific number.
 */
import { FIXED_CAMERA } from './camera'
import { Q16_ONE, rayPlane, type PlaneFrame } from './plane'

export { Q16_ONE }

// ---------------------------------------------------------------------------
// Measured facts
// ---------------------------------------------------------------------------

/**
 * PEN_FACTS — the numbers the fence is built from, measured 2026-09-24 in
 * the Tapestry dev build (Electron 32, Chromium 128) on this Mac with the
 * PenMeasure overlay: 4 strokes, 605 coalesced samples.
 *
 * MEASURED WITH A MOUSE, NOT A PEN. The Mac was reachable only through a
 * game-streaming session (Apollo / Moonlight from a PC), so every pointer
 * arrived as pointerType 'mouse'; no tablet was attached to the Mac (Wacom
 * driver 6.4.13-4 installed and idle, no tablet detected by macOS). Kaelen
 * accepted this measurement so painting can proceed over the stream and
 * recorded a pen re-measurement as an open item.
 *
 * Consequently every PEN-SPECIFIC field below is a PROVISIONAL placeholder:
 * pressure range and distinct count, tilt presence and sign, twist, and the
 * eraser buttons all reflect a pressure-less mouse. Fields tagged [ASSUMED]
 * are NOT measurements: they are the W3C / RESEARCH expectations the fence
 * uses until a real pen is attached to this Mac (or a Windows build exists)
 * and the overlay is run again. Every [MEASURED] field is verbatim from the
 * overlay JSON quoted in 01-06-SUMMARY.md.
 */
export const PEN_FACTS = {
  measuredOn: '2026-09-24', // [MEASURED] the date of the overlay run (Tapestry dev build, Electron 32)
  measuredWith: 'mouse', // [MEASURED] pointerTypesOnDown was ["mouse"] — no pen reached the surface
  penModel: 'none attached (input via Apollo/Moonlight streaming client)', // [MEASURED] see header
  driverVersion: 'Wacom 6.4.13-4 installed, no tablet detected', // [MEASURED] see header
  isPrimary: true, // [MEASURED] isPrimary: [true]
  pressureMin: 0.5, // [MEASURED] pressure.min — the W3C no-sensor value while a button is down
  pressureMax: 0.5, // [MEASURED] pressure.max — PROVISIONAL, a pen is expected to reach ~1.0
  pressureDistinct: 1, // [MEASURED] pressure.distinct — PROVISIONAL, a pen is expected in the hundreds+
  tiltSeen: false, // [MEASURED] tilt.seen — PROVISIONAL, never reported by a mouse
  tiltXSign: 0, // [MEASURED] tilt.xSign (0 = never seen); mapping below stays identity
  tiltYSign: 0, // [MEASURED] tilt.ySign (0 = never seen); mapping below stays identity
  tiltMaxAbs: 0, // [MEASURED] tilt.maxAbs
  twistSeen: false, // [MEASURED] twist.seen — PROVISIONAL
  twistMax: 0, // [MEASURED] twist.max
  eraserButtons: null as number | null, // [MEASURED] never seen — PROVISIONAL; the fence uses ERASER_BUTTONS below
  coalescedPerSecond: 216, // [MEASURED] peak coalesced samples / s over the streaming mouse (well above 60)
  predictedPerMoveMin: 0, // [MEASURED] predictedPerMove.min
  predictedPerMoveMax: 10, // [MEASURED] predictedPerMove.max — predicted events are preview-only
  rawUpdatePerSecond: 250, // [MEASURED] pointerrawupdate fires in this document at ~250 / s
  isSecureContext: true, // [MEASURED] tapestry-plugin:// is a secure context (pointerrawupdate available)
  crossOriginIsolated: false, // [MEASURED] no shared memory available; snapshots stay transferred ArrayBuffers
  gpu: true, // [MEASURED] navigator.gpu present (WebGPU path for 01-07)
  strokes: 4, // [MEASURED] pointerdowns on the stage during the run
  samples: 605, // [MEASURED] coalesced samples ingested
  expectedTiltXSignRightward: 1, // [ASSUMED] W3C / RESEARCH: tilting toward screen right gives tiltX > 0
  expectedTiltYSignTopward: -1, // [ASSUMED] W3C: tiltY > 0 is toward the user, so a top-ward tilt is negative
  expectedEraserButtons: 32, // [ASSUMED] W3C button 5 / buttons 32; RESEARCH: Chromium macOS sets it for the eraser end
} as const

// ---------------------------------------------------------------------------
// Quantization constants (the sample wire record in ddsim state.hpp)
// ---------------------------------------------------------------------------

/**
 * Pressure full scale (u16). Provisional mirror of DD_PRESSURE_MAX: Phase 2
 * freezes 12 vs 16 bits from pressureDistinct, which the mouse measurement
 * could not supply (distinct = 1).
 */
export const PRESSURE_MAX = 65535
export const TILT_MAX = 90
export const TWIST_MOD = 360

/** flags bit0: tiltX / tiltY are real (DD_SAMPLE_FLAG_TILT). */
export const FLAG_TILT = 1
/** flags bit1: twist is real (DD_SAMPLE_FLAG_TWIST). */
export const FLAG_TWIST = 2
/** flags bit2: pressureSource, 0 = pen sensor, 1 = mouse / no sensor (DD_SAMPLE_FLAG_SOURCE). */
export const FLAG_SOURCE = 4

/**
 * The eraser end's `buttons` bit. [ASSUMED] until re-measured (see
 * PEN_FACTS): W3C assigns the pen eraser button 5 / buttons 32, and
 * RESEARCH found Chromium's macOS builder sets it for the eraser end with
 * bit 0 clear. The fence refuses the eraser end outright, so a driver that
 * set both bits still could not paint with it.
 */
export const ERASER_BUTTONS = 32

const I32_MIN = -2147483648
const I32_MAX = 2147483647

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Settings {
  /** Accept pointerType 'mouse' with the primary button down. */
  allowMouse: boolean
}

/**
 * Pen-only by design (CANV-02). The mouse is accepted by default ONLY while
 * PEN_FACTS was measured with a mouse: over the streaming session every
 * pointer is a mouse, so a false default would leave 01-07 / 01-08 with
 * nothing to paint with. Re-measuring with a real pen flips this back to
 * pen-only automatically. Recorded as a deviation in 01-06-SUMMARY.md.
 */
export const DEFAULT_SETTINGS: Settings = { allowMouse: PEN_FACTS.measuredWith === 'mouse' }

/** One quantized sample; every field is an integer. tick/index are stamped by the Worker (01-07). */
export interface RawSample {
  /** i32 Q16.16 plane units along frame.right. */
  u: number
  /** i32 Q16.16 plane units along frame.up. */
  v: number
  /** u16, 0..PRESSURE_MAX. */
  pressure: number
  /** i8 degrees, -90..90. */
  tiltX: number
  /** i8 degrees, -90..90. */
  tiltY: number
  /** u16 degrees, 0..359. */
  twist: number
  /** FLAG_TILT | FLAG_TWIST | FLAG_SOURCE. */
  flags: number
}

/** The subset of PointerEvent the fence reads; the event's timestamp is deliberately absent. */
export type PointerEventLike = Pick<
  PointerEvent,
  'pointerType' | 'buttons' | 'button' | 'pressure' | 'tiltX' | 'tiltY' | 'twist' | 'clientX' | 'clientY' | 'pointerId' | 'isPrimary'
> & {
  getCoalescedEvents?(): PointerEventLike[]
  getPredictedEvents?(): PointerEventLike[]
  preventDefault?(): void
}

export interface FenceCallbacks {
  /** A stroke opened: the pressure source and the plane frame captured once for the whole stroke. */
  onBegin(pressureSource: 0 | 1, frame: PlaneFrame): void
  /** Recorded samples, in delivery order; only ever built from coalesced (real) events. */
  onSamples(samples: RawSample[]): void
  /** The captured pointer went up, was cancelled, or lost capture. */
  onEnd(): void
  /** Predicted (guessed) plane points for the transient preview tail; never recorded. */
  onPreview(points: Array<{ u: number; v: number }>): void
}

export interface FenceDeps {
  /** The canvas size in CSS pixels, read once per dispatched event. */
  viewport(): { width: number; height: number }
  /** The plane frame, read once per stroke on pointerdown. */
  frame(): PlaneFrame
  /** Read on every pointerdown so a settings change applies to the next stroke. */
  settings(): Settings
  callbacks: FenceCallbacks
}

/** What the fence needs from the canvas; HTMLCanvasElement satisfies it, and so does a test fake. */
export interface FenceCanvas {
  style: { touchAction: string }
  addEventListener(type: string, listener: (ev: PointerEventLike) => void): void
  removeEventListener(type: string, listener: (ev: PointerEventLike) => void): void
  setPointerCapture(pointerId: number): void
  releasePointerCapture(pointerId: number): void
  hasPointerCapture?(pointerId: number): boolean
  getBoundingClientRect?(): { left: number; top: number }
}

// ---------------------------------------------------------------------------
// The boundary predicates and the quantizer
// ---------------------------------------------------------------------------

/**
 * True only for a pen with the tip down, or the mouse with the primary
 * button down when settings.allowMouse. Hover (buttons 0), the eraser end
 * (buttons & 32, whatever else is set), touch and every other button are
 * refused. Blink never sets bit 0 for the eraser end, but the fence checks
 * the eraser bit explicitly so a driver that did could not paint with it.
 */
export function paintable(ev: PointerEventLike, settings: Settings): boolean {
  const buttons = ev.buttons
  if ((buttons & 1) !== 1) return false
  if ((buttons & ERASER_BUTTONS) !== 0) return false
  if (ev.pointerType === 'pen') return true
  if (ev.pointerType === 'mouse') return settings.allowMouse
  return false
}

/** 1 for the mouse (pressure is the constant 0.5 by spec), 0 for a pen sensor. */
export function pressureSourceOf(ev: PointerEventLike): 0 | 1 {
  return ev.pointerType === 'mouse' ? 1 : 0
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function q16(x: number): number {
  const q = Math.round(x * Q16_ONE)
  if (Number.isNaN(q)) return 0
  return clamp(q, I32_MIN, I32_MAX)
}

function quantizePressure(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.round(clamp(p, 0, 1) * PRESSURE_MAX)
}

function quantizeTilt(t: number): number {
  if (!Number.isFinite(t)) return 0
  return clamp(Math.round(t), -TILT_MAX, TILT_MAX)
}

function quantizeTwist(t: number): number {
  if (!Number.isFinite(t)) return 0
  return ((Math.round(t) % TWIST_MOD) + TWIST_MOD) % TWIST_MOD
}

function reported(x: number): boolean {
  return Number.isFinite(x) && x !== 0
}

/**
 * The one place a float becomes a recorded integer. Tilt is passed through
 * as delivered (identity mapping): PEN_FACTS never saw a tilt, so there is
 * no measured sign to correct; if the re-measurement finds tiltX < 0 for a
 * rightward tilt, negate here and say so, so "+x = toward screen right".
 */
export function quantizeSample(hit: { u: number; v: number }, ev: PointerEventLike, pressureSource: 0 | 1): RawSample {
  const tiltReported = reported(ev.tiltX) || reported(ev.tiltY)
  const twistReported = reported(ev.twist)
  return {
    u: q16(hit.u),
    v: q16(hit.v),
    pressure: quantizePressure(ev.pressure),
    tiltX: quantizeTilt(ev.tiltX),
    tiltY: quantizeTilt(ev.tiltY),
    twist: quantizeTwist(ev.twist),
    flags: (tiltReported ? FLAG_TILT : 0) | (twistReported ? FLAG_TWIST : 0) | (pressureSource === 1 ? FLAG_SOURCE : 0),
  }
}

// ---------------------------------------------------------------------------
// The fence
// ---------------------------------------------------------------------------

interface OpenStroke {
  pointerId: number
  pressureSource: 0 | 1
  frame: PlaneFrame
}

function copyFrame(f: PlaneFrame): PlaneFrame {
  return {
    origin: [f.origin[0], f.origin[1], f.origin[2]],
    right: [f.right[0], f.right[1], f.right[2]],
    up: [f.up[0], f.up[1], f.up[2]],
  }
}

export class PenFence {
  private open: OpenStroke | null = null

  /** Attach to the canvas; returns a detach function that removes every listener. */
  attach(canvas: FenceCanvas, deps: FenceDeps): () => void {
    canvas.style.touchAction = 'none'
    this.open = null

    const hitOf = (
      frame: PlaneFrame,
      viewport: { width: number; height: number },
      rect: { left: number; top: number },
      s: PointerEventLike,
    ): { u: number; v: number } | null => rayPlane(FIXED_CAMERA, viewport, frame, s.clientX - rect.left, s.clientY - rect.top)

    const rectOf = (): { left: number; top: number } => {
      const r = canvas.getBoundingClientRect?.()
      return r === undefined ? { left: 0, top: 0 } : { left: r.left, top: r.top }
    }

    // Records the real samples folded into one dispatched event.
    const pushSamples = (stroke: OpenStroke, ev: PointerEventLike): void => {
      const list = ev.getCoalescedEvents?.() ?? [ev]
      const events = list.length > 0 ? list : [ev]
      const viewport = deps.viewport()
      const rect = rectOf()
      const samples: RawSample[] = []
      for (const s of events) {
        const hit = hitOf(stroke.frame, viewport, rect, s)
        if (hit === null) continue
        samples.push(quantizeSample(hit, s, stroke.pressureSource))
      }
      if (samples.length > 0) deps.callbacks.onSamples(samples)
    }

    // Predicted points are floats for the preview tail and never become a RawSample.
    const pushPreview = (stroke: OpenStroke, ev: PointerEventLike): void => {
      const predicted = ev.getPredictedEvents?.() ?? []
      const viewport = deps.viewport()
      const rect = rectOf()
      const points: Array<{ u: number; v: number }> = []
      for (const p of predicted) {
        const hit = hitOf(stroke.frame, viewport, rect, p)
        if (hit !== null) points.push(hit)
      }
      deps.callbacks.onPreview(points)
    }

    const release = (pointerId: number): void => {
      try {
        if (canvas.hasPointerCapture === undefined || canvas.hasPointerCapture(pointerId)) {
          canvas.releasePointerCapture(pointerId)
        }
      } catch {
        /* already released or never captured */
      }
    }

    const onDown = (ev: PointerEventLike): void => {
      // One stroke at a time: a second pen, a touch, or a second mouse
      // button while a stroke is open adds nothing.
      if (this.open !== null) return
      if (!paintable(ev, deps.settings())) return
      ev.preventDefault?.()
      try {
        canvas.setPointerCapture(ev.pointerId)
      } catch {
        /* a synthetic pointer; the stroke still opens and ends on pointerup */
      }
      const stroke: OpenStroke = {
        pointerId: ev.pointerId,
        pressureSource: pressureSourceOf(ev),
        frame: copyFrame(deps.frame()),
      }
      this.open = stroke
      deps.callbacks.onBegin(stroke.pressureSource, stroke.frame)
      pushSamples(stroke, ev)
    }

    const onMove = (ev: PointerEventLike): void => {
      const stroke = this.open
      // Hover, touch during a pen stroke, and any other pointer are ignored.
      if (stroke === null || ev.pointerId !== stroke.pointerId) return
      pushSamples(stroke, ev)
      pushPreview(stroke, ev)
    }

    const onEnd = (ev: PointerEventLike): void => {
      const stroke = this.open
      if (stroke === null || ev.pointerId !== stroke.pointerId) return
      this.open = null
      release(stroke.pointerId)
      deps.callbacks.onEnd()
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onEnd)
    canvas.addEventListener('pointercancel', onEnd)
    canvas.addEventListener('lostpointercapture', onEnd)

    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onEnd)
      canvas.removeEventListener('pointercancel', onEnd)
      canvas.removeEventListener('lostpointercapture', onEnd)
      const stroke = this.open
      this.open = null
      if (stroke !== null) {
        release(stroke.pointerId)
        deps.callbacks.onEnd()
      }
    }
  }

  /** True while a stroke is open (for the surface's status line). */
  get active(): boolean {
    return this.open !== null
  }
}
