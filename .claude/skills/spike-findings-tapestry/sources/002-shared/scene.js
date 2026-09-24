// Shared scene for spikes 002a (troika SDF text) and 002b (canvas atlas).
//
// Both variants draw the same letters at the same keystroke times, in the same
// font (Verdana) at the same world size, seen through the same cameras. Only
// the glyph layer passed to startSpike() differs.
//
// A glyph layer is:
//   build(keys, tOrigin)   keys = [time, charCode, time, charCode, ...]; resolves when drawable
//   add(time, charCode)    one live keystroke
//   setOrientation(theta)  rotate every glyph plane about y (π: facing the live camera, π/2: facing the side camera)
//   stats()                { glyphs, ...anything worth reporting }
import * as THREE from 'three'

const { ipcRenderer } = window.require('electron')

export const SPEED = 1.5 // world units per second of thread time
export const FONT_SIZE = 0.12 // world units per em
export const LIFT = 0.03 // baseline height above the thread line
// Absolute: troika resolves the font inside a blob: web worker, where a relative URL has no base.
export const FONT_URL = new URL('/font/verdana.ttf', location.href).href
export const PRINTABLE = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')

const params = new URLSearchParams(location.search)
const BENCH = params.get('bench') === '1'
const SHOTS = params.get('shots') === '1'
const SCRIPTED = BENCH || SHOTS
// typing=0 turns off simulated live typing, to separate steady-state cost from the cost of adding letters.
const TYPING = params.get('typing') !== '0'

const SIDE_PX = [8, 12, 16, 24, 48, 120]
const VIEW_NAMES = ['live', 'live-oblique', ...SIDE_PX.map((px) => `side-${px}px`)]
const LIVE_VIEWS = {
  live: { eye: [0.35, 0.28, -1.2], target: [0, 0, 6] },
  'live-oblique': { eye: [1.6, 0.6, -0.6], target: [0, 0.05, 3] },
}

