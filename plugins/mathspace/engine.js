/**
 * engine.js — the mathspace engine as seen from Node.
 *
 * Loads wasm/mathspace.mjs (produced by `npm run engine:wasm`) and
 * re-exports the Engine class of engine-core.js, which wraps the flat C
 * ABI of include/mathspace/mathspace_c.h. This file is CommonJS like
 * index.js so the host can require() it; the glue is an ES module, hence
 * the dynamic import(). The stage surface never loads this file: it
 * bundles engine-core.js and fetches the glue over the plugin origin.
 */

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { Engine, hexOf } = require('./engine-core')

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

module.exports = { loadModule, Engine, hexOf, GLUE_PATH }
