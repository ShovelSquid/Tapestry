/**
 * image.js — kernel nodes → engine actions, and engine snapshot → kernel ops.
 *
 * The engine holds a derived image of the tree's spatial notes; the .tree
 * stays the durable state. This file is the whole boundary between the
 * two, and the only place numbers are converted (mathspace_plan.md,
 * "Numeric type"): a kernel `real` r crosses only if r * 2^32 is an
 * integer of magnitude below 2^53, as that raw int64 (a BigInt here);
 * raw values come back the same way, so every engine output is an exact
 * `real` and no double ever enters the C++ tree.
 *
 * Key conventions (plan, "Property conventions"): a vector field `f` of
 * dim N is `f.x f.y f.z f.w` for N ≤ 4 and `f.0 … f.(N-1)` above; a scalar
 * is the bare name. A lane-addressed field is a vector in the note's
 * space, so it is padded with zero lanes to the space's dim: `velocity.x
 * real 1` alone on a note in a 2-space is the vector (1, 0), which is
 * what the integrate rule (step.cpp) needs to see. The app's
 * `position.x`/`position.y` is the engine's `pos`. Membership is `space ref n<k>`; a node with a position and no
 * space lives in the implicit space of its tree (one per image, since the
 * SDK's kernel is one tree), a 2-space under a reserved id no kernel node
 * can hold.
 *
 * Byte layouts mirror include/mathspace/action.hpp (actions) and
 * src/mathspace/snapshot.cpp (snapshot); the tests pin the encoders to
 * tests/golden/ms/velocity.actions so the two cannot drift silently.
 */

const FX_ONE = 4294967296 // 2^32, Q32.32
const MAX_MAGNITUDE = 2 ** 53
const MAX_DIM = 8
const MAX_FIELD_NAME = 31
const LANE_LETTERS = ['x', 'y', 'z', 'w']

/** Kernel ids are n<k> with k from 1 up; this id is beyond any of them. */
const IMPLICIT_SPACE_ID = 1n << 63n
const IMPLICIT_SPACE_DIM = 2
const SPACE_TYPE = 'mathspace/space@1'

const ACTION_VERSION = 1
const KIND_CREATE_SPACE = 32
const KIND_CREATE_NOTE = 33
const KIND_SET_FIELD = 34
const KIND_BIND_FIELD = 37
const NOTE_KIND_NOTE = 1

/** The one renamed field: the app says position, the store says pos. */
const ENGINE_NAMES = { position: 'pos' }
const KERNEL_NAMES = { pos: 'position' }
const engineName = (k) => ENGINE_NAMES[k] ?? k
const kernelName = (n) => KERNEL_NAMES[n] ?? n

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Exact real → raw Q32.32 as a BigInt. Throws RangeError when inexact. */
function realToRaw(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`not a finite number: ${String(value)}`)
  }
  const k = value * FX_ONE
  if (!Number.isInteger(k) || Math.abs(k) >= MAX_MAGNITUDE) {
    throw new RangeError(`real ${value} is not k / 2^32 with |k| < 2^53`)
  }
  return BigInt(k)
}

/** Exact raw → real. Throws RangeError when the raw is outside ±2^53. */
function rawToReal(raw) {
  if (typeof raw !== 'bigint') throw new RangeError(`not a bigint: ${String(raw)}`)
  if (raw >= BigInt(MAX_MAGNITUDE) || raw <= -BigInt(MAX_MAGNITUDE)) {
    throw new RangeError(`raw ${raw} is outside ±2^53`)
  }
  return Number(raw) / FX_ONE
}

// ---------------------------------------------------------------------------
// Ids and keys
// ---------------------------------------------------------------------------

function nodeIdToU64(id) {
  const m = /^n([1-9][0-9]*)$/.exec(id)
  if (!m) throw new Error(`not a node id: ${String(id)}`)
  return BigInt(m[1])
}

const u64ToNodeId = (u) => `n${u}`

/** note.hpp's valid_field_name: 1 to 31 bytes, no byte below 0x20. */
function validFieldName(name) {
  const bytes = Buffer.byteLength(name, 'utf8')
  if (bytes < 1 || bytes > MAX_FIELD_NAME) return false
  for (const c of name) if (c.codePointAt(0) < 0x20) return false
  return true
}

/**
 * A property key → { field, lane } in engine terms, or null when the key
 * is not a field lane (`f.expr`, `a.b.c`, an invalid name).
 */
function parseKey(key) {
  const dot = key.indexOf('.')
  let field = key
  let lane = 0
  if (dot >= 0) {
    field = key.slice(0, dot)
    const suffix = key.slice(dot + 1)
    const letter = LANE_LETTERS.indexOf(suffix)
    if (letter >= 0) lane = letter
    else if (/^[0-7]$/.test(suffix)) lane = Number(suffix)
    else return null
  }
  if (!validFieldName(field)) return null
  return { field: engineName(field), lane }
}

/** The inverse: engine field + lane + dim → kernel property key. */
function laneKey(field, lane, dim) {
  const name = kernelName(field)
  if (dim === 1) return name
  return dim <= 4 ? `${name}.${LANE_LETTERS[lane]}` : `${name}.${lane}`
}

