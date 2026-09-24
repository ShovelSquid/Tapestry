/**
 * main.ts — the surface module: `mount(host)` renders into host.container
 * and returns a handle whose `dispose` is idempotent.
 *
 * Mounted by Tapestry's PluginSurfaceLayer over tapestry-plugin:// (CANV-04,
 * registered in ../../index.js) and by the plugin's own dev page
 * (dev-host.ts) with the same SDK SurfaceHost shape. Imports only SDK types
 * (erased at build) and its own code — never the host, never Electron.
 *
 * In this plan the surface is the 01-01 tick/hash panel plus a full-size
 * measurement stage below it: PenMeasure listens there and the JSON overlay
 * (toggled with M, on by default) shows what the pen on this Mac delivers.
 * Task 3 turns those numbers into the fence's constants; 01-07 puts the
 * three.js stage here.
 */
import type { SurfaceHandle, SurfaceHost, SurfaceModule } from '@tapestry/sdk'
import { INK_BRUSH, hexOf } from './ddsim-abi'
import { PenMeasure } from './measure'
import { WorkerTransport, type SimHost } from './sim-host'

/** How often (in ticks) the panel refreshes the hash. */
const HASH_EVERY_TICKS = 30
const DEV_SEED = 42

export interface MountedSurface extends SurfaceHandle {
  /** The sim behind the panel, for the dev page's console. */
  readonly sim: SimHost
  /** The pen measurement, for the console (`__dd.measure.summary()`). */
  readonly measure: PenMeasure
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  return e
}

export function mount(host: SurfaceHost): MountedSurface {
  const sim: SimHost = new WorkerTransport(DEV_SEED)

  // Root fills the host container: panel on top, measurement stage below.
  const root = el('div')
  root.style.cssText =
    'position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; color: #ddd;'

  const panel = el('div')
  panel.style.cssText =
    'flex: 0 0 auto; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 12px 16px; white-space: pre; border-bottom: 1px solid #3a3a3a;'
  const tickLine = el('div', 'tick   —')
  const nodeLine = el('div', 'nodes  —')
  const hashLine = el('div', 'hash   —')
  const statusLine = el('div', 'status starting worker…')
  const button = el('button', 'Define brush')
  button.style.cssText = 'margin-top: 10px; font: inherit; padding: 4px 10px;'
  button.disabled = true
  const appliedLine = el('div', '')
  const measureHint = el(
    'div',
    'measure pen on the dark area below · M toggles the JSON overlay · start strokes outside the overlay · every stroke end logs [dd-measure] to the console',
  )
  measureHint.style.cssText = 'margin-top: 8px; color: #9ab;'
  panel.append(
    el('div', `data-drawing surface — tree ${host.treeId}`),
    tickLine,
    nodeLine,
    hashLine,
    statusLine,
    button,
    appliedLine,
    measureHint,
  )

  // The measurement stage: PenMeasure sets touch-action none and captures.
  const stage = el('div')
  stage.style.cssText =
    'flex: 1 1 auto; position: relative; min-height: 0; background: #141414; cursor: crosshair; user-select: none;'
  const overlay = el('pre')
  overlay.style.cssText =
    'position: absolute; top: 8px; right: 8px; margin: 0; max-height: calc(100% - 16px); overflow: auto; padding: 8px 10px; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cfe8d8; background: rgba(0, 0, 0, 0.7); border: 1px solid #2f4f3f; border-radius: 4px; user-select: text; cursor: text;'
  stage.append(overlay)

  root.append(panel, stage)
  host.container.replaceChildren(root)

  let disposed = false
  let lastHashTick = -Infinity
  let hashInFlight = false

  const refreshHash = (tick: number): void => {
    if (hashInFlight) return
    hashInFlight = true
    sim
      .hash()
      .then((bytes) => {
        if (disposed) return
        hashLine.textContent = `hash   ${hexOf(bytes)}`
        lastHashTick = tick
      })
      .catch(() => {
        /* disposed mid-request */
      })
      .finally(() => {
        hashInFlight = false
      })
  }

  const unsubscribeSnapshot = sim.onSnapshot((s) => {
    tickLine.textContent = `tick   ${s.tick}`
    nodeLine.textContent = `nodes  ${s.nodeCount}`
    if (s.tick - lastHashTick >= HASH_EVERY_TICKS) refreshHash(s.tick)
  })

  const unsubscribeRejected = sim.onRejected((e) => {
    appliedLine.textContent = `rejected: ${e.name}`
  })

  sim.ready
    .then(({ version, tickHz }) => {
      if (disposed) return
      statusLine.textContent = `status sim v${version} at ${tickHz} Hz in a module Worker`
      button.disabled = false
    })
    .catch((err: unknown) => {
      statusLine.textContent = `status worker failed: ${err instanceof Error ? err.message : String(err)}`
    })

  button.addEventListener('click', () => {
    button.disabled = true
    sim
      .defineBrush(INK_BRUSH)
      .then((id) => {
        appliedLine.textContent = `applied at tick ${sim.currentTick()} (brush version ${id})`
        refreshHash(sim.currentTick())
      })
      .catch((err: unknown) => {
        appliedLine.textContent = `rejected: ${err instanceof Error ? err.name : String(err)}`
      })
      .finally(() => {
        if (!disposed) button.disabled = false
      })
  })

  // Pen measurement: overlay re-rendered once per frame while sampling,
  // rendered and logged at every stroke end.
  let overlayFrame: number | null = null
  const measure = new PenMeasure((reason) => {
    if (disposed) return
    if (reason === 'stroke-end') {
      if (overlayFrame !== null) {
        cancelAnimationFrame(overlayFrame)
        overlayFrame = null
      }
      measure.render(overlay)
      return
    }
    if (overlayFrame !== null) return
    overlayFrame = requestAnimationFrame(() => {
      overlayFrame = null
      if (!disposed) measure.render(overlay, false)
    })
  })
  const detachMeasure = measure.attach(stage)
  measure.render(overlay, false)

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return
    if (ev.key === 'm' || ev.key === 'M') {
      overlay.hidden = !overlay.hidden
      if (!overlay.hidden) measure.render(overlay, false)
    }
  }
  window.addEventListener('keydown', onKey)

  const unsubscribeResize = host.onResize(() => {
    /* root is absolutely sized by the container; the stage (01-07) will resize here */
  })

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    window.removeEventListener('keydown', onKey)
    if (overlayFrame !== null) cancelAnimationFrame(overlayFrame)
    detachMeasure()
    unsubscribeSnapshot()
    unsubscribeRejected()
    unsubscribeResize()
    sim.dispose()
    if (root.parentNode === host.container) host.container.removeChild(root)
  }

  return { dispose, sim, measure }
}

const surfaceModule: SurfaceModule = { mount }
export default surfaceModule
