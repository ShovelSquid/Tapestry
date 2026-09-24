/**
 * `GlyphLayer` — instanced glyph quads, one atlas, one draw call
 * (RESEARCH Pattern 4; spike 002b's instanced-quad geometry, spike
 * 003-shared's atlas/shader contract). Every letter is one instance
 * (position + atlas cell + kind/edge/range) drawn in a single
 * `THREE.Mesh` draw call, never one text object per keystroke (002a
 * INVALIDATED: troika-three-text at thread scale was 4-5.5fps and 850MB
 * at 78k letters).
 *
 * Combines two spikes' techniques, because neither alone is the shape this
 * plan needs: spike 003's atlas/SDF/MSDF/colour-bitmap shader (glyph-layer.js)
 * computes a letter's screen position directly from a flat world offset,
 * which loses precision past about an hour; spike 001's `relTime`/
 * `threadPoint` floating-origin scheme (ribbon.ts's `STAGE_COMMON_GLSL`)
 * is what keeps an 8h thread's dots and glyphs exact. Every instance here
 * carries `aBlock`/`aOffset` (thread.js's Glyphs class) rather than a flat
 * `aPos`, so a letter typed in hour 7 places exactly as precisely as one
 * typed in the first second.
 *
 * Per-instance attributes, replacing the spike's single `aChar`:
 *  - `aKind`    0 = browser-SDF, 1 = MSDF (reserved, never written while
 *               MSDF is deferred), 2 = colour bitmap (emoji)
 *  - `aActor`   an author index (D-21; a later plan assigns per-letter
 *               author colour and underlay from it — this plan always
 *               writes 0, "the person", since no other author writes yet)
 *  - `aDeletedAtMs` -1 while a letter is still live; set to the ms a
 *               letter was deleted (D-03) once the caller knows it -- the
 *               ghost fade/strike this plan adds reads this attribute
 *               directly, drawing a deleted letter faded and struck at the
 *               moment it was typed instead of removing it from the buffer
 */

import * as THREE from 'three'
import { STAGE_COMMON_GLSL, type StageUniforms } from './ribbon'
import { ATLAS, type GlyphCache } from './glyph-cache'
import { AUTHOR_TOKEN_NAMES } from './tokens'

const MAX_ATLAS_PAGES = 4

function floatAttr(size: number, itemSize: number): THREE.InstancedBufferAttribute {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(size * itemSize), itemSize)
  attr.setUsage(THREE.DynamicDrawUsage)
  return attr
}

interface GlyphAttrs {
  aBlock: THREE.InstancedBufferAttribute
  aOffset: THREE.InstancedBufferAttribute
  aQuad: THREE.InstancedBufferAttribute
  aUv: THREE.InstancedBufferAttribute
  aEdgeRange: THREE.InstancedBufferAttribute
  aKind: THREE.InstancedBufferAttribute
  aPage: THREE.InstancedBufferAttribute
  aActor: THREE.InstancedBufferAttribute
  aDeletedAtMs: THREE.InstancedBufferAttribute
}

let dummyTexture: THREE.DataTexture | null = null
function getDummyTexture(): THREE.DataTexture {
  if (!dummyTexture) {
    dummyTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat)
    dummyTexture.needsUpdate = true
  }
  return dummyTexture
}

