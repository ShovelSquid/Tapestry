// Screenshot the built app (app/out) against scratch folders, never real data.
// Usage: electron app-shot.cjs <out.png>   (run `npm --prefix app run build:js` first)
// Optional env SHOT_SCRIPT: JS run in the renderer before the capture.
'use strict'
const path = require('path')
const fs = require('fs')
const os = require('os')
const { app, BrowserWindow } = require('electron')

const outPng = path.resolve(process.argv[process.argv.length - 1])
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-shot-'))
process.env.TAPESTRY_USER_DATA_DIR = path.join(scratch, 'user')
process.env.TAPESTRY_SPACE_DIR = path.join(scratch, 'space')
fs.mkdirSync(process.env.TAPESTRY_USER_DATA_DIR, { recursive: true })
fs.mkdirSync(process.env.TAPESTRY_SPACE_DIR, { recursive: true })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    await wait(2500)
    if (process.env.SHOT_SCRIPT) {
      try { await win.webContents.executeJavaScript(process.env.SHOT_SCRIPT) } catch (err) { console.error('[shot] script', err) }
      await wait(1500)
    }
    const img = await win.webContents.capturePage()
    fs.writeFileSync(outPng, img.toPNG())
    console.log('[shot] wrote', outPng)
    app.exit(0)
  })
})
setTimeout(() => { console.error('[shot] timed out'); app.exit(2) }, 60000)
require(path.resolve(__dirname, '../../../app/out/main/index.js'))
