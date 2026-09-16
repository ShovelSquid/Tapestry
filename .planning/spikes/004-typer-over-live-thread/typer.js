// Spike 004 — the real ProseMirror typer over a live WebGL thread.
//
// The editor is a DOM panel at the top (Phase 2.3 D-09) and every inserted
// grapheme is placed on the thread at the moment it was typed. What's measured is
// the whole path a keystroke takes:
//
//   browser input event → JS handler → ProseMirror transaction → glyph added → painted frame
//
// Scripted runs drive real Chromium key events through the main process
// (sendInputEvent), so the numbers include the browser's own input pipeline rather
// than simulated timings. IME composition can't be automated and is checked by hand.
//
// Glyphs use the browser-SDF path from 003a (0.5 ms per new glyph): this spike is
// about input latency, and MSDF generation cost (003b) would confound it.
import * as THREE from 'three'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from 'prosemirror-schema-basic'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { createAtlasGlyphLayer } from '../003-shared/glyph-layer.js'
import { createSdfRasterizer } from '../003-shared/sdf-rasterizer.js'
import { SPEED, FONT_SIZE, LIFT, FONT_URL, generateKeys, graphemes } from '../003-shared/scene.js'

const { ipcRenderer } = window.require('electron')
const params = new URLSearchParams(location.search)
const BENCH = params.get('bench') === '1'
const SHOTS = params.get('shots') === '1'
const SCRIPTED = BENCH || SHOTS

const TYPE_TEXT = 'writing into the thread while it runs, one letter at a time, to see whether the typer keeps up with the line behind it. '
const PASTE_TEXT = TYPE_TEXT.repeat(17).slice(0, 2000)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const log = []
const event = (category, data = {}) => log.push({ at: new Date().toISOString(), category, ...data })

function percentile(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0
}

function summarizeNumbers(values) {
  const v = values.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b)
  return { n: v.length, median: percentile(v, 0.5), p95: percentile(v, 0.95), max: v.length ? v[v.length - 1] : 0 }
}

function summarizeFrames(intervals) {
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
// Thread (live view only)
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

const { rasterize, counters } = await createSdfRasterizer({ fontUrl: FONT_URL })
const layer = await createAtlasGlyphLayer({ scene, renderer, fontSize: FONT_SIZE, speed: SPEED, lift: LIFT, rasterize, extraStats: () => ({ ...counters }) })

const clock = { base: 0, startedAt: performance.now() }
const now = () => clock.base + (performance.now() - clock.startedAt) / 1000
const state = { load: 'none', origin: 0, buildMs: 0 }

async function load(name) {
  const built = name === 'empty' ? { times: [], chars: [], end: 0 } : generateKeys(8, true)
  const started = performance.now()
  await layer.build(built, built.end)
  state.buildMs = performance.now() - started
  state.load = name
  state.origin = built.end
  clock.base = built.end
  clock.startedAt = performance.now()
  event('load', { name, buildMs: state.buildMs, ...layer.stats() })
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const editorEl = document.getElementById('editor')
const samples = []
const totals = { inserted: 0, deleted: 0, transactions: 0, unpairedInputs: 0 }
const pendingInputs = []

// beforeinput fires before ProseMirror sees the key; its timeStamp shares the
// performance.now() time origin, so it anchors the end-to-end measurement.
editorEl.addEventListener(
  'beforeinput',
  (e) => pendingInputs.push({ stamp: e.timeStamp, received: performance.now(), inputType: e.inputType }),
  true
)

const view = new EditorView(editorEl, {
  state: EditorState.create({
    schema,
    plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo }), keymap(baseKeymap)],
  }),
  dispatchTransaction(tr) {
    const applyStarted = performance.now()
    view.updateState(view.state.apply(tr))
    if (!tr.docChanged) return
    totals.transactions++

    let inserted = ''
    let deleted = 0
    for (const step of tr.steps) {
      if (step.slice) step.slice.content.descendants((node) => void (node.isText && (inserted += node.text)))
      if (typeof step.from === 'number' && typeof step.to === 'number' && step.to > step.from) deleted += step.to - step.from
    }
    const t = now()
    const letters = graphemes(inserted)
    for (const g of letters) layer.add(t, g)
    totals.inserted += letters.length
    totals.deleted += deleted

    // Pair with the NEWEST pending input. Not every beforeinput produces a document
    // change (selection moves, composition updates), so a FIFO queue drifts and starts
    // reporting stale timestamps — that drift is what made the first run's p95 685 ms
    // against a 12 ms median. Older unpaired events are counted and dropped.
    const input = pendingInputs.pop() ?? null
    totals.unpairedInputs += pendingInputs.length
    pendingInputs.length = 0
    samples.push({
      letters: letters.length,
      inputType: input?.inputType ?? null,
      stamp: input?.stamp ?? null,
      // browser event → our JS handler
      inputDelay: input ? input.received - input.stamp : null,
      // ProseMirror apply + placing the letters on the thread
      applyMs: performance.now() - applyStarted,
      paintMs: null,
    })
  },
})

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

