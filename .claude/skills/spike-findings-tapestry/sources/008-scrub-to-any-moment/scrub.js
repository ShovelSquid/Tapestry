// Spike 008 — the document as it was at any moment.
//
// D-18: clicking any point on the thread shows the document at that moment,
// read-only, with that letter highlighted; scrubbing along the line shows the
// document changing. D-17 adds a date scrubber along the bottom.
//
// The question is whether that can be done at interactive rate. It is only a
// real question because editing is not append-only: if every keystroke landed at
// the end, the document at time t would be the first k characters and a prefix
// index would answer in constant time. Real writing inserts and deletes in the
// middle, so the document at t is the result of applying every edit up to t —
// O(edits), with the whole history to replay for a seek near the end.
//
// Two strategies are measured:
//   naive     replay every edit from the beginning on each seek
//   snapshot  keep the text every SNAPSHOT_EVERY edits; seek = nearest snapshot
//             at or before t, then apply forward
//
// Deletions matter here for a second reason: D-03 keeps deleted letters ON THE
// LINE while removing them from the document, so the line and the document
// diverge — the line grows forever, the document does not.

const { ipcRenderer } = window.require('electron')
const params = new URLSearchParams(location.search)
const BENCH = params.get('bench') === '1'
const SHOTS = params.get('shots') === '1'
const SCRIPTED = BENCH || SHOTS

const HOURS = Number(params.get('hours') ?? 8)
const SNAPSHOT_EVERY = Number(params.get('snapshot') ?? 1000)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (m) => console.error('[step]', m)
addEventListener('error', (e) => console.error('[page error]', e.message, e.filename, e.lineno))
addEventListener('unhandledrejection', (e) =>
  console.error('[unhandled rejection]', String((e.reason && e.reason.stack) || e.reason))
)

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0)
function summarize(values) {
  const v = values.filter((x) => isFinite(x)).sort((a, b) => a - b)
  return { n: v.length, median: percentile(v, 0.5), p95: percentile(v, 0.95), max: v.length ? v[v.length - 1] : 0 }
}

// ---------------------------------------------------------------------------
// History: edits that carry a position, not just a character
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
  'ok i need to start writing my notes here, and just make it easier to use. this is a knowledge base as much as obsidian is. threads run through time, one letter at a time. a session runs from a time-in to a time-out, and nothing on the line is ever erased. '

/**
 * Edits in the rhythm of spikes 001–006 (sessions of 2–15 min, 1–20 min apart,
 * bursts of 5–40 s at 3–8 keys/s), but each edit carries a position:
 *   { t, at, insert }  insert text at `at`
 *   { t, at, remove }  remove `remove` characters at `at`
 * Most writing appends; some goes back into the middle; some deletes.
 */
function generateEdits(hours) {
  const random = mulberry32(7)
  const edits = []
  const sessions = []
  const end = hours * 3600
  let t = 0
  let i = 0
  let length = 0 // the document's length as the history is built

  while (t < end) {
    const sessionStart = t
    const sessionEnd = Math.min(end, t + (120 + random() * 780))
    // Where this session is writing: usually the end, sometimes back in the text.
    let caret = random() < 0.25 && length > 200 ? Math.floor(random() * length) : length

    while (t < sessionEnd) {
      const burstEnd = Math.min(sessionEnd, t + (5 + random() * 35))
      const cps = 3 + random() * 5
      while (t < burstEnd) {
        const roll = random()
        if (roll < 0.06 && caret > 4) {
          // A correction: delete a few characters back.
          const remove = 1 + Math.floor(random() * 4)
          const at = Math.max(0, caret - remove)
          edits.push({ t, at, remove: Math.min(remove, length - at) })
          length -= Math.min(remove, length - at)
          caret = at
        } else {
          const ch = SAMPLE[i++ % SAMPLE.length]
          edits.push({ t, at: caret, insert: ch })
          length++
          caret++
        }
        t += 1 / cps
      }
      t += random() * 3
      // Between bursts the caret sometimes jumps elsewhere in the document.
      if (random() < 0.2 && length > 200) caret = Math.floor(random() * length)
    }
    sessions.push({ start: sessionStart, end: Math.min(t, sessionEnd) })
    t += 60 + random() * 1140
    caret = length
  }
  return { edits, sessions, end, finalLength: length }
}

step(`generating ${HOURS} h of editing history`)
const built = generateEdits(HOURS)
const EDITS = built.edits
step(`${EDITS.length.toLocaleString()} edits, final document ${built.finalLength.toLocaleString()} characters`)

// ---------------------------------------------------------------------------
// Reconstruction
// ---------------------------------------------------------------------------

/** A character buffer; splice is a memmove, which is what an array is good at. */
function applyTo(buffer, edit) {
  if (edit.insert !== undefined) buffer.splice(edit.at, 0, edit.insert)
  else buffer.splice(edit.at, edit.remove)
}

/** Index of the last edit at or before time t (binary search). */
function editIndexAt(t) {
  let lo = 0
  let hi = EDITS.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (EDITS[mid].t <= t) lo = mid + 1
    else hi = mid
  }
  return lo // count of edits applied
}

