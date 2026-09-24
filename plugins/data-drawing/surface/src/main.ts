/**
 * main.ts — the surface module: `mount(host)` renders into host.container
 * and returns a handle whose `dispose` is idempotent.
 *
 * Mounted by Tapestry's PluginSurfaceLayer over tapestry-plugin:// (CANV-04,
 * registered in ../../index.js) and by the plugin's own dev page
 * (dev-host.ts) with the same SDK SurfaceHost shape. Imports only SDK types
 * (erased at build) and its own code — never the host, never Electron.
 *
 * The surface is a brush panel over a three.js stage (stage/scene.ts). The
 * wiring, fence to sim and back:
 *   pen-down  -> PenFence.onBegin(pressureSource, frame): the plane frame is
 *                captured once; SimHost.beginStroke with the current brush
 *   move      -> onSamples(coalesced RawSample[]) -> SimHost.pushSamples
 *                (the Worker stamps tick/index); the last sample is the
 *                overlay's pen position; onPreview(points) -> overlay only
 *   pen-up    -> onEnd -> SimHost.endStroke; pen null hides the overlay
 *   snapshot  -> kept; each frame uploads it to the node field and reads
 *                the stroke's body for the overlay
 * Predicted points never reach the sim; nothing is smoothed here (the brush
 * mass in the sim is the only stabilizer). The renderer only reads
 * transferred snapshot copies; every change to the world is a recorded
 * action. Painting while paused is refused at pen-down (the samples would
 * pile into one tick and hit DD_MAX_SAMPLES_PER_TICK).
 */
import type { SurfaceHandle, SurfaceHost, SurfaceModule } from '@tapestry/sdk'
import { BrushTable, PRESETS } from './brushes'
import { decodeBodies, hexOf, strokeIdOf } from './ddsim-abi'
import { DEFAULT_SETTINGS, PenFence, Q16_ONE, type RawSample, type Settings } from './input'
import { PenMeasure } from './measure'
import { DEFAULT_PLANE, frameToQ16, type PlaneFrame } from './plane'
import { WorkerTransport, type SimHost, type Snapshot } from './sim-host'
import { colourFor } from './stage/colour'
import type { PlanePoint } from './stage/overlay'
import { createStage, type Stage } from './stage/scene'

/** How often (in ticks) the panel refreshes the hash. */
const HASH_EVERY_TICKS = 30
const DEV_SEED = 42

export interface MountedSurface extends SurfaceHandle {
  /** The sim behind the stage, for the dev page's console. */
  readonly sim: SimHost
  /** The brush versions this surface defined; `current` is the selected id. */
  readonly brushes: BrushTable
  /** Resolves once the stage (renderer, node field, overlay) exists. */
  readonly stage: Promise<Stage>
  /** The pointer fence attached to the stage canvas. */
  readonly fence: PenFence
  /** The painting settings the fence reads on every pen-down. */
  readonly settings: Settings
  /**
   * Re-measurement hook (01-06 open item): attaches the PenMeasure overlay
   * to the stage canvas and returns its detach. Not attached by default —
   * the fence owns the canvas while painting.
   */
  attachMeasure(): () => void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  return e
}

function numberInput(value: number, step: string, min: string): HTMLInputElement {
  const input = el('input')
  input.type = 'number'
  input.step = step
  input.min = min
  input.value = String(value)
  input.style.cssText = 'width: 6em; font: inherit;'
  return input
}

/** A Q32.32 reading for the form: 6 decimals is far inside Q32.32's 2.3e-10 resolution. */
function shown(x: number): number {
  return Number(x.toFixed(6))
}

function forceWebGLFromQuery(): boolean {
  if (typeof location === 'undefined') return false
  try {
    return new URLSearchParams(location.search).get('webgl') === '1'
  } catch {
    return false
  }
}

