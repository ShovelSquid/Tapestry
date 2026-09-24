/**
 * ddsim-abi.ts — the TypeScript mirror of data-drawing/sim/include/ddsim/ddsim_c.h.
 *
 * Strides, error names, the DefineBrush encoder (byte-identical to the C++
 * test encoder in sim/tests/golden_support.hpp), and the snapshot decoders.
 * Ids are decoded as bigint, never number: a NodeId with the stroke ordinal
 * in bits 24..55 exceeds 2^53 as soon as the ordinal exceeds 2^29.
 *
 * The one float-to-integer conversion in the plugin is toQ32(): brush
 * parameters given as JS numbers become Q32.32 raw integers here, at the API
 * boundary, and only the integer ever crosses into the sim or the log.
 */

export const NODE_STRIDE = 88
export const BODY_STRIDE = 56
export const HASH_BYTES = 32
export const TICK_HZ = 60
export const ACTION_VERSION = 1
export const ACTION_HEADER_BYTES = 8
/** PROVISIONAL width (16-bit); Phase 2 freezes it with the grammar. Mirrors DD_PRESSURE_MAX. */
export const PRESSURE_MAX = 65535
export const CURVE_KNOTS = 17
export const MAX_DESC_BYTES = 255
export const Q32_ONE = 4294967296n

export const ActionKind = {
  DefineBrush: 1,
  StrokeBegin: 2,
  StrokeSamples: 3,
  StrokeEnd: 4,
} as const

export const DD_OK = 0

/** Error names by code, matching enum dd_error in ddsim_c.h. */
export const DD_ERR: Readonly<Record<number, string>> = {
  0: 'DD_OK',
  1: 'DD_ERR_BAD_HEADER',
  2: 'DD_ERR_UNKNOWN_KIND',
  3: 'DD_ERR_BAD_LENGTH',
  4: 'DD_ERR_TICK_MISMATCH',
  5: 'DD_ERR_BRUSH_ID',
  6: 'DD_ERR_BRUSH_INVALID',
  7: 'DD_ERR_STROKE_STATE',
  8: 'DD_ERR_SAMPLE_ORDER',
  9: 'DD_ERR_LIMIT',
  10: 'DD_ERR_RESTORE',
}

export function errorName(code: number): string {
  return DD_ERR[code] ?? `DD_ERR_UNKNOWN_${code}`
}

/** The shape of the Emscripten module (createDdsim() result) the plugin uses. */
export interface DdsimModule {
  /** Re-read from the module object at every use: it is replaced on memory growth. */
  readonly HEAPU8: Uint8Array
  _malloc(bytes: number): number
  _free(ptr: number): void
  _dd_version(): number
  _dd_create(seed: bigint): number
  _dd_destroy(sim: number): void
  _dd_apply(sim: number, action: number, len: number): number
  _dd_step(sim: number): void
  _dd_tick(sim: number): bigint
  _dd_hash(sim: number, out: number): void
  _dd_serialize(sim: number, out: number, cap: number): number
  _dd_restore(sim: number, input: number, len: number): number
  _dd_nodes_ptr(sim: number): number
  _dd_node_count(sim: number): number
  _dd_node_stride(): number
  _dd_body_ptr(sim: number): number
  _dd_body_count(sim: number): number
  _dd_body_stride(): number
}

export interface DdsimModuleOptions {
  locateFile?: (path: string, prefix: string) => string
}

export type CreateDdsim = (options?: DdsimModuleOptions) => Promise<DdsimModule>

// ---------------------------------------------------------------------------
// Brush spec and the DefineBrush encoder
// ---------------------------------------------------------------------------

export interface BrushVersionSpec {
  /** UTF-8; 1..255 bytes. Equality is byte-wise, never normalized. */
  description: string
  /** Q32.32 raw bigint, or a JS number converted once through toQ32(). */
  mass: number | bigint
  radius: number | bigint
  spacing: number | bigint
  /** 17 knots, each 0..65535. Defaults to IDENTITY_CURVE. */
  curve?: readonly number[]
}

export const IDENTITY_CURVE: readonly number[] = Object.freeze(
  Array.from({ length: CURVE_KNOTS }, (_, i) => (i < 16 ? i * 4096 : 65535)),
)

/** The brush every golden and the dev page share (one-brush.actions). */
export const INK_BRUSH: BrushVersionSpec = Object.freeze({
  description: 'ink',
  mass: 1,
  radius: 0.75,
  spacing: 0.5,
  curve: IDENTITY_CURVE,
})

/** The only float-to-integer conversion: JS number -> Q32.32 raw, rounded once. */
export function toQ32(x: number | bigint): bigint {
  if (typeof x === 'bigint') return x
  if (!Number.isFinite(x)) throw new RangeError(`toQ32: not finite: ${x}`)
  return BigInt(Math.round(x * 4294967296))
}

class ByteWriter {
  private buf = new Uint8Array(64)
  private view = new DataView(this.buf.buffer)
  private len = 0

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < this.len + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
    this.view = new DataView(next.buffer)
  }

  u8(v: number): void { this.ensure(1); this.view.setUint8(this.len, v); this.len += 1 }
  u16(v: number): void { this.ensure(2); this.view.setUint16(this.len, v, true); this.len += 2 }
  u32(v: number): void { this.ensure(4); this.view.setUint32(this.len, v, true); this.len += 4 }
  i64(v: bigint): void { this.ensure(8); this.view.setBigInt64(this.len, v, true); this.len += 8 }
  bytes(b: Uint8Array): void { this.ensure(b.length); this.buf.set(b, this.len); this.len += b.length }

  finish(): Uint8Array { return this.buf.slice(0, this.len) }
}

