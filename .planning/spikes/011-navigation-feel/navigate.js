// Spike 011 — moving through a thread.
//
// D-17: "Zoom from the whole thread to single dots, pan, click a session note to
// fly to it, and drag through any day on a thin date scrubber bar along the
// bottom. The timeline itself never changes. Gravity pulls the view toward a
// note only when hovering near it, more strongly for bigger notes; there is no
// pull while moving freely." Kaelen: "It's like space, huge gaps broken up with
// small planets, but the gravity is enough to easily be able to navigate
// between them."
//
// This is a feel spike. The numbers it takes (fps at each zoom, during a fly and
// during a drag) only say it is not in the way; whether the gravity is right is
// Kaelen's call, by hand.
//
// The camera is orthographic, looking at the line from the side, so zoom is one
// number — `span`, the seconds of thread across the window — from the whole
// thread down to a single dot. Pixels per em falls straight out of it, which is
// what tells us when letters become readable (spikes 002/003: legible from 8 px).
import * as THREE from 'three'
import { createSdfRasterizer } from '../003-shared/sdf-rasterizer.js'
import { createAtlasGlyphLayer } from '../003-shared/glyph-layer.js'

const { ipcRenderer } = window.require('electron')
const params = new URLSearchParams(location.search)
const BENCH = params.get('bench') === '1'
const SHOTS = params.get('shots') === '1'
const SCRIPTED = BENCH || SHOTS

const HOURS = Number(params.get('hours') ?? 8)
const SPEED = 1.5 // world units per second of thread time
const FONT_SIZE = 0.12 // world units per em
const LIFT = 0.03
const FONT_URL = new URL('/font/verdana.ttf', location.href).href

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (m) => console.error('[step]', m)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
addEventListener('error', (e) => console.error('[page error]', e.message, e.filename, e.lineno))
addEventListener('unhandledrejection', (e) =>
  console.error('[unhandled rejection]', String((e.reason && e.reason.stack) || e.reason))
)

const percentile = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0)
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
// History — sessions, gaps and letters, in the rhythm of spikes 001–008
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SAMPLE =
  'ok i need to start writing my notes here, and just make it easier to use. this is a knowledge base as much as obsidian is. threads run through time, one letter at a time. '
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const LATIN = Array.from(segmenter.segment(SAMPLE), (x) => x.segment)

function generate(hours) {
  const random = mulberry32(7)
  const end = hours * 3600
  const times = []
  const chars = []
  const sessions = []
  let t = 0
  let i = 0
  while (t < end) {
    const start = t
    const sessionEnd = Math.min(end, t + (120 + random() * 780))
    let letters = 0
    while (t < sessionEnd) {
      const burstEnd = Math.min(sessionEnd, t + (5 + random() * 35))
      const cps = 3 + random() * 5
      while (t < burstEnd) {
        times.push(t)
        chars.push(LATIN[i++ % LATIN.length])
        letters++
        t += 1 / cps
      }
      t += random() * 3
    }
    // A session note's size comes from how much was written in it — the bigger
    // the session, the stronger its pull (D-17).
    sessions.push({ start, end: Math.min(t, sessionEnd), letters })
    t += 60 + random() * 1140
  }
  return { times, chars, sessions, end }
}

step(`generating ${HOURS} h`)
const history = generate(HOURS)
const maxLetters = Math.max(...history.sessions.map((s) => s.letters))
step(`${history.times.length.toLocaleString()} letters, ${history.sessions.length} sessions`)

const zOf = (t) => -t * SPEED // time runs toward -z; the camera flips it so it reads left to right

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(innerWidth, innerHeight)
renderer.setClearColor(0x0d0f14)
document.body.prepend(renderer.domElement)

const scene = new THREE.Scene()
// Orthographic, looking along -x, so screen-right is -z and time reads left to right.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
camera.position.set(2, 0, 0)
camera.up.set(0, 1, 0)

