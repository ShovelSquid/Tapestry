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
 *   StrokeEnd     DeleteNote for the body. Samples applied on the end tick
 *                 have already set `target`; ddsim integrated them in the
 *                 StrokeEnd itself, the engine's step for that tick never
 *                 sees the body (7d re-records the goldens).
 *
 * Ids: the body note is make_node_id(branch, ordinal, BODY_INDEX) with
 * BODY_INDEX = 2^24 - 1, an emission index no stroke reaches
 * (DD_MAX_NODES is 2^20), so bodies and emitted nodes (7d) share the
 * ddsim id layout without colliding. The space, rule and the compile-time
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
  fxFromQ16,
  FX_ONE,
  type CompileResult,
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
export const BRUSH_FORCE = 'self.k * (self.target - self.pos) - sqrt(self.k) * self.velocity'

export const MAX_BRUSHES = 65535
export const MAX_ACTIVE_STROKES = 8
export const BODY_INDEX = 0xffffff
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

/**
 * The bridge's own state: the brush table and the active strokes. One per
 * world; `bootstrap` prepares the world it translates into.
 */
export class MsBridge {
  readonly brushes: BrushEntry[] = []
  readonly strokes = new Map<bigint, ActiveStroke>()

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
    if (ordinal === 0n || (strokeId & ~STROKE_ID_MASK) !== 0n || this.strokes.has(strokeId)) return reject(BridgeError.StrokeState)
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
    if (st === undefined) return reject(BridgeError.StrokeState)
    if (count < 1 || count > MAX_SAMPLES_PER_ACTION) return reject(BridgeError.Limit)
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
      // ddsim placed the body on the first sample ever, at rest.
      actions.push(encodeSetField(body, fieldVec2('pos', fxFromQ16(first.u), fxFromQ16(first.v))))
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
    if (st === undefined) return reject(BridgeError.StrokeState)
    if (endTick !== tick) return reject(BridgeError.TickMismatch)
    this.strokes.delete(strokeId)
    return { code: BridgeError.Ok, actions: [encodeDeleteNote(bodyNoteId(strokeId))] }
  }
}
