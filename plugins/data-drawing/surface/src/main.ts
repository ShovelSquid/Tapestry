/**
 * main.ts — the surface module: `mount(host)` renders into host.container
 * and returns a handle whose `dispose` is idempotent.
 *
 * Mounted by Tapestry's PluginSurfaceLayer over tapestry-plugin:// (CANV-04,
 * registered in ../../index.js) and by the plugin's own dev page
 * (dev-host.ts) with the same SDK SurfaceHost shape. Imports only SDK types
 * (erased at build), three (through the stage) and its own code — never
 * the host, never Electron.
 *
 * The surface is a brush panel over a three.js stage (stage/scene.ts). The
 * wiring, fence to sim and back:
 *   pen-down  -> PenFence.onBegin(pressureSource, frame): the plane frame is
 *                captured once; SimHost.beginStroke with the current brush
 *   move      -> onSamples(coalesced RawSample[]) -> SimHost.pushSamples
 *                (the recorder stamps tick/index); the last sample is the
 *                overlay's pen position; onPreview(points) -> overlay only
 *   pen-up    -> onEnd -> SimHost.endStroke; pen null hides the overlay
 *   snapshot  -> kept; each frame uploads it to the node field and reads
 *                the stroke's body for the overlay
 * Predicted points never reach the sim; nothing is smoothed here (the brush
 * mass in the sim is the only stabilizer). The renderer only reads
 * transferred snapshot copies; every change to the world is a recorded
 * action. Painting while paused is refused at pen-down (the samples would
 * pile into one tick and hit DD_MAX_SAMPLES_PER_TICK).
 *
 * 01-08 adds the panel's measurement lines — backend/adapter, transport,
 * pen-to-ink latency (latency.ts), replay-from-zero (replay.ts) and the
 * tick/nodes/hash line — a "Verify replay" button, and a transport switch
 * (Worker <-> main thread) that continues the session by replaying the log
 * into the new transport. The dev page selects the transport with
 * `?transport=main` and the backend with `?webgl=1`.
 */
import type { SurfaceHandle, SurfaceHost, SurfaceModule } from '@tapestry/sdk'
import { BrushTable, PRESETS } from './brushes'
import { ActionKind, decodeBodies, hexOf, strokeIdOf, type BrushVersionSpec } from './ddsim-abi'
import { DEFAULT_SETTINGS, PenFence, Q16_ONE, type RawSample, type Settings } from './input'
import { LatencyMeter, formatLatencyLine } from './latency'
import { PenMeasure } from './measure'
import { DEFAULT_PLANE, frameToQ16, type PlaneFrame } from './plane'
import { describeReplay, formatReplayLine, verifyReplay, type ReplayVerdict } from './replay'
import { createTransport, type SimHost, type Snapshot, type TransportKind } from './sim-host'
import { colourFor } from './stage/colour'
import type { PlanePoint } from './stage/overlay'
import { createStage, type Stage } from './stage/scene'

/** How often (in ticks) the panel refreshes the hash. */
const HASH_EVERY_TICKS = 30
const DEV_SEED = 42

