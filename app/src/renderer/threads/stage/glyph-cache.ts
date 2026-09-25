/**
 * The app-scoped glyph atlas cache (RESEARCH Pattern 4; spike 003-shared
 * `glyph-layer.js`, `sdf-rasterizer.js`). One cache for the whole app,
 * shared across every thread and every overlay open, persisted for the
 * session — never rebuilt per overlay. Spike 003b measured an 8h build at
 * 1.63s against a warm atlas versus about 5.4s cold; that difference is the
 * whole reason this module is a singleton rather than something
 * `ThreadOverlay` owns.
 *
 * **MSDF deferred** (Kaelen, 2026-09-16, "lets skip it for now"): every
 * letter uses its browser-SDF cell (`@mapbox/tiny-sdf`) permanently. `kind`
 * 1 (MSDF) stays reserved in the atlas-entry shape and the glyph shader, but
 * this module never produces it. To restore MSDF: add a Web Worker running
 * `msdfgen-wasm`, generating a `kind: 1` cell per grapheme and upgrading an
 * existing instance's `aKind`/`aQuad`/`aUv` in place once the cell arrives
 * (spike 007's `upgrade()`).
 *
 * **Atlas paging (Known Stub, open risk).** A single 2048px atlas page
 * holds 1024 cells (`ATLAS / CELL` squared). This cache allocates into a
 * pool of up to `MAX_PAGES` pages (4096 cells total) before it starts
 * returning `null` for new graphemes rather than silently corrupting
 * another cell — the same honest "blank" behavior `glyph-layer.js`'s own
 * overflow counter uses. Full LRU eviction across a page is **not**
 * implemented here: the spike-findings skill's own "Open Risks Carried Into
 * the Build" names this exact problem as unsolved ("LRU eviction thrashes
 * past 1024 cells... an evicted letter disappears from the line entirely"),
 * and spike 007 (hybrid-glyph-worker) is the queued spike that verdicts it
 * (UI-SPEC "Queued spikes that touch this contract"). A thread written
 * entirely in one script rarely needs more than a few hundred distinct
 * graphemes; 4096 is a generous multiple of the single-page ceiling spike
 * 003 shipped with.
 */

import * as THREE from 'three'
import TinySDF from '@mapbox/tiny-sdf'

export const CELL = 64
export const ATLAS = 2048
export const EM_PX = 36 // glyph em size inside a cell
export const RANGE_PX = 8 // distance range in texels (SDF radius)
const COLS = ATLAS / CELL
const CELLS_PER_PAGE = COLS * COLS // 1024
const MAX_PAGES = 4 // see "Atlas paging" note above

const COLOR_GLYPH_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

/** Colour emoji cannot be a distance field; both this module and a later
 * MSDF worker draw them as ordinary colour bitmap cells (`kind: 2`). */
export function isColorGlyph(grapheme: string): boolean {
  return COLOR_GLYPH_RE.test(grapheme)
}

// ---------------------------------------------------------------------------
// The rasterize(grapheme) -> cell contract (glyph-layer.js:1-24)
// ---------------------------------------------------------------------------

/**
 * kind 0 = single-channel SDF (red), 1 = MSDF (median of rgb, reserved,
 * never produced while deferred), 2 = colour bitmap (emoji).
 */
export interface RasterizedCell {
  kind: 0 | 1 | 2
  /** CELL x CELL x 4, top row first; the glyph occupies the top-left tw x th texels. */
  pixels: Uint8Array
  tw: number
  th: number
  /** Bottom-left corner of those texels in em units, relative to the glyph origin on the baseline. */
  x0: number
  y0: number
  /** Em units. */
  advance: number
  /** Encoded value at the outline (0..1). */
  edge: number
  /** Texels per unit of encoded value. */
  range: number
}

/** One letter's place in the atlas, ready to write into a `GlyphLayer`
 * instance (glyph-layer.js's `entryFor` return shape). */
export interface GlyphAtlasEntry {
  page: number
  /** [x0, y0, tw/EM_PX, th/EM_PX] centred on the keystroke's point. */
  quad: [number, number, number, number]
  /** [u0, vBottom, u1, vTop]. */
  uv: [number, number, number, number]
  /** [kind, edge, range]. */
  dist: [number, number, number]
}

// ---------------------------------------------------------------------------
// Colour emoji (glyph-layer.js:34-61, ported)
// ---------------------------------------------------------------------------

let colorCanvas: HTMLCanvasElement | null = null

