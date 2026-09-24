/**
 * camera.ts — the fixed camera the surface paints against (CANV-01).
 *
 * The camera is never written into any action: replay depends only on the
 * plane frame recorded in StrokeBegin (plane.ts), so moving the camera later
 * cannot change what a stroke meant. Floats are fine here — this file sits
 * left of the fence; input.ts is where numbers become integers, once.
 *
 * Position (0, 0, 120) looking at the origin with +y up and a 40 degree
 * vertical field of view: the default plane (z = 0) spans about 87 units
 * top to bottom on screen (2 * 120 * tan(20 deg)).
 */
export const FIXED_CAMERA = {
  position: [0, 0, 120],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fovDeg: 40,
  near: 0.1,
  far: 1000,
} as const

export type FixedCamera = typeof FIXED_CAMERA