export interface MountedSurface extends SurfaceHandle {
  /** The sim behind the stage (the CURRENT transport; it changes on a transport switch). */
  readonly sim: SimHost
  /** The transport in use. */
  readonly transport: TransportKind
  /** The brush versions this surface defined; `current` is the selected id. */
  readonly brushes: BrushTable
  /** Resolves once the stage (renderer, node field, overlay) exists. */
  readonly stage: Promise<Stage>
  /** The pointer fence attached to the stage canvas. */
  readonly fence: PenFence
  /** The painting settings the fence reads on every pen-down. */
  readonly settings: Settings
  /** The pen-to-ink latency meter (per stroke). */
  readonly meter: LatencyMeter
  /** Replays the session log from zero and returns the verdict shown in the panel. */
  verifyReplay(): Promise<ReplayVerdict>
  /** Switches transport, continuing the session by replaying the log into the new one. */
  switchTransport(kind: TransportKind): Promise<void>
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

function queryParam(name: string): string | null {
  if (typeof location === 'undefined') return null
  try {
    return new URLSearchParams(location.search).get(name)
  } catch {
    return null
  }
}

function forceWebGLFromQuery(): boolean {
  return queryParam('webgl') === '1'
}

function transportFromQuery(): TransportKind {
  return queryParam('transport') === 'main' ? 'main' : 'worker'
}

/**
 * The GPU adapter behind WebGPU, for the panel's first line: description
 * when the browser exposes one, else vendor and architecture, else n/a.
 * Absent WebGPU (no navigator.gpu or no adapter) reads n/a as well — that
 * is the RESEARCH A13 finding the SUMMARY records.
 */
async function adapterDescription(): Promise<string> {
  const gpu = navigator.gpu as GPU | undefined
  if (gpu === undefined) return 'n/a'
  try {
    const adapter = await gpu.requestAdapter()
    if (adapter === null) return 'n/a'
    const legacy = adapter as GPUAdapter & { requestAdapterInfo?: () => Promise<GPUAdapterInfo> }
    const info: GPUAdapterInfo | undefined = adapter.info ?? (await legacy.requestAdapterInfo?.())
    if (info === undefined) return 'n/a'
    const parts = [info.vendor, info.architecture, info.device].filter((s) => s !== undefined && s !== '')
    if (info.description !== undefined && info.description !== '') return parts.length > 0 ? `${info.description} (${parts.join(' ')})` : info.description
    return parts.length > 0 ? parts.join(' ') : 'n/a'
  } catch {
    return 'n/a'
  }
}

export function mount(host: SurfaceHost): MountedSurface {
  let transportKind: TransportKind = transportFromQuery()
  let sim: SimHost = createTransport(transportKind, DEV_SEED)
  // The brush table delegates to whichever transport is current.
  const brushes = new BrushTable({ defineBrush: (spec: BrushVersionSpec) => sim.defineBrush(spec) })
  const fence = new PenFence()
  const settings: Settings = { ...DEFAULT_SETTINGS }
  const meter = new LatencyMeter()

  // Root fills the host container: panel on top, stage below.
  const root = el('div')
  root.style.cssText =
    'position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; color: #ddd; background: #0d0f14;'

  const panel = el('div')
  panel.style.cssText =
    'flex: 0 0 auto; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 10px 16px; border-bottom: 1px solid #3a3a3a; display: flex; flex-wrap: wrap; gap: 6px 24px; align-items: flex-start;'

  // The measurement lines (01-08 interfaces block), one per line, first line first.
  const statusCol = el('div')
  statusCol.style.cssText = 'white-space: pre; min-width: 30em;'
  const backendLine = el('div', 'backend=… adapter=…')
  const transportLine = el('div', `transport=${transportKind}`)
  const latencyLine = el('div', formatLatencyLine(null))
  const replayRow = el('div')
  replayRow.style.cssText = 'display: flex; gap: 12px; align-items: center;'
  const replayLine = el('span', 'replay: —')
  const verifyButton = el('button', 'Verify replay')
  verifyButton.style.cssText = 'font: inherit; padding: 0 8px;'
  verifyButton.disabled = true
  replayRow.append(replayLine, verifyButton)
  const stateLine = el('div', 'tick=— nodes=— hash=—')
  const statusLine = el('div', 'status  starting sim…')
  const strokeLine = el('div', 'stroke  —')
  const errorLine = el('div', '')
  errorLine.style.cssText = 'color: #f5a3a3;'
  statusCol.append(backendLine, transportLine, latencyLine, replayRow, stateLine, statusLine, strokeLine, errorLine, el('div', `data-drawing surface — tree ${host.treeId}`))

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
  const transportBox = el('input')
  transportBox.type = 'checkbox'
  transportBox.checked = transportKind === 'main'
  transportBox.disabled = true
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
    ...labelled('main-thread transport', transportBox),
  )
  panel.append(statusCol, brushCol)

  const stageContainer = el('div')
  stageContainer.style.cssText = 'flex: 1 1 auto; position: relative; min-height: 0; cursor: crosshair; user-select: none; overflow: hidden;'

  root.append(panel, stageContainer)
  host.container.replaceChildren(root)

  let disposed = false
  let lastHashTick = -Infinity
  let hashInFlight = false
  let lastHashHex = '—'
  let paused = false
  let switching = false

