/**
 * ms-bridge.ts — ddsim's action grammar (kinds 1..4) translated into
 * mathspace actions (plan phase 7c).
 *
 * The recorded log keeps its bytes: DefineBrush, StrokeBegin, StrokeSamples
 * and StrokeEnd stay the surface's wire format and the .actions fixtures
 * stay valid. What changes is who integrates: the brush body is now a
 * note in a dim-2 space (the stroke plane's (u, v)) under the `brush`
 * preset's unary force rule
 *     force = self.k * (self.target - self.pos) - sqrt(self.k) * self.velocity
 * which the engine integrates once per tick, bit-equal to ddsim's
 * body_substep at h = 1 (tests/mathspace/brush_body_test.cpp). The bridge
 * keeps what the engine has no field for — the brush table and the active
 * strokes' planes and sample bookkeeping — and validates every action
 * exactly as sim.cpp did, with the same DD_ERR codes, BEFORE it changes
 * anything: a rejected action leaves the bridge and the world untouched.
 *
 * Per kind:
 *   DefineBrush   validated like validate_brush (reject, never clamp) and
 *                 kept in the table with k = 1 / mass in fx64; no actions.
 *   StrokeBegin   CreateNote for the body plus SetField `k` and `spacing`
 *                 (the mass lives only in `k`, the one division ddsim made
 *                 in derive_params; the note carries no `mass`). The body
 *                 has no `pos` yet, so the rule does not visit it — ddsim
 *                 also held the body still until the first sample.
 *   StrokeSamples SetField `target` from the tick's LAST sample (one
 *                 engine step per tick; STATE.md Decisions, sub-steps),
 *                 and on the first sample ever also `pos` = that first
 *                 sample and `velocity` = 0, where ddsim placed the body.
 *   StrokeEnd     DeleteNote for the body. ddsim integrated the end tick's
 *                 samples inside the StrokeEnd and emitted from them, and
 *                 skipped the tick entirely when the end tick had none. So:
 *                 with no samples this tick the body is deleted at once
 *                 (the step never sees it, as ddsim's never did); with
 *                 samples the stroke is marked `ending` and the delete is
 *                 returned by `afterStep`, after that tick's step and
 *                 emission, so the end tick behaves like every other tick.
 *
 * Emission (plan phase 7d, ddsim/rules/emit.hpp ported): the engine has
 * no field for path length or a per-stroke index, so `afterStep` runs
 * once per tick after `engine.step()` over the notes snapshot. For each
 * active stroke in id order it takes p0 = the body's pos as of the last
 * pass (or the first sample, where ddsim placed the body), p1 = the
 * body's `pos` now, updates the stroke's direction from `velocity` with
 * DD_DIR_EPS exactly as body_substep did, and walks p0 -> p1 emitting a
 * node every `spacing` of path with the tick's last pressure. Emitted
 * nodes are notes of a second, dim-3 space (NODE_SPACE_ID) that holds no
 * rule: `pos` is the plane transform of (u, v) (origin + u right + v up,
 * fx64 from the stroke's recorded frame), plus `weight` (curve_weight),
 * `dir`, `velocity`, `tick` and `brush`. Their `velocity` is dim 2 while
 * their `pos` is dim 3, so the integrator never moves them. The node cap
 * DD_MAX_NODES is the bridge's count (nothing deletes a node).
 *
 * Ids: the body note is make_node_id(branch, ordinal, BODY_INDEX) with
 * BODY_INDEX = 2^24 - 1, an emission index no stroke reaches
 * (DD_MAX_NODES is 2^20), so bodies and emitted nodes share the ddsim id
 * layout without colliding. The spaces, rule and the compile-time
 * template note take the small ids no stroke id can produce (an ordinal
 * of at least 1 puts every stroke-derived id at or above 2^24).
 */
