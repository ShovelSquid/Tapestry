/**
 * sim-host.ts — the async, transport-agnostic SimHost and its Worker transport.
 *
 * The renderer side only ever receives copies: every snapshot buffer is a
 * HEAPU8.slice() the worker transferred, never a view of the Wasm heap. The
 * main thread changes the sim only through recorded actions submitted here.
 *
 * Strokes (01-07): beginStroke / pushSamples / endStroke are fire-and-forget
 * posts keyed by the stroke ordinal; the Worker is the recorder and stamps
 * every sample with the tick it is applied at. Rejections come back through
 * onRejected with the ordinal. replayFromZero and MainThreadTransport (same
 * module, no worker) arrive in 01-08.
 */
import type { BrushVersionSpec } from './ddsim-abi'
import type { RawSample } from './input'
import simWorkerUrl from './sim.worker?worker&url'
import { spawnSameOriginModuleWorker } from './worker-spawn'

export interface StrokeBeginSpec {
  /** Session-unique, >= 1; the stroke id is (branch 0, ordinal). */
  ordinal: number
  brushVersionId: number
  /** The plane frame captured once at pen-down, as StrokeBegin records it (plane.ts frameToQ16). */
  frameQ16: Int32Array
  pressureSource: 0 | 1
}

export interface Snapshot {
  tick: number
  nodeCount: number
  /** nodeCount x NODE_STRIDE bytes, transferred copy. */
  nodes: ArrayBuffer
  bodyCount: number
  /** bodyCount x BODY_STRIDE bytes, transferred copy. */
  bodies: ArrayBuffer
}

export interface LogEntry {
  tick: number
  bytes: Uint8Array
}

export interface DdError {
  code: number
  name: string
  kind: number
  /** The stroke the rejected action belonged to, when it was a stroke action. */
  ordinal?: number
}

export interface SimHost {
  readonly ready: Promise<{ version: number; tickHz: number }>
  /** Tick of the last snapshot received. */
  currentTick(): number
  /** Resolves to the assigned brush version id; rejects with a DdError. */
  defineBrush(spec: BrushVersionSpec): Promise<number>
  /** Opens a stroke at the Worker's current tick (start_tick stamped there). Fire-and-forget. */
  beginStroke(spec: StrokeBeginSpec): void
  /** Records coalesced samples; the Worker stamps (tick, index) at arrival. Fire-and-forget. */
  pushSamples(ordinal: number, samples: RawSample[]): void
  /** Ends a stroke at the Worker's current tick. Fire-and-forget. */
  endStroke(ordinal: number): void
  pause(paused: boolean): void
  onSnapshot(cb: (s: Snapshot) => void): () => void
  onRejected(cb: (e: DdError) => void): () => void
  /** 32 bytes, taken at a tick boundary. */
  hash(): Promise<Uint8Array>
  /** Every accepted action in record order. */
  log(): Promise<LogEntry[]>
  dispose(): void
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

export type WorkerInbound =
  | { kind: 'init'; seed: bigint }
  | { kind: 'defineBrush'; id: number; spec: BrushVersionSpec }
  | { kind: 'beginStroke'; ordinal: number; brushVersionId: number; frameQ16: Int32Array; pressureSource: 0 | 1 }
  | { kind: 'samples'; ordinal: number; samples: RawSample[] }
  | { kind: 'endStroke'; ordinal: number }
  | { kind: 'pause'; paused: boolean }
  | { kind: 'hash'; id: number }
  | { kind: 'log'; id: number }
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

export class WorkerTransport implements SimHost {
  readonly ready: Promise<{ version: number; tickHz: number }>

  private readonly worker: Worker
  /** Releases the blob: trampoline the worker was spawned through. */
  private readonly revokeTrampoline: () => void
  private readonly pending = new Map<number, Pending>()
  private readonly snapshotSubs = new Set<(s: Snapshot) => void>()
  private readonly rejectedSubs = new Set<(e: DdError) => void>()
  private nextId = 1
  private lastTick = 0
  private disposed = false

  constructor(seed: number | bigint) {
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
    this.post({ kind: 'init', seed: BigInt(seed) })
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
    this.snapshotSubs.add(cb)
    return () => {
      this.snapshotSubs.delete(cb)
    }
  }

  onRejected(cb: (e: DdError) => void): () => void {
    this.rejectedSubs.add(cb)
    return () => {
      this.rejectedSubs.delete(cb)
    }
  }

  hash(): Promise<Uint8Array> {
    return this.request<Uint8Array>((id) => ({ kind: 'hash', id }))
  }

  log(): Promise<LogEntry[]> {
    return this.request<LogEntry[]>((id) => ({ kind: 'log', id }))
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
    this.snapshotSubs.clear()
    this.rejectedSubs.clear()
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
        for (const cb of this.snapshotSubs) cb(s)
        return
      }
      case 'applied':
        this.take(msg.id)?.resolve(msg.result as never)
        return
      case 'rejected': {
        const e: DdError = { code: msg.code, name: msg.name, kind: msg.actionKind }
        if (msg.ordinal !== undefined) e.ordinal = msg.ordinal
        if (msg.id !== undefined) this.take(msg.id)?.reject(new DdRejected(e))
        for (const cb of this.rejectedSubs) cb(e)
        return
      }
      case 'strokeApplied':
        return
      case 'hash':
        this.take(msg.id)?.resolve(msg.bytes as never)
        return
      case 'log':
        this.take(msg.id)?.resolve(msg.entries as never)
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
