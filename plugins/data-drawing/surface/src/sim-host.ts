/**
 * sim-host.ts — the async, transport-agnostic SimHost and its Worker transport.
 *
 * The renderer side only ever receives copies: every snapshot buffer is a
 * HEAPU8.slice() the worker transferred, never a view of the Wasm heap. The
 * main thread changes the sim only through recorded actions submitted here.
 *
 * beginStroke / pushSamples / endStroke / replayFromZero are added in 01-07
 * and 01-08; MainThreadTransport (same module, no worker) in 01-08.
 */
import type { BrushVersionSpec } from './ddsim-abi'

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
}

export interface SimHost {
  readonly ready: Promise<{ version: number; tickHz: number }>
  /** Tick of the last snapshot received. */
  currentTick(): number
  /** Resolves to the assigned brush version id; rejects with a DdError. */
  defineBrush(spec: BrushVersionSpec): Promise<number>
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
  | { kind: 'pause'; paused: boolean }
  | { kind: 'hash'; id: number }
  | { kind: 'log'; id: number }
  | { kind: 'dispose' }

export type WorkerOutbound =
  | { kind: 'ready'; version: number; tickHz: number }
  | ({ kind: 'snapshot' } & Snapshot)
  | { kind: 'applied'; id: number; tick: number; result: number }
  | { kind: 'rejected'; id: number; code: number; name: string; actionKind: number }
  | { kind: 'hash'; id: number; bytes: Uint8Array }
  | { kind: 'log'; id: number; entries: LogEntry[] }
  | { kind: 'error'; id?: number; message: string }

export class DdRejected extends Error implements DdError {
  readonly code: number
  readonly kind: number
  constructor(e: DdError) {
    super(`${e.name} (code ${e.code}, action kind ${e.kind})`)
    this.name = e.name
    this.code = e.code
    this.kind = e.kind
  }
}

interface Pending {
  resolve: (value: never) => void
  reject: (reason: unknown) => void
}

export class WorkerTransport implements SimHost {
  readonly ready: Promise<{ version: number; tickHz: number }>

  private readonly worker: Worker
  private readonly pending = new Map<number, Pending>()
  private readonly snapshotSubs = new Set<(s: Snapshot) => void>()
  private readonly rejectedSubs = new Set<(e: DdError) => void>()
  private nextId = 1
  private lastTick = 0
  private disposed = false

  constructor(seed: number | bigint) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
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
        this.take(msg.id)?.reject(new DdRejected(e))
        for (const cb of this.rejectedSubs) cb(e)
        return
      }
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
