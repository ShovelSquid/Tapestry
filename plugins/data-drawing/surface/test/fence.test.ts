/**
 * The fence is exercised without a DOM: a FakeCanvas records listeners and
 * capture calls, events are plain objects satisfying PointerEventLike, and
 * the pen path is driven synthetically. PEN_FACTS was measured with a mouse
 * over a streaming session (see input.ts), so these tests are what proves the
 * pen path — tip-down only, eraser refused, coalesced recorded, predicted
 * preview-only, quantized once — until a pen is attached to this Mac.
 */
import { describe, expect, it } from 'vitest'

import { FIXED_CAMERA } from '../src/camera'
import {
  DEFAULT_SETTINGS,
  ERASER_BUTTONS,
  FLAG_SOURCE,
  FLAG_TILT,
  FLAG_TWIST,
  PEN_FACTS,
  PRESSURE_MAX,
  PenFence,
  Q16_ONE,
  paintable,
  pressureSourceOf,
  quantizeSample,
  type FenceCallbacks,
  type FenceCanvas,
  type PointerEventLike,
  type RawSample,
  type Settings,
} from '../src/input'
import { DEFAULT_PLANE, rayPlane, type PlaneFrame } from '../src/plane'

const VIEWPORT = { width: 1600, height: 1000 }
const PEN_ONLY: Settings = { allowMouse: false }
const WITH_MOUSE: Settings = { allowMouse: true }

type Listener = (ev: PointerEventLike) => void

class FakeCanvas implements FenceCanvas {
  style = { touchAction: '' }
  readonly listeners = new Map<string, Listener[]>()
  readonly captured = new Set<number>()
  captureCalls: number[] = []
  releaseCalls: number[] = []

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? []
    this.listeners.set(
      type,
      list.filter((l) => l !== listener),
    )
  }
  setPointerCapture(id: number): void {
    this.captureCalls.push(id)
    this.captured.add(id)
  }
  releasePointerCapture(id: number): void {
    this.releaseCalls.push(id)
    this.captured.delete(id)
  }
  hasPointerCapture(id: number): boolean {
    return this.captured.has(id)
  }
  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 0 }
  }
  fire(type: string, ev: PointerEventLike): void {
    for (const l of this.listeners.get(type) ?? []) l(ev)
  }
  listenerCount(): number {
    let n = 0
    for (const list of this.listeners.values()) n += list.length
    return n
  }
}

interface EventInit {
  pointerType?: string
  buttons?: number
  button?: number
  pressure?: number
  tiltX?: number
  tiltY?: number
  twist?: number
  clientX?: number
  clientY?: number
  pointerId?: number
  isPrimary?: boolean
  coalesced?: PointerEventLike[]
  predicted?: PointerEventLike[]
}

function ev(init: EventInit = {}): PointerEventLike {
  const e: PointerEventLike = {
    pointerType: init.pointerType ?? 'pen',
    buttons: init.buttons ?? 1,
    button: init.button ?? 0,
    pressure: init.pressure ?? 0.5,
    tiltX: init.tiltX ?? 0,
    tiltY: init.tiltY ?? 0,
    twist: init.twist ?? 0,
    clientX: init.clientX ?? 800,
    clientY: init.clientY ?? 500,
    pointerId: init.pointerId ?? 7,
    isPrimary: init.isPrimary ?? true,
  }
  if (init.coalesced !== undefined) e.getCoalescedEvents = () => init.coalesced as PointerEventLike[]
  if (init.predicted !== undefined) e.getPredictedEvents = () => init.predicted as PointerEventLike[]
  return e
}

/** The u the fence must record for a client x on the default plane (centre row). */
function expectedU(clientX: number, clientY = 500): number {
  const h = rayPlane(FIXED_CAMERA, VIEWPORT, DEFAULT_PLANE, clientX, clientY)
  if (h === null) throw new Error('expected a hit')
  return Math.round(h.u * Q16_ONE)
}

interface Recorded {
  begins: Array<{ pressureSource: 0 | 1; frame: PlaneFrame }>
  samples: RawSample[][]
  ends: number
  previews: Array<Array<{ u: number; v: number }>>
}

