/**
 * dev-host.ts — the plugin's own dev loop (`npm run dev` here): a stub
 * SurfaceHost over a full-window container and a stub `window.tapestry`
 * whose kernel holds one fixture world (a 3D space, three views, two
 * notes), so the surface can be tried without the app. `window.__ms.handle`
 * is the mounted surface for console poking (`await __ms.handle.refresh()`,
 * `__ms.changed()` to fake a commit).
 *
 * The page mounts the built `dist/surface.js`, not `src/main.ts`: the
 * bundle carries the plugin's CommonJS files (image.js and friends), which
 * the dev server would serve untransformed. So what the dev page mounts is
 * byte for byte what Tapestry mounts; `npm run dev` builds first.
 */
import type { SurfaceHost } from '@tapestry/sdk'
import type { MountedSurface } from './main'
import type { KernelNode } from './tapestry'

const ref = (value: string) => ({ type: 'ref', value })
const real = (value: number) => ({ type: 'real', value })
const text = (value: string) => ({ type: 'text', value })
const VIEW = 'mathspace/view@1'
const NOTE = 'tapestry.notes/note@1'

const fixture: KernelNode[] = [
  { id: 'n1', type: 'mathspace/space@1', props: { dim: { type: 'int', value: 3 } } },
  { id: 'n2', type: NOTE, props: { space: ref('n1'), 'position.x': real(4), 'position.y': real(6), 'position.z': real(0) } },
  { id: 'n3', type: NOTE, props: { space: ref('n1'), 'position.x': real(1), 'position.y': real(2), 'position.z': real(2) } },
  { id: 'n4', type: VIEW, props: { space: ref('n1'), 'project.expr': text('[self.position.x, self.position.y]') } },
  { id: 'n5', type: VIEW, props: { space: ref('n1'), 'project.expr': text('[self.position.x, self.position.y] / (self.position.z + 2)') } },
  { id: 'n6', type: VIEW, props: { space: ref('n1'), 'project.expr': text('self.position.z') } },
]

const listeners = new Set<(treeId: string) => void>()
window.tapestry = {
  kernel: { getNodes: async () => structuredClone(fixture) },
  onTreeChanged(cb) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
}

const container = document.getElementById('surface')
if (container === null) throw new Error('dev page: #surface missing')

const host: SurfaceHost = {
  container,
  treeId: 'dev',
  onResize(cb) {
    const ro = new ResizeObserver(() => cb(container.clientWidth, container.clientHeight, window.devicePixelRatio))
    ro.observe(container)
    cb(container.clientWidth, container.clientHeight, window.devicePixelRatio)
    return () => ro.disconnect()
  },
  close() {
    handle?.dispose()
  },
}

let handle: MountedSurface | null = null
declare global {
  interface Window {
    __ms?: { host: SurfaceHost; handle: MountedSurface; fixture: KernelNode[]; changed(): void }
  }
}

const surface = (await import(/* @vite-ignore */ new URL('../dist/surface.js', import.meta.url).href)) as {
  default: { mount(host: SurfaceHost): MountedSurface }
}
handle = surface.default.mount(host)
window.__ms = { host, handle, fixture, changed: () => listeners.forEach((cb) => cb('dev')) }
