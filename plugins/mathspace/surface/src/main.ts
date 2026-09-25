/**
 * main.ts — the mathspace stage surface: `mount(host)` draws every View
 * node of the tree as a panel of dots and returns a handle whose
 * `dispose` is idempotent.
 *
 * Data path (API 1 gives a surface no kernel handle, but it runs in the
 * host renderer's realm): the surface reads the tree's nodes through
 * `window.tapestry.kernel.getNodes(treeId)`, builds the same engine the
 * runner builds (world.js, same seed, same image), projects every note
 * through every view (projection.js) and draws (panels.ts). It reads
 * again on every `onTreeChanged` for its tree, which is how the runner's
 * commits reach it. Nothing here writes to the kernel.
 *
 * The engine glue is imported statically from the plugin's wasm/ output;
 * the Vite build keeps mathspace.wasm a file beside surface.js.
 */
import type { SurfaceHandle, SurfaceHost } from '@tapestry/sdk'
import createModule from '../../wasm/mathspace.mjs'
import { buildWorld, projectAll, type Projection } from './engine'
import { draw } from './panels'

const EMPTY: Projection = { views: [], points: [] }

export interface MountedSurface extends SurfaceHandle {
  /** Re-read the tree and redraw; resolves when drawn. For tests and the dev page. */
  refresh(): Promise<void>
  /** The last projection drawn. */
  readonly projection: Projection
}

export function mount(host: SurfaceHost): MountedSurface {
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  host.container.appendChild(canvas)
  const status = document.createElement('div')
  status.style.cssText = 'position:absolute;left:8px;bottom:8px;font:12px ui-monospace,Menlo,monospace;color:#9a9a9a;pointer-events:none'
  host.container.appendChild(status)

  let disposed = false
  let width = 1
  let height = 1
  let projection: Projection = EMPTY
  const modulePromise = createModule()

  const paint = (): void => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(canvas.width / width, canvas.height / height)
    draw(ctx, projection, width, height)
  }

  let inFlight: Promise<void> | null = null
  const refresh = (): Promise<void> => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const api = window.tapestry
        if (!api) {
          status.textContent = 'window.tapestry is not available; nothing to read'
          return
        }
        const [nodes, mod] = await Promise.all([api.kernel.getNodes(host.treeId), modulePromise])
        if (disposed) return
        const { engine, image } = buildWorld(nodes, mod)
        try {
          projection = projectAll(engine, image)
        } finally {
          engine.destroy()
        }
        const problems = image.problems.length
        status.textContent = `${image.views.length} view${image.views.length === 1 ? '' : 's'}, ${image.notes.length} note${image.notes.length === 1 ? '' : 's'}${problems ? `, ${problems} problem${problems === 1 ? '' : 's'}` : ''}`
        paint()
      } catch (err) {
        status.textContent = `mathspace: ${err instanceof Error ? err.message : String(err)}`
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  const unResize = host.onResize((w, h, dpr) => {
    width = Math.max(1, w)
    height = Math.max(1, h)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    paint()
  })
  const unChanged = window.tapestry?.onTreeChanged((treeId) => {
    if (treeId === host.treeId) void refresh()
  })
  void refresh()

  return {
    get projection() { return projection },
    refresh,
    dispose() {
      if (disposed) return
      disposed = true
      unResize()
      unChanged?.()
      canvas.remove()
      status.remove()
    },
  }
}

export default { mount }