/** Naive: replay from the beginning every time. */
function reconstructNaive(count) {
  const buffer = []
  for (let i = 0; i < count; i++) applyTo(buffer, EDITS[i])
  return buffer
}

// Snapshots: the document every SNAPSHOT_EVERY edits.
const snapshots = []
let snapshotBytes = 0
function buildSnapshots() {
  const started = performance.now()
  const buffer = []
  snapshots.length = 0
  snapshots.push({ count: 0, text: '' })
  for (let i = 0; i < EDITS.length; i++) {
    applyTo(buffer, EDITS[i])
    if ((i + 1) % SNAPSHOT_EVERY === 0) snapshots.push({ count: i + 1, text: buffer.join('') })
  }
  snapshotBytes = snapshots.reduce((n, s) => n + s.text.length * 2, 0)
  return performance.now() - started
}

/** Snapshot: nearest snapshot at or before `count`, then apply forward. */
function reconstructSnapshot(count) {
  let lo = 0
  let hi = snapshots.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (snapshots[mid].count <= count) lo = mid
    else hi = mid - 1
  }
  const base = snapshots[lo]
  const buffer = Array.from(base.text)
  for (let i = base.count; i < count; i++) applyTo(buffer, EDITS[i])
  return buffer
}

step(`building snapshots every ${SNAPSHOT_EVERY} edits`)
const snapshotBuildMs = buildSnapshots()
step(`${snapshots.length} snapshots, ${(snapshotBytes / 1048576).toFixed(1)} MB, built in ${snapshotBuildMs.toFixed(0)} ms`)

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

const docEl = document.getElementById('doc')
const rangeEl = document.getElementById('range')
const readoutEl = document.getElementById('readout')
const ticksEl = document.getElementById('ticks')
const hud = document.getElementById('hud')

const clockText = (seconds) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Hour ticks along the scrubber, the date-scrubber stand-in (D-17).
for (let h = 0; h <= HOURS; h++) {
  const pct = (h / HOURS) * 100
  const tick = document.createElement('div')
  tick.style.left = `${pct}%`
  ticksEl.appendChild(tick)
  const label = document.createElement('span')
  label.style.left = `${pct}%`
  label.textContent = `${h}h`
  ticksEl.appendChild(label)
}

const seekStats = { naive: [], snapshot: [], paintMs: [] }
let strategy = 'snapshot'
let lastSeek = null

/** The window of text shown around the scrubbed letter. */
const WINDOW = 1600

function show(t) {
  const count = editIndexAt(t)
  const started = performance.now()
  const buffer = strategy === 'naive' ? reconstructNaive(count) : reconstructSnapshot(count)
  const reconstructMs = performance.now() - started
  seekStats[strategy].push(reconstructMs)

  // The letter at this moment is the one the last edit touched (D-18).
  const edit = count > 0 ? EDITS[count - 1] : null
  const caret = edit ? Math.min(edit.at, buffer.length - 1) : 0

  const paintStarted = performance.now()
  const from = Math.max(0, caret - WINDOW / 2)
  const to = Math.min(buffer.length, from + WINDOW)
  const before = buffer.slice(from, caret).join('')
  const at = buffer.slice(caret, caret + 1).join('')
  const after = buffer.slice(caret + 1, to).join('')
  docEl.replaceChildren()
  docEl.append(document.createTextNode(before))
  const mark = document.createElement('mark')
  mark.textContent = at || ' '
  docEl.append(mark)
  const tail = document.createElement('span')
  tail.className = 'tail'
  tail.textContent = after
  docEl.append(tail)
  const paintMs = performance.now() - paintStarted
  seekStats.paintMs.push(paintMs)

  lastSeek = { t, count, length: buffer.length, reconstructMs, paintMs }
  readoutEl.textContent =
    `${clockText(t)} into the thread   edit ${count.toLocaleString()} of ${EDITS.length.toLocaleString()}   ` +
    `document ${buffer.length.toLocaleString()} characters   rebuilt in ${reconstructMs.toFixed(1)} ms, painted in ${paintMs.toFixed(1)} ms`
  return lastSeek
}

function updateHud() {
  const n = summarize(seekStats.naive)
  const s = summarize(seekStats.snapshot)
  hud.textContent =
    `Spike 008 — the document as it was at any moment\n` +
    `${HOURS} h   ${EDITS.length.toLocaleString()} edits   final document ${built.finalLength.toLocaleString()} chars\n` +
    `snapshots every ${SNAPSHOT_EVERY} edits: ${snapshots.length}, ${(snapshotBytes / 1048576).toFixed(1)} MB, built in ${snapshotBuildMs.toFixed(0)} ms\n` +
    `strategy ${strategy}\n` +
    `  naive    seeks ${n.n}  median ${n.median.toFixed(1)} ms  p95 ${n.p95.toFixed(1)} ms  max ${n.max.toFixed(1)} ms\n` +
    `  snapshot seeks ${s.n}  median ${s.median.toFixed(1)} ms  p95 ${s.p95.toFixed(1)} ms  max ${s.max.toFixed(1)} ms\n\n` +
    `drag the scrubber · Ctrl+N naive · Ctrl+S snapshot`
}

