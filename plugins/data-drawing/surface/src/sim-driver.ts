/**
 * sim-driver.ts — the ONE stepping / stamping / recording implementation
 * (01-08). The Worker (sim.worker.ts) and the main-thread transport
 * (sim-host.ts MainThreadTransport) both wrap a SimDriver; neither carries
 * its own accumulator or recorder, so "live" means the same thing on both
 * transports and the replay test drives exactly the code the surface runs.
 *
 * The driver never reads a clock: advance(now) is handed the wall time and
 * only decides HOW MANY dd_step() calls run (whole ticks from an
 * accumulator clamped to MAX_FRAME_MS; never a fractional step). Every
 * action is applied at the driver's current tick, which is the tick it
 * records in the session log — "apply at the start of the stamped tick".
 * Stroke samples arrive unstamped from the fence and are stamped here
 * (stampSamples, pure); the stamping state is committed only on DD_OK so
 * one rejected batch cannot cascade into DD_ERR_SAMPLE_ORDER.
 *
 * Replay-from-zero (SIM-03, phase success criterion 5): a second sim
 * instance is created from the same seed, the recorded log is applied tick
 * by tick up to the live tick, and its hash is compared with the live hash.
 * To locate a divergence, the live driver keeps a ring of the last
 * HASH_RING_SIZE hashes taken whenever a step lands on a multiple of
 * HASH_RING_EVERY ticks (one SHA-256 per second of sim time, taken right
 * after the step and therefore BEFORE any action of that tick is applied);
 * the replay hashes its instance at the same boundaries and reports the
 * first tick whose hash differs. A DIFF is reported, never reconciled: the
 * live state is not touched by the comparison (prohibition in 01-08-PLAN).
 *
 * The sim is reached only through the flat C ABI (_dd_*); HEAPU8 appears
 * here only for the action-byte copy-in and for slice() reads.
 */
import {
  ActionKind,
  BODY_STRIDE,
  DD_OK,
  HASH_BYTES,
  NODE_STRIDE,
  TICK_HZ,
  encodeDefineBrush,
  encodeStrokeBegin,
  encodeStrokeEnd,
  encodeStrokeSamples,
  errorName,
  stampSamples,
  strokeIdOf,
  type BrushVersionSpec,
  type DdsimModule,
  type SampleFields,
  type StampState,
} from './ddsim-abi'

/** Phase 1 records on branch 0 only. */
export const BRANCH = 0
export const TICK_MS = 1000 / TICK_HZ
/** A stalled tab catches up at most this much wall time per advance (whole ticks of it). */
export const MAX_FRAME_MS = 250
/** The live hash ring samples every 60th tick (one second of sim time at 60 Hz). */
export const HASH_RING_EVERY = 60
/** Entries kept in the ring: the last 64 seconds of sim time. */
export const HASH_RING_SIZE = 64

export interface Snapshot {
  tick: number
  nodeCount: number
  /** nodeCount x NODE_STRIDE bytes, a copy (transferred by the Worker transport). */
  nodes: ArrayBuffer
  bodyCount: number
  /** bodyCount x BODY_STRIDE bytes, a copy. */
  bodies: ArrayBuffer
}

export interface LogEntry {
  tick: number
  bytes: Uint8Array
}

/** The result of replaying the session log from tick zero into a fresh instance. */
export interface ReplayReport {
  liveHash: Uint8Array
  replayHash: Uint8Array
  liveTick: number
  nodeCount: number
  replayNodeCount: number
  /**
   * null when live and replay agree at every ring boundary and at the live
   * tick; otherwise the first tick at which they were seen to differ (a ring
   * boundary, the tick of an action the replay rejected, or the live tick).
   */
  firstDiffTick: number | null
}

export interface RingEntry {
  tick: number
  hash: Uint8Array
}

/** What a new transport is handed to continue a session: the log so far and the tick the live sim had reached. */
export interface RestorePoint {
  entries: LogEntry[]
  tick: number
}