const hud = document.getElementById('hud')
const hudIntervals = []
const bench = { collect: false, intervals: [] }
let lastFrame = 0

function frame(timestamp) {
  if (lastFrame) {
    const interval = timestamp - lastFrame
    hudIntervals.push(interval)
    if (hudIntervals.length > 240) hudIntervals.splice(0, 120)
    if (bench.collect) bench.intervals.push(interval)
  }
  lastFrame = timestamp

  // Everything added since the previous frame is visible in this one.
  for (let i = samples.length - 1; i >= 0 && samples[i].paintMs === null; i--) {
    samples[i].paintMs = samples[i].stamp === null ? null : timestamp - samples[i].stamp
    if (samples[i].paintMs === null) break
  }

  const headZ = -(now() - state.origin) * SPEED
  camera.position.set(0.35, 0.28, headZ - 1.2)
  camera.lookAt(0, 0, headZ + 6)
  renderer.render(scene, camera)

  if (hudIntervals.length % 15 === 0) {
    const f = summarizeFrames(hudIntervals)
    const paint = summarizeNumbers(samples.map((s) => s.paintMs))
    const st = layer.stats()
    hud.textContent =
      `Spike 004 — ProseMirror typer over a live thread\n` +
      `load ${state.load}   build ${(state.buildMs / 1000).toFixed(2)} s   glyphs ${st.glyphs.toLocaleString()}   atlas ${st.atlasCells}/1024\n` +
      `fps ${f.fps.toFixed(1)}   p95 ${f.frameP95.toFixed(1)} ms   key→painted median ${paint.median.toFixed(1)} ms   p95 ${paint.p95.toFixed(1)} ms   letters ${totals.inserted}\n\n` +
      `type here (IME and emoji picker work) · Ctrl+L empty / 8 h thread`
  }
  requestAnimationFrame(frame)
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
})

addEventListener('keydown', (e) => {
  if (SCRIPTED || !e.ctrlKey || e.key !== 'l') return
  e.preventDefault()
  load(state.load === '8h' ? 'empty' : '8h')
})

// ---------------------------------------------------------------------------
// Scripted runs
// ---------------------------------------------------------------------------

const sendKeys = (events) => ipcRenderer.invoke('send-input', events)
const typeChar = (ch) => sendKeys([{ type: 'keyDown', keyCode: ch }, { type: 'char', keyCode: ch }, { type: 'keyUp', keyCode: ch }])

async function typeFor(charsPerSecond, seconds) {
  const gap = 1000 / charsPerSecond
  const until = performance.now() + seconds * 1000
  let i = 0
  while (performance.now() < until) {
    await typeChar(TYPE_TEXT[i++ % TYPE_TEXT.length])
    await wait(gap)
  }
  return i
}

function measured(from) {
  const slice = samples.slice(from)
  return {
    keystrokes: slice.length,
    letters: slice.reduce((n, s) => n + s.letters, 0),
    inputDelay: summarizeNumbers(slice.map((s) => s.inputDelay)),
    applyMs: summarizeNumbers(slice.map((s) => s.applyMs)),
    paintMs: summarizeNumbers(slice.map((s) => s.paintMs)),
  }
}

