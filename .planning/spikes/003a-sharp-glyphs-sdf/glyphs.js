// Spike 003a — thread letters from a single-channel SDF atlas generated on first use
// by @mapbox/tiny-sdf from the browser's own text rendering (so macOS font fallback
// covers scripts Verdana lacks), drawn as instanced quads.
import TinySDF from '@mapbox/tiny-sdf'
import { startSpike } from '../003-shared/scene.js'
import { createAtlasGlyphLayer, rasterizeColor, isColorGlyph, CELL, EM_PX, RANGE_PX } from '../003-shared/glyph-layer.js'

const BUFFER = RANGE_PX
const RADIUS = RANGE_PX
const CUTOFF = 0.25

// tiny-sdf prefers OffscreenCanvas; a DOM canvas is certain to see the FontFace added to document.fonts.
class DomTinySDF extends TinySDF {
  _createCanvas(size) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    return canvas
  }
}

let clipped = 0

startSpike({
  variant: '003a-sharp-glyphs-sdf',
  label: 'Spike 003a — SDF atlas (tiny-sdf, browser fonts with fallback) + instanced quads',
  async createGlyphLayer(ctx) {
    const face = new FontFace('SpikeVerdana', `url(${ctx.fontUrl})`)
    await face.load()
    document.fonts.add(face)
    const sdf = new DomTinySDF({ fontSize: EM_PX, buffer: BUFFER, radius: RADIUS, cutoff: CUTOFF, fontFamily: 'SpikeVerdana, sans-serif' })

    return createAtlasGlyphLayer({
      ...ctx,
      extraStats: () => ({ clipped }),
      rasterize(grapheme) {
        if (isColorGlyph(grapheme)) return rasterizeColor(grapheme)
        const r = sdf.draw(grapheme)
        if (!r.glyphWidth || !r.glyphHeight) return null
        const tw = Math.min(CELL, r.width)
        const th = Math.min(CELL, r.height)
        if (tw < r.width || th < r.height) clipped++
        const pixels = new Uint8Array(CELL * CELL * 4)
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const v = r.data[y * r.width + x]
            const o = (y * CELL + x) * 4
            pixels[o] = pixels[o + 1] = pixels[o + 2] = v
            pixels[o + 3] = 255
          }
        }
        // Bitmap row 0 is (glyphTop + buffer) px above the baseline; column 0 is (glyphLeft − buffer) px right of the origin.
        return {
          kind: 0,
          pixels,
          tw,
          th,
          x0: (r.glyphLeft - BUFFER) / EM_PX,
          y0: (r.glyphTop + BUFFER - th) / EM_PX,
          advance: r.glyphAdvance / EM_PX,
          edge: 1 - CUTOFF,
          range: RADIUS,
        }
      },
    })
  },
})
