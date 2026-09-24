/**
 * dev-host.ts — the plugin's own dev loop: a stub SurfaceHost with a
 * full-window container, mounted on load. `window.__dd` exposes the host,
 * sim, brushes and stage for console poking (e.g. `await __dd.sim.log()`,
 * `__dd.sim.pause(true)`, `__dd.brushes.versions`,
 * `(await __dd.stage).backendInfo()`, `__dd.handle.attachMeasure()` for the
 * pen re-measurement, `await __dd.handle.verifyReplay()`,
 * `await __dd.handle.switchTransport('main')`).
 *
 * Query parameters: `?webgl=1` forces the WebGL 2 backend and
 * `?transport=main` runs the sim on the main thread (both read by main.ts,
 * passed through untouched); `?cycles=N` (01-08, pitfall 7) mounts the
 * surface, waits for its stage, waits 250 ms, disposes it, N times, then
 * mounts once more and prints `cycles: mounted=<n> disposed=<n> lost=<n>`
 * — mounts and disposes counted here, `lost` = webglcontextlost events seen
 * on the document (a dispose on the WebGL 2 backend forces one each; the
 * WebGPU backend raises none).
 *
 * The host shape is the SDK's SurfaceHost (type-only import, erased by
 * Vite), so what the dev page mounts is exactly what Tapestry mounts.
 */
import type { SurfaceHost } from '@tapestry/sdk'
import { mount, type MountedSurface } from './main'

export interface CyclesReport {
  mounted: number
  disposed: number
  lost: number
  backend: string
  line: string
}

declare global {
  interface Window {
    __dd?: {
      host: SurfaceHost
      readonly sim: MountedSurface['sim']
      brushes: MountedSurface['brushes']
      stage: MountedSurface['stage']
      handle: MountedSurface
    }
    /** Set once the `?cycles=N` harness has finished. */
    __ddCycles?: CyclesReport
  }
}

const container = document.getElementById('surface')
if (container === null) throw new Error('dev page: #surface missing')
const cyclesOut = document.getElementById('cycles')

let handle: MountedSurface | null = null
let mounted = 0
let disposed = 0
let lost = 0

/**
 * Counts webglcontextlost on the stage's own canvas. The event does not
 * bubble and is dispatched asynchronously, after dispose has already
 * detached the canvas, so a listener on the document never sees the loss a
 * dispose forces (WEBGL_lose_context on the WebGL 2 backend); a listener on
 * the canvas itself still fires for a detached target. The WebGPU backend
 * raises no such event, so `lost` stays 0 there.
 */
function countLosses(h: MountedSurface): Promise<void> {
  return h.stage
    .then((st) => {
      st.canvas.addEventListener('webglcontextlost', () => {
        lost += 1
      })
    })
    .catch(() => {
      /* the stage failed; reported by the panel */
    })
}

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
    doDispose()
    container.replaceChildren()
    delete window.__dd
  },
}

function doMount(): MountedSurface {
  const h = mount(host)
  handle = h
  mounted += 1
  void countLosses(h)
  window.__dd = {
    host,
    get sim() {
      return h.sim
    },
    brushes: h.brushes,
    stage: h.stage,
    handle: h,
  }
  return h
}

function doDispose(): void {
  if (handle === null) return
  handle.dispose()
  handle = null
  disposed += 1
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function runCycles(n: number): Promise<CyclesReport> {
  let backend = 'n/a'
  for (let i = 0; i < n; i++) {
    const h = doMount()
    // Wait for the renderer so every cycle really creates (and releases) a context.
    await h.stage.then((st) => {
      backend = st.backendInfo()
    }).catch(() => {
      /* counted as a mount regardless */
    })
    await sleep(250)
    doDispose()
  }
  const final = doMount()
  await final.stage.then((st) => {
    backend = st.backendInfo()
  }).catch(() => {
    /* reported below */
  })
  // Let the last forced context loss (if any) dispatch before counting.
  await sleep(100)
  const line = `cycles: mounted=${mounted} disposed=${disposed} lost=${lost}`
  const report: CyclesReport = { mounted, disposed, lost, backend, line }
  console.log(line, `(backend=${backend}; lost counts the context losses dispose forces on the WebGL 2 backend)`)
  if (cyclesOut !== null) cyclesOut.textContent = `${line}\nbackend=${backend}`
  window.__ddCycles = report
  return report
}

const cyclesParam = Number(new URLSearchParams(location.search).get('cycles') ?? '0')
if (Number.isInteger(cyclesParam) && cyclesParam > 0) {
  void runCycles(cyclesParam)
} else {
  doMount()
}
