/**
 * Wheel-event math for canvas pan and zoom — pure functions, no React, no DOM.
 *
 * A `WheelEvent` never says whether it came from a trackpad pinch or a
 * physical mouse wheel notch with Ctrl held; the only signal available is the
 * magnitude of `deltaY` itself (a pinch tick is small, a wheel notch is
 * large), so `isZoomPinchDelta` decides from that. Keeping the pinch and
 * wheel rates independently tunable (rather than one shared rate) lets each
 * gesture feel right on its own hardware instead of compromising between the
 * two. `deltaMode` is normalized first because the same numeric `deltaY` means
 * a very different physical distance depending on whether the browser reports
 * pixels, lines, or pages — skipping that step would make sensitivity depend
 * on which device reported the event, not just on the tuned rate.
 */

/** Pixel-equivalent height of one wheel "line" (DOM_DELTA_LINE). */
export const PIXELS_PER_LINE = 16

/**
 * Converts a raw wheel delta to a pixel-equivalent value based on the
 * event's `deltaMode`: 0 (DOM_DELTA_PIXEL, what Chromium/Electron reports for
 * both trackpad and mouse wheel in practice) passes through unchanged; 1
 * (DOM_DELTA_LINE) scales by `PIXELS_PER_LINE`; 2 (DOM_DELTA_PAGE, not
 * expected to occur in Electron) scales by a defensive 800px-per-page
 * fallback.
 */
export function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * PIXELS_PER_LINE
  if (deltaMode === 2) return delta * 800
  return delta
}

/** Below this normalized magnitude, a wheel delta is treated as a trackpad pinch tick rather than a mouse-wheel notch. */
export const PINCH_DELTA_THRESHOLD = 25

/**
 * A trackpad pinch tick reports a small normalized deltaY (roughly 1-10); a
 * physical mouse wheel notch with Ctrl held reports a much larger one
 * (roughly 50-120+). This is the pinch-vs-wheel split, decided from the
 * event's own magnitude since no synchronous device-type signal exists on a
 * WheelEvent.
 */
export function isZoomPinchDelta(normalizedDeltaY: number): boolean {
  return Math.abs(normalizedDeltaY) < PINCH_DELTA_THRESHOLD
}

/** Exponential zoom rate for trackpad pinch deltas — far more aggressive than the old linear ZOOM_SPEED. */
export const ZOOM_RATE_PINCH = 0.035

/** Exponential zoom rate for ctrl+held mouse-wheel deltas — far more aggressive than the old linear ZOOM_SPEED, independently tuned from the pinch rate. */
export const ZOOM_RATE_WHEEL = 0.0022

/**
 * Exponential zoom multiplier for a normalized deltaY, using the pinch rate
 * or the wheel rate depending on `isPinch`.
 */
export function zoomFactor(normalizedDeltaY: number, isPinch: boolean): number {
  return Math.exp(-normalizedDeltaY * (isPinch ? ZOOM_RATE_PINCH : ZOOM_RATE_WHEEL))
}

/** Clamps a zoom value to the given [min, max] range. */
export function clampZoom(zoom: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, zoom))
}

/** Pan sensitivity multiplier — plain wheel/two-finger panning is 1.6x more sensitive than a 1:1 delta. */
export const PAN_SENSITIVITY = 1.6

/**
 * Converts a raw pan-axis delta (deltaX or deltaY) into the pixel amount to
 * pan by: normalize for deltaMode, then scale by PAN_SENSITIVITY.
 */
export function panDelta(rawDelta: number, deltaMode: number): number {
  return normalizeWheelDelta(rawDelta, deltaMode) * PAN_SENSITIVITY
}
