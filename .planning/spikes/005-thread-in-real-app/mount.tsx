// @ts-nocheck
// Spike 005 — mounts the app's REAL canvas, not a replica.
//
// Canvas.tsx, NoteCard.tsx and App.css are imported straight from
// app/src/renderer. Nothing in app/ is modified: this page supplies the props
// App.tsx would normally supply, so the components run exactly as they ship.
import React, { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import 'prosemirror-view/style/prosemirror.css'
import '../../../app/src/renderer/App.css'
import Canvas from '../../../app/src/renderer/components/Canvas'
// threadApi is read through the module namespace, never as a bound import: it is
// reassigned when a thread opens or closes, and a named import would freeze the
// value captured at module evaluation.
import ThreadLayer, { contexts } from './thread-layer'
import * as layerModule from './thread-layer'

const { ipcRenderer } = window.require('electron')
const params = new URLSearchParams(location.search)
const BENCH = params.get('bench') === '1'
const SHOTS = params.get('shots') === '1'
const SCRIPTED = BENCH || SHOTS

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// The launcher forwards page console messages at level >= 2, so progress and
// failures are reported through console.error. Without this an async scripted
// step that throws becomes an unhandled rejection: Electron does not surface it
// as a console message, and the run idles silently until the timeout.
const step = (msg) => console.error('[step]', msg)
addEventListener('error', (e) => console.error('[page error]', e.message, e.filename, e.lineno))
addEventListener('unhandledrejection', (e) =>
  console.error('[unhandled rejection]', String((e.reason && e.reason.stack) || e.reason))
)
const TYPE_TEXT = 'writing into the thread while the real canvas sits behind it, to see whether the app keeps up. '

// NoteCard never touches window.tapestry (App.tsx owns every IPC call), but the
// stub keeps any stray access from throwing.
window.tapestry = window.tapestry ?? {
  kernel: { submit: async () => ({ seq: 0, digest: '', nodeIds: [], edgeIds: [] }) },
  plugins: { getContributions: async () => ({ nodeViews: {}, commands: {}, propertyPanels: {}, inspectors: {} }) },
}

const NOTE_TYPE = 'tapestry.notes/note@1'
const doc = (text) =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

const NOTE_TEXTS = [
  'Threads run through time, one letter at a time.',
  'A session runs from a time-in to a time-out.',
  'Nothing on the line is erased.',
  'The line stays honest about time, even across weeks.',
  'Dots are drawn from time × speed, never stored.',
  'Letters stay sharp at any zoom.',
  'Gravity is enough to navigate between them.',
  'The typer sits on top; the line runs into depth.',
  'Two strands twisted together, one per author.',
  'Clicking any point shows the document at that moment.',
  'Store sessions and keystrokes, never dots.',
  'The canvas dims behind the open thread.',
]

function makeNotes(n) {
  const nodes = []
  for (let i = 0; i < n; i++) {
    const text = NOTE_TEXTS[i % NOTE_TEXTS.length]
    nodes.push({
      id: `n${i + 1}`,
      type: NOTE_TYPE,
      props: {
        'position.x': { type: 'real', value: 80 + (i % 4) * 300 },
        'position.y': { type: 'real', value: 70 + Math.floor(i / 4) * 190 },
        body: { type: 'text', value: doc(text) },
        title: { type: 'text', value: text.slice(0, 22) },
      },
    })
  }
  return nodes
}

function frameSummary(intervals) {
  const i = [...intervals].sort((a, b) => a - b)
  const at = (p) => (i.length ? i[Math.min(i.length - 1, Math.floor(i.length * p))] : 0)
  return {
    frames: i.length,
    fps: at(0.5) ? 1000 / at(0.5) : 0,
    frameP95: at(0.95),
    frameMax: i.length ? i[i.length - 1] : 0,
    dropRate: i.length ? i.filter((x) => x > 25).length / i.length : 0,
  }
}

// ---------------------------------------------------------------------------
// Frame sampling runs for the whole page, so "canvas only" and "thread open"
// are measured the same way.
// ---------------------------------------------------------------------------
// `recent` always fills, so the HUD shows a live frame rate in interactive mode;
// `intervals` fills only inside a measured window.
const sampler = { recent: [], intervals: [], collect: false, last: 0 }
;(function tick(ts) {
  if (sampler.last) {
    const interval = ts - sampler.last
    sampler.recent.push(interval)
    if (sampler.recent.length > 240) sampler.recent.splice(0, 120)
    if (sampler.collect) sampler.intervals.push(interval)
  }
  sampler.last = ts
  requestAnimationFrame(tick)
})(performance.now())

async function measure(ms, during) {
  sampler.intervals = []
  sampler.collect = true
  const done = during ? during() : wait(ms)
  await done
  sampler.collect = false
  return frameSummary(sampler.intervals)
}

function App() {
  const [nodes, setNodes] = useState(() => makeNotes(12))
  const [edges] = useState([])
  const [editingNodeId, setEditingNodeId] = useState(null)
  const [threadOpen, setThreadOpen] = useState(false)
  const hudRef = useRef(null)

  useEffect(() => {
    document.body.classList.toggle('thread-open', threadOpen)
  }, [threadOpen])

  // Ctrl+T opens and closes the thread by hand.
  useEffect(() => {
    const onKey = (e) => {
      if (SCRIPTED || !e.ctrlKey || e.key !== 't') return
      e.preventDefault()
      setThreadOpen((v) => !v)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    window.__spike = { setThreadOpen, setNodes }
  }, [])

  // HUD
  useEffect(() => {
    const id = setInterval(() => {
      const f = frameSummary(sampler.recent)
      const api = layerModule.threadApi
      const st = api ? api.thread.stats() : null
      hudRef.current.textContent =
        `Spike 005 — the thread inside the app's real canvas\n` +
        `notes ${nodes.length}   thread ${threadOpen ? 'open' : 'closed'}   ` +
        `GL contexts created ${contexts.created} / disposed ${contexts.disposed} / forced ${contexts.forced} / unexpectedly lost ${contexts.lost}\n` +
        (st ? `glyphs ${st.glyphs.toLocaleString()}   atlas ${st.atlasCells}/1024   letters typed ${api.thread.state.letters}\n` : '') +
        `fps ${f.fps.toFixed(1)}   p95 ${f.frameP95.toFixed(1)} ms\n\n` +
        `Ctrl+T open / close the thread · drag to pan · pinch to zoom · double-click for a new note`
    }, 250)
    return () => clearInterval(id)
  }, [nodes.length, threadOpen])

  const noop = useCallback(() => {}, [])
  const onSave = useCallback(async () => {}, [])
  const onPositionChange = useCallback((id, x, y) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, props: { ...n.props, 'position.x': { type: 'real', value: x }, 'position.y': { type: 'real', value: y } } }
          : n
      )
    )
  }, [])
  const onCanvasDoubleClick = useCallback((x, y) => {
    setNodes((prev) => [
      ...prev,
      {
        id: `n${prev.length + 1}`,
        type: NOTE_TYPE,
        props: {
          'position.x': { type: 'real', value: x },
          'position.y': { type: 'real', value: y },
          body: { type: 'text', value: doc('') },
          title: { type: 'text', value: '' },
        },
      },
    ])
  }, [])

  return (
    <div className="tapestry-app">
      {threadOpen && <ThreadLayer load="8h" />}
      <Canvas
        nodes={nodes}
        edges={edges}
        editingNodeId={editingNodeId}
        isFileLoaded={true}
        pluginNodeViews={{ [NOTE_TYPE]: 'NoteView' }}
        onStartEditing={setEditingNodeId}
        onStopEditing={() => setEditingNodeId(null)}
        onCanvasDoubleClick={onCanvasDoubleClick}
        onSave={onSave}
        onMarkDirty={noop}
        onMarkClean={noop}
        onPositionChange={onPositionChange}
        onWidthChange={noop}
        onHeightChange={noop}
        onPinnedPositionChange={noop}
        onEdgeCreate={noop}
        onDeleteNote={(id) => setNodes((prev) => prev.filter((n) => n.id !== id))}
      />
      <div id="hud" ref={hudRef} style={{ position: 'fixed' }} />
    </div>
  )
}

