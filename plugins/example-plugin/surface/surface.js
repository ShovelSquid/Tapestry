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
 *   worker               a module Worker spawned from this origin started
 *   wasm                 that worker instantiated a .wasm from this origin
 *   size                 host.onResize delivers width x height @ dpr
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

    // Module Worker from this same origin; it fetches and instantiates the .wasm.
    let worker = null
    try {
      worker = new Worker(new URL('./surface.worker.js', import.meta.url), { type: 'module' })
      worker.onmessage = (event) => {
        facts.worker = String(event.data.worker)
        facts.wasm = String(event.data.wasm)
        render()
      }
      worker.onerror = (event) => {
        facts.worker = 'error: ' + (event.message || 'worker error')
        facts.wasm = 'error: worker failed'
        render()
      }
    } catch (err) {
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
        host.container.replaceChildren()
        globalThis.__exampleSurfaceDisposes = (globalThis.__exampleSurfaceDisposes ?? 0) + 1
      },
    }
  },
}

export default surface
