// Screenshots of the many-view page: a helix in four views, the same with one
// sloppy view, two stems × four views drawn shuffled, and a stem drawn by
// pointer in three views (then replayed in Node for identical vectors).
// Writes results/shots/*.png.
//
//   npm i playwright-core   (once, anywhere on NODE_PATH)
//   CHROMIUM=/path/to/chrome node shots.mjs

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { canonical, expand } from '../015-generative-vectors/gen.mjs'
import { PLANES } from '../018-strokes-as-seeds/sessions.mjs'
import { fitSessionMulti } from './session.mjs'
PLANES.oblique45 = [0, 0, 0, 0.7071067811865476, 0, -0.7071067811865476, 0, 1, 0]

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const out = new URL('./results/shots/', import.meta.url)
mkdirSync(out, { recursive: true })
const server = spawn(process.execPath, [new URL('../015-generative-vectors/serve.mjs', import.meta.url).pathname])
const base = (await new Promise((resolve) => server.stdout.on('data', (d) => resolve(String(d).trim())))).replace('015-generative-vectors/index.html', '020-multi-view/index.html')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const settle = () => page.waitForFunction(() => window.__state, null, { timeout: 120000 })

for (const [name, query] of [
  ['01-helix-four-views', 'session=four'],
  ['02-helix-one-sloppy-view', 'session=sloppy'],
  ['03-two-stems-shuffled', 'session=two'],
]) {
  await page.goto(`${base}?${query}`); await settle(); await page.waitForTimeout(300)
  await page.screenshot({ path: new URL(`${name}.png`, out).pathname })
  console.log(name, JSON.stringify({ ...(await page.evaluate(() => window.__state)), actions: undefined }))
}

// Draw one S-shaped stem in both views with the pointer.
await page.goto(`${base}?session=blank`); await settle()
async function draw(id, fn) {
  const b = await page.locator(`#${id}`).boundingBox()
  const [vmin, vmax] = id === 'top' ? [-2.5, 2.5] : [-0.4, 4.6]
  const pt = (t) => { const [u, v] = fn(t); return [b.x + ((u + 3) / 6) * b.width, b.y + (1 - (v - vmin) / (vmax - vmin)) * b.height] }
  await page.mouse.move(...pt(0)); await page.mouse.down()
  for (let i = 1; i <= 60; i++) await page.mouse.move(...pt(i / 60))
  await page.mouse.up(); await page.waitForTimeout(150)
}
// One S-curved stem: x = 0.8 sin(1.5πt), y = 3.6t, z = 0.9t² − 0.3
await draw('front', (t) => [0.8 * Math.sin(Math.PI * 1.5 * t), 3.6 * t])
await draw('side', (t) => [0.9 * t * t - 0.3, 3.6 * t])
await settle(); await page.waitForTimeout(300)
const afterTwo = await page.evaluate(() => window.__state.vh)
await draw('top', (t) => [0.8 * Math.sin(Math.PI * 1.5 * t), 0.9 * t * t - 0.3])
await settle(); await page.waitForTimeout(500)
await page.screenshot({ path: new URL('04-drawn-three-views.png', out).pathname })
const drawn = await page.evaluate(() => window.__state)
const { description } = fitSessionMulti(drawn.actions)
const nodeHash = createHash('sha256').update(Buffer.from(canonical(expand(description, 3).levels).buf.buffer)).digest('hex').slice(0, 16)
const replay = { browser: drawn.vh, node: nodeHash, same: drawn.vh === nodeHash, stems: drawn.stems, views: drawn.views, changedByThirdView: afterTwo !== drawn.vh }
console.log('drawn', JSON.stringify(replay))
writeFileSync(new URL('../shots.json', out), JSON.stringify({ errors, replay }, null, 2) + '\n')
console.log('errors', JSON.stringify(errors))
await browser.close(); server.kill()
process.exit(errors.length || !replay.same ? 1 : 0)
