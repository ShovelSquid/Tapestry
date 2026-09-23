/**
 * main.ts — the surface module: `mount(host)` renders into host.container
 * and returns a handle whose `dispose` is idempotent.
 *
 * In this plan the surface is a monospace panel showing the live tick, node
 * count and state hash from the Worker sim, with one "Define brush" button
 * that submits the same DefineBrush as one-brush.actions. The stage,
 * camera, plane and pen input arrive in 01-06 and 01-07.
 */
import { INK_BRUSH, hexOf } from './ddsim-abi'
import type { SurfaceHostLike } from './host-types'
import { WorkerTransport, type SimHost } from './sim-host'

export interface SurfaceHandle {
  dispose(): void
}

export interface SurfaceModule {
  mount(host: SurfaceHostLike): SurfaceHandle
}

/** How often (in ticks) the panel refreshes the hash. */
const HASH_EVERY_TICKS = 30
const DEV_SEED = 42

export interface MountedSurface extends SurfaceHandle {
  /** The sim behind the panel, for the dev page's console. */
  readonly sim: SimHost
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  return e
}

export function mount(host: SurfaceHostLike): MountedSurface {
  const sim: SimHost = new WorkerTransport(DEV_SEED)

  const panel = el('div')
  panel.style.cssText =
    'font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 12px 16px; color: #ddd; white-space: pre;'
  const tickLine = el('div', 'tick   —')
  const nodeLine = el('div', 'nodes  —')
  const hashLine = el('div', 'hash   —')
  const statusLine = el('div', 'status starting worker…')
  const button = el('button', 'Define brush')
  button.style.cssText = 'margin-top: 10px; font: inherit; padding: 4px 10px;'
  button.disabled = true
  const appliedLine = el('div', '')
  panel.append(el('div', `data-drawing surface — tree ${host.treeId}`), tickLine, nodeLine, hashLine, statusLine, button, appliedLine)
  host.container.replaceChildren(panel)

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

  const unsubscribeResize = host.onResize(() => {
    /* the panel flows with the container; the stage (01-07) will resize here */
  })

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubscribeSnapshot()
    unsubscribeRejected()
    unsubscribeResize()
    sim.dispose()
    if (panel.parentNode === host.container) host.container.removeChild(panel)
  }

  return { dispose, sim }
}

const surfaceModule: SurfaceModule = { mount }
export default surfaceModule
