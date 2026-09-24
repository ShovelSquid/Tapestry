/**
 * `StrandLayer` — per-author strands, twisting where two authors wrote
 * close together (D-20..D-23, UI-SPEC "Line, strand, letter and marker
 * treatment" and "Agents writing live"). Ported in the same structural shape
 * as `ribbon.ts`'s `Ribbon` (columnar chunk attributes, doubling capacity,
 * one draw call, `pendingFullUpload`-safe bulk builds) — the identical
 * silent-failure traps that module already paid for apply here too.
 *
 * **Scope of this build (documented simplification):** a strand is drawn
 * only across the author's own derived writing spans (`deriveAuthorSpans`),
 * never across the gaps between them — the UI-SPEC's "outside shared
 * stretches the silent strand drops to 25%" describes a persistent line for
 * the whole thread duration, which this build does not yet draw; a strand
 * simply is not drawn where its author has not written at all. What *is*
 * implemented in full: a distinct colour and dash pattern per author, the
 * person always solid and nearest, and a smooth twist (one crossing per 1.0s
 * of thread time) through every stretch where two different authors wrote
 * within `SPAN_GAP_SECONDS` of each other (`computeTwistWindows`).
 *
 * A thread with only one author never calls `buildFromSpans` with more than
 * one distinct actor, so nothing here draws for it — `ribbon.ts`'s existing
 * `--tap-thread-line` is the single-author line, unchanged.
 */

import * as THREE from 'three'
import { STAGE_COMMON_GLSL, markAll, markRange, splitTime, type StageUniforms } from './ribbon'
import { AUTHOR_TOKEN_NAMES } from './tokens'

/** D-21: "within a 2s window" — both the span-merging threshold
 * (`deriveAuthorSpans`) and the twist-detection threshold
 * (`computeTwistWindows`) use the identical value, since both answer the
 * same underlying question ("close enough in time to read as together"). */
export const SPAN_GAP_SECONDS = 2

/** UI-SPEC "Agents writing live": "one smooth crossing per 1.0s of thread time". */
export const TWIST_PERIOD_SECONDS = 1.0

/** UI-SPEC "Spacing": 6px, clamped 4-12px as zoom changes. */
export const STRAND_SEPARATION_PX = 6
export const STRAND_SEPARATION_MIN_PX = 4
export const STRAND_SEPARATION_MAX_PX = 12

/** UI-SPEC "Spacing": "Strand drag-apart travel: 120px maximum." */
export const SEPARATION_BOOST_MAX_PX = 120

/** Seconds per strand chunk (mirrors `ribbon.ts`'s `CHUNK`, the same
 * floating-origin precision reasoning). */
const CHUNK_SECONDS = 600

/**
 * UI-SPEC "Agents writing live": the chip shown while a strand is pulled
 * apart (drag or the `A` key). Named here, once, so `ThreadOverlay.tsx`
 * never risks the copy drifting from what this module's own behaviour
 * actually does — a display transform with no commit path anywhere in this
 * file, so the document really hasn't changed no matter how far apart the
 * strands are pulled.
 */
export function separationChipText(agentName: string): string {
  return `Showing agent.${agentName} on its own. The document hasn't changed.`
}

// ---------------------------------------------------------------------------
// Pure span/twist derivation (no WebGL — unit-testable on its own)
// ---------------------------------------------------------------------------

export interface AuthorLetterTiming {
  insertedAtMs: number
  actor: string
}

export interface AuthorSpan {
  actor: string
  startSeconds: number
  endSeconds: number
}

export interface TwistWindow {
  startSeconds: number
  endSeconds: number
}

/**
 * Groups one author's letters, in arrival order, into spans: consecutive
 * letters by the same actor within `gapSeconds` of each other merge into one
 * span; a longer gap starts a new one. `threadStartMs` is the same floating
 * origin the rest of the stage uses (thread-relative seconds), so a span's
 * `startSeconds`/`endSeconds` line up directly with `ribbon.ts`'s own chunk
 * times.
 */
