/**
 * The bench page's script: exercises the real production stage modules
 * (`Ribbon`, `GlyphLayer`, `GlyphCache`, `createLiveView`, the shared stage
 * renderer singleton) exactly as `ThreadOverlay.tsx` does, against seeded
 * synthetic history, so the measured numbers are about the shipping code —
 * never a reimplementation for the bench alone.
 *
 * Loaded through a Vite dev server (`thread-bench.cjs`), the same pattern
 * CONVENTIONS.md documents for spike 005: "a spike that must load the
 * app's own TSX runs a spike-local Vite dev server ... copying the
 * components instead would test a replica rather than the app."
 */
import * as THREE from 'three'
import { Ribbon, SPEED, clearPendingFullUpload, createStageUniforms, setOrigin } from '../../src/renderer/threads/stage/ribbon'
import { GlyphLayer } from '../../src/renderer/threads/stage/glyphs'
import { getGlyphCache } from '../../src/renderer/threads/stage/glyph-cache'
import { MarkerLayer, type MarkerKind } from '../../src/renderer/threads/stage/markers'
import { createLiveView, type LiveViewHandle } from '../../src/renderer/threads/stage/live-view'
import { getStageRenderer } from '../../src/renderer/threads/stage/renderer'
import { readStageTokens } from '../../src/renderer/threads/stage/tokens'
import { defaultThreadFrame } from '../../src/shared/threads/settings'

interface SyntheticHistory {
  sessions: [number, number][]
  keys: [number, string][]
  end: number
}

interface EditedStretchHistory {
  keys: [number, string, number | null][]
  markers: [number, MarkerKind][]
  end: number
}

// `synthetic-history.cjs` is CommonJS (Node's `require`, used directly by
// `thread-bench.cjs`'s Electron main process) -- rather than importing it
// into this browser-loaded ES module (Vite does not rewrite an arbitrary
// user `.cjs` file's `module.exports` into an ESM import), the bench window
// asks main for the generated history over IPC, the same pattern every
// spike launcher already uses for `capture`/`write-result` (002-shared's
// `launch.cjs`). `nodeIntegration: true` on this bench-only window (never
// shipped) is what makes `window.require('electron')` available here.
const { ipcRenderer } = (window as unknown as { require(id: 'electron'): { ipcRenderer: import('electron').IpcRenderer } }).require(
  'electron',
)

function generateHistory(hours: number, continuous: boolean): Promise<SyntheticHistory> {
  return ipcRenderer.invoke('bench-generate-history', hours, continuous) as Promise<SyntheticHistory>
}

function generateEditedStretch(): Promise<EditedStretchHistory> {
  return ipcRenderer.invoke('bench-generate-edited-stretch') as Promise<EditedStretchHistory>
}

interface FrameStats {
  frames: number
  fps: number
  frameMedian: number
  frameP95: number
  frameP99: number
  frameWorst: number
  dropRate: number
  workMedian: number
  workP95: number
}

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0
}

