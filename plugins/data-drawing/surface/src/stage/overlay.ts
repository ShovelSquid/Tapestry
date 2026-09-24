/**
 * stage/overlay.ts — the cursor overlay (CANV-03): the pen position (latest
 * quantized sample), the brush body position (from the transferred body
 * snapshot), the spring between them, and the predicted tail as a dim
 * polyline that is drawn and discarded — never recorded, never smoothed.
 *
 * Plane-local (u, v) become world points through origin + u right + v up
 * in floats (left of the fence). Pen, body and spring are hidden while no
 * stroke is open. Every material is a built-in so WebGPU and WebGL 2 draw
 * the same picture; the overlay ignores depth and renders after the nodes.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from 'three'

import type { PlaneFrame } from '../plane'

export interface PlanePoint {
  u: number
  v: number
}

/** Longest predicted tail the polyline can show (PEN_FACTS saw at most 10 predicted per move). */
export const PREVIEW_CAPACITY = 64
const OVERLAY_RENDER_ORDER = 10
/** A hair above the plane so the overlay never z-fights with it. */
const LIFT = 0.01

export class CursorOverlay {
  readonly object = new Group()

  private readonly ring: Mesh
  private readonly body: Mesh
  private readonly spring: Line
  private readonly preview: Line
  private readonly springPositions = new Float32Array(6)
  private readonly previewPositions = new Float32Array(PREVIEW_CAPACITY * 3)
  private readonly bodyMaterial: MeshBasicMaterial
  private readonly tmp = new Vector3()

  constructor() {
    const ringMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false })
    this.ring = new Mesh(new RingGeometry(0.85, 1.05, 32), ringMaterial)

    this.bodyMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false })
    this.body = new Mesh(new CircleGeometry(1, 24), this.bodyMaterial)

    const springGeometry = new BufferGeometry()
    springGeometry.setAttribute('position', new BufferAttribute(this.springPositions, 3))
    this.spring = new Line(springGeometry, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }))

    const previewGeometry = new BufferGeometry()
    previewGeometry.setAttribute('position', new BufferAttribute(this.previewPositions, 3))
    previewGeometry.setDrawRange(0, 0)
    this.preview = new Line(previewGeometry, new LineBasicMaterial({ color: 0x6a7080, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }))

    for (const o of [this.ring, this.body, this.spring, this.preview]) {
      o.renderOrder = OVERLAY_RENDER_ORDER
      o.frustumCulled = false
      o.visible = false
      this.object.add(o)
    }
  }

  /** The body disc takes the current brush's colour and radius. */
  setBrush(colour: Color, radius: number): void {
    this.bodyMaterial.color.copy(colour)
    this.body.scale.set(radius, radius, 1)
  }

  private toWorld(p: PlanePoint, frame: PlaneFrame, out: Vector3): Vector3 {
    const { origin, right, up } = frame
    return out.set(
      origin[0] + p.u * right[0] + p.v * up[0],
      origin[1] + p.u * right[1] + p.v * up[1],
      origin[2] + p.u * right[2] + p.v * up[2] + LIFT,
    )
  }

  /**
   * pen: the latest quantized sample as plane-local floats (null = no open
   * stroke); body: the brush body from the body snapshot (plane-local);
   * preview: the predicted tail, drawn from the pen outward.
   */
  update(pen: PlanePoint | null, body: PlanePoint | null, preview: readonly PlanePoint[], frame: PlaneFrame): void {
    if (pen === null) {
      this.ring.visible = false
      this.body.visible = false
      this.spring.visible = false
      this.preview.visible = false
      return
    }
    const penWorld = this.toWorld(pen, frame, this.tmp)
    this.ring.position.copy(penWorld)
    this.ring.visible = true

    const sp = this.springPositions
    sp[0] = penWorld.x
    sp[1] = penWorld.y
    sp[2] = penWorld.z
    if (body !== null) {
      const bodyWorld = this.toWorld(body, frame, this.tmp)
      this.body.position.copy(bodyWorld)
      this.body.visible = true
      sp[3] = bodyWorld.x
      sp[4] = bodyWorld.y
      sp[5] = bodyWorld.z
      this.spring.visible = true
      ;(this.spring.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
    } else {
      this.body.visible = false
      this.spring.visible = false
    }

    const n = Math.min(preview.length, PREVIEW_CAPACITY - 1)
    if (n > 0) {
      const pp = this.previewPositions
      pp[0] = penWorld.x
      pp[1] = penWorld.y
      pp[2] = penWorld.z
      for (let i = 0; i < n; i++) {
        const w = this.toWorld(preview[i] as PlanePoint, frame, this.tmp)
        pp[(i + 1) * 3] = w.x
        pp[(i + 1) * 3 + 1] = w.y
        pp[(i + 1) * 3 + 2] = w.z
      }
      this.preview.geometry.setDrawRange(0, n + 1)
      ;(this.preview.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
      this.preview.visible = true
    } else {
      this.preview.visible = false
    }
  }

  dispose(): void {
    for (const o of [this.ring, this.body, this.spring, this.preview]) {
      this.object.remove(o)
      o.geometry.dispose()
      ;(o.material as MeshBasicMaterial | LineBasicMaterial).dispose()
    }
  }
}
