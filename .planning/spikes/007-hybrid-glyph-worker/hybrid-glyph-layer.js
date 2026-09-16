// Spike 007 — a glyph layer whose cells can be REPLACED after letters are drawn.
//
// A documented fork of 003-shared/glyph-layer.js. The shader, cell contract and
// atlas geometry are unchanged; what is new is that a grapheme's cell can be
// swapped for a better one, or evicted, after instances already reference it.
//
// Why a fork and not an import: 003-shared/glyph-layer.js exposes only
// build/add/setOrientation/stats. Everything this spike needs to change — the
// atlas bytes, the per-grapheme cache, the instance attributes — is private to
// it, and widening that interface would change measured code the 003 verdicts
// rest on.
//
// The thing that makes this non-trivial: write() SNAPSHOTS the entry's quad, uv
// and dist into per-instance attributes. An instance does not point at the
// cache; it holds a copy. So replacing a cell means rewriting every instance of
// that grapheme, because the new cell has different metrics (tw, th, x0, y0,
// advance) and a different dist triple (kind 0 → 1, edge 1−cutoff → 0.5).
//
// That one mechanism answers both halves of this spike: upgrading a browser-SDF
// cell to MSDF, and evicting a cell when the atlas runs out of its 1024 slots.
import * as THREE from 'three'

export const CELL = 64
export const ATLAS = 2048
export const EM_PX = 36
export const RANGE_PX = 8
const COLS = ATLAS / CELL
const MAX_CELLS = COLS * COLS
const CAPACITY = 200000

const MIPMAPS = new URLSearchParams(location.search).get('mip') !== '0'