export function deriveAuthorSpans(
  letters: readonly AuthorLetterTiming[],
  threadStartMs: number,
  gapSeconds: number = SPAN_GAP_SECONDS,
): AuthorSpan[] {
  const byActor = new Map<string, number[]>()
  for (const letter of letters) {
    if (!Number.isFinite(letter.insertedAtMs)) continue
    const seconds = (letter.insertedAtMs - threadStartMs) / 1000
    const times = byActor.get(letter.actor)
    if (times) times.push(seconds)
    else byActor.set(letter.actor, [seconds])
  }

  const spans: AuthorSpan[] = []
  for (const [actor, times] of byActor) {
    times.sort((a, b) => a - b)
    let start = times[0]
    let end = times[0]
    for (let i = 1; i < times.length; i++) {
      if (times[i] - end <= gapSeconds) {
        end = times[i]
      } else {
        spans.push({ actor, startSeconds: start, endSeconds: end })
        start = times[i]
        end = times[i]
      }
    }
    spans.push({ actor, startSeconds: start, endSeconds: end })
  }
  spans.sort((a, b) => a.startSeconds - b.startSeconds)
  return spans
}

function mergeWindows(windows: readonly TwistWindow[]): TwistWindow[] {
  if (windows.length === 0) return []
  const sorted = [...windows].sort((a, b) => a.startSeconds - b.startSeconds)
  const merged: TwistWindow[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i].startSeconds <= last.endSeconds) {
      last.endSeconds = Math.max(last.endSeconds, sorted[i].endSeconds)
    } else {
      merged.push({ ...sorted[i] })
    }
  }
  return merged
}

/**
 * Every stretch where two *different* authors' spans fall within
 * `gapSeconds` of each other (including outright overlap) — the twist
 * windows `buildFromSpans` bends the strand geometry through. Computed by
 * dilating each span by `gapSeconds` on both ends and intersecting pairs
 * from different authors, then merging overlapping results — this is the
 * same "within N of each other" test whichever direction the gap falls on.
 */
export function computeTwistWindows(
  spans: readonly AuthorSpan[],
  gapSeconds: number = SPAN_GAP_SECONDS,
): TwistWindow[] {
  const raw: TwistWindow[] = []
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[i].actor === spans[j].actor) continue
      const aStart = spans[i].startSeconds - gapSeconds
      const aEnd = spans[i].endSeconds + gapSeconds
      const bStart = spans[j].startSeconds - gapSeconds
      const bEnd = spans[j].endSeconds + gapSeconds
      const start = Math.max(aStart, bStart)
      const end = Math.min(aEnd, bEnd)
      if (end > start) raw.push({ startSeconds: start, endSeconds: end })
    }
  }
  return mergeWindows(raw)
}

/** Whether `seconds` falls inside any of `windows` (linear scan — the
 * windows list is small relative to a thread's own span count). */
function isInsideAnyWindow(windows: readonly TwistWindow[], seconds: number): boolean {
  return windows.some((w) => seconds >= w.startSeconds && seconds <= w.endSeconds)
}

/**
 * Splits `span` into pieces that are each wholly inside or wholly outside
 * every twist window, tagging each piece — the CPU-side work that lets the
 * shader treat "twist" as a per-chunk constant rather than a per-fragment
 * lookup into a variable-length window list.
 */
export function splitSpanByTwistWindows(
  span: AuthorSpan,
  windows: readonly TwistWindow[],
): Array<{ startSeconds: number; endSeconds: number; twisting: boolean }> {
  const boundaries = new Set<number>([span.startSeconds, span.endSeconds])
  for (const w of windows) {
    if (w.startSeconds > span.startSeconds && w.startSeconds < span.endSeconds) boundaries.add(w.startSeconds)
    if (w.endSeconds > span.startSeconds && w.endSeconds < span.endSeconds) boundaries.add(w.endSeconds)
  }
  const sorted = [...boundaries].sort((a, b) => a - b)
  const pieces: Array<{ startSeconds: number; endSeconds: number; twisting: boolean }> = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]
    const end = sorted[i + 1]
    if (end <= start) continue
    const mid = (start + end) / 2
    pieces.push({ startSeconds: start, endSeconds: end, twisting: isInsideAnyWindow(windows, mid) })
  }
  return pieces
}

