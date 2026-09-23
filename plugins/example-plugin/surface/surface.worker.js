/**
 * example-plugin spike worker (third-party example; imports nothing from the
 * host or Electron; no build step).
 *
 * An ES module Worker spawned from the plugin's surface module over the
 * tapestry-plugin scheme. It proves two things about that origin:
 *   1. a module Worker can be spawned from it at all (worker=ok), and
 *   2. a .wasm fetched from it can be instantiated through
 *      WebAssembly.instantiateStreaming, which requires the scheme to answer
 *      with `Content-Type: application/wasm` (wasm=ok).
 *
 * spike.wasm is the 8-byte minimal valid module (magic + version).
 */

async function run() {
  try {
    const response = await fetch(new URL('./spike.wasm', import.meta.url))
    if (!response.ok) {
      throw new Error(`fetch ${response.status} ${response.statusText}`)
    }
    await WebAssembly.instantiateStreaming(response)
    self.postMessage({ worker: 'ok', wasm: 'ok' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    self.postMessage({ worker: 'ok', wasm: 'error: ' + message })
  }
}

run()
