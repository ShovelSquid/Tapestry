/**
 * The hover bloom's light (Line Lab v2, Part 2 wave 2; Line Lab task 4).
 *
 * The light is a tween in the note's own px: it blooms in from where the
 * pointer entered and drains out toward where it left. `a` is the light's
 * size, 0..1 of the note's diagonal. Aiming mid-tween starts from wherever
 * the light is now, so a quick sweep in and out never snaps. A light that
 * has fully drained starts its next bloom at the new entry point rather than
 * sliding over from the old exit.
 *
 * Pure functions of their inputs, so the tween is testable without frames.
 */

import { easeOutCubic } from './motion'

export interface Light {
  readonly x: number
  readonly y: number
  /** 0..1: the light's radius as a share of the note's diagonal. */
  readonly a: number
}

export interface LightTween {
  readonly from: Light
  readonly to: Light
  readonly atMs: number
}

export const DARK: LightTween = Object.freeze({
  from: Object.freeze({ x: 0, y: 0, a: 0 }),
  to: Object.freeze({ x: 0, y: 0, a: 0 }),
  atMs: -1e9,
})

/** The light at `nowMs`. A duration of 0 (motion off) jumps to the end. */
export function lightAt(tw: LightTween, nowMs: number, durationMs: number): Light {
  const k = durationMs > 0 ? easeOutCubic((nowMs - tw.atMs) / durationMs) : 1
  const f = tw.from
  const t = tw.to
  return { x: f.x + (t.x - f.x) * k, y: f.y + (t.y - f.y) * k, a: f.a + (t.a - f.a) * k }
}

/** Aim the light at (x, y) with size `a`: 1 to bloom in, 0 to drain out. */
export function aimLight(tw: LightTween, x: number, y: number, a: number, nowMs: number, durationMs: number): LightTween {
  const cur = lightAt(tw, nowMs, durationMs)
  return { from: cur.a < 0.02 ? { x, y, a: cur.a } : cur, to: { x, y, a }, atMs: nowMs }
}

/** True once the tween has reached its target. */
export function lightSettled(tw: LightTween, nowMs: number, durationMs: number): boolean {
  return durationMs <= 0 || nowMs - tw.atMs >= durationMs
}

/** The light's radius in note px (Line Lab: 1.1 × the diagonal at a = 1). */
export function lightRadius(light: Light, w: number, h: number): number {
  return light.a * Math.hypot(w, h) * 1.1
}