// The line itself, and dim stretches for the gaps between sessions (D-16).
scene.add(
  new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, zOf(history.end))]),
    new THREE.LineBasicMaterial({ color: 0x4a5266 })
  )
)
const sessionGeometry = new THREE.BufferGeometry()
const sessionPoints = []
for (const s of history.sessions) {
  sessionPoints.push(new THREE.Vector3(0, 0, zOf(s.start)), new THREE.Vector3(0, 0, zOf(s.end)))
}
sessionGeometry.setFromPoints(sessionPoints)
const sessionLines = new THREE.LineSegments(sessionGeometry, new THREE.LineBasicMaterial({ color: 0x9ab4dd }))
scene.add(sessionLines)

// A marker per session note, sized by how much was written in it.
const noteGeometry = new THREE.PlaneGeometry(1, 1)
const noteMaterial = new THREE.MeshBasicMaterial({ color: 0xdbe6ff, transparent: true, opacity: 0.9 })
const notes = new THREE.InstancedMesh(noteGeometry, noteMaterial, history.sessions.length)
notes.frustumCulled = false
scene.add(notes)

const { rasterize } = await createSdfRasterizer({ fontUrl: FONT_URL })
const layer = await createAtlasGlyphLayer({ scene, renderer, fontSize: FONT_SIZE, speed: SPEED, lift: LIFT, rasterize })
await layer.build({ times: history.times, chars: history.chars }, 0)
layer.setOrientation(Math.PI / 2) // facing the side camera
step('scene built')

// ---------------------------------------------------------------------------
// The view: one number for where, one for how wide
// ---------------------------------------------------------------------------

const FULL_SPAN = history.end
const MIN_SPAN = 0.25 // a quarter second across the window: single dots
const view = { centre: history.end / 2, span: FULL_SPAN, targetCentre: null, targetSpan: null, flyStart: 0, flyMs: 0 }

const pxPerSecond = () => innerWidth / view.span
const pxPerEm = () => (FONT_SIZE / SPEED) * pxPerSecond()

function applyCamera() {
  const halfZ = (view.span * SPEED) / 2
  const halfY = (halfZ * innerHeight) / innerWidth
  const centreZ = zOf(view.centre)
  camera.left = -halfZ
  camera.right = halfZ
  camera.top = halfY
  camera.bottom = -halfY
  camera.position.set(2, 0, centreZ)
  camera.lookAt(0, 0, centreZ)
  camera.updateProjectionMatrix()

  // Session markers are drawn at a constant screen size, so they read as
  // "planets" at every zoom rather than vanishing when zoomed out.
  const matrix = new THREE.Matrix4()
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0))
  for (let i = 0; i < history.sessions.length; i++) {
    const s = history.sessions[i]
    const weight = 0.35 + 0.65 * (s.letters / maxLetters)
    const size = (weight * 14 * halfZ * 2) / innerWidth // ~14 px across at any zoom
    matrix.compose(
      new THREE.Vector3(0, 0.055, zOf(s.start)),
      q,
      new THREE.Vector3(size, size, size)
    )
    notes.setMatrixAt(i, matrix)
  }
  notes.instanceMatrix.needsUpdate = true
}

// ---------------------------------------------------------------------------
// Gravity (D-17): a pull toward a note only while hovering near it.
// ---------------------------------------------------------------------------

const GRAVITY = {
  radiusPx: 140, // how near the pointer must be for a note to pull at all
  strength: 0.22, // fraction of the remaining distance per frame, at full pull
}

const pointer = { x: null, y: null, inside: false }
let hoveredNote = null
let gravityPull = 0

function noteScreenX(s) {
  const halfZ = (view.span * SPEED) / 2
  const centreZ = zOf(view.centre)
  // screen-right is -z
  const dz = centreZ - zOf(s.start)
  return innerWidth / 2 + (dz / halfZ) * (innerWidth / 2)
}