import {
  MsNoteKind,
  encodeBindField,
  encodeCreateNote,
  encodeCreateSpace,
  encodeDeleteNote,
  encodeSetField,
  fxDiv,
  fxFromInt,
  fxFromQ16,
  fxMul,
  fxSqrt,
  fxWrap,
  FX_ONE,
  type CompileResult,
  type MsSnapshot,
} from './ms-abi'
import {
  ACTION_HEADER_BYTES,
  ACTION_VERSION,
  ActionKind,
  CURVE_KNOTS,
  MAX_DESC_BYTES,
  MAX_SAMPLES_PER_ACTION,
  MAX_SAMPLES_PER_TICK,
  PRESSURE_MAX,
  SAMPLE_BYTES,
  STROKE_BEGIN_BYTES,
  STROKE_END_BYTES,
} from './ddsim-abi'

// The DD_ERR codes of ddsim_c.h that kinds 1..4 can produce.
export const BridgeError = {
  Ok: 0,
  BadHeader: 1,
  UnknownKind: 2,
  BadLength: 3,
  TickMismatch: 4,
  BrushId: 5,
  BrushInvalid: 6,
  StrokeState: 7,
  SampleOrder: 8,
  Limit: 9,
  SampleRange: 11,
} as const

export const BODY_SPACE_ID = 1n
export const BODY_RULE_ID = 2n
export const TEMPLATE_NOTE_ID = 3n
export const BODY_SPACE_DIM = 2
export const NODE_SPACE_ID = 4n
export const NODE_SPACE_DIM = 3
export const BRUSH_FORCE = 'self.k * (self.target - self.pos) - sqrt(self.k) * self.velocity'

export const MAX_BRUSHES = 65535
export const MAX_ACTIVE_STROKES = 8
export const BODY_INDEX = 0xffffff
/** DD_MAX_NODES: the emission cap, shared by every stroke. */
export const MAX_NODES = 1 << 20
const INDEX_MASK = 0xffffff
/** DD_DIR_EPS: |v|^2 below this keeps the previous direction. */
const DIR_EPS = FX_ONE >> 16n
const STROKE_ID_MASK = (1n << 40n) - 1n
const ORDINAL_MASK = 0xffffffffn
const TILT_MAX = 90
const TWIST_MAX = 359
const SAMPLE_FLAGS_MASK = 7

/** ddsim's make_node_id(branch, ordinal, index): (branch << 56) | (ordinal << 24) | index. */
export function makeNodeId(branch: number, ordinal: number, index: number): bigint {
  return ((BigInt(branch) & 0xffn) << 56n) | ((BigInt(ordinal) & ORDINAL_MASK) << 24n) | (BigInt(index) & 0xffffffn)
}

/** The body note of a stroke: its (branch, ordinal) at the index no emission reaches. */
export function bodyNoteId(strokeId: bigint): bigint {
  return makeNodeId(Number((strokeId >> 32n) & 0xffn), Number(strokeId & ORDINAL_MASK), BODY_INDEX)
}

export interface BrushEntry {
  id: number
  /** UTF-8 bytes as recorded; equality is byte-wise. */
  description: Uint8Array
  mass: bigint
  radius: bigint
  spacing: bigint
  curve: number[]
  /** k_t = 1 / mass in fx64 (derive_params); the rule takes sqrt(k) itself. */
  k: bigint
}

export interface ActiveStroke {
  id: bigint
  brushId: number
  startTick: number
  pressureSource: number
  /** origin[3] | right[3] | up[3], fx64 from the Q16.16 wire (for 7d's emission). */
  plane: bigint[]
  hasTarget: boolean
  target: [bigint, bigint]
  lastPressure: number
  /** Sample bookkeeping: the tick and index of the last accepted sample and how many this tick holds. */
  lastSampleTick: number
  lastSampleIndex: number
  pendingCount: number
  /** The body's pos as of the last emission pass: p0 of the next segment. */
  pos: [bigint, bigint]
  /** ddsim's dir_x/dir_y: unit velocity, kept while |v|^2 < DD_DIR_EPS. */
  dir: [bigint, bigint]
  /** ddsim's path_accum: path carried past the last emitted node. */
  pathAccum: bigint
  /** ddsim's next_emission_index: per stroke from 0, never global. */
  nextEmissionIndex: number
  /** StrokeEnd arrived this tick with samples: delete after this tick's step and emission. */
  ending: boolean
}

