// End-to-end over HTTP, the way a game would see it: start the bridge on a
// scratch copy of the story, grow it with spoken lines, then time context
// requests, including bursts of simultaneous reads and writes. Writes
// results/bench-http.json.
//
//   TAPESTRY_ADDON=… node bench.cjs

'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const SIZES = [0, 1000, 5000]
const npcs = ['Rook', 'Kade', 'Ines', 'Oda']

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'server.cjs')], { env: { ...process.env, PORT: '0' } })
    child.stderr.on('data', (d) => process.stderr.write(d))
    child.stdout.on('data', (d) => {
      const m = String(d).match(/http:\/\/127\.0\.0\.1:(\d+)/)
      if (m) resolve({ child, base: `http://127.0.0.1:${m[1]}` })
    })
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)))
  })
}

async function call(base, route, body) {
  const t0 = performance.now()
  const res = await fetch(base + route, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  const data = await res.json()
  if (!res.ok) throw new Error(`${route}: ${data.error}`)
  return { data, ms: performance.now() - t0 }
}

const stats = (ms) => {
  const s = [...ms].sort((a, b) => a - b)
  return { p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p99: +s[Math.min(s.length - 1, Math.floor(s.length * 0.99))].toFixed(2) }
}

async function main() {
  const { child, base } = await startServer()
  const rows = []
  let grown = 0
  try {
    for (const size of SIZES) {
      const sayMs = []
      for (; grown < size; grown++) {
        const speaker = npcs[grown % npcs.length]
        sayMs.push((await call(base, '/api/say', { speaker, listener: 'player', line: `${speaker} line ${grown}: still no parts.` })).ms)
      }
      const ctxMs = []
      for (let i = 0; i < 200; i++) {
        ctxMs.push((await call(base, `/api/context?speaker=${npcs[i % 4]}&listener=player&topic=parts`)).ms)
      }
      // A burst: 50 reads and 10 writes in flight at once.
      const burst = []
      const t0 = performance.now()
      await Promise.all([
        ...Array.from({ length: 50 }, (_, i) => call(base, `/api/context?speaker=${npcs[i % 4]}&listener=player`).then((r) => burst.push(r.ms))),
        ...Array.from({ length: 10 }, (_, i) => call(base, '/api/say', { speaker: npcs[i % 4], listener: 'player', line: `burst ${i}` })),
      ])
      grown += 10
      const burstWall = performance.now() - t0
      const check = (await call(base, '/api/check')).data
      rows.push({
        spoken_lines: grown, say_http_ms: sayMs.length ? stats(sayMs) : null, context_http_ms: stats(ctxMs),
        burst_60_requests_wall_ms: +burstWall.toFixed(1), burst_context_ms: stats(burst),
        journal: check.status.kind, mirror_matches_kernel: check.mirror.same, nodes: check.mirror.nodes,
      })
      console.log(JSON.stringify(rows[rows.length - 1]))
    }
  } finally {
    child.kill('SIGTERM')
  }
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, 'results/bench-http.json'), JSON.stringify(rows, null, 2) + '\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
