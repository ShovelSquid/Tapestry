/**
 * The fence unprojects pointer pixels with plane.ts's pure rayPlane against
 * FIXED_CAMERA; the stage draws with a three.js PerspectiveCamera built from
 * the same constants. Both must agree, or what the sim records would not be
 * where the picture shows it. Five NDC points through three's Raycaster
 * against the z = 0 plane vs rayPlane on the default frame: |du|, |dv| < 1e-6.
 */
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { FIXED_CAMERA } from '../src/camera'
import { DEFAULT_PLANE, rayPlane } from '../src/plane'
import { createFixedCamera } from '../src/stage/scene'

const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 1280, height: 720 },
  { width: 900, height: 1200 },
]

const NDC_POINTS: Array<[number, number]> = [
  [0, 0],
  [1, 1],
  [-1, -1],
  [0.5, -0.25],
  [-0.8, 0.6],
]

describe('camera parity: three.js PerspectiveCamera vs plane.ts rayPlane', () => {
  for (const viewport of VIEWPORTS) {
    it(`agrees at five NDC points on a ${viewport.width}x${viewport.height} viewport`, () => {
      const camera = createFixedCamera(viewport.width / viewport.height)
      const raycaster = new Raycaster()
      const plane = new Plane(new Vector3(0, 0, 1), 0)
      for (const [nx, ny] of NDC_POINTS) {
        raycaster.setFromCamera(new Vector2(nx, ny), camera)
        const hit = raycaster.ray.intersectPlane(plane, new Vector3())
        expect(hit).not.toBeNull()

        const clientX = ((nx + 1) / 2) * viewport.width
        const clientY = ((1 - ny) / 2) * viewport.height
        const ours = rayPlane(FIXED_CAMERA, viewport, DEFAULT_PLANE, clientX, clientY)
        expect(ours).not.toBeNull()

        // On the default frame u = x and v = y.
        expect(Math.abs(ours!.u - hit!.x)).toBeLessThan(1e-6)
        expect(Math.abs(ours!.v - hit!.y)).toBeLessThan(1e-6)
        expect(Math.abs(hit!.z)).toBeLessThan(1e-6)
      }
    })
  }

  it('builds the camera from FIXED_CAMERA (position, fov, near, far)', () => {
    const camera = createFixedCamera(1.6)
    expect(camera.position.toArray()).toEqual([...FIXED_CAMERA.position])
    expect(camera.fov).toBe(FIXED_CAMERA.fovDeg)
    expect(camera.near).toBe(FIXED_CAMERA.near)
    expect(camera.far).toBe(FIXED_CAMERA.far)
  })
})
