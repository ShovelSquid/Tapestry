/**
 * A connection's ink line (Line Lab v2, Part 2 wave 4).
 *
 * Sketch 4 draws the connection as a loose hand-drawn curve that sags a
 * little between its ends, like a string, not a ruled line. Here that is a
 * quadratic bow, sagging to the lower side (the side with +y on screen),
 * turned into an open `InkShape` with the note outline's own wobble. Its
 * weight is the notes' static weight, so it scales with the zoom like them.
 *
 * The shape is a pure function of the two ends and the seed; the caller
 * memoises it, so a connection whose ends don't move never rebuilds.
 * Render-only, like the rest of `look/`.
 */

import { inkShape, type InkShape, type Pt } from './ink'

/** How far the middle sags, as a fraction of the line's length. */
export const CONNECTION_SAG = 0.08
/** Most the middle sags, in world px, so long lines don't droop. */
export const CONNECTION_SAG_MAX_PX = 40
/** The wave on a resting connection, as a multiple of the selection wave. */
export const CONNECTION_WAVE = 0.8
/** A note outline's length at the default size: waves per px match it. */
const OUTLINE_LENGTH = 760
/** How long a newly landed connection may still flash, in ms. */
export const CONNECTION_FLASH_WINDOW_MS = 1500

/** Points along the sagging curve from `a` to `b` (both ends included). */
export function connectionPts(a: Pt, b: Pt, samples = 24): Pt[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return [a, b]
  // The normal that points down the screen (or right, for a vertical line).
  let nx = -dy / len
  let ny = dx / len
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx
    ny = -ny
  }
  const sag = Math.min(CONNECTION_SAG_MAX_PX, len * CONNECTION_SAG)
  // A quadratic whose middle sits `sag` off the chord: control at 2 × sag.
  const cx = (a.x + b.x) / 2 + nx * sag * 2
  const cy = (a.y + b.y) / 2 + ny * sag * 2
  const out: Pt[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const u = 1 - t
    out.push({ x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y })
  }
  return out
}

/** The connection's ink shape. */
export function connectionShape(a: Pt, b: Pt, seed: number): InkShape {
  return inkShape(connectionPts(a, b), false, seed, { step: 3, wobbleScale: 0.6 })
}

/** This line's length over a note outline's, so the waves keep their size. */
export function connectionWaveScale(shape: InkShape): number {
  return Math.max(0.25, shape.L / OUTLINE_LENGTH)
}

/** A seed for a connection from its two ends' ids, stable across reloads. */
export function connectionSeedKey(fromId: string, toId: string): string {
  return `${fromId}→${toId}`
}