function rasterizeColor(grapheme: string): RasterizedCell | null {
  colorCanvas ??= Object.assign(document.createElement('canvas'), { width: CELL, height: CELL })
  const ctx = colorCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.clearRect(0, 0, CELL, CELL)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  let size = EM_PX
  ctx.font = `${size}px "Apple Color Emoji"`
  let m = ctx.measureText(grapheme)
  const fit = Math.min(
    1,
    (CELL - 4) / Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight),
    (CELL - 4) / Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent),
  )
  if (fit < 1) {
    size *= fit
    ctx.font = `${size}px "Apple Color Emoji"`
    m = ctx.measureText(grapheme)
  }
  const left = Math.floor(-m.actualBoundingBoxLeft)
  const top = Math.ceil(m.actualBoundingBoxAscent)
  const tw = Math.min(CELL, Math.ceil(m.actualBoundingBoxRight) - left + 2)
  const th = Math.min(CELL, top + Math.ceil(m.actualBoundingBoxDescent) + 2)
  if (tw <= 2 || th <= 2) return null
  ctx.fillText(grapheme, 1 - left, 1 + top)
  const pixels = new Uint8Array(ctx.getImageData(0, 0, CELL, CELL).data)
  return {
    kind: 2,
    pixels,
    tw,
    th,
    x0: (left - 1) / EM_PX,
    y0: (1 + top - th) / EM_PX,
    advance: m.width / EM_PX,
    edge: 0,
    range: 0,
  }
}

// ---------------------------------------------------------------------------
// Browser-SDF (sdf-rasterizer.js, ported): @mapbox/tiny-sdf over the
// browser's own text rendering, so macOS font fallback and grapheme shaping
// come for free (this is the permanent path while MSDF is deferred).
// ---------------------------------------------------------------------------

const SDF_BUFFER = RANGE_PX
const SDF_RADIUS = RANGE_PX
const SDF_CUTOFF = 0.25

class DomTinySDF extends TinySDF {
  // tiny-sdf prefers OffscreenCanvas; a DOM canvas is certain to see the
  // FontFace added to document.fonts (sdf-rasterizer.js).
  protected _createCanvas(size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    return canvas
  }
}

function rasterizeSdf(sdf: TinySDF, grapheme: string): RasterizedCell | null {
  const r = sdf.draw(grapheme)
  if (!r.glyphWidth || !r.glyphHeight) return null
  const tw = Math.min(CELL, r.width)
  const th = Math.min(CELL, r.height)
  const pixels = new Uint8Array(CELL * CELL * 4)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const v = r.data[y * r.width + x]
      const o = (y * CELL + x) * 4
      pixels[o] = pixels[o + 1] = pixels[o + 2] = v
      pixels[o + 3] = 255
    }
  }
  // Bitmap row 0 is (glyphTop + buffer) px above the baseline; column 0 is
  // (glyphLeft - buffer) px right of the origin.
  return {
    kind: 0,
    pixels,
    tw,
    th,
    x0: (r.glyphLeft - SDF_BUFFER) / EM_PX,
    y0: (r.glyphTop + SDF_BUFFER - th) / EM_PX,
    advance: r.glyphAdvance / EM_PX,
    edge: 1 - SDF_CUTOFF,
    range: SDF_RADIUS,
  }
}

// ---------------------------------------------------------------------------
// GlyphCache
// ---------------------------------------------------------------------------

interface AtlasPage {
  data: Uint8Array
  texture: THREE.DataTexture
  nextIndex: number
  pendingFull: boolean
}