/** One emitted node as ddsim's Node held it (raw Q32.32 lanes), for the surface's node table. */
export interface EmittedNode {
  id: bigint
  x: bigint
  y: bigint
  z: bigint
  weight: bigint
  dirX: bigint
  dirY: bigint
  vx: bigint
  vy: bigint
  tick: number
  brush: number
}

export interface Translation {
  /** A BridgeError code; 0 with the mathspace actions to apply, in order. */
  code: number
  actions: Uint8Array[]
}

/** The subset of MsEngine the bootstrap needs. */
export interface BootstrapEngine {
  apply(bytes: Uint8Array): number
  compile(noteId: bigint, text: string): CompileResult
}

class ByteReader {
  private pos = 0
  private readonly view: DataView
  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  remaining(): number { return this.buf.length - this.pos }
  atEnd(): boolean { return this.pos === this.buf.length }
  private take(n: number): number | null {
    if (this.pos + n > this.buf.length) return null
    const at = this.pos
    this.pos += n
    return at
  }
  u8(): number | null { const at = this.take(1); return at === null ? null : this.view.getUint8(at) }
  i8(): number | null { const at = this.take(1); return at === null ? null : this.view.getInt8(at) }
  u16(): number | null { const at = this.take(2); return at === null ? null : this.view.getUint16(at, true) }
  u32(): number | null { const at = this.take(4); return at === null ? null : this.view.getUint32(at, true) }
  i32(): number | null { const at = this.take(4); return at === null ? null : this.view.getInt32(at, true) }
  u64(): bigint | null { const at = this.take(8); return at === null ? null : this.view.getBigUint64(at, true) }
  i64(): bigint | null { const at = this.take(8); return at === null ? null : this.view.getBigInt64(at, true) }
  bytes(n: number): Uint8Array | null { const at = this.take(n); return at === null ? null : this.buf.slice(at, at + n) }
}

const reject = (code: number): Translation => ({ code, actions: [] })

function fieldScalar(name: string, v: bigint) { return { name, lanes: [v] } }
function fieldVec2(name: string, x: bigint, y: bigint) { return { name, lanes: [x, y] } }
function fieldVec3(name: string, x: bigint, y: bigint, z: bigint) { return { name, lanes: [x, y, z] } }

/**
 * curve_weight: piecewise-linear over the 17 u16 knots with integer
 * interpolation, i = p >> 12, frac = p & 4095, value = k[i] + ((k[i+1] -
 * k[i]) * frac) >> 12 (arithmetic shift), weight = value / 65536 in Q32.32.
 */
export function curveWeight(curve: readonly number[], pressure: number): bigint {
  const i = pressure >> 12
  const frac = pressure & 4095
  const k0 = curve[i]!
  const k1 = curve[i + 1]!
  const value = k0 + (((k1 - k0) * frac) >> 12)
  return BigInt(value) << 16n
}

/**
 * The bridge's own state: the brush table and the active strokes. One per
 * world; `bootstrap` prepares the world it translates into.
 */
export class MsBridge {
  readonly brushes: BrushEntry[] = []
  readonly strokes = new Map<bigint, ActiveStroke>()
  /** Nodes emitted so far (ddsim's state.nodes.size()); the cap is MAX_NODES. */
  nodeCount = 0
  /** Stroke ids that have emitted a node: ddsim's stroke_in_use found them in the node table. */
  readonly usedStrokes = new Set<bigint>()
  /** The nodes the last `afterStep` emitted, in emission order (ids ascend within a stroke). */
  emitted: EmittedNode[] = []