export type Outcome =
  | { ok: true; tick: number; actionKind: number; samples: number; result: number }
  | { ok: false; tick: number; actionKind: number; code: number; name: string }

export function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Reads the (branch, ordinal) stroke id out of a recorded stroke action (payload offset 0 after the 8-byte header). */
function strokeOrdinalOf(bytes: Uint8Array): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Number(dv.getBigUint64(8, true) & 0xffffffffn)
}

export class SimDriver {
  readonly seed: bigint

  private readonly m: DdsimModule
  private sim: number
  private brushCount = 0
  private paused = false
  private acc = 0
  private last: number | null = null
  private readonly entries: LogEntry[] = []
  /** Per open stroke (by ordinal): the stamping state committed by the last accepted samples. */
  private readonly stamps = new Map<number, StampState>()
  private readonly ring: RingEntry[] = []
  private destroyed = false

  constructor(m: DdsimModule, seed: bigint) {
    this.m = m
    this.seed = seed
    this.sim = m._dd_create(seed)
    if (this.sim === 0) throw new Error('dd_create returned null')
  }

  // ---- read-only views ----------------------------------------------------

  version(): number {
    return this.m._dd_version()
  }

  tick(): number {
    return Number(this.m._dd_tick(this.sim))
  }

  nodeCount(): number {
    return this.m._dd_node_count(this.sim)
  }

  isPaused(): boolean {
    return this.paused
  }

  /** 32 bytes; a copy. */
  hash(): Uint8Array {
    return this.hashOf(this.sim)
  }

  /** Copies of the node and body tables (HEAPU8.slice), never views of the heap. */
  snapshot(): Snapshot {
    const m = this.m
    const nodeCount = m._dd_node_count(this.sim)
    const nodePtr = m._dd_nodes_ptr(this.sim)
    const nodes = m.HEAPU8.slice(nodePtr, nodePtr + nodeCount * NODE_STRIDE)
    const bodyCount = m._dd_body_count(this.sim)
    const bodyPtr = m._dd_body_ptr(this.sim)
    const bodies = m.HEAPU8.slice(bodyPtr, bodyPtr + bodyCount * BODY_STRIDE)
    return { tick: this.tick(), nodeCount, nodes: nodes.buffer, bodyCount, bodies: bodies.buffer }
  }

  /** Every accepted action in record order (ticks non-decreasing), as copies. */
  log(): LogEntry[] {
    return this.entries.map((e) => ({ tick: e.tick, bytes: e.bytes.slice() }))
  }

  /** The live hash ring, oldest first (copies). */
  hashRing(): RingEntry[] {
    return this.ring.map((r) => ({ tick: r.tick, hash: r.hash.slice() }))
  }

  // ---- time ----------------------------------------------------------------

  pause(paused: boolean): void {
    this.paused = paused
  }

  /** Restart the accumulator at `now` (after init or restore, so no wall time is owed). */
  resetClock(now: number): void {
    this.last = now
    this.acc = 0
  }

  /**
   * Drains whole ticks owed by the wall clock since the last call. Returns
   * how many ticks were stepped. The clock only ever decides the count.
   */
  advance(now: number): number {
    if (this.last === null) {
      this.last = now
      return 0
    }
    if (!this.paused) this.acc += Math.min(Math.max(0, now - this.last), MAX_FRAME_MS)
    this.last = now
    let n = 0
    while (this.acc >= TICK_MS) {
      this.stepOne()
      this.acc -= TICK_MS
      n += 1
    }
    return n
  }

  /** Steps exactly `n` ticks regardless of the clock (tests, restore). */
  stepTicks(n: number): void {
    for (let i = 0; i < n; i++) this.stepOne()
  }

  private stepOne(): void {
    this.m._dd_step(this.sim)
    const t = this.tick()
    if (t % HASH_RING_EVERY === 0) {
      this.ring.push({ tick: t, hash: this.hash() })
      if (this.ring.length > HASH_RING_SIZE) this.ring.shift()
    }
  }

  // ---- recorded actions ------------------------------------------------------