const SAMPLE_TEXT =
  'ok i need to start writing my notes here, and just make it easier to use. this is a knowledge base as much as obsidian is. threads run through time, one letter at a time. '

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Same history as spike 001: sessions of 2–15 min, 1–20 min away, typing bursts
// of 5–40 s at 3–8 keys/s. Only the keystrokes matter here.
function generateKeys(hours, continuous = false) {
  const random = mulberry32(7)
  const end = hours * 3600
  const keys = []
  let t = 0
  let ci = 0
  while (t < end) {
    const sessionEnd = continuous ? end : Math.min(end, t + 120 + random() * 780)
    let k = t
    while (k < sessionEnd) {
      const burstEnd = Math.min(sessionEnd, k + 5 + random() * 35)
      while (k < burstEnd) {
        keys.push(k, SAMPLE_TEXT.charCodeAt(ci++ % SAMPLE_TEXT.length))
        k += 0.12 + random() * 0.2
      }
      k += 2 + random() * 28
    }
    t = sessionEnd + (continuous ? 0 : 60 + random() * 1140)
  }
  return { keys, end }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function percentile(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0
}

function summarize(intervals) {
  const i = [...intervals].sort((a, b) => a - b)
  const median = percentile(i, 0.5)
  return {
    frames: i.length,
    fps: median ? 1000 / median : 0,
    frameP95: percentile(i, 0.95),
    frameP99: percentile(i, 0.99),
    dropRate: i.length ? i.filter((x) => x > 25).length / i.length : 0,
  }
}

export async function startSpike({ variant, label, createGlyphLayer }) {
  const log = []
  const event = (category, data = {}) => log.push({ at: new Date().toISOString(), category, ...data })

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(innerWidth, innerHeight)
  renderer.setClearColor(0x0d0f14)
  document.body.prepend(renderer.domElement)

  const scene = new THREE.Scene()
  const persp = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 20000)
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  let camera = persp
  const threadLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -100000), new THREE.Vector3(0, 0, 100000)]),
    new THREE.LineBasicMaterial({ color: 0x5a6275 })
  )
  scene.add(threadLine)

  const layer = await createGlyphLayer({ scene, renderer, fontUrl: FONT_URL, fontSize: FONT_SIZE, speed: SPEED, lift: LIFT, printable: PRINTABLE })

  const clock = { base: 0, startedAt: performance.now() }
  const now = () => clock.base + (performance.now() - clock.startedAt) / 1000
  const state = { load: 'none', view: 'live', origin: 0, sideCenter: 0, sidePx: 16, sweep: null, buildMs: 0 }

  async function load(name) {
    const history = name === '1h' ? generateKeys(1) : generateKeys(8, true)
    const started = performance.now()
    await layer.build(history.keys, history.end)
    state.buildMs = performance.now() - started
    state.load = name
    state.origin = history.end
    // Centre side views on a visible letter (not a space) near the end of the history.
    let index = 2 * Math.floor((history.keys.length / 2) * 0.9)
    while (history.keys[index + 1] === 32) index += 2
    state.sideCenter = history.keys[index]
    clock.base = history.end
    clock.startedAt = performance.now()
    event('load', { name, buildMs: state.buildMs, ...layer.stats() })
  }

  function setView(name) {
    state.view = name
    state.sweep = null
    const side = name.startsWith('side')
    layer.setOrientation(side ? Math.PI / 2 : Math.PI)
    if (side) state.sidePx = Number(name.match(/side-(\d+)px/)?.[1] ?? 16)
  }

  function updateCamera() {
    const headZ = -(now() - state.origin) * SPEED
    if (!state.view.startsWith('side')) {
      const v = LIVE_VIEWS[state.view]
      camera = persp
      persp.position.set(v.eye[0], v.eye[1], headZ + v.eye[2])
      persp.lookAt(v.target[0], v.target[1], headZ + v.target[2])
    } else {
      camera = ortho
      const unitsPerPx = FONT_SIZE / state.sidePx
      Object.assign(ortho, {
        left: (-unitsPerPx * innerWidth) / 2,
        right: (unitsPerPx * innerWidth) / 2,
        top: (unitsPerPx * innerHeight) / 2,
        bottom: (-unitsPerPx * innerHeight) / 2,
      })
      ortho.updateProjectionMatrix()
      const cz = -(state.sideCenter - state.origin) * SPEED
      ortho.position.set(10, FONT_SIZE * 0.5, cz)
      ortho.up.set(0, 1, 0)
      ortho.lookAt(0, FONT_SIZE * 0.5, cz)
    }
  }

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
    if (state.sweep) {
      const p = clamp((performance.now() - state.sweep.startedAt) / state.sweep.ms, 0, 1)
      state.sidePx = state.sweep.from * Math.pow(state.sweep.to / state.sweep.from, p)
    }
    updateCamera()
    renderer.render(scene, camera)
    if (hudIntervals.length % 15 === 0) {
      const s = summarize(hudIntervals)
      hud.textContent =
        `${label}\n` +
        `view ${state.view}${state.view.startsWith('side') ? ` (${state.sidePx.toFixed(1)} px/em)` : ''}   load ${state.load}   build ${(state.buildMs / 1000).toFixed(1)} s\n` +
        `fps ${s.fps.toFixed(1)}   p95 ${s.frameP95.toFixed(1)} ms   glyphs ${layer.stats().glyphs.toLocaleString()}\n\n` +
        `type to write · 1–8 views (live, oblique, side 8/12/16/24/48/120 px) · S sweep · L load 1 h / 8 h`
    }
    requestAnimationFrame(frame)
  }

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight)
    persp.aspect = innerWidth / innerHeight
    persp.updateProjectionMatrix()
  })

  addEventListener('keydown', (e) => {
    if (SCRIPTED || e.ctrlKey || e.metaKey) return
    if (/^[1-8]$/.test(e.key)) return setView(VIEW_NAMES[Number(e.key) - 1])
    if (e.key === 'S') return (state.sweep = { from: 4, to: 120, ms: 5000, startedAt: performance.now() }), setView('side-4px')
    if (e.key === 'L') return load(state.load === '1h' ? '8h-continuous' : '1h')
    if (e.key.length === 1) layer.add(now(), e.key.charCodeAt(0))
  })

  // Crop around what the view is about: the screen centre for side views, the
  // letters just behind the live head for live views.
  function cropRect() {
    let x = innerWidth / 2
    let y = innerHeight / 2
    if (!state.view.startsWith('side')) {
      const v = new THREE.Vector3(0, FONT_SIZE, -(now() - state.origin) * SPEED + 1.2).project(camera)
      x = ((v.x + 1) / 2) * innerWidth
      y = ((1 - v.y) / 2) * innerHeight
    }
    const width = 560
    const height = 240
    return {
      x: Math.round(clamp(x - width / 2, 0, innerWidth - width)),
      y: Math.round(clamp(y - height / 2, 0, innerHeight - height)),
      width,
      height,
    }
  }

  const typing = () =>
    TYPING ? setInterval(() => layer.add(now(), SAMPLE_TEXT.charCodeAt(Math.floor(Math.random() * SAMPLE_TEXT.length))), 180) : null

  async function runShots() {
    await load('1h')
    const timer = typing()
    const files = []
    for (const name of VIEW_NAMES) {
      setView(name)
      await wait(1500)
      files.push(...(await ipcRenderer.invoke('capture', { name, rect: cropRect() })))
      event('shot', { name, sidePx: state.sidePx })
    }
    clearInterval(timer)
    await ipcRenderer.invoke('write-result', { name: 'shots', data: { log } })
    ipcRenderer.send('done', { lines: ['Screenshots:', ...files] })
  }

  async function runBench() {
    const results = []
    const timer = typing()
    for (const name of ['1h', '8h-continuous']) {
      const started = performance.now()
      const outcome = await Promise.race([load(name).then(() => 'ok'), wait(150000).then(() => 'timeout')])
      if (outcome === 'timeout') {
        results.push({ load: name, view: '(build)', buildTimedOut: true, buildMs: performance.now() - started, ...layer.stats() })
        event('build-timeout', results.at(-1))
        break
      }
      for (const view of ['live', 'live-oblique', 'side-16px', 'side-sweep']) {
        if (view === 'side-sweep') {
          setView('side-4px')
          state.sweep = { from: 4, to: 120, ms: 5000, startedAt: performance.now() + 1000 }
        } else setView(view)
        await wait(1000)
        bench.intervals = []
        bench.collect = true
        await wait(4000)
        bench.collect = false
        const memory = await process.getProcessMemoryInfo()
        results.push({ load: name, view, typing: TYPING, buildMs: state.buildMs, ...summarize(bench.intervals), privateMB: memory.private / 1024, ...layer.stats() })
        event('bench-step', results.at(-1))
      }
    }
    clearInterval(timer)
    const file = await ipcRenderer.invoke('write-result', { name: 'bench', data: { results, log } })
    const pad = (v, n) => String(v).padEnd(n)
    const lines = [`Results written to ${file}${TYPING ? '' : '  (typing off)'}`, '', pad('load', 14) + pad('view', 13) + pad('build s', 9) + pad('fps', 6) + pad('p95ms', 7) + pad('drop%', 7) + pad('privMB', 8) + 'glyphs']
    for (const r of results) {
      lines.push(
        pad(r.load, 14) + pad(r.view, 13) + pad((r.buildMs / 1000).toFixed(1) + (r.buildTimedOut ? '+' : ''), 9) +
          pad(r.fps?.toFixed(1) ?? '-', 6) + pad(r.frameP95?.toFixed(1) ?? '-', 7) + pad(r.dropRate !== undefined ? (r.dropRate * 100).toFixed(1) : '-', 7) +
          pad(r.privateMB?.toFixed(0) ?? '-', 8) + r.glyphs
      )
    }
    ipcRenderer.send('done', { lines })
  }

  setView('live')
  requestAnimationFrame(frame)
  if (SHOTS) runShots()
  else if (BENCH) runBench()
  else load('1h')
}
