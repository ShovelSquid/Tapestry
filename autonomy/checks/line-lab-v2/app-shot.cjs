// Screenshot the built app (app/out) against scratch folders, never real data.
// Usage: electron app-shot.cjs <out.png>   (run `npm --prefix app run build:js` first)
// Optional env SHOT_SCRIPT: JS run in the renderer before the capture; __SCRATCH__
// in it becomes the scratch folder's path. Optional SHOT_AFTER_RELOAD runs after
// the page reloads; SHOT_SETTLE_MS is the wait before the capture.
'use strict'
const path = require('path')
const fs = require('fs')
const os = require('os')
const { app, BrowserWindow } = require('electron')

const outPng = path.resolve(process.argv[process.argv.length - 1])
// Under home, because main only accepts .tree paths there; removed on exit.
const scratchBase = path.join(os.homedir(), 'Library', 'Caches', 'tapestry-shots')
fs.mkdirSync(scratchBase, { recursive: true })
const scratch = fs.mkdtempSync(path.join(scratchBase, 'tap-shot-'))
const done = (code) => { try { fs.rmSync(scratch, { recursive: true, force: true }) } catch {} app.exit(code) }
process.env.TAPESTRY_USER_DATA_DIR = path.join(scratch, 'user')
process.env.TAPESTRY_SPACE_DIR = path.join(scratch, 'space')
fs.mkdirSync(process.env.TAPESTRY_USER_DATA_DIR, { recursive: true })
fs.mkdirSync(process.env.TAPESTRY_SPACE_DIR, { recursive: true })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
app.on('browser-window-created', (_e, win) => {
  // A hidden window clamps timers to 1 s; poses that step at 16 ms need real time.
  win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load', async () => {
    await wait(2500)
    const run = async (src) => {
      try {
        const out = await win.webContents.executeJavaScript(src.split('__SCRATCH__').join(scratch))
        if (out !== undefined) console.log('[shot] script:', out)
        return out === undefined ? true : out
      } catch (err) { console.error('[shot] script', err); return false }
    }
    if (process.env.SHOT_SCRIPT) {
      // A script that reloads the page (to pick up a tree it made) hands
      // over to SHOT_AFTER_RELOAD, run once the reloaded page has loaded.
      const reloaded = new Promise((r) => win.webContents.once('did-finish-load', r))
      const ok = await run(process.env.SHOT_SCRIPT)
      if (ok && process.env.SHOT_AFTER_RELOAD) {
        await reloaded
        // A pose that reloads again (to check a saved state reopens the
        // same) says so with "reload":true, and runs once more after it.
        const again = new Promise((r) => win.webContents.once('did-finish-load', r))
        const out = await run(process.env.SHOT_AFTER_RELOAD)
        if (typeof out === 'string' && out.includes('"reload":true')) {
          await again
          await run(process.env.SHOT_AFTER_RELOAD)
        }
      }
      await wait(Number(process.env.SHOT_SETTLE_MS || 1500))
    }
    const img = await win.webContents.capturePage()
    fs.writeFileSync(outPng, img.toPNG())
    console.log('[shot] wrote', outPng)
    done(0)
  })
})
setTimeout(() => { console.error("[shot] timed out"); done(2) }, Number(process.env.SHOT_TIMEOUT_MS || 60000))
// Main finds plugins beside its app path; launched from this script that
// would be autonomy/checks, where there are none, so point it at app/.
const appDir = path.resolve(__dirname, '../../../app')
app.getAppPath = () => appDir
require(path.resolve(__dirname, '../../../app/out/main/index.js'))
