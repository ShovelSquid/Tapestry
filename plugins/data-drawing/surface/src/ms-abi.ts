/**
 * ms-abi.ts — the TypeScript mirror of include/mathspace/mathspace_c.h, the
 * mathspace engine that replaces ddsim under this surface (plan phase 7).
 *
 * Same shape as ddsim-abi.ts: the module interface, the action encoders
 * (byte-identical to mathspace/action.hpp; plugins/mathspace/image.js is
 * the JS original, ported here because data-drawing may not import from a
 * sibling plugin), the notes-snapshot decoder, and the fx64 arithmetic the
 * bridge needs. Everything hashed is a BigInt in Q32.32 raw; the only
 * float conversions are the renderer's fromQ32 in ddsim-abi.ts.
 */

export const MS_ABI_VERSION = 3
export const MS_HASH_BYTES = 32
export const MS_ACTION_VERSION = 1

export const MsActionKind = {
  CreateSpace: 32,
  CreateNote: 33,
  SetField: 34,
  DeleteNote: 35,
  DeleteField: 36,
  BindField: 37,
} as const

export const MsNoteKind = {
  Note: 1,
  Rule: 2,
  View: 3,
} as const

export const MS_OK = 0

/** Error names by code, matching enum ms_error in mathspace_c.h. */
export const MS_ERR: Readonly<Record<number, string>> = {
  0: 'MS_OK',
  1: 'MS_ERR_BAD_DIM',
  2: 'MS_ERR_BAD_NAME',
  3: 'MS_ERR_BAD_KIND',
  4: 'MS_ERR_NO_SUCH_SPACE',
  5: 'MS_ERR_NO_SUCH_NOTE',
  6: 'MS_ERR_NO_SUCH_FIELD',
  7: 'MS_ERR_POS_DIM_MISMATCH',
  8: 'MS_ERR_SPACE_NOT_EMPTY',
  9: 'MS_ERR_LOCKED_FIELD',
  10: 'MS_ERR_DUPLICATE_ID',
  11: 'MS_ERR_TOO_MANY_FIELDS',
  12: 'MS_ERR_BAD_BYTES',
  13: 'MS_ERR_BAD_ACTION',
  14: 'MS_ERR_BAD_BYTECODE',
}

export function msErrorName(code: number): string {
  return MS_ERR[code] ?? `MS_ERR_UNKNOWN_${code}`
}

/** The Emscripten module (createMathspace() result). HEAPU8 is re-read at every use. */
export interface MathspaceModule {
  readonly HEAPU8: Uint8Array
  readonly HEAPU32: Uint32Array
  _malloc(bytes: number): number
  _free(ptr: number): void
  UTF8ToString(ptr: number): string
  _ms_version(): number
  _ms_create(seed: bigint): number
  _ms_destroy(world: number): void
  _ms_apply(world: number, action: number, len: number): number
  _ms_step(world: number): void
  _ms_tick(world: number): bigint
  _ms_hash(world: number, out: number): void
  _ms_serialize(world: number, out: number, cap: number): number
  _ms_restore(world: number, input: number, len: number): number
  _ms_notes_ptr(world: number): number
  _ms_notes_len(world: number): number
  _ms_errors_ptr(world: number): number
  _ms_errors_len(world: number): number
  _ms_skip_reason_name(reason: number): number
  _ms_compile(world: number, note: bigint, text: number, len: number, out: number, cap: number, where: number): number
  _ms_compile_error_name(result: number): number
  _ms_project(world: number, view: bigint, note: bigint, out: number): number
}

export interface MathspaceModuleOptions {
  locateFile?: (path: string, prefix: string) => string
}

export type CreateMathspace = (options?: MathspaceModuleOptions) => Promise<MathspaceModule>

// ---------------------------------------------------------------------------
// fx64 (Q32.32) arithmetic over BigInt, bit-equal to mathspace/fx64.hpp
// ---------------------------------------------------------------------------

export const FX_ONE = 4294967296n

/** Wraps to the int64 range like the C++ two's-complement raw. */
export function fxWrap(v: bigint): bigint {
  return BigInt.asIntN(64, v)
}

export function fxFromInt(i: number): bigint {
  return fxWrap(BigInt(i) << 32n)
}

/** fx64::from_q16: an int32 Q16.16 plane unit widened to Q32.32. */
export function fxFromQ16(q: number): bigint {
  return BigInt(q) << 16n
}

/**
 * div_q32: floor(a * 2^32 / b) exactly. fx64.hpp divides magnitudes and,
 * when the signs differ and the remainder is nonzero, subtracts one from
 * the negated quotient, so a negative result floors where BigInt `/`
 * would truncate. b == 0 gives 0, the contract-violation value every
 * build returns.
 */
export function fxDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n
  const n = a << 32n
  let q = n / b
  if ((n < 0n) !== (b < 0n) && q * b !== n) q -= 1n
  return fxWrap(q)
}

