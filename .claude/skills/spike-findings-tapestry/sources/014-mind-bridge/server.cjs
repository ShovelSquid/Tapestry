// The mind bridge: a localhost sidecar that owns one story world and serves
// it to a game. Unity would call the same endpoints with UnityWebRequest; the
// page at / stands in for it. No dependencies beyond the Tapestry addon.
//
//   node server.cjs [story.tree]      (default: a scratch copy of examples/story.tree)
//   PORT=4317 by default; binds 127.0.0.1 only.
//
//   GET  /api/cast                              characters
//   GET  /api/context?speaker=&listener=&topic= the speaker model's packet
//   GET  /api/mind?npc=                         everything one NPC holds
//   POST /api/say      {speaker, listener, line}          a spoken line (plugin perihelion.speaker)
//   POST /api/observe  {text, canon, about[], witnesses[]} a game event (plugin perihelion.world)
//   POST /api/shift    {opinion, stance, because?}        the mind-sim's move (plugin perihelion.mind)
//   GET  /api/tree?records=8                    the newest .tree records, verbatim
//   GET  /api/check                             live mirror vs a fresh reload; journal status
//   GET  /api/log                               forensic event log (export)

'use strict'

const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { Mind } = require('./mind.cjs')
const { addonPath } = require('./paths.cjs')

const { TapestryAddon } = require(addonPath())
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mind-bridge-'))
const storyPath = process.argv[2] || path.join(scratch, 'story.tree')
if (!process.argv[2]) fs.copyFileSync(path.join(__dirname, 'examples/story.tree'), storyPath)

const mind = new Mind(TapestryAddon, storyPath)
const started = Date.now()
const log = []
function record(cat, msg, extra = {}) {
  log.push({ at: new Date().toISOString(), cat, msg, ...extra })
  if (log.length > 5000) log.shift()
}
record('open', storyPath, { status: mind.status().kind, nodes: mind.nodes.size, edges: mind.edges.size })

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(body, null, 2) : body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c; if (data.length > 1e6) reject(new Error('body too large')) })
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) } })
  })
}

// The newest `@commit` records of the file, exactly as written.
function tailRecords(n) {
  const text = fs.readFileSync(storyPath, 'utf8')
  const starts = []
  const re = /^@commit /gm
  let m
  while ((m = re.exec(text))) starts.push(m.index)
  return starts.slice(-n).map((s, i, all) => text.slice(s, all[i + 1] ?? text.length).trimEnd())
}

const routes = {
  'GET /api/cast': () => mind.cast(),
  'GET /api/context': (q) => {
    const packet = mind.context(q.get('speaker'), q.get('listener'), q.get('topic') || '')
    if (!packet) throw Object.assign(new Error('unknown speaker'), { code: 404 })
    // Never speak from a damaged mind (spike 012).
    if (mind.status().kind !== 'Ok') throw Object.assign(new Error('journal is not Ok'), { code: 503 })
    return packet
  },
  'GET /api/mind': (q) => mind.mindOf(q.get('npc')),
  'POST /api/say': (_, b) => mind.say(b.speaker, b.listener, String(b.line), mind.lastGameTime() + 60),
  'POST /api/observe': (_, b) => mind.observe(b),
  'POST /api/shift': (_, b) => mind.shift(b),
  'GET /api/tree': (q) => tailRecords(Number(q.get('records') || 8)),
  'GET /api/check': () => ({ status: mind.status(), mirror: mind.verifyMirror(TapestryAddon, scratch) }),
  'GET /api/log': () => {
    const counts = {}
    for (const e of log) counts[e.cat] = (counts[e.cat] || 0) + 1
    const ms = log.filter((e) => typeof e.ms === 'number').map((e) => e.ms).sort((a, b) => a - b)
    const pct = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null)
    return {
      summary: { story: storyPath, uptime_s: (Date.now() - started) / 1000, counts, ms_p50: pct(0.5), ms_p99: pct(0.99),
        errors: log.filter((e) => e.cat === 'error').length },
      events: log,
    }
  },
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8')
  }
  if (url.pathname === '/favicon.ico') return res.writeHead(204).end()
  const route = routes[`${req.method} ${url.pathname}`]
  if (!route) return send(res, 404, { error: 'no such route' })
  const t0 = process.hrtime.bigint()
  try {
    const body = req.method === 'POST' ? await readBody(req) : {}
    const result = route(url.searchParams, body)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    const cat = url.pathname.slice(5)
    if (cat !== 'log' && cat !== 'tree') {
      record(cat, `${req.method} ${url.pathname}${url.search}`, { ms, ...(req.method === 'POST' ? { body } : {}) })
    }
    send(res, 200, result)
  } catch (e) {
    record('error', `${req.method} ${url.pathname}: ${e.message}`)
    send(res, e.code || 400, { error: e.message })
  }
})

const port = Number(process.env.PORT || 4317)
server.listen(port, '127.0.0.1', () => {
  console.log(`mind bridge on http://127.0.0.1:${server.address().port}`)
  console.log(`story: ${storyPath}`)
})

function shutdown() {
  server.close()
  mind.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
