/**
 * The procedural ribbon (RESEARCH Pattern 4; spike 001 thread.js, VALIDATED:
 * 60fps, 0 dropped, 0.9MB at 8h continuous). Sessions, gaps and pauses are
 * stored as chunks of 4 vertices — the persistent record is sessions and
 * keystrokes, never dots (D-06); the 60Hz dots are drawn procedurally in the
 * fragment shader from time × speed.
 *
 * Ported verbatim, because each is a silent-failure trap the spike already
 * paid for (RESEARCH Pitfall 6):
 *  - `pendingFullUpload`: without it, history never reaches the GPU (three
 *    uploads only the update ranges when any exist, and silently drops a
 *    full-buffer upload requested after one).
 *  - `side: THREE.DoubleSide` on the ribbon material: a camera-facing
 *    billboard's winding flips with the view, so default culling drops it.
 *  - The manual infinite `boundingSphere`: a 1-D attribute aliased as
 *    `position` needs one, or the ribbon is frustum-culled incorrectly.
 * Spike 001's first benchmark reported a healthy frame rate while all three
 * of the above were silently broken.
 *
 * Sessions are kind 0, gaps are kind 1 (thread.js:261). Kind 2 is new here:
 * a pause within a session (D-11), carrying its own pause-start time via the
 * chunk's own `start` field — exactly the field a session or gap chunk
 * already carries — so the fragment shader can compute "seconds since this
 * pause began" the same way it already computes "seconds since this chunk
 * began" for a gap's dash pattern.
 */

import * as THREE from 'three'
import type { StageTokens } from './tokens'
import type { SlowdownCurve } from '../../../shared/threads/slowdown'
import { DEFAULT_SLOWDOWN, HZ as SLOWDOWN_HZ } from '../../../shared/threads/slowdown'

// ---------------------------------------------------------------------------
// Stage geometry constants (UI-SPEC "Stage geometry", ported verbatim from
// spike 001 thread.js:25-31 — do not re-derive)
// ---------------------------------------------------------------------------

/** Dots per second while typing (D-11 baseline). */
export const HZ = 60
/** World units per second of thread time (D-12: distance always equals
 * elapsed writing time). */
export const SPEED = 1.5
/** Live view: seconds until an entry has faded out (superseded for the live
 * view by D-14's distance-only fade — `uFadeOn` gates this; kept as the
 * live-view fade uniform's default distance-in-seconds, matching thread.js). */
export const FADE = 20
/** Seconds per ribbon chunk. */
export const CHUNK = 600
/** Seconds per floating-origin block (multi-hour float32 precision). */
export const BLOCK = 3600
/** Atlas cell reserved for the time-out/time-in dash marker. A later plan's
 * session-boundary marker glyph addresses this cell; kept here, ported
 * verbatim per the interface contract, so that plan does not re-derive it. */
export const DASH = 127

/** Sessions are kind 0, gaps kind 1 (thread.js:261); kind 2 is a pause
 * within a session (D-11), new in this plan. */
export type ChunkKind = 0 | 1 | 2

/**
 * Named aliases for the chunk-kind vocabulary above. `SessionBridge.tsx`
 * (02.3-06) draws the 2D canvas bridge with a plain 2D `<div>` line, not this
 * WebGL ribbon — but it reuses this same three-state vocabulary (a solid
 * session stretch, a dashed gap, a squashed dash run standing in for both
 * a time-out and a time-in dash) for its own dash rendering, so "the
 * language the line already speaks" (UI-SPEC "Bridge time scale") is
 * spelled out once here rather than re-invented as a second set of magic
 * numbers on the canvas side.
 */
export const CHUNK_KIND = { SESSION: 0, GAP: 1, PAUSE: 2 } as const satisfies Record<string, ChunkKind>

// ---------------------------------------------------------------------------
// Hour-block time encoding + floating origin (thread.js:40-43, 623-628)
// ---------------------------------------------------------------------------

export function splitTime(t: number): [block: number, offset: number] {
  const block = Math.floor(t / BLOCK)
  return [block, t - block * BLOCK]
}

