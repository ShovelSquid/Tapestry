/**
 * sim-host.ts — the async, transport-agnostic SimHost and its two transports.
 *
 * WorkerTransport (the default) runs the Wasm sim in a module Worker; the
 * renderer only ever receives copies: every snapshot buffer is a
 * HEAPU8.slice() the worker transferred, never a view of the Wasm heap.
 * MainThreadTransport (01-08) loads the same mathspace.mjs on the main thread
 * and drives the same SimDriver on requestAnimationFrame — for the
 * pen-to-ink latency comparison and tests only; it implements the identical
 * interface, so the surface cannot tell them apart. Either way the main
 * thread changes the sim only through recorded actions submitted here.
 *
 * Strokes (01-07): beginStroke / pushSamples / endStroke are fire-and-forget
 * posts keyed by the stroke ordinal; the driver is the recorder and stamps
 * every sample with the tick it is applied at. onStrokeApplied echoes the
 * applied tick (used by the latency meter to bind a sent batch to its
 * tick); rejections come back through onRejected with the ordinal.
 *
 * replayFromZero (01-08) replays the session log into a second instance and
 * reports MATCH / first differing tick; it never corrects the live state.
 * A transport can be created from a RestorePoint (the log so far and the
 * live tick) so switching transports is itself a replay.
 */
import { TICK_HZ, type BrushVersionSpec } from './ddsim-abi'
import type { RawSample } from './input'
import { SimDriver, type LogEntry, type Outcome, type ReplayReport, type RestorePoint, type Snapshot } from './sim-driver'
import simWorkerUrl from './sim.worker?worker&url'
import wasmUrl from '../wasm/mathspace.wasm?url'
import { spawnSameOriginModuleWorker } from './worker-spawn'

export type { LogEntry, ReplayReport, RestorePoint, Snapshot } from './sim-driver'

export type TransportKind = 'worker' | 'main'

export interface StrokeBeginSpec {
  /** Session-unique, >= 1; the stroke id is (branch 0, ordinal). */
  ordinal: number
  brushVersionId: number
  /** The plane frame captured once at pen-down, as StrokeBegin records it (plane.ts frameToQ16). */
  frameQ16: Int32Array
  pressureSource: 0 | 1
}

export interface DdError {
  code: number
  name: string
  kind: number
  /** The stroke the rejected action belonged to, when it was a stroke action. */
  ordinal?: number
}

/** A stroke action was applied and recorded at `tick`. */
export interface StrokeApplied {
  ordinal: number
  actionKind: number
  tick: number
  samples: number
}

export interface SimHost {
  readonly kind: TransportKind
  readonly ready: Promise<{ version: number; tickHz: number }>
  /** Tick of the last snapshot received. */
  currentTick(): number
  /** Resolves to the assigned brush version id; rejects with a DdError. */
  defineBrush(spec: BrushVersionSpec): Promise<number>
  /** Opens a stroke at the sim's current tick (start_tick stamped there). Fire-and-forget. */
  beginStroke(spec: StrokeBeginSpec): void
  /** Records coalesced samples; the recorder stamps (tick, index) at arrival. Fire-and-forget. */
  pushSamples(ordinal: number, samples: RawSample[]): void
  /** Ends a stroke at the sim's current tick. Fire-and-forget. */
  endStroke(ordinal: number): void
  pause(paused: boolean): void
  onSnapshot(cb: (s: Snapshot) => void): () => void
  onRejected(cb: (e: DdError) => void): () => void
  /** Echo of every applied stroke action with the tick it was recorded at. */
  onStrokeApplied(cb: (e: StrokeApplied) => void): () => void
  /** 32 bytes, taken at a tick boundary. */
  hash(): Promise<Uint8Array>
  /** Every accepted action in record order. */
  log(): Promise<LogEntry[]>
  /** Replays the session log from tick zero into a fresh instance and compares with the live state. */
  replayFromZero(): Promise<ReplayReport>
  dispose(): void
}

