// Spike 006 — keystrokes into `.tree` and back out again, through the REAL kernel.
//
// Run from the repo root:
//   node .planning/spikes/006-record-redraw-roundtrip/roundtrip.cjs [--hours 1] [--keep]
//
// The native addon loads under plain Node, so this drives the actual `.tree`
// writer and reader rather than a JavaScript imitation: what it measures is what
// the app would do.
//
// What D-06 asks for: small commits as you type (about ⅓ s, like today's
// autosave), each listing the letters typed with their time offsets, readable in
// a text editor, with dots redrawn from time × speed and never stored.
//
// Why keystrokes are node PROPERTIES and not `x-` extension lines: the codec
// supports extension lines (Encoder writes record.extensionLines verbatim,
// Decoder preserves them), but the addon's only path from JS to the journal is
// submit(ops) — there is no way to attach or read an extension line, and no
// getCommits(). So the reachable encoding is `set <node> keys.NNNNNN text`.
//
// Encoding, one property per commit:
//
//   set n1 keys.000123 text <<TEXT
//   @ 12345.678            seconds from the thread's start, the anchor for this batch
//   +0.000 T               seconds after the anchor, then the grapheme
//   +0.117 h
//   -0.220 3               a deletion: 3 characters removed (D-03 keeps them on the line)
//   TEXT
//
// Each offset is measured from the batch ANCHOR, not from the previous
// keystroke. Deltas from the previous keystroke re-accumulate their rounding on
// the way back in: at three decimals and a ⅓ s commit window the drift stays
// under a millisecond, but widen the window to 5 s (~27 keystrokes per batch)
// and it passes 2 ms and keeps growing with batch length. Anchored offsets keep
// every keystroke's error bounded at half a millisecond however long the batch.
//
// A grapheme is written raw except that a line feed is `\n` and a backslash is
// `\\`, so every record stays one line per keystroke and a person can read it.

const fs = require('fs')
const path = require('path')
const os = require('os')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const { TapestryAddon } = require(path.join(ROOT, 'app/native/build/Release/tapestry_addon.node'))

const args = process.argv.slice(2)
const hoursArg = args.includes('--hours') ? Number(args[args.indexOf('--hours') + 1]) : null
const KEEP = args.includes('--keep')

const THREAD_TYPE = 'tapestry.threads/thread@1'
// D-06: about a third of a second of typing per commit, matching today's
// autosave. Adjustable so the cost of the commit rate itself can be measured —
// reopening is superlinear in commit count, so this is the knob that matters.
const COMMIT_SECONDS = args.includes('--commit-seconds')
  ? Number(args[args.indexOf('--commit-seconds') + 1])
  : 1 / 3
const NODE_TYPE_NOTE = 'tapestry.notes/note@1'

// ---------------------------------------------------------------------------
// Synthetic history — the same rhythm spikes 001–004 use (sessions of 2–15 min,
// 1–20 min apart, bursts of 5–40 s at 3–8 keys/s). Copied rather than imported:
// 003-shared/scene.js calls window.require('electron') at module scope and
// cannot load under plain Node.
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
const graphemes = (s) => Array.from(segmenter.segment(s), (x) => x.segment)
const LATIN = graphemes(SAMPLE)

/** Keystrokes and sessions for `hours` of continuous history. */
function generate(hours) {
  const random = mulberry32(7)
  const end = hours * 3600
  const keys = [] // { t, ch }
  const sessions = [] // { start, end }
  let t = 0
  let i = 0
  while (t < end) {
    const sessionStart = t
    const sessionEnd = Math.min(end, t + (120 + random() * 780)) // 2–15 min
    while (t < sessionEnd) {
      const burstEnd = Math.min(sessionEnd, t + (5 + random() * 35)) // 5–40 s
      const cps = 3 + random() * 5 // 3–8 keys/s
      while (t < burstEnd) {
        keys.push({ t, ch: LATIN[i++ % LATIN.length] })
        t += 1 / cps
      }
      t += random() * 3 // a short think between bursts
    }
    sessions.push({ start: sessionStart, end: Math.min(t, sessionEnd) })
    t += 60 + random() * 1140 // 1–20 min away
  }
  return { keys, sessions, end }
}

/** Group keystrokes into commit-sized batches of about COMMIT_SECONDS. */
function batch(keys) {
  const batches = []
  let current = null
  for (const k of keys) {
    if (!current || k.t - current.at >= COMMIT_SECONDS) {
      current = { at: k.t, keys: [] }
      batches.push(current)
    }
    current.keys.push(k)
  }
  return batches
}

const escapeGrapheme = (g) => g.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
const unescapeGrapheme = (g) => g.replace(/\\n/g, '\n').replace(/\\\\/g, '\\')

function encodeBatch(b) {
  const lines = [`@ ${b.at.toFixed(3)}`]
  for (const k of b.keys) {
    lines.push(`+${(k.t - b.at).toFixed(3)} ${escapeGrapheme(k.ch)}`)
  }
  return lines.join('\n')
}

/** The reader: rebuild absolute-timed keystrokes from one property value. */
function decodeBatch(value) {
  const lines = value.split('\n')
  let anchor = 0
  const out = []
  for (const line of lines) {
    if (line.startsWith('@ ')) {
      anchor = Number(line.slice(2))
      continue
    }
    if (line.startsWith('-')) continue // a deletion marker; letters stay on the line (D-03)
    const sp = line.indexOf(' ')
    if (sp < 0) continue
    // Offsets are anchor-relative, so no error accumulates across the batch.
    out.push({ t: anchor + Number(line.slice(1, sp)), ch: unescapeGrapheme(line.slice(sp + 1)) })
  }
  return out
}

