/**
 * QuietWindowQueue — one moment is 750 ms of quiet, forced after 5 s
 * (02.2 D-23, 02.7 D-06). Fake timers; no filesystem.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_WAIT_MS, QUIET_MS, QuietWindowQueue } from './quiet-queue'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  vi.useRealTimers()
})

function recorder(): { flushes: Array<{ at: number; paths: string[] }>; onFlush: (paths: Set<string>) => Promise<void> } {
  const flushes: Array<{ at: number; paths: string[] }> = []
  return {
    flushes,
    onFlush: async (paths) => {
      flushes.push({ at: Date.now(), paths: [...paths].sort() })
    },
  }
}

describe('QuietWindowQueue', () => {
  it('uses the 02.2 D-23 values', () => {
    expect(QUIET_MS).toBe(750)
    expect(MAX_WAIT_MS).toBe(5000)
  })

  it('adds at 0, 300 and 600 ms flush once at 1350 ms with every path', async () => {
    const { flushes, onFlush } = recorder()
    const queue = new QuietWindowQueue({ onFlush })
    queue.add(['a'])
    await vi.advanceTimersByTimeAsync(300)
    queue.add(['b'])
    await vi.advanceTimersByTimeAsync(300)
    queue.add(['c', 'a'])
    await vi.advanceTimersByTimeAsync(749)
    expect(flushes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(flushes).toEqual([{ at: 1350, paths: ['a', 'b', 'c'] }])
    await vi.advanceTimersByTimeAsync(5000)
    expect(flushes.length).toBe(1)
  })

  it('adds every 500 ms flush by 5000 ms', async () => {
    const { flushes, onFlush } = recorder()
    const queue = new QuietWindowQueue({ onFlush })
    let n = 0
    const interval = setInterval(() => queue.add([`p${n++}`]), 500)
    queue.add([`p${n++}`])
    // Adds at 0, 500, ... 4500: never 750 ms of quiet.
    await vi.advanceTimersByTimeAsync(4999)
    clearInterval(interval)
    expect(flushes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(flushes.length).toBe(1)
    expect(flushes[0].at).toBeLessThanOrEqual(5000)
    expect(flushes[0].paths.length).toBeGreaterThanOrEqual(10)
    queue.dispose()
  })

  it('defers paths added during a flush to a second flush', async () => {
    const calls: string[][] = []
    let release: () => void = () => undefined
    const queue = new QuietWindowQueue({
      onFlush: (paths) => {
        calls.push([...paths].sort())
        if (calls.length === 1) return new Promise<void>((resolve) => (release = resolve))
        return Promise.resolve()
      },
    })
    queue.add(['a'])
    await vi.advanceTimersByTimeAsync(750)
    expect(calls).toEqual([['a']])

    // Flush one is still running: b waits, even past its own quiet window.
    queue.add(['b'])
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toEqual([['a']])

    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual([['a'], ['b']])
  })

  it('flushNow flushes at once, dispose drops what is pending, and a failed flush is reported', async () => {
    const errors: unknown[] = []
    const calls: string[][] = []
    const queue = new QuietWindowQueue({
      onFlush: async (paths) => {
        calls.push([...paths])
        throw new Error('boom')
      },
      onError: (err) => errors.push(err),
    })
    queue.add(['x'])
    await queue.flushNow()
    expect(calls).toEqual([['x']])
    expect(errors.length).toBe(1)

    queue.add(['y'])
    queue.dispose()
    await vi.advanceTimersByTimeAsync(10000)
    expect(calls).toEqual([['x']])
    queue.add(['z'])
    expect(queue.size).toBe(0)
  })
})