  /**
   * Prepares a fresh world for the bridge: the body space, the rule with
   * the brush force bound, compiled against a template note that carries
   * the body fields (ms_compile takes field dims from the notes present)
   * and is deleted again. Throws on any engine refusal: this is setup on
   * an empty world and cannot legitimately fail.
   */
  static bootstrap(engine: BootstrapEngine): void {
    const must = (what: string, rc: number): void => {
      if (rc !== 0) throw new Error(`ms-bridge bootstrap: ${what} rejected with ms_error ${rc}`)
    }
    must('CreateSpace', engine.apply(encodeCreateSpace(BODY_SPACE_ID, BODY_SPACE_DIM)))
    must('CreateSpace nodes', engine.apply(encodeCreateSpace(NODE_SPACE_ID, NODE_SPACE_DIM)))
    must('CreateNote template', engine.apply(encodeCreateNote(TEMPLATE_NOTE_ID, BODY_SPACE_ID, MsNoteKind.Note)))
    must('template pos', engine.apply(encodeSetField(TEMPLATE_NOTE_ID, fieldVec2('pos', 0n, 0n))))
    must('template velocity', engine.apply(encodeSetField(TEMPLATE_NOTE_ID, fieldVec2('velocity', 0n, 0n))))
    must('template target', engine.apply(encodeSetField(TEMPLATE_NOTE_ID, fieldVec2('target', 0n, 0n))))
    must('template k', engine.apply(encodeSetField(TEMPLATE_NOTE_ID, fieldScalar('k', FX_ONE))))
    must('CreateNote rule', engine.apply(encodeCreateNote(BODY_RULE_ID, BODY_SPACE_ID, MsNoteKind.Rule)))
    must('rule scope', engine.apply(encodeSetField(BODY_RULE_ID, fieldScalar('scope', 0n))))
    const compiled = engine.compile(BODY_RULE_ID, BRUSH_FORCE)
    if ('error' in compiled) throw new Error(`ms-bridge bootstrap: force did not compile: ${compiled.error} at ${compiled.where}`)
    must('BindField force', engine.apply(encodeBindField(BODY_RULE_ID, 'force', compiled.code)))
    must('DeleteNote template', engine.apply(encodeDeleteNote(TEMPLATE_NOTE_ID)))
  }

  /**
   * Translates one ddsim action applied at `tick`. Returns the DD_ERR code
   * sim.cpp would have returned and, on 0, the mathspace actions to apply
   * in order. The bridge changes state only on 0.
   */
  translate(action: Uint8Array, tick: number): Translation {
    const r = new ByteReader(action)
    const kind = r.u8()
    const version = r.u8()
    const reserved = r.u16()
    const payloadLen = r.u32()
    if (kind === null || version === null || reserved === null || payloadLen === null) return reject(BridgeError.BadHeader)
    if (version !== ACTION_VERSION || reserved !== 0) return reject(BridgeError.BadHeader)
    if (payloadLen !== action.length - ACTION_HEADER_BYTES) return reject(BridgeError.BadLength)
    switch (kind) {
      case ActionKind.DefineBrush: return this.defineBrush(r)
      case ActionKind.StrokeBegin: return this.strokeBegin(r, tick)
      case ActionKind.StrokeSamples: return this.strokeSamples(r, tick)
      case ActionKind.StrokeEnd: return this.strokeEnd(r, tick)
      default: return reject(BridgeError.UnknownKind)
    }
  }

  private defineBrush(r: ByteReader): Translation {
    const id = r.u32()
    const descLen = r.u32()
    if (id === null || descLen === null) return reject(BridgeError.BadLength)
    const description = r.bytes(descLen)
    const mass = r.i64()
    const radius = r.i64()
    const spacing = r.i64()
    if (description === null || mass === null || radius === null || spacing === null) return reject(BridgeError.BadLength)
    const curve: number[] = []
    for (let i = 0; i < CURVE_KNOTS; i++) {
      const knot = r.u16()
      if (knot === null) return reject(BridgeError.BadLength)
      curve.push(knot)
    }
    if (!r.atEnd()) return reject(BridgeError.BadLength)
    if (id !== this.brushes.length + 1) return reject(BridgeError.BrushId)
    if (this.brushes.length >= MAX_BRUSHES) return reject(BridgeError.Limit)
    // validate_brush: reject, never clamp.
    if (description.length < 1 || description.length > MAX_DESC_BYTES) return reject(BridgeError.BrushInvalid)
    if (mass <= 0n || radius <= 0n || spacing <= 0n) return reject(BridgeError.BrushInvalid)
    // Stability: 0 < k_t <= 1 and 0 < c_t = sqrt(k_t) <= 1; the second
    // follows from the first (sqrt is monotone and floor(sqrt(k 2^32)) > 0
    // for any k >= 1 raw), so only k_t is checked.
    const k = fxDiv(FX_ONE, mass)
    if (k <= 0n || k > FX_ONE) return reject(BridgeError.BrushInvalid)
    this.brushes.push({ id, description, mass, radius, spacing, curve, k })
    return { code: BridgeError.Ok, actions: [] }
  }