  // Painting state (main thread; the sim owns the truth).
  let lastSnapshot: Snapshot | null = null
  let snapshotDirty = false
  let nextOrdinal = 0
  let openOrdinal: number | null = null
  let openFrame: PlaneFrame = DEFAULT_PLANE
  let pen: PlanePoint | null = null
  let preview: PlanePoint[] = []
  let recorded = 0

  // Latency bookkeeping: each pushSamples call is one batch; the recorder
  // echoes the applied tick per batch, in order, per stroke ordinal.
  let batchSeq = 0
  const sentBatches = new Map<number, Array<{ key: number; t0: number }>>()

  const showError = (text: string): void => {
    errorLine.textContent = text
  }

  const showState = (tick: number, nodes: number): void => {
    stateLine.textContent = `tick=${tick} nodes=${nodes} hash=${lastHashHex}`
  }

  const refreshHash = (tick: number): void => {
    if (hashInFlight) return
    hashInFlight = true
    sim
      .hash()
      .then((bytes) => {
        if (disposed) return
        lastHashHex = hexOf(bytes)
        lastHashTick = tick
        const s = lastSnapshot
        showState(s === null ? tick : s.tick, s === null ? 0 : s.nodeCount)
      })
      .catch(() => {
        /* disposed mid-request */
      })
      .finally(() => {
        hashInFlight = false
      })
  }

  const updateLatencyLine = (): void => {
    latencyLine.textContent = formatLatencyLine(meter.strokeStats())
  }

  // ---- sim subscriptions (re-attached on a transport switch) ----------------

  let detachSim: (() => void) | null = null

  const attachSim = (s: SimHost): void => {
    const unsubscribeSnapshot = s.onSnapshot((snap) => {
      lastSnapshot = snap
      snapshotDirty = true
      meter.onSnapshot(snap.tick)
      showState(snap.tick, snap.nodeCount)
      if (snap.tick - lastHashTick >= HASH_EVERY_TICKS) refreshHash(snap.tick)
    })
    const unsubscribeRejected = s.onRejected((e) => {
      if (e.kind === ActionKind.StrokeSamples && e.ordinal !== undefined) sentBatches.get(e.ordinal)?.shift()
      showError(`rejected: ${e.name} (code ${e.code}, action kind ${e.kind}${e.ordinal === undefined ? '' : `, stroke ${e.ordinal}`})`)
    })
    const unsubscribeApplied = s.onStrokeApplied((e) => {
      if (e.actionKind !== ActionKind.StrokeSamples) return
      const batch = sentBatches.get(e.ordinal)?.shift()
      if (batch !== undefined) meter.markSent(batch.key, e.tick, batch.t0)
    })
    detachSim = () => {
      unsubscribeSnapshot()
      unsubscribeRejected()
      unsubscribeApplied()
    }
  }
  attachSim(sim)

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

  // ---- replay verification --------------------------------------------------

  const runVerifyReplay = async (): Promise<ReplayVerdict> => {
    verifyButton.disabled = true
    replayLine.textContent = 'replay: verifying…'
    try {
      const verdict = await verifyReplay(sim)
      if (disposed) return verdict
      replayLine.textContent = formatReplayLine(verdict)
      replayLine.style.color = verdict.match ? '#b6f0c2' : '#f5a3a3'
      // A DIFF is a bug to record, never a state to reconcile.
      if (!verdict.match) console.error('[data-drawing]', describeReplay(verdict))
      return verdict
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      replayLine.textContent = `replay: failed (${message})`
      replayLine.style.color = '#f5a3a3'
      throw err
    } finally {
      if (!disposed) verifyButton.disabled = false
    }
  }

  verifyButton.addEventListener('click', () => {
    void runVerifyReplay().catch(() => {
      /* shown in the panel */
    })
  })

  // ---- transport switch ---------------------------------------------------------

