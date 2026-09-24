// Spike 007 — a cheap glyph now, a sharp glyph a moment later.
//
// Spike 003 left two rasterizers with opposite faults: browser-SDF appears in
// ~0.5 ms but ripples above 120 px (003a), MSDF is razor-sharp but costs
// ~8 ms and up to 22.6 ms per glyph (003b) — too close to a frame. Both 003
// READMEs name the hybrid as untested: show the cheap cell at once, generate the
// sharp one off the main thread, swap it in.
//
//   node_modules/.bin/electron .planning/spikes/007-hybrid-glyph-worker/main.cjs
//   node_modules/.bin/electron .planning/spikes/007-hybrid-glyph-worker/main.cjs --bench
//   node_modules/.bin/electron .planning/spikes/007-hybrid-glyph-worker/main.cjs --shots
//
// This spike needs its own launcher rather than 002-shared/launch.cjs because
// msdfgen-wasm is a CommonJS module loaded by require(), and a Web Worker only
// gets Node built-ins when the window sets nodeIntegrationInWorker. That option
// works independently of nodeIntegration but requires sandbox to stay false, and
// Electron's own modules are unavailable inside a worker — fs and path are all
// msdfgen-wasm needs. https://www.electronjs.org/docs/latest/tutorial/multithreading
const { app, BrowserWindow, ipcMain, clipboard } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')

const SPIKE_NAME = '007-hybrid-glyph-worker'
const SPIKES = path.resolve(__dirname, '..')
const FONT = '/System/Library/Fonts/Supplemental/Verdana.ttf'
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.cjs': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
}

const flags = new Set(process.argv.slice(2))
const bench = flags.has('--bench')
const shots = flags.has('--shots')
const scripted = bench || shots
let win = null

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const file = url === '/font/verdana.ttf' ? FONT : path.join(SPIKES, path.normalize(url))
  if (file !== FONT && !file.startsWith(SPIKES + path.sep)) {
    res.writeHead(403)
    return res.end()
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(data)
  })
})

const resultsDir = (...parts) => {
  const dir = path.join(SPIKES, SPIKE_NAME, 'results', ...parts)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

ipcMain.handle('capture', async (_event, { name, rect }) => {
  const dir = resultsDir('shots')
  const full = await win.webContents.capturePage()
  const files = [path.join(dir, `${name}.png`)]
  fs.writeFileSync(files[0], full.resize({ width: 1400 }).toPNG())
  if (rect) {
    const crop = await win.webContents.capturePage(rect)
    files.push(path.join(dir, `${name}-crop.png`))
    fs.writeFileSync(files[1], crop.toPNG())
  }
  return files
})

ipcMain.handle('write-result', (_event, { name, data }) => {
  const file = path.join(resultsDir(), `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  return file
})

ipcMain.handle('set-clipboard', (_event, { text }) => {
  clipboard.writeText(text)
  return text.length
})

// sendInputEvent can't trigger clipboard shortcuts (spike 004), so a scripted
// paste asks the webContents to perform the edit.
ipcMain.handle('edit-command', (_event, { command }) => {
  win.webContents[command]()
  return true
})

ipcMain.handle('send-input', (_event, events) => {
  for (const input of [].concat(events)) win.webContents.sendInputEvent(input)
  return true
})

ipcMain.handle('memory', async () => (await process.getProcessMemoryInfo()).private / 1024)

ipcMain.on('done', (_event, { lines }) => {
  console.log('\n' + lines.join('\n'))
  app.quit()
})

app.whenReady().then(() => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: false,
      title: 'Spike 007 — hybrid glyphs',
      backgroundColor: '#0d0f14',
      webPreferences: {
        nodeIntegration: true,
        nodeIntegrationInWorker: true, // the worker requires msdfgen-wasm
        contextIsolation: false,
        sandbox: false, // nodeIntegrationInWorker is ignored when sandboxed
        backgroundThrottling: false,
      },
    })
    // Scripted runs must not take focus (spike 001).
    win.once('ready-to-show', () => (scripted ? win.showInactive() : win.show()))
    win.webContents.on('console-message', (_event, level, message, line, source) => {
      if (level >= 2 && !/Electron Security Warning/.test(message)) {
        console.log(`[page ${level === 3 ? 'error' : 'warn'}] ${message} (${path.basename(source)}:${line})`)
      }
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      console.log('[page crashed]', details)
      app.exit(1)
    })

    // The page reaches Node modules by absolute path (CONVENTIONS): pages are
    // served over HTTP, so the spikes directory arrives through the environment.
    process.env.TAPESTRY_SPIKES_DIR = SPIKES
    win.loadURL(`http://127.0.0.1:${port}/${SPIKE_NAME}/index.html?bench=${bench ? 1 : 0}&shots=${shots ? 1 : 0}`)

    if (scripted) {
      setTimeout(() => {
        console.log('[spike] timed out after 300 s')
        app.exit(2)
      }, 300000)
    }
  })
})

app.on('window-all-closed', () => app.quit())
