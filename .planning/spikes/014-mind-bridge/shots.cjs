const { chromium } = require('playwright-core')
const { spawn } = require('child_process')
// Scripted walk-through with screenshots (spike convention: look before trusting numbers).
//   npm i playwright-core   (once, anywhere on NODE_PATH)
//   TAPESTRY_ADDON=… CHROMIUM=/path/to/chrome node shots.cjs
const path = require('path')
const D = __dirname
;(async () => {
  const srv = spawn(process.execPath, [path.join(D, 'server.cjs')], { env: { ...process.env, PORT: '0' } })
  const base = await new Promise((r) => srv.stdout.on('data', (d) => { const m = String(d).match(/(http:\S+)/); if (m) r(m[1]) }))
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(base); await page.waitForSelector('#packet h3')
  await page.screenshot({ path: D + '/results/shots/01-rook-to-vesper.png', fullPage: true })
  // Ines believes a false rumor about Vesper
  await page.selectOption('#speaker', 'Ines'); await page.waitForFunction(() => document.querySelector('#mindTitle').textContent.includes('Ines'))
  await page.screenshot({ path: D + '/results/shots/02-ines-false-belief.png', fullPage: true })
  // Rook again; a game event that Rook and Kade witness
  await page.selectOption('#speaker', 'Rook'); await page.waitForFunction(() => document.querySelector('#mindTitle').textContent.includes('Rook'))
  await page.fill('#event', 'The depot convoy was ambushed at the pass; Vesper drove it off')
  await page.check('#about input[value="Vesper"]'); await page.check('#witnesses input[value="Rook"]'); await page.check('#witnesses input[value="Kade"]')
  await page.click('#observe'); await page.waitForFunction(() => document.querySelector('#mind').textContent.includes('depot convoy'))
  // The mind-sim's move: soften "hard on machines" because of the convoy
  const slider = page.locator('#mind input[type=range]').first()
  const op = await slider.getAttribute('data-op')
  const fact = await page.$eval(`#mind select[data-because="${op}"]`, (s) => [...s.options].find((o) => o.text.includes('depot convoy')).value)
  await page.selectOption(`#mind select[data-because="${op}"]`, fact)
  await slider.evaluate((el) => { el.value = '-0.2'; el.dispatchEvent(new Event('change')) })
  await page.waitForFunction(() => document.querySelector('#packet').textContent.includes('(-0.2)'))
  // Rook speaks
  await page.fill('#line', "Heard you drove them off the convoy. Knees still bad. Less bad.")
  await page.click('#say'); await page.waitForFunction(() => document.querySelector('#packet').textContent.includes('Less bad'))
  await page.click('#check'); await page.waitForFunction(() => document.querySelector('#checkResult').textContent.length > 0)
  await page.screenshot({ path: D + '/results/shots/03-after-event-shift-say.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: D + '/results/shots/04-phone-width.png', fullPage: false })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  console.log(JSON.stringify({ errors, check: await page.textContent('#checkResult'), phoneOverflow: overflow,
    tree: (await page.textContent('#tree')).slice(0, 700) }, null, 1))
  await browser.close(); srv.kill()
})().catch((e) => { console.error(e); process.exit(1) })
