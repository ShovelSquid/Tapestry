/**
 * latency.ts — pen-to-ink latency on the main thread (01-08, roadmap wave 4).
 *
 * Rule: a sample batch sent at wall time t0 and stamped by the recorder for
 * sim tick T is "painted" at the first animation-frame callback that runs
 * after a snapshot with tick > T has been uploaded to the node field (that
 * snapshot is the first one that can contain the nodes tick T emitted);
 * latency = paintedTime - t0.
 *
 * The clock here is performance.now() on the main thread, which is allowed
 * left of the fence: nothing measured here is ever recorded, and the sim
 * never sees it. The meter does not know which transport is behind the
 * host — it only sees sends, applied-tick echoes, snapshot ticks and frames
 * — which is what makes the Worker-vs-main-thread comparison fair.
 */

export interface LatencyStats {
  count: number
  p50: number
  p95: number
  max: number
}

interface Sent {
  tick: number
  t0: number
  stroke: number
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[rank] as number
}

export function statsOf(latencies: readonly number[]): LatencyStats {
  const sorted = [...latencies].sort((a, b) => a - b)
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.length === 0 ? 0 : (sorted[sorted.length - 1] as number),
  }
}

export class LatencyMeter {
  private readonly pending = new Map<number, Sent>()
  /** Latencies per stroke sequence number; only the newest two strokes are kept. */
  private readonly strokes = new Map<number, number[]>()
  private strokeSeq = 0
  private arrivedTick = -1

  /** A new stroke opened: later sends belong to it. */
  beginStroke(): void {
    this.strokeSeq += 1
    this.strokes.set(this.strokeSeq, [])
    for (const key of [...this.strokes.keys()]) if (key < this.strokeSeq - 1) this.strokes.delete(key)
  }

  /** A batch keyed `sampleKey`, sent at `t0`, was applied by the recorder at sim tick `tick`. */
  markSent(sampleKey: number, tick: number, t0: number = performance.now()): void {
    this.pending.set(sampleKey, { tick, t0, stroke: this.strokeSeq })
  }

  /** A snapshot with this tick arrived (it is uploaded before the next onPainted). */
  onSnapshot(tick: number): void {
    if (tick > this.arrivedTick) this.arrivedTick = tick
  }

  /**
   * The end of a frame callback: every pending batch whose tick the latest
   * uploaded snapshot has passed is painted now. Returns how many resolved.
   */
  onPainted(now: number = performance.now()): number {
    let resolved = 0
    for (const [key, sent] of this.pending) {
      if (sent.tick < this.arrivedTick) {
        this.pending.delete(key)
        let list = this.strokes.get(sent.stroke)
        if (list === undefined) {
          list = []
          this.strokes.set(sent.stroke, list)
        }
        list.push(now - sent.t0)
        resolved += 1
      }
    }
    return resolved
  }

  /** Stats of the most recent stroke that has at least one painted batch, or null. */
  strokeStats(): LatencyStats | null {
    for (const key of [...this.strokes.keys()].sort((a, b) => b - a)) {
      const list = this.strokes.get(key)
      if (list !== undefined && list.length > 0) return statsOf(list)
    }
    return null
  }

  /** How many sent batches have not been painted yet. */
  get inFlight(): number {
    return this.pending.size
  }

  reset(): void {
    this.pending.clear()
    this.strokes.clear()
    this.strokeSeq = 0
    this.arrivedTick = -1
  }
}

/** `latency p50=<ms> p95=<ms> (last stroke)`; dashes before any stroke was painted. */
export function formatLatencyLine(stats: LatencyStats | null): string {
  if (stats === null || stats.count === 0) return 'latency p50=— p95=— (last stroke)'
  return `latency p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.max.toFixed(1)}ms n=${stats.count} (last stroke)`
}
