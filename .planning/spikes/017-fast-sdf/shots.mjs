// The fork and the tree at level 7 through 017, with gradient normals, next
// to 016a's face-averaged normals. Writes results/shots/*.png.
//
//   npm i playwright-core   (once, anywhere on NODE_PATH)
//   CHROMIUM=/path/to/chrome node shots.mjs

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const out = new URL('./results/shots/', import.meta.url)
const server = spawn(process.execPath, [new URL('../015-generative-vectors/serve.mjs', import.meta.url).pathname])
const base = (await new Promise((resolve) => server.stdout.on('data', (d) => resolve(String(d).trim())))).replace('015-generative-vectors/index.html', '016-shared/index.html')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const close = 'cam=1.1,2.5,1.5&target=-0.35,2.2,0'
for (const [name, query] of [
  ['01-016a-fork-face-normals', `method=sdf&level=4&${close}`],
  ['02-017-fork-gradient-normals', `method=fast&level=4&${close}`],
  ['03-017-tree-L6', 'method=fast&level=6'],
  ['04-017-coral-L6', 'method=fast&preset=coral&level=6&cam=5,4,7&target=0,2.2,0'],
]) {
  await page.goto(`${base}?${query}`)
  await page.waitForFunction(() => window.__state, null, { timeout: 120000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: new URL(`${name}.png`, out).pathname })
  console.log(name, JSON.stringify(await page.evaluate(() => window.__state)))
}
console.log('errors', JSON.stringify(errors))
await browser.close()
server.kill()
