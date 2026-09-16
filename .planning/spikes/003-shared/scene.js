// Shared scene for spikes 003a (SDF atlas) and 003b (MSDF atlas).
//
// Extends 002's scene (../002-shared/scene.js, left unchanged so 002 stays
// reproducible): letters are graphemes rather than ASCII codes, history mixes in
// CJK, the last ~40 s of every load is a showcase of Latin shapes and other scripts
// and emoji, side views go to 240 px per em, and the benchmark measures the frame
// hitch when never-seen glyphs are typed live.
//
// Side views centre on the showcase, which sits within a minute of the render
// origin, so float32 positions stay exact at 240 px per em (spike 001's floating
// origin requirement).
//
// A glyph layer is:
//   build({ times, chars }, tOrigin)  resolves when drawable
//   add(time, grapheme)               one live keystroke
//   setOrientation(theta)             π: facing the live camera, π/2: facing the side camera
//   stats()                           { glyphs, atlasCells, ... }
import * as THREE from 'three'

const { ipcRenderer } = window.require('electron')

export const SPEED = 1.5 // world units per second of thread time
export const FONT_SIZE = 0.12 // world units per em
export const LIFT = 0.03 // baseline height above the thread line
export const FONT_URL = new URL('/font/verdana.ttf', location.href).href

const params = new URLSearchParams(location.search)
const BENCH = params.get('bench') === '1'
const SHOTS = params.get('shots') === '1'
const SCRIPTED = BENCH || SHOTS
const TYPING = params.get('typing') !== '0'

const SIDE_PX = [8, 16, 24, 48, 120, 240]
export const VIEW_NAMES = ['live', 'live-oblique', ...SIDE_PX.map((px) => `side-${px}px`), 'unicode-48px', 'unicode-240px', 'unicode-16px']
const LIVE_VIEWS = {
  live: { eye: [0.35, 0.28, -1.2], target: [0, 0, 6] },
  'live-oblique': { eye: [1.6, 0.6, -0.6], target: [0, 0.05, 3] },
}

const SAMPLE_TEXT =
  'ok i need to start writing my notes here, and just make it easier to use. this is a knowledge base as much as obsidian is. threads run through time, one letter at a time. '