export interface TransportOptions {
  /** Continue a session: the log so far and the live tick the new transport must reach before it goes live. */
  restore?: RestorePoint
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

export type WorkerInbound =
  | { kind: 'init'; seed: bigint; restore?: RestorePoint }
  | { kind: 'defineBrush'; id: number; spec: BrushVersionSpec }
  | { kind: 'beginStroke'; ordinal: number; brushVersionId: number; frameQ16: Int32Array; pressureSource: 0 | 1 }
  | { kind: 'samples'; ordinal: number; samples: RawSample[] }
  | { kind: 'endStroke'; ordinal: number }
  | { kind: 'pause'; paused: boolean }
  | { kind: 'hash'; id: number }
  | { kind: 'log'; id: number }
  | { kind: 'replay'; id: number }
  | { kind: 'dispose' }

export type WorkerOutbound =
  | { kind: 'ready'; version: number; tickHz: number }
  | ({ kind: 'snapshot' } & Snapshot)
  | { kind: 'applied'; id: number; tick: number; result: number }
  /** A stroke action was applied and recorded at `tick` (no request id: stroke posts are fire-and-forget). */
  | { kind: 'strokeApplied'; ordinal: number; actionKind: number; tick: number; samples: number }
  /** `id` for a request, `ordinal` for a stroke action; never both. */
  | { kind: 'rejected'; id?: number; ordinal?: number; code: number; name: string; actionKind: number }
  | { kind: 'hash'; id: number; bytes: Uint8Array }
  | { kind: 'log'; id: number; entries: LogEntry[] }
  | { kind: 'replay'; id: number; report: ReplayReport }
  | { kind: 'error'; id?: number; message: string }

export class DdRejected extends Error implements DdError {
  readonly code: number
  readonly kind: number
  readonly ordinal: number | undefined
  constructor(e: DdError) {
    super(`${e.name} (code ${e.code}, action kind ${e.kind}${e.ordinal === undefined ? '' : `, stroke ${e.ordinal}`})`)
    this.name = e.name
    this.code = e.code
    this.kind = e.kind
    this.ordinal = e.ordinal
  }
}

interface Pending {
  resolve: (value: never) => void
  reject: (reason: unknown) => void
}

/** Subscriber bookkeeping shared by both transports. */
class Subscribers {
  readonly snapshot = new Set<(s: Snapshot) => void>()
  readonly rejected = new Set<(e: DdError) => void>()
  readonly strokeApplied = new Set<(e: StrokeApplied) => void>()

  clear(): void {
    this.snapshot.clear()
    this.rejected.clear()
    this.strokeApplied.clear()
  }
}

function subscribe<T>(set: Set<(v: T) => void>, cb: (v: T) => void): () => void {
  set.add(cb)
  return () => {
    set.delete(cb)
  }
}

// ---------------------------------------------------------------------------
// WorkerTransport
// ---------------------------------------------------------------------------

export class WorkerTransport implements SimHost {
  readonly kind: TransportKind = 'worker'
  readonly ready: Promise<{ version: number; tickHz: number }>

  private readonly worker: Worker
  /** Releases the blob: trampoline the worker was spawned through. */
  private readonly revokeTrampoline: () => void
  private readonly pending = new Map<number, Pending>()
  private readonly subs = new Subscribers()
  private nextId = 1
  private lastTick = 0
  private disposed = false

