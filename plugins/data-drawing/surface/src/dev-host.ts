/**
 * dev-host.ts — the plugin's own dev loop: a stub SurfaceHost with a
 * full-window container, mounted on load. `window.__dd` exposes the host,
 * sim and measurement for console poking (e.g. `await __dd.sim.log()`,
 * `__dd.sim.pause(true)`, `__dd.measure.summary()`).
 *
 * The host shape is the SDK's SurfaceHost (type-only import, erased by
 * Vite), so what the dev page mounts is exactly what Tapestry mounts.
 */
import type { SurfaceHost } from '@tapestry/sdk'
import { mount, type MountedSurface } from './main'

declare global {
  interface Window {
    __dd?: {
      host: SurfaceHost
      sim: MountedSurface['sim']
      measure: MountedSurface['measure']
      handle: MountedSurface
    }
  }
}

const container = document.getElementById('surface')
if (container === null) throw new Error('dev page: #surface missing')

let handle: MountedSurface | null = null

const host: SurfaceHost = {
  container,
  treeId: 'dev',
  onResize(cb) {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) cb(entry.contentRect.width, entry.contentRect.height, window.devicePixelRatio)
    })
    ro.observe(container)
    return () => ro.disconnect()
  },
  close() {
    handle?.dispose()
    handle = null
    container.replaceChildren()
    delete window.__dd
  },
}

handle = mount(host)
window.__dd = { host, sim: handle.sim, measure: handle.measure, handle }
