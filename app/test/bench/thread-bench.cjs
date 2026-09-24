#!/usr/bin/env node
// Scripted Electron harness for the thread stage (RESEARCH Pattern 4;
// CONVENTIONS.md's --bench/--shots modes, ported from spike 001's
// main.cjs/thread.js measurement code). Exercises the real production
// stage modules (bench-entry.ts) against seeded synthetic history through
// a spike-local Vite dev server (CONVENTIONS.md: "a spike that must load
// the app's own TSX ... copying the components instead would test a
// replica rather than the app").
//
// Invocation (must go through `npm run`, never `npm exec` -- see
// app/package.json's `bench` script comment for why):
//   npm --prefix app run bench -- --bench   scripted 1h/8h/8h-continuous benchmark, writes JSON, quits
//   npm --prefix app run bench -- --shots   scripted screenshots, quits
//   npm --prefix app run bench              interactive: opens the bench page for manual poking
'use strict'
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { createServer } = require('vite')
const { generateHistory } = require('./synthetic-history.cjs')

const APP_ROOT = path.resolve(__dirname, '..', '..') // app/
const RESULTS_DIR = path.join(__dirname, 'results')

const args = process.argv.slice(2)
const bench = args.includes('--bench')
const shots = args.includes('--shots')
const scripted = bench || shots

// Scripted runs open with showInactive() and never take focus, or
// keystrokes meant for another app would land here and change what's
// measured (spike 001's own rule, carried into every later spike).
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function writeResult(name, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const file = path.join(RESULTS_DIR, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  return file
}

async function waitForBenchReady(win) {
  await win.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const check = () => (window.__bench && window.__bench.ready) ? resolve() : setTimeout(check, 20);
      check();
    })`,
  )
}

async function measureFrames(win, ms) {
  await win.webContents.executeJavaScript('window.__bench.startCollecting()')
  await wait(ms)
  return win.webContents.executeJavaScript('window.__bench.stopCollecting()')
}

const SCENARIOS = [
  ['1h', 1, false],
  ['8h', 8, false],
  ['8h-continuous', 8, true],
]

async function runBench(win) {
  const results = []
  for (const [label, hours, continuous] of SCENARIOS) {
    const build = await win.webContents.executeJavaScript(`window.__bench.buildLoad(${hours}, ${continuous})`)
    await wait(1000) // 1s warm-up (CONVENTIONS.md)
    const stats = await measureFrames(win, 4000) // ~4s measurement window
    const gpuBufferMB = await win.webContents.executeJavaScript('window.__bench.gpuBufferMB()')
    const memory = await win.webContents.executeJavaScript('window.__bench.memory()')
    const result = {
      load: label,
      buildMs: build.buildMs,
      dots: build.dots,
      glyphs: build.glyphs,
      gpuBufferMB,
      privateMB: memory.privateMB,
      ...stats,
    }
    results.push(result)
    console.log(
      `${label.padEnd(14)} fps=${stats.fps.toFixed(1).padEnd(6)} p95=${stats.frameP95.toFixed(1).padEnd(6)}ms ` +
        `drop=${(stats.dropRate * 100).toFixed(2).padEnd(5)}% private=${memory.privateMB.toFixed(0)}MB ` +
        `gpuBuf=${gpuBufferMB.toFixed(1)}MB glyphs=${build.glyphs}`,
    )
  }

  const file = writeResult('bench', { results })
  console.log(`\nResults written to ${file}`)

  // The 8h-continuous scenario is the phase's reference load (UI-SPEC
  // "Costs carried forward as constraints"): median fps >= 55, drop rate
  // <= 1%, private memory <= 150MB.
  const reference = results.find((r) => r.load === '8h-continuous')
  const failures = []
  if (!reference) failures.push('8h-continuous scenario did not run')
  else {
    if (reference.fps < 55) failures.push(`median fps ${reference.fps.toFixed(1)} < 55`)
    if (reference.dropRate > 0.01) failures.push(`drop rate ${(reference.dropRate * 100).toFixed(2)}% > 1%`)
    if (reference.privateMB > 150) failures.push(`private memory ${reference.privateMB.toFixed(0)}MB > 150MB`)
  }
  if (failures.length > 0) {
    console.error(`\nBENCH FAILED:\n  ${failures.map((f) => `- ${f}`).join('\n  ')}`)
    return 1
  }
  return 0
}

async function runShots(win) {
  const shotsDir = path.join(RESULTS_DIR, 'shots')
  fs.mkdirSync(shotsDir, { recursive: true })
  const files = []
  for (const [name, hours, continuous] of [
    ['a-1h', 1, false],
    ['b-8h-continuous', 8, true],
  ]) {
    await win.webContents.executeJavaScript(`window.__bench.buildLoad(${hours}, ${continuous})`)
    await wait(700)
    const image = await win.webContents.capturePage()
    const file = path.join(shotsDir, `${name}.png`)
    fs.writeFileSync(file, image.resize({ width: 1400 }).toPNG())
    files.push(file)
  }
  console.log(`\nScreenshots:\n${files.join('\n')}`)
  return 0
}

async function main() {
  await app.whenReady()

  ipcMain.handle('bench-generate-history', (_event, hours, continuous) => generateHistory(hours, continuous))

  // A fixed, arbitrary port: Vite's `port: 0` config is not reliably
  // honored by `createServer`/`listen()` (it fell back to the default 5173
  // rather than an OS-assigned port), so this harness picks its own
  // unlikely-to-collide port instead of parsing the listening socket.
  const port = 57632
  const server = await createServer({ root: APP_ROOT, server: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' })
  await server.listen()

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#F7F5F0',
    title: 'Tapestry thread stage bench',
    webPreferences: {
      // Bench-only window, never shipped: nodeIntegration lets the page
      // reach ipcRenderer (bench-entry.ts) and process.getProcessMemoryInfo()
      // directly, matching every spike's own measurement path.
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  })
  win.once('ready-to-show', () => (scripted ? win.showInactive() : win.show()))
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 2) console.log(`[page ${level === 3 ? 'error' : 'warn'}] ${message} (${path.basename(String(source))}:${line})`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[page crashed]', details)
    app.exit(1)
  })

  await win.loadURL(`http://127.0.0.1:${port}/test/bench/index.html`)
  await waitForBenchReady(win)

  let exitCode = 0
  if (bench) exitCode = await runBench(win)
  else if (shots) exitCode = await runShots(win)
  else {
    console.log(`Interactive bench page: http://127.0.0.1:${port}/test/bench/index.html`)
    win.show()
    return // leave the window and server running for interactive use
  }

  await server.close()
  app.exit(exitCode)
}

if (scripted) {
  // Keep a hang cheap to diagnose (CONVENTIONS.md: "about 120s ... raise it
  // only for work that genuinely needs it"). An 8h-continuous build plus a
  // 4s measurement window per scenario is well under a minute in total.
  setTimeout(() => {
    console.error('[thread-bench] timed out after 120s')
    app.exit(2)
  }, 120000)
}

main().catch((err) => {
  console.error(err)
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (scripted) app.quit()
})