function createPage(): AtlasPage {
  const data = new Uint8Array(ATLAS * ATLAS * 4)
  const texture = new THREE.DataTexture(data, ATLAS, ATLAS, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return { data, texture, nextIndex: 0, pendingFull: true }
}

/**
 * The typer's own font stack (`App.css`'s `body` rule), reused here so the
 * stage's browser-SDF cells and the DOM typer agree on a typeface without
 * needing a bundled font file loaded first (RESEARCH: "thread letters and
 * the note typer use the same font files, or the same word looks like two
 * typefaces"). **Known Stub (TA-25 not yet complete):** this is a system
 * font-stack match, not yet the bundled single-file face RESEARCH and
 * UI-SPEC call for -- CONVENTIONS.md's own spikes referenced system fonts
 * by absolute path rather than shipping one in the repo, and no
 * redistributable single-file face is bundled with the app yet. `loadFont`
 * below is the seam a later plan uses to switch to one (and must then
 * confirm that face's licence permits redistribution inside the app).
 */
const SYSTEM_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export class GlyphCache {
  private pages: AtlasPage[] = [createPage()]
  private cache = new Map<string, GlyphAtlasEntry | null>()
  private sdf: TinySDF = new DomTinySDF({
    fontSize: EM_PX,
    buffer: SDF_BUFFER,
    radius: SDF_RADIUS,
    cutoff: SDF_CUTOFF,
    fontFamily: SYSTEM_FONT_STACK,
  })
  private scratch = (() => {
    const t = new THREE.DataTexture(new Uint8Array(CELL * CELL * 4), CELL, CELL, THREE.RGBAFormat)
    t.minFilter = t.magFilter = THREE.NearestFilter
    t.generateMipmaps = false
    return t
  })()

  readonly stats = { rasterCount: 0, rasterTotalMs: 0, rasterMaxMs: 0, overflow: 0, blank: 0 }

  /**
   * Upgrades to a bundled single-file face (TA-25), clearing every
   * already-rasterized cell so later `entryFor` calls re-rasterize from the
   * new face rather than mixing two typefaces in one atlas. Not called by
   * this plan (no bundled face ships yet) -- kept as the seam a later plan
   * uses once one does.
   */
  async loadFont(fontUrl: string, family = 'TapestryThreadFace'): Promise<void> {
    const face = new FontFace(family, `url(${fontUrl})`)
    await face.load()
    document.fonts.add(face)
    this.sdf = new DomTinySDF({
      fontSize: EM_PX,
      buffer: SDF_BUFFER,
      radius: SDF_RADIUS,
      cutoff: SDF_CUTOFF,
      fontFamily: `${family}, ${SYSTEM_FONT_STACK}`,
    })
    this.cache.clear()
  }

  /** Returns the (possibly newly rasterized) atlas entry for `grapheme`, or
   * `null` for nothing-to-draw (spaces, newlines) or atlas overflow. Copies
   * the new cell's pixels into the owning page's GPU texture immediately
   * (a live update) unless `bulk` is set, in which case the caller is
   * responsible for marking the whole texture `needsUpdate` once after a
   * batch (mirroring glyph-layer.js's `atlasPendingFull` distinction
   * between a bulk build and a live keystroke). */
  entryFor(renderer: THREE.WebGLRenderer, grapheme: string, bulk = false): GlyphAtlasEntry | null {
    const cached = this.cache.get(grapheme)
    if (cached !== undefined) return cached

    const started = performance.now()
    const raw = isColorGlyph(grapheme) ? rasterizeColor(grapheme) : rasterizeSdf(this.sdf, grapheme)
    const ms = performance.now() - started
    this.stats.rasterCount++
    this.stats.rasterTotalMs += ms
    this.stats.rasterMaxMs = Math.max(this.stats.rasterMaxMs, ms)

    if (!raw) {
      this.stats.blank++
      this.cache.set(grapheme, null)
      return null
    }

    const entry = this.allocate(renderer, raw, bulk)
    if (!entry) this.stats.overflow++
    this.cache.set(grapheme, entry)
    return entry
  }

  private allocate(renderer: THREE.WebGLRenderer, raw: RasterizedCell, bulk: boolean): GlyphAtlasEntry | null {
    let pageIndex = this.pages.findIndex((p) => p.nextIndex < CELLS_PER_PAGE)
    if (pageIndex === -1) {
      if (this.pages.length >= MAX_PAGES) return null // atlas overflow (Known Stub: no eviction)
      this.pages.push(createPage())
      pageIndex = this.pages.length - 1
    }
    const page = this.pages[pageIndex]
    const index = page.nextIndex++
    const col = index % COLS
    const row = Math.floor(index / COLS)

    for (let y = 0; y < CELL; y++) {
      page.data.set(raw.pixels.subarray(y * CELL * 4, (y + 1) * CELL * 4), ((row * CELL + y) * ATLAS + col * CELL) * 4)
    }

    if (!bulk && !page.pendingFull) {
      ;(this.scratch.image as { data: Uint8Array }).data.set(raw.pixels)
      this.scratch.needsUpdate = true
      renderer.copyTextureToTexture(this.scratch, page.texture, null, new THREE.Vector2(col * CELL, row * CELL))
    } else {
      page.texture.needsUpdate = true
    }

    const u0 = (col * CELL) / ATLAS
    const u1 = (col * CELL + raw.tw) / ATLAS
    const vTop = (row * CELL) / ATLAS
    const vBottom = (row * CELL + raw.th) / ATLAS

    return {
      page: pageIndex,
      quad: [raw.x0 - raw.advance / 2, raw.y0, raw.tw / EM_PX, raw.th / EM_PX],
      uv: [u0, vBottom, u1, vTop],
      dist: [raw.kind, raw.edge, raw.range],
    }
  }

  /** Marks every page's texture as needing a full re-upload once (the
   * bulk-build entry point for opening a thread with existing history) and
   * flips each page out of "pending full" so later live `entryFor` calls
   * resume doing incremental `copyTextureToTexture` writes. Call once after
   * a batch of `entryFor(..., true)` calls; the caller must also render one
   * frame before adding any further live glyphs (mirrors the ribbon's
   * `pendingFullUpload` discipline: three.js drops a range added before a
   * requested full upload has actually reached the GPU). */
  markPagesClean(): void {
    for (const page of this.pages) page.pendingFull = false
  }

  /** The GPU texture for one atlas page, for a `GlyphLayer`'s material. */
  pageTexture(index: number): THREE.DataTexture {
    return this.pages[index].texture
  }

  get pageCount(): number {
    return this.pages.length
  }
}

let appCache: GlyphCache | null = null

/** The one glyph cache for the whole app (RESEARCH: "a glyph cache belongs
 * to the application, not to a session"). Created lazily on first access
 * and never rebuilt: reopening a thread reuses every cell already
 * rasterized for any other thread this session. */
export function getGlyphCache(): GlyphCache {
  appCache ??= new GlyphCache()
  return appCache
}
