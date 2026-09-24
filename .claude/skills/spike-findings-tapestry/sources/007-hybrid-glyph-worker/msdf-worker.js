// Spike 007 — MSDF generation, off the main thread.
//
// This is spike 003b's rasterize() moved verbatim into a Web Worker. 003b
// measured 7.7–8.1 ms per glyph with a 22.6 ms worst case on the main thread,
// close enough to a frame that one bad glyph drops it; a large paste needing
// hundreds of new glyphs is far worse. Nothing here is new maths — the question
// is whether the same work is invisible when it happens somewhere else.
//
// The worker gets Node's require because the window sets nodeIntegrationInWorker
// (msdfgen-wasm ships CommonJS whose ESM build uses extensionless imports a
// browser cannot resolve, and a directory require ignores "exports" when the
// package has no "main" — spike 003b).

const CELL = 64
const EM_PX = 36
const RANGE_PX = 8
const FONTS = [
  '/System/Library/Fonts/Supplemental/Verdana.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
]

let generators = null
const counters = { fontLoadMs: 0, reducedClusters: 0, fallbackGlyphs: 0, missing: 0, clipped: 0, generated: 0, totalMs: 0, maxMs: 0 }

function init(spikesDir) {
  const fs = require('fs')
  const path = require('path')
  const { Msdfgen } = require(path.join(spikesDir, 'node_modules/msdfgen-wasm/dist/cjs/index.js'))
  const wasm = fs.readFileSync(path.join(spikesDir, 'node_modules/msdfgen-wasm/wasm/msdfgen.wasm'))
  const bytes = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)

  const started = performance.now()
  return Promise.all(
    FONTS.map(async (file) => {
      const generator = await Msdfgen.create(bytes.slice(0))
      generator.loadFont(new Uint8Array(fs.readFileSync(file)))
      return generator
    })
  ).then((made) => {
    generators = made
    counters.fontLoadMs = performance.now() - started
  })
}

/** One MSDF cell, or null when no font has the glyph. Mirrors spike 003b. */
function rasterize(grapheme) {
  const codePoints = [...grapheme].map((c) => c.codePointAt(0))
  // msdfgen draws one glyph per code point with no shaping, so a cluster keeps
  // only its first code point (003b: "स्ते" renders as "स").
  if (codePoints.length > 1) counters.reducedClusters++

  for (let i = 0; i < generators.length; i++) {
    const generator = generators[i]
    generator.loadGlyphs([codePoints[0]], { preprocess: true }) // unloads the previous glyph
    const glyph = generator.glyphs[0]
    if (!glyph) continue
    if (i > 0) counters.fallbackGlyphs++
    const data = generator.computeGlpyhMsdfData(glyph, { size: EM_PX, range: RANGE_PX })
    if (!data.width || !data.height) return null
    const bitmap = generator.generateBitmap(glyph, data) // RGBA, top row first
    const source = new Uint8Array(bitmap.buffer)
    const tw = Math.min(CELL, bitmap.width)
    const th = Math.min(CELL, bitmap.height)
    if (tw < bitmap.width || th < bitmap.height) counters.clipped++
    const pixels = new Uint8Array(CELL * CELL * 4)
    for (let y = 0; y < th; y++) {
      pixels.set(source.subarray(y * bitmap.width * 4, (y * bitmap.width + tw) * 4), y * CELL * 4)
    }
    return {
      kind: 1,
      pixels,
      tw,
      th,
      x0: -data.xTranslate,
      y0: -data.yTranslate + (bitmap.height - th) / EM_PX,
      advance: glyph.advance,
      edge: 0.5,
      range: RANGE_PX,
    }
  }
  counters.missing++
  return null
}

self.onmessage = async (e) => {
  const msg = e.data
  if (msg.type === 'init') {
    try {
      await init(msg.spikesDir)
      self.postMessage({ type: 'ready', counters: { ...counters } })
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.stack) || err) })
    }
    return
  }
  if (msg.type === 'rasterize') {
    const started = performance.now()
    let cell = null
    let error = null
    try {
      cell = rasterize(msg.grapheme)
    } catch (err) {
      error = String((err && err.message) || err)
    }
    const ms = performance.now() - started
    counters.generated++
    counters.totalMs += ms
    counters.maxMs = Math.max(counters.maxMs, ms)
    // The pixel buffer is transferred, not copied: 16 KB per glyph would
    // otherwise be cloned on every message.
    const payload = { type: 'cell', id: msg.id, grapheme: msg.grapheme, cell, ms, error, counters: { ...counters } }
    self.postMessage(payload, cell ? [cell.pixels.buffer] : [])
  }
}
