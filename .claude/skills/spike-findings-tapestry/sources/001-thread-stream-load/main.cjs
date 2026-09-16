// Spike 001 launcher: one Electron window with background throttling off.
//
// From the repo root:
//   node_modules/.bin/electron .planning/spikes/001-thread-stream-load/main.cjs          interactive
//   node_modules/.bin/electron .planning/spikes/001-thread-stream-load/main.cjs --bench  scripted benchmark, then quit
//   node_modules/.bin/electron .planning/spikes/001-thread-stream-load/main.cjs --shots  capture the views to check by eye, then quit
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const bench = process.argv.includes('--bench')
const shots = process.argv.includes('--shots')
let win = null

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Spike 001 — thread stream load',
    backgroundColor: '#0d0f14',
    show: false,
    webPreferences: {
      // Spike only: lets the page write its own result files.
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  })
  win.once('ready-to-show', () => (bench || shots ? win.showInactive() : win.show()))
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 2) console.log(`[page ${level === 3 ? 'error' : 'warn'}] ${message} (${path.basename(source)}:${line})`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.log('[page crashed]', details)
    app.exit(1)
  })
  win.loadFile(path.join(__dirname, 'index.html'), { query: { bench: bench ? '1' : '0', shots: shots ? '1' : '0' } })
  if (bench || shots) {
    setTimeout(() => {
      console.log('[bench] timed out after 300 s')
      app.exit(2)
    }, 300000)
  }
})

ipcMain.handle('capture', async (_event, name) => {
  const image = await win.webContents.capturePage()
  const dir = path.join(__dirname, 'results', 'shots')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.png`)
  fs.writeFileSync(file, image.resize({ width: 1400 }).toPNG())
  return file
})

ipcMain.on('shots-done', (_event, files) => {
  console.log(`\nScreenshots:\n${files.join('\n')}`)
  app.quit()
})

ipcMain.on('bench-done', (_event, { file, results }) => {
  const pad = (v, n) => String(v).padEnd(n)
  console.log(`\nResults written to ${file}\n`)
  console.log(
    pad('mode', 11) + pad('load', 14) + pad('view', 11) + pad('fps', 6) + pad('p95ms', 7) + pad('p99ms', 7) +
      pad('drop%', 7) + pad('workMed', 8) + pad('workP95', 8) + pad('privMB', 8) + pad('gpuBufMB', 9) + 'dots'
  )
  for (const r of results) {
    console.log(
      pad(r.mode, 11) + pad(r.load, 14) + pad(r.view, 11) + pad(r.fps.toFixed(1), 6) + pad(r.frameP95.toFixed(1), 7) +
        pad(r.frameP99.toFixed(1), 7) + pad((r.dropRate * 100).toFixed(1), 7) + pad(r.workMedian.toFixed(2), 8) +
        pad(r.workP95.toFixed(2), 8) + pad(r.privateMB.toFixed(0), 8) + pad(r.gpuBufferMB.toFixed(1), 9) + r.dots
    )
  }
  app.quit()
})

app.on('window-all-closed', () => app.quit())