// ---------------------------------------------------------------------------
// Shared GLSL prelude (thread.js:118-137) — every stage shader (ribbon,
// glyphs, and any later marker/dash shader) includes this so `relTime`,
// `threadPoint`, `unitsPerPx`, `fadeFor` and `threadAxis` are defined once.
// ---------------------------------------------------------------------------

export const STAGE_COMMON_GLSL = /* glsl */ `
  uniform float uOriginBlock, uOriginOffset, uNowRel, uSpeed, uFade, uFadeOn, uPixelScale, uOrtho;
  // D-27: the thread's own stored frame, read from the node's properties and
  // never hardcoded. uThreadOrigin/uThreadDirection replace thread.js's
  // literal vec4(0.0, 0.0, -rel * uSpeed, 1.0) point formula and its literal
  // vec4(0.0, 0.0, -1.0, 0.0) axis: with every thread at the D-27 default
  // (origin 0 0 0, direction 0 0 -1), both reduce to exactly the spike's
  // validated numbers, so this generalization carries no visual risk.
  uniform vec3 uThreadOrigin, uThreadDirection;
  float relTime(float block, float offset) {
    return (block - uOriginBlock) * ${BLOCK.toFixed(1)} + (offset - uOriginOffset);
  }
  vec4 threadPoint(float rel) {
    return modelViewMatrix * vec4(uThreadOrigin + uThreadDirection * (rel * uSpeed), 1.0);
  }
  float unitsPerPx(vec4 mv) { return uOrtho > 0.5 ? uPixelScale : uPixelScale * max(-mv.z, 1e-4); }
  float fadeFor(float rel) {
    float age = uNowRel - rel;
    return uFadeOn > 0.5 ? clamp(1.0 - age / uFade, 0.0, 1.0) : 1.0;
  }
  vec2 threadAxis() {
    vec2 a = (viewMatrix * vec4(uThreadDirection, 0.0)).xy;
    float l = length(a);
    return l > 1e-5 ? a / l : vec2(1.0, 0.0);
  }
`

/**
 * The default D-11 slowdown curve is exactly three breakpoints
 * (`10:30 30:10 60:1`); this shader takes a fixed-size three-breakpoint
 * uniform array so a pause's dot density can be computed entirely on the
 * GPU, in lockstep with `slowdown.ts`'s `dotRateAt` (the same closed-form
 * piecewise integral, evaluated per-fragment instead of per-frame). A curve
 * with a different breakpoint count is a later plan's concern (D-13 says
 * the curve is per-thread adjustable; every thread in this plan uses the
 * default three-breakpoint shape).
 */
export const SLOWDOWN_UNIFORM_GLSL = /* glsl */ `
  uniform float uSlowInitialRate;
  uniform float uSlowBreak[3];
  uniform float uSlowRate[3];
  // Cumulative dot phase since a pause began: the exact piecewise integral
  // of the step-function dot rate, so the result depends only on elapsed
  // real seconds (tau), never on how finely a caller samples it (D-13) —
  // the same guarantee slowdown.ts's dotRateAt gives on the CPU.
  float pausePhase(float tau) {
    float phase = 0.0;
    float prevBoundary = 0.0;
    float prevRate = uSlowInitialRate;
    for (int i = 0; i < 3; i++) {
      float b = uSlowBreak[i];
      float seg = clamp(tau, prevBoundary, b) - prevBoundary;
      phase += prevRate * seg;
      prevBoundary = b;
      prevRate = uSlowRate[i];
    }
    phase += prevRate * max(tau - prevBoundary, 0.0);
    return phase;
  }
`

// ---------------------------------------------------------------------------
// Shared stage uniforms
// ---------------------------------------------------------------------------

