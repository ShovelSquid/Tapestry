/**
 * `MarkerLayer` — screen-space marker instances for deletion, undo, paste,
 * format and link moments (D-02, D-03, D-04, D-05; UI-SPEC "Ghost letters",
 * "Spacing", "Marker meaning without the stage").
 *
 * The ghost says *what* was deleted (`glyphs.ts`'s fade+strike); a marker
 * says *when something happened* — the deletion marker sits at the moment
 * of the deletion itself, never the moment of typing.
 *
 * Markers are drawn at a **fixed 6-8px screen-space size with a 20px pick
 * radius** (UI-SPEC "Spacing"): a marker means "a thing happened here", not
 * "a thing this big happened here", so its world-space size is derived from
 * `unitsPerPx` every frame, exactly like the ribbon's minimum stroke width
 * and the glyph layer's own screen-space concerns — never a fixed world
 * size. Colour is always `--tap-thread-line` at full strength: "Accent is
 * never used for ... markers" (UI-SPEC), and shape alone (never colour) is
 * what tells the five kinds apart.
 *
 * Uses the same instanced-write / update-range-marking pattern as
 * `glyphs.ts`'s `GlyphLayer` (RESEARCH Pattern 4), with its own doubling-
 * capacity buffers and its own draw call — one bounded, cheap call
 * regardless of how many markers a heavily-edited stretch accumulates
 * (T-02.3-05-03).
 */

import * as THREE from 'three'
import { STAGE_COMMON_GLSL, splitTime, type StageUniforms } from './ribbon'
import type { ThreadCause } from '../../../shared/threads/grammar'
import type { TimedThreadRecord } from '../../../shared/threads/replay'

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

/** The five marker kinds this plan covers (CONTEXT.md's "Claude's
 * Discretion" leaves exact shape/visual design to the implementation; D-07's
 * time-out/time-in dashes and D-24's "written before the thread started"
 * marker are a different, session-bridge vocabulary owned by a later plan). */
export const MARKER_KINDS = ['deletion', 'undo', 'paste', 'format', 'link'] as const

export type MarkerKind = (typeof MARKER_KINDS)[number]

const MARKER_KIND_INDEX: Record<MarkerKind, number> = {
  deletion: 0,
  undo: 1,
  paste: 2,
  format: 3,
  link: 4,
}

/** One marker instance: a kind, the absolute moment it happened (D-15's
 * recorded time), and an optional reference (a link's target, for its
 * label). */
export interface MarkerInstance {
  kind: MarkerKind
  atMs: number
  ref?: string
}

// ---------------------------------------------------------------------------
// Classifying a record into a marker (or none)
// ---------------------------------------------------------------------------

/**
 * Which marker (if any) a single `thread.log` record drops on the line.
 * Cause takes priority over verb, because the cause is the more specific
 * fact: an `undo`-caused deletion is an undo marker, not a second, generic
 * deletion marker for the same moment. `cut` reads as a deletion (its
 * record verb is always `del`); `drop` reads as a paste (D-20: a whole
 * write lands as one tight cluster, the same "arrived all at once" shape
 * a paste has) -- neither has its own kind in this plan's five-kind scope.
 */
export function markerKindForRecord(record: { verb: string; cause: ThreadCause | null }): MarkerKind | null {
  switch (record.cause) {
    case 'undo':
      return 'undo'
    case 'format':
      return 'format'
    case 'link':
      return 'link'
    case 'paste':
    case 'drop':
      return 'paste'
    default:
      break
  }
  if (record.verb === 'del') return 'deletion'
  return null
}

/**
 * Builds the flat, time-ordered marker list a thread's records produce
 * (UI-SPEC "Marker meaning without the stage": "one row per marker in time
 * order"). Per-session grouping (the `SessionList`/`MarkerList` split on
 * `in`/`out` boundaries) is a later plan's UI concern; this is the ordered
 * data that grouping reads from.
 */
export function markersFromRecords(records: readonly TimedThreadRecord[]): MarkerInstance[] {
  const markers: MarkerInstance[] = []
  for (const record of records) {
    const cause = 'cause' in record ? (record.cause as ThreadCause | null) : null
    const kind = markerKindForRecord({ verb: record.verb, cause })
    if (!kind) continue
    const ref = record.verb === 'marker' ? record.ref : undefined
    markers.push({ kind, atMs: record.atMs, ref })
  }
  return markers
}

// ---------------------------------------------------------------------------
// Label text (the same text a hover chip and the polite live region show)
// ---------------------------------------------------------------------------

