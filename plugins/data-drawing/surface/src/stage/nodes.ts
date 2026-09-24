/**
 * stage/nodes.ts — the instanced node field (CANV-03).
 *
 * One InstancedMesh of camera-facing discs. The painting plane is z = 0
 * facing +z and the fixed camera looks down -z, so circles in the XY plane
 * face it. update() walks the transferred snapshot in the sim's own order
 * (ascending NodeId, i = 0..count-1) and never re-sorts: overlapping discs
 * composite in that order — a later stroke on top — because the material
 * writes no depth. Q32.32 becomes a float only here, on the main thread,
 * through the lazy accessors of decodeNodes.
 *
 * Capacity starts at 4096 instances and, when a snapshot carries more, the
 * mesh is re-allocated to the next power of two >= count (the old geometry
 * and material are disposed). With zero nodes the mesh draws nothing
 * (count 0) and nothing throws.
 */
import { CircleGeometry, Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three'

import { decodeNodes } from '../ddsim-abi'
import type { Snapshot } from '../sim-host'
import { colourFor } from './colour'

/** What the node field needs to know about a brush version. BrushTable satisfies it. */
export interface BrushLookup {
  get(id: number): { description: string; radius: number } | undefined
}

export const INITIAL_CAPACITY = 4096
const CIRCLE_SEGMENTS = 24

function nextPow2(n: number): number {
  let c = 1
  while (c < n) c *= 2
  return c
}

export class NodeField {
  /** Add this to the scene; it holds whichever InstancedMesh is current. */
  readonly object = new Group()
  mesh: InstancedMesh
  count = 0

  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly scale = new Vector3()
  private readonly noRotation = new Quaternion()
  /** Colour per brush version id, filled lazily per update. */
  private readonly colours = new Map<number, Color>()
  private readonly fallbackColour = new Color(0x888888)

  constructor(capacity = INITIAL_CAPACITY) {
    this.mesh = this.allocate(capacity)
    this.object.add(this.mesh)
  }

  get capacity(): number {
    return this.mesh.instanceMatrix.count
  }

  private allocate(capacity: number): InstancedMesh {
    const geometry = new CircleGeometry(1, CIRCLE_SEGMENTS)
    const material = new MeshBasicMaterial({ depthWrite: false, transparent: true, opacity: 0.9 })
    const mesh = new InstancedMesh(geometry, material, capacity)
    mesh.count = 0
    mesh.frustumCulled = false
    // Colours start allocated so instanceColor exists even for an empty field.
    mesh.setColorAt(0, this.fallbackColour)
    return mesh
  }

  private ensureCapacity(count: number): void {
    if (count <= this.capacity) return
    const next = nextPow2(count)
    const old = this.mesh
    this.object.remove(old)
    old.geometry.dispose()
    ;(old.material as MeshBasicMaterial).dispose()
    old.dispose()
    this.mesh = this.allocate(next)
    this.object.add(this.mesh)
  }

  private colourOf(brush: number, brushes: BrushLookup): Color {
    let c = this.colours.get(brush)
    if (c === undefined) {
      const spec = brushes.get(brush)
      c = spec === undefined ? this.fallbackColour : colourFor(spec.description)
      if (spec !== undefined) this.colours.set(brush, c)
    }
    return c
  }

  /** Uploads the snapshot's nodes in ascending-NodeId order (the order they arrive in). */
  update(snapshot: Pick<Snapshot, 'nodes' | 'nodeCount'>, brushes: BrushLookup): void {
    const n = snapshot.nodeCount
    this.ensureCapacity(n)
    const nodes = decodeNodes(snapshot.nodes, n)
    const mesh = this.mesh
    for (let i = 0; i < n; i++) {
      const brush = nodes.brush(i)
      const spec = brushes.get(brush)
      const radius = spec === undefined ? 1 : spec.radius
      const weight = nodes.weight(i)
      const s = radius * (0.2 + 0.8 * weight)
      this.position.set(nodes.x(i), nodes.y(i), nodes.z(i))
      this.scale.set(s, s, 1)
      this.matrix.compose(this.position, this.noRotation, this.scale)
      mesh.setMatrixAt(i, this.matrix)
      mesh.setColorAt(i, this.colourOf(brush, brushes))
    }
    mesh.count = n
    this.count = n
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
  }

  /** Forget cached brush colours (a brush table was replaced). */
  resetColours(): void {
    this.colours.clear()
  }

  dispose(): void {
    this.object.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as MeshBasicMaterial).dispose()
    this.mesh.dispose()
    this.colours.clear()
  }
}
