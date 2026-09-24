// Spike 001 — thread stream load.
//
// Question: can Tapestry's thread hold 60 fps in Electron with 1 h and 8 h of
// history, with bounded memory? The thread is a line through z that gains a dot
// 60 times a second while live, a glyph per keystroke, and a dash at every
// time-out and time-in, and it fades back over time.
//
// Two ways of drawing the dots are compared:
//   procedural  sessions are stored as chunks of 4 vertices; the fragment shader
//               draws the 60 Hz dots and collapses them into a solid line once
//               they are denser than the pixels. Data grows with sessions.
//   points      every dot is an explicit GPU point. Data grows with dots.
//
// Precision: 8 h at 60 Hz exceeds what a float32 can place exactly, so times
// are stored as (hour block, offset within the hour) and positions are computed
// relative to a moving origin; the dot pattern uses time since the chunk start.
import * as THREE from 'three'

const { ipcRenderer } = window.require('electron')
const fs = window.require('fs')
const path = window.require('path')

const BENCH = new URLSearchParams(location.search).get('bench') === '1'
const SHOTS = new URLSearchParams(location.search).get('shots') === '1'
const SPIKE_DIR = decodeURIComponent(new URL('.', location.href).pathname)
const HZ = 60
const SPEED = 1.5 // world units per second of thread time
const FADE = 20 // live view: seconds until an entry has faded out
const CHUNK = 600 // seconds per chunk
const IDLE_TIMEOUT = 5 // seconds without typing before the thread times out
const BLOCK = 3600 // seconds per floating-origin block
const DASH = 127 // atlas cell holding the time-out / time-in dash

const log = []
function event(category, data = {}) {
  log.push({ at: new Date().toISOString(), category, ...data })
}

function splitTime(t) {
  const block = Math.floor(t / BLOCK)
  return [block, t - block * BLOCK]
}

// ---------------------------------------------------------------- clock

const clock = { base: 0, startedAt: performance.now() }
const now = () => clock.base + (performance.now() - clock.startedAt) / 1000
function resetClock(t) {
  clock.base = t
  clock.startedAt = performance.now()
}

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(innerWidth, innerHeight)
renderer.setClearColor(0x0d0f14)
document.body.prepend(renderer.domElement)
const gl = renderer.getContext()
event('renderer', {
  webgl2: renderer.capabilities.isWebGL2 !== false,
  gpu: (() => {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })(),
  dpr: window.devicePixelRatio,
  size: [innerWidth, innerHeight],
})

const scene = new THREE.Scene()
const persp = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 20000)
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
let camera = persp

// ---------------------------------------------------------------- glyph atlas

function makeAtlas() {
  const cell = 64
  const canvas = document.createElement('canvas')
  canvas.width = cell * 16
  canvas.height = cell * 6
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `500 ${cell * 0.72}px -apple-system, "SF Pro Text", system-ui, sans-serif`
  for (let code = 32; code < DASH; code++) {
    const i = code - 32
    ctx.fillText(String.fromCharCode(code), ((i % 16) + 0.5) * cell, (Math.floor(i / 16) + 0.55) * cell)
  }
  const i = DASH - 32
  ctx.fillRect(((i % 16) + 0.5) * cell - cell * 0.08, (Math.floor(i / 16) + 0.5) * cell - cell * 0.4, cell * 0.16, cell * 0.8)
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  return texture
}

// ---------------------------------------------------------------- shaders

const uniforms = {
  uOriginBlock: { value: 0 },
  uOriginOffset: { value: 0 },
  uNowRel: { value: 0 },
  uSpeed: { value: SPEED },
  uFade: { value: FADE },
  uFadeOn: { value: 1 },
  uHz: { value: HZ },
  uPixelScale: { value: 0.001 },
  uOrtho: { value: 0 },
  uDpr: { value: window.devicePixelRatio },
  uWidth: { value: 0.012 },
  uMinPx: { value: 1.2 },
  uDotWorld: { value: 0.012 },
  uGlyphSize: { value: 0.05 },
  uSideGlyphPx: { value: 0 },
  uAtlas: { value: makeAtlas() },
}