function updateGravity(dtMs) {
  hoveredNote = null
  gravityPull = 0
  // No pull while the user is moving the view themselves (D-17: "no pull while
  // moving freely"), or while a fly is in progress.
  if (!pointer.inside || drag.active || view.targetCentre !== null) return

  let best = null
  for (const s of history.sessions) {
    const x = noteScreenX(s)
    if (x < -GRAVITY.radiusPx || x > innerWidth + GRAVITY.radiusPx) continue
    const d = Math.abs(x - pointer.x)
    if (d > GRAVITY.radiusPx) continue
    const weight = 0.35 + 0.65 * (s.letters / maxLetters)
    // Nearer pulls harder; bigger notes pull harder (D-17).
    const pull = (1 - d / GRAVITY.radiusPx) ** 2 * weight
    if (!best || pull > best.pull) best = { s, pull, x }
  }
  if (!best) return
  hoveredNote = best.s
  gravityPull = best.pull

  const k = 1 - Math.pow(1 - GRAVITY.strength * best.pull, dtMs / 16.7)
  view.centre += (best.s.start - view.centre) * k
}

// ---------------------------------------------------------------------------
// Input: pan, zoom, click to fly, drag the scrubber
// ---------------------------------------------------------------------------

const drag = { active: false, x: 0, centre: 0, moved: 0 }
const canvas = renderer.domElement

canvas.addEventListener('pointerdown', (e) => {
  if (SCRIPTED) return
  drag.active = true
  drag.x = e.clientX
  drag.centre = view.centre
  drag.moved = 0
  view.targetCentre = null
  canvas.setPointerCapture(e.pointerId)
})

canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX
  pointer.y = e.clientY
  pointer.inside = true
  if (!drag.active) return
  const dx = e.clientX - drag.x
  drag.moved = Math.max(drag.moved, Math.abs(dx))
  view.centre = clamp(drag.centre + dx / pxPerSecond(), 0, history.end)
})

canvas.addEventListener('pointerup', (e) => {
  if (!drag.active) return
  drag.active = false
  canvas.releasePointerCapture(e.pointerId)
  // A click, not a drag: fly to the note under the pointer (D-17).
  if (drag.moved < 4 && hoveredNote) flyTo(hoveredNote.start, Math.min(view.span, 120))
})

canvas.addEventListener('pointerleave', () => (pointer.inside = false))

canvas.addEventListener(
  'wheel',
  (e) => {
    if (SCRIPTED) return
    e.preventDefault()
    // Zoom about the pointer, so the moment under the cursor stays put.
    const atPointer = view.centre + (innerWidth / 2 - e.clientX) / pxPerSecond()
    const factor = Math.exp((e.ctrlKey ? e.deltaY : e.deltaY * 0.5) * 0.004)
    const span = clamp(view.span * factor, MIN_SPAN, FULL_SPAN)
    const ratio = span / view.span
    view.span = span
    view.centre = clamp(atPointer + (view.centre - atPointer) * ratio, 0, history.end)
    view.targetCentre = null
  },
  { passive: false }
)

function flyTo(centre, span) {
  view.targetCentre = clamp(centre, 0, history.end)
  view.targetSpan = clamp(span, MIN_SPAN, FULL_SPAN)
  view.flyFromCentre = view.centre
  view.flyFromSpan = view.span
  view.flyStart = performance.now()
  view.flyMs = 620
}

function updateFly(nowMs) {
  if (view.targetCentre === null) return
  const p = clamp((nowMs - view.flyStart) / view.flyMs, 0, 1)
  const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2 // easeInOutCubic
  view.centre = view.flyFromCentre + (view.targetCentre - view.flyFromCentre) * e
  // Zoom geometrically, or the middle of a long fly looks wrong.
  view.span = view.flyFromSpan * Math.pow(view.targetSpan / view.flyFromSpan, e)
  if (p >= 1) view.targetCentre = null
}

// The scrubber (D-17): sessions on a rail, the visible window drawn on it.
const barEl = document.getElementById('bar')
const windowEl = barEl.querySelector('.window')
const readoutEl = document.getElementById('readout')
const hud = document.getElementById('hud')

for (const s of history.sessions) {
  const el = document.createElement('div')
  el.className = 'session'
  el.style.left = `${(s.start / history.end) * 100}%`
  el.style.width = `${Math.max(0.15, ((s.end - s.start) / history.end) * 100)}%`
  barEl.appendChild(el)
}
for (let h = 0; h <= HOURS; h++) {
  const tick = document.createElement('div')
  tick.className = 'day'
  tick.style.left = `${(h / HOURS) * 100}%`
  barEl.appendChild(tick)
  const label = document.createElement('div')
  label.className = 'dayLabel'
  label.style.left = `${(h / HOURS) * 100}%`
  label.textContent = `${h}h`
  barEl.appendChild(label)
}