function harness(settings: Settings = PEN_ONLY, frame: PlaneFrame = DEFAULT_PLANE) {
  const canvas = new FakeCanvas()
  const rec: Recorded = { begins: [], samples: [], ends: 0, previews: [] }
  const callbacks: FenceCallbacks = {
    onBegin: (pressureSource, f) => rec.begins.push({ pressureSource, frame: f }),
    onSamples: (s) => rec.samples.push(s),
    onEnd: () => {
      rec.ends++
    },
    onPreview: (p) => rec.previews.push(p),
  }
  const fence = new PenFence()
  const detach = fence.attach(canvas, {
    viewport: () => VIEWPORT,
    frame: () => frame,
    settings: () => settings,
    callbacks,
  })
  return { canvas, rec, fence, detach }
}

describe('paintable', () => {
  it('accepts a pen with the tip down', () => {
    expect(paintable(ev({ pointerType: 'pen', buttons: 1 }), PEN_ONLY)).toBe(true)
  })

  it('refuses a hovering pen (buttons 0)', () => {
    expect(paintable(ev({ pointerType: 'pen', buttons: 0 }), PEN_ONLY)).toBe(false)
  })

  it('refuses the eraser end (buttons 32) and the eraser with bit 0 set (33)', () => {
    expect(ERASER_BUTTONS).toBe(32)
    expect(paintable(ev({ pointerType: 'pen', buttons: 32, button: 5 }), PEN_ONLY)).toBe(false)
    // Blink never sets bit 0 for the eraser end; the fence still refuses it explicitly.
    expect(paintable(ev({ pointerType: 'pen', buttons: 33 }), PEN_ONLY)).toBe(false)
  })

  it('refuses the barrel button alone (buttons 2) and the pen with the barrel plus tip', () => {
    expect(paintable(ev({ pointerType: 'pen', buttons: 2 }), PEN_ONLY)).toBe(false)
    expect(paintable(ev({ pointerType: 'pen', buttons: 3 }), PEN_ONLY)).toBe(true)
  })

  it('accepts the mouse only behind the setting', () => {
    expect(paintable(ev({ pointerType: 'mouse', buttons: 1 }), PEN_ONLY)).toBe(false)
    expect(paintable(ev({ pointerType: 'mouse', buttons: 1 }), WITH_MOUSE)).toBe(true)
    expect(paintable(ev({ pointerType: 'mouse', buttons: 2 }), WITH_MOUSE)).toBe(false)
  })

  it('never accepts touch', () => {
    expect(paintable(ev({ pointerType: 'touch', buttons: 1 }), PEN_ONLY)).toBe(false)
    expect(paintable(ev({ pointerType: 'touch', buttons: 1 }), WITH_MOUSE)).toBe(false)
  })

  it('reports the pressure source: 1 for the mouse, 0 for a pen', () => {
    expect(pressureSourceOf(ev({ pointerType: 'mouse' }))).toBe(1)
    expect(pressureSourceOf(ev({ pointerType: 'pen' }))).toBe(0)
  })
})

describe('PEN_FACTS and the default setting', () => {
  it('records the 2026-09-24 mouse measurement verbatim', () => {
    expect(PEN_FACTS.measuredOn).toBe('2026-09-24')
    expect(PEN_FACTS.measuredWith).toBe('mouse')
    expect(PEN_FACTS.pressureDistinct).toBe(1)
    expect(PEN_FACTS.pressureMin).toBe(0.5)
    expect(PEN_FACTS.pressureMax).toBe(0.5)
    expect(PEN_FACTS.tiltSeen).toBe(false)
    expect(PEN_FACTS.tiltXSign).toBe(0)
    expect(PEN_FACTS.tiltYSign).toBe(0)
    expect(PEN_FACTS.eraserButtons).toBeNull()
    expect(PEN_FACTS.coalescedPerSecond).toBe(216)
    expect(PEN_FACTS.predictedPerMoveMax).toBe(10)
    expect(PEN_FACTS.rawUpdatePerSecond).toBe(250)
    expect(PEN_FACTS.isSecureContext).toBe(true)
    expect(PEN_FACTS.crossOriginIsolated).toBe(false)
    expect(PEN_FACTS.gpu).toBe(true)
  })

  it('accepts the mouse by default only while the measurement was made with a mouse', () => {
    expect(DEFAULT_SETTINGS.allowMouse).toBe(PEN_FACTS.measuredWith === 'mouse')
  })

  it('mirrors the sim wire widths', () => {
    expect(PRESSURE_MAX).toBe(65535)
    expect(Q16_ONE).toBe(65536)
    expect(FLAG_TILT | FLAG_TWIST | FLAG_SOURCE).toBe(7)
  })
})

