// Screenshots of the three surfaces, whole and close up on the trunk/limb
// fork, for looking at joints. Writes results/shots/*.png.
//
//   npm i playwright-core   (once, anywhere on NODE_PATH)
//   CHROMIUM=/path/to/chrome node shots.mjs

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const out = new URL('./results/shots/', import.meta.url)
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, [new URL('../015-generative-vectors/serve.mjs', import.meta.url).pathname])
const base = (await new Promise((resolve) => server.stdout.on('data', (d) => resolve(String(d).trim())))).replace('015-generative-vectors/index.html', '016-shared/index.html')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

const close = 'cam=1.1,2.5,1.5&target=-0.35,2.2,0'
const shots = [
  ['01-cylinders-L4', 'method=cylinders&level=4'],
  ['02-sdf-L4', 'method=sdf&level=4'],
  ['03-tubes-L4', 'method=tubes&level=4'],
  ['04-cylinders-fork', `method=cylinders&level=4&${close}`],
  ['05-sdf-fork', `method=sdf&level=4&${close}`],
  ['06-tubes-fork', `method=tubes&level=4&${close}`],
  ['07-sdf-fork-wire', `method=sdf&level=4&wire=1&${close}`],
  ['08-tubes-fork-wire', `method=tubes&level=4&wire=1&${close}`],
  ['09-sdf-bridge-L5', 'method=sdf&preset=bridge&level=5&cam=0,4,11&target=0,2.5,0'],
]
for (const [name, query] of shots) {
  await page.goto(`${base}?${query}`)
  await page.waitForFunction(() => window.__state, null, { timeout: 120000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: new URL(`${name}.png`, out).pathname })
  console.log(name, JSON.stringify(await page.evaluate(() => window.__state)))
}
console.log('errors', JSON.stringify(errors))
await browser.close()
server.kill()