  /** Encodes DefineBrush as the next version id and applies it at the current tick. Throws on an unencodable spec. */
  defineBrush(spec: BrushVersionSpec): Outcome {
    const bytes = encodeDefineBrush(spec, this.brushCount + 1)
    const tick = this.tick()
    const rc = this.applyTo(this.sim, bytes)
    if (rc !== DD_OK) return { ok: false, tick, actionKind: ActionKind.DefineBrush, code: rc, name: errorName(rc) }
    this.brushCount += 1
    this.entries.push({ tick, bytes })
    return { ok: true, tick, actionKind: ActionKind.DefineBrush, samples: 0, result: this.brushCount }
  }

  /** Opens a stroke at the current tick (start_tick stamped here). Throws on an unencodable frame. */
  beginStroke(ordinal: number, brushVersionId: number, frameQ16: ArrayLike<number>, pressureSource: 0 | 1): Outcome {
    const tick = this.tick()
    const bytes = encodeStrokeBegin(strokeIdOf(BRANCH, ordinal), brushVersionId, tick, pressureSource, frameQ16)
    const o = this.applyStroke(ordinal, ActionKind.StrokeBegin, bytes, tick, 0)
    if (o.ok) this.stamps.set(ordinal, { tick, nextIndex: 0 })
    return o
  }

  /** Stamps the samples with (current tick, index) and applies them; the stamping state is committed only on DD_OK. */
  pushSamples(ordinal: number, samples: readonly SampleFields[]): Outcome {
    const tick = this.tick()
    // A stroke whose begin was rejected has no state; stamping from zero
    // lets the sim answer DD_ERR_STROKE_STATE so nothing is silently lost.
    const state = this.stamps.get(ordinal) ?? { tick: -1, nextIndex: 0 }
    const stamped = stampSamples(state, tick, samples)
    const bytes = encodeStrokeSamples(strokeIdOf(BRANCH, ordinal), stamped.samples)
    const o = this.applyStroke(ordinal, ActionKind.StrokeSamples, bytes, tick, stamped.samples.length)
    if (o.ok) this.stamps.set(ordinal, stamped.state)
    return o
  }

  /** Ends a stroke at the current tick (the sim integrates this tick's pending samples first). */
  endStroke(ordinal: number): Outcome {
    const tick = this.tick()
    const bytes = encodeStrokeEnd(strokeIdOf(BRANCH, ordinal), tick)
    const o = this.applyStroke(ordinal, ActionKind.StrokeEnd, bytes, tick, 0)
    if (o.ok) this.stamps.delete(ordinal)
    return o
  }

  private applyStroke(ordinal: number, actionKind: number, bytes: Uint8Array, tick: number, samples: number): Outcome {
    void ordinal
    const rc = this.applyTo(this.sim, bytes)
    if (rc !== DD_OK) return { ok: false, tick, actionKind, code: rc, name: errorName(rc) }
    this.entries.push({ tick, bytes })
    return { ok: true, tick, actionKind, samples, result: 0 }
  }

  // ---- restore (transport switch) -----------------------------------------------

  /**
   * Brings a FRESH driver to the state a live driver had at `point.tick`
   * after recording `point.entries`: the entries are applied at their ticks
   * from zero and the driver is stepped to `point.tick` (populating the
   * hash ring on the way), then the entries become this driver's log and
   * the brush count and open-stroke stamping states are rebuilt from them.
   * The switch itself is therefore a replay. Returns how many entries the
   * sim rejected (0 for a log it recorded itself).
   */
  restore(point: RestorePoint): number {
    if (this.entries.length > 0 || this.tick() !== 0) throw new Error('restore needs a fresh driver')
    const byTick = groupByTick(point.entries)
    let rejected = 0
    for (let t = 0; t <= point.tick; t++) {
      for (const e of byTick.get(t) ?? []) {
        const rc = this.applyTo(this.sim, e.bytes)
        if (rc !== DD_OK) rejected += 1
      }
      if (t < point.tick) this.stepOne()
    }
    for (const e of point.entries) {
      const kind = e.bytes[0]
      this.entries.push({ tick: e.tick, bytes: e.bytes.slice() })
      if (kind === ActionKind.DefineBrush) {
        this.brushCount += 1
      } else if (kind === ActionKind.StrokeBegin) {
        this.stamps.set(strokeOrdinalOf(e.bytes), { tick: e.tick, nextIndex: 0 })
      } else if (kind === ActionKind.StrokeSamples) {
        const dv = new DataView(e.bytes.buffer, e.bytes.byteOffset, e.bytes.byteLength)
        const count = dv.getUint32(16, true)
        if (count > 0) {
          const lastAt = 20 + (count - 1) * 24
          this.stamps.set(strokeOrdinalOf(e.bytes), { tick: dv.getUint32(lastAt, true), nextIndex: dv.getUint16(lastAt + 4, true) + 1 })
        }
      } else if (kind === ActionKind.StrokeEnd) {
        this.stamps.delete(strokeOrdinalOf(e.bytes))
      }
    }
    return rejected
  }

