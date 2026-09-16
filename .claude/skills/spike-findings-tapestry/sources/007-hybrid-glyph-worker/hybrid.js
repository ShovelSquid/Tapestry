// Spike 007 — the hybrid glyph pipeline, measured.
//
// A letter appears at once as a browser-SDF cell (~0.5 ms, spike 003a). The same
// grapheme is queued to a worker that generates its MSDF cell (~8 ms, up to
// 22.6 ms, spike 003b); when that returns, the cell is repainted in place and
// every instance already drawing that grapheme is rewritten.
//
// Three questions:
//   1. Does the swap show? (screenshots at 240 px, before and after)
//   2. Does a 2000-character paste on a cold atlas drop a frame? (spike 004
//      found one dropped frame doing this with the cheap rasterizer alone)
//   3. What happens past the atlas's 1024 cells?
import * as THREE from 'three'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from 'prosemirror-schema-basic'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { createSdfRasterizer } from '../003-shared/sdf-rasterizer.js'
import { createHybridGlyphLayer } from './hybrid-glyph-layer.js'

const { ipcRenderer } = window.require('electron')
const params = new URLSearchParams(location.search)
const BENCH = params.get('bench') === '1'
const SHOTS = params.get('shots') === '1'
const SCRIPTED = BENCH || SHOTS

const SPEED = 1.5
const FONT_SIZE = 0.12
const LIFT = 0.03
const FONT_URL = new URL('/font/verdana.ttf', location.href).href

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (m) => console.error('[step]', m)
addEventListener('error', (e) => console.error('[page error]', e.message, e.filename, e.lineno))
addEventListener('unhandledrejection', (e) =>
  console.error('[unhandled rejection]', String((e.reason && e.reason.stack) || e.reason))
)

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const graphemes = (s) => Array.from(segmenter.segment(s), (x) => x.segment)

const TYPE_TEXT =
  'writing into the thread while its letters sharpen behind us, one at a time, to see whether the upgrade ever shows. '
const PASTE_TEXT = TYPE_TEXT.repeat(20).slice(0, 2000)

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0)
function frameSummary(intervals) {
  const i = [...intervals].sort((a, b) => a - b)
  const median = percentile(i, 0.5)
  return {
    frames: i.length,
    fps: median ? 1000 / median : 0,
    frameP95: percentile(i, 0.95),
    frameMax: i.length ? i[i.length - 1] : 0,
    dropRate: i.length ? i.filter((x) => x > 25).length / i.length : 0,
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(innerWidth, innerHeight)
renderer.setClearColor(0x0d0f14)
document.body.prepend(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 20000)
scene.add(
  new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -100000), new THREE.Vector3(0, 0, 100000)]),
    new THREE.LineBasicMaterial({ color: 0x5a6275 })
  )
)

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const worker = new Worker('/007-hybrid-glyph-worker/msdf-worker.js')
const workerStats = { ready: false, queued: 0, done: 0, failed: 0, waitMsTotal: 0, waitMsMax: 0, counters: {} }
const pending = new Map()
let nextRequestId = 1
let layer = null

const workerReady = new Promise((resolve, reject) => {
  worker.onmessage = (e) => {
    const msg = e.data
    if (msg.type === 'ready') {
      workerStats.ready = true
      workerStats.counters = msg.counters
      return resolve()
    }
    if (msg.type === 'error') return reject(new Error(msg.message))
    if (msg.type === 'cell') {
      const sent = pending.get(msg.id)
      pending.delete(msg.id)
      workerStats.done++
      workerStats.counters = msg.counters
      if (sent !== undefined) {
        const waited = performance.now() - sent
        workerStats.waitMsTotal += waited
        workerStats.waitMsMax = Math.max(workerStats.waitMsMax, waited)
      }
      if (msg.error || !msg.cell) {
        workerStats.failed++
        return
      }
      // pixels arrived as a transferred ArrayBuffer
      msg.cell.pixels = new Uint8Array(msg.cell.pixels)
      layer?.upgrade(msg.grapheme, msg.cell)
    }
  }
  worker.onerror = (e) => reject(new Error(`worker: ${e.message}`))
})

worker.postMessage({ type: 'init', spikesDir: process.env.TAPESTRY_SPIKES_DIR })
await workerReady
step('worker ready')

// The worker turns a glyph around in about 11 ms, which is faster than a
// before/after screenshot can race. To photograph the placeholder at all, the
// scripted shot run holds requests back and releases them deliberately.
let holdUpgrades = false
const held = []

