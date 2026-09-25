/**
 * Entering a note (Line Lab v2, Part 2 wave 7; spec §7 "Entering a note").
 *
 * Double-click lerps the camera in until the note fills the view. The note
 * is a shared element: whatever form it is drawn in when the glide starts
 * (card, circle chip or dot), the card itself grows out of that spot, so the
 * title and every part of the note fly from where they sat to where they sit
 * in the full view. Nothing cross-fades: the chip is replaced by the card at
 * the chip's size on the first frame, and the card is scaled, never faded.
 * Leaving (Escape) is the same flight backwards.
 *
 * The flight follows the camera rather than a clock of its own. Its progress
 * is read off the drawn camera's zoom (in log space, as the eye sees zoom),
 * so it can't drift from the glide, and a glide that is interrupted simply
 * ends the flight where it is.
 *
 * Pure functions; no React, no DOM. Render-only: nothing here reaches the
 * `.tree`.
 */

import type { Camera } from '../layout/camera'
import { CIRCLE, DOT_R, type ShownForm } from './collapse'

/** One frame of a flight, as the camera reports it. */
export interface FlightFrame {
  /** 0 where the glide started, 1 where it lands. */
  readonly p: number
  readonly fromZoom: number
  readonly toZoom: number
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * How far the drawn camera has come from `from` toward `to`. By zoom, in log
 * space, when the zoom changes; otherwise by pan, projected on the line of
 * travel. A glide with nowhere to go is already there.
 */
export function flightProgress(from: Camera, to: Camera, drawn: Camera): number {
  const lz = Math.log(to.zoom / from.zoom)
  if (Math.abs(lz) > 1e-6) return clamp01(Math.log(drawn.zoom / from.zoom) / lz)
  const dx = to.panX - from.panX
  const dy = to.panY - from.panY
  const d2 = dx * dx + dy * dy
  if (d2 < 1e-6) return 1
  return clamp01(((drawn.panX - from.panX) * dx + (drawn.panY - from.panY) * dy) / d2)
}

/**
 * How wide a note is on screen in a form. A card is its width at the zoom;
 * the chip and the dot are fixed on screen. A hidden note (inside a
 * collapsed container) flies to and from a dot.
 */
export function formScreenWidth(form: ShownForm, noteWidth: number, zoom: number): number {
  if (form === 'note') return noteWidth * zoom
  if (form === 'circle') return CIRCLE.r * 2
  return DOT_R * 2
}

/**
 * The extra scale on the card this frame, so it is `fromW` wide on screen at
 * p = 0 and `toW` at p = 1, easing between them in log space like the zoom.
 * When both ends are the card, this is exactly 1 all the way: the camera
 * alone carries it.
 */
export function flightScale(fromW: number, toW: number, noteWidth: number, zoom: number, p: number): number {
  const natural = noteWidth * zoom
  if (!(natural > 0) || !(fromW > 0) || !(toW > 0)) return 1
  const q = clamp01(p)
  const wanted = Math.exp(Math.log(fromW) * (1 - q) + Math.log(toW) * q)
  return wanted / natural
}