  // ---- replay from zero ----------------------------------------------------------

  /**
   * Replays `entries` (default: this driver's own session log) from tick
   * zero into a second instance created from the same seed, up to the live
   * tick, and compares hashes: at every ring boundary (before that tick's
   * actions, exactly as the ring was taken) and at the live tick (after its
   * actions, exactly as the live hash is taken). The second instance is
   * destroyed before returning; the live instance is only read.
   */
  replayFromZero(entries: readonly LogEntry[] = this.entries): ReplayReport {
    const m = this.m
    const liveTick = this.tick()
    const liveHash = this.hash()
    const nodeCount = this.nodeCount()
    const ringByTick = new Map<number, Uint8Array>()
    for (const r of this.ring) ringByTick.set(r.tick, r.hash)
    const byTick = groupByTick(entries)

    const sim2 = m._dd_create(this.seed)
    if (sim2 === 0) throw new Error('dd_create returned null for the replay instance')
    try {
      let firstDiffTick: number | null = null
      for (let t = 0; t <= liveTick; t++) {
        const expected = ringByTick.get(t)
        if (expected !== undefined && firstDiffTick === null && !hashesEqual(this.hashOf(sim2), expected)) firstDiffTick = t
        for (const e of byTick.get(t) ?? []) {
          const rc = this.applyTo(sim2, e.bytes)
          if (rc !== DD_OK && firstDiffTick === null) firstDiffTick = t
        }
        if (t < liveTick) m._dd_step(sim2)
      }
      const replayHash = this.hashOf(sim2)
      const replayNodeCount = m._dd_node_count(sim2)
      if (firstDiffTick === null && (!hashesEqual(liveHash, replayHash) || replayNodeCount !== nodeCount)) firstDiffTick = liveTick
      return { liveHash, replayHash, liveTick, nodeCount, replayNodeCount, firstDiffTick }
    } finally {
      m._dd_destroy(sim2)
    }
  }

  // ---- lifetime ----------------------------------------------------------------

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.m._dd_destroy(this.sim)
    this.sim = 0
  }

  // ---- ABI helpers ---------------------------------------------------------------

  private applyTo(sim: number, bytes: Uint8Array): number {
    const m = this.m
    const ptr = m._malloc(bytes.length)
    try {
      m.HEAPU8.set(bytes, ptr)
      return m._dd_apply(sim, ptr, bytes.length)
    } finally {
      m._free(ptr)
    }
  }

  private hashOf(sim: number): Uint8Array {
    const m = this.m
    const ptr = m._malloc(HASH_BYTES)
    try {
      m._dd_hash(sim, ptr)
      return m.HEAPU8.slice(ptr, ptr + HASH_BYTES)
    } finally {
      m._free(ptr)
    }
  }
}

function groupByTick(entries: readonly LogEntry[]): Map<number, LogEntry[]> {
  const byTick = new Map<number, LogEntry[]>()
  for (const e of entries) {
    const list = byTick.get(e.tick)
    if (list === undefined) byTick.set(e.tick, [e])
    else list.push(e)
  }
  return byTick
}