// ---------------------------------------------------------------------------
// WebGL layer
// ---------------------------------------------------------------------------

function floatAttr(array: Float32Array): THREE.BufferAttribute {
  const attr = new THREE.BufferAttribute(array, 1)
  attr.setUsage(THREE.DynamicDrawUsage)
  return attr
}

function createStrandMaterial(uniforms: StageUniforms, authorColors: THREE.Vector3[]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uAuthorColors: { value: authorColors },
      uSeparationPx: { value: STRAND_SEPARATION_PX },
      uSeparationMinPx: { value: STRAND_SEPARATION_MIN_PX },
      uSeparationMaxPx: { value: STRAND_SEPARATION_MAX_PX },
      uTwistPeriod: { value: TWIST_PERIOD_SECONDS },
      // D-23/L-2: the drag-apart / `A`-key display transform. Always 0 by
      // default (parallel strands at their ordinary 6-12px separation);
      // ThreadOverlay.tsx drives this toward `SEPARATION_BOOST_MAX_PX` while
      // dragging or latched, and back to 0 on release -- a pure per-frame
      // uniform write, never a document edit (no commit path exists in this
      // file at all).
      uSeparationBoost: { value: 0 },
    },
    vertexShader:
      STAGE_COMMON_GLSL +
      /* glsl */ `
      attribute float aBlock, aOffset, aLocal, aSide, aAuthor, aTwist, aStrandSign;
      uniform float uSeparationPx, uSeparationMinPx, uSeparationMaxPx, uMinPx, uWidth, uTwistPeriod, uSeparationBoost;
      varying float vLocal, vSide, vAuthor;
      void main() {
        float rel = relTime(aBlock, aOffset);
        vec4 mv = threadPoint(rel);
        vec2 axis = threadAxis();
        vec2 perp = vec2(-axis.y, axis.x);
        float upp = unitsPerPx(mv);
        float sepPx = clamp(uSeparationPx, uSeparationMinPx, uSeparationMaxPx) + uSeparationBoost;
        // The person (aStrandSign < 0) is always the near strand; an agent
        // (aStrandSign > 0) is the far one. Inside a twist window the sign
        // itself oscillates -- "one smooth crossing per 1.0s of thread time"
        // (UI-SPEC) -- so the two strands trade places smoothly rather than
        // snapping. While separated (uSeparationBoost > 0), the extra
        // distance keeps them legible as two lines even mid-twist.
        float sign = aStrandSign;
        if (aTwist > 0.5) {
          sign = aStrandSign * cos(6.28318530718 * rel / uTwistPeriod);
        }
        float lateral = sepPx * upp * sign;
        mv.xy += perp * lateral;
        // The line body itself (across its own 1.5px width, like the ribbon).
        mv.xy += perp * max(uWidth, uMinPx * upp) * aSide;
        gl_Position = projectionMatrix * mv;
        vLocal = aLocal;
        vSide = aSide;
        vAuthor = aAuthor;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uAuthorColors[${AUTHOR_TOKEN_NAMES.length}];
      varying float vLocal, vSide, vAuthor;
      // A per-author dash pattern (UI-SPEC "Author identity"): the person
      // (author 0) is solid; each agent index gets a distinct on/off period
      // along the strand, so the pattern alone (never only colour) tells
      // authors apart (DRAW-04).
      float dashAlpha(float author, float local) {
        int a = int(author + 0.5);
        if (a == 0) return 1.0; // person: solid
        float period = 6.0;
        float duty = 0.5;
        if (a == 2) { period = 6.0; duty = 0.66; }      // dashed (4 on, 2 off)
        else if (a == 3) { period = 10.0; duty = 0.8; } // long dash (8 on, 2 off)
        else if (a == 4) { period = 8.0; duty = 0.5; }  // dash-dot (approximated)
        else if (a == 5) { return 1.0; }                // double rule: solid core, drawn via vSide band below
        else if (a >= 6) { period = 3.0; duty = 0.5; }  // unknown: short wavy-ish dashes
        else { period = 4.0; duty = 0.5; }              // agent 1: dotted (2 on, 2 off)
        float phase = mod(local, period) / period;
        return step(phase, duty);
      }
      void main() {
        float across = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
        int a = int(vAuthor + 0.5);
        float dash = dashAlpha(vAuthor, vLocal);
        // Author 5 (double rule): two thin bands rather than a dash test.
        if (a == 5) {
          dash = step(0.15, abs(vSide)) * (1.0 - smoothstep(0.85, 1.0, abs(vSide)));
        }
        float alpha = dash * across;
        if (alpha < 0.02) discard;
        vec3 color = uAuthorColors[max(0, min(${AUTHOR_TOKEN_NAMES.length - 1}, a))];
        gl_FragColor = vec4(color, alpha);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

interface ChunkRecord {
  start: number
  end: number
  author: number
  twisting: boolean
  /** -1 for the near (person) strand, +1 for a far (agent) strand. */
  strandSign: number
}

export class StrandLayer {
  readonly mesh: THREE.Mesh
  private capacity: number
  private block!: Float32Array
  private offset!: Float32Array
  private local!: Float32Array
  private side!: Float32Array
  private author!: Float32Array
  private twist!: Float32Array
  private strandSign!: Float32Array
  private attrs!: THREE.BufferAttribute[]
  private chunks: ChunkRecord[] = []

  constructor(initialCapacity = 512) {
    this.capacity = initialCapacity
    const geometry = StrandLayer.allocate(initialCapacity, this)
    this.mesh = new THREE.Mesh(geometry, undefined)
    this.mesh.frustumCulled = false
  }

  get geometry(): THREE.BufferGeometry {
    return this.mesh.geometry
  }

  setUniforms(uniforms: StageUniforms, authorColors: THREE.Vector3[]): void {
    this.mesh.material = createStrandMaterial(uniforms, authorColors)
  }

  /**
   * D-23/L-2: sets the drag-apart / `A`-key separation boost, clamped to
   * `[0, SEPARATION_BOOST_MAX_PX]` (UI-SPEC "Strand drag-apart travel: 120px
   * maximum"). A pure per-frame uniform write — this file has no commit or
   * kernel-submit call of any kind, so the document is unaffected regardless
   * of how far apart the strands are pulled.
   */
  setSeparationBoost(px: number): void {
    const material = this.mesh.material as THREE.ShaderMaterial | undefined
    if (!material) return
    const clamped = Math.max(0, Math.min(SEPARATION_BOOST_MAX_PX, px))
    ;(material.uniforms.uSeparationBoost as THREE.IUniform<number>).value = clamped
  }

  private static allocate(capacity: number, self: StrandLayer): THREE.BufferGeometry {
    const v = capacity * 4
    self.block = new Float32Array(v)
    self.offset = new Float32Array(v)
    self.local = new Float32Array(v)
    self.side = new Float32Array(v)
    self.author = new Float32Array(v)
    self.twist = new Float32Array(v)
    self.strandSign = new Float32Array(v)
    const index = new Uint32Array(capacity * 6)
    for (let c = 0; c < capacity; c++) {
      index.set([c * 4, c * 4 + 1, c * 4 + 2, c * 4 + 1, c * 4 + 3, c * 4 + 2], c * 6)
    }
    const geometry = new THREE.BufferGeometry()
    self.attrs = []
    for (const [name, array] of [
      ['aBlock', self.block],
      ['aOffset', self.offset],
      ['aLocal', self.local],
      ['aSide', self.side],
      ['aAuthor', self.author],
      ['aTwist', self.twist],
      ['aStrandSign', self.strandSign],
    ] as const) {
      const attr = floatAttr(array)
      geometry.setAttribute(name, attr)
      self.attrs.push(attr)
    }
    geometry.setAttribute('position', self.attrs[1])
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    geometry.setDrawRange(0, 0)
    return geometry
  }

  reset(): void {
    this.chunks = []
    this.geometry.setDrawRange(0, 0)
  }

  get chunkCount(): number {
    return this.chunks.length
  }

  private growIfNeeded(): void {
    if (this.chunks.length < this.capacity) return
    const nextCapacity = this.capacity * 2
    const oldGeometry = this.mesh.geometry
    const geometry = StrandLayer.allocate(nextCapacity, this)
    // allocate() reset the typed arrays to fresh (zeroed) buffers; re-seed
    // them from the chunk records rather than copying stale arrays, since
    // the write layout is identical either way and this keeps growIfNeeded
    // simple (no partial-copy bookkeeping to get wrong).
    this.capacity = nextCapacity
    this.mesh.geometry = geometry
    oldGeometry.dispose()
    for (let c = 0; c < this.chunks.length; c++) this.write(c)
    markAll(this.attrs)
    this.geometry.setDrawRange(0, this.chunks.length * 6)
  }

  private write(c: number): void {
    const { start, end, author, twisting, strandSign } = this.chunks[c]
    for (let k = 0; k < 4; k++) {
      const [block, offset] = splitTime(k < 2 ? start : end)
      const v = c * 4 + k
      this.block[v] = block
      this.offset[v] = offset
      this.local[v] = k < 2 ? 0 : end - start
      this.side[v] = k % 2 === 0 ? -1 : 1
      this.author[v] = author
      this.twist[v] = twisting ? 1 : 0
      this.strandSign[v] = strandSign
    }
    markRange(this.attrs, c * 4, 4)
  }

  private push(chunk: ChunkRecord): void {
    this.growIfNeeded()
    this.chunks.push(chunk)
    this.write(this.chunks.length - 1)
    this.geometry.setDrawRange(0, this.chunks.length * 6)
  }

  /**
   * Adds one author's span, split into `CHUNK_SECONDS` pieces (the same
   * floating-origin reasoning as `Ribbon.addSpan`) and further split at
   * every twist-window boundary crossing it, so each chunk's `aTwist` is a
   * genuine per-chunk constant.
   */
  private addAuthorSpan(span: AuthorSpan, author: number, strandSign: number, windows: readonly TwistWindow[]): void {
    for (const piece of splitSpanByTwistWindows(span, windows)) {
      for (let s = piece.startSeconds; s < piece.endSeconds - 1e-9 || s === piece.startSeconds; s += CHUNK_SECONDS) {
        const end = Math.min(piece.endSeconds, s + CHUNK_SECONDS)
        this.push({ start: s, end, author, twisting: piece.twisting, strandSign })
        if (piece.endSeconds - s <= CHUNK_SECONDS) break
      }
    }
  }

  /**
   * Builds every strand chunk from a thread's own author spans (bulk build).
   * `authorIndexOf` maps an actor id to its 0-6 palette slot
   * (`author-palette.ts`'s `authorPaletteIndex`) — index 0 (the person) is
   * always the near strand (`strandSign = -1`); every other author is a far
   * strand (`strandSign = +1`). A thread with only one distinct actor draws
   * nothing (the plain single-author `--tap-thread-line` already covers it).
   */
  buildFromSpans(spans: readonly AuthorSpan[], authorIndexOf: (actor: string) => number): void {
    this.reset()
    const distinctActors = new Set(spans.map((s) => s.actor))
    if (distinctActors.size < 2) return

    const windows = computeTwistWindows(spans)
    for (const span of spans) {
      const author = authorIndexOf(span.actor)
      const strandSign = author === 0 ? -1 : 1
      this.addAuthorSpan(span, author, strandSign, windows)
    }
  }

  /** GPU buffer size in bytes (7 float attributes x 4 vertices per chunk, plus the index buffer). */
  bytes(): number {
    return this.chunks.length * 4 * 7 * 4 + this.chunks.length * 6 * 4
  }
}