let scrubbing = false
const scrubTo = (clientX) => {
  const r = barEl.getBoundingClientRect()
  view.centre = clamp(((clientX - r.left) / r.width) * history.end, 0, history.end)
  view.targetCentre = null
}
barEl.addEventListener('pointerdown', (e) => {
  if (SCRIPTED) return
  scrubbing = true
  barEl.setPointerCapture(e.pointerId)
  scrubTo(e.clientX)
})
barEl.addEventListener('pointermove', (e) => scrubbing && scrubTo(e.clientX))
barEl.addEventListener('pointerup', (e) => {
  scrubbing = false
  barEl.releasePointerCapture(e.pointerId)
})

const clockText = (s) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const spanText = (s) =>
  s >= 3600 ? `${(s / 3600).toFixed(2)} h` : s >= 60 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(2)} s`

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

const sampler = { recent: [], intervals: [], collect: false, last: 0 }

function frame(timestamp) {
  const dt = sampler.last ? timestamp - sampler.last : 16.7
  if (sampler.last) {
    sampler.recent.push(dt)
    if (sampler.recent.length > 240) sampler.recent.splice(0, 120)
    if (sampler.collect) sampler.intervals.push(dt)
  }
  sampler.last = timestamp

  updateFly(timestamp)
  updateGravity(dt)
  applyCamera()
  renderer.render(scene, camera)

  const half = view.span / 2
  windowEl.style.left = `${clamp(((view.centre - half) / history.end) * 100, 0, 100)}%`
  windowEl.style.width = `${clamp((view.span / history.end) * 100, 0.4, 100)}%`

  if (sampler.recent.length % 15 === 0) {
    const f = frameSummary(sampler.recent)
    hud.textContent =
      `Spike 011 — moving through a thread\n` +
      `${HOURS} h   ${history.times.length.toLocaleString()} letters   ${history.sessions.length} sessions\n` +
      `fps ${f.fps.toFixed(1)}   p95 ${f.frameP95.toFixed(1)} ms\n` +
      `span ${spanText(view.span)} across the window   ${pxPerEm().toFixed(1)} px per em\n` +
      `gravity ${gravityPull > 0 ? `pulling ${(gravityPull * 100).toFixed(0)}%` : 'free'}` +
      `${hoveredNote ? `   near the session at ${clockText(hoveredNote.start)}` : ''}\n\n` +
      `drag to pan · scroll to zoom · click a session note to fly · drag the bar below`
    readoutEl.textContent =
      `centre ${clockText(view.centre)}   window ${spanText(view.span)}   ` +
      `${pxPerEm() >= 8 ? 'letters readable' : 'letters below reading size'}`
  }
  requestAnimationFrame(frame)
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
})

requestAnimationFrame(frame)

// ---------------------------------------------------------------------------
// Scripted runs
// ---------------------------------------------------------------------------

async function measure(during) {
  sampler.intervals = []
  sampler.collect = true
  await during()
  sampler.collect = false
  return frameSummary(sampler.intervals)
}

const setView = (centre, span) => {
  view.centre = clamp(centre, 0, history.end)
  view.span = clamp(span, MIN_SPAN, FULL_SPAN)
  view.targetCentre = null
}

async function hold(ms) {
  const until = performance.now() + ms
  while (performance.now() < until) await new Promise((r) => requestAnimationFrame(r))
}

async function runBench() {
  const results = []
  const row = async (phase, fn) => {
    const f = await measure(fn)
    const privateMB = await ipcRenderer.invoke('memory').catch(() => 0)
    results.push({ phase, spanSeconds: view.span, pxPerEm: pxPerEm(), ...f, privateMB })
  }

  // Still, at each zoom from the whole thread down to single dots.
  for (const [name, span] of [
    ['whole-thread', FULL_SPAN],
    ['one-hour', 3600],
    ['one-minute', 60],
    ['five-seconds', 5],
    ['single-dots', MIN_SPAN],
  ]) {
    setView(history.end / 2, span)
    await hold(200)
    await row(`still-${name}`, () => hold(2500))
  }

  // A continuous zoom sweep, whole thread to single dots and back.
  setView(history.end / 2, FULL_SPAN)
  await row('zoom-sweep', async () => {
    const steps = 180
    for (let i = 0; i <= steps; i++) {
      const p = i / steps
      const t = p < 0.5 ? p * 2 : (1 - p) * 2
      view.span = FULL_SPAN * Math.pow(MIN_SPAN / FULL_SPAN, t)
      await new Promise((r) => requestAnimationFrame(r))
    }
  })

  // Panning at a readable zoom.
  setView(history.end / 2, 60)
  await row('pan-at-60s-span', async () => {
    const steps = 180
    for (let i = 0; i <= steps; i++) {
      view.centre = clamp(view.centre + 0.35, 0, history.end)
      await new Promise((r) => requestAnimationFrame(r))
    }
  })

  // Flying between session notes, which is what gravity exists to make easy.
  await row('fly-between-sessions', async () => {
    const picks = [2, 12, 5, 19, 9].map((i) => history.sessions[i % history.sessions.length])
    for (const s of picks) {
      flyTo(s.start, 45)
      while (view.targetCentre !== null) await new Promise((r) => requestAnimationFrame(r))
      await hold(120)
    }
  })

  // Dragging the whole history through the scrubber.
  setView(0, 120)
  await row('scrubber-drag-whole-history', async () => {
    const steps = 240
    for (let i = 0; i <= steps; i++) {
      view.centre = (i / steps) * history.end
      await new Promise((r) => requestAnimationFrame(r))
    }
  })

  const file = await ipcRenderer.invoke('write-result', {
    name: 'bench',
    data: { hours: HOURS, letters: history.times.length, sessions: history.sessions.length, results },
  })
  const pad = (v, n) => String(v).padEnd(n)
  const lines = [
    `Results written to ${file}`,
    '',
    `${HOURS} h · ${history.times.length.toLocaleString()} letters · ${history.sessions.length} sessions`,
    '',
    pad('phase', 30) + pad('span', 12) + pad('px/em', 9) + pad('fps', 7) + pad('p95', 9) + pad('max', 9) + pad('drop%', 8) + 'privMB',
  ]
  for (const r of results) {
    lines.push(
      pad(r.phase, 30) + pad(spanText(r.spanSeconds), 12) + pad(r.pxPerEm.toFixed(1), 9) +
      pad(r.fps.toFixed(1), 7) + pad(r.frameP95.toFixed(1) + ' ms', 9) + pad(r.frameMax.toFixed(1) + ' ms', 9) +
      pad((r.dropRate * 100).toFixed(1), 8) + (r.privateMB ? r.privateMB.toFixed(0) : '—')
    )
  }
  ipcRenderer.send('done', { lines })
}

async function runShots() {
  const files = []
  for (const [name, centre, span] of [
    ['whole-thread', history.end / 2, FULL_SPAN],
    ['one-hour', history.sessions[6].start, 3600],
    ['one-minute', history.sessions[6].start + 30, 60],
    ['letters-readable', history.sessions[6].start + 30, 8],
    ['single-dots', history.sessions[6].start + 30, MIN_SPAN],
  ]) {
    setView(centre, span)
    await hold(260)
    files.push(...(await ipcRenderer.invoke('capture', { name, rect: { x: 0, y: 260, width: 1400, height: 400 } })))
  }
  await ipcRenderer.invoke('write-result', { name: 'shots', data: { sessions: history.sessions.length } })
  ipcRenderer.send('done', { lines: ['Screenshots:', ...files] })
}

const fail = (err) => {
  console.error('[scripted failed]', String((err && err.stack) || err))
  ipcRenderer.send('done', { lines: ['FAILED: ' + String((err && err.message) || err)] })
}
if (BENCH) runBench().catch(fail)
else if (SHOTS) runShots().catch(fail)
else setView(history.end / 2, 600)
