// The two sessions, grown and surfaced; then a stroke drawn through the
// real capture path (pointer events → samples) on a blank canvas, exported,
// and replayed in Node: the browser's and Node's vector and mesh hashes must
// match. Writes results/shots/*.png and results/shots.json.
//
//   npm i playwright-core   (once, anywhere on NODE_PATH)
//   CHROMIUM=/path/to/chrome node shots.mjs

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expand, canonical } from '../015-generative-vectors/gen.mjs'
import { buildFastSdfMesh } from '../017-fast-sdf/fast.mjs'
import { fitStrokes } from './strokes.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const out = new URL('./results/shots/', import.meta.url)
mkdirSync(out, { recursive: true })
const server = spawn(process.execPath, [new URL('../015-generative-vectors/serve.mjs', import.meta.url).pathname])
const base = (await new Promise((resolve) => server.stdout.on('data', (d) => resolve(String(d).trim())))).replace('015-generative-vectors/index.html', '018-strokes-as-seeds/index.html')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const settle = () => page.waitForFunction(() => window.__state && window.__state.vecHash, null, { timeout: 120000 })
const results = []

for (const [name, query] of [
  ['01-sapling-vectors', 'session=sapling&level=4&surface=0'],
  ['02-sapling-surface', 'session=sapling&level=4'],
  ['03-lantern-surface', 'session=lantern&level=4&cam=7,6,9'],
]) {
  await page.goto(`${base}?${query}`); await settle(); await page.waitForTimeout(300)
  await page.screenshot({ path: new URL(`${name}.png`, out).pathname })
  const s = await page.evaluate(() => ({ ...window.__state, actions: undefined }))
  results.push({ name, ...s }); console.log(name, JSON.stringify(s))
}

// Draw on a blank canvas through real pointer events: a trunk, a limb, a
// ground line (lead), then a rust stroke from the limb to the trunk top.
await page.goto(`${base}?session=blank&level=4`); await settle()
const box = await page.locator('canvas').boundingBox()
const toScreen = async (u, v) => page.evaluate(([u, v]) => {
  // project a front-plane point to client pixels with the page's camera
  const c = document.querySelector('canvas').getBoundingClientRect()
  return window.__project ? window.__project(u, v) : null
}, [u, v])
async function draw(points, brush) {
  await page.click(`#brushes [data-brush="${brush}"]`)
  const pts = points.map(([x, y]) => [box.x + x * box.width, box.y + y * box.height])
  await page.mouse.move(...pts[0]); await page.mouse.down()
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
    for (let s = 1; s <= 12; s++) await page.mouse.move(x0 + (x1 - x0) * s / 12, y0 + (y1 - y0) * s / 12)
  }
  await page.mouse.up()
  await page.waitForTimeout(200)
}
await draw([[0.5, 0.78], [0.51, 0.62], [0.5, 0.46], [0.52, 0.33]], 'ink')
await draw([[0.505, 0.58], [0.44, 0.5], [0.38, 0.42]], 'ink')
await draw([[0.34, 0.785], [0.5, 0.782], [0.66, 0.785]], 'lead')
await draw([[0.385, 0.43], [0.44, 0.33], [0.515, 0.34]], 'rust')
await settle(); await page.waitForTimeout(500)
await page.screenshot({ path: new URL('04-drawn-by-pointer.png', out).pathname })
const drawn = await page.evaluate(() => window.__state)
console.log('drawn', JSON.stringify({ ...drawn, actions: `${drawn.actions.length} actions` }))

// Replay the exported actions in Node.
const { description } = fitStrokes(drawn.actions)
const levels = expand(description, 4).levels
const vecHash = createHash('sha256').update(Buffer.from(canonical(levels).buf.buffer)).digest('hex').slice(0, 16)
const m = buildFastSdfMesh(levels.flat(), { cell: 0.05, normals: true })
const meshHash = createHash('sha256').update(Buffer.from(m.positions.buffer)).update(Buffer.from(m.indices.buffer)).digest('hex').slice(0, 16)
const replay = { browserVec: drawn.vecHash, nodeVec: vecHash, browserMesh: drawn.meshHash, nodeMesh: meshHash, same: drawn.vecHash === vecHash && drawn.meshHash === meshHash }
console.log('replay', JSON.stringify(replay))
writeFileSync(new URL('./drawn-session.json', out), JSON.stringify(drawn.actions) + '\n')
writeFileSync(new URL('../shots.json', out), JSON.stringify({ errors, results, drawn: { ...drawn, actions: undefined }, replay }, null, 2) + '\n')
console.log('errors', JSON.stringify(errors))
await browser.close(); server.kill()
process.exit(errors.length || !replay.same ? 1 : 0)