function formatMarkerTime(atMs: number): string {
  return new Date(atMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "Linked to Cast · 14:05" (UI-SPEC's own example) -- the text `,`/`.`
 * stepping announces through the polite live region, and the same text a
 * `MarkerList` row and a hover chip show. */
export function markerLabel(marker: MarkerInstance): string {
  const time = formatMarkerTime(marker.atMs)
  switch (marker.kind) {
    case 'deletion':
      return `Deleted · ${time}`
    case 'undo':
      return `Undone · ${time}`
    case 'paste':
      return `Pasted · ${time}`
    case 'format':
      return `Formatted · ${time}`
    case 'link':
      return marker.ref ? `Linked to ${marker.ref} · ${time}` : `Linked · ${time}`
  }
}

// ---------------------------------------------------------------------------
// Keyboard stepping (`,` / `.` — UI-SPEC "Marker meaning without the stage")
// ---------------------------------------------------------------------------

/**
 * The next marker index in `direction` from `fromIndex` (`-1` meaning "no
 * marker focused yet"), clamped at either end rather than wrapping. Pure
 * index arithmetic: the caller owns focus, announcement and opening the
 * moment `Enter` would open.
 */
export function stepMarker(markers: readonly MarkerInstance[], fromIndex: number, direction: 1 | -1): number {
  if (markers.length === 0) return -1
  if (fromIndex < 0) return direction > 0 ? 0 : markers.length - 1
  const next = fromIndex + direction
  if (next < 0) return 0
  if (next >= markers.length) return markers.length - 1
  return next
}

/**
 * Attaches the `,`/`.` keyboard route (UI-SPEC "Marker meaning without the
 * stage") to `target`: while it has focus, `,`/`.` step to the previous/
 * next marker and announce that marker's own label via `onAnnounce` (the
 * text a caller feeds into its own `aria-live="polite"` region -- this
 * module owns none of the DOM around the stage `<canvas>`, only the
 * behaviour). `onFocusChange`, if given, receives the new index so a
 * caller can also move the accent ring / open the moment on `Enter`.
 *
 * Returns a cleanup function that removes the listener -- call it on
 * unmount, the same contract `useEffect` expects.
 *
 * Not wired into `ThreadOverlay.tsx` by this plan (not in its file list);
 * exported ready for the plan that owns the stage's focus/ARIA wiring.
 */
export function attachMarkerNav(
  target: HTMLElement,
  getMarkers: () => readonly MarkerInstance[],
  onAnnounce: (label: string) => void,
  onFocusChange?: (index: number) => void,
): () => void {
  let focusedIndex = -1
  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== ',' && event.key !== '.') return
    const markers = getMarkers()
    if (markers.length === 0) return
    focusedIndex = stepMarker(markers, focusedIndex, event.key === '.' ? 1 : -1)
    event.preventDefault()
    onFocusChange?.(focusedIndex)
    onAnnounce(markerLabel(markers[focusedIndex]))
  }
  target.addEventListener('keydown', handleKeyDown)
  return () => target.removeEventListener('keydown', handleKeyDown)
}

// ---------------------------------------------------------------------------
// Screen-space sizing (UI-SPEC "Spacing")
// ---------------------------------------------------------------------------

/** 8px is the smallest ring whose hole survives one device pixel of
 * anti-aliasing at DPR 2 (UI-SPEC); 7px sits mid-range of the 6-8px band. */
export const MARKER_PX = 7
/** The pick radius a future pointer-hit-test reads; not used for drawing. */
export const MARKER_PICK_RADIUS_PX = 20

// ---------------------------------------------------------------------------
// GPU layer
// ---------------------------------------------------------------------------

function floatAttr(size: number, itemSize: number): THREE.InstancedBufferAttribute {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(size * itemSize), itemSize)
  attr.setUsage(THREE.DynamicDrawUsage)
  return attr
}

interface MarkerAttrs {
  aBlock: THREE.InstancedBufferAttribute
  aOffset: THREE.InstancedBufferAttribute
  aKind: THREE.InstancedBufferAttribute
}