const COMMON = /* glsl */ `
  uniform float uOriginBlock, uOriginOffset, uNowRel, uSpeed, uFade, uFadeOn, uPixelScale, uOrtho;
  float relTime(float block, float offset) {
    return (block - uOriginBlock) * ${BLOCK.toFixed(1)} + (offset - uOriginOffset);
  }
  vec4 threadPoint(float rel) { return modelViewMatrix * vec4(0.0, 0.0, -rel * uSpeed, 1.0); }
  float unitsPerPx(vec4 mv) { return uOrtho > 0.5 ? uPixelScale : uPixelScale * max(-mv.z, 1e-4); }
  float fadeFor(float rel) {
    float age = uNowRel - rel;
    return uFadeOn > 0.5 ? clamp(1.0 - age / uFade, 0.0, 1.0) : 1.0;
  }
  vec2 threadAxis() {
    vec2 a = (viewMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xy;
    float l = length(a);
    return l > 1e-5 ? a / l : vec2(1.0, 0.0);
  }
`

const material = (vertexShader, fragmentShader, extra = {}) =>
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader: COMMON + vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    ...extra,
  })

const ribbonMaterial = material(
  /* glsl */ `
  attribute float aBlock, aOffset, aLocal, aSide, aKind;
  uniform float uWidth, uMinPx;
  varying float vRel, vLocal, vSide, vKind;
  void main() {
    float rel = relTime(aBlock, aOffset);
    vec4 mv = threadPoint(rel);
    vec2 axis = threadAxis();
    vec2 perp = vec2(-axis.y, axis.x);
    mv.xy += perp * max(uWidth, uMinPx * unitsPerPx(mv)) * aSide;
    gl_Position = projectionMatrix * mv;
    vRel = rel; vLocal = aLocal; vSide = aSide; vKind = aKind;
  }`,
  /* glsl */ `
  uniform float uNowRel, uFade, uFadeOn, uHz;
  varying float vRel, vLocal, vSide, vKind;
  void main() {
    float age = uNowRel - vRel;
    if (age < 0.0) discard;
    float fade = uFadeOn > 0.5 ? clamp(1.0 - age / uFade, 0.0, 1.0) : 1.0;
    float across = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
    float alpha;
    vec3 color;
    if (vKind < 0.5) {
      float s = vLocal * uHz;                          // dot index since chunk start
      float ds = max(fwidth(s), 1e-6);                 // dots per pixel
      float sideFw = max(fwidth(vSide), 1e-6);         // side units per pixel
      vec2 px = vec2((fract(s) - 0.5) / ds, vSide / sideFw);
      float radius = min(0.4 / ds, 1.0 / sideFw);      // pixels
      float dotMask = 1.0 - smoothstep(radius - 1.0, radius, length(px));
      alpha = mix(dotMask, 0.75 * across, smoothstep(0.3, 0.8, ds));
      color = vec3(0.86, 0.89, 1.0);
    } else {
      float s = vLocal * 0.2;                 // one dash per 5 s of absence
      float ds = fwidth(s);
      float dash = 1.0 - smoothstep(0.5 - ds, 0.5 + ds, fract(s));
      alpha = mix(dash, 0.5, smoothstep(0.3, 0.8, ds)) * across * 0.35;
      color = vec3(0.55, 0.6, 0.72);
    }
    alpha *= fade;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(color, alpha);
  }`,
  { side: THREE.DoubleSide }
)

const pointsMaterial = material(
  /* glsl */ `
  attribute float aBlock, aOffset;
  uniform float uDotWorld, uDpr;
  varying float vFade;
  void main() {
    float rel = relTime(aBlock, aOffset);
    vec4 mv = threadPoint(rel);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uDotWorld / unitsPerPx(mv), 1.0, 12.0) * uDpr;
    vFade = uNowRel - rel < 0.0 ? 0.0 : fadeFor(rel);
  }`,
  /* glsl */ `
  varying float vFade;
  void main() {
    if (vFade < 0.003) discard;
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.7, 1.0, r)) * vFade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(0.86, 0.89, 1.0, a);
  }`
)

