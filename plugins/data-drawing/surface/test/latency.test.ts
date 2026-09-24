/**
 * The pen-to-ink rule of latency.ts, without a browser: a batch sent at t0
 * and applied at tick T is painted by the first frame after a snapshot with
 * tick > T arrived; stats are per stroke.
 */
import { describe, expect, it } from 'vitest'

import { LatencyMeter, formatLatencyLine, statsOf } from '../src/latency'

describe('LatencyMeter', () => {
  it('paints a batch only after a snapshot with tick > T, measuring from t0 to the frame', () => {
    const m = new LatencyMeter()
    m.beginStroke()
    m.markSent(1, 100, 1000)
    expect(m.onPainted(1005)).toBe(0) // no snapshot yet
    m.onSnapshot(100) // the batch's own tick: its nodes are not in this snapshot
    expect(m.onPainted(1010)).toBe(0)
    m.onSnapshot(101)
    expect(m.onPainted(1020)).toBe(1)
    expect(m.strokeStats()).toEqual({ count: 1, p50: 20, p95: 20, max: 20 })
    expect(m.inFlight).toBe(0)
  })

  it('reports p50 / p95 / max per stroke and keeps the previous stroke until the next one paints', () => {
    const m = new LatencyMeter()
    m.beginStroke()
    for (let i = 0; i < 10; i++) m.markSent(i, 10, 100 + i)
    m.onSnapshot(11)
    expect(m.onPainted(200)).toBe(10) // latencies 100..91
    const first = m.strokeStats()
    expect(first).not.toBeNull()
    expect(first!.count).toBe(10)
    expect(first!.p50).toBe(95)
    expect(first!.p95).toBe(100)
    expect(first!.max).toBe(100)
    m.beginStroke()
    expect(m.strokeStats()).toEqual(first) // nothing painted for stroke 2 yet
    m.markSent(20, 30, 500)
    m.onSnapshot(31)
    m.onPainted(512)
    expect(m.strokeStats()).toEqual({ count: 1, p50: 12, p95: 12, max: 12 })
  })

  it('reset forgets everything; statsOf and the panel line agree', () => {
    const m = new LatencyMeter()
    m.beginStroke()
    m.markSent(1, 0, 0)
    m.reset()
    m.onSnapshot(5)
    expect(m.onPainted(10)).toBe(0)
    expect(m.strokeStats()).toBeNull()
    expect(formatLatencyLine(null)).toBe('latency p50=— p95=— (last stroke)')
    expect(statsOf([3, 1, 2])).toEqual({ count: 3, p50: 2, p95: 3, max: 3 })
    expect(formatLatencyLine(statsOf([3, 1, 2]))).toBe('latency p50=2.0ms p95=3.0ms max=3.0ms n=3 (last stroke)')
  })
})
