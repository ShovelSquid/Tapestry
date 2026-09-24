/**
 * plane.ts — the painting plane's frame and the pure ray-plane hit that turns
 * a viewport pixel into plane-local (u, v).
 *
 * PlaneFrame is the thing StrokeBegin records (origin, right, up as 9 x i32
 * Q16.16 through frameToQ16); the sim computes pos3 = origin + u right + v up,
 * so z never comes from a camera (01-05, CANV-01). rayPlane is pure math on
 * floats — no three.js (not installed until 01-07), no DOM, no state — so
 * plane.test.ts can pin its numbers without a browser.
 */
import type { FixedCamera } from './camera'

export type Vec3 = [number, number, number]
type ReadonlyVec3 = readonly [number, number, number]

export interface PlaneFrame {
  /** World units, floats (left of the fence). */
  origin: Vec3
  right: Vec3
  up: Vec3
}

export const DEFAULT_PLANE: PlaneFrame = { origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0] }

/** One plane unit in Q16.16 (the StrokeBegin frame encoding). */
export const Q16_ONE = 65536

const I32_MIN = -2147483648
const I32_MAX = 2147483647

function toQ16(x: number): number {
  const q = Math.round(x * Q16_ONE)
  if (Number.isNaN(q)) return 0
  return Math.min(I32_MAX, Math.max(I32_MIN, q))
}

/**
 * The frame as StrokeBegin expects it: 9 x i32 Q16.16 in the order origin,
 * right, up (each x, y, z), i.e. Math.round(x * 65536) clamped to int32.
 */
export function frameToQ16(f: PlaneFrame): Int32Array {
  const out = new Int32Array(9)
  const parts: ReadonlyVec3[] = [f.origin, f.right, f.up]
  for (let i = 0; i < 3; i++) {
    const p = parts[i] as ReadonlyVec3
    out[i * 3] = toQ16(p[0])
    out[i * 3 + 1] = toQ16(p[1])
    out[i * 3 + 2] = toQ16(p[2])
  }
  return out
}

function sub(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function add(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
function scale(a: ReadonlyVec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}
function dot(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function cross(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function normalize(a: ReadonlyVec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2])
  return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0]
}

/**
 * Plane-local (u, v) for a viewport pixel, or null when the ray misses.
 *
 * clientX/clientY are pixels relative to the viewport's top-left (the fence
 * subtracts the canvas rect before calling). NDC x = (clientX / width) * 2 - 1,
 * y = 1 - (clientY / height) * 2, so the viewport centre maps to (0, 0) on the
 * default plane. The ray is camera.position + t * dir with dir built from the
 * camera basis (forward = target - position, rightAxis = forward x up,
 * upAxis = rightAxis x forward), the fov and the aspect ratio; the plane is
 * the one through frame.origin with normal right x up; the result is the
 * projection of the hit onto frame.right and frame.up.
 *
 * null when |dir . normal| < 1e-9 (ray parallel to the plane), when the hit
 * is behind the camera (t <= 0), when the viewport is empty, or when any
 * input is not finite.
 */
export function rayPlane(
  cam: FixedCamera,
  viewport: { width: number; height: number },
  frame: PlaneFrame,
  clientX: number,
  clientY: number,
): { u: number; v: number } | null {
  const { width, height } = viewport
  if (!(width > 0) || !(height > 0)) return null
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null

  const forward = normalize(sub(cam.target, cam.position))
  const rightAxis = normalize(cross(forward, cam.up))
  const upAxis = cross(rightAxis, forward)

  const x = (clientX / width) * 2 - 1
  const y = 1 - (clientY / height) * 2
  const halfTan = Math.tan((cam.fovDeg * Math.PI) / 360)
  const aspect = width / height
  const dir = normalize(add(forward, add(scale(rightAxis, x * halfTan * aspect), scale(upAxis, y * halfTan))))

  const normal = cross(frame.right, frame.up)
  const denom = dot(dir, normal)
  if (Math.abs(denom) < 1e-9) return null
  const t = dot(sub(frame.origin, cam.position), normal) / denom
  if (!(t > 0)) return null

  const hit = add(cam.position, scale(dir, t))
  const d = sub(hit, frame.origin)
  const u = dot(d, frame.right)
  const v = dot(d, frame.up)
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null
  return { u, v }
}