const pad6 = (n) => String(n).padStart(6, '0')
const ms = (t) => `${t.toFixed(0)} ms`

function runOne(hours) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spike006-'))
  const file = path.join(dir, `thread-${hours}h.tree`)

  const { keys, sessions, end } = generate(hours)
  const batches = batch(keys)

  // --- write -------------------------------------------------------------
  const k = TapestryAddon.create(file, `thread_${hours}h`)
  const base = k.submit('human', 'kaelen', 'new thread', [
    { op: 'createNode', type: THREAD_TYPE, props: { title: { type: 'text', value: `Thread ${hours} h` } } },
  ])
  const id = base.nodeIds[0]

  // Sessions are their own properties: a session note on the line (D-07).
  const sessionOps = sessions.map((s, i) => ({
    op: 'setProperty', target: id, key: `session.${pad6(i + 1)}`, type: 'text',
    value: `${s.start.toFixed(3)} ${s.end.toFixed(3)}`,
  }))

  const writeStarted = performance.now()
  for (let i = 0; i < batches.length; i++) {
    k.submit('human', 'kaelen', '', [
      { op: 'setProperty', target: id, key: `keys.${pad6(i + 1)}`, type: 'text', value: encodeBatch(batches[i]) },
    ])
  }
  const writeMs = performance.now() - writeStarted
  k.submit('human', 'kaelen', 'sessions', sessionOps)
  const lastSeq = k.getLastSeq()
  k.close()

  const bytes = fs.statSync(file).size

  // --- reopen and redraw -------------------------------------------------
  const openStarted = performance.now()
  const k2 = TapestryAddon.open(file)
  const openMs = performance.now() - openStarted

  const readStarted = performance.now()
  const node = k2.getNode(id)
  const readMs = performance.now() - readStarted
  const status = k2.status()

  const propKeys = Object.keys(node.props)
  const keyProps = propKeys.filter((p) => p.startsWith('keys.')).sort()
  const redrawStarted = performance.now()
  const redrawn = []
  for (const p of keyProps) redrawn.push(...decodeBatch(node.props[p].value))
  const redrawMs = performance.now() - redrawStarted
  k2.close()

  // --- fidelity ----------------------------------------------------------
  let mismatch = null
  if (redrawn.length !== keys.length) {
    mismatch = `count ${redrawn.length} vs ${keys.length}`
  } else {
    for (let i = 0; i < keys.length; i++) {
      if (redrawn[i].ch !== keys[i].ch) { mismatch = `char at ${i}: ${JSON.stringify(redrawn[i].ch)} vs ${JSON.stringify(keys[i].ch)}`; break }
      if (Math.abs(redrawn[i].t - keys[i].t) > 0.002) { mismatch = `time at ${i}: ${redrawn[i].t} vs ${keys[i].t}`; break }
    }
  }

  const sample = fs.readFileSync(file, 'utf8')
  const firstKeys = sample.indexOf('set n1 keys.')
  const excerpt = sample.slice(firstKeys, sample.indexOf('@end', firstKeys) + 8)

  if (!KEEP) fs.rmSync(dir, { recursive: true, force: true })

  return {
    hours, keystrokes: keys.length, sessions: sessions.length, batches: batches.length,
    commits: lastSeq, properties: propKeys.length, bytes,
    bytesPerKeystroke: bytes / keys.length,
    writeMs, openMs, readMs, redrawMs,
    commitsPerSecond: batches.length / (writeMs / 1000),
    status: status.kind, redrawn: redrawn.length,
    identical: mismatch === null, mismatch, excerpt, file: KEEP ? file : null,
  }
}

const hoursList = hoursArg ? [hoursArg] : [1, 8]
const results = []
for (const h of hoursList) {
  process.stdout.write(`running ${h} h …\n`)
  results.push(runOne(h))
}

const pad = (v, n) => String(v).padEnd(n)
console.log('')
console.log(
  pad('hours', 7) + pad('keystrokes', 12) + pad('commits', 9) + pad('props', 8) +
  pad('file', 11) + pad('B/key', 8) + pad('write', 11) + pad('commits/s', 11) +
  pad('reopen', 10) + pad('read', 9) + pad('redraw', 9) + pad('status', 8) + 'identical'
)
for (const r of results) {
  console.log(
    pad(r.hours, 7) + pad(r.keystrokes.toLocaleString(), 12) + pad(r.commits.toLocaleString(), 9) +
    pad(r.properties.toLocaleString(), 8) + pad((r.bytes / 1048576).toFixed(1) + ' MB', 11) +
    pad(r.bytesPerKeystroke.toFixed(0), 8) + pad(ms(r.writeMs), 11) +
    pad(r.commitsPerSecond.toFixed(0), 11) + pad(ms(r.openMs), 10) + pad(ms(r.readMs), 9) +
    pad(ms(r.redrawMs), 9) + pad(r.status, 8) + (r.identical ? 'yes' : `NO — ${r.mismatch}`)
  )
}

console.log('\n--- what a commit looks like in the file ---')
console.log(results[0].excerpt)

const out = path.join(__dirname, 'results')
fs.mkdirSync(out, { recursive: true })
const outFile = path.join(out, `roundtrip-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
fs.writeFileSync(outFile, JSON.stringify({ results }, null, 2))
console.log(`\nResults written to ${outFile}`)
