/**
 * ms-sim.ts — one sim instance the way ddsim's C ABI presented it, over the
 * mathspace engine and the bridge (plan phase 7e).
 *
 * SimDriver stepped, hashed and snapshotted a `_dd_*` handle; this class is
 * that handle. `apply` runs the ddsim action through MsBridge.translate and
 * applies the mathspace actions it yields; `step` is the engine's step
 * followed by the bridge's emission pass; `hash` is ms_hash. The node and
 * body tables keep ddsim's byte layouts (NODE_STRIDE / BODY_STRIDE, the
 * decodeNodes/decodeBodies accessors in ddsim-abi.ts), so nothing that
 * renders a snapshot changes: the node table is kept here as one record
 * per emitted node in ascending id order (ddsim inserted at lower_bound;
 * nodes never change once emitted), appended from `bridge.emitted` after
 * every step, and the body table is read from the engine's notes.
 *
 * An engine refusal of a bridged action is an invariant failure, not a
 * result code: the bridge reproduced every ddsim rejection before it
 * changed anything, so the engine has no grounds left to refuse. It throws.
 */
import { BODY_STRIDE, NODE_STRIDE } from './ddsim-abi'
import { MsEngine, decodeSnapshot, msErrorName, type MathspaceModule } from './ms-abi'
import { MsBridge, bodyNoteId, type EmittedNode } from './ms-bridge'

export class MsSim {
  private readonly engine: MsEngine
  private readonly bridge = new MsBridge()
  /** NODE_STRIDE-byte records in ascending id order. */
  private readonly nodeRecords: Uint8Array[] = []
  private readonly nodeIds: bigint[] = []
  private destroyed = false

  constructor(mod: MathspaceModule, seed: bigint) {
    this.engine = new MsEngine(mod, seed)
    try {
      MsBridge.bootstrap(this.engine)
    } catch (err) {
      this.engine.destroy()
      throw err
    }
  }

  /** ddsim's dd_apply: the DD_ERR code; 0 means applied. */
  apply(bytes: Uint8Array): number {
    const tr = this.bridge.translate(bytes, this.tick())
    if (tr.code !== 0) return tr.code
    for (const a of tr.actions) this.mustApply(a, 'a bridged action')
    return 0
  }

  /** ddsim's dd_step: the engine step, then emission (and any end-of-tick body delete). */
  step(): void {
    this.engine.step()
    const tick = Number(this.engine.tick()) - 1
    const bodies = this.bodyNotes()
    for (const a of this.bridge.afterStep(bodies, tick)) this.mustApply(a, 'an emission action')
    for (const n of this.bridge.emitted) this.insertNode(n)
  }

  tick(): number {
    return Number(this.engine.tick())
  }

  hash(): Uint8Array {
    return this.engine.hashBytes()
  }

  nodeCount(): number {
    return this.nodeRecords.length
  }

  /** nodeCount x NODE_STRIDE bytes, a fresh copy in ascending id order. */
  nodeTable(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(new ArrayBuffer(this.nodeRecords.length * NODE_STRIDE))
    for (let i = 0; i < this.nodeRecords.length; i++) out.set(this.nodeRecords[i]!, i * NODE_STRIDE)
    return out
  }

  /**
   * Active strokes as ddsim listed them: a stroke that ended this tick is
   * already gone from ddsim's table (its body note lives until the step
   * integrates the end tick's samples; the bridge marks it `ending`).
   */
  private activeIds(): bigint[] {
    const ids: bigint[] = []
    for (const [id, st] of this.bridge.strokes) if (!st.ending) ids.push(id)
    return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }

  bodyCount(): number {
    return this.activeIds().length
  }

  /** bodyCount x BODY_STRIDE bytes in ascending stroke id order, as ddsim's sorted active list. */
  bodyTable(): Uint8Array<ArrayBuffer> {
    const ids = this.activeIds()
    const notes = this.bodyNotes()
    const out = new Uint8Array(new ArrayBuffer(ids.length * BODY_STRIDE))
    const dv = new DataView(out.buffer)
    ids.forEach((id, i) => {
      const st = this.bridge.strokes.get(id)!
      const note = notes.get(bodyNoteId(id))
      const pos = note?.get('pos') ?? [0n, 0n]
      const vel = note?.get('velocity') ?? [0n, 0n]
      const at = i * BODY_STRIDE
      dv.setBigUint64(at, id, true)
      dv.setBigInt64(at + 8, pos[0] ?? 0n, true)
      dv.setBigInt64(at + 16, pos[1] ?? 0n, true)
      dv.setBigInt64(at + 24, vel[0] ?? 0n, true)
      dv.setBigInt64(at + 32, vel[1] ?? 0n, true)
      dv.setBigInt64(at + 40, st.target[0], true)
      dv.setBigInt64(at + 48, st.target[1], true)
    })
    return out
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.engine.destroy()
  }

  private mustApply(action: Uint8Array, what: string): void {
    const rc = this.engine.apply(action)
    if (rc !== 0) throw new Error(`ms-sim: the engine refused ${what} at tick ${this.tick()}: ${msErrorName(rc)}`)
  }

  /** The active strokes' body notes only, decoded from the engine's snapshot. */
  private bodyNotes() {
    const wanted = new Set<bigint>()
    for (const id of this.bridge.strokes.keys()) wanted.add(bodyNoteId(id))
    return decodeSnapshot(this.engine.notesBytes(), wanted)
  }

  private insertNode(n: EmittedNode): void {
    const rec = new Uint8Array(NODE_STRIDE)
    const dv = new DataView(rec.buffer)
    dv.setBigUint64(0, n.id, true)
    dv.setBigInt64(8, n.x, true)
    dv.setBigInt64(16, n.y, true)
    dv.setBigInt64(24, n.z, true)
    dv.setBigInt64(32, n.weight, true)
    dv.setBigInt64(40, n.dirX, true)
    dv.setBigInt64(48, n.dirY, true)
    dv.setBigInt64(56, n.vx, true)
    dv.setBigInt64(64, n.vy, true)
    dv.setUint32(72, n.tick, true)
    dv.setUint32(76, n.brush, true)
    dv.setUint32(80, 0, true)
    dv.setUint32(84, 0, true)
    // lower_bound on id; the common case (the largest id so far) is a push.
    let lo = 0
    let hi = this.nodeIds.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.nodeIds[mid]! < n.id) lo = mid + 1
      else hi = mid
    }
    if (lo === this.nodeIds.length) {
      this.nodeIds.push(n.id)
      this.nodeRecords.push(rec)
    } else {
      this.nodeIds.splice(lo, 0, n.id)
      this.nodeRecords.splice(lo, 0, rec)
    }
  }
}
