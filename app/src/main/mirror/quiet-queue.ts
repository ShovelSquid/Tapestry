/**
 * Quiet-window grouping — "the same moment" (02.2 D-23, reused by 02.7 D-06).
 *
 * A watcher reports dirty paths one event at a time; a git checkout or an
 * editor's save-all reports dozens in a burst. The queue gathers them and
 * hands them on together once the folder has been quiet for `quietMs`, or at
 * the latest `maxWaitMs` after the first pending path, so a folder that never
 * goes quiet is still recorded. Flushes run one at a time: paths added while
 * a flush is running wait for the next one.
 *
 * Generic on purpose: the workspace watcher uses it now, and 02.2 Plan 10's
 * vault watcher can import it instead of keeping its own copy.
 */

/** A moment ends after this long with no new paths. */
export const QUIET_MS = 750

/** ...or this long after its first path, whichever comes first. */
export const MAX_WAIT_MS = 5000

export interface QuietWindowQueueOptions {
  onFlush: (paths: Set<string>) => Promise<void>
  quietMs?: number
  maxWaitMs?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** Called when onFlush rejects. Defaults to console.error. */
  onError?: (err: unknown) => void
}

export class QuietWindowQueue {
  private readonly onFlush: (paths: Set<string>) => Promise<void>
  private readonly quietMs: number
  private readonly maxWaitMs: number
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly onError: (err: unknown) => void

  private pending = new Set<string>()
  private firstPendingAt: number | null = null
  private timer: unknown = null
  private running: Promise<void> | null = null
  /** A flush was asked for while one was running. */
  private again = false
  private disposed = false

  constructor(opts: QuietWindowQueueOptions) {
    this.onFlush = opts.onFlush
    this.quietMs = opts.quietMs ?? QUIET_MS
    this.maxWaitMs = opts.maxWaitMs ?? MAX_WAIT_MS
    this.now = opts.now ?? (() => Date.now())
    this.setTimer =
      opts.setTimer ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms)
        // A pending moment must never keep a process alive on its own.
        ;(handle as { unref?: () => void }).unref?.()
        return handle
      })
    this.clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.onError = opts.onError ?? ((err) => console.error('[QuietWindowQueue] flush failed:', err))
  }

  /** How many paths are waiting for the next flush. */
  get size(): number {
    return this.pending.size
  }

  /** Merge `paths` into the pending moment and restart its quiet timer. */
  add(paths: Iterable<string>): void {
    if (this.disposed) return
    for (const path of paths) this.pending.add(path)
    if (this.pending.size === 0) return
    if (this.firstPendingAt === null) this.firstPendingAt = this.now()

    this.cancelTimer()
    const waited = this.now() - this.firstPendingAt
    // Past the ceiling the flush is immediate; otherwise the quiet window,
    // cut short so it never ends later than the ceiling.
    const delay = waited >= this.maxWaitMs ? 0 : Math.min(this.quietMs, this.maxWaitMs - waited)
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.flushNow()
    }, delay)
  }

  /**
   * Flush the pending paths now. When a flush is already running, the paths
   * pending now are flushed right after it, and the returned promise settles
   * when that later flush has.
   */
  flushNow(): Promise<void> {
    this.cancelTimer()
    if (this.running) {
      this.again = true
      return this.running
    }
    const run = async (): Promise<void> => {
      try {
        do {
          this.again = false
          if (this.disposed || this.pending.size === 0) break
          const batch = this.pending
          this.pending = new Set()
          this.firstPendingAt = null
          try {
            await this.onFlush(batch)
          } catch (err) {
            this.onError(err)
          }
        } while (this.again)
      } finally {
        this.running = null
      }
    }
    this.running = run()
    return this.running
  }

  /** Drop pending paths and stop the timer. A running flush finishes. */
  dispose(): void {
    this.disposed = true
    this.cancelTimer()
    this.pending.clear()
    this.firstPendingAt = null
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }
}