export interface StageUniforms {
  uOriginBlock: THREE.IUniform<number>
  uOriginOffset: THREE.IUniform<number>
  uNowRel: THREE.IUniform<number>
  uSpeed: THREE.IUniform<number>
  uFade: THREE.IUniform<number>
  uFadeOn: THREE.IUniform<number>
  uHz: THREE.IUniform<number>
  uPixelScale: THREE.IUniform<number>
  uOrtho: THREE.IUniform<number>
  uDpr: THREE.IUniform<number>
  uWidth: THREE.IUniform<number>
  uMinPx: THREE.IUniform<number>
  uGlyphSize: THREE.IUniform<number>
  uSideGlyphPx: THREE.IUniform<number>
  uSlowInitialRate: THREE.IUniform<number>
  uSlowBreak: THREE.IUniform<number[]>
  uSlowRate: THREE.IUniform<number[]>
  uInkColor: THREE.IUniform<THREE.Vector3>
  uMutedColor: THREE.IUniform<THREE.Vector3>
  uThreadLineColor: THREE.IUniform<THREE.Vector3>
  uAccentColor: THREE.IUniform<THREE.Vector3>
  /** D-27: the thread's own stored frame (origin, direction). Never set from
   * a literal in live-view.ts — always derived via `setThreadFrame` from
   * `parseThreadFrame`'s read of the node's properties. */
  uThreadOrigin: THREE.IUniform<THREE.Vector3>
  uThreadDirection: THREE.IUniform<THREE.Vector3>
  [key: string]: THREE.IUniform
}

function colorVec3(tokens: StageTokens, name: keyof StageTokens): THREE.Vector3 {
  const c = tokens[name]
  return new THREE.Vector3(c.r, c.g, c.b)
}

/**
 * Builds the one uniforms object every stage material shares (ribbon,
 * glyphs, and any later marker shader): the floating-origin/fade/pixel-scale
 * uniforms `threadPoint`/`fadeFor` read, the D-11 slowdown breakpoints, and
 * the token colours `tokens.ts` converted to linear light. `updateStageTokens`
 * re-derives just the colour uniforms without touching anything else — a
 * theme change is a uniform re-upload, never a geometry rebuild (UI-SPEC
 * "Theming").
 */
export function createStageUniforms(tokens: StageTokens, slowdown: SlowdownCurve = DEFAULT_SLOWDOWN): StageUniforms {
  const breakpoints = slowdown.slice(0, 3)
  while (breakpoints.length < 3) {
    // Pad a shorter curve with a final, never-reached breakpoint holding
    // the last real rate (or SLOWDOWN_HZ for an empty curve) so the fixed
    // three-slot uniform array is always fully defined.
    const lastRate = breakpoints.length > 0 ? breakpoints[breakpoints.length - 1].ratePerSecond : SLOWDOWN_HZ
    breakpoints.push({ afterSeconds: Number.POSITIVE_INFINITY, ratePerSecond: lastRate })
  }

  return {
    uOriginBlock: { value: 0 },
    uOriginOffset: { value: 0 },
    uNowRel: { value: 0 },
    uSpeed: { value: SPEED },
    uFade: { value: FADE },
    uFadeOn: { value: 1 },
    uHz: { value: HZ },
    uPixelScale: { value: 0.001 },
    uOrtho: { value: 0 },
    uDpr: { value: 1 },
    uWidth: { value: 0.012 },
    uMinPx: { value: 1.2 },
    uGlyphSize: { value: 0.12 }, // UI-SPEC "Stage geometry": glyph em 0.12 world units
    uSideGlyphPx: { value: 0 },
    uSlowInitialRate: { value: SLOWDOWN_HZ },
    uSlowBreak: { value: breakpoints.map((b) => b.afterSeconds) },
    uSlowRate: { value: breakpoints.map((b) => b.ratePerSecond) },
    uInkColor: { value: colorVec3(tokens, '--tap-ink') },
    uMutedColor: { value: colorVec3(tokens, '--tap-muted') },
    uThreadLineColor: { value: colorVec3(tokens, '--tap-thread-line') },
    uAccentColor: { value: colorVec3(tokens, '--tap-accent') },
    // D-27 default (thread.js's implicit fixed axis, until setThreadFrame
    // reads the node's actual stored frame): origin at the scene's own
    // zero, direction the historical `0 0 -1`.
    uThreadOrigin: { value: new THREE.Vector3(0, 0, 0) },
    uThreadDirection: { value: new THREE.Vector3(0, 0, -1) },
  }
}

/** Sets the D-27 spatial frame's origin and direction uniforms from a
 * `ThreadFrame` (`parseThreadFrame`'s read of the node's stored
 * properties) — the seam that keeps `threadPoint`/`threadAxis` honest
 * about never hardcoding the axis. */