const SHOWCASE_LATIN = 'Sharp at any zoom: RaWg 0O8 ijl {}@& '
const SHOWCASE_UNICODE = 'ノートを書く 中文笔记 한국어 مرحبا नमस्ते café 👩‍👩‍👧 🇳🇿 ✨🧵 '

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export const graphemes = (s) => Array.from(segmenter.segment(s), (x) => x.segment)
const LATIN = graphemes(SAMPLE_TEXT)
const CJK_POOL = Array.from({ length: 600 }, (_, i) => String.fromCodePoint(0x4e00 + i * 11))
let hangulNext = 0
const freshHangul = () => String.fromCodePoint(0xac00 + 3 * hangulNext++) // never seen before

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Same rhythm as spikes 001/002 (sessions of 2–15 min, 1–20 min away, bursts of
// 5–40 s at 3–8 keys/s); 12 % of bursts are CJK from a 600-character pool.
function generateKeys(hours, continuous = false) {
  const random = mulberry32(7)
  const latinShow = graphemes(SHOWCASE_LATIN)
  const showcase = [...latinShow, ...graphemes(SHOWCASE_UNICODE)]
  const step = 0.22
  const end = hours * 3600
  const historyEnd = end - showcase.length * step - 5
  const times = []
  const chars = []
  let t = 0
  let ci = 0
  while (t < historyEnd) {
    const sessionEnd = continuous ? historyEnd : Math.min(historyEnd, t + 120 + random() * 780)
    let k = t
    while (k < sessionEnd) {
      const burstEnd = Math.min(sessionEnd, k + 5 + random() * 35)
      const cjk = random() < 0.12
      while (k < burstEnd) {
        times.push(k)
        chars.push(cjk ? CJK_POOL[Math.floor(random() * CJK_POOL.length)] : LATIN[ci++ % LATIN.length])
        k += 0.12 + random() * 0.2
      }
      k += 2 + random() * 28
    }
    t = sessionEnd + (continuous ? 0 : 60 + random() * 1140)
  }
  const start = historyEnd + 2
  showcase.forEach((g, i) => {
    times.push(start + i * step)
    chars.push(g)
  })
  return {
    times,
    chars,
    end,
    latinCenter: start + step * 21, // "W": diagonals and sharp corners
    unicodeCenter: start + step * (latinShow.length + 3), // "を": curves and a closed counter
    unicodeMid: start + step * (latinShow.length + graphemes(SHOWCASE_UNICODE).length / 2), // whole line at 16 px
  }
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
    frameMax: i.length ? i[i.length - 1] : 0,
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
  scene.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -100000), new THREE.Vector3(0, 0, 100000)]),
      new THREE.LineBasicMaterial({ color: 0x5a6275 })
    )
  )

  const layerStarted = performance.now()
  const layer = await createGlyphLayer({ scene, renderer, fontUrl: FONT_URL, fontSize: FONT_SIZE, speed: SPEED, lift: LIFT })
  event('layer-ready', { ms: performance.now() - layerStarted })

  const clock = { base: 0, startedAt: performance.now() }
  const now = () => clock.base + (performance.now() - clock.startedAt) / 1000
  const state = { load: 'none', view: 'live', origin: 0, latinCenter: 0, unicodeCenter: 0, unicodeMid: 0, sidePx: 16, sweep: null, buildMs: 0 }

  async function load(name) {
    const history = name === '1h' ? generateKeys(1) : generateKeys(8, true)
    const started = performance.now()
    await layer.build(history, history.end)
    state.buildMs = performance.now() - started
    Object.assign(state, { load: name, origin: history.end, latinCenter: history.latinCenter, unicodeCenter: history.unicodeCenter, unicodeMid: history.unicodeMid })
    clock.base = history.end
    clock.startedAt = performance.now()
    event('load', { name, buildMs: state.buildMs, ...layer.stats() })
  }

  const isSide = (name) => name.startsWith('side') || name.startsWith('unicode')

  function setView(name) {
    state.view = name
    state.sweep = null
    layer.setOrientation(isSide(name) ? Math.PI / 2 : Math.PI)
    if (isSide(name)) state.sidePx = Number(name.match(/(\d+)px/)?.[1] ?? 16)
  }

  function updateCamera() {
    const headZ = -(now() - state.origin) * SPEED
    if (!isSide(state.view)) {
      const v = LIVE_VIEWS[state.view]
      camera = persp
      persp.position.set(v.eye[0], v.eye[1], headZ + v.eye[2])
      persp.lookAt(v.target[0], v.target[1], headZ + v.target[2])
      return
    }
    camera = ortho
    const unitsPerPx = FONT_SIZE / state.sidePx
    Object.assign(ortho, {
      left: (-unitsPerPx * innerWidth) / 2,
      right: (unitsPerPx * innerWidth) / 2,
      top: (unitsPerPx * innerHeight) / 2,
      bottom: (-unitsPerPx * innerHeight) / 2,
    })
    ortho.updateProjectionMatrix()
    const centre = state.view === 'unicode-16px' ? state.unicodeMid : state.view.startsWith('unicode') ? state.unicodeCenter : state.latinCenter
    const cz = -(centre - state.origin) * SPEED
    ortho.position.set(10, FONT_SIZE * 0.4, cz)
    ortho.up.set(0, 1, 0)
    ortho.lookAt(0, FONT_SIZE * 0.4, cz)
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
      const st = layer.stats()
      hud.textContent =
        `${label}\n` +
        `view ${state.view}${isSide(state.view) ? ` (${state.sidePx.toFixed(1)} px/em)` : ''}   load ${state.load}   build ${(state.buildMs / 1000).toFixed(2)} s\n` +
        `fps ${s.fps.toFixed(1)}   p95 ${s.frameP95.toFixed(1)} ms   glyphs ${st.glyphs.toLocaleString()}   atlas ${st.atlasCells}/1024   raster ${st.rasterMsAvg.toFixed(2)} ms avg\n\n` +
        `type in any script (IME and emoji work) · Ctrl+1–9, Ctrl+0 views · Ctrl+S sweep 4→240 px · Ctrl+L load 1 h / 8 h`
    }
    requestAnimationFrame(frame)
  }

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight)
    persp.aspect = innerWidth / innerHeight
    persp.updateProjectionMatrix()
  })

  // Typing goes through a hidden textarea so IME composition and the emoji picker work.
  const input = document.getElementById('input')
  if (!SCRIPTED) {
    input.focus()
    addEventListener('mousedown', () => setTimeout(() => input.focus()))
  }
  input.addEventListener('input', (e) => {
    if (SCRIPTED || e.isComposing) return
    for (const g of graphemes(input.value)) layer.add(now(), g)
    input.value = ''
  })
  addEventListener('keydown', (e) => {
    if (SCRIPTED || !e.ctrlKey) return
    const digit = '1234567890'.indexOf(e.key)
    if (digit >= 0 && digit < VIEW_NAMES.length) return e.preventDefault(), setView(VIEW_NAMES[digit])
    if (e.key === 's') return e.preventDefault(), setView('side-4px'), (state.sweep = { from: 4, to: 240, ms: 6000, startedAt: performance.now() })
    if (e.key === 'l') return e.preventDefault(), load(state.load === '1h' ? '8h-continuous' : '1h')
  })

  function cropRect() {
    let x = innerWidth / 2
    let y = innerHeight / 2
    if (!isSide(state.view)) {
      const v = new THREE.Vector3(0, FONT_SIZE, -(now() - state.origin) * SPEED + 1.2).project(camera)
      x = ((v.x + 1) / 2) * innerWidth
      y = ((1 - v.y) / 2) * innerHeight
    }
    const width = 640
    const height = state.sidePx >= 120 && isSide(state.view) ? 380 : 260
    return {
      x: Math.round(clamp(x - width / 2, 0, innerWidth - width)),
      y: Math.round(clamp(y - height / 2, 0, innerHeight - height)),
      width,
      height,
    }
  }

  const typing = () => (TYPING ? setInterval(() => layer.add(now(), LATIN[Math.floor(Math.random() * LATIN.length)]), 180) : null)

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
    await ipcRenderer.invoke('write-result', { name: 'shots', data: { log, stats: layer.stats() } })
    ipcRenderer.send('done', { lines: ['Screenshots:', ...files] })
  }

  async function measure(ms) {
    bench.intervals = []
    bench.collect = true
    await wait(ms)
    bench.collect = false
    return summarize(bench.intervals)
  }

  async function runBench() {
    const results = []
    const timer = typing()
    for (const name of ['1h', '8h-continuous']) {
      await load(name)
      for (const view of ['live', 'live-oblique', 'side-16px', 'side-sweep', 'new-glyphs']) {
        let extra = {}
        if (view === 'side-sweep') {
          setView('side-4px')
          state.sweep = { from: 4, to: 240, ms: 5000, startedAt: performance.now() + 1000 }
        } else if (view === 'new-glyphs') setView('live')
        else setView(view)
        await wait(1000)
        let fresh = null
        if (view === 'new-glyphs') {
          // A never-seen glyph every 250 ms: rasterize + atlas copy happen inside the frame.
          const before = layer.stats()
          fresh = setInterval(() => layer.add(now(), freshHangul()), 250)
          const summary = await measure(4000)
          clearInterval(fresh)
          const after = layer.stats()
          extra = { ...summary, newGlyphs: after.rasterCount - before.rasterCount, rasterMsLastAdded: after.rasterMsLast }
        } else extra = await measure(4000)
        const memory = await process.getProcessMemoryInfo()
        results.push({ load: name, view, typing: TYPING, buildMs: state.buildMs, ...extra, privateMB: memory.private / 1024, ...layer.stats() })
        event('bench-step', results.at(-1))
      }
    }
    clearInterval(timer)
    const file = await ipcRenderer.invoke('write-result', { name: 'bench', data: { results, log } })
    const pad = (v, n) => String(v).padEnd(n)
    const lines = [
      `Results written to ${file}`,
      '',
      pad('load', 14) + pad('view', 12) + pad('build s', 9) + pad('fps', 6) + pad('p95ms', 7) + pad('maxms', 7) + pad('drop%', 7) + pad('privMB', 8) + pad('glyphs', 8) + pad('cells', 6) + 'raster avg/max ms',
    ]
    for (const r of results) {
      lines.push(
        pad(r.load, 14) + pad(r.view, 12) + pad((r.buildMs / 1000).toFixed(2), 9) + pad(r.fps.toFixed(1), 6) + pad(r.frameP95.toFixed(1), 7) +
          pad(r.frameMax.toFixed(1), 7) + pad((r.dropRate * 100).toFixed(1), 7) + pad(r.privateMB.toFixed(0), 8) + pad(r.glyphs, 8) + pad(r.atlasCells, 6) +
          `${r.rasterMsAvg.toFixed(2)}/${r.rasterMsMax.toFixed(1)}`
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