const glyphMaterial = material(
  /* glsl */ `
  attribute float aBlock, aOffset, aChar;
  uniform float uGlyphSize, uSideGlyphPx;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float rel = relTime(aBlock, aOffset);
    vec4 mv = threadPoint(rel);
    float upp = unitsPerPx(mv);
    vec2 axis = threadAxis();
    vec2 perp = vec2(-axis.y, axis.x);
    float isDash = step(${(DASH - 0.5).toFixed(1)}, aChar);
    float size = uSideGlyphPx > 0.0 ? uSideGlyphPx * upp : uGlyphSize;
    float legible;
    if (isDash > 0.5) {
      float dash = max(size, 10.0 * upp);
      mv.xy += axis * position.x * dash * 0.5 + perp * position.y * dash * 1.6;
      legible = 1.0;
    } else {
      mv.xy += vec2(position.x * 0.62, position.y + 0.9) * size;
      // live view: hide glyphs too small to read; side view: hide them until
      // keystrokes (at least 0.12 s apart) are far enough apart not to overlap
      legible = uSideGlyphPx > 0.0
        ? smoothstep(0.7, 1.0, (0.12 * uSpeed / upp) / uSideGlyphPx)
        : smoothstep(4.0, 9.0, size / upp);
    }
    gl_Position = projectionMatrix * mv;
    float code = aChar - 32.0;
    float col = mod(code, 16.0);
    float row = floor(code / 16.0);
    vUv = vec2((col + position.x + 0.5) / 16.0, 1.0 - (row + 0.5 - position.y) / 6.0);
    float future = step(0.0, uNowRel - rel + 1e-3);
    vAlpha = fadeFor(rel) * legible * future;
    if (vAlpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`,
  /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float a = texture2D(uAtlas, vUv).a * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(0.95, 0.96, 1.0, a);
  }`
)

// ---------------------------------------------------------------- data

function floatAttr(array, instanced = false) {
  const attr = instanced ? new THREE.InstancedBufferAttribute(array, 1) : new THREE.BufferAttribute(array, 1)
  attr.setUsage(THREE.DynamicDrawUsage)
  return attr
}

// three uploads only the update ranges when any exist, so a range added after a
// full-upload request would silently replace it. Attributes waiting for a full
// upload take no ranges until the next render has uploaded them.
const pendingFullUpload = new Set()

function markRange(attrs, start, count) {
  for (const a of attrs) {
    if (!pendingFullUpload.has(a)) a.addUpdateRange(start, count)
    a.needsUpdate = true
  }
}

function markAll(attrs) {
  for (const a of attrs) {
    a.clearUpdateRanges()
    a.needsUpdate = true
    pendingFullUpload.add(a)
  }
}

// Sessions (kind 0) and gaps (kind 1) as chunks of at most CHUNK seconds.
class Chunks {
  constructor(capacity) {
    const v = capacity * 4
    this.capacity = capacity
    this.block = new Float32Array(v)
    this.offset = new Float32Array(v)
    this.local = new Float32Array(v)
    this.side = new Float32Array(v)
    this.kind = new Float32Array(v)
    const index = new Uint32Array(capacity * 6)
    for (let c = 0; c < capacity; c++) index.set([c * 4, c * 4 + 1, c * 4 + 2, c * 4 + 1, c * 4 + 3, c * 4 + 2], c * 6)
    this.geometry = new THREE.BufferGeometry()
    this.attrs = []
    for (const [name, array] of [['aBlock', this.block], ['aOffset', this.offset], ['aLocal', this.local], ['aSide', this.side], ['aKind', this.kind]]) {
      const attr = floatAttr(array)
      this.geometry.setAttribute(name, attr)
      this.attrs.push(attr)
    }
    this.geometry.setAttribute('position', this.attrs[1]) // three needs one; the shader ignores it
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1))
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    this.mesh = new THREE.Mesh(this.geometry, ribbonMaterial)
    this.mesh.frustumCulled = false
    this.reset()
  }
  reset() {
    this.spans = []
    this.geometry.setDrawRange(0, 0)
  }
  get count() {
    return this.spans.length
  }
  addSpan(start, end, kind) {
    for (let s = start; s < end - 1e-9 || s === start; s += CHUNK) {
      this.push(s, Math.min(end, s + CHUNK), kind)
      if (end - s <= CHUNK) break
    }
  }
  push(start, end, kind) {
    if (this.count >= this.capacity) throw new Error('chunk capacity exceeded')
    this.spans.push({ start, end, kind })
    this.write(this.count - 1)
    this.geometry.setDrawRange(0, this.count * 6)
  }
  write(c) {
    const { start, end, kind } = this.spans[c]
    for (let k = 0; k < 4; k++) {
      const [block, offset] = splitTime(k < 2 ? start : end)
      const v = c * 4 + k
      this.block[v] = block
      this.offset[v] = offset
      this.local[v] = k < 2 ? 0 : end - start
      this.side[v] = k % 2 === 0 ? -1 : 1
      this.kind[v] = kind
    }
    markRange(this.attrs, c * 4, 4)
  }
  extendLast(t) {
    const c = this.count - 1
    const span = this.spans[c]
    if (t - span.start > CHUNK) {
      span.end = span.start + CHUNK
      this.write(c)
      this.push(span.end, t, span.kind)
    } else {
      span.end = t
      this.write(c)
    }
  }
  get lastKind() {
    return this.spans[this.count - 1]?.kind
  }
  bytes() {
    return this.count * 4 * 5 * 4 + this.count * 6 * 4
  }
}

// Every dot as an explicit point.
class Points {
  constructor() {
    this.object = null
    this.count = 0
  }
  allocate(capacity) {
    if (this.object) {
      scene.remove(this.object)
      this.object.geometry.dispose()
    }
    this.capacity = capacity
    this.count = 0
    this.block = new Float32Array(capacity)
    this.offset = new Float32Array(capacity)
    const geometry = new THREE.BufferGeometry()
    this.attrs = [floatAttr(this.block), floatAttr(this.offset)]
    geometry.setAttribute('aBlock', this.attrs[0])
    geometry.setAttribute('aOffset', this.attrs[1])
    geometry.setAttribute('position', this.attrs[1])
    geometry.setDrawRange(0, 0)
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    this.object = new THREE.Points(geometry, pointsMaterial)
    this.object.frustumCulled = false
    this.nextTime = null
  }
  addDots(start, end) {
    const first = Math.ceil(start * HZ)
    const last = Math.floor(end * HZ)
    for (let k = first; k < last && this.count < this.capacity; k++) {
      const [block, offset] = splitTime(k / HZ)
      this.block[this.count] = block
      this.offset[this.count] = offset
      this.count++
    }
    this.nextTime = last / HZ
  }
  appendUntil(t) {
    const before = this.count
    this.addDots(this.nextTime, t)
    if (this.count > before) markRange(this.attrs, before, this.count - before)
    this.object.geometry.setDrawRange(0, this.count)
  }
  bytes() {
    return this.count * 8
  }
}

class Glyphs {
  constructor(capacity) {
    const plane = new THREE.PlaneGeometry(1, 1)
    this.capacity = capacity
    this.block = new Float32Array(capacity)
    this.offset = new Float32Array(capacity)
    this.char = new Float32Array(capacity)
    this.geometry = new THREE.InstancedBufferGeometry()
    this.geometry.index = plane.index
    this.geometry.setAttribute('position', plane.getAttribute('position'))
    this.attrs = [floatAttr(this.block, true), floatAttr(this.offset, true), floatAttr(this.char, true)]
    this.geometry.setAttribute('aBlock', this.attrs[0])
    this.geometry.setAttribute('aOffset', this.attrs[1])
    this.geometry.setAttribute('aChar', this.attrs[2])
    this.mesh = new THREE.Mesh(this.geometry, glyphMaterial)
    this.mesh.frustumCulled = false
    this.reset()
  }
  reset() {
    this.count = 0
    this.geometry.instanceCount = 0
  }
  add(t, code, bulk = false) {
    if (this.count >= this.capacity) return
    const [block, offset] = splitTime(t)
    this.block[this.count] = block
    this.offset[this.count] = offset
    this.char[this.count] = code
    if (!bulk) markRange(this.attrs, this.count, 1)
    this.count++
    this.geometry.instanceCount = this.count
  }
  bytes() {
    return this.count * 12
  }
}

const chunks = new Chunks(8192)
const points = new Points()
const glyphs = new Glyphs(400000)
scene.add(chunks.mesh, glyphs.mesh)

// ---------------------------------------------------------------- history

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SAMPLE_TEXT =
  'ok i need to start writing my notes here, and just make it easier to use. this is a knowledge base as much as obsidian is. threads run through time, one letter at a time. '

// Writing sessions of 2–15 min separated by 1–20 min away; inside a session,
// typing bursts of 5–40 s at 3–8 keys/s separated by 2–30 s pauses.
function generateHistory(hours, continuous = false) {
  const random = mulberry32(7)
  const end = hours * 3600
  const sessions = []
  const keys = []
  let t = 0
  let ci = 0
  while (t < end) {
    const sessionEnd = continuous ? end : Math.min(end, t + 120 + random() * 780)
    sessions.push([t, sessionEnd])
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
  return { sessions, keys, end }
}

// ---------------------------------------------------------------- state

const state = {
  mode: 'procedural',
  load: 'empty',
  view: 'live',
  sideCenter: 0,
  sideSeconds: 60,
  live: true,
  lastKeyAt: 0,
  sweep: null,
  historyEnd: 0,
}

function buildLoad(load, mode = state.mode) {
  const started = performance.now()
  state.load = load
  state.mode = mode
  chunks.reset()
  glyphs.reset()
  const history =
    load === 'empty' ? { sessions: [], keys: [], end: 0 }
    : load === '1h' ? generateHistory(1)
    : load === '8h' ? generateHistory(8)
    : generateHistory(8, true)

  if (mode === 'points') {
    const dots = history.sessions.reduce((n, [s, e]) => n + (e - s) * HZ, 0)
    points.allocate(Math.ceil(dots) + 3600 * HZ)
    scene.add(points.object)
    chunks.mesh.visible = false
  } else if (points.object) {
    scene.remove(points.object)
    points.object.geometry.dispose()
    points.object = null
    chunks.mesh.visible = true
  } else {
    chunks.mesh.visible = true
  }

  let previousEnd = null
  for (const [s, e] of history.sessions) {
    if (previousEnd !== null) {
      chunks.addSpan(previousEnd, s, 1)
      glyphs.add(s, DASH, true)
    }
    chunks.addSpan(s, e, 0)
    if (mode === 'points') points.addDots(s, e)
    glyphs.add(e, DASH, true)
    previousEnd = e
  }
  for (let i = 0; i < history.keys.length; i += 2) glyphs.add(history.keys[i], history.keys[i + 1], true)

  // Continue live from the end of the history: close any gap, time back in.
  const t0 = history.end
  if (previousEnd !== null && previousEnd < t0) chunks.addSpan(previousEnd, t0, 1)
  if (previousEnd !== null) glyphs.add(t0, DASH, true)
  chunks.push(t0, t0, 0)
  if (mode === 'points') {
    points.nextTime = t0
    points.object.geometry.setDrawRange(0, points.count)
    markAll(points.attrs)
  }
  markAll(chunks.attrs)
  markAll(glyphs.attrs)

  resetClock(t0)
  state.history = history
  state.historyEnd = t0
  state.live = true
  state.lastKeyAt = performance.now()
  state.sideCenter = t0 / 2
  state.sideSeconds = Math.max(60, t0 * 1.05)
  const buildMs = performance.now() - started
  event('load', { load, mode, buildMs, chunks: chunks.count, glyphs: glyphs.count, dots: dotCount() })
  return buildMs
}

function dotCount() {
  if (state.mode === 'points') return points.count
  return Math.round(chunks.spans.reduce((n, s) => n + (s.kind === 0 ? (s.end - s.start) * HZ : 0), 0))
}

function gpuBufferBytes() {
  return (state.mode === 'points' ? points.bytes() : chunks.bytes()) + glyphs.bytes()
}

function typeKey(code) {
  const t = now()
  if (!state.live) {
    chunks.extendLast(t)
    glyphs.add(t, DASH)
    chunks.push(t, t, 0)
    if (state.mode === 'points') points.nextTime = t
    state.live = true
    event('time-in', { t })
  }
  glyphs.add(t, code)
  state.lastKeyAt = performance.now()
}

function tick() {
  const t = now()
  if (state.live && (performance.now() - state.lastKeyAt) / 1000 > IDLE_TIMEOUT) {
    chunks.extendLast(t)
    if (state.mode === 'points') points.appendUntil(t)
    glyphs.add(t, DASH)
    chunks.push(t, t, 1)
    state.live = false
    event('time-out', { t })
  }
  chunks.extendLast(t)
  if (state.live && state.mode === 'points') points.appendUntil(t)
  if (state.sweep) {
    const p = Math.min(1, Math.max(0, (performance.now() - state.sweep.startedAt) / state.sweep.ms))
    state.sideSeconds = state.sweep.from * Math.pow(state.sweep.to / state.sweep.from, p)
  }
}

function setOrigin(t) {
  const [block, offset] = splitTime(t)
  uniforms.uOriginBlock.value = block
  uniforms.uOriginOffset.value = offset
  return t
}

function updateCamera() {
  const t = now()
  let origin
  if (state.view === 'live') {
    origin = setOrigin(t)
    camera = persp
    persp.position.set(0.35, 0.28, -1.2)
    persp.lookAt(0, 0, 6)
    uniforms.uOrtho.value = 0
    uniforms.uPixelScale.value = (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2))) / innerHeight
    uniforms.uFadeOn.value = 1
    uniforms.uSideGlyphPx.value = 0
  } else {
    origin = setOrigin(state.sideCenter)
    camera = ortho
    const half = (state.sideSeconds * SPEED) / 2
    const halfHeight = (half * innerHeight) / innerWidth
    Object.assign(ortho, { left: -half, right: half, top: halfHeight, bottom: -halfHeight })
    ortho.updateProjectionMatrix()
    ortho.position.set(10, 0, 0)
    ortho.up.set(0, 1, 0)
    ortho.lookAt(0, 0, 0)
    uniforms.uOrtho.value = 1
    uniforms.uPixelScale.value = (2 * half) / innerWidth
    uniforms.uFadeOn.value = 0
    uniforms.uSideGlyphPx.value = 14
  }
  uniforms.uNowRel.value = t - origin
}

// ---------------------------------------------------------------- stats

const hudStats = { intervals: [], work: [] }
const benchStats = { collect: false, intervals: [], work: [] }
let lastFrame = 0

function percentile(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0
}

function summarize(intervals, work) {
  const i = [...intervals].sort((a, b) => a - b)
  const w = [...work].sort((a, b) => a - b)
  const median = percentile(i, 0.5)
  return {
    frames: i.length,
    fps: median ? 1000 / median : 0,
    frameMedian: median,
    frameP95: percentile(i, 0.95),
    frameP99: percentile(i, 0.99),
    frameWorst: i[i.length - 1] || 0,
    dropRate: i.length ? i.filter((x) => x > 25).length / i.length : 0,
    workMedian: percentile(w, 0.5),
    workP95: percentile(w, 0.95),
  }
}

const hud = document.getElementById('hud')
function drawHud() {
  if (hudStats.intervals.length % 15 !== 0) return
  const s = summarize(hudStats.intervals, hudStats.work)
  const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) : '?'
  hud.textContent =
    `mode ${state.mode}   load ${state.load}   view ${state.view}   ${state.live ? 'LIVE' : 'timed out'}\n` +
    `fps ${s.fps.toFixed(1)}   p95 ${s.frameP95.toFixed(1)} ms   work ${s.workMedian.toFixed(2)} ms (p95 ${s.workP95.toFixed(2)})\n` +
    `dots ${dotCount().toLocaleString()}   glyphs ${glyphs.count.toLocaleString()}   chunks ${chunks.count}   ` +
    `gpu buffers ${(gpuBufferBytes() / 1048576).toFixed(1)} MB   js heap ${mem} MB\n` +
    `thread time ${formatDuration(now())}   side window ${formatDuration(state.sideSeconds)}\n\n` +
    `type to write · Tab live/side view · wheel zoom, drag pan (side)\n` +
    `Ctrl+1 empty · Ctrl+2 1 h · Ctrl+3 8 h · Ctrl+4 8 h continuous · Ctrl+M procedural/points`
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = (seconds % 60).toFixed(1)
  return `${h}h ${String(m).padStart(2, '0')}m ${s.padStart(4, '0')}s`
}

function frame(timestamp) {
  if (lastFrame) {
    const interval = timestamp - lastFrame
    hudStats.intervals.push(interval)
    if (benchStats.collect) benchStats.intervals.push(interval)
  }
  lastFrame = timestamp
  const started = performance.now()
  tick()
  updateCamera()
  renderer.render(scene, camera)
  pendingFullUpload.clear()
  if (BENCH) gl.finish() // make work time include the GPU
  const work = performance.now() - started
  hudStats.work.push(work)
  if (benchStats.collect) benchStats.work.push(work)
  if (hudStats.intervals.length > 240) {
    hudStats.intervals.splice(0, 120)
    hudStats.work.splice(0, 120)
  }
  drawHud()
  requestAnimationFrame(frame)
}

// ---------------------------------------------------------------- input

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight)
  persp.aspect = innerWidth / innerHeight
  persp.updateProjectionMatrix()
})

const SCRIPTED = BENCH || SHOTS

addEventListener('keydown', (e) => {
  if (SCRIPTED) return
  if (e.ctrlKey || e.metaKey) {
    const loads = { 1: 'empty', 2: '1h', 3: '8h', 4: '8h-continuous' }
    if (loads[e.key]) buildLoad(loads[e.key])
    if (e.key === 'm') buildLoad(state.load, state.mode === 'procedural' ? 'points' : 'procedural')
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    state.view = state.view === 'live' ? 'side' : 'live'
    state.sweep = null
    if (state.view === 'side') {
      state.sideSeconds = Math.max(60, now() * 1.05)
      state.sideCenter = now() / 2
    }
    return
  }
  if (e.key.length === 1) {
    const code = e.key.charCodeAt(0)
    typeKey(code >= 32 && code < DASH ? code : 63)
  }
})

let drag = null
addEventListener('pointerdown', (e) => (drag = { x: e.clientX }))
addEventListener('pointerup', () => (drag = null))
addEventListener('pointermove', (e) => {
  if (SCRIPTED || !drag || state.view !== 'side') return
  state.sideCenter -= ((e.clientX - drag.x) / innerWidth) * state.sideSeconds
  drag.x = e.clientX
})
addEventListener('wheel', (e) => {
  if (SCRIPTED || state.view !== 'side') return
  state.sweep = null
  state.sideSeconds = Math.min(Math.max(1, state.sideSeconds * Math.exp(e.deltaY * 0.002)), Math.max(60, now() * 1.2))
})

function writeResult(name, data) {
  const dir = path.join(SPIKE_DIR, 'results')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  return file
}

document.getElementById('export').addEventListener('click', () => {
  const file = writeResult('interactive', { log, current: summarize(hudStats.intervals, hudStats.work) })
  event('export', { file })
})

// ---------------------------------------------------------------- bench

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function runBench() {
  const results = []
  let typing = setInterval(() => typeKey(SAMPLE_TEXT.charCodeAt(Math.floor(Math.random() * SAMPLE_TEXT.length))), 200)
  for (const mode of ['procedural', 'points']) {
    for (const load of ['empty', '1h', '8h', '8h-continuous']) {
      const buildMs = buildLoad(load, mode)
      for (const view of ['live', 'side-full', 'side-sweep']) {
        state.sweep = null
        if (view === 'live') state.view = 'live'
        else {
          state.view = 'side'
          const total = Math.max(60, now())
          state.sideCenter = view === 'side-full' ? total / 2 : Math.max(5, state.historyEnd * 0.37)
          state.sideSeconds = total * 1.05
          if (view === 'side-sweep') state.sweep = { from: total * 1.05, to: 8, ms: 5000, startedAt: performance.now() + 1000 }
        }
        await wait(1000)
        benchStats.intervals = []
        benchStats.work = []
        benchStats.collect = true
        await wait(4000)
        benchStats.collect = false
        const memory = await process.getProcessMemoryInfo()
        const result = {
          mode, load, view, buildMs,
          ...summarize(benchStats.intervals, benchStats.work),
          privateMB: memory.private / 1024,
          jsHeapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
          gpuBufferMB: gpuBufferBytes() / 1048576,
          dots: dotCount(),
          glyphs: glyphs.count,
          chunks: chunks.count,
        }
        results.push(result)
        event('bench-step', result)
      }
    }
  }
  clearInterval(typing)
  const file = writeResult('bench', { log, results })
  ipcRenderer.send('bench-done', { file, results })
}

// ---------------------------------------------------------------- screenshots

// Captures the views whose correctness a frame rate can't show: 8 h precision,
// dots collapsing into a line, glyph placement, dashes. Compare near t = 0
// (empty) with near t = 8 h (8h-continuous) at the same zoom.
async function runShots() {
  const shots = [
    { name: 'a-procedural-8hc-live', load: '8h-continuous', mode: 'procedural', view: 'live' },
    { name: 'b-procedural-8hc-side-full', load: '8h-continuous', mode: 'procedural', view: 'side', seconds: 'full' },
    { name: 'c-procedural-8h-side-40min', load: '8h', mode: 'procedural', view: 'side', seconds: 2400, center: 'third' },
    { name: 'd-procedural-8hc-side-20s', load: '8h-continuous', mode: 'procedural', view: 'side', seconds: 20, center: 'end' },
    { name: 'e-procedural-8hc-side-1s', load: '8h-continuous', mode: 'procedural', view: 'side', seconds: 1, center: 'end' },
    { name: 'f-procedural-empty-side-1s', load: 'empty', mode: 'procedural', view: 'side', seconds: 1, center: 'end' },
    { name: 'g-points-8hc-side-1s', load: '8h-continuous', mode: 'points', view: 'side', seconds: 1, center: 'end' },
    { name: 'h-procedural-1h-side-6s-letters', load: '1h', mode: 'procedural', view: 'side', seconds: 6, center: 'keys' },
  ]
  const typing = setInterval(() => typeKey(SAMPLE_TEXT.charCodeAt(Math.floor(Math.random() * SAMPLE_TEXT.length))), 180)
  const files = []
  for (const shot of shots) {
    if (state.load !== shot.load || state.mode !== shot.mode) buildLoad(shot.load, shot.mode)
    state.sweep = null
    state.view = shot.view
    await wait(3000) // let a few seconds of live thread and typing accumulate
    if (shot.view === 'side') {
      const total = Math.max(60, now())
      state.sideSeconds = shot.seconds === 'full' ? total * 1.05 : shot.seconds
      const keys = state.history.keys
      state.sideCenter =
        shot.seconds === 'full' ? total / 2
        : shot.center === 'end' ? now() - shot.seconds * 0.45
        : shot.center === 'keys' ? keys[2 * Math.floor(keys.length / 4)]
        : total / 3
    }
    await wait(700)
    files.push(await ipcRenderer.invoke('capture', shot.name))
    event('shot', { ...shot, file: files.at(-1), t: now() })
  }
  clearInterval(typing)
  writeResult('shots', { log })
  ipcRenderer.send('shots-done', files)
}

buildLoad('empty')
requestAnimationFrame(frame)
if (BENCH) setTimeout(runBench, 1500)
if (SHOTS) setTimeout(runShots, 1500)
