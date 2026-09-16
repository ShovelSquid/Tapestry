// Shared glyph layer for spikes 003a (SDF) and 003b (MSDF).
//
// One dynamic atlas texture (2048 px, 64 px cells) filled on first use, and one
// instanced quad per letter in a single draw call, as in spike 002b. A variant
// only supplies rasterize(grapheme), which returns one cell:
//
//   { kind, pixels, tw, th, x0, y0, advance, edge, range }
//     kind      0 = single-channel SDF (red), 1 = MSDF (median of rgb), 2 = colour bitmap (emoji)
//     pixels    Uint8Array CELL × CELL × 4, top row first; the glyph occupies the top-left tw × th texels
//     x0, y0    bottom-left corner of those texels in em units, relative to the glyph origin on the baseline
//     advance   em units
//     edge      encoded value at the outline (0..1)
//     range     texels per unit of encoded value, so signed distance in texels = (value - edge) × range
//
// or null / undefined for a grapheme with nothing to draw (spaces, newlines, missing glyphs).
import * as THREE from 'three'

export const CELL = 64
export const ATLAS = 2048
export const EM_PX = 36 // glyph em size inside a cell
export const RANGE_PX = 8 // distance range in texels (SDF radius / MSDF range)
const COLS = ATLAS / CELL
const MAX_CELLS = COLS * COLS
const CAPACITY = 200000

const MIPMAPS = new URLSearchParams(location.search).get('mip') !== '0'
const COLOR = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

export const isColorGlyph = (grapheme) => COLOR.test(grapheme)

// Colour emoji can't be a distance field (it has colour), so both variants draw it
// as an ordinary bitmap cell through the same instanced quads.
let colorCanvas = null
export function rasterizeColor(grapheme) {
  colorCanvas ??= Object.assign(document.createElement('canvas'), { width: CELL, height: CELL })
  const ctx = colorCanvas.getContext('2d', { willReadFrequently: true })
  ctx.clearRect(0, 0, CELL, CELL)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  let size = EM_PX
  ctx.font = `${size}px "Apple Color Emoji"`
  let m = ctx.measureText(grapheme)
  const fit = Math.min(
    1,
    (CELL - 4) / Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight),
    (CELL - 4) / Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)
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
  return { kind: 2, pixels, tw, th, x0: (left - 1) / EM_PX, y0: (1 + top - th) / EM_PX, advance: m.width / EM_PX, edge: 0, range: 0 }
}