export function setThreadFrame(
  uniforms: StageUniforms,
  frame: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } },
): void {
  uniforms.uThreadOrigin.value.set(frame.origin.x, frame.origin.y, frame.origin.z)
  uniforms.uThreadDirection.value.set(frame.direction.x, frame.direction.y, frame.direction.z).normalize()
}

/** Re-derives only the colour uniforms from a fresh token read (a theme
 * change), leaving geometry, history and the glyph atlas untouched. */
export function updateStageTokens(uniforms: StageUniforms, tokens: StageTokens): void {
  uniforms.uInkColor.value.copy(colorVec3(tokens, '--tap-ink'))
  uniforms.uMutedColor.value.copy(colorVec3(tokens, '--tap-muted'))
  uniforms.uThreadLineColor.value.copy(colorVec3(tokens, '--tap-thread-line'))
  uniforms.uAccentColor.value.copy(colorVec3(tokens, '--tap-accent'))
}

/** Sets the floating render origin from an absolute thread-time `t`
 * (thread.js:623-628) and returns `t` unchanged, so a caller can write
 * `const origin = setOrigin(uniforms, t)` in one line. */
export function setOrigin(uniforms: StageUniforms, t: number): number {
  const [block, offset] = splitTime(t)
  uniforms.uOriginBlock.value = block
  uniforms.uOriginOffset.value = offset
  return t
}

// ---------------------------------------------------------------------------
// Upload-range trap (RESEARCH Pitfall 6 / thread.js:239-258, verbatim)
// ---------------------------------------------------------------------------

/** Attributes awaiting a full upload: three.js uploads only the update
 * ranges when any exist, so a range added after a full-upload request would
 * silently replace it. An attribute in this set takes no new ranges until
 * the next render has uploaded it in full. */
export const pendingFullUpload = new Set<THREE.BufferAttribute | THREE.InstancedBufferAttribute>()

export function markRange(
  attrs: readonly (THREE.BufferAttribute | THREE.InstancedBufferAttribute)[],
  start: number,
  count: number,
): void {
  for (const attr of attrs) {
    if (!pendingFullUpload.has(attr)) attr.addUpdateRange(start, count)
    attr.needsUpdate = true
  }
}

export function markAll(attrs: readonly (THREE.BufferAttribute | THREE.InstancedBufferAttribute)[]): void {
  for (const attr of attrs) {
    attr.clearUpdateRanges()
    attr.needsUpdate = true
    pendingFullUpload.add(attr)
  }
}

/** Call once per rendered frame, after `renderer.render(...)`: a full upload
 * requested this frame has now reached the GPU, so the next frame's
 * `markRange` calls may resume adding incremental ranges (thread.js's
 * `pendingFullUpload.clear()` in its own frame loop). */
export function clearPendingFullUpload(): void {
  pendingFullUpload.clear()
}

function floatAttr(array: Float32Array): THREE.BufferAttribute {
  const attr = new THREE.BufferAttribute(array, 1)
  attr.setUsage(THREE.DynamicDrawUsage)
  return attr
}

// ---------------------------------------------------------------------------
// Ribbon material
// ---------------------------------------------------------------------------