  private strokeBegin(r: ByteReader, tick: number): Translation {
    if (r.remaining() !== STROKE_BEGIN_BYTES) return reject(BridgeError.BadLength)
    const strokeId = r.u64()!
    const brushId = r.u32()!
    const startTick = r.u32()!
    const pressureSource = r.u8()!
    const pad = [r.u8()!, r.u8()!, r.u8()!]
    const plane: bigint[] = []
    for (let i = 0; i < 9; i++) plane.push(fxFromQ16(r.i32()!))
    if (pad[0] !== 0 || pad[1] !== 0 || pad[2] !== 0 || pressureSource > 1) return reject(BridgeError.SampleRange)
    if (startTick !== tick) return reject(BridgeError.TickMismatch)
    if (brushId === 0 || brushId > this.brushes.length) return reject(BridgeError.BrushId)
    const ordinal = strokeId & ORDINAL_MASK
    if (ordinal === 0n || (strokeId & ~STROKE_ID_MASK) !== 0n || this.strokes.has(strokeId) || this.usedStrokes.has(strokeId)) {
      return reject(BridgeError.StrokeState)
    }
    if (this.strokes.size >= MAX_ACTIVE_STROKES) return reject(BridgeError.Limit)
    const brush = this.brushes[brushId - 1]!
    this.strokes.set(strokeId, {
      id: strokeId,
      brushId,
      startTick,
      pressureSource,
      plane,
      hasTarget: false,
      target: [0n, 0n],
      lastPressure: 0,
      lastSampleTick: 0,
      lastSampleIndex: 0,
      pendingCount: 0,
      pos: [0n, 0n],
      dir: [FX_ONE, 0n],
      pathAccum: 0n,
      nextEmissionIndex: 0,
      ending: false,
    })
    const body = bodyNoteId(strokeId)
    return {
      code: BridgeError.Ok,
      actions: [
        encodeCreateNote(body, BODY_SPACE_ID, MsNoteKind.Note),
        encodeSetField(body, fieldScalar('k', brush.k)),
        encodeSetField(body, fieldScalar('spacing', brush.spacing)),
      ],
    }
  }

  private strokeSamples(r: ByteReader, tick: number): Translation {
    const strokeId = r.u64()
    const count = r.u32()
    if (strokeId === null || count === null) return reject(BridgeError.BadLength)
    if (r.remaining() !== count * SAMPLE_BYTES) return reject(BridgeError.BadLength)
    const st = this.strokes.get(strokeId)
    if (st === undefined || st.ending) return reject(BridgeError.StrokeState)
    if (count < 1 || count > MAX_SAMPLES_PER_ACTION) return reject(BridgeError.Limit)
    const brush = this.brushes[st.brushId - 1]!
    const samples: Array<{ tick: number; index: number; pressure: number; u: number; v: number; inRange: boolean }> = []
    for (let i = 0; i < count; i++) {
      const sTick = r.u32()!
      const index = r.u16()!
      const pressure = r.u16()!
      const u = r.i32()!
      const v = r.i32()!
      const tiltX = r.i8()!
      const tiltY = r.i8()!
      const twist = r.u16()!
      const flags = r.u8()!
      const pad = [r.u8()!, r.u8()!, r.u8()!]
      const inRange = pressure <= PRESSURE_MAX && tiltX <= TILT_MAX && tiltX >= -TILT_MAX && tiltY <= TILT_MAX &&
        tiltY >= -TILT_MAX && twist <= TWIST_MAX && (flags & ~SAMPLE_FLAGS_MASK) === 0 &&
        pad[0] === 0 && pad[1] === 0 && pad[2] === 0
      samples.push({ tick: sTick, index, pressure, u, v, inRange })
    }
    // sim.cpp's order of checks: tick, index order, per-tick limit, range.
    for (const s of samples) if (s.tick !== tick) return reject(BridgeError.TickMismatch)
    const pending = st.lastSampleTick === tick ? st.pendingCount : 0
    let expected = pending === 0 ? 0 : st.lastSampleIndex + 1
    for (const s of samples) {
      if (s.index !== expected) return reject(BridgeError.SampleOrder)
      expected += 1
    }
    if (pending + count > MAX_SAMPLES_PER_TICK) return reject(BridgeError.Limit)
    for (const s of samples) if (!s.inRange) return reject(BridgeError.SampleRange)

    const first = samples[0]!
    const last = samples[count - 1]!
    const body = bodyNoteId(strokeId)
    const actions: Uint8Array[] = []
    if (!st.hasTarget) {
      // ddsim placed the body on the first sample ever, at rest, facing
      // +u, with a full spacing carried so node 0 lands on the pen-down point.
      st.pos = [fxFromQ16(first.u), fxFromQ16(first.v)]
      st.dir = [FX_ONE, 0n]
      st.pathAccum = brush.spacing
      actions.push(encodeSetField(body, fieldVec2('pos', st.pos[0], st.pos[1])))
      actions.push(encodeSetField(body, fieldVec2('velocity', 0n, 0n)))
      st.hasTarget = true
    }
    st.target = [fxFromQ16(last.u), fxFromQ16(last.v)]
    actions.push(encodeSetField(body, fieldVec2('target', st.target[0], st.target[1])))
    st.lastPressure = last.pressure
    st.lastSampleTick = tick
    st.lastSampleIndex = last.index
    st.pendingCount = pending + count
    return { code: BridgeError.Ok, actions }
  }

