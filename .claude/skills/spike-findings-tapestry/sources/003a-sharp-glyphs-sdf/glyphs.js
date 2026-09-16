// Spike 003a — thread letters from a single-channel SDF atlas generated on first use
// by @mapbox/tiny-sdf from the browser's own text rendering (so macOS font fallback
// covers scripts Verdana lacks), drawn as instanced quads.
//
// The rasterizer itself lives in ../003-shared/sdf-rasterizer.js so spike 004 can
// reuse exactly this code path.
import { startSpike } from '../003-shared/scene.js'
import { createAtlasGlyphLayer } from '../003-shared/glyph-layer.js'
import { createSdfRasterizer } from '../003-shared/sdf-rasterizer.js'

startSpike({
  variant: '003a-sharp-glyphs-sdf',
  label: 'Spike 003a — SDF atlas (tiny-sdf, browser fonts with fallback) + instanced quads',
  async createGlyphLayer(ctx) {
    const { rasterize, counters } = await createSdfRasterizer({ fontUrl: ctx.fontUrl })
    return createAtlasGlyphLayer({ ...ctx, rasterize, extraStats: () => ({ ...counters }) })
  },
})
