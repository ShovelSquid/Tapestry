// Browser-drawn SDF cells for the shared glyph layer: @mapbox/tiny-sdf over the
// browser's own text rendering, so macOS font fallback and grapheme shaping come
// for free. Extracted from spike 003a so spike 004 can reuse the measured code
// instead of copying it. Colour emoji go through rasterizeColor.
//
// Verdict from 003: fast (about 0.5 ms per glyph) and Unicode-complete, but the
// distance field comes from a 36 px raster, so edges ripple above ~120 px per em.
// MSDF from font files (003b) is what stays sharp when magnified.
import TinySDF from '@mapbox/tiny-sdf'
import { rasterizeColor, isColorGlyph, CELL, EM_PX, RANGE_PX } from './glyph-layer.js'

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

/**
 * @param {string} fontUrl  font to register as the primary family
 * @param {string} family   CSS family list; later entries and the browser's own fallback cover the rest of Unicode
 * @returns {Promise<{ rasterize: (grapheme: string) => object|null, counters: { clipped: number } }>}
 */
export async function createSdfRasterizer({ fontUrl, family = 'SpikeVerdana, sans-serif' }) {
  const face = new FontFace('SpikeVerdana', `url(${fontUrl})`)
  await face.load()
  document.fonts.add(face)
  const sdf = new DomTinySDF({ fontSize: EM_PX, buffer: BUFFER, radius: RADIUS, cutoff: CUTOFF, fontFamily: family })
  const counters = { clipped: 0 }

  return {
    counters,
    rasterize(grapheme) {
      if (isColorGlyph(grapheme)) return rasterizeColor(grapheme)
      const r = sdf.draw(grapheme)
      if (!r.glyphWidth || !r.glyphHeight) return null
      const tw = Math.min(CELL, r.width)
      const th = Math.min(CELL, r.height)
      if (tw < r.width || th < r.height) counters.clipped++
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
  }
}
