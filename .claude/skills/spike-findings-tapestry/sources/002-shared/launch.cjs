// Shared Electron launcher for spikes 002a and 002b.
//
// Serves .planning/spikes over local HTTP, because troika-three-text loads
// fonts with XMLHttpRequest inside web workers, which file:// pages can't do
// reliably. macOS's Verdana is served at /font/verdana.ttf so both variants use
// the same font without copying it into the repo.
//
//   node_modules/.bin/electron .planning/spikes/002a-glyphs-sdf/main.cjs [--shots | --bench] [--no-typing]
//   node_modules/.bin/electron .planning/spikes/002b-glyphs-canvas-atlas/main.cjs [--shots | --bench]
//   node_modules/.bin/electron .planning/spikes/002-shared/compare.cjs
const { app, BrowserWindow, ipcMain, clipboard } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')

const SPIKES = path.resolve(__dirname, '..')
const FONT = '/System/Library/Fonts/Supplemental/Verdana.ttf'
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
}

module.exports = function launch(variant, page = 'index.html') {
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
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(data)
    })
  })

  const resultsDir = (...parts) => {
    const dir = path.join(SPIKES, variant, 'results', ...parts)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  ipcMain.handle('capture', async (_event, { name, rect }) => {
    const dir = resultsDir('shots')
    const full = await win.webContents.capturePage()
    const files = [path.join(dir, `${name}.png`)]
    fs.writeFileSync(files[0], full.resize({ width: 1400 }).toPNG())
    if (rect) {
      const crop = await win.webContents.capturePage(rect) // device pixels, not resized
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

  // Spike 004 drives real Chromium input through the browser's own pipeline,
  // so typing latency is measured end to end rather than simulated in the page.
  ipcMain.handle('send-input', (_event, events) => {
    for (const input of [].concat(events)) win.webContents.sendInputEvent(input)
    return true
  })

  // sendInputEvent can't trigger clipboard shortcuts (Cmd+V reaches the page as a
  // key event, not a paste), so scripted runs ask the webContents to do the edit.
  ipcMain.handle('edit-command', (_event, { command }) => {
    win.webContents[command]()
    return true
  })

  ipcMain.handle('set-clipboard', (_event, { text }) => {
    clipboard.writeText(text)
    return text.length
  })

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
        title: `Spike ${variant}`,
        backgroundColor: '#0d0f14',
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
      })
      // Scripted runs must not take focus, or keystrokes meant for another app land here.
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
      const query = `bench=${bench ? 1 : 0}&shots=${shots ? 1 : 0}&typing=${flags.has('--no-typing') ? 0 : 1}`
      win.loadURL(`http://127.0.0.1:${port}/${variant}/${page}?${query}`)
      if (scripted) {
        setTimeout(() => {
          console.log('[spike] timed out after 600 s')
          app.exit(2)
        }, 600000)
      }
    })
  })

  app.on('window-all-closed', () => app.quit())
}
