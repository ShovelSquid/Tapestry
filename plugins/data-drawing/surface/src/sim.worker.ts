/**
 * sim.worker.ts — the Wasm sim in a module Worker, driven at a fixed 60 Hz.
 *
 * The wall clock lives here and only decides HOW MANY dd_step() calls run;
 * it never crosses the ABI. The loop drains whole ticks from an accumulator
 * (clamped to 250 ms so a stalled tab cannot spiral) and never takes a
 * fractional step. Messages are handled between iterations, so every apply,
 * hash and log happens at a tick boundary.
 *
 * This worker IS the recorder: every action is applied on arrival while
 * dd_tick() equals the tick it records in the log ("apply at the start of
 * the stamped tick", because the worker only ever stamps with its current
 * tick). Stroke samples arrive unstamped from the fence and are stamped
 * here — tick = dd_tick() at arrival, index = the per-stroke counter that
 * restarts at 0 when the tick moved on (stampSamples, pure) — then
 * encoded, applied and, only on DD_OK, appended to the session log with
 * the stamping state committed. StrokeBegin / StrokeEnd stamp start_tick /
 * end_tick with the same current tick (the sim integrates the end tick's
 * pending samples before the stroke leaves the active list). A rejection
 * is posted with the ordinal and records nothing. Snapshots are
 * HEAPU8.slice() copies posted in a transfer list; HEAPU8 is re-read from
 * the module object at every use (memory growth replaces it) and the heap
 * itself is never exposed.
 */
import createDdsim from '../wasm/ddsim.mjs'
import wasmUrl from '../wasm/ddsim.wasm?url'

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
import {
  ActionKind,
  BODY_STRIDE,
  DD_OK,
  HASH_BYTES,
  NODE_STRIDE,
  TICK_HZ,
  encodeDefineBrush,
  encodeStrokeBegin,
  encodeStrokeEnd,
  encodeStrokeSamples,
  errorName,
  stampSamples,
  strokeIdOf,
  type DdsimModule,
  type StampState,
} from './ddsim-abi'
import type { LogEntry, WorkerInbound, WorkerOutbound } from './sim-host'

/** Phase 1 records on branch 0 only. */
const BRANCH = 0

interface WorkerScope {
  postMessage(message: WorkerOutbound, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent<WorkerInbound>) => void) | null
  close(): void
}

const scope = self as unknown as WorkerScope

const TICK_MS = 1000 / TICK_HZ
const MAX_FRAME_MS = 250

let mod: DdsimModule | null = null
let sim = 0
let brushCount = 0
let paused = false
let acc = 0
let last = 0
let lastPosted = -1
let timer: ReturnType<typeof setTimeout> | null = null
const log: LogEntry[] = []
/** Per open stroke (by ordinal): the stamping state committed by the last accepted samples. */
const stamps = new Map<number, StampState>()

/**
 * Applies a stroke action at the current tick: records it on DD_OK, posts
 * the rejection (with the ordinal) otherwise. Returns whether it was applied.
 */
function applyStrokeAction(m: DdsimModule, ordinal: number, actionKind: number, bytes: Uint8Array, tick: number, samples: number): boolean {
  const rc = apply(m, bytes)
  if (rc !== DD_OK) {
    post({ kind: 'rejected', ordinal, code: rc, name: errorName(rc), actionKind })
    return false
  }
  log.push({ tick, bytes })
  post({ kind: 'strokeApplied', ordinal, actionKind, tick, samples })
  return true
}

function post(msg: WorkerOutbound): void {
  scope.postMessage(msg)
}

function currentTick(m: DdsimModule): number {
  return Number(m._dd_tick(sim))
}

function apply(m: DdsimModule, bytes: Uint8Array): number {
  const ptr = m._malloc(bytes.length)
  try {
    m.HEAPU8.set(bytes, ptr)
    return m._dd_apply(sim, ptr, bytes.length)
  } finally {
    m._free(ptr)
  }
}

function postSnapshot(m: DdsimModule, tick: number): void {
  const nodeCount = m._dd_node_count(sim)
  const nodePtr = m._dd_nodes_ptr(sim)
  const nodes = m.HEAPU8.slice(nodePtr, nodePtr + nodeCount * NODE_STRIDE)
  const bodyCount = m._dd_body_count(sim)
  const bodyPtr = m._dd_body_ptr(sim)
  const bodies = m.HEAPU8.slice(bodyPtr, bodyPtr + bodyCount * BODY_STRIDE)
  const snapshot: WorkerOutbound = { kind: 'snapshot', tick, nodeCount, nodes: nodes.buffer, bodyCount, bodies: bodies.buffer }
  scope.postMessage(snapshot, [nodes.buffer, bodies.buffer])
}

