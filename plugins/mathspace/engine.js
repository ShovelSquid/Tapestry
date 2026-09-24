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

  destroy() {
    if (this.world) {
      this.mod._ms_destroy(this.world)
      this.world = 0
    }
  }
}

module.exports = { loadModule, Engine, hexOf, GLUE_PATH }