  private strokeEnd(r: ByteReader, tick: number): Translation {
    if (r.remaining() !== STROKE_END_BYTES) return reject(BridgeError.BadLength)
    const strokeId = r.u64()!
    const endTick = r.u32()!
    const st = this.strokes.get(strokeId)
    if (st === undefined || st.ending) return reject(BridgeError.StrokeState)
    if (endTick !== tick) return reject(BridgeError.TickMismatch)
    if (st.lastSampleTick === tick && st.pendingCount > 0) {
      // ddsim integrated and emitted these samples inside the StrokeEnd;
      // here the step does it, and afterStep deletes the body.
      st.ending = true
      return { code: BridgeError.Ok, actions: [] }
    }
    this.strokes.delete(strokeId)
    return { code: BridgeError.Ok, actions: [encodeDeleteNote(bodyNoteId(strokeId))] }
  }

  /**
   * The emission pass for the tick just stepped: reads each active body's
   * `pos` and `velocity` from `notes` (the engine's snapshot after
   * `step()`), walks the segment since the last pass, and returns the
   * actions that create the emitted nodes, followed by the DeleteNote of
   * every stroke that ended this tick. Strokes go in id order, as ddsim's
   * sorted active list did. Apply the result before the next tick's actions.
   */
  afterStep(notes: MsSnapshot, tick: number): Uint8Array[] {
    const actions: Uint8Array[] = []
    this.emitted = []
    const ids = [...this.strokes.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    for (const id of ids) {
      const st = this.strokes.get(id)!
      if (st.hasTarget) {
        const body = notes.get(bodyNoteId(id))
        if (body === undefined) throw new Error(`ms-bridge: no body note for stroke ${id} at tick ${tick}`)
        const pos = body.get('pos')
        const vel = body.get('velocity')
        if (pos === undefined || vel === undefined || pos.length !== 2 || vel.length !== 2) {
          throw new Error(`ms-bridge: body of stroke ${id} lost pos or velocity at tick ${tick}`)
        }
        const p1: [bigint, bigint] = [pos[0]!, pos[1]!]
        // body_substep's direction update from the velocity after the step.
        const v2 = fxWrap(fxMul(vel[0]!, vel[0]!) + fxMul(vel[1]!, vel[1]!))
        if (v2 >= DIR_EPS) {
          const mag = fxSqrt(v2)
          st.dir = [fxDiv(vel[0]!, mag), fxDiv(vel[1]!, mag)]
        }
        this.emitSegment(st, st.pos, p1, [vel[0]!, vel[1]!], tick, actions)
        st.pos = p1
      }
      if (st.ending) {
        this.strokes.delete(id)
        actions.push(encodeDeleteNote(bodyNoteId(id)))
      }
    }
    return actions
  }

  /**
   * emit_segment: walk p0 -> p1 and emit a node every `spacing` of path,
   * carrying the leftover into the next segment. When the node table
   * fills, the rest of the segment's path is discarded (pathAccum = 0) so
   * a hostile spacing cannot spin the loop past the cap.
   */
  private emitSegment(st: ActiveStroke, p0: readonly [bigint, bigint], p1: readonly [bigint, bigint],
                      vel: readonly [bigint, bigint], tick: number, out: Uint8Array[]): void {
    const brush = this.brushes[st.brushId - 1]!
    const spacing = brush.spacing
    const dx = fxWrap(p1[0] - p0[0])
    const dy = fxWrap(p1[1] - p0[1])
    const seg = fxSqrt(fxWrap(fxMul(dx, dx) + fxMul(dy, dy)))
    let carried = st.pathAccum
    let remaining = seg
    const pos: [bigint, bigint] = [p0[0], p0[1]]
    let full = false
    while (carried >= spacing) {
      if (this.nodeCount >= MAX_NODES) { full = true; break }
      this.emitNode(st, brush, pos, vel, tick, out)
      carried = fxWrap(carried - spacing)
    }
    if (!full && seg > 0n) {
      while (fxWrap(carried + remaining) >= spacing) {
        if (this.nodeCount >= MAX_NODES) { full = true; break }
        const d = fxWrap(spacing - carried)
        const f = fxDiv(d, remaining)
        pos[0] = fxWrap(pos[0] + fxMul(fxWrap(p1[0] - pos[0]), f))
        pos[1] = fxWrap(pos[1] + fxMul(fxWrap(p1[1] - pos[1]), f))
        this.emitNode(st, brush, pos, vel, tick, out)
        remaining = fxWrap(remaining - d)
        carried = 0n
      }
    }
    st.pathAccum = full ? 0n : fxWrap(carried + remaining)
  }

  /**
   * emit_node: one node at plane-local (u, v) with the stroke's direction
   * and the body's velocity. Skipped, without consuming an index, when the
   * table is full or the stroke has used every 24-bit index.
   */
  private emitNode(st: ActiveStroke, brush: BrushEntry, uv: readonly [bigint, bigint],
                   vel: readonly [bigint, bigint], tick: number, out: Uint8Array[]): void {
    if (this.nodeCount >= MAX_NODES || st.nextEmissionIndex > INDEX_MASK) return
    const id = makeNodeId(Number((st.id >> 32n) & 0xffn), Number(st.id & ORDINAL_MASK), st.nextEmissionIndex)
    st.nextEmissionIndex += 1
    this.nodeCount += 1
    this.usedStrokes.add(st.id)
    const [u, v] = uv
    const pl = st.plane
    // plane[0..2] origin, plane[3..5] right, plane[6..8] up; left to right as ddsim added them.
    const x = fxWrap(fxWrap(pl[0]! + fxMul(u, pl[3]!)) + fxMul(v, pl[6]!))
    const y = fxWrap(fxWrap(pl[1]! + fxMul(u, pl[4]!)) + fxMul(v, pl[7]!))
    const z = fxWrap(fxWrap(pl[2]! + fxMul(u, pl[5]!)) + fxMul(v, pl[8]!))
    const weight = curveWeight(brush.curve, st.lastPressure)
    this.emitted.push({ id, x, y, z, weight, dirX: st.dir[0], dirY: st.dir[1], vx: vel[0], vy: vel[1], tick, brush: st.brushId })
    out.push(encodeCreateNote(id, NODE_SPACE_ID, MsNoteKind.Note))
    out.push(encodeSetField(id, fieldVec3('pos', x, y, z)))
    out.push(encodeSetField(id, fieldScalar('weight', weight)))
    out.push(encodeSetField(id, fieldVec2('dir', st.dir[0], st.dir[1])))
    out.push(encodeSetField(id, fieldVec2('velocity', vel[0], vel[1])))
    out.push(encodeSetField(id, fieldScalar('tick', fxFromInt(tick))))
    out.push(encodeSetField(id, fieldScalar('brush', fxFromInt(st.brushId))))
  }
}