function loop(): void {
  const m = mod
  if (m === null) return
  const now = performance.now()
  if (!paused) acc += Math.min(now - last, MAX_FRAME_MS)
  last = now
  while (acc >= TICK_MS) {
    m._dd_step(sim)
    acc -= TICK_MS
  }
  const tick = currentTick(m)
  if (tick !== lastPosted) {
    postSnapshot(m, tick)
    lastPosted = tick
  }
  timer = setTimeout(loop, 1)
}

async function init(seed: bigint): Promise<void> {
  const m = await createDdsim({
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? WASM_URL : prefix + path),
  })
  sim = m._dd_create(seed)
  if (sim === 0) throw new Error('dd_create returned null')
  mod = m
  post({ kind: 'ready', version: m._dd_version(), tickHz: TICK_HZ })
  last = performance.now()
  acc = 0
  loop()
}

function dispose(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  if (mod !== null && sim !== 0) mod._dd_destroy(sim)
  sim = 0
  mod = null
  scope.close()
}

scope.onmessage = (ev: MessageEvent<WorkerInbound>) => {
  const msg = ev.data
  if (msg.kind === 'init') {
    init(msg.seed).catch((err: unknown) => {
      post({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    })
    return
  }
  if (msg.kind === 'dispose') {
    dispose()
    return
  }
  const m = mod
  if (m === null) {
    if ('id' in msg) post({ kind: 'error', id: msg.id, message: 'sim not initialised' })
    return
  }
  switch (msg.kind) {
    case 'pause':
      paused = msg.paused
      return
    case 'defineBrush': {
      let bytes: Uint8Array
      try {
        bytes = encodeDefineBrush(msg.spec, brushCount + 1)
      } catch (err: unknown) {
        post({ kind: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
        return
      }
      const tick = currentTick(m)
      const rc = apply(m, bytes)
      if (rc !== DD_OK) {
        post({ kind: 'rejected', id: msg.id, code: rc, name: errorName(rc), actionKind: ActionKind.DefineBrush })
        return
      }
      brushCount += 1
      log.push({ tick, bytes })
      post({ kind: 'applied', id: msg.id, tick, result: brushCount })
      return
    }
    case 'beginStroke': {
      const tick = currentTick(m)
      let bytes: Uint8Array
      try {
        bytes = encodeStrokeBegin(strokeIdOf(BRANCH, msg.ordinal), msg.brushVersionId, tick, msg.pressureSource, msg.frameQ16)
      } catch (err: unknown) {
        post({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
        return
      }
      if (applyStrokeAction(m, msg.ordinal, ActionKind.StrokeBegin, bytes, tick, 0)) {
        stamps.set(msg.ordinal, { tick, nextIndex: 0 })
      }
      return
    }
    case 'samples': {
      if (msg.samples.length === 0) return
      const tick = currentTick(m)
      // A stroke whose begin was rejected has no state; stamping from zero
      // lets the sim answer DD_ERR_STROKE_STATE so nothing is silently lost.
      const state = stamps.get(msg.ordinal) ?? { tick: -1, nextIndex: 0 }
      const stamped = stampSamples(state, tick, msg.samples)
      let bytes: Uint8Array
      try {
        bytes = encodeStrokeSamples(strokeIdOf(BRANCH, msg.ordinal), stamped.samples)
      } catch (err: unknown) {
        post({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
        return
      }
      if (applyStrokeAction(m, msg.ordinal, ActionKind.StrokeSamples, bytes, tick, stamped.samples.length)) {
        stamps.set(msg.ordinal, stamped.state)
      }
      return
    }
    case 'endStroke': {
      const tick = currentTick(m)
      const bytes = encodeStrokeEnd(strokeIdOf(BRANCH, msg.ordinal), tick)
      if (applyStrokeAction(m, msg.ordinal, ActionKind.StrokeEnd, bytes, tick, 0)) {
        stamps.delete(msg.ordinal)
      }
      return
    }
    case 'hash': {
      const ptr = m._malloc(HASH_BYTES)
      try {
        m._dd_hash(sim, ptr)
        const bytes = m.HEAPU8.slice(ptr, ptr + HASH_BYTES)
        scope.postMessage({ kind: 'hash', id: msg.id, bytes }, [bytes.buffer])
      } finally {
        m._free(ptr)
      }
      return
    }
    case 'log':
      post({ kind: 'log', id: msg.id, entries: log.map((e) => ({ tick: e.tick, bytes: e.bytes.slice() })) })
      return
  }
}