export async function createAtlasGlyphLayer({ scene, renderer, fontSize, speed, lift, rasterize, extraStats = () => ({}) }) {
  // Atlas: CPU copy is always current; the GPU gets either a full upload (bulk build)
  // or a 64 px copy per new glyph (live).
  const atlasData = new Uint8Array(ATLAS * ATLAS * 4)
  const atlas = new THREE.DataTexture(atlasData, ATLAS, ATLAS, THREE.RGBAFormat)
  atlas.magFilter = THREE.LinearFilter
  atlas.minFilter = MIPMAPS ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  atlas.generateMipmaps = MIPMAPS
  atlas.anisotropy = renderer.capabilities.getMaxAnisotropy()
  atlas.needsUpdate = true
  let atlasPendingFull = true
  const scratch = new THREE.DataTexture(new Uint8Array(CELL * CELL * 4), CELL, CELL, THREE.RGBAFormat)
  scratch.minFilter = scratch.magFilter = THREE.NearestFilter
  scratch.generateMipmaps = false
  const dst = new THREE.Vector2()

  const cache = new Map()
  const raster = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0, blank: 0, overflow: 0, liveCopies: 0, liveCopyMs: 0 }

  function entryFor(grapheme) {
    if (cache.has(grapheme)) return cache.get(grapheme)
    const started = performance.now()
    const r = rasterize(grapheme)
    const ms = performance.now() - started
    Object.assign(raster, { count: raster.count + 1, totalMs: raster.totalMs + ms, maxMs: Math.max(raster.maxMs, ms), lastMs: ms })
    let entry = null
    if (!r) raster.blank++
    else if (cache.size - raster.blank - raster.overflow >= MAX_CELLS) raster.overflow++
    else {
      const index = cache.size - raster.blank - raster.overflow
      const col = index % COLS
      const row = Math.floor(index / COLS)
      for (let y = 0; y < CELL; y++) {
        atlasData.set(r.pixels.subarray(y * CELL * 4, (y + 1) * CELL * 4), ((row * CELL + y) * ATLAS + col * CELL) * 4)
      }
      if (!atlasPendingFull) {
        const copyStarted = performance.now()
        scratch.image.data.set(r.pixels)
        scratch.needsUpdate = true
        renderer.copyTextureToTexture(scratch, atlas, null, dst.set(col * CELL, row * CELL))
        raster.liveCopies++
        raster.liveCopyMs += performance.now() - copyStarted
      }
      const u0 = (col * CELL) / ATLAS
      const u1 = (col * CELL + r.tw) / ATLAS
      const vTop = (row * CELL) / ATLAS
      const vBottom = (row * CELL + r.th) / ATLAS
      entry = {
        quad: [r.x0 - r.advance / 2, r.y0, r.tw / EM_PX, r.th / EM_PX], // centred on the keystroke's point
        uv: [u0, vBottom, u1, vTop],
        dist: [r.kind, r.edge, r.range],
      }
    }
    cache.set(grapheme, entry)
    return entry
  }

  const plane = new THREE.PlaneGeometry(1, 1)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.index = plane.index
  geometry.setAttribute('position', plane.getAttribute('position'))
  const attrs = {
    aPos: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3),
    aQuad: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4),
    aUv: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4),
    aDist: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3),
  }
  for (const [name, attr] of Object.entries(attrs)) geometry.setAttribute(name, attr.setUsage(THREE.DynamicDrawUsage))
  geometry.instanceCount = 0

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas },
      uAtlasSize: { value: ATLAS },
      uTheta: { value: Math.PI },
      uFontSize: { value: fontSize },
      uLift: { value: lift },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec4 aQuad;
      attribute vec4 aUv;
      attribute vec3 aDist;
      uniform float uTheta, uFontSize, uLift;
      varying vec2 vUv;
      varying vec3 vDist;
      void main() {
        vec2 local = position.xy + 0.5;
        vec2 em = aQuad.xy + local * aQuad.zw;
        vec3 right = vec3(cos(uTheta), 0.0, -sin(uTheta)); // same as rotation.y = uTheta
        vec3 p = aPos + right * em.x * uFontSize + vec3(0.0, em.y * uFontSize + uLift, 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        vUv = vec2(mix(aUv.x, aUv.z, local.x), mix(aUv.y, aUv.w, local.y));
        vDist = aDist;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform float uAtlasSize;
      varying vec2 vUv;
      varying vec3 vDist; // kind, edge, range
      float median(vec3 c) { return max(min(c.r, c.g), min(max(c.r, c.g), c.b)); }
      void main() {
        vec4 texel = texture2D(uAtlas, vUv);
        if (vDist.x > 1.5) {
          if (texel.a < 0.02) discard;
          gl_FragColor = texel;
          return;
        }
        float value = vDist.x < 0.5 ? texel.r : median(texel.rgb);
        vec2 texelsPerPx = fwidth(vUv) * uAtlasSize;
        float spread = max(0.5 * (texelsPerPx.x + texelsPerPx.y), 1e-4);
        float alpha = clamp((value - vDist.y) * vDist.z / spread + 0.5, 0.0, 1.0);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(0.95, 0.96, 1.0, alpha);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)

  // three uploads only update ranges when any exist (spike 001), so no live range
  // may be added while a full upload is pending.
  let instancesPendingFull = false
  mesh.onAfterRender = () => {
    instancesPendingFull = false
    atlasPendingFull = false
  }

  let letters = 0
  let count = 0
  let origin = 0
  function write(t, grapheme) {
    letters++
    const entry = entryFor(grapheme)
    if (!entry || count >= CAPACITY) return false
    attrs.aPos.array.set([0, 0, -(t - origin) * speed], count * 3)
    attrs.aQuad.array.set(entry.quad, count * 4)
    attrs.aUv.array.set(entry.uv, count * 4)
    attrs.aDist.array.set(entry.dist, count * 3)
    count++
    geometry.instanceCount = count
    return true
  }

  return {
    async build({ times, chars }, tOrigin) {
      letters = 0
      count = 0
      origin = tOrigin
      for (let i = 0; i < times.length; i++) write(times[i], chars[i])
      for (const attr of Object.values(attrs)) {
        attr.clearUpdateRanges()
        attr.needsUpdate = true
      }
      instancesPendingFull = true
      atlas.needsUpdate = true
      atlasPendingFull = true
    },
    add(t, grapheme) {
      if (!write(t, grapheme)) return
      for (const attr of Object.values(attrs)) {
        if (!instancesPendingFull) attr.addUpdateRange((count - 1) * attr.itemSize, attr.itemSize)
        attr.needsUpdate = true
      }
    },
    setOrientation(theta) {
      material.uniforms.uTheta.value = theta
    },
    stats() {
      const cells = cache.size - raster.blank - raster.overflow
      return {
        glyphs: count,
        letters,
        atlasCells: cells,
        atlasOverflow: raster.overflow,
        rasterCount: raster.count,
        rasterMsAvg: raster.count ? raster.totalMs / raster.count : 0,
        rasterMsMax: raster.maxMs,
        rasterMsLast: raster.lastMs,
        liveCopies: raster.liveCopies,
        liveCopyMsAvg: raster.liveCopies ? raster.liveCopyMs / raster.liveCopies : 0,
        instanceMB: (count * 56) / 1048576,
        mipmaps: MIPMAPS,
        ...extraStats(),
      }
    },
  }
}