export async function createHybridGlyphLayer({
  scene, renderer, fontSize, speed, lift,
  rasterize,           // synchronous, cheap: the cell shown immediately
  requestUpgrade,      // (grapheme) => void; the caller later calls upgrade()
  maxCells = MAX_CELLS,
  extraStats = () => ({}),
}) {
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

  /** grapheme -> { slot, entry, kind, instances: number[], used: number } */
  const cells = new Map()
  const blanks = new Set() // graphemes with nothing to draw (space, newline)
  let nextSlot = 0
  let clock = 0

  const stats = {
    placeholderCount: 0, placeholderMs: 0, placeholderMaxMs: 0,
    upgrades: 0, upgradeMs: 0, upgradeMaxMs: 0,
    rewrittenInstances: 0, rewriteMs: 0, rewriteMaxMs: 0,
    evictions: 0, evictedInstances: 0,
    // Split so a stall can be attributed: scanning every cell to find the least
    // recently used one is O(cells) per eviction, while collapsing the victim's
    // instances is O(its instances) plus an update range each.
    evictScanMs: 0, evictRewriteMs: 0, evictMaxMs: 0,
    copies: 0, copyMs: 0, copyMaxMs: 0,
    overflow: 0,
  }

  const entryFromCell = (r, slot) => {
    const col = slot % COLS
    const row = Math.floor(slot / COLS)
    return {
      quad: [r.x0 - r.advance / 2, r.y0, r.tw / EM_PX, r.th / EM_PX],
      uv: [(col * CELL) / ATLAS, (row * CELL + r.th) / ATLAS, (col * CELL + r.tw) / ATLAS, (row * CELL) / ATLAS],
      dist: [r.kind, r.edge, r.range],
    }
  }

  /** Write a cell's pixels into a slot, on the CPU copy and (when live) the GPU. */
  function paint(slot, r) {
    const col = slot % COLS
    const row = Math.floor(slot / COLS)
    for (let y = 0; y < CELL; y++) {
      atlasData.set(r.pixels.subarray(y * CELL * 4, (y + 1) * CELL * 4), ((row * CELL + y) * ATLAS + col * CELL) * 4)
    }
    if (!atlasPendingFull) {
      const started = performance.now()
      scratch.image.data.set(r.pixels)
      scratch.needsUpdate = true
      renderer.copyTextureToTexture(scratch, atlas, null, dst.set(col * CELL, row * CELL))
      const ms = performance.now() - started
      stats.copies++
      stats.copyMs += ms
      stats.copyMaxMs = Math.max(stats.copyMaxMs, ms)
    }
  }

  /**
   * Free a slot by evicting the least recently used grapheme. Its instances are
   * collapsed to a degenerate quad so they draw nothing, and the grapheme is
   * forgotten — typing it again re-rasterizes it into a fresh slot.
   */
  function evictLru() {
    const scanStarted = performance.now()
    let victim = null
    for (const [g, c] of cells) if (!victim || c.used < victim[1].used) victim = [g, c]
    const scanMs = performance.now() - scanStarted
    stats.evictScanMs += scanMs
    if (!victim) return -1
    const [grapheme, cell] = victim

    const rewriteStarted = performance.now()
    for (const i of cell.instances) {
      attrs.aQuad.array.set([0, 0, 0, 0], i * 4) // zero-size quad: nothing rasterizes
      markInstance(i)
    }
    const rewriteMs = performance.now() - rewriteStarted
    stats.evictRewriteMs += rewriteMs
    stats.evictMaxMs = Math.max(stats.evictMaxMs, scanMs + rewriteMs)

    stats.evictions++
    stats.evictedInstances += cell.instances.length
    cells.delete(grapheme)
    return cell.slot
  }

  function allocateSlot() {
    if (nextSlot < maxCells) return nextSlot++
    const reused = evictLru()
    if (reused < 0) stats.overflow++
    return reused
  }

  /** The cell shown immediately, and the request for a better one. */
  function cellFor(grapheme) {
    const known = cells.get(grapheme)
    if (known) {
      known.used = ++clock
      return known
    }
    if (blanks.has(grapheme)) return null

    const started = performance.now()
    const r = rasterize(grapheme)
    const ms = performance.now() - started
    stats.placeholderCount++
    stats.placeholderMs += ms
    stats.placeholderMaxMs = Math.max(stats.placeholderMaxMs, ms)

    if (!r) {
      blanks.add(grapheme)
      return null
    }
    const slot = allocateSlot()
    if (slot < 0) return null
    paint(slot, r)
    const cell = { slot, entry: entryFromCell(r, slot), kind: r.kind, instances: [], used: ++clock }
    cells.set(grapheme, cell)
    // Colour emoji are bitmaps; there is no sharper version to ask for.
    if (r.kind !== 2 && requestUpgrade) requestUpgrade(grapheme)
    return cell
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
        vec3 right = vec3(cos(uTheta), 0.0, -sin(uTheta));
        vec3 p = aPos + right * em.x * uFontSize + vec3(0.0, em.y * uFontSize + uLift, 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        vUv = vec2(mix(aUv.x, aUv.z, local.x), mix(aUv.y, aUv.w, local.y));
        vDist = aDist;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform float uAtlasSize;
      varying vec2 vUv;
      varying vec3 vDist;
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

  // three uploads only update ranges when any exist (spike 001), so no range may
  // be added while a full upload is pending.
  let instancesPendingFull = false
  mesh.onAfterRender = () => {
    instancesPendingFull = false
    atlasPendingFull = false
  }

  function markInstance(i) {
    for (const attr of Object.values(attrs)) {
      if (!instancesPendingFull) attr.addUpdateRange(i * attr.itemSize, attr.itemSize)
      attr.needsUpdate = true
    }
  }

  let letters = 0
  let count = 0
  let origin = 0

  function write(t, grapheme) {
    letters++
    const cell = cellFor(grapheme)
    if (!cell || count >= CAPACITY) return false
    attrs.aPos.array.set([0, 0, -(t - origin) * speed], count * 3)
    attrs.aQuad.array.set(cell.entry.quad, count * 4)
    attrs.aUv.array.set(cell.entry.uv, count * 4)
    attrs.aDist.array.set(cell.entry.dist, count * 3)
    cell.instances.push(count)
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
      markInstance(count - 1)
    },

    /**
     * Replace a grapheme's cell with a better one and rewrite every instance
     * that already drew it. Returns the number of instances rewritten.
     */
    upgrade(grapheme, r) {
      const cell = cells.get(grapheme)
      if (!cell || !r) return 0
      const started = performance.now()
      paint(cell.slot, r)
      cell.entry = entryFromCell(r, cell.slot)
      cell.kind = r.kind

      const rewriteStarted = performance.now()
      for (const i of cell.instances) {
        attrs.aQuad.array.set(cell.entry.quad, i * 4)
        attrs.aUv.array.set(cell.entry.uv, i * 4)
        attrs.aDist.array.set(cell.entry.dist, i * 3)
        markInstance(i)
      }
      const rewriteMs = performance.now() - rewriteStarted
      const ms = performance.now() - started

      stats.upgrades++
      stats.upgradeMs += ms
      stats.upgradeMaxMs = Math.max(stats.upgradeMaxMs, ms)
      stats.rewrittenInstances += cell.instances.length
      stats.rewriteMs += rewriteMs
      stats.rewriteMaxMs = Math.max(stats.rewriteMaxMs, rewriteMs)
      return cell.instances.length
    },

    setOrientation(theta) {
      material.uniforms.uTheta.value = theta
    },

    has: (grapheme) => cells.has(grapheme),
    kindOf: (grapheme) => cells.get(grapheme)?.kind ?? -1,

    stats() {
      let msdf = 0
      for (const c of cells.values()) if (c.kind === 1) msdf++
      return {
        glyphs: count,
        letters,
        atlasCells: cells.size,
        msdfCells: msdf,
        atlasOverflow: stats.overflow,
        placeholderMsAvg: stats.placeholderCount ? stats.placeholderMs / stats.placeholderCount : 0,
        placeholderMsMax: stats.placeholderMaxMs,
        upgrades: stats.upgrades,
        upgradeMsAvg: stats.upgrades ? stats.upgradeMs / stats.upgrades : 0,
        upgradeMsMax: stats.upgradeMaxMs,
        rewrittenInstances: stats.rewrittenInstances,
        rewriteMsMax: stats.rewriteMaxMs,
        evictions: stats.evictions,
        evictedInstances: stats.evictedInstances,
        evictScanMs: stats.evictScanMs,
        evictRewriteMs: stats.evictRewriteMs,
        evictMaxMs: stats.evictMaxMs,
        copyMsAvg: stats.copies ? stats.copyMs / stats.copies : 0,
        copyMsMax: stats.copyMaxMs,
        instanceMB: (count * 56) / 1048576,
        ...extraStats(),
      }
    },
  }
}