function createGlyphMaterial(uniforms: StageUniforms): THREE.ShaderMaterial {
  const dummy = getDummyTexture()
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uAtlas0: { value: dummy },
      uAtlas1: { value: dummy },
      uAtlas2: { value: dummy },
      uAtlas3: { value: dummy },
    },
    vertexShader:
      STAGE_COMMON_GLSL +
      /* glsl */ `
      attribute float aBlock, aOffset;
      attribute vec4 aQuad;
      attribute vec4 aUv;
      attribute vec2 aEdgeRange;
      attribute float aKind, aPage, aActor, aDeletedAtMs;
      uniform float uGlyphSize, uSideGlyphPx;
      varying vec2 vUv;
      varying vec3 vDist; // kind, edge, range
      varying float vPage, vAlpha;
      // Ghost letters (D-03, L-8): a deleted letter (aDeletedAtMs >= 0, the
      // live sentinel is -1) stays at the moment it was TYPED (rel is still
      // derived from aBlock/aOffset, its insertion time -- deletion never
      // moves a letter) but draws faded, struck through, and offset 4px
      // below the strand, in screen space, so it never depends on zoom.
      varying float vGhost, vStrikeCoord, vPxPerLocalY;
      void main() {
        float rel = relTime(aBlock, aOffset);
        vec4 mv = threadPoint(rel);
        float upp = unitsPerPx(mv);
        vec2 axis = threadAxis();
        vec2 perp = vec2(-axis.y, axis.x);
        vec2 local = position.xy + 0.5; // unit plane [-0.5,0.5] -> [0,1]
        vec2 em = aQuad.xy + local * aQuad.zw;
        float size = uGlyphSize;
        float ghost = step(0.0, aDeletedAtMs);
        float ghostOffsetPx = 4.0;
        mv.xy += axis * em.x * size + perp * (em.y * size - ghost * ghostOffsetPx * upp);
        gl_Position = projectionMatrix * mv;
        vUv = vec2(mix(aUv.x, aUv.z, local.x), mix(aUv.y, aUv.w, local.y));
        vDist = vec3(aKind, aEdgeRange.x, aEdgeRange.y);
        vPage = aPage;
        // Legibility gating (thread.js:227-244): the live view hides
        // glyphs too small to read (the 7px em floor, DRAW-03); the side
        // view hides them until keystrokes are far enough apart not to
        // overlap. A future-typed letter (rel in the future -- never
        // happens live, but a scrubbed past stage can hold letters not
        // yet "reached") is hidden by the same future() gate thread.js uses.
        float legible = uSideGlyphPx > 0.0
          ? smoothstep(0.7, 1.0, (0.12 * uSpeed / upp) / uSideGlyphPx)
          : smoothstep(4.0, 9.0, size / upp);
        float future = step(0.0, uNowRel - rel + 1e-3);
        vAlpha = fadeFor(rel) * legible * future;
        vGhost = ghost;
        vStrikeCoord = local.y; // 0..1 across the glyph's own em box
        vPxPerLocalY = (aQuad.w * size) / max(upp, 1e-6); // screen px per unit of local.y
        if (vAlpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas0, uAtlas1, uAtlas2, uAtlas3;
      uniform vec3 uInkColor, uThreadLineColor;
      varying vec2 vUv;
      varying vec3 vDist;
      varying float vPage, vAlpha, vGhost, vStrikeCoord, vPxPerLocalY;
      float median(vec3 c) { return max(min(c.r, c.g), min(max(c.r, c.g), c.b)); }
      vec4 sampleAtlas(vec2 uv) {
        if (vPage < 0.5) return texture2D(uAtlas0, uv);
        if (vPage < 1.5) return texture2D(uAtlas1, uv);
        if (vPage < 2.5) return texture2D(uAtlas2, uv);
        return texture2D(uAtlas3, uv);
      }
      void main() {
        vec4 texel = sampleAtlas(vUv);
        float alpha;
        vec3 color;
        if (vDist.x > 1.5) {
          // colour bitmap (emoji): draw the sampled pixel directly.
          if (texel.a < 0.02) discard;
          color = texel.rgb;
          alpha = texel.a * vAlpha;
        } else {
          // SDF (kind 0) or MSDF (kind 1, reserved): distance in texels =
          // (sampled - edge) * range; one pixel of antialiasing at every zoom.
          float value = vDist.x < 0.5 ? texel.r : median(texel.rgb);
          vec2 texelsPerPx = fwidth(vUv) * ${ATLAS.toFixed(1)};
          float spread = max(0.5 * (texelsPerPx.x + texelsPerPx.y), 1e-4);
          float sdfAlpha = clamp((value - vDist.y) * vDist.z / spread + 0.5, 0.0, 1.0);
          color = uInkColor;
          alpha = sdfAlpha * vAlpha;
        }
        if (vGhost > 0.5) {
          // Fade to 70% of the display colour (UI-SPEC "Ghost letters"):
          // the ink case composites to 5.10:1 on paper -- comfortably above
          // the 3:1 graphics floor. Per-letter *non*-ink display colour (the
          // 80% case) is not distinguished here: the glyph shader has no
          // per-letter display-colour attribute yet (every live glyph
          // already draws in uInkColor only), so this path is not yet
          // reachable -- a documented Known Stub, not a silent gap.
          alpha *= 0.70;
          // The strike is 1px in --tap-thread-line at FULL strength,
          // independent of the fade above, so a ghost stays identifiable
          // even where the fade is hardest to see (UI-SPEC).
          float halfPxLocal = 0.5 / max(vPxPerLocalY, 1e-6);
          float strike = 1.0 - smoothstep(halfPxLocal, halfPxLocal * 2.0, abs(vStrikeCoord - 0.5));
          color = mix(color, uThreadLineColor, strike);
          alpha = max(alpha, strike * vAlpha);
        }
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(color, alpha);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

export class GlyphLayer {
  readonly mesh: THREE.Mesh
  private readonly geometry: THREE.InstancedBufferGeometry
  private capacity: number
  private attrs: GlyphAttrs
  private count = 0
  private syncedPageCount = 0

  constructor(initialCapacity = 4096) {
    this.capacity = initialCapacity
    const plane = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = plane.index
    geometry.setAttribute('position', plane.getAttribute('position'))
    this.attrs = GlyphLayer.allocateAttrs(initialCapacity)
    for (const [name, attr] of Object.entries(this.attrs)) geometry.setAttribute(name, attr)
    geometry.instanceCount = 0
    this.geometry = geometry
    this.mesh = new THREE.Mesh(geometry, undefined)
    this.mesh.frustumCulled = false
  }

  private static allocateAttrs(capacity: number): GlyphAttrs {
    return {
      aBlock: floatAttr(capacity, 1),
      aOffset: floatAttr(capacity, 1),
      aQuad: floatAttr(capacity, 4),
      aUv: floatAttr(capacity, 4),
      aEdgeRange: floatAttr(capacity, 2),
      aKind: floatAttr(capacity, 1),
      aPage: floatAttr(capacity, 1),
      aActor: floatAttr(capacity, 1),
      aDeletedAtMs: floatAttr(capacity, 1),
    }
  }

  setUniforms(uniforms: StageUniforms): void {
    this.mesh.material = createGlyphMaterial(uniforms)
  }

  /** The shared instanced geometry, exposed read-only so
   * `GlyphUnderlayLayer` can draw a second mesh over the exact same
   * per-letter instances (position, size, author) without duplicating a
   * single buffer -- the two meshes always agree on instance count and
   * per-instance data because they are, literally, the same geometry
   * object (this field is never reassigned, only its attributes are
   * replaced in place by `growIfNeeded`). */
  get instancedGeometry(): THREE.InstancedBufferGeometry {
    return this.geometry
  }

  /** Points the material's per-page sampler uniforms at the glyph cache's
   * current pages (a page allocated after the material was created is
   * picked up the next time this is called -- call once per frame before
   * rendering; the check is a cheap integer compare when nothing changed). */
  syncAtlasTextures(cache: GlyphCache): void {
    if (cache.pageCount === this.syncedPageCount) return
    const material = this.mesh.material as THREE.ShaderMaterial
    const dummy = getDummyTexture()
    for (let i = 0; i < MAX_ATLAS_PAGES; i++) {
      const uniform = material.uniforms[`uAtlas${i}`] as THREE.IUniform<THREE.Texture>
      uniform.value = i < cache.pageCount ? cache.pageTexture(i) : dummy
    }
    this.syncedPageCount = cache.pageCount
  }

  reset(): void {
    this.count = 0
    this.geometry.instanceCount = 0
  }

  get instanceCount(): number {
    return this.count
  }

  private growIfNeeded(): void {
    if (this.count < this.capacity) return
    const nextCapacity = this.capacity * 2
    const next = GlyphLayer.allocateAttrs(nextCapacity)
    for (const key of Object.keys(this.attrs) as (keyof GlyphAttrs)[]) {
      next[key].array.set(this.attrs[key].array as Float32Array)
      this.geometry.setAttribute(key, next[key])
    }
    this.capacity = nextCapacity
    this.attrs = next
  }

  /**
   * Adds one letter at absolute thread time `t` (seconds), using `cache`
   * to rasterize (or reuse) its atlas cell. Returns false when the
   * grapheme has nothing to draw (space, newline) or the atlas has
   * overflowed (`GlyphCache`'s Known Stub) -- callers should not treat
   * either as an error.
   */
  add(
    renderer: THREE.WebGLRenderer,
    cache: GlyphCache,
    t: number,
    grapheme: string,
    options: { actor?: number; deletedAtMs?: number | null; bulk?: boolean } = {},
  ): boolean {
    const entry = cache.entryFor(renderer, grapheme, options.bulk ?? false)
    if (!entry) return false

    this.growIfNeeded()
    const i = this.count
    const block = Math.floor(t / 3600)
    const offset = t - block * 3600
    this.attrs.aBlock.setX(i, block)
    this.attrs.aOffset.setX(i, offset)
    this.attrs.aQuad.setXYZW(i, entry.quad[0], entry.quad[1], entry.quad[2], entry.quad[3])
    this.attrs.aUv.setXYZW(i, entry.uv[0], entry.uv[1], entry.uv[2], entry.uv[3])
    this.attrs.aEdgeRange.setXY(i, entry.dist[1], entry.dist[2])
    this.attrs.aKind.setX(i, entry.dist[0])
    this.attrs.aPage.setX(i, entry.page)
    this.attrs.aActor.setX(i, options.actor ?? 0)
    this.attrs.aDeletedAtMs.setX(i, options.deletedAtMs ?? -1)
    this.count++
    this.geometry.instanceCount = this.count

    if (!options.bulk) {
      for (const attr of Object.values(this.attrs)) {
        attr.addUpdateRange(i * attr.itemSize, attr.itemSize)
        attr.needsUpdate = true
      }
    }
    return true
  }

  /** Marks every instance attribute as fully uploaded, for the caller to
   * call once after a batch of `add(..., { bulk: true })` calls (mirrors
   * `ribbon.ts`'s `markAll` / the upload-range trap: a bulk build must
   * clear any pending per-instance ranges before requesting a full upload). */
  markBulkUploaded(): void {
    for (const attr of Object.values(this.attrs)) {
      attr.clearUpdateRanges()
      attr.needsUpdate = true
    }
  }

  /** GPU buffer size in bytes: 9 attributes, up to 56 bytes/instance
   * (RESEARCH Pattern 4: "56 bytes, or 3.4MB of GPU buffers at 8h"). */
  bytes(): number {
    const itemSizes = Object.values(this.attrs).reduce((sum, attr) => sum + attr.itemSize, 0)
    return this.count * itemSizes * 4
  }
}

// ---------------------------------------------------------------------------
// GlyphUnderlayLayer — the D-21 author underlay band on the stage
// ---------------------------------------------------------------------------

/**
 * `GlyphUnderlayLayer` — the D-21 author underlay band, "beneath the glyph,
 * never over it" (UI-SPEC "Two colour channels"). Draws a second mesh that
 * shares `GlyphLayer`'s own instanced geometry verbatim (same position,
 * size and `aActor` per instance — literally the same buffers, never a
 * duplicated copy that could drift), scaled to `em x 1.15` and rendered
 * first in the scene graph so painter's-order plus `depthTest: false` put it
 * behind the glyph it belongs to.
 *
 * The band only draws once a letter's own screen-space em size reaches 24px
 * (UI-SPEC "examining closely is literal"); below that, authorship is
 * carried by strand position, dash pattern and the legend alone.
 */
function createUnderlayMaterial(uniforms: StageUniforms, authorColors: THREE.Vector3[]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uAuthorColors: { value: authorColors },
      uUnderlayScale: { value: 1.15 },
      uUnderlayThresholdPx: { value: 24 },
    },
    vertexShader:
      STAGE_COMMON_GLSL +
      /* glsl */ `
      attribute float aBlock, aOffset;
      attribute vec4 aQuad;
      attribute float aActor, aDeletedAtMs;
      uniform float uGlyphSize, uUnderlayScale, uUnderlayThresholdPx;
      varying float vAlpha, vAuthor;
      void main() {
        float rel = relTime(aBlock, aOffset);
        vec4 mv = threadPoint(rel);
        float upp = unitsPerPx(mv);
        vec2 axis = threadAxis();
        vec2 perp = vec2(-axis.y, axis.x);
        vec2 local = (position.xy + 0.5) * uUnderlayScale - (uUnderlayScale - 1.0) * 0.5;
        vec2 em = aQuad.xy + local * aQuad.zw;
        float size = uGlyphSize;
        mv.xy += axis * em.x * size + perp * em.y * size;
        gl_Position = projectionMatrix * mv;
        float emPx = (aQuad.z * size) / max(upp, 1e-6);
        float visible = step(uUnderlayThresholdPx, emPx);
        float future = step(0.0, uNowRel - rel + 1e-3);
        vAlpha = fadeFor(rel) * visible * future;
        vAuthor = aActor;
        if (vAlpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uAuthorColors[${AUTHOR_TOKEN_NAMES.length}];
      varying float vAlpha, vAuthor;
      void main() {
        // UI-SPEC "Wash strength": 18% of the author colour.
        float alpha = vAlpha * 0.18;
        if (alpha < 0.01) discard;
        int a = int(vAuthor + 0.5);
        vec3 color = uAuthorColors[max(0, min(${AUTHOR_TOKEN_NAMES.length - 1}, a))];
        gl_FragColor = vec4(color, alpha);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

export class GlyphUnderlayLayer {
  readonly mesh: THREE.Mesh

  constructor(glyphs: GlyphLayer) {
    this.mesh = new THREE.Mesh(glyphs.instancedGeometry, undefined)
    this.mesh.frustumCulled = false
  }

  setUniforms(uniforms: StageUniforms, authorColors: THREE.Vector3[]): void {
    this.mesh.material = createUnderlayMaterial(uniforms, authorColors)
  }
}
