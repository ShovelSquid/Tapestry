// Spike 005 — the WebGL thread inside the app's real React canvas.
//
// Every earlier spike drew the thread in a clean-room page. This one mounts the
// app's ACTUAL components — app/src/renderer/components/Canvas.tsx, NoteCard.tsx
// and App.css, imported from the source tree, not copied — with a WebGL thread
// layer and the typer over them (Phase 2.3 D-09).
//
// Why a Vite dev server, when every other spike uses an import map and no
// bundler (CONVENTIONS "Stack"): the app is written in TSX and cannot be loaded
// by a browser unchanged. Copying the components into the spike would test a
// replica, which is the one thing this spike exists to avoid. Vite, react and
// @vitejs/plugin-react are already installed at the workspace root (the repo is
// an npm workspace, which is why app/node_modules is empty), so this costs no
// install and touches no package.json.
//
//   node_modules/.bin/electron .planning/spikes/005-thread-in-real-app/main.cjs
//   node_modules/.bin/electron .planning/spikes/005-thread-in-real-app/main.cjs --bench
//   node_modules/.bin/electron .planning/spikes/005-thread-in-real-app/main.cjs --shots
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const SPIKE = __dirname
const SPIKES = path.resolve(SPIKE, '..')
const ROOT = path.resolve(SPIKES, '..', '..') // the repo / workspace root
const FONT = '/System/Library/Fonts/Supplemental/Verdana.ttf'

const flags = new Set(process.argv.slice(2))
const bench = flags.has('--bench')
const shots = flags.has('--shots')
const scripted = bench || shots

let win = null
let vite = null

// The glyph rasterizer registers a FontFace from this URL, exactly as spikes
// 003/004 do through their static launcher.
const fontPlugin = {
  name: 'spike-font',
  configureServer(server) {
    server.middlewares.use('/font/verdana.ttf', (_req, res) => {
      res.setHeader('Content-Type', 'font/ttf')
      res.setHeader('Cache-Control', 'no-store')
      fs.createReadStream(FONT).pipe(res)
    })
  },
}

const resultsDir = (...parts) => {
  const dir = path.join(SPIKE, 'results', ...parts)
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

// Real Chromium input, as in spike 004: panning and typing are measured through
// the browser's own pipeline rather than synthesised in the page.
ipcMain.handle('send-input', (_event, events) => {
  for (const input of [].concat(events)) win.webContents.sendInputEvent(input)
  return true
})

ipcMain.handle('memory', async () => (await process.getProcessMemoryInfo()).private / 1024)

ipcMain.on('done', (_event, { lines }) => {
  console.log('\n' + lines.join('\n'))
  app.quit()
})

async function boot() {
  // Dynamic import: Vite 5 removed the CJS Node API, and a bare specifier in
  // import() resolves from this file, finding the workspace root's install.
  const { createServer } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default

  vite = await createServer({
    configFile: false,
    root: SPIKE,
    // The app's source lives outside this root, so the dev server must be
    // allowed to read the workspace. Bare imports still resolve normally:
    // react/react-dom come from the root install, three and the ProseMirror
    // packages from .planning/spikes/node_modules.
    server: { port: 0, strictPort: false, fs: { allow: [ROOT] } },
    // The app's components resolve prosemirror and react upward to the
    // workspace root; this spike's own modules resolve them to
    // .planning/spikes/node_modules. Same versions, two module instances — and
    // two instances of prosemirror-model make a schema built by one unreadable
    // to the other ("Schema is missing its top node type ('doc')"). dedupe
    // guarantees exactly one copy per package name.
    resolve: {
      dedupe: [
        'react', 'react-dom',
        'prosemirror-model', 'prosemirror-state', 'prosemirror-view',
        'prosemirror-transform', 'prosemirror-keymap', 'prosemirror-commands',
        'prosemirror-history', 'prosemirror-schema-basic', 'prosemirror-schema-list',
        'orderedmap', 'rope-sequence', 'w3c-keyname',
      ],
    },
    plugins: [react(), fontPlugin],
    clearScreen: false,
    logLevel: 'warn',
  })
  await vite.listen()
  const { port } = vite.httpServer.address()

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    title: 'Spike 005 — thread in the real app',
    backgroundColor: '#F7F5F0',
    // nodeIntegration is on because scripted runs need ipcRenderer (capture,
    // send-input) and because 003-shared/scene.js reaches for window.require at
    // import time. The real app runs the opposite way (nodeIntegration false,
    // contextIsolation and sandbox true, app/src/main/index.ts), so this spike
    // measures rendering and lifecycle fidelity, NOT the app's security posture.
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  })
  // Scripted runs must not take focus (spike 001): keystrokes meant for another
  // app would otherwise land here and change what is measured.
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

  win.loadURL(`http://127.0.0.1:${port}/?bench=${bench ? 1 : 0}&shots=${shots ? 1 : 0}`)

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`[did-fail-load] ${code} ${desc} ${url}`)
  })

  if (scripted) {
    // Short by default: a hung scripted run should cost seconds to diagnose,
    // not the ten minutes spike 003b lost to a silent page throw. The benchmark
    // needs longer — it rebuilds the 8 h history on each of twenty open/close
    // cycles — and a page that throws now reports it rather than idling.
    const limitMs = bench ? 300000 : 120000
    setTimeout(() => {
      console.log(`[spike] timed out after ${limitMs / 1000} s`)
      app.exit(2)
    }, limitMs)
  }
}

app.whenReady().then(boot)
app.on('window-all-closed', () => app.quit())
app.on('quit', () => vite && vite.close())
