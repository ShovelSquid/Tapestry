// Screenshots of the two-view page, each method on the helix + hook pair,
// the shuffled three-stem session, and a stem drawn by pointer in both views
// (then replayed in Node for identical vectors). Writes results/shots/*.png.
//
//   npm i playwright-core   (once, anywhere on NODE_PATH)
//   CHROMIUM=/path/to/chrome node shots.mjs

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { canonical, expand } from '../015-generative-vectors/gen.mjs'
import { fitSession } from './session.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const out = new URL('./results/shots/', import.meta.url)
mkdirSync(out, { recursive: true })
const server = spawn(process.execPath, [new URL('../015-generative-vectors/serve.mjs', import.meta.url).pathname])
const base = (await new Promise((resolve) => server.stdout.on('data', (d) => resolve(String(d).trim())))).replace('015-generative-vectors/index.html', '019-shared/index.html')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const settle = () => page.waitForFunction(() => window.__state, null, { timeout: 120000 })

for (const [name, query] of [
  ['01-pair-align', 'session=pair&method=align'],
  ['02-pair-height', 'session=pair&method=height'],
  ['03-pair-arc', 'session=pair&method=arc'],
  ['04-three-shuffled-mismatch', 'session=three&rule=mismatch'],
]) {
  await page.goto(`${base}?${query}`); await settle(); await page.waitForTimeout(300)
  await page.screenshot({ path: new URL(`${name}.png`, out).pathname })
  console.log(name, JSON.stringify({ ...(await page.evaluate(() => window.__state)), actions: undefined }))
}

// Draw one S-shaped stem in both views with the pointer.
await page.goto(`${base}?session=blank`); await settle()
async function draw(id, fn) {
  const b = await page.locator(`#${id}`).boundingBox()
  const pt = (t) => { const [u, v] = fn(t); return [b.x + ((u + 3) / 6) * b.width, b.y + (1 - (v + 0.4) / 5) * b.height] }
  await page.mouse.move(...pt(0)); await page.mouse.down()
  for (let i = 1; i <= 60; i++) await page.mouse.move(...pt(i / 60))
  await page.mouse.up(); await page.waitForTimeout(150)
}
await draw('front', (t) => [0.8 * Math.sin(Math.PI * 1.5 * t), 3.6 * t])
await draw('side', (t) => [0.9 * t * t - 0.3, 3.6 * t])
await settle(); await page.waitForTimeout(500)
await page.screenshot({ path: new URL('05-drawn-both-views.png', out).pathname })
const drawn = await page.evaluate(() => window.__state)
const { description } = fitSession(drawn.actions, { method: 'align', rule: 'mismatch' })
const nodeHash = createHash('sha256').update(Buffer.from(canonical(expand(description, 3).levels).buf.buffer)).digest('hex').slice(0, 16)
const replay = { browser: drawn.vh, node: nodeHash, same: drawn.vh === nodeHash, pairs: drawn.pairs, mismatch: drawn.mismatch }
console.log('drawn', JSON.stringify(replay))
writeFileSync(new URL('../shots.json', out), JSON.stringify({ errors, replay }, null, 2) + '\n')
console.log('errors', JSON.stringify(errors))
await browser.close(); server.kill()
process.exit(errors.length || !replay.same ? 1 : 0)