describe('quantizeSample', () => {
  const hit = { u: 0, v: 0 }

  it('maps pressure 0 -> 0, 1 -> 65535, 0.5 -> 32768', () => {
    expect(quantizeSample(hit, ev({ pressure: 0 }), 0).pressure).toBe(0)
    expect(quantizeSample(hit, ev({ pressure: 1 }), 0).pressure).toBe(65535)
    expect(quantizeSample(hit, ev({ pressure: 0.5 }), 0).pressure).toBe(32768)
  })

  it('clamps out-of-range and non-finite pressure', () => {
    expect(quantizeSample(hit, ev({ pressure: 1.5 }), 0).pressure).toBe(65535)
    expect(quantizeSample(hit, ev({ pressure: -0.2 }), 0).pressure).toBe(0)
    expect(quantizeSample(hit, ev({ pressure: Number.NaN }), 0).pressure).toBe(0)
    expect(quantizeSample(hit, ev({ pressure: Number.POSITIVE_INFINITY }), 0).pressure).toBe(0)
  })

  it('rounds tilt to integer degrees and clamps to -90..90', () => {
    const s = quantizeSample(hit, ev({ tiltX: 45.4, tiltY: -90.6 }), 0)
    expect(s.tiltX).toBe(45)
    expect(s.tiltY).toBe(-90)
    expect(quantizeSample(hit, ev({ tiltX: 90.6 }), 0).tiltX).toBe(90)
    expect(quantizeSample(hit, ev({ tiltX: Number.NaN }), 0).tiltX).toBe(0)
  })

  it('wraps twist into 0..359: 359.6 -> 0, -1 -> 359', () => {
    expect(quantizeSample(hit, ev({ twist: 359.6 }), 0).twist).toBe(0)
    expect(quantizeSample(hit, ev({ twist: -1 }), 0).twist).toBe(359)
    expect(quantizeSample(hit, ev({ twist: 720 }), 0).twist).toBe(0)
    expect(quantizeSample(hit, ev({ twist: 12.4 }), 0).twist).toBe(12)
  })

  it('quantizes u/v to Q16.16 and clamps to int32', () => {
    expect(quantizeSample({ u: 1.5, v: -0.25 }, ev(), 0).u).toBe(98304)
    expect(quantizeSample({ u: 1.5, v: -0.25 }, ev(), 0).v).toBe(-16384)
    expect(quantizeSample({ u: 1e9, v: -1e9 }, ev(), 0).u).toBe(2147483647)
    expect(quantizeSample({ u: 1e9, v: -1e9 }, ev(), 0).v).toBe(-2147483648)
    expect(quantizeSample({ u: Number.NaN, v: 0 }, ev(), 0).u).toBe(0)
  })

  it('sets flags: tilt bit0, twist bit1, mouse bit2; absent tilt and twist leave the bits clear', () => {
    expect(quantizeSample(hit, ev({ tiltX: 0, tiltY: 0, twist: 0 }), 0).flags).toBe(0)
    expect(quantizeSample(hit, ev({ tiltX: 3 }), 0).flags).toBe(FLAG_TILT)
    expect(quantizeSample(hit, ev({ tiltY: -3 }), 0).flags).toBe(FLAG_TILT)
    expect(quantizeSample(hit, ev({ twist: 90 }), 0).flags).toBe(FLAG_TWIST)
    expect(quantizeSample(hit, ev({ tiltX: 3, twist: 90 }), 0).flags).toBe(FLAG_TILT | FLAG_TWIST)
    expect(quantizeSample(hit, ev({ pointerType: 'mouse' }), 1).flags).toBe(FLAG_SOURCE)
    expect(quantizeSample(hit, ev({ pointerType: 'mouse', tiltX: 1, twist: 1 }), 1).flags).toBe(7)
  })

  it('produces only the seven integer fields', () => {
    const s = quantizeSample({ u: 0.3, v: 0.7 }, ev({ pressure: 0.25, tiltX: 1.2, twist: 5.5 }), 0)
    expect(Object.keys(s).sort()).toEqual(['flags', 'pressure', 'tiltX', 'tiltY', 'twist', 'u', 'v'])
    for (const value of Object.values(s)) expect(Number.isInteger(value)).toBe(true)
  })
})