function requestUpgrade(grapheme) {
  if (holdUpgrades) {
    held.push(grapheme)
    return
  }
  const id = nextRequestId++
  pending.set(id, performance.now())
  workerStats.queued++
  worker.postMessage({ type: 'rasterize', id, grapheme })
}

function releaseUpgrades() {
  holdUpgrades = false
  const queued = held.splice(0, held.length)
  for (const g of queued) requestUpgrade(g)
  return queued.length
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

const { rasterize, counters } = await createSdfRasterizer({ fontUrl: FONT_URL })
const MAX_CELLS = Number(params.get('cells') ?? 1024)
layer = await createHybridGlyphLayer({
  scene, renderer, fontSize: FONT_SIZE, speed: SPEED, lift: LIFT,
  rasterize, requestUpgrade, maxCells: MAX_CELLS,
  extraStats: () => ({
    queued: workerStats.queued,
    done: workerStats.done,
    failed: workerStats.failed,
    inFlight: pending.size,
    workerWaitAvg: workerStats.done ? workerStats.waitMsTotal / workerStats.done : 0,
    workerWaitMax: workerStats.waitMsMax,
    txMaxMs: txStats.maxMs,
    txMaxLetters: txStats.maxLetters,
    ...workerStats.counters,
    clipped: counters.clipped,
  }),
})

const clock = { base: 0, startedAt: performance.now() }
const now = () => clock.base + (performance.now() - clock.startedAt) / 1000
const state = { view: 'live', sidePx: 16, anchor: 0 }

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const editorEl = document.getElementById('editor')

// A paste arrives as ONE synchronous transaction, so every letter it carries is
// placed before the browser can paint. Spike 004 measured 2000 known characters
// at ~3 ms; 2000 NEVER-SEEN graphemes each need a placeholder rasterized first,
// which is a different proposition. Timed separately so a stall can be
// attributed to this rather than blamed on eviction by elimination.
const txStats = { count: 0, letters: 0, totalMs: 0, maxMs: 0, maxLetters: 0 }

const view = new EditorView(editorEl, {
  state: EditorState.create({
    schema,
    plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo }), keymap(baseKeymap)],
  }),
  dispatchTransaction(tr) {
    view.updateState(view.state.apply(tr))
    if (!tr.docChanged) return
    let inserted = ''
    for (const s of tr.steps) {
      if (s.slice) s.slice.content.descendants((n) => void (n.isText && (inserted += n.text)))
    }
    if (!inserted) return
    const started = performance.now()
    const t = now()
    const letters = graphemes(inserted)
    for (const g of letters) layer.add(t, g)
    const ms = performance.now() - started
    txStats.count++
    txStats.letters += letters.length
    txStats.totalMs += ms
    if (ms > txStats.maxMs) {
      txStats.maxMs = ms
      txStats.maxLetters = letters.length
    }
  },
})

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

const hud = document.getElementById('hud')
const sampler = { recent: [], intervals: [], collect: false, last: 0 }

function setView(name, px = 16) {
  state.view = name
  state.sidePx = px
  layer.setOrientation(name === 'side' ? Math.PI / 2 : Math.PI)
}

function updateCamera() {
  const headZ = -(now() - state.anchor) * SPEED
  if (state.view === 'live') {
    camera.position.set(0.35, 0.28, headZ - 1.2)
    camera.lookAt(0, 0, headZ + 6)
  } else {
    // Look at the line from the side, sized so one em is state.sidePx device px.
    const emWorld = FONT_SIZE
    const pxPerWorld = (state.sidePx / emWorld)
    const halfHeight = (innerHeight * window.devicePixelRatio) / (2 * pxPerWorld) / window.devicePixelRatio
    const dist = halfHeight / Math.tan((camera.fov * Math.PI) / 360)
    camera.position.set(dist, 0.06, state.focusZ ?? headZ + 2)
    camera.lookAt(0, 0.06, state.focusZ ?? headZ + 2)
  }
}

