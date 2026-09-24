/**
 * measure.ts — the pen measurement overlay (CANV-02, the numbers the fence
 * is built from).
 *
 * PenMeasure attaches native pointer listeners to an element with
 * touch-action: none and pointer capture, and accumulates what this Mac's
 * driver and Electron 32 actually deliver: pointer types on down, isPrimary,
 * pressure range and distinct-value count, tilt presence and sign, twist,
 * the eraser end's buttons, coalesced samples per second, predicted events
 * per move, pointerrawupdate rate, and the environment facts (secure
 * context, cross-origin isolation, WebGPU). Task 3 copies the result into
 * PEN_FACTS in input.ts.
 *
 * Output channels: the overlay <pre> handed to render() and
 * console.log('[dd-measure]', json). Nothing here fetches, stores or posts
 * anything; the JSON leaves the machine only if a person pastes it.
 *
 * Wall-clock time is used here only to turn counts into rates for the
 * measurement; this file is not on the recorded path.
 */

export interface MeasureSummary {
  pointerTypesOnDown: string[]
  isPrimary: boolean[]
  pressure: { min: number; max: number; distinct: number }
  tilt: { seen: boolean; xSign: -1 | 0 | 1; ySign: -1 | 0 | 1; maxAbs: number }
  twist: { seen: boolean; max: number }
  /** `buttons` on a pointerdown with button === 5 or buttons & 32; null if never seen. */
  eraserButtons: number | null
  /** Peak coalesced samples per second over any sub-second window of motion. */
  coalescedPerSecond: number
  predictedPerMove: { min: number; max: number }
  /** Peak pointerrawupdate events per second during a stroke; 0 if it never fired. */
  rawUpdatePerSecond: number
  isSecureContext: boolean
  crossOriginIsolated: boolean
  gpu: boolean
  /** pointerdown count on the element. */
  strokes: number
  /** Coalesced samples ingested over all strokes (context for pressure.distinct). */
  samples: number
}

/** The subset of PointerEvent the measurement reads. */
type Sample = Pick<PointerEvent, 'pressure' | 'tiltX' | 'tiltY' | 'twist'>

/** Timestamps of dispatched events inside the trailing window, with the samples each carried. */
interface Burst {
  t: number
  n: number
}

const WINDOW_MS = 1000
/** A rate is only trusted once the window spans this long. */
const MIN_SPAN_MS = 100

function sign(x: number): -1 | 0 | 1 {
  return x > 0 ? 1 : x < 0 ? -1 : 0
}

/**
 * Peak rate over a trailing window: events arriving in (t_first, t_last]
 * divided by that span. Short strokes (a fast sweep across the width lasts
 * well under a second) still yield the true rate this way, where a plain
 * one-second bucket would under-count them.
 */
class RateWindow {
  private bursts: Burst[] = []
  peak = 0

  push(t: number, n: number): void {
    this.bursts.push({ t, n })
    while (this.bursts.length > 0 && t - (this.bursts[0] as Burst).t > WINDOW_MS) this.bursts.shift()
    const first = this.bursts[0] as Burst
    const span = t - first.t
    if (this.bursts.length < 2 || span < MIN_SPAN_MS) return
    let sum = 0
    for (let i = 1; i < this.bursts.length; i++) sum += (this.bursts[i] as Burst).n
    const rate = (sum * 1000) / span
    if (rate > this.peak) this.peak = rate
  }

  reset(): void {
    this.bursts = []
  }
}

export class PenMeasure {
  private readonly types = new Set<string>()
  private readonly primaries = new Set<boolean>()
  private readonly pressures = new Set<number>()
  private minPressure = Infinity
  private maxPressure = -Infinity
  private samples = 0
  private tiltSeen = false
  private tiltXAbs = 0
  private tiltXSign: -1 | 0 | 1 = 0
  private tiltYAbs = 0
  private tiltYSign: -1 | 0 | 1 = 0
  private twistSeen = false
  private twistMax = 0
  private eraserButtons: number | null = null
  private readonly coalesced = new RateWindow()
  private readonly raw = new RateWindow()
  private predictedMin = Infinity
  private predictedMax = -Infinity
  private strokes = 0
  /** Pointers currently down and captured. */
  private readonly open = new Set<number>()

  /**
   * @param onChange called after every ingested move ('sample') and when a
   * stroke ends ('stroke-end'); the surface re-renders the overlay from it.
   */
  constructor(private readonly onChange?: (reason: 'sample' | 'stroke-end') => void) {}