async function runBench() {
  const results = []
  for (const loadName of ['empty', '8h']) {
    await loadAndFocus(loadName)
    for (const [name, cps, seconds] of [
      ['typing-20cps', 20, 6],
      ['burst-40cps', 40, 4],
    ]) {
      await wait(500)
      const from = samples.length
      bench.intervals = []
      bench.collect = true
      await typeFor(cps, seconds)
      await wait(300)
      bench.collect = false
      const memory = await process.getProcessMemoryInfo()
      results.push({ load: loadName, phase: name, unpairedInputs: totals.unpairedInputs, ...layer.stats(), ...measured(from), ...summarizeFrames(bench.intervals), privateMB: memory.private / 1024 })
      event('bench-step', results.at(-1))
    }

    // Paste: 2000 characters arrive in one transaction, as one cluster on the line.
    await ipcRenderer.invoke('set-clipboard', { text: PASTE_TEXT })
    await wait(300)
    const from = samples.length
    bench.intervals = []
    bench.collect = true
    // Cmd+V through sendInputEvent arrives as a plain key event; the webContents
    // editing command performs a real paste, which ProseMirror handles as a paste.
    await ipcRenderer.invoke('edit-command', { command: 'paste' })
    await wait(1500)
    bench.collect = false
    const memory = await process.getProcessMemoryInfo()
    results.push({ load: loadName, phase: 'paste-2000', unpairedInputs: totals.unpairedInputs, ...layer.stats(), ...measured(from), ...summarizeFrames(bench.intervals), privateMB: memory.private / 1024 })
    event('bench-step', results.at(-1))
  }

  const file = await ipcRenderer.invoke('write-result', { name: 'bench', data: { results, log, samples: samples.slice(0, 4000) } })
  const pad = (v, n) => String(v).padEnd(n)
  const lines = [
    `Results written to ${file}`,
    '',
    pad('load', 7) + pad('phase', 14) + pad('keys', 6) + pad('letters', 9) + pad('key→paint med/p95/max ms', 26) + pad('apply med/max', 15) + pad('fps', 6) + pad('frameMax', 10) + pad('drop%', 7) + 'privMB',
  ]
  for (const r of results) {
    lines.push(
      pad(r.load, 7) + pad(r.phase, 14) + pad(r.keystrokes, 6) + pad(r.letters, 9) +
        pad(`${r.paintMs.median.toFixed(1)}/${r.paintMs.p95.toFixed(1)}/${r.paintMs.max.toFixed(1)}`, 26) +
        pad(`${r.applyMs.median.toFixed(2)}/${r.applyMs.max.toFixed(1)}`, 15) +
        pad(r.fps.toFixed(1), 6) + pad(r.frameMax.toFixed(1), 10) + pad((r.dropRate * 100).toFixed(1), 7) + r.privateMB.toFixed(0)
    )
  }
  ipcRenderer.send('done', { lines })
}

async function loadAndFocus(name) {
  await load(name)
  view.focus()
  await sendKeys([{ type: 'mouseDown', x: innerWidth / 2, y: 210, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: innerWidth / 2, y: 210, button: 'left', clickCount: 1 }])
  await wait(200)
}

async function runShots() {
  await loadAndFocus('8h')
  await typeFor(18, 4)
  await wait(600)
  const files = await ipcRenderer.invoke('capture', { name: 'typer-over-thread', rect: { x: 0, y: 0, width: 1400, height: 520 } })
  await ipcRenderer.invoke('write-result', { name: 'shots', data: { log, stats: layer.stats(), paint: summarizeNumbers(samples.map((s) => s.paintMs)) } })
  ipcRenderer.send('done', { lines: ['Screenshots:', ...files] })
}

requestAnimationFrame(frame)
if (BENCH) runBench()
else if (SHOTS) runShots()
else {
  await load('8h')
  view.focus()
}