function frame(timestamp) {
  if (sampler.last) {
    const interval = timestamp - sampler.last
    sampler.recent.push(interval)
    if (sampler.recent.length > 240) sampler.recent.splice(0, 120)
    if (sampler.collect) sampler.intervals.push(interval)
  }
  sampler.last = timestamp

  updateCamera()
  renderer.render(scene, camera)

  if (sampler.recent.length % 15 === 0) {
    const f = frameSummary(sampler.recent)
    const s = layer.stats()
    hud.textContent =
      `Spike 007 — a cheap glyph now, a sharp glyph a moment later\n` +
      `fps ${f.fps.toFixed(1)}   p95 ${f.frameP95.toFixed(1)} ms   letters ${s.glyphs.toLocaleString()}\n` +
      `cells ${s.atlasCells}/${MAX_CELLS}   msdf ${s.msdfCells}   evictions ${s.evictions}   overflow ${s.atlasOverflow}\n` +
      `worker queued ${s.queued} done ${s.done} in flight ${s.inFlight}   wait avg ${s.workerWaitAvg.toFixed(1)} ms max ${s.workerWaitMax.toFixed(1)} ms\n` +
      `upgrades ${s.upgrades}   rewritten instances ${s.rewrittenInstances.toLocaleString()}   worst rewrite ${s.rewriteMsMax.toFixed(2)} ms\n\n` +
      `type here · Ctrl+1 live · Ctrl+2 side 16 px · Ctrl+3 side 240 px`
  }
  requestAnimationFrame(frame)
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
})

addEventListener('keydown', (e) => {
  if (SCRIPTED || !e.ctrlKey) return
  if (e.key === '1') { e.preventDefault(); setView('live') }
  if (e.key === '2') { e.preventDefault(); setView('side', 16) }
  if (e.key === '3') { e.preventDefault(); setView('side', 240) }
})

requestAnimationFrame(frame)

// ---------------------------------------------------------------------------
// Scripted runs
// ---------------------------------------------------------------------------

const sendKeys = (events) => ipcRenderer.invoke('send-input', events)
const typeChar = (ch) =>
  sendKeys([{ type: 'keyDown', keyCode: ch }, { type: 'char', keyCode: ch }, { type: 'keyUp', keyCode: ch }])

async function typeFor(cps, seconds) {
  const gap = 1000 / cps
  const until = performance.now() + seconds * 1000
  let i = 0
  while (performance.now() < until) {
    await typeChar(TYPE_TEXT[i++ % TYPE_TEXT.length])
    await wait(gap)
  }
  return i
}

async function measure(during) {
  sampler.intervals = []
  sampler.collect = true
  await during()
  sampler.collect = false
  return frameSummary(sampler.intervals)
}

async function focusEditor() {
  view.focus()
  await sendKeys([
    { type: 'mouseDown', x: innerWidth / 2, y: 210, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x: innerWidth / 2, y: 210, button: 'left', clickCount: 1 },
  ])
  await wait(200)
}

/** Distinct CJK graphemes, none of which the atlas has seen. */
const freshCjk = (n, from = 0) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + (from + i) * 3))

async function runBench() {
  const results = []
  const row = async (phase, fn) => {
    const f = await measure(fn)
    const s = layer.stats()
    const privateMB = await ipcRenderer.invoke('memory')
    results.push({ phase, ...f, privateMB, ...s })
  }

  await focusEditor()

  step('typing on a cold atlas')
  await row('typing-20cps-cold', () => typeFor(20, 6))

  step('waiting for the upgrade queue to drain')
  const drainStarted = performance.now()
  while (pending.size && performance.now() - drainStarted < 20000) await wait(50)
  results.push({ phase: 'drain-queue', drainMs: performance.now() - drainStarted, ...layer.stats() })

  step('paste 2000 on a cold atlas')
  await ipcRenderer.invoke('set-clipboard', { text: PASTE_TEXT })
  await wait(300)
  await row('paste-2000-warm-glyphs', async () => {
    await ipcRenderer.invoke('edit-command', { command: 'paste' })
    await wait(2000)
  })

  step('paste 2000 of never-seen glyphs')
  await ipcRenderer.invoke('set-clipboard', { text: freshCjk(2000).join('') })
  await wait(300)
  await row('paste-2000-cold-glyphs', async () => {
    await ipcRenderer.invoke('edit-command', { command: 'paste' })
    await wait(4000)
  })

  step('typing past the atlas limit')
  await ipcRenderer.invoke('set-clipboard', { text: freshCjk(1500, 3000).join('') })
  await wait(300)
  await row('paging-past-1024-cells', async () => {
    await ipcRenderer.invoke('edit-command', { command: 'paste' })
    await wait(4000)
  })

  const file = await ipcRenderer.invoke('write-result', { name: 'bench', data: { results, maxCells: MAX_CELLS } })
  const pad = (v, n) => String(v).padEnd(n)
  const lines = [
    `Results written to ${file}`,
    '',
    pad('phase', 26) + pad('fps', 7) + pad('p95', 8) + pad('max', 9) + pad('drop%', 8) +
      pad('cells', 7) + pad('msdf', 7) + pad('evict', 7) + pad('evictScan', 11) +
      pad('evictRewr', 11) + pad('evictMax', 10) + pad('txMax', 16) + pad('wkWaitMax', 11) + 'privMB',
  ]
  for (const r of results) {
    if (r.phase === 'drain-queue') {
      lines.push(pad('drain-queue', 26) + `${r.drainMs.toFixed(0)} ms to finish ${r.upgrades} upgrades`)
      continue
    }
    lines.push(
      pad(r.phase, 26) + pad(r.fps.toFixed(1), 7) + pad(r.frameP95.toFixed(1), 8) + pad(r.frameMax.toFixed(1), 9) +
      pad((r.dropRate * 100).toFixed(1), 8) + pad(r.atlasCells, 7) + pad(r.msdfCells, 7) + pad(r.evictions, 7) +
      pad(r.evictScanMs.toFixed(0) + ' ms', 11) + pad(r.evictRewriteMs.toFixed(0) + ' ms', 11) +
      pad(r.evictMaxMs.toFixed(1) + ' ms', 10) +
      pad(`${r.txMaxMs.toFixed(0)} ms/${r.txMaxLetters}`, 16) +
      pad(r.workerWaitMax.toFixed(0) + ' ms', 11) + r.privateMB.toFixed(0)
    )
  }
  ipcRenderer.send('done', { lines })
}