function createRibbonMaterial(uniforms: StageUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader:
      STAGE_COMMON_GLSL +
      /* glsl */ `
      attribute float aBlock, aOffset, aLocal, aSide, aKind;
      uniform float uWidth, uMinPx;
      varying float vRel, vLocal, vSide, vKind;
      void main() {
        float rel = relTime(aBlock, aOffset);
        vec4 mv = threadPoint(rel);
        vec2 axis = threadAxis();
        vec2 perp = vec2(-axis.y, axis.x);
        mv.xy += perp * max(uWidth, uMinPx * unitsPerPx(mv)) * aSide;
        gl_Position = projectionMatrix * mv;
        vRel = rel; vLocal = aLocal; vSide = aSide; vKind = aKind;
      }`,
    fragmentShader:
      SLOWDOWN_UNIFORM_GLSL +
      /* glsl */ `
      uniform float uNowRel, uFade, uFadeOn, uHz;
      uniform vec3 uInkColor, uThreadLineColor;
      varying float vRel, vLocal, vSide, vKind;
      void main() {
        float age = uNowRel - vRel;
        if (age < 0.0) discard;
        float fade = uFadeOn > 0.5 ? clamp(1.0 - age / uFade, 0.0, 1.0) : 1.0;
        float across = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
        float alpha;
        vec3 color;
        if (vKind < 0.5) {
          // Session (kind 0): dots at the ordinary HZ rate.
          float s = vLocal * uHz;
          float ds = max(fwidth(s), 1e-6);
          float sideFw = max(fwidth(vSide), 1e-6);
          vec2 px = vec2((fract(s) - 0.5) / ds, vSide / sideFw);
          float radius = min(0.4 / ds, 1.0 / sideFw);
          float dotMask = 1.0 - smoothstep(radius - 1.0, radius, length(px));
          alpha = mix(dotMask, 0.75 * across, smoothstep(0.3, 0.8, ds));
          color = uInkColor * 0.55; // "Dots" (UI-SPEC): --tap-ink at 55%
        } else if (vKind < 1.5) {
          // Gap between sessions (kind 1, D-16): a dashed line, true length.
          float s = vLocal * 0.2; // one dash per 5s of absence
          float ds = fwidth(s);
          float dash = 1.0 - smoothstep(0.5 - ds, 0.5 + ds, fract(s));
          alpha = mix(dash, 0.5, smoothstep(0.3, 0.8, ds)) * across * 0.35;
          color = uThreadLineColor;
        } else {
          // Pause within a session (kind 2, D-11/D-12/D-13): the line keeps
          // moving at a constant speed; only dot density changes, following
          // the exact same closed-form rate integral slowdown.ts computes
          // on the CPU, so a 120Hz display draws the same line (D-13).
          float s = pausePhase(vLocal);
          float ds = max(fwidth(s), 1e-6);
          float sideFw = max(fwidth(vSide), 1e-6);
          vec2 px = vec2((fract(s) - 0.5) / ds, vSide / sideFw);
          float radius = min(0.4 / ds, 1.0 / sideFw);
          float dotMask = 1.0 - smoothstep(radius - 1.0, radius, length(px));
          alpha = mix(dotMask, 0.75 * across, smoothstep(0.3, 0.8, ds));
          color = uInkColor * 0.55;
        }
        alpha *= fade;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(color, alpha);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

// ---------------------------------------------------------------------------
// Ribbon — sessions (kind 0), gaps (kind 1) and pauses (kind 2), each a
// chunk of at most CHUNK seconds, stored in columnar typed arrays with
// doubling capacity (RESEARCH Pattern 4: "not one object per letter" — and,
// equally, not one object per chunk).
// ---------------------------------------------------------------------------

interface ChunkSpan {
  start: number
  end: number
  kind: ChunkKind
}

export class Ribbon {
  readonly mesh: THREE.Mesh
  private capacity: number
  private block: Float32Array
  private offset: Float32Array
  private local: Float32Array
  private side: Float32Array
  private kind: Float32Array
  private attrs: THREE.BufferAttribute[]
  private spans: ChunkSpan[] = []

  constructor(initialCapacity = 4096) {
    this.capacity = initialCapacity
    const [block, offset, local, side, kind, attrs, geometry] = Ribbon.allocate(initialCapacity)
    this.block = block
    this.offset = offset
    this.local = local
    this.side = side
    this.kind = kind
    this.attrs = attrs
    this.mesh = new THREE.Mesh(geometry, undefined)
    this.mesh.frustumCulled = false
  }

  /** The ribbon's live geometry. Reassigned wholesale when capacity grows
   * (see `growIfNeeded`), so callers must read this accessor rather than
   * caching the geometry object across an `addSpan`/`extendLast` call. */
  get geometry(): THREE.BufferGeometry {
    return this.mesh.geometry
  }

  /** Attaches this ribbon's material, built from the shared stage uniforms.
   * Kept separate from the constructor so a caller controls uniform
   * lifetime (one shared object across ribbon, glyphs and the camera). */
  setUniforms(uniforms: StageUniforms): void {
    this.mesh.material = createRibbonMaterial(uniforms)
  }

  private static allocate(
    capacity: number,
  ): [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, THREE.BufferAttribute[], THREE.BufferGeometry] {
    const v = capacity * 4
    const block = new Float32Array(v)
    const offset = new Float32Array(v)
    const local = new Float32Array(v)
    const side = new Float32Array(v)
    const kind = new Float32Array(v)
    const index = new Uint32Array(capacity * 6)
    for (let c = 0; c < capacity; c++) {
      index.set([c * 4, c * 4 + 1, c * 4 + 2, c * 4 + 1, c * 4 + 3, c * 4 + 2], c * 6)
    }
    const geometry = new THREE.BufferGeometry()
    const attrs: THREE.BufferAttribute[] = []
    for (const [name, array] of [
      ['aBlock', block],
      ['aOffset', offset],
      ['aLocal', local],
      ['aSide', side],
      ['aKind', kind],
    ] as const) {
      const attr = floatAttr(array)
      geometry.setAttribute(name, attr)
      attrs.push(attr)
    }
    geometry.setAttribute('position', attrs[1]) // three needs one; the shader ignores it
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    geometry.setDrawRange(0, 0)
    return [block, offset, local, side, kind, attrs, geometry]
  }

  private growIfNeeded(): void {
    if (this.spans.length < this.capacity) return
    const nextCapacity = this.capacity * 2
    const [block, offset, local, side, kind, attrs, geometry] = Ribbon.allocate(nextCapacity)
    block.set(this.block)
    offset.set(this.offset)
    local.set(this.local)
    side.set(this.side)
    kind.set(this.kind)
    geometry.setDrawRange(0, this.spans.length * 6)
    const oldGeometry = this.mesh.geometry
    this.capacity = nextCapacity
    this.block = block
    this.offset = offset
    this.local = local
    this.side = side
    this.kind = kind
    this.attrs = attrs
    this.mesh.geometry = geometry
    oldGeometry.dispose()
    markAll(this.attrs)
  }

  get count(): number {
    return this.spans.length
  }

  get lastKind(): ChunkKind | undefined {
    return this.spans[this.spans.length - 1]?.kind
  }

  reset(): void {
    this.spans = []
    this.geometry.setDrawRange(0, 0)
  }

  /** Adds a span from `start` to `end`, splitting it into CHUNK-second
   * pieces (thread.js's `addSpan`) so no single chunk spans more than 600s
   * of thread time — the same precision reasoning as the floating origin. */
  addSpan(start: number, end: number, kind: ChunkKind): void {
    for (let s = start; s < end - 1e-9 || s === start; s += CHUNK) {
      this.push(s, Math.min(end, s + CHUNK), kind)
      if (end - s <= CHUNK) break
    }
  }

  private push(start: number, end: number, kind: ChunkKind): void {
    this.growIfNeeded()
    this.spans.push({ start, end, kind })
    this.write(this.count - 1)
    this.geometry.setDrawRange(0, this.count * 6)
  }

  private write(c: number): void {
    const { start, end, kind } = this.spans[c]
    for (let k = 0; k < 4; k++) {
      const [block, offset] = splitTime(k < 2 ? start : end)
      const v = c * 4 + k
      this.block[v] = block
      this.offset[v] = offset
      this.local[v] = k < 2 ? 0 : end - start
      this.side[v] = k % 2 === 0 ? -1 : 1
      this.kind[v] = kind
    }
    markRange(this.attrs, c * 4, 4)
  }

  /** Extends the ribbon's last chunk to `t`, splitting into a new chunk once
   * it would exceed CHUNK seconds (the live-view tick, thread.js's
   * `extendLast`). Starts a fresh zero-length kind-0 chunk at `t` if the
   * ribbon has no chunk yet (an empty ribbon, before any `addSpan` call) --
   * a caller's per-frame tick can safely run before its own first history
   * load completes without checking `count` itself. */
  extendLast(t: number): void {
    if (this.count === 0) {
      this.addSpan(t, t, 0)
      return
    }
    const c = this.count - 1
    const span = this.spans[c]
    if (t - span.start > CHUNK) {
      span.end = span.start + CHUNK
      this.write(c)
      this.push(span.end, t, span.kind)
    } else {
      span.end = t
      this.write(c)
    }
  }

  /** GPU buffer size in bytes (5 float attributes × 4 vertices per chunk,
   * plus the index buffer). */
  bytes(): number {
    return this.count * 4 * 5 * 4 + this.count * 6 * 4
  }
}
