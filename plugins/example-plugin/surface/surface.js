/**
 * example-plugin spike surface (third-party example; imports nothing from the
 * host or Electron; no build step).
 *
 * A plain ES module served over the tapestry-plugin scheme and imported by
 * the host's PluginSurfaceLayer (CANV-04). It reports the environment facts
 * the host design assumed, so a person can read them off the screen:
 *
 *   isSecureContext      the scheme is registered `secure`
 *   crossOriginIsolated  expected false (no COOP/COEP; no SharedArrayBuffer)
 *   gpu                  whether navigator.gpu exists (WebGPU available)
 *   worker               a module Worker running this origin's worker script started
 *   wasm                 that worker instantiated a .wasm from this origin
 *   size                 host.onResize delivers width x height @ dpr
 *
 * Worker construction goes through a same-origin blob: trampoline. Chromium
 * requires a Worker's script URL to be same-origin with the document (CORS
 * headers cannot relax this), and the document is the renderer origin
 * (http://localhost:5173 in dev, file:// when packaged) while this module is
 * served from tapestry-plugin://. A blob: URL created by the document is
 * same-origin with it, so a one-statement blob module that statically imports
 * the absolute worker URL is accepted, and the real worker module plus the
 * .wasm still load over tapestry-plugin:// with CORS. The worker module's own
 * import.meta.url stays the tapestry-plugin:// URL, so it resolves spike.wasm
 * relative to itself as before.
 *
 * globalThis.__exampleSurfaceMounts / __exampleSurfaceDisposes count
 * open/close cycles so mount and dispose can be checked to balance.
 *
 * @typedef {import('@tapestry/sdk').SurfaceHost} SurfaceHost
 * @typedef {import('@tapestry/sdk').SurfaceHandle} SurfaceHandle
 * @typedef {import('@tapestry/sdk').SurfaceModule} SurfaceModule
 */

/** @type {SurfaceModule} */
const surface = {
  /**
   * @param {SurfaceHost} host
   * @returns {SurfaceHandle}
   */
  mount(host) {
    globalThis.__exampleSurfaceMounts = (globalThis.__exampleSurfaceMounts ?? 0) + 1

    /** @type {Record<string, string>} */
    const facts = {
      isSecureContext: String(globalThis.isSecureContext),
      crossOriginIsolated: String(globalThis.crossOriginIsolated),
      gpu: String('gpu' in navigator),
      worker: 'pending',
      wasm: 'pending',
      size: 'pending',
    }

    const pre = document.createElement('pre')
    pre.className = 'example-surface-facts'
    pre.style.margin = '16px'
    pre.style.fontFamily = 'ui-monospace, Menlo, monospace'
    pre.style.fontSize = '14px'
    pre.style.lineHeight = '1.6'
    host.container.appendChild(pre)

    const render = () => {
      pre.textContent = Object.entries(facts)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
    }
    render()

    // Module Worker running this origin's worker script, spawned through a
    // same-origin blob: trampoline (see the header comment). The worker fetches
    // and instantiates the .wasm.
    let worker = null
    let blobUrl = null
    const revokeBlobUrl = () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
        blobUrl = null
      }
    }
    try {
      const workerUrl = new URL('./surface.worker.js', import.meta.url).href
      const trampoline = new Blob([`import ${JSON.stringify(workerUrl)};`], {
        type: 'text/javascript',
      })
      blobUrl = URL.createObjectURL(trampoline)
      worker = new Worker(blobUrl, { type: 'module' })
      worker.onmessage = (event) => {
        // The worker has started, so the blob: URL has been consumed.
        revokeBlobUrl()
        facts.worker = String(event.data.worker)
        facts.wasm = String(event.data.wasm)
        render()
      }
      worker.onerror = (event) => {
        revokeBlobUrl()
        facts.worker = 'error: ' + (event.message || 'worker error')
        facts.wasm = 'error: worker failed'
        render()
      }
    } catch (err) {
      revokeBlobUrl()
      facts.worker = 'error: ' + (err instanceof Error ? err.message : String(err))
      facts.wasm = 'error: worker failed'
      render()
    }

    const unsubscribeResize = host.onResize((width, height, dpr) => {
      facts.size = `${Math.round(width)}x${Math.round(height)}@${dpr}`
      render()
    })

    let disposed = false
    return {
      dispose() {
        if (disposed) return
        disposed = true
        unsubscribeResize()
        if (worker) worker.terminate()
        revokeBlobUrl()
        host.container.replaceChildren()
        globalThis.__exampleSurfaceDisposes = (globalThis.__exampleSurfaceDisposes ?? 0) + 1
      },
    }
  },
}

export default surface