/** mul_q32: floor(a * b / 2^32) exactly (an arithmetic shift of the 128-bit product). */
export function fxMul(a: bigint, b: bigint): bigint {
  return fxWrap((a * b) >> 32n)
}

/**
 * isqrt128 of fx64.hpp over one BigInt: floor(sqrt(x)) for 0 <= x < 2^128
 * by the same restoring digit-by-digit method, a fixed 64 iterations (two
 * input bits per output bit). floor(sqrt) is unique, so this is bit-equal
 * to the two-word C++ by construction, not by luck.
 */
export function isqrt128(x: bigint): bigint {
  let root = 0n
  let rem = 0n
  for (let i = 0; i < 64; i++) {
    rem = (rem << 2n) | ((x >> 126n) & 3n)
    x = (x << 2n) & ((1n << 128n) - 1n)
    root <<= 1n
    const trial = (root << 1n) | 1n
    if (rem >= trial) {
      rem -= trial
      root |= 1n
    }
  }
  return root
}

/** fx64 sqrt: floor(sqrt(raw * 2^32)), 0 for a negative input (the contract-violation value every build returns). */
export function fxSqrt(x: bigint): bigint {
  if (x < 0n) return 0n
  return isqrt128(x << 32n)
}

// ---------------------------------------------------------------------------
// Action encoders (mathspace/action.hpp)
// ---------------------------------------------------------------------------

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
  u64(v: bigint): void { this.ensure(8); this.view.setBigUint64(this.len, BigInt.asUintN(64, v), true); this.len += 8 }
  i64(v: bigint): void { this.ensure(8); this.view.setBigInt64(this.len, BigInt.asIntN(64, v), true); this.len += 8 }
  bytes(b: Uint8Array): void { this.ensure(b.length); this.buf.set(b, this.len); this.len += b.length }
  /** u8 length-prefixed UTF-8, the field-name encoding of action.hpp. */
  str(s: string): void {
    const b = new TextEncoder().encode(s)
    if (b.length < 1 || b.length > 31) throw new RangeError(`field name must be 1..31 UTF-8 bytes: ${s}`)
    this.u8(b.length)
    this.bytes(b)
  }

  finish(): Uint8Array { return this.buf.slice(0, this.len) }
}

function header(kind: number, payload: Uint8Array): Uint8Array {
  const w = new ByteWriter()
  w.u8(kind)
  w.u8(MS_ACTION_VERSION)
  w.u16(0)
  w.u32(payload.length)
  w.bytes(payload)
  return w.finish()
}

/** An unbound field value: `dim` raw fx64 lanes. */
export interface MsField {
  name: string
  lanes: readonly bigint[]
}

export function encodeCreateSpace(id: bigint, dim: number): Uint8Array {
  const w = new ByteWriter()
  w.u64(id)
  w.u8(dim)
  return header(MsActionKind.CreateSpace, w.finish())
}

export function encodeCreateNote(id: bigint, space: bigint, kind: number): Uint8Array {
  const w = new ByteWriter()
  w.u64(id)
  w.u64(space)
  w.u8(kind)
  return header(MsActionKind.CreateNote, w.finish())
}

/** SetField: u64 note | u8 name_len | name | u8 dim | u8 bound (0) | dim x i64 | u32 code_len (0). */
export function encodeSetField(note: bigint, field: MsField): Uint8Array {
  if (field.lanes.length < 1 || field.lanes.length > 8) throw new RangeError(`field dim must be 1..8: ${field.name}`)
  const w = new ByteWriter()
  w.u64(note)
  w.str(field.name)
  w.u8(field.lanes.length)
  w.u8(0)
  for (const lane of field.lanes) w.i64(lane)
  w.u32(0)
  return header(MsActionKind.SetField, w.finish())
}

export function encodeDeleteNote(note: bigint): Uint8Array {
  const w = new ByteWriter()
  w.u64(note)
  return header(MsActionKind.DeleteNote, w.finish())
}

export function encodeDeleteField(note: bigint, name: string): Uint8Array {
  const w = new ByteWriter()
  w.u64(note)
  w.str(name)
  return header(MsActionKind.DeleteField, w.finish())
}

/** BindField: `code` is what MsEngine.compile returned; empty unbinds. */
export function encodeBindField(note: bigint, name: string, code: Uint8Array): Uint8Array {
  const w = new ByteWriter()
  w.u64(note)
  w.str(name)
  w.u32(code.length)
  w.bytes(code)
  return header(MsActionKind.BindField, w.finish())
}

// ---------------------------------------------------------------------------
// The notes snapshot (ms_notes_ptr/len)
// ---------------------------------------------------------------------------

/** Note id -> field name -> raw fx64 lanes, in the engine's id and name order. */
export type MsSnapshot = Map<bigint, Map<string, bigint[]>>