function header(kind: number, payload: Uint8Array): Uint8Array {
  const w = new ByteWriter()
  w.u8(kind)
  w.u8(ACTION_VERSION)
  w.u16(0)
  w.u32(payload.length)
  w.bytes(payload)
  return w.finish()
}

/**
 * Encodes DefineBrush for the given version id. Byte-identical to
 * ddsim_test::encodeDefineBrush in the C++ tests (proven by wasm-golden.test.ts).
 * Throws on a spec the sim would reject for a reason visible here, so the
 * caller learns early; the sim still validates every byte itself.
 */
export function encodeDefineBrush(spec: BrushVersionSpec, versionId: number): Uint8Array {
  const desc = new TextEncoder().encode(spec.description)
  if (desc.length < 1 || desc.length > MAX_DESC_BYTES) {
    throw new RangeError(`brush description must be 1..${MAX_DESC_BYTES} UTF-8 bytes, got ${desc.length}`)
  }
  const curve = spec.curve ?? IDENTITY_CURVE
  if (curve.length !== CURVE_KNOTS) throw new RangeError(`curve must have ${CURVE_KNOTS} knots`)
  const w = new ByteWriter()
  w.u32(versionId >>> 0)
  w.u32(desc.length)
  w.bytes(desc)
  w.i64(toQ32(spec.mass))
  w.i64(toQ32(spec.radius))
  w.i64(toQ32(spec.spacing))
  for (const knot of curve) {
    if (!Number.isInteger(knot) || knot < 0 || knot > 65535) throw new RangeError(`curve knot out of range: ${knot}`)
    w.u16(knot)
  }
  return header(ActionKind.DefineBrush, w.finish())
}

// ---------------------------------------------------------------------------
// Snapshot decoders (main-thread side; the only place Q32.32 becomes a float)
// ---------------------------------------------------------------------------

/** Q32.32 raw -> JS number. Allowed left of the fence only. */
export function fromQ32(raw: bigint): number {
  return Number(raw) / 4294967296
}

/**
 * Reads one Q32.32 little-endian field of a snapshot as a float:
 * Number(BigInt) / 2^32. The renderer never sees the raw integer.
 */
export function q32ToFloat(dv: DataView, offset: number): number {
  return Number(dv.getBigInt64(offset, true)) / 4294967296
}

/**
 * Lazy accessors over a transferred node snapshot (count x NODE_STRIDE
 * bytes, ascending NodeId as the sim keeps them). Nothing is copied or
 * sorted: the render side walks i = 0..count-1 and reads what it draws.
 */
export interface NodeAccessor {
  readonly count: number
  id(i: number): bigint
  x(i: number): number
  y(i: number): number
  z(i: number): number
  weight(i: number): number
  dirX(i: number): number
  dirY(i: number): number
  vx(i: number): number
  vy(i: number): number
  tick(i: number): number
  brush(i: number): number
  scaleBand(i: number): number
}

export interface BodyAccessor {
  readonly count: number
  strokeId(i: number): bigint
  x(i: number): number
  y(i: number): number
  vx(i: number): number
  vy(i: number): number
  targetU(i: number): number
  targetV(i: number): number
}

export function decodeNodes(buffer: ArrayBuffer, count: number): NodeAccessor {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`node count out of range: ${count}`)
  if (buffer.byteLength < count * NODE_STRIDE) throw new RangeError('node snapshot buffer too short')
  const dv = new DataView(buffer)
  const at = (i: number): number => {
    if (i < 0 || i >= count) throw new RangeError(`node index out of range: ${i}`)
    return i * NODE_STRIDE
  }
  return {
    count,
    id: (i) => dv.getBigUint64(at(i), true),
    x: (i) => q32ToFloat(dv, at(i) + 8),
    y: (i) => q32ToFloat(dv, at(i) + 16),
    z: (i) => q32ToFloat(dv, at(i) + 24),
    weight: (i) => q32ToFloat(dv, at(i) + 32),
    dirX: (i) => q32ToFloat(dv, at(i) + 40),
    dirY: (i) => q32ToFloat(dv, at(i) + 48),
    vx: (i) => q32ToFloat(dv, at(i) + 56),
    vy: (i) => q32ToFloat(dv, at(i) + 64),
    tick: (i) => dv.getUint32(at(i) + 72, true),
    brush: (i) => dv.getUint32(at(i) + 76, true),
    scaleBand: (i) => dv.getUint32(at(i) + 80, true),
  }
}

export function decodeBodies(buffer: ArrayBuffer, count: number): BodyAccessor {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`body count out of range: ${count}`)
  if (buffer.byteLength < count * BODY_STRIDE) throw new RangeError('body snapshot buffer too short')
  const dv = new DataView(buffer)
  const at = (i: number): number => {
    if (i < 0 || i >= count) throw new RangeError(`body index out of range: ${i}`)
    return i * BODY_STRIDE
  }
  return {
    count,
    strokeId: (i) => dv.getBigUint64(at(i), true),
    x: (i) => q32ToFloat(dv, at(i) + 8),
    y: (i) => q32ToFloat(dv, at(i) + 16),
    vx: (i) => q32ToFloat(dv, at(i) + 24),
    vy: (i) => q32ToFloat(dv, at(i) + 32),
    targetU: (i) => q32ToFloat(dv, at(i) + 40),
    targetV: (i) => q32ToFloat(dv, at(i) + 48),
  }
}

export function hexOf(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0')
  return s
}
