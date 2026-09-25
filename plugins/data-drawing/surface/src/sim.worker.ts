/**
 * sim.worker.ts — the mathspace Wasm engine in a module Worker, driven at a
 * fixed 60 Hz.
 *
 * A thin message shell around SimDriver (sim-driver.ts), which owns the
 * accumulator, the stamping recorder, the hash ring and replay-from-zero;
 * the main-thread transport wraps the very same driver. The wall clock is
 * read here and only decides HOW MANY steps run; it never crosses the
 * ABI. Messages are handled between loop iterations, so every
 * apply, hash, log and replay happens at a tick boundary. Snapshots are
 * the driver's HEAPU8.slice() copies posted in a transfer list; the heap
 * itself is never exposed.
 */
import createMathspace from '../wasm/mathspace.mjs'
import wasmUrl from '../wasm/mathspace.wasm?url'

/**
 * The .wasm URL made absolute against this module's own URL. This worker is
 * spawned through a same-origin blob: trampoline (worker-spawn.ts), so the
 * worker global's base URL is blob:… and a root-relative asset path (what
 * Vite's `?url` yields in dev) cannot be resolved against it; the glue would
 * fail with "Invalid URL". import.meta.url here is the module's real URL
 * (http://localhost:5173/src/… in dev, tapestry-plugin://…/assets/… built),
 * and the built URL is already absolute, so this is a no-op there.
 */
const WASM_URL = new URL(wasmUrl, import.meta.url).href
import { TICK_HZ } from './ddsim-abi'
import { SimDriver, type Outcome, type RestorePoint } from './sim-driver'
import type { WorkerInbound, WorkerOutbound } from './sim-host'

interface WorkerScope {
  postMessage(message: WorkerOutbound, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent<WorkerInbound>) => void) | null
  close(): void
}

const scope = self as unknown as WorkerScope

let driver: SimDriver | null = null
let lastPosted = -1
let timer: ReturnType<typeof setTimeout> | null = null

function post(msg: WorkerOutbound): void {
  scope.postMessage(msg)
}

function postSnapshot(d: SimDriver): void {
  const s = d.snapshot()
  scope.postMessage({ kind: 'snapshot', ...s }, [s.nodes, s.bodies])
  lastPosted = s.tick
}

/** Posts the outcome of a stroke action (strokeApplied or rejected with the ordinal) or of a request (applied / rejected with the id). */
function report(o: Outcome, ordinal: number | undefined, id: number | undefined): void {
  if (o.ok) {
    if (id !== undefined) post({ kind: 'applied', id, tick: o.tick, result: o.result })
    else if (ordinal !== undefined) post({ kind: 'strokeApplied', ordinal, actionKind: o.actionKind, tick: o.tick, samples: o.samples })
    return
  }
  const msg: WorkerOutbound = { kind: 'rejected', code: o.code, name: o.name, actionKind: o.actionKind }
  if (id !== undefined) msg.id = id
  else if (ordinal !== undefined) msg.ordinal = ordinal
  post(msg)
}

function loop(): void {
  const d = driver
  if (d === null) return
  d.advance(performance.now())
  if (d.tick() !== lastPosted) postSnapshot(d)
  timer = setTimeout(loop, 1)
}

async function init(seed: bigint, restore: RestorePoint | undefined): Promise<void> {
  const m = await createMathspace({
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? WASM_URL : prefix + path),
  })
  const d = new SimDriver(m, seed)
  if (restore !== undefined) d.restore(restore)
  driver = d
  post({ kind: 'ready', version: d.version(), tickHz: TICK_HZ })
  d.resetClock(performance.now())
  loop()
}

function dispose(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  driver?.destroy()
  driver = null
  scope.close()
}

scope.onmessage = (ev: MessageEvent<WorkerInbound>) => {
  const msg = ev.data
  if (msg.kind === 'init') {
    init(msg.seed, msg.restore).catch((err: unknown) => {
      post({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    })
    return
  }
  if (msg.kind === 'dispose') {
    dispose()
    return
  }
  const d = driver
  if (d === null) {
    if ('id' in msg) post({ kind: 'error', id: msg.id, message: 'sim not initialised' })
    return
  }
  try {
    switch (msg.kind) {
      case 'pause':
        d.pause(msg.paused)
        return
      case 'defineBrush':
        report(d.defineBrush(msg.spec), undefined, msg.id)
        return
      case 'beginStroke':
        report(d.beginStroke(msg.ordinal, msg.brushVersionId, msg.frameQ16, msg.pressureSource), msg.ordinal, undefined)
        return
      case 'samples':
        if (msg.samples.length === 0) return
        report(d.pushSamples(msg.ordinal, msg.samples), msg.ordinal, undefined)
        return
      case 'endStroke':
        report(d.endStroke(msg.ordinal), msg.ordinal, undefined)
        return
      case 'hash': {
        const bytes = d.hash()
        scope.postMessage({ kind: 'hash', id: msg.id, bytes }, [bytes.buffer])
        return
      }
      case 'log':
        post({ kind: 'log', id: msg.id, entries: d.log() })
        return
      case 'replay':
        post({ kind: 'replay', id: msg.id, report: d.replayFromZero() })
        return
    }
  } catch (err: unknown) {
    // An unencodable spec or frame (thrown before any byte reached the sim).
    const message = err instanceof Error ? err.message : String(err)
    if ('id' in msg) post({ kind: 'error', id: msg.id, message })
    else post({ kind: 'error', message })
  }
}
