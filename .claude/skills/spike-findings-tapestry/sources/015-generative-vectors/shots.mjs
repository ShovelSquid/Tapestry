// Scripted screenshots, and the cross-engine determinism check: the hash the
// page computes in Chromium must equal the one Node computes for the same
// description. Writes results/shots/*.png and results/shots.json.
//
//   npm i playwright-core   (once, anywhere on NODE_PATH)
//   CHROMIUM=/path/to/chrome node shots.mjs

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { canonical, expand } from './gen.mjs'
import { PRESETS } from './presets.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const out = new URL('./results/shots/', import.meta.url)
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, [new URL('./serve.mjs', import.meta.url).pathname])
const url = await new Promise((resolve) => server.stdout.on('data', (d) => resolve(String(d).trim())))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

const nodeHash = (preset, level) => createHash('sha256').update(Buffer.from(canonical(expand(PRESETS[preset], level).levels).buf.buffer)).digest('hex').slice(0, 16)

const results = []
async function shot(name, query, after) {
  await page.goto(`${url}?${query}`)
  await page.waitForFunction(() => window.__state && window.__state.hash)
  if (after) await after()
  await page.waitForTimeout(400)
  await page.screenshot({ path: new URL(`${name}.png`, out).pathname })
  const state = await page.evaluate(() => window.__state)
  results.push({ name, query, ...state })
  console.log(name, JSON.stringify(state))
}

await shot('01-tree-L4', 'preset=tree&level=4')
await shot('02-tree-L7', 'preset=tree&level=7')
await shot('03-coral-L6', 'preset=coral&level=6')
await shot('04-bridge-L6', 'preset=bridge&level=6')
await shot('05-tree-L6-nudged', 'preset=tree&level=6&nudge=0.8')
await shot('06-tree-L7-region', 'preset=tree&level=7', async () => {
  const leaf = expand(PRESETS.tree, 3).levels[3][20]
  const c = [leaf.start[0] + leaf.dir[0] * leaf.len, leaf.start[1] + leaf.dir[1] * leaf.len, leaf.start[2] + leaf.dir[2] * leaf.len]
  await page.evaluate(([center]) => window.__setFocus(center, 1.0), [c])
})

// Cross-engine: Chromium's hash against Node's for untouched presets.
const cross = []
for (const [preset, level] of [['tree', 4], ['tree', 7], ['coral', 6], ['bridge', 6]]) {
  const browserHash = results.find((r) => r.query === `preset=${preset}&level=${level}`).hash
  const node = nodeHash(preset, level)
  cross.push({ preset, level, chromium: browserHash, node, same: browserHash === node })
}
console.log(JSON.stringify(cross))
writeFileSync(new URL('../shots.json', out), JSON.stringify({ errors, shots: results, cross_engine: cross }, null, 2) + '\n')
await browser.close()
server.kill()
process.exit(errors.length || cross.some((c) => !c.same) ? 1 : 0)
