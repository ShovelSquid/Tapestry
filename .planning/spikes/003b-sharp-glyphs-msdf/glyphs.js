// Spike 003b — thread letters from a multi-channel SDF atlas generated on first use
// by msdfgen-wasm from font files (Verdana, then Arial Unicode as fallback), drawn as
// instanced quads. Loaded through Node's require: the package's ESM build uses
// extensionless imports that a browser can't resolve.
import { startSpike } from '../003-shared/scene.js'
import { createAtlasGlyphLayer, rasterizeColor, isColorGlyph, CELL, EM_PX, RANGE_PX } from '../003-shared/glyph-layer.js'

const fs = window.require('fs')
const path = window.require('path')
const SPIKES = process.env.TAPESTRY_SPIKES_DIR
const FONTS = ['/System/Library/Fonts/Supplemental/Verdana.ttf', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf']

const PREPROCESS = process.env.TAPESTRY_MSDF_PREPROCESS !== '0'
const counters = { fontLoadMs: 0, reducedClusters: 0, fallbackGlyphs: 0, missing: 0, clipped: 0, loadGlyphMs: 0, generateMs: 0, preprocess: PREPROCESS }

startSpike({
  variant: '003b-sharp-glyphs-msdf',
  label: 'Spike 003b — MSDF atlas (msdfgen-wasm, Verdana + Arial Unicode fallback) + instanced quads',
  async createGlyphLayer(ctx) {
    if (!SPIKES) throw new Error('TAPESTRY_SPIKES_DIR is not set; launch through 003b-sharp-glyphs-msdf/main.cjs')
    // A directory require ignores package.json "exports" and the package has no "main", so require the CJS file itself.
    const { Msdfgen } = window.require(path.join(SPIKES, 'node_modules/msdfgen-wasm/dist/cjs/index.js'))
    const wasm = fs.readFileSync(path.join(SPIKES, 'node_modules/msdfgen-wasm/wasm/msdfgen.wasm'))

    const started = performance.now()
    const generators = []
    for (const file of FONTS) {
      const generator = await Msdfgen.create(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength))
      generator.loadFont(new Uint8Array(fs.readFileSync(file)))
      generators.push(generator)
    }
    counters.fontLoadMs = performance.now() - started

    return createAtlasGlyphLayer({
      ...ctx,
      extraStats: () => ({ ...counters }),
      rasterize(grapheme) {
        if (isColorGlyph(grapheme)) return rasterizeColor(grapheme)
        const codePoints = [...grapheme].map((c) => c.codePointAt(0))
        // msdfgen draws one glyph per code point with no shaping: clusters keep their first code point.
        if (codePoints.length > 1) counters.reducedClusters++
        for (let i = 0; i < generators.length; i++) {
          const generator = generators[i]
          const loadStarted = performance.now()
          generator.loadGlyphs([codePoints[0]], { preprocess: PREPROCESS }) // unloads the previous glyph; the cell is all we keep
          counters.loadGlyphMs += performance.now() - loadStarted
          const glyph = generator.glyphs[0]
          if (!glyph) continue
          if (i > 0) counters.fallbackGlyphs++
          const data = generator.computeGlpyhMsdfData(glyph, { size: EM_PX, range: RANGE_PX })
          if (!data.width || !data.height) return null
          const generateStarted = performance.now()
          const bitmap = generator.generateBitmap(glyph, data) // RGBA bytes, top row first
          counters.generateMs += performance.now() - generateStarted
          const source = new Uint8Array(bitmap.buffer)
          const tw = Math.min(CELL, bitmap.width)
          const th = Math.min(CELL, bitmap.height)
          if (tw < bitmap.width || th < bitmap.height) counters.clipped++
          const pixels = new Uint8Array(CELL * CELL * 4)
          for (let y = 0; y < th; y++) pixels.set(source.subarray(y * bitmap.width * 4, (y * bitmap.width + tw) * 4), y * CELL * 4)
          // msdfgen maps em-space shape to pixels as (shape + translate) × scale, bitmap bottom row at −yTranslate.
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
      },
    })
  },
})