/** Byte order on UTF-8, the order the store keeps fields in. */
function compareNames(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

// ---------------------------------------------------------------------------
// Action encoders (action.hpp)
// ---------------------------------------------------------------------------

class ByteWriter {
  constructor() { this.bytes = []; }
  u8(v) { this.bytes.push(v & 0xff) }
  u16(v) { this.u8(v); this.u8(v >>> 8) }
  u32(v) { this.u16(v & 0xffff); this.u16(v >>> 16) }
  u64(v) { let x = BigInt.asUintN(64, BigInt(v)); for (let i = 0; i < 8; i++) { this.u8(Number(x & 0xffn)); x >>= 8n } }
  i64(v) { this.u64(v) }
  str(s) { const b = Buffer.from(s, 'utf8'); this.u8(b.length); for (const c of b) this.u8(c) }
  done() { return Uint8Array.from(this.bytes) }
}

function withHeader(kind, payload) {
  const w = new ByteWriter()
  w.u8(kind); w.u8(ACTION_VERSION); w.u16(0); w.u32(payload.length)
  const head = w.done()
  const out = new Uint8Array(head.length + payload.length)
  out.set(head, 0); out.set(payload, head.length)
  return out
}

function encodeCreateSpace(id, dim) {
  const w = new ByteWriter(); w.u64(id); w.u8(dim)
  return withHeader(KIND_CREATE_SPACE, w.done())
}

function encodeCreateNote(id, space, kind) {
  const w = new ByteWriter(); w.u64(id); w.u64(space); w.u8(kind)
  return withHeader(KIND_CREATE_NOTE, w.done())
}

/** field: { name, dim, lanes: bigint[dim] }; unbound, no bytecode. */
function encodeSetField(note, field) {
  const w = new ByteWriter()
  w.u64(note); w.str(field.name); w.u8(field.dim); w.u8(0)
  for (let i = 0; i < field.dim; i++) w.i64(field.lanes[i] ?? 0n)
  w.u32(0)
  return withHeader(KIND_SET_FIELD, w.done())
}

/** Bind `name` on `note` to `code` (bytes from Engine.compile); empty unbinds. */
function encodeBindField(note, name, code) {
  const w = new ByteWriter()
  w.u64(note); w.str(name); w.u32(code.length)
  for (const c of code) w.u8(c)
  return withHeader(KIND_BIND_FIELD, w.done())
}

// ---------------------------------------------------------------------------
// Kernel nodes → image
// ---------------------------------------------------------------------------

const isNumericProp = (p) => p && (p.type === 'real' || p.type === 'int') && typeof p.value === 'number'

/**
 * Gather a node's numeric props into engine fields. A lane-addressed
 * field is at least `spaceDim` wide (zero-padded); a bare name is a
 * scalar. Any lane that fails conversion drops the whole field (a
 * half-converted vector would be a wrong position, not a missing one)
 * and is reported in `problems`.
 * Returns Map name → { dim, lanes, types: type per lane }.
 */
function fieldsOf(node, spaceDim, problems) {
  const fields = new Map()
  const bad = new Set()
  for (const key of Object.keys(node.props).sort()) {
    const prop = node.props[key]
    if (!isNumericProp(prop)) continue
    const parsed = parseKey(key)
    if (parsed === null) continue
    let raw
    try {
      raw = realToRaw(prop.value)
    } catch (err) {
      problems.push({ id: node.id, key, reason: err.message })
      bad.add(parsed.field)
      continue
    }
    let f = fields.get(parsed.field)
    if (!f) { f = { dim: 1, lanes: [], types: [] }; fields.set(parsed.field, f) }
    f.dim = Math.max(f.dim, parsed.lane + 1, key.includes('.') ? spaceDim : 1)
    f.lanes[parsed.lane] = raw
    f.types[parsed.lane] = prop.type
  }
  for (const name of bad) fields.delete(name)
  for (const f of fields.values()) {
    for (let i = 0; i < f.dim; i++) { if (f.lanes[i] === undefined) { f.lanes[i] = 0n; f.types[i] = 'real' } }
  }
  return fields
}

/**
 * Build the engine image of a tree.
 *
 * @param {Array<{id: string, type: string, props: object}>} nodes
 * @returns {{
 *   actions: Uint8Array[],
 *   fields: Map<bigint, Map<string, bigint[]>>,
 *   types: Map<string, 'real'|'int'>,
 *   problems: Array<{id: string, key: string, reason: string}>,
 * }} actions in apply order; fields is the before-image diff() needs;
 *   types remembers `int` props so they come back as ints.
 */
function buildImage(nodes) {
  const problems = []
  const spaces = new Map() // u64 → dim
  const notes = [] // { id, space, fields }

  for (const node of nodes) {
    if (node.type !== SPACE_TYPE) continue
    const id = nodeIdToU64(node.id)
    const dimProp = node.props['dim']
    const dim = isNumericProp(dimProp) ? dimProp.value : IMPLICIT_SPACE_DIM
    if (!Number.isInteger(dim) || dim < 1 || dim > MAX_DIM) {
      problems.push({ id: node.id, key: 'dim', reason: `space dim ${dim} outside 1..${MAX_DIM}` })
      continue
    }
    spaces.set(id, dim)
  }

  let usesImplicit = false
  for (const node of nodes) {
    if (node.type === SPACE_TYPE) continue
    const spaceProp = node.props['space']
    let space
    if (spaceProp && spaceProp.type === 'ref') {
      let sid
      try { sid = nodeIdToU64(spaceProp.value) } catch { sid = null }
      if (sid === null || !spaces.has(sid)) {
        problems.push({ id: node.id, key: 'space', reason: `space ${String(spaceProp.value)} is not a mathspace/space@1 node` })
        continue
      }
      space = sid
    } else if (isNumericProp(node.props['position.x']) && isNumericProp(node.props['position.y'])) {
      space = IMPLICIT_SPACE_ID
      usesImplicit = true
    } else {
      continue
    }
    const dim = space === IMPLICIT_SPACE_ID ? IMPLICIT_SPACE_DIM : spaces.get(space)
    const fields = fieldsOf(node, dim, problems)
    const pos = fields.get('pos')
    if (pos && pos.dim !== dim) {
      problems.push({ id: node.id, key: 'position', reason: `position has ${pos.dim} lanes, space has ${dim}` })
      fields.delete('pos')
    }
    notes.push({ id: nodeIdToU64(node.id), space, fields })
  }

  const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const actions = []
  const image = new Map()
  const types = new Map()
  const spaceIds = [...spaces.keys()].sort(byId)
  if (usesImplicit) spaceIds.push(IMPLICIT_SPACE_ID)
  for (const sid of spaceIds) {
    actions.push(encodeCreateSpace(sid, sid === IMPLICIT_SPACE_ID ? IMPLICIT_SPACE_DIM : spaces.get(sid)))
  }
  notes.sort((a, b) => byId(a.id, b.id))
  for (const n of notes) {
    actions.push(encodeCreateNote(n.id, n.space, NOTE_KIND_NOTE))
    const before = new Map()
    for (const name of [...n.fields.keys()].sort(compareNames)) {
      const f = n.fields.get(name)
      actions.push(encodeSetField(n.id, { name, dim: f.dim, lanes: f.lanes }))
      before.set(name, f.lanes.slice())
      for (let i = 0; i < f.dim; i++) {
        if (f.types[i] === 'int') types.set(`${u64ToNodeId(n.id)}|${laneKey(name, i, f.dim)}`, 'int')
      }
    }
    image.set(n.id, before)
  }
  return { actions, fields: image, types, problems }
}

// ---------------------------------------------------------------------------
// Snapshot → diff → ops
// ---------------------------------------------------------------------------

/** Parse World::notes_bytes: per note u64 id | u8 n | n × (u8 len | name | u8 dim | dim × i64). */
function parseSnapshot(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Map()
  let p = 0
  while (p < bytes.length) {
    const id = view.getBigUint64(p, true); p += 8
    const count = bytes[p++]
    const fields = new Map()
    for (let i = 0; i < count; i++) {
      const len = bytes[p++]
      const name = Buffer.from(bytes.subarray(p, p + len)).toString('utf8'); p += len
      const dim = bytes[p++]
      const lanes = []
      for (let l = 0; l < dim; l++) { lanes.push(view.getBigInt64(p, true)); p += 8 }
      fields.set(name, lanes)
    }
    out.set(id, fields)
  }
  if (p !== bytes.length) throw new Error('snapshot bytes truncated')
  return out
}

/**
 * The setProperty ops that bring the kernel from `before` to `after`.
 * Only notes present in `before` are considered (the implicit space has
 * no kernel node); a field or lane missing from `before` counts as
 * changed. Ops are in id order, then field name order, then lane order.
 */
function diff(before, after, types = new Map()) {
  const ops = []
  const ids = [...after.keys()].filter((id) => before.has(id)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const id of ids) {
    const was = before.get(id)
    const now = after.get(id)
    for (const name of [...now.keys()].sort(compareNames)) {
      const lanes = now.get(name)
      const old = was.get(name)
      for (let i = 0; i < lanes.length; i++) {
        if (old !== undefined && old[i] === lanes[i]) continue
        const target = u64ToNodeId(id)
        const key = laneKey(name, i, lanes.length)
        const value = rawToReal(lanes[i])
        const asInt = types.get(`${target}|${key}`) === 'int' && Number.isInteger(value)
        ops.push({ op: 'setProperty', target, key, type: asInt ? 'int' : 'real', value })
      }
    }
  }
  return ops
}

module.exports = {
  FX_ONE, IMPLICIT_SPACE_ID, IMPLICIT_SPACE_DIM, SPACE_TYPE,
  realToRaw, rawToReal, nodeIdToU64, u64ToNodeId, parseKey, laneKey,
  encodeCreateSpace, encodeCreateNote, encodeSetField, encodeBindField,
  buildImage, parseSnapshot, diff,
}
