/**
 * dev-host.ts — the plugin's own dev loop: a stub host with a full-window
 * container, mounted on load. `window.__dd` exposes the host and sim for
 * console poking (e.g. `await __dd.sim.log()`, `__dd.sim.pause(true)`).
 */
import type { SurfaceHostLike } from './host-types'
import { mount, type MountedSurface } from './main'

declare global {
  interface Window {
    __dd?: { host: SurfaceHostLike; sim: MountedSurface['sim']; handle: MountedSurface }
  }
}

const container = document.getElementById('surface')
if (container === null) throw new Error('dev page: #surface missing')

let handle: MountedSurface | null = null

const host: SurfaceHostLike = {
  container,
  treeId: 'dev',
  onResize(cb) {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) cb(entry.contentRect.width, entry.contentRect.height)
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
window.__dd = { host, sim: handle.sim, handle }
