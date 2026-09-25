// electron shot.cjs <zoom> <out.png>: load index.html, wait for RESULT, print it, capture.
'use strict'
const path = require('path'), fs = require('fs')
const { app, BrowserWindow } = require('electron')
const [zoom, out] = process.argv.slice(-2)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(__dirname, 'index.html'), { query: { zoom: String(Number(zoom)) } })
  let res = null
  for (let i = 0; i < 100 && !res; i++) { await new Promise((r) => setTimeout(r, 100)); res = await win.webContents.executeJavaScript('window.RESULT || null') }
  console.log('[ink-bench] zoom', zoom, JSON.stringify(res))
  fs.writeFileSync(path.resolve(out), (await win.webContents.capturePage()).toPNG())
  app.exit(0)
})
setTimeout(() => { console.error('[ink-bench] timed out'); app.exit(2) }, 30000)