export function mount(host: SurfaceHost): MountedSurface {
  const sim: SimHost = new WorkerTransport(DEV_SEED)
  const brushes = new BrushTable(sim)
  const fence = new PenFence()
  const settings: Settings = { ...DEFAULT_SETTINGS }

  // Root fills the host container: panel on top, stage below.
  const root = el('div')
  root.style.cssText =
    'position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; color: #ddd; background: #0d0f14;'

  const panel = el('div')
  panel.style.cssText =
    'flex: 0 0 auto; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 10px 16px; border-bottom: 1px solid #3a3a3a; display: flex; flex-wrap: wrap; gap: 6px 24px; align-items: flex-start;'

  const statusCol = el('div')
  statusCol.style.cssText = 'white-space: pre; min-width: 30em;'
  const tickLine = el('div', 'tick    —')
  const nodeLine = el('div', 'nodes   —')
  const hashLine = el('div', 'hash    —')
  const statusLine = el('div', 'status  starting worker…')
  const backendLine = el('div', 'backend —')
  const strokeLine = el('div', 'stroke  —')
  const errorLine = el('div', '')
  errorLine.style.cssText = 'color: #f5a3a3;'
  statusCol.append(el('div', `data-drawing surface — tree ${host.treeId}`), tickLine, nodeLine, hashLine, statusLine, backendLine, strokeLine, errorLine)

  // Brush picker + edit form.
  const brushCol = el('div')
  brushCol.style.cssText = 'display: grid; grid-template-columns: auto auto; gap: 4px 8px; align-items: center;'
  const select = el('select')
  select.style.cssText = 'font: inherit; min-width: 14em;'
  select.disabled = true
  const descInput = el('input')
  descInput.type = 'text'
  descInput.style.cssText = 'width: 12em; font: inherit;'
  const massInput = numberInput(1, '1', '1')
  const radiusInput = numberInput(0.75, '0.05', '0.01')
  const spacingInput = numberInput(0.5, '0.05', '0.01')
  const saveButton = el('button', 'Save as new version')
  saveButton.style.cssText = 'font: inherit; padding: 2px 8px;'
  saveButton.disabled = true
  const mouseBox = el('input')
  mouseBox.type = 'checkbox'
  mouseBox.checked = settings.allowMouse
  const pauseBox = el('input')
  pauseBox.type = 'checkbox'
  const labelled = (text: string, control: HTMLElement): [HTMLElement, HTMLElement] => [el('label', text), control]
  brushCol.append(
    ...labelled('brush', select),
    ...labelled('description', descInput),
    ...labelled('mass', massInput),
    ...labelled('radius', radiusInput),
    ...labelled('spacing', spacingInput),
    el('span', ''),
    saveButton,
    ...labelled('mouse painting', mouseBox),
    ...labelled('pause', pauseBox),
  )
  panel.append(statusCol, brushCol)

  const stageContainer = el('div')
  stageContainer.style.cssText = 'flex: 1 1 auto; position: relative; min-height: 0; cursor: crosshair; user-select: none; overflow: hidden;'

  root.append(panel, stageContainer)
  host.container.replaceChildren(root)

  let disposed = false
  let lastHashTick = -Infinity
  let hashInFlight = false
  let paused = false

  // Painting state (main thread; the sim owns the truth).
  let lastSnapshot: Snapshot | null = null
  let snapshotDirty = false
  let nextOrdinal = 0
  let openOrdinal: number | null = null
  let openFrame: PlaneFrame = DEFAULT_PLANE
  let pen: PlanePoint | null = null
  let preview: PlanePoint[] = []
  let recorded = 0

  const showError = (text: string): void => {
    errorLine.textContent = text
  }

  const refreshHash = (tick: number): void => {
    if (hashInFlight) return
    hashInFlight = true
    sim
      .hash()
      .then((bytes) => {
        if (disposed) return
        hashLine.textContent = `hash    ${hexOf(bytes)}`
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
    lastSnapshot = s
    snapshotDirty = true
    tickLine.textContent = `tick    ${s.tick}`
    nodeLine.textContent = `nodes   ${s.nodeCount}`
    if (s.tick - lastHashTick >= HASH_EVERY_TICKS) refreshHash(s.tick)
  })

  const unsubscribeRejected = sim.onRejected((e) => {
    showError(`rejected: ${e.name} (code ${e.code}, action kind ${e.kind}${e.ordinal === undefined ? '' : `, stroke ${e.ordinal}`})`)
  })

  // ---- brush panel -------------------------------------------------------

  const refreshSelect = (): void => {
    select.replaceChildren(
      ...brushes.versions.map((v) => {
        const option = el('option', brushes.label(v))
        option.value = String(v.id)
        return option
      }),
    )
    select.value = String(brushes.current)
  }

  const showCurrentBrush = (): void => {
    const v = brushes.get(brushes.current)
    if (v === undefined) return
    descInput.value = v.description
    massInput.value = String(shown(v.mass))
    radiusInput.value = String(shown(v.radius))
    spacingInput.value = String(shown(v.spacing))
    void stage.then((st) => {
      if (!disposed) st.overlay.setBrush(colourFor(v.description), v.radius)
    })
  }

  select.addEventListener('change', () => {
    const id = Number(select.value)
    try {
      brushes.select(id)
      showCurrentBrush()
      showError('')
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : String(err))
    }
  })

  saveButton.addEventListener('click', () => {
    saveButton.disabled = true
    const base = brushes.get(brushes.current)
    if (base === undefined) {
      showError('no brush selected')
      saveButton.disabled = false
      return
    }
    // Only fields the user changed enter the patch; an untouched field is
    // copied from the base's exact raw value, not re-quantized from the
    // rounded reading in the form.
    const changed = (input: HTMLInputElement, baseValue: number): number | undefined => {
      const x = Number(input.value)
      return x === shown(baseValue) ? undefined : x
    }
    const patch = {
      description: descInput.value === base.description ? undefined : descInput.value,
      mass: changed(massInput, base.mass),
      radius: changed(radiusInput, base.radius),
      spacing: changed(spacingInput, base.spacing),
    }
    for (const x of [patch.mass, patch.radius, patch.spacing]) {
      if (x !== undefined && !Number.isFinite(x)) {
        showError('mass, radius and spacing must be numbers')
        saveButton.disabled = false
        return
      }
    }
    brushes
      .edit(brushes.current, patch)
      .then((id) => {
        if (disposed) return
        refreshSelect()
        showCurrentBrush()
        showError('')
        strokeLine.textContent = `stroke  brush v${id} defined at tick ${sim.currentTick()}`
      })
      .catch((err: unknown) => {
        showError(`brush rejected: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        if (!disposed) saveButton.disabled = false
      })
  })

  mouseBox.addEventListener('change', () => {
    settings.allowMouse = mouseBox.checked
  })

  pauseBox.addEventListener('change', () => {
    paused = pauseBox.checked
    sim.pause(paused)
  })

  // ---- stage -------------------------------------------------------------

  const bodyFor = (ordinal: number): PlanePoint | null => {
    const s = lastSnapshot
    if (s === null || s.bodyCount === 0) return null
    const id = strokeIdOf(0, ordinal)
    const bodies = decodeBodies(s.bodies, s.bodyCount)
    for (let i = 0; i < bodies.count; i++) {
      if (bodies.strokeId(i) === id) return { u: bodies.x(i), v: bodies.y(i) }
    }
    return null
  }

  const onFrame = (st: Stage): void => {
    if (lastSnapshot !== null && snapshotDirty) {
      st.nodes.update(lastSnapshot, brushes)
      snapshotDirty = false
    }
    st.overlay.update(pen, openOrdinal === null ? null : bodyFor(openOrdinal), preview, openFrame)
  }

  let stageRef: Stage | null = null
  let detachFence: (() => void) | null = null
  let resizeObserver: ResizeObserver | null = null

  const stage: Promise<Stage> = createStage(stageContainer, {
    forceWebGL: forceWebGLFromQuery(),
    onFrame: () => {
      if (stageRef !== null) onFrame(stageRef)
    },
    onContextRestored: () => {
      snapshotDirty = true
    },
  })

  stage
    .then((st) => {
      if (disposed) {
        st.dispose()
        return
      }
      stageRef = st
      backendLine.textContent = `backend ${st.backendInfo()}${forceWebGLFromQuery() ? ' (forced)' : ''}`

      const viewport = (): { width: number; height: number } => ({ width: st.canvas.clientWidth, height: st.canvas.clientHeight })
      st.resize(stageContainer.clientWidth, stageContainer.clientHeight, window.devicePixelRatio)
      resizeObserver = new ResizeObserver(() => {
        if (!disposed) st.resize(stageContainer.clientWidth, stageContainer.clientHeight, window.devicePixelRatio)
      })
      resizeObserver.observe(stageContainer)

      detachFence = fence.attach(st.canvas, {
        viewport,
        frame: () => DEFAULT_PLANE,
        settings: () => settings,
        callbacks: {
          onBegin: (pressureSource, frame) => {
            if (paused) {
              showError('paused: unpause to paint (samples would pile into one tick)')
              return
            }
            if (brushes.current === 0) {
              showError('no brush defined yet')
              return
            }
            const ordinal = ++nextOrdinal
            openOrdinal = ordinal
            openFrame = frame
            recorded = 0
            preview = []
            sim.beginStroke({ ordinal, brushVersionId: brushes.current, frameQ16: frameToQ16(frame), pressureSource })
            strokeLine.textContent = `stroke  ${ordinal} open (brush v${brushes.current}, ${pressureSource === 1 ? 'mouse' : 'pen'})`
          },
          onSamples: (samples: RawSample[]) => {
            if (openOrdinal === null) return
            sim.pushSamples(openOrdinal, samples)
            const last = samples[samples.length - 1]
            if (last !== undefined) pen = { u: last.u / Q16_ONE, v: last.v / Q16_ONE }
            recorded += samples.length
            strokeLine.textContent = `stroke  ${openOrdinal} open · ${recorded} samples`
          },
          onEnd: () => {
            if (openOrdinal === null) return
            sim.endStroke(openOrdinal)
            strokeLine.textContent = `stroke  ${openOrdinal} ended · ${recorded} samples`
            openOrdinal = null
            pen = null
            preview = []
          },
          onPreview: (points) => {
            preview = points
          },
        },
      })
    })
    .catch((err: unknown) => {
      backendLine.textContent = `backend failed: ${err instanceof Error ? err.message : String(err)}`
    })

  // ---- sim ready: define the four presets as versions 1..4 -----------------

  sim.ready
    .then(async ({ version, tickHz }) => {
      if (disposed) return
      statusLine.textContent = `status  sim v${version} at ${tickHz} Hz in a module Worker`
      for (const preset of PRESETS) {
        await brushes.define(preset)
        if (disposed) return
      }
      brushes.select(1)
      refreshSelect()
      showCurrentBrush()
      select.disabled = false
      saveButton.disabled = false
      refreshHash(sim.currentTick())
    })
    .catch((err: unknown) => {
      statusLine.textContent = `status  worker failed: ${err instanceof Error ? err.message : String(err)}`
    })

  const unsubscribeResize = host.onResize((_w, _h, dpr) => {
    if (stageRef !== null) stageRef.resize(stageContainer.clientWidth, stageContainer.clientHeight, dpr)
  })

  const attachMeasure = (): (() => void) => {
    const st = stageRef
    if (st === null) throw new Error('stage not ready')
    const overlay = el('pre')
    overlay.style.cssText =
      'position: absolute; top: 8px; right: 8px; margin: 0; max-height: calc(100% - 16px); overflow: auto; padding: 8px 10px; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cfe8d8; background: rgba(0, 0, 0, 0.7); border: 1px solid #2f4f3f; border-radius: 4px; user-select: text; cursor: text; pointer-events: none;'
    stageContainer.append(overlay)
    const measure = new PenMeasure(() => {
      if (!disposed) measure.render(overlay, false)
    })
    const detach = measure.attach(st.canvas)
    measure.render(overlay, false)
    return () => {
      detach()
      overlay.remove()
    }
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    detachFence?.()
    detachFence = null
    resizeObserver?.disconnect()
    resizeObserver = null
    unsubscribeSnapshot()
    unsubscribeRejected()
    unsubscribeResize()
    sim.dispose()
    if (stageRef !== null) stageRef.dispose()
    stageRef = null
    if (root.parentNode === host.container) host.container.removeChild(root)
  }

  return { dispose, sim, brushes, stage, fence, settings, attachMeasure }
}

const surfaceModule: SurfaceModule = { mount }
export default surfaceModule