  attach(el: HTMLElement): () => void {
    el.style.touchAction = 'none'
    const down = (ev: PointerEvent): void => this.onDown(el, ev)
    const move = (ev: PointerEvent): void => this.onMove(ev)
    const end = (ev: PointerEvent): void => this.onEnd(el, ev)
    const rawUpdate = (ev: Event): void => this.onRawUpdate(ev as PointerEvent)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('lostpointercapture', end)
    // Chromium-only; not in lib.dom's event map.
    el.addEventListener('pointerrawupdate', rawUpdate)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      el.removeEventListener('lostpointercapture', end)
      el.removeEventListener('pointerrawupdate', rawUpdate)
      this.open.clear()
    }
  }

  summary(): MeasureSummary {
    const none = this.samples === 0
    return {
      pointerTypesOnDown: [...this.types],
      isPrimary: [...this.primaries],
      pressure: {
        min: none ? 0 : this.minPressure,
        max: none ? 0 : this.maxPressure,
        distinct: this.pressures.size,
      },
      tilt: {
        seen: this.tiltSeen,
        xSign: this.tiltXSign,
        ySign: this.tiltYSign,
        maxAbs: Math.max(this.tiltXAbs, this.tiltYAbs),
      },
      twist: { seen: this.twistSeen, max: this.twistMax },
      eraserButtons: this.eraserButtons,
      coalescedPerSecond: Math.round(this.coalesced.peak),
      predictedPerMove: {
        min: this.predictedMin === Infinity ? 0 : this.predictedMin,
        max: this.predictedMax === -Infinity ? 0 : this.predictedMax,
      },
      rawUpdatePerSecond: Math.round(this.raw.peak),
      isSecureContext: globalThis.isSecureContext === true,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      gpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
      strokes: this.strokes,
      samples: this.samples,
    }
  }

  /** Write the JSON (2-space) into `into`; log it as `[dd-measure]` unless `log` is false. */
  render(into: HTMLElement, log = true): void {
    const json = JSON.stringify(this.summary(), null, 2)
    into.textContent = json
    if (log) console.log('[dd-measure]', json)
  }

  private onDown(el: HTMLElement, ev: PointerEvent): void {
    // Downs that start on a child (the overlay text) are left alone so the
    // JSON can be selected with a mouse; strokes start on the element itself.
    if (ev.target !== el) return
    ev.preventDefault()
    this.types.add(ev.pointerType)
    this.primaries.add(ev.isPrimary)
    this.strokes++
    if (ev.button === 5 || (ev.buttons & 32) !== 0) this.eraserButtons = ev.buttons
    this.open.add(ev.pointerId)
    try {
      el.setPointerCapture(ev.pointerId)
    } catch {
      /* a synthetic or already-released pointer; the stroke still counts */
    }
    this.coalesced.reset()
    this.raw.reset()
    const now = performance.now()
    const list = ev.getCoalescedEvents?.() ?? [ev]
    this.ingest(list.length > 0 ? list : [ev])
    this.coalesced.push(now, list.length > 0 ? list.length : 1)
    this.onChange?.('sample')
  }

  private onMove(ev: PointerEvent): void {
    if (!this.open.has(ev.pointerId)) return // hover adds nothing
    const now = performance.now()
    const list = ev.getCoalescedEvents?.() ?? [ev]
    const events = list.length > 0 ? list : [ev]
    this.ingest(events)
    this.coalesced.push(now, events.length)
    const predicted = ev.getPredictedEvents?.() ?? []
    if (predicted.length < this.predictedMin) this.predictedMin = predicted.length
    if (predicted.length > this.predictedMax) this.predictedMax = predicted.length
    this.onChange?.('sample')
  }

  private onRawUpdate(ev: PointerEvent): void {
    if (!this.open.has(ev.pointerId)) return
    this.raw.push(performance.now(), 1)
  }

  private onEnd(el: HTMLElement, ev: PointerEvent): void {
    if (!this.open.has(ev.pointerId)) return
    this.open.delete(ev.pointerId)
    try {
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId)
    } catch {
      /* already released */
    }
    this.onChange?.('stroke-end')
  }

  private ingest(events: readonly Sample[]): void {
    for (const s of events) {
      this.samples++
      const p = s.pressure
      this.pressures.add(p)
      if (p < this.minPressure) this.minPressure = p
      if (p > this.maxPressure) this.maxPressure = p
      const ax = Math.abs(s.tiltX)
      const ay = Math.abs(s.tiltY)
      if (ax !== 0 || ay !== 0) this.tiltSeen = true
      if (ax > this.tiltXAbs) {
        this.tiltXAbs = ax
        this.tiltXSign = sign(s.tiltX)
      }
      if (ay > this.tiltYAbs) {
        this.tiltYAbs = ay
        this.tiltYSign = sign(s.tiltY)
      }
      if (s.twist !== 0) {
        this.twistSeen = true
        if (s.twist > this.twistMax) this.twistMax = s.twist
      }
    }
  }
}