rangeEl.addEventListener('input', () => {
  show((Number(rangeEl.value) / Number(rangeEl.max)) * built.end)
  updateHud()
})

addEventListener('keydown', (e) => {
  if (SCRIPTED || !e.ctrlKey) return
  if (e.key === 'n') { e.preventDefault(); strategy = 'naive'; updateHud() }
  if (e.key === 's') { e.preventDefault(); strategy = 'snapshot'; updateHud() }
})

show(built.end)
updateHud()

// ---------------------------------------------------------------------------
// Scripted runs
// ---------------------------------------------------------------------------

/** Seeks spread across the whole history, as a click on the line would be. */
function seekTimes(n) {
  const random = mulberry32(11)
  return Array.from({ length: n }, () => random() * built.end)
}

async function runBench() {
  const results = []

  for (const mode of ['snapshot', 'naive']) {
    strategy = mode
    seekStats[mode].length = 0
    // Random seeks: clicking a point on the line (D-18).
    const times = seekTimes(mode === 'naive' ? 20 : 200)
    const started = performance.now()
    for (const t of times) show(t)
    const totalMs = performance.now() - started
    results.push({ phase: `random-seeks-${mode}`, seeks: times.length, totalMs, ...summarize(seekStats[mode]) })
    await wait(50)
  }

  // A continuous drag: the scrubber pulled across the whole history, one seek
  // per frame, which is what D-17's scrubbing really asks for.
  for (const mode of ['snapshot', 'naive']) {
    strategy = mode
    seekStats[mode].length = 0
    const steps = mode === 'naive' ? 30 : 300
    const frameMs = []
    let last = performance.now()
    for (let i = 0; i <= steps; i++) {
      show((i / steps) * built.end)
      await new Promise((r) => requestAnimationFrame(r))
      const nowMs = performance.now()
      frameMs.push(nowMs - last)
      last = nowMs
    }
    const f = summarize(frameMs)
    results.push({
      phase: `drag-across-${mode}`, steps,
      frameMedian: f.median, frameP95: f.p95, frameMax: f.max,
      droppedPct: (frameMs.filter((x) => x > 25).length / frameMs.length) * 100,
      ...summarize(seekStats[mode]),
    })
    await wait(50)
  }

  const file = await ipcRenderer.invoke('write-result', {
    name: 'bench',
    data: {
      hours: HOURS, edits: EDITS.length, finalLength: built.finalLength,
      snapshotEvery: SNAPSHOT_EVERY, snapshots: snapshots.length,
      snapshotMB: snapshotBytes / 1048576, snapshotBuildMs, results,
    },
  })

  const pad = (v, n) => String(v).padEnd(n)
  const lines = [
    `Results written to ${file}`,
    '',
    `${HOURS} h · ${EDITS.length.toLocaleString()} edits · final document ${built.finalLength.toLocaleString()} chars`,
    `snapshots every ${SNAPSHOT_EVERY} edits: ${snapshots.length} kept, ${(snapshotBytes / 1048576).toFixed(1)} MB, built in ${snapshotBuildMs.toFixed(0)} ms`,
    '',
    pad('phase', 24) + pad('seeks', 7) + pad('rebuild med', 13) + pad('p95', 10) + pad('max', 10) +
      pad('frame med', 11) + pad('frame max', 11) + 'dropped%',
  ]
  for (const r of results) {
    lines.push(
      pad(r.phase, 24) + pad(r.seeks ?? r.steps, 7) + pad(r.median.toFixed(1) + ' ms', 13) +
      pad(r.p95.toFixed(1) + ' ms', 10) + pad(r.max.toFixed(1) + ' ms', 10) +
      pad(r.frameMedian !== undefined ? r.frameMedian.toFixed(1) + ' ms' : '—', 11) +
      pad(r.frameMax !== undefined ? r.frameMax.toFixed(1) + ' ms' : '—', 11) +
      (r.droppedPct !== undefined ? r.droppedPct.toFixed(1) : '—')
    )
  }
  ipcRenderer.send('done', { lines })
}

async function runShots() {
  const files = []
  strategy = 'snapshot'
  // Three moments across the history, so the document visibly differs.
  for (const [name, fraction] of [['early', 0.08], ['middle', 0.5], ['late', 0.97]]) {
    show(fraction * built.end)
    updateHud()
    await wait(200)
    files.push(...(await ipcRenderer.invoke('capture', { name: `document-${name}`, rect: { x: 0, y: 120, width: 1400, height: 520 } })))
  }
  await ipcRenderer.invoke('write-result', { name: 'shots', data: { lastSeek, snapshots: snapshots.length } })
  ipcRenderer.send('done', { lines: ['Screenshots:', ...files] })
}

const fail = (err) => {
  console.error('[scripted failed]', String((err && err.stack) || err))
  ipcRenderer.send('done', { lines: ['FAILED: ' + String((err && err.message) || err)] })
}
if (BENCH) runBench().catch(fail)
else if (SHOTS) runShots().catch(fail)
