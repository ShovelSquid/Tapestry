/**
 * stage/scene.ts — one three.js renderer per surface (CANV-03; spike rules).
 *
 * createStage builds a WebGPURenderer from three/webgpu (WebGL 2 fallback:
 * automatic when WebGPU is absent, forced with `forceWebGL`), the fixed
 * camera from FIXED_CAMERA, the painting plane at z = 0 with a faint grid,
 * the instanced node field and the cursor overlay, then starts the render
 * loop. Every material is a built-in so both backends draw the same
 * picture; no custom shader material, no compute, no storage buffers.
 *
 * dispose() is idempotent and follows the spike order: stop the loop
 * (setAnimationLoop(null)), traverse-dispose geometries, materials and
 * texture uniforms, renderer.dispose(), force the context loss (dispose
 * alone holds the context until GC and a browser allows only a handful),
 * then remove the canvas. React 18 StrictMode double-mounts, so the second
 * call must be a no-op.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  type Material,
  type Object3D,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'

import { FIXED_CAMERA } from '../camera'
import { NodeField } from './nodes'
import { CursorOverlay } from './overlay'

export type BackendInfo = 'webgpu' | 'webgl2'

export interface StageOptions {
  /** Skip WebGPU and use the WebGL 2 backend (dev page: `?webgl=1`). */
  forceWebGL: boolean
  /** Called before every render: upload the latest snapshot, move the overlay. */
  onFrame(): void
  /** The WebGL context came back after a loss: re-upload from the last snapshot. */
  onContextRestored?(): void
}

export interface Stage {
  readonly renderer: WebGPURenderer
  readonly canvas: HTMLCanvasElement
  readonly camera: PerspectiveCamera
  readonly scene: Scene
  readonly plane: Mesh
  readonly nodes: NodeField
  readonly overlay: CursorOverlay
  resize(width: number, height: number, dpr: number): void
  backendInfo(): BackendInfo
  /** Idempotent. */
  dispose(): void
}

export const CLEAR_COLOUR = 0x0d0f14
export const PLANE_WIDTH = 200
export const PLANE_HEIGHT = 125
export const GRID_STEP = 10
const PLANE_COLOUR = 0x1a1d24
const GRID_COLOUR = 0x2a2e38
/** The plane and grid sit a hair below z = 0 so nodes at z = 0 never z-fight with them. */
const PLANE_Z = -0.02
const GRID_Z = -0.01

/** The PerspectiveCamera every stage uses, built from FIXED_CAMERA; also what camera-parity.test.ts checks. */
export function createFixedCamera(aspect: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(FIXED_CAMERA.fovDeg, aspect, FIXED_CAMERA.near, FIXED_CAMERA.far)
  cam.position.set(FIXED_CAMERA.position[0], FIXED_CAMERA.position[1], FIXED_CAMERA.position[2])
  cam.up.set(FIXED_CAMERA.up[0], FIXED_CAMERA.up[1], FIXED_CAMERA.up[2])
  cam.lookAt(FIXED_CAMERA.target[0], FIXED_CAMERA.target[1], FIXED_CAMERA.target[2])
  cam.updateMatrixWorld()
  return cam
}

function gridSegments(): LineSegments {
  const halfW = PLANE_WIDTH / 2
  const halfH = PLANE_HEIGHT / 2
  const points: number[] = []
  for (let x = -halfW; x <= halfW; x += GRID_STEP) points.push(x, -halfH, GRID_Z, x, halfH, GRID_Z)
  for (let y = -Math.floor(halfH / GRID_STEP) * GRID_STEP; y <= halfH; y += GRID_STEP) points.push(-halfW, y, GRID_Z, halfW, y, GRID_Z)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3))
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color: GRID_COLOUR }))
  lines.frustumCulled = false
  return lines
}

function disposeObject(obj: Object3D): void {
  const withGeometry = obj as Object3D & { geometry?: { dispose(): void } }
  withGeometry.geometry?.dispose()
  const withMaterial = obj as Object3D & { material?: Material | Material[] }
  const mats = Array.isArray(withMaterial.material) ? withMaterial.material : withMaterial.material ? [withMaterial.material] : []
  for (const m of mats) {
    const uniforms = (m as Material & { uniforms?: Record<string, { value?: unknown }> }).uniforms
    if (uniforms !== undefined) {
      for (const u of Object.values(uniforms)) {
        const value = u?.value as { isTexture?: boolean; dispose?: () => void } | undefined
        if (value?.isTexture === true && typeof value.dispose === 'function') value.dispose()
      }
    }
    m.dispose()
  }
}

export async function createStage(container: HTMLElement, opts: StageOptions): Promise<Stage> {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none;'
  container.appendChild(canvas)

  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: opts.forceWebGL })
  let disposed = false
  try {
    await renderer.init()
  } catch (err) {
    canvas.remove()
    throw err
  }

  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true ? 'webgpu' : 'webgl2'
  const dpr0 = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  renderer.setPixelRatio(dpr0)
  renderer.setClearColor(new Color(CLEAR_COLOUR), 1)

  const width0 = Math.max(1, container.clientWidth)
  const height0 = Math.max(1, container.clientHeight)
  renderer.setSize(width0, height0, false)

  const scene = new Scene()
  const camera = createFixedCamera(width0 / height0)

  const plane = new Mesh(new PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT), new MeshBasicMaterial({ color: PLANE_COLOUR }))
  plane.position.z = PLANE_Z
  plane.frustumCulled = false
  scene.add(plane)
  scene.add(gridSegments())

  const nodes = new NodeField()
  scene.add(nodes.object)
  const overlay = new CursorOverlay()
  scene.add(overlay.object)

  const onLost = (ev: Event): void => {
    // preventDefault lets the browser attempt a restore.
    ev.preventDefault()
    console.warn('[data-drawing] WebGL context lost')
  }
  const onRestored = (): void => {
    console.warn('[data-drawing] WebGL context restored; rebuilding the node field from the last snapshot')
    nodes.mesh.instanceMatrix.needsUpdate = true
    if (nodes.mesh.instanceColor !== null) nodes.mesh.instanceColor.needsUpdate = true
    opts.onContextRestored?.()
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  void renderer.setAnimationLoop(() => {
    if (disposed) return
    opts.onFrame()
    renderer.render(scene, camera)
  })

  const resize = (width: number, height: number, dpr: number): void => {
    if (disposed) return
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    renderer.setPixelRatio(dpr)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    void renderer.setAnimationLoop(null)
    canvas.removeEventListener('webglcontextlost', onLost)
    canvas.removeEventListener('webglcontextrestored', onRestored)
    scene.traverse(disposeObject)
    void renderer.dispose()
    const withLoss = renderer as unknown as { forceContextLoss?: () => void }
    if (typeof withLoss.forceContextLoss === 'function') {
      withLoss.forceContextLoss()
    } else if (backend === 'webgl2') {
      // The new Renderer has no forceContextLoss; the WebGL backend's context
      // is reachable and WEBGL_lose_context releases it without waiting for GC.
      const gl = renderer.getContext() as { getExtension?(name: string): { loseContext(): void } | null } | null
      gl?.getExtension?.('WEBGL_lose_context')?.loseContext()
    }
    canvas.remove()
  }

  return {
    renderer,
    canvas,
    camera,
    scene,
    plane,
    nodes,
    overlay,
    resize,
    backendInfo: () => backend,
    dispose,
  }
}