  /**
   * Pauses the current transport so its tick is frozen, takes its log and
   * tick, creates the other transport from that RestorePoint (the switch is
   * a replay), and only then retires the old one. Refused while a stroke
   * is open: the recorder's stamping state would have to move mid-stroke.
   */
  const switchTransport = async (kind: TransportKind): Promise<void> => {
    if (kind === transportKind || disposed) return
    if (switching) throw new Error('a transport switch is already in progress')
    if (openOrdinal !== null) throw new Error('finish the stroke before switching transport')
    switching = true
    transportBox.disabled = true
    verifyButton.disabled = true
    statusLine.textContent = `status  switching to the ${kind === 'main' ? 'main-thread' : 'Worker'} transport (replaying the log)…`
    const old = sim
    try {
      old.pause(true)
      // The hash round trip guarantees the pause was processed, so the tick
      // below is the tick the old sim is frozen at.
      await old.hash()
      const entries = await old.log()
      const tick = old.currentTick()
      const next = createTransport(kind, DEV_SEED, { restore: { entries, tick } })
      const { version, tickHz } = await next.ready
      if (disposed) {
        next.dispose()
        return
      }
      detachSim?.()
      detachSim = null
      old.dispose()
      sim = next
      transportKind = kind
      attachSim(next)
      next.pause(paused)
      meter.reset()
      sentBatches.clear()
      updateLatencyLine()
      replayLine.textContent = 'replay: —'
      replayLine.style.color = ''
      transportLine.textContent = `transport=${kind}`
      statusLine.textContent = `status  sim v${version} at ${tickHz} Hz ${kind === 'main' ? 'on the main thread' : 'in a module Worker'} (continued from tick ${tick}, ${entries.length} actions replayed)`
      refreshHash(next.currentTick())
      showError('')
    } catch (err: unknown) {
      // The old transport stays live: unpause it and report.
      old.pause(paused)
      showError(`transport switch failed: ${err instanceof Error ? err.message : String(err)}`)
      throw err
    } finally {
      switching = false
      if (!disposed) {
        transportBox.checked = transportKind === 'main'
        transportBox.disabled = false
        verifyButton.disabled = false
      }
    }
  }

  transportBox.addEventListener('change', () => {
    void switchTransport(transportBox.checked ? 'main' : 'worker').catch(() => {
      transportBox.checked = transportKind === 'main'
    })
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
    // Every sent batch whose tick the uploaded snapshot has passed is painted by this frame.
    if (meter.onPainted(performance.now()) > 0) updateLatencyLine()
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
      const backend = st.backendInfo()
      backendLine.textContent = `backend=${backend} adapter=…${forceWebGLFromQuery() ? ' (forced webgl)' : ''}`
      void adapterDescription().then((adapter) => {
        if (!disposed) backendLine.textContent = `backend=${backend} adapter=${adapter}${forceWebGLFromQuery() ? ' (forced webgl)' : ''}`
      })

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
            if (switching) {
              showError('switching transport: wait a moment')
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
            meter.beginStroke()
            sentBatches.set(ordinal, [])
            sim.beginStroke({ ordinal, brushVersionId: brushes.current, frameQ16: frameToQ16(frame), pressureSource })
            strokeLine.textContent = `stroke  ${ordinal} open (brush v${brushes.current}, ${pressureSource === 1 ? 'mouse' : 'pen'})`
          },
          onSamples: (samples: RawSample[]) => {
            if (openOrdinal === null) return
            // t0 before the send, on the main thread's clock (left of the fence; never recorded).
            sentBatches.get(openOrdinal)?.push({ key: ++batchSeq, t0: performance.now() })
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
      statusLine.textContent = `status  sim v${version} at ${tickHz} Hz ${transportKind === 'main' ? 'on the main thread' : 'in a module Worker'}`
      for (const preset of PRESETS) {
        await brushes.define(preset)
        if (disposed) return
      }
      brushes.select(1)
      refreshSelect()
      showCurrentBrush()
      select.disabled = false
      saveButton.disabled = false
      verifyButton.disabled = false
      transportBox.disabled = false
      refreshHash(sim.currentTick())
    })
    .catch((err: unknown) => {
      statusLine.textContent = `status  sim failed: ${err instanceof Error ? err.message : String(err)}`
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
    detachSim?.()
    detachSim = null
    unsubscribeResize()
    sim.dispose()
    if (stageRef !== null) stageRef.dispose()
    stageRef = null
    if (root.parentNode === host.container) host.container.removeChild(root)
  }

  return {
    dispose,
    get sim() {
      return sim
    },
    get transport() {
      return transportKind
    },
    brushes,
    stage,
    fence,
    settings,
    meter,
    verifyReplay: runVerifyReplay,
    switchTransport,
    attachMeasure,
  }
}

const surfaceModule: SurfaceModule = { mount }
export default surfaceModule