// The app's own entry point wraps <App> in StrictMode, so this does too: the
// deliberate double mount is what proves the thread's cleanup is real.
const root = createRoot(document.getElementById('root'))
root.render(
  <StrictMode>
    <App />
  </StrictMode>
)

// ---------------------------------------------------------------------------
// Scripted runs
// ---------------------------------------------------------------------------

const sendInput = (events) => ipcRenderer.invoke('send-input', events)

async function panCanvas(seconds) {
  const y = innerHeight - 120
  const until = performance.now() + seconds * 1000
  await sendInput([{ type: 'mouseDown', x: 700, y, button: 'left', clickCount: 1 }])
  let i = 0
  while (performance.now() < until) {
    const x = 700 + Math.round(180 * Math.sin(i / 8))
    await sendInput([{ type: 'mouseMove', x, y: y - Math.round(60 * Math.cos(i / 11)), button: 'left' }])
    await wait(16)
    i++
  }
  await sendInput([{ type: 'mouseUp', x: 700, y, button: 'left', clickCount: 1 }])
}

async function zoomCanvas(seconds) {
  const until = performance.now() + seconds * 1000
  let i = 0
  while (performance.now() < until) {
    await sendInput([
      { type: 'mouseWheel', x: 700, y: innerHeight - 140, deltaX: 0, deltaY: i % 40 < 20 ? -30 : 30, modifiers: ['control'], canScroll: true },
    ])
    await wait(16)
    i++
  }
}

async function typeFor(cps, seconds) {
  const gap = 1000 / cps
  const until = performance.now() + seconds * 1000
  let i = 0
  while (performance.now() < until) {
    const ch = TYPE_TEXT[i++ % TYPE_TEXT.length]
    await sendInput([{ type: 'keyDown', keyCode: ch }, { type: 'char', keyCode: ch }, { type: 'keyUp', keyCode: ch }])
    await wait(gap)
  }
}