describe('PenFence', () => {
  it('sets touch-action none and attaches native listeners', () => {
    const { canvas, detach } = harness()
    expect(canvas.style.touchAction).toBe('none')
    expect(canvas.listeners.get('pointerdown')?.length).toBe(1)
    expect(canvas.listeners.get('pointermove')?.length).toBe(1)
    expect(canvas.listeners.get('pointerup')?.length).toBe(1)
    expect(canvas.listeners.get('pointercancel')?.length).toBe(1)
    expect(canvas.listeners.get('lostpointercapture')?.length).toBe(1)
    detach()
    expect(canvas.listenerCount()).toBe(0)
  })

  it('records the down and every coalesced move sample in order, previews the predicted points, and never records a predicted point', () => {
    const { canvas, rec } = harness()
    const down = ev({ clientX: 800, clientY: 500, coalesced: [ev({ clientX: 800, clientY: 500 })] })
    canvas.fire('pointerdown', down)
    expect(rec.begins).toHaveLength(1)
    expect(rec.begins[0]?.pressureSource).toBe(0)
    expect(rec.begins[0]?.frame).toEqual(DEFAULT_PLANE)
    expect(canvas.captureCalls).toEqual([7])

    const coalesced = [810, 820, 830, 840].map((x) => ev({ clientX: x, pressure: 0.75 }))
    const predicted = [1200, 1300].map((x) => ev({ clientX: x }))
    canvas.fire('pointermove', ev({ clientX: 840, coalesced, predicted }))

    expect(rec.samples).toHaveLength(2)
    expect(rec.samples[0]).toHaveLength(1)
    expect(rec.samples[1]).toHaveLength(4)
    expect(rec.samples[0]?.[0]?.u).toBe(0)
    expect(rec.samples[0]?.[0]?.v).toBe(0)
    expect(rec.samples[1]?.map((s) => s.u)).toEqual([810, 820, 830, 840].map((x) => expectedU(x)))
    expect(rec.samples[1]?.every((s) => s.pressure === Math.round(0.75 * PRESSURE_MAX))).toBe(true)

    expect(rec.previews).toHaveLength(1)
    expect(rec.previews[0]).toHaveLength(2)
    const predictedU = [1200, 1300].map((x) => expectedU(x))
    const recordedU = rec.samples.flat().map((s) => s.u)
    for (const pu of predictedU) expect(recordedU).not.toContain(pu)
    for (const s of rec.samples.flat()) expect(Number.isInteger(s.u)).toBe(true)
  })

  it('falls back to the event itself when there is no coalesced list, and to an empty preview', () => {
    const { canvas, rec } = harness()
    canvas.fire('pointerdown', ev({ clientX: 800 }))
    canvas.fire('pointermove', ev({ clientX: 900 }))
    expect(rec.samples).toHaveLength(2)
    expect(rec.samples[1]).toEqual([expect.objectContaining({ u: expectedU(900), v: 0, flags: 0 })])
    expect(rec.previews).toEqual([[]])
  })

  it('ignores a second down while a stroke is open', () => {
    const { canvas, rec } = harness()
    canvas.fire('pointerdown', ev({ pointerId: 7 }))
    canvas.fire('pointerdown', ev({ pointerId: 8, clientX: 900 }))
    expect(rec.begins).toHaveLength(1)
    expect(canvas.captureCalls).toEqual([7])
    canvas.fire('pointermove', ev({ pointerId: 8, clientX: 950 }))
    expect(rec.samples).toHaveLength(1)
  })

  it('ignores touch while a pen stroke is open', () => {
    const { canvas, rec } = harness()
    canvas.fire('pointerdown', ev({ pointerId: 7 }))
    canvas.fire('pointerdown', ev({ pointerId: 9, pointerType: 'touch', clientX: 300 }))
    canvas.fire('pointermove', ev({ pointerId: 9, pointerType: 'touch', clientX: 320 }))
    canvas.fire('pointerup', ev({ pointerId: 9, pointerType: 'touch', buttons: 0 }))
    expect(rec.begins).toHaveLength(1)
    expect(rec.samples).toHaveLength(1)
    expect(rec.ends).toBe(0)
    expect(rec.previews).toHaveLength(0)
  })

  it('ends once on pointerup, releases capture, and ignores later moves', () => {
    const { canvas, rec, fence } = harness()
    canvas.fire('pointerdown', ev())
    expect(fence.active).toBe(true)
    canvas.fire('pointerup', ev({ buttons: 0 }))
    expect(rec.ends).toBe(1)
    expect(canvas.releaseCalls).toEqual([7])
    expect(canvas.captured.size).toBe(0)
    expect(fence.active).toBe(false)
    // The browser fires lostpointercapture after the release; it must not end twice.
    canvas.fire('lostpointercapture', ev({ buttons: 0 }))
    canvas.fire('pointermove', ev({ clientX: 900, buttons: 0 }))
    expect(rec.ends).toBe(1)
    expect(rec.samples).toHaveLength(1)
  })

  it('ends on pointercancel and on lostpointercapture', () => {
    const a = harness()
    a.canvas.fire('pointerdown', ev())
    a.canvas.fire('pointercancel', ev({ buttons: 0 }))
    expect(a.rec.ends).toBe(1)

    const b = harness()
    b.canvas.fire('pointerdown', ev())
    b.canvas.fire('lostpointercapture', ev({ buttons: 0 }))
    expect(b.rec.ends).toBe(1)
    expect(b.canvas.listenerCount()).toBeGreaterThan(0)
  })

  it('never opens on hover or the eraser end', () => {
    const { canvas, rec } = harness()
    canvas.fire('pointermove', ev({ buttons: 0, clientX: 900 }))
    canvas.fire('pointerdown', ev({ buttons: 32, button: 5 }))
    canvas.fire('pointermove', ev({ buttons: 32, clientX: 900 }))
    canvas.fire('pointerup', ev({ buttons: 0 }))
    expect(rec.begins).toHaveLength(0)
    expect(rec.samples).toHaveLength(0)
    expect(rec.ends).toBe(0)
    expect(canvas.captureCalls).toHaveLength(0)
  })

  it('delivers nothing for a mouse with allowMouse false', () => {
    const { canvas, rec } = harness(PEN_ONLY)
    canvas.fire('pointerdown', ev({ pointerType: 'mouse' }))
    canvas.fire('pointermove', ev({ pointerType: 'mouse', clientX: 900 }))
    canvas.fire('pointerup', ev({ pointerType: 'mouse', buttons: 0 }))
    expect(rec.begins).toHaveLength(0)
    expect(rec.samples).toHaveLength(0)
    expect(rec.ends).toBe(0)
  })

  it('with allowMouse true delivers onBegin(1, frame) and samples carrying the source flag', () => {
    const { canvas, rec } = harness(WITH_MOUSE)
    canvas.fire('pointerdown', ev({ pointerType: 'mouse', pressure: 0.5 }))
    canvas.fire('pointermove', ev({ pointerType: 'mouse', clientX: 900, coalesced: [ev({ pointerType: 'mouse', clientX: 850 }), ev({ pointerType: 'mouse', clientX: 900 })] }))
    canvas.fire('pointerup', ev({ pointerType: 'mouse', buttons: 0 }))
    expect(rec.begins).toEqual([{ pressureSource: 1, frame: DEFAULT_PLANE }])
    const all = rec.samples.flat()
    expect(all).toHaveLength(3)
    for (const s of all) {
      expect(s.flags & FLAG_SOURCE).toBe(FLAG_SOURCE)
      expect(s.pressure).toBe(32768)
    }
    expect(rec.ends).toBe(1)
  })

  it('captures the plane frame once per stroke as a copy', () => {
    const frame: PlaneFrame = { origin: [0, 0, 5], right: [1, 0, 0], up: [0, 1, 0] }
    const { canvas, rec } = harness(PEN_ONLY, frame)
    canvas.fire('pointerdown', ev())
    frame.origin[2] = 50
    expect(rec.begins[0]?.frame.origin).toEqual([0, 0, 5])
    // The stroke keeps unprojecting against the captured frame.
    canvas.fire('pointermove', ev({ clientX: 1600 }))
    const h = rayPlane(FIXED_CAMERA, VIEWPORT, { origin: [0, 0, 5], right: [1, 0, 0], up: [0, 1, 0] }, 1600, 500)
    expect(rec.samples[1]?.[0]?.u).toBe(Math.round((h as { u: number }).u * Q16_ONE))
  })

  it('skips samples whose ray misses the plane', () => {
    const edgeOn: PlaneFrame = { origin: [0, 0, 0], right: [1, 0, 0], up: [0, 0, 1] }
    const { canvas, rec } = harness(PEN_ONLY, edgeOn)
    canvas.fire('pointerdown', ev())
    canvas.fire('pointermove', ev({ clientX: 900 }))
    expect(rec.begins).toHaveLength(1)
    expect(rec.samples).toHaveLength(0)
    expect(rec.previews).toEqual([[]])
  })

  it('detaching mid-stroke ends the stroke once and releases capture', () => {
    const { canvas, rec, detach } = harness()
    canvas.fire('pointerdown', ev())
    detach()
    expect(rec.ends).toBe(1)
    expect(canvas.releaseCalls).toEqual([7])
    expect(canvas.listenerCount()).toBe(0)
  })
})