  constructor(seed: number | bigint, options: TransportOptions = {}) {
    // The worker chunk's URL (Vite `?worker&url`: the same chunk the direct
    // `new Worker(new URL(...))` form would emit), resolved absolute against
    // this module and spawned through a same-origin blob: trampoline so the
    // spawn also works when this module is served from tapestry-plugin://
    // inside Tapestry (01-04: Worker scripts must be same-origin with the
    // document; CORS cannot relax it).
    const spawned = spawnSameOriginModuleWorker(new URL(simWorkerUrl, import.meta.url).href)
    this.worker = spawned.worker
    this.revokeTrampoline = spawned.revoke
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => {
        const msg = ev.data
        if (msg.kind === 'ready') {
          resolve({ version: msg.version, tickHz: msg.tickHz })
          return
        }
        this.dispatch(msg)
      }
      this.worker.onerror = (ev) => {
        reject(new Error(`sim worker: ${ev.message}`))
        for (const p of this.pending.values()) p.reject(new Error(`sim worker: ${ev.message}`))
        this.pending.clear()
      }
    })
    const init: WorkerInbound = { kind: 'init', seed: BigInt(seed) }
    if (options.restore !== undefined) {
      init.restore = options.restore
      this.lastTick = options.restore.tick
    }
    this.post(init)
  }

  currentTick(): number {
    return this.lastTick
  }

  defineBrush(spec: BrushVersionSpec): Promise<number> {
    return this.request<number>((id) => ({ kind: 'defineBrush', id, spec }))
  }

  beginStroke(spec: StrokeBeginSpec): void {
    this.post({
      kind: 'beginStroke',
      ordinal: spec.ordinal,
      brushVersionId: spec.brushVersionId,
      frameQ16: spec.frameQ16,
      pressureSource: spec.pressureSource,
    })
  }

  /**
   * The RawSample[] is posted as-is: a coalesced batch is a handful of
   * seven-integer objects, and structured-cloning it measured well under a
   * millisecond in the dev page (01-07 SUMMARY), so a packed typed layout
   * would buy nothing yet.
   */
  pushSamples(ordinal: number, samples: RawSample[]): void {
    if (samples.length === 0) return
    this.post({ kind: 'samples', ordinal, samples })
  }

  endStroke(ordinal: number): void {
    this.post({ kind: 'endStroke', ordinal })
  }

  pause(paused: boolean): void {
    this.post({ kind: 'pause', paused })
  }

  onSnapshot(cb: (s: Snapshot) => void): () => void {
    return subscribe(this.subs.snapshot, cb)
  }

  onRejected(cb: (e: DdError) => void): () => void {
    return subscribe(this.subs.rejected, cb)
  }

  onStrokeApplied(cb: (e: StrokeApplied) => void): () => void {
    return subscribe(this.subs.strokeApplied, cb)
  }

  hash(): Promise<Uint8Array> {
    return this.request<Uint8Array>((id) => ({ kind: 'hash', id }))
  }

  log(): Promise<LogEntry[]> {
    return this.request<LogEntry[]>((id) => ({ kind: 'log', id }))
  }

  replayFromZero(): Promise<ReplayReport> {
    return this.request<ReplayReport>((id) => ({ kind: 'replay', id }))
  }

  /** Idempotent: terminates the worker and rejects anything still pending. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.post({ kind: 'dispose' })
    this.worker.terminate()
    this.revokeTrampoline()
    for (const p of this.pending.values()) p.reject(new Error('sim host disposed'))
    this.pending.clear()
    this.subs.clear()
  }

  private post(msg: WorkerInbound): void {
    if (this.disposed) return
    this.worker.postMessage(msg)
  }

  private request<T>(build: (id: number) => WorkerInbound): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('sim host disposed'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: never) => void, reject })
      this.post(build(id))
    })
  }

  private take(id: number): Pending | undefined {
    const p = this.pending.get(id)
    this.pending.delete(id)
    return p
  }

  private dispatch(msg: WorkerOutbound): void {
    switch (msg.kind) {
      case 'snapshot': {
        this.lastTick = msg.tick
        const s: Snapshot = {
          tick: msg.tick,
          nodeCount: msg.nodeCount,
          nodes: msg.nodes,
          bodyCount: msg.bodyCount,
          bodies: msg.bodies,
        }
        for (const cb of this.subs.snapshot) cb(s)
        return
      }
      case 'applied':
        this.take(msg.id)?.resolve(msg.result as never)
        return
      case 'rejected': {
        const e: DdError = { code: msg.code, name: msg.name, kind: msg.actionKind }
        if (msg.ordinal !== undefined) e.ordinal = msg.ordinal
        if (msg.id !== undefined) this.take(msg.id)?.reject(new DdRejected(e))
        for (const cb of this.subs.rejected) cb(e)
        return
      }
      case 'strokeApplied': {
        const e: StrokeApplied = { ordinal: msg.ordinal, actionKind: msg.actionKind, tick: msg.tick, samples: msg.samples }
        for (const cb of this.subs.strokeApplied) cb(e)
        return
      }
      case 'hash':
        this.take(msg.id)?.resolve(msg.bytes as never)
        return
      case 'log':
        this.take(msg.id)?.resolve(msg.entries as never)
        return
      case 'replay':
        this.take(msg.id)?.resolve(msg.report as never)
        return
      case 'error':
        if (msg.id !== undefined) this.take(msg.id)?.reject(new Error(msg.message))
        else console.error('[data-drawing] sim worker:', msg.message)
        return
      case 'ready':
        return
    }
  }
}

// ---------------------------------------------------------------------------
// MainThreadTransport
// ---------------------------------------------------------------------------

/**
 * The .wasm URL made absolute against this module's URL (dev: the Vite
 * root-relative `?url`; built: `./assets/ddsim-*.wasm` next to surface.js).
 */
const MAIN_WASM_URL = new URL(wasmUrl, import.meta.url).href

/**
 * The same sim on the main thread: the glue is loaded lazily (a separate
 * chunk, never paid for by the Worker default), the driver is stepped from
 * requestAnimationFrame timestamps (whole ticks only; the clock decides the
 * count), and snapshots are the driver's copies handed straight to
 * subscribers. Requests resolve on the microtask queue: on the main thread
 * every callback runs at a tick boundary.
 */
export class MainThreadTransport implements SimHost {
  readonly kind: TransportKind = 'main'
  readonly ready: Promise<{ version: number; tickHz: number }>

  private driver: SimDriver | null = null
  private readonly subs = new Subscribers()
  private raf = 0
  private lastTick = 0
  private lastEmitted = -1
  private disposed = false