async function ready() {
  // React must have mounted and run its effects before the scripted runner can
  // drive it; window.__spike is assigned in an effect, not at module scope.
  for (let i = 0; i < 200 && !window.__spike; i++) await wait(50)
  if (!window.__spike) throw new Error('React never mounted: window.__spike undefined after 10 s')
}

async function openThread() {
  await ready()
  window.__spike.setThreadOpen(true)
  for (let i = 0; i < 200 && !layerModule.threadApi; i++) await wait(50)
  if (!layerModule.threadApi) throw new Error('thread never became ready after 10 s')
  await wait(300)
}

async function closeThread() {
  window.__spike.setThreadOpen(false)
  await wait(200)
}

async function runBench() {
  await wait(1200)
  const results = []
  const row = async (phase, fn) => {
    const memBefore = await ipcRenderer.invoke('memory')
    const f = await measure(0, fn)
    const privateMB = await ipcRenderer.invoke('memory')
    results.push({ phase, ...f, privateMB, memDeltaMB: privateMB - memBefore, glCreated: contexts.created, glDisposed: contexts.disposed, glLost: contexts.lost })
  }

  // Baseline: the app's canvas alone, no thread. Every thread-open phase needs a
  // matching baseline, or a hitch in the app's own CSS-transform zoom gets
  // blamed on the thread. The first run measured idle and pan but not zoom, and
  // zoom was the only phase that dropped frames — unattributable without this.
  await row('canvas-only-idle', () => wait(4000))
  await row('canvas-only-pan', () => panCanvas(4))
  await row('canvas-only-zoom', () => zoomCanvas(4))

  await openThread()
  await row('thread-open-idle', () => wait(4000))
  await row('thread-open-pan', () => panCanvas(4))
  await row('thread-open-zoom', () => zoomCanvas(4))

  layerModule.threadApi?.focus()
  await wait(200)
  await row('thread-open-typing-20cps', () => typeFor(20, 5))

  // The leak test: twenty open/close cycles. A browser allows only a handful of
  // live WebGL contexts, so an unreleased one shows up as a lost context or a
  // thread that stops drawing.
  await closeThread()
  const before = { created: contexts.created, disposed: contexts.disposed }
  for (let i = 0; i < 20; i++) {
    await openThread()
    await closeThread()
  }
  await openThread()
  await row('after-20-open-close', () => wait(3000))
  const cycles = {
    created: contexts.created - before.created,
    disposed: contexts.disposed - before.disposed,
    lost: contexts.lost,
    stillDrawing: !!layerModule.threadApi,
    glyphsAfter: layerModule.threadApi?.thread.stats().glyphs ?? 0,
  }

  const file = await ipcRenderer.invoke('write-result', { name: 'bench', data: { results, cycles } })
  const pad = (v, n) => String(v).padEnd(n)
  const lines = [
    `Results written to ${file}`,
    '',
    pad('phase', 26) + pad('fps', 7) + pad('p95 ms', 9) + pad('max ms', 9) + pad('drop%', 8) + pad('privMB', 8) + 'GL c/d/lost',
  ]
  for (const r of results) {
    lines.push(
      pad(r.phase, 26) + pad(r.fps.toFixed(1), 7) + pad(r.frameP95.toFixed(1), 9) + pad(r.frameMax.toFixed(1), 9) +
        pad((r.dropRate * 100).toFixed(1), 8) + pad(r.privateMB.toFixed(0), 8) + `${r.glCreated}/${r.glDisposed}/${r.glLost}`
    )
  }
  lines.push('', `20 open/close cycles: created ${cycles.created}, disposed ${cycles.disposed}, contexts lost ${cycles.lost}, still drawing after: ${cycles.stillDrawing}`)
  ipcRenderer.send('done', { lines })
}

async function runShots() {
  step('waiting for React')
  await ready()
  step('React mounted; capturing canvas-only')
  const files = []
  files.push(...(await ipcRenderer.invoke('capture', { name: 'canvas-only', rect: { x: 0, y: 0, width: 1400, height: 560 } })))
  await openThread()
  layerModule.threadApi?.focus()
  await typeFor(18, 3)
  await wait(700)
  files.push(...(await ipcRenderer.invoke('capture', { name: 'thread-open', rect: { x: 0, y: 0, width: 1400, height: 560 } })))
  await ipcRenderer.invoke('write-result', { name: 'shots', data: { contexts, stats: layerModule.threadApi?.thread.stats() ?? null } })
  ipcRenderer.send('done', { lines: ['Screenshots:', ...files] })
}

const fail = (err) => {
  console.error('[scripted failed]', String((err && err.stack) || err))
  ipcRenderer.send('done', { lines: ['FAILED: ' + String((err && err.message) || err)] })
}
if (BENCH) runBench().catch(fail)
else if (SHOTS) runShots().catch(fail)