function createMarkerMaterial(uniforms: StageUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader:
      STAGE_COMMON_GLSL +
      /* glsl */ `
      attribute float aBlock, aOffset, aKind;
      uniform float uMarkerPx;
      varying vec2 vLocal;
      varying float vKind, vAlpha;
      void main() {
        float rel = relTime(aBlock, aOffset);
        vec4 mv = threadPoint(rel);
        float upp = unitsPerPx(mv);
        vec2 axis = threadAxis();
        vec2 perp = vec2(-axis.y, axis.x);
        vec2 local = position.xy; // unit plane, [-0.5, 0.5]
        float size = uMarkerPx * upp; // fixed screen-space size at every zoom
        mv.xy += axis * local.x * size + perp * local.y * size;
        gl_Position = projectionMatrix * mv;
        vLocal = local;
        vKind = aKind;
        float future = step(0.0, uNowRel - rel + 1e-3);
        vAlpha = fadeFor(rel) * future;
        if (vAlpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uThreadLineColor;
      varying vec2 vLocal;
      varying float vKind, vAlpha;
      // Five procedural shapes, one signed-distance test each, so a marker
      // needs no atlas cell of its own. Shape alone tells them apart --
      // every one draws in the same --tap-thread-line colour (DRAW-04:
      // never colour as the only cue; UI-SPEC: accent is never a marker).
      void main() {
        vec2 p = vLocal;
        float d;
        if (vKind < 0.5) {
          // deletion: a cross-tick (X), clipped to a disc
          d = min(abs(p.x - p.y), abs(p.x + p.y)) - 0.07;
          d = max(d, length(p) - 0.32);
        } else if (vKind < 1.5) {
          // undo: a ring with a notch (an undo arrow's loop)
          float ang = atan(p.y, p.x);
          float ring = abs(length(p) - 0.24) - 0.07;
          float notch = step(0.5, cos(ang - 2.3));
          d = ring + notch * 10.0;
        } else if (vKind < 2.5) {
          // paste: a filled diamond
          d = (abs(p.x) + abs(p.y)) - 0.32;
        } else if (vKind < 3.5) {
          // format: a filled disc
          d = length(p) - 0.28;
        } else {
          // link: a full ring
          d = abs(length(p) - 0.24) - 0.08;
        }
        float w = max(fwidth(d), 1e-5);
        float alpha = (1.0 - smoothstep(-w, w, d)) * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uThreadLineColor, alpha);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

export class MarkerLayer {
  readonly mesh: THREE.Mesh
  private geometry: THREE.InstancedBufferGeometry
  private capacity: number
  private attrs: MarkerAttrs
  private count = 0

  constructor(initialCapacity = 256) {
    this.capacity = initialCapacity
    const plane = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = plane.index
    geometry.setAttribute('position', plane.getAttribute('position'))
    this.attrs = MarkerLayer.allocateAttrs(initialCapacity)
    for (const [name, attr] of Object.entries(this.attrs)) geometry.setAttribute(name, attr)
    geometry.instanceCount = 0
    this.geometry = geometry
    this.mesh = new THREE.Mesh(geometry, undefined)
    this.mesh.frustumCulled = false
  }

  private static allocateAttrs(capacity: number): MarkerAttrs {
    return {
      aBlock: floatAttr(capacity, 1),
      aOffset: floatAttr(capacity, 1),
      aKind: floatAttr(capacity, 1),
    }
  }

  /** Attaches this layer's material, built from the shared stage uniforms
   * (the same object the ribbon and glyph layers share) plus `uMarkerPx`. */
  setUniforms(uniforms: StageUniforms): void {
    const material = createMarkerMaterial({ ...uniforms, uMarkerPx: { value: MARKER_PX } } as StageUniforms)
    this.mesh.material = material
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
    const next = MarkerLayer.allocateAttrs(nextCapacity)
    for (const key of Object.keys(this.attrs) as (keyof MarkerAttrs)[]) {
      next[key].array.set(this.attrs[key].array as Float32Array)
      this.geometry.setAttribute(key, next[key])
    }
    this.capacity = nextCapacity
    this.attrs = next
  }

  /** Adds one marker at absolute thread time `t` (seconds, the same clock
   * `GlyphLayer.add`/`Ribbon.addSpan` use). `bulk` skips the per-instance
   * update-range marking for a historical load; call `markBulkUploaded()`
   * once after a batch of bulk adds. */
  add(t: number, kind: MarkerKind, options: { bulk?: boolean } = {}): void {
    this.growIfNeeded()
    const i = this.count
    const [block, offset] = splitTime(t)
    this.attrs.aBlock.setX(i, block)
    this.attrs.aOffset.setX(i, offset)
    this.attrs.aKind.setX(i, MARKER_KIND_INDEX[kind])
    this.count++
    this.geometry.instanceCount = this.count

    if (!options.bulk) {
      for (const attr of Object.values(this.attrs)) {
        attr.addUpdateRange(i * attr.itemSize, attr.itemSize)
        attr.needsUpdate = true
      }
    }
  }

  /** Mirrors `GlyphLayer.markBulkUploaded`: clears any pending per-instance
   * ranges and requests one full upload after a batch of bulk `add` calls. */
  markBulkUploaded(): void {
    for (const attr of Object.values(this.attrs)) {
      attr.clearUpdateRanges()
      attr.needsUpdate = true
    }
  }

  /** GPU buffer size in bytes: 3 attributes, 12 bytes/instance. */
  bytes(): number {
    const itemSizes = Object.values(this.attrs).reduce((sum, attr) => sum + attr.itemSize, 0)
    return this.count * itemSizes * 4
  }
}