  constructor(seed: number | bigint, options: TransportOptions = {}) {
    if (options.restore !== undefined) this.lastTick = options.restore.tick
    this.ready = this.init(BigInt(seed), options.restore)
  }

  private async init(seed: bigint, restore: RestorePoint | undefined): Promise<{ version: number; tickHz: number }> {
    const { default: createMathspace } = await import('../wasm/mathspace.mjs')
    const m = await createMathspace({
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? MAIN_WASM_URL : prefix + path),
    })
    if (this.disposed) throw new Error('sim host disposed')
    const d = new SimDriver(m, seed)
    if (restore !== undefined) d.restore(restore)
    this.driver = d
    this.emitSnapshot(d)
    this.raf = requestAnimationFrame(this.frame)
    return { version: d.version(), tickHz: TICK_HZ }
  }

  private readonly frame = (now: number): void => {
    const d = this.driver
    if (d === null || this.disposed) return
    d.advance(now)
    if (d.tick() !== this.lastEmitted) this.emitSnapshot(d)
    this.raf = requestAnimationFrame(this.frame)
  }

  private emitSnapshot(d: SimDriver): void {
    const s = d.snapshot()
    this.lastEmitted = s.tick
    this.lastTick = s.tick
    for (const cb of this.subs.snapshot) cb(s)
  }

  private async withDriver<T>(f: (d: SimDriver) => T): Promise<T> {
    await this.ready
    const d = this.driver
    if (d === null || this.disposed) throw new Error('sim host disposed')
    return f(d)
  }

  private report(o: Outcome, ordinal: number | undefined): void {
    if (o.ok) {
      if (ordinal !== undefined) {
        const e: StrokeApplied = { ordinal, actionKind: o.actionKind, tick: o.tick, samples: o.samples }
        for (const cb of this.subs.strokeApplied) cb(e)
      }
      return
    }
    const e: DdError = { code: o.code, name: o.name, kind: o.actionKind }
    if (ordinal !== undefined) e.ordinal = ordinal
    for (const cb of this.subs.rejected) cb(e)
  }

  currentTick(): number {
    return this.lastTick
  }

  defineBrush(spec: BrushVersionSpec): Promise<number> {
    return this.withDriver((d) => {
      const o = d.defineBrush(spec)
      this.report(o, undefined)
      if (!o.ok) throw new DdRejected({ code: o.code, name: o.name, kind: o.actionKind })
      return o.result
    })
  }

  beginStroke(spec: StrokeBeginSpec): void {
    const d = this.driver
    if (d === null || this.disposed) return
    try {
      this.report(d.beginStroke(spec.ordinal, spec.brushVersionId, spec.frameQ16, spec.pressureSource), spec.ordinal)
    } catch (err: unknown) {
      console.error('[data-drawing] sim (main thread):', err instanceof Error ? err.message : String(err))
    }
  }

  pushSamples(ordinal: number, samples: RawSample[]): void {
    const d = this.driver
    if (d === null || this.disposed || samples.length === 0) return
    try {
      this.report(d.pushSamples(ordinal, samples), ordinal)
    } catch (err: unknown) {
      console.error('[data-drawing] sim (main thread):', err instanceof Error ? err.message : String(err))
    }
  }

  endStroke(ordinal: number): void {
    const d = this.driver
    if (d === null || this.disposed) return
    this.report(d.endStroke(ordinal), ordinal)
  }

  pause(paused: boolean): void {
    void this.withDriver((d) => d.pause(paused)).catch(() => {
      /* disposed */
    })
  }

  onSnapshot(cb: (s: Snapshot) => void): () => void {
    return subscribe(this.subs.snapshot, cb)
  }

  onRejected(cb: (e: DdError) => void): () => void {
    return subscribe(this.subs.rejected, cb)
  }

  onStrokeApplied(cb: (e: StrokeApplied) => void): () => void {
    return subscribe(this.subs.strokeApplied, cb)
  }

  hash(): Promise<Uint8Array> {
    return this.withDriver((d) => d.hash())
  }

  log(): Promise<LogEntry[]> {
    return this.withDriver((d) => d.log())
  }

  replayFromZero(): Promise<ReplayReport> {
    return this.withDriver((d) => d.replayFromZero())
  }

  /** Idempotent: stops the frame loop and destroys the sim instance. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.raf !== 0) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.driver?.destroy()
    this.driver = null
    this.subs.clear()
  }
}

/** The transport for `kind`, from a fresh seed or continuing a session from a RestorePoint. */
export function createTransport(kind: TransportKind, seed: number | bigint, options: TransportOptions = {}): SimHost {
  return kind === 'main' ? new MainThreadTransport(seed, options) : new WorkerTransport(seed, options)
}
