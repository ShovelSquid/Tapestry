/**
 * engine.js — the mathspace engine as seen from JavaScript.
 *
 * Loads wasm/mathspace.mjs (produced by `npm run engine:wasm`) and wraps
 * the flat C ABI of include/mathspace/mathspace_c.h in one small class.
 * Bytes cross the boundary through _malloc/_free; HEAPU8 is re-read from
 * the module at every use because ALLOW_MEMORY_GROWTH can replace it.
 *
 * Nothing here converts numbers: actions arrive already encoded (image.js
 * does real↔fx64 exactly) and the snapshot comes back as raw bytes. This
 * file is CommonJS like index.js so the host can require() it; the glue
 * is an ES module, hence the dynamic import().
 */

const path = require('node:path')
const { pathToFileURL } = require('node:url')

/** Where build-wasm.sh puts the module. */
const GLUE_PATH = path.join(__dirname, 'wasm', 'mathspace.mjs')

let modulePromise = null

/**
 * Load and instantiate the Wasm module once per process.
 * @returns {Promise<object>} the Emscripten module with the _ms_* exports
 */
function loadModule() {
  if (modulePromise === null) {
    modulePromise = import(pathToFileURL(GLUE_PATH).href).then((m) => m.default())
  }
  return modulePromise
}

/** Lower-case hex of a byte array. */
function hexOf(bytes) {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/**
 * One engine world. Every method mirrors an ms_* function; see the header
 * for semantics (tick counting, cap protocol, error codes).
 */
class Engine {
  /**
   * @param {object} mod the loaded module
   * @param {bigint|number} seed
   */
  constructor(mod, seed) {
    this.mod = mod
    this.world = mod._ms_create(BigInt(seed))
    if (!this.world) throw new Error('ms_create returned null')
  }

  /** Apply one encoded action. Returns the ms_error code, 0 on success. */
  apply(bytes) {
    const ptr = this.mod._malloc(bytes.length)
    try {
      this.mod.HEAPU8.set(bytes, ptr)
      return this.mod._ms_apply(this.world, ptr, bytes.length)
    } finally {
      this.mod._free(ptr)
    }
  }

  step() {
    this.mod._ms_step(this.world)
  }

  /** @returns {bigint} */
  tick() {
    return this.mod._ms_tick(this.world)
  }

  /** @returns {string} 64 hex chars of the canonical hash */
  hash() {
    const hp = this.mod._malloc(32)
    try {
      this.mod._ms_hash(this.world, hp)
      return hexOf(this.mod.HEAPU8.slice(hp, hp + 32))
    } finally {
      this.mod._free(hp)
    }
  }

  /** @returns {Uint8Array} a copy of the notes snapshot */
  notes() {
    const ptr = this.mod._ms_notes_ptr(this.world)
    const len = this.mod._ms_notes_len(this.world)
    return this.mod.HEAPU8.slice(ptr, ptr + len)
  }

  /**
   * RULE-07: what the last step() skipped, per rule note that skipped
   * anything, in id order (ms_errors_ptr in the header). Empty when the
   * step was clean.
   * @returns {Array<{id: bigint, skipped: number, reason: string}>}
   *   `reason` is ms_skip_reason_name's, e.g. "NoSuchField" or "WrongDim".
   */
  errors() {
    const ptr = this.mod._ms_errors_ptr(this.world)
    const len = this.mod._ms_errors_len(this.world)
    const bytes = this.mod.HEAPU8.slice(ptr, ptr + len)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const out = []
    for (let off = 0; off + 13 <= len; off += 13) {
      out.push({
        id: view.getBigUint64(off, true),
        skipped: view.getUint32(off + 8, true),
        reason: this.mod.UTF8ToString(this.mod._ms_skip_reason_name(bytes[off + 12])),
      })
    }
    return out
  }

  /** @returns {Uint8Array} the full serialized world */
  serialize() {
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

  /** Restore from serialize() output. Returns the ms_error code. */
  restore(bytes) {
    const ptr = this.mod._malloc(bytes.length)
    try {
      this.mod.HEAPU8.set(bytes, ptr)
      return this.mod._ms_restore(this.world, ptr, bytes.length)
    } finally {
      this.mod._free(ptr)
    }
  }

  /**
   * Compile an expression for a field of `noteId` against the world as it
   * is now (self and node(nN) refs need their notes and fields present).
   * @param {bigint|number} noteId
   * @param {string} text
   * @returns {{code: Uint8Array} | {error: string, where: number}}
   *   `error` is ms_compile_error_name's "stage:Name"; `where` is the byte
   *   offset in `text` for a parse error, else 0.
   */
  compile(noteId, text) {
    const src = new TextEncoder().encode(text)
    const tp = this.mod._malloc(src.length + 1)
    const wp = this.mod._malloc(4)
    let op = 0
    try {
      this.mod.HEAPU8.set(src, tp)
      const need = this.mod._ms_compile(this.world, BigInt(noteId), tp, src.length, 0, 0, wp)
      if (need < 0) {
        const where = this.mod.HEAPU32[wp >> 2]
        return { error: this.mod.UTF8ToString(this.mod._ms_compile_error_name(need)), where }
      }
      op = this.mod._malloc(need)
      const got = this.mod._ms_compile(this.world, BigInt(noteId), tp, src.length, op, need, 0)
      if (got !== need) throw new Error(`ms_compile wrote ${got} of ${need} bytes`)
      return { code: this.mod.HEAPU8.slice(op, op + need) }
    } finally {
      if (op) this.mod._free(op)
      this.mod._free(wp)
      this.mod._free(tp)
    }
  }

  /**
   * Evaluate the bound `project` of the View note `viewId` with `self` =
   * `noteId` (ms_project in the header): the note's place on the page
   * plane as two raw fx64 lanes. Reads the world, never changes it, and
   * is not part of a step or the hash.
   * @param {bigint|number} viewId
   * @param {bigint|number} noteId
   * @returns {{lanes: [bigint, bigint]} | {error: string}}
   *   `error` is ms_compile_error_name's, e.g. "world:NoSuchField" when
   *   the view has no bound project or "eval:NoSuchField" when the note
   *   lacks a field the expression reads.
   */
  project(viewId, noteId) {
    const op = this.mod._malloc(16)
    try {
      const rc = this.mod._ms_project(this.world, BigInt(viewId), BigInt(noteId), op)
      if (rc !== 0) return { error: this.mod.UTF8ToString(this.mod._ms_compile_error_name(rc)) }
      const bytes = this.mod.HEAPU8.slice(op, op + 16)
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      return { lanes: [view.getBigInt64(0, true), view.getBigInt64(8, true)] }
    } finally {
      this.mod._free(op)
    }
  }

  destroy() {
    if (this.world) {
      this.mod._ms_destroy(this.world)
      this.world = 0
    }
  }
}

module.exports = { loadModule, Engine, hexOf, GLUE_PATH }