export function decodeSnapshot(bytes: Uint8Array): MsSnapshot {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const out: MsSnapshot = new Map()
  let p = 0
  while (p < bytes.length) {
    const id = view.getBigUint64(p, true); p += 8
    const count = bytes[p++]!
    const fields = new Map<string, bigint[]>()
    for (let i = 0; i < count; i++) {
      const len = bytes[p++]!
      const name = decoder.decode(bytes.subarray(p, p + len)); p += len
      const dim = bytes[p++]!
      const lanes: bigint[] = []
      for (let l = 0; l < dim; l++) { lanes.push(view.getBigInt64(p, true)); p += 8 }
      fields.set(name, lanes)
    }
    out.set(id, fields)
  }
  if (p !== bytes.length) throw new Error('notes snapshot truncated')
  return out
}

// ---------------------------------------------------------------------------
// The engine wrapper (plugins/mathspace/engine-core.js, ported)
// ---------------------------------------------------------------------------

export type CompileResult = { code: Uint8Array } | { error: string; where: number }

/** One engine world over the flat C ABI; each method mirrors an ms_* function. */
export class MsEngine {
  private world: number

  constructor(readonly mod: MathspaceModule, seed: bigint) {
    this.world = mod._ms_create(seed)
    if (this.world === 0) throw new Error('ms_create returned null')
  }

  /** Apply one encoded action; returns the ms_error code (0 on success, state untouched otherwise). */
  apply(bytes: Uint8Array): number {
    const ptr = this.mod._malloc(bytes.length)
    try {
      this.mod.HEAPU8.set(bytes, ptr)
      return this.mod._ms_apply(this.world, ptr, bytes.length)
    } finally {
      this.mod._free(ptr)
    }
  }

  step(): void {
    this.mod._ms_step(this.world)
  }

  tick(): bigint {
    return this.mod._ms_tick(this.world)
  }

  hashBytes(): Uint8Array {
    const hp = this.mod._malloc(MS_HASH_BYTES)
    try {
      this.mod._ms_hash(this.world, hp)
      return this.mod.HEAPU8.slice(hp, hp + MS_HASH_BYTES)
    } finally {
      this.mod._free(hp)
    }
  }

  /** A copy of the raw notes snapshot bytes. */
  notesBytes(): Uint8Array {
    const ptr = this.mod._ms_notes_ptr(this.world)
    const len = this.mod._ms_notes_len(this.world)
    return this.mod.HEAPU8.slice(ptr, ptr + len)
  }

  notes(): MsSnapshot {
    return decodeSnapshot(this.notesBytes())
  }

  /** RULE-07: what the last step skipped, per rule note, in id order; empty when clean. */
  errors(): Array<{ id: bigint; skipped: number; reason: string }> {
    const ptr = this.mod._ms_errors_ptr(this.world)
    const len = this.mod._ms_errors_len(this.world)
    const bytes = this.mod.HEAPU8.slice(ptr, ptr + len)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const out: Array<{ id: bigint; skipped: number; reason: string }> = []
    for (let off = 0; off + 13 <= len; off += 13) {
      out.push({
        id: view.getBigUint64(off, true),
        skipped: view.getUint32(off + 8, true),
        reason: this.mod.UTF8ToString(this.mod._ms_skip_reason_name(bytes[off + 12]!)),
      })
    }
    return out
  }

  serialize(): Uint8Array {
    const need = this.mod._ms_serialize(this.world, 0, 0)
    const ptr = this.mod._malloc(need)
    try {
      const got = this.mod._ms_serialize(this.world, ptr, need)
      if (got !== need) throw new Error(`ms_serialize wrote ${got} of ${need} bytes`)
      return this.mod.HEAPU8.slice(ptr, ptr + need)
    } finally {
      this.mod._free(ptr)
    }
  }

  restore(bytes: Uint8Array): number {
    const ptr = this.mod._malloc(bytes.length)
    try {
      this.mod.HEAPU8.set(bytes, ptr)
      return this.mod._ms_restore(this.world, ptr, bytes.length)
    } finally {
      this.mod._free(ptr)
    }
  }

  /** Compile `text` for a field of `noteId` against the world as it is now. */
  compile(noteId: bigint, text: string): CompileResult {
    const src = new TextEncoder().encode(text)
    const tp = this.mod._malloc(src.length + 1)
    const wp = this.mod._malloc(4)
    let op = 0
    try {
      this.mod.HEAPU8.set(src, tp)
      const need = this.mod._ms_compile(this.world, noteId, tp, src.length, 0, 0, wp)
      if (need < 0) {
        const where = this.mod.HEAPU32[wp >> 2]!
        return { error: this.mod.UTF8ToString(this.mod._ms_compile_error_name(need)), where }
      }
      op = this.mod._malloc(need)
      const got = this.mod._ms_compile(this.world, noteId, tp, src.length, op, need, 0)
      if (got !== need) throw new Error(`ms_compile wrote ${got} of ${need} bytes`)
      return { code: this.mod.HEAPU8.slice(op, op + need) }
    } finally {
      if (op !== 0) this.mod._free(op)
      this.mod._free(wp)
      this.mod._free(tp)
    }
  }

  destroy(): void {
    if (this.world !== 0) {
      this.mod._ms_destroy(this.world)
      this.world = 0
    }
  }
}