async function runShots() {
  await focusEditor()
  holdUpgrades = true

  // Letters sit where they were typed, so the gap between keystrokes IS the gap
  // along the line: at SPEED 1.5, one second of delay is 1.5 world units. Both
  // extremes hide the evidence. Typing as fast as sendInputEvent allows puts
  // four letters ~0.015 units apart and they pile into one illegible blob; a
  // 700 ms gap puts them 1.05 units apart, wider than the ~0.7 units visible at
  // 240 px per em, so the camera lands between letters and sees nothing. This
  // spike photographed both before getting it right.
  // One glyph is about 0.12 world units wide, so ~0.18 units apart reads as
  // separate letters and still fits several in frame.
  const word = 'Wavy'
  const GAP_MS = 120 // ≈0.18 world units between letters
  const typedAt = []
  for (const ch of word) {
    await typeChar(ch)
    typedAt.push(now())
    await wait(GAP_MS)
  }

  // Centre on the middle of the word, measured from the keystrokes themselves
  // rather than assumed from the delays.
  const midpoint = (typedAt[0] + typedAt[typedAt.length - 1]) / 2
  state.focusZ = -(midpoint - state.anchor) * SPEED
  setView('side', 240)
  await wait(120)

  // capturePage's rect is in CSS pixels, not device pixels — the window is
  // 1400×900 CSS whatever the display's scale. A rect starting past 900 clamps
  // to a sliver at the bottom edge, which is what an earlier run of this spike
  // photographed: a 500 px request that came back 50 px tall and empty. The
  // line runs across the middle of the window, near y = 550.
  const CROP = { x: 0, y: 330, width: 1400, height: 440 }
  const before = await ipcRenderer.invoke('capture', { name: 'placeholder-sdf-240px', rect: CROP })
  const placeholderStats = layer.stats()

  const released = releaseUpgrades()
  const drainStarted = performance.now()
  while (pending.size && performance.now() - drainStarted < 20000) await wait(50)
  // A moment past the last upgrade, so the repainted cells have been uploaded.
  await wait(400)

  const after = await ipcRenderer.invoke('capture', { name: 'upgraded-msdf-240px', rect: CROP })
  await ipcRenderer.invoke('write-result', {
    name: 'shots',
    data: { released, drainMs: performance.now() - drainStarted, placeholder: placeholderStats, upgraded: layer.stats() },
  })
  ipcRenderer.send('done', {
    lines: [
      `Held ${released} upgrades for the placeholder shot; drained in ${(performance.now() - drainStarted).toFixed(0)} ms.`,
      'Screenshots:', ...before, ...after,
    ],
  })
}

const fail = (err) => {
  console.error('[scripted failed]', String((err && err.stack) || err))
  ipcRenderer.send('done', { lines: ['FAILED: ' + String((err && err.message) || err)] })
}
if (BENCH) runBench().catch(fail)
else if (SHOTS) runShots().catch(fail)
else focusEditor()