function summarize(intervals: number[], work: number[]): FrameStats {
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

const scene = new THREE.Scene()
const rendererHandle = getStageRenderer()
if (!rendererHandle) throw new Error('bench: WebGL unavailable')
const container = document.getElementById('stage') as HTMLDivElement
rendererHandle.attach(container)
rendererHandle.resize(container.clientWidth, container.clientHeight, window.devicePixelRatio)

const tokens = readStageTokens()
const uniforms = createStageUniforms(tokens)
const ribbon = new Ribbon(1 << 16)
ribbon.setUniforms(uniforms)
const glyphs = new GlyphLayer(1 << 18)
glyphs.setUniforms(uniforms)
const markers = new MarkerLayer(256)
markers.setUniforms(uniforms)
scene.add(ribbon.mesh, glyphs.mesh, markers.mesh)
const cache = getGlyphCache()

let liveView: LiveViewHandle = createLiveView(uniforms)
liveView.applyFrame(defaultThreadFrame(0, 0))
liveView.resize(container.clientWidth, container.clientHeight)

// A debug side-facing orthographic camera, used only for the
// `buildEditedStretch` `--shots` screenshots: no side view exists yet in
// the production app (a later plan's job), and the live view's own camera
// is deliberately built to show only the last second or two close-up,
// letting everything older recede toward a vanishing point (D-14) --
// exactly right for an hours-long thread, but useless for reviewing a
// short edited stretch. `focusDebugCamera` frames a `windowSeconds`-wide
// span centered on `centerSeconds`, in world units, so the caller can
// either see the whole stretch at once (its ribbon/dots/markers, at the
// live view's own legibility gate -- letters read small) or zoom in on one
// moment (letters legible) by choosing a narrower window.
const debugSideCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
let useDebugSideCamera = false

function focusDebugCamera(centerSeconds: number, windowSeconds: number): void {
  // The floating origin (ribbon.ts's setOrigin) may have advanced far ahead
  // from an earlier buildLoad() call's own liveView.tick() ticks; this
  // camera positions everything in raw world coordinates (not "distance
  // from now"), so it needs the origin pinned back at the stretch's own
  // start (block 0, offset 0) or content computed against a stale, far-
  // advanced origin would render nowhere near this frustum.
  setOrigin(uniforms, 0)
  const halfWidth = (windowSeconds * SPEED) / 2
  const aspect = container.clientWidth / Math.max(1, container.clientHeight)
  const halfHeight = halfWidth / aspect
  debugSideCamera.left = -halfWidth
  debugSideCamera.right = halfWidth
  debugSideCamera.top = halfHeight
  debugSideCamera.bottom = -halfHeight
  // Content advances along world -Z (the D-27 default `direction`), never
  // X, so the camera looks along X at a fixed Z centered on the stretch --
  // Z lands on the image's horizontal axis, Y (glyph height) on its
  // vertical axis.
  const centerZ = -centerSeconds * SPEED
  debugSideCamera.position.set(5, 0.35, centerZ)
  debugSideCamera.up.set(0, 1, 0)
  debugSideCamera.lookAt(0, 0.35, centerZ)
  debugSideCamera.updateProjectionMatrix()
  uniforms.uOrtho.value = 1
  uniforms.uPixelScale.value = (2 * halfWidth) / Math.max(1, container.clientWidth)
  // Past "now" enough that every fixed-time letter/marker in the stretch
  // passes the future() gate; never advanced again while this camera is
  // active, unlike the live view's own continuously-ticking uNowRel.
  uniforms.uNowRel.value = centerSeconds + windowSeconds
  useDebugSideCamera = true
}

let historyEnd = 0
let collecting = false
const collected = { intervals: [] as number[], work: [] as number[] }
let lastFrameTime = 0

function frame(timestamp: number): void {
  if (lastFrameTime) {
    const interval = timestamp - lastFrameTime
    if (collecting) collected.intervals.push(interval)
  }
  lastFrameTime = timestamp
  const started = performance.now()

  const nowSeconds = historyEnd + (performance.now() - buildFinishedAtMs) / 1000
  glyphs.syncAtlasTextures(cache)
  if (useDebugSideCamera) {
    rendererHandle!.renderer.render(scene, debugSideCamera)
  } else {
    ribbon.extendLast(nowSeconds)
    liveView.tick(nowSeconds)
    rendererHandle!.renderer.render(scene, liveView.camera)
  }
  clearPendingFullUpload()

  const work = performance.now() - started
  if (collecting) collected.work.push(work)
  requestAnimationFrame(frame)
}

let buildFinishedAtMs = performance.now()

async function buildLoad(hours: number, continuous: boolean): Promise<{ buildMs: number; dots: number; glyphs: number }> {
  const history = await generateHistory(hours, continuous)
  const started = performance.now()
  useDebugSideCamera = false
  uniforms.uOrtho.value = 0
  ribbon.reset()
  glyphs.reset()
  markers.reset()

  let previousEnd: number | null = null
  for (const [s, e] of history.sessions) {
    if (previousEnd !== null) ribbon.addSpan(previousEnd, s, 1)
    ribbon.addSpan(s, e, 0)
    previousEnd = e
  }
  const t0 = history.end
  if (previousEnd !== null && previousEnd < t0) ribbon.addSpan(previousEnd, t0, 1)
  ribbon.addSpan(t0, t0, 0)

  for (const [t, grapheme] of history.keys) {
    glyphs.add(rendererHandle!.renderer, cache, t, grapheme, { bulk: true })
  }
  glyphs.markBulkUploaded()
  cache.markPagesClean()

  historyEnd = t0
  buildFinishedAtMs = performance.now()
  const buildMs = performance.now() - started
  return { buildMs, dots: Math.round(history.sessions.reduce((n, [s, e]) => n + (e - s) * 60, 0)), glyphs: glyphs.instanceCount }
}

/**
 * Builds the short, heavily-edited stretch (`--shots` only, never
 * `--bench`): ghosts (deleted/undone letters, faded and struck) and every
 * marker kind (deletion, undo, paste, format, link), so a screenshot can be
 * reviewed by eye for D-02..D-05's own acceptance criteria. Frames the
 * whole stretch at once (the ribbon/dots/markers read; letters read small,
 * the live-view legibility gate's own tradeoff at this zoom) -- the caller
 * follows up with `focusDebugCamera` for a legible close-up on each moment.
 */
async function buildEditedStretch(): Promise<{ end: number; markers: [number, MarkerKind][] }> {
  const history = await generateEditedStretch()
  ribbon.reset()
  glyphs.reset()
  markers.reset()

  ribbon.addSpan(0, history.end, 0)

  for (const [t, grapheme, deletedAt] of history.keys) {
    glyphs.add(rendererHandle!.renderer, cache, t, grapheme, {
      bulk: true,
      deletedAtMs: deletedAt ?? undefined,
    })
  }
  glyphs.markBulkUploaded()

  for (const [t, kind] of history.markers) markers.add(t, kind, { bulk: true })
  markers.markBulkUploaded()

  cache.markPagesClean()
  historyEnd = history.end
  buildFinishedAtMs = performance.now()
  focusDebugCamera(history.end / 2, history.end + 3)
  return { end: history.end, markers: history.markers }
}

function bytesOf(): number {
  return ribbon.bytes() + glyphs.bytes() + markers.bytes()
}

declare global {
  interface Window {
    __bench: {
      buildLoad: typeof buildLoad
      buildEditedStretch: typeof buildEditedStretch
      focusDebugCamera: typeof focusDebugCamera
      startCollecting: () => void
      stopCollecting: () => FrameStats
      gpuBufferMB: () => number
      memory: () => Promise<{ privateMB: number }>
      ready: boolean
    }
  }
}

window.__bench = {
  buildLoad,
  buildEditedStretch,
  focusDebugCamera,
  startCollecting() {
    collected.intervals = []
    collected.work = []
    collecting = true
  },
  stopCollecting() {
    collecting = false
    return summarize(collected.intervals, collected.work)
  },
  gpuBufferMB() {
    return bytesOf() / 1048576
  },
  async memory() {
    // nodeIntegration is enabled for this bench window only (never shipped)
    // so `process.getProcessMemoryInfo()` is available directly, matching
    // spike 001's own measurement path.
    const proc = (window as unknown as { process?: { getProcessMemoryInfo(): Promise<{ private: number }> } }).process
    if (!proc) return { privateMB: 0 }
    const info = await proc.getProcessMemoryInfo()
    return { privateMB: info.private / 1024 }
  },
  ready: true,
}

requestAnimationFrame(frame)
