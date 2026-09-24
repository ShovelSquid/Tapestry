/**
 * NodeField without a renderer: three's object model, InstancedMesh buffers
 * and Color work in Node. A synthetic snapshot buffer stands in for the
 * worker's transferred copy — same 88-byte stride, ascending ids.
 */
import { Color, Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'

import { NODE_STRIDE, Q32_ONE, decodeNodes } from '../src/ddsim-abi'
import { colourFor } from '../src/stage/colour'
import { INITIAL_CAPACITY, NodeField, type BrushLookup } from '../src/stage/nodes'

interface SyntheticNode {
  id: bigint
  x: number
  y: number
  z: number
  weight: number
  brush: number
}

function q32(x: number): bigint {
  return BigInt(Math.round(x * 4294967296))
}

/** Writes count nodes with ascending ids into a NODE_STRIDE-per-node buffer. */
function snapshotOf(nodes: SyntheticNode[]): { nodes: ArrayBuffer; nodeCount: number } {
  const buffer = new ArrayBuffer(nodes.length * NODE_STRIDE)
  const dv = new DataView(buffer)
  nodes.forEach((n, i) => {
    const o = i * NODE_STRIDE
    dv.setBigUint64(o, n.id, true)
    dv.setBigInt64(o + 8, q32(n.x), true)
    dv.setBigInt64(o + 16, q32(n.y), true)
    dv.setBigInt64(o + 24, q32(n.z), true)
    dv.setBigInt64(o + 32, q32(n.weight), true)
    dv.setBigInt64(o + 40, 0n, true)
    dv.setBigInt64(o + 48, 0n, true)
    dv.setBigInt64(o + 56, 0n, true)
    dv.setBigInt64(o + 64, 0n, true)
    dv.setUint32(o + 72, 0, true)
    dv.setUint32(o + 76, n.brush, true)
    dv.setUint32(o + 80, 0, true)
    dv.setUint32(o + 84, 0, true)
  })
  return { nodes: buffer, nodeCount: nodes.length }
}

const BRUSHES: BrushLookup = {
  get(id) {
    const table: Record<number, { description: string; radius: number }> = {
      1: { description: 'ink', radius: 0.75 },
      2: { description: 'rust', radius: 0.9 },
      3: { description: 'clay', radius: 1.1 },
      4: { description: 'lead', radius: 1.3 },
    }
    return table[id]
  },
}

function synthetic(count: number): SyntheticNode[] {
  const out: SyntheticNode[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: BigInt(i) + 0x1000000n,
      x: (i % 100) * 0.5 - 25,
      y: Math.floor(i / 100) * 0.5 - 12,
      z: 0,
      weight: (i % 7) / 6,
      brush: (i % 4) + 1,
    })
  }
  return out
}

describe('NodeField', () => {
  it('starts with capacity 4096 and count 0', () => {
    const field = new NodeField()
    expect(field.capacity).toBe(INITIAL_CAPACITY)
    expect(field.count).toBe(0)
    expect(field.mesh.count).toBe(0)
  })

  it('grows to the next power of two >= 5000 (8192) and draws all 5000', () => {
    const field = new NodeField()
    const nodes = synthetic(5000)
    field.update(snapshotOf(nodes), BRUSHES)
    expect(field.capacity).toBe(8192)
    expect(field.count).toBe(5000)
    expect(field.mesh.count).toBe(5000)
    expect(field.object.children).toContain(field.mesh)
    expect(field.object.children).toHaveLength(1)

    const m = new Matrix4()
    field.mesh.getMatrixAt(0, m)
    const decoded = decodeNodes(snapshotOf(nodes).nodes, 5000)
    expect(m.elements[12]).toBeCloseTo(decoded.x(0), 6)
    expect(m.elements[13]).toBeCloseTo(decoded.y(0), 6)
    expect(m.elements[14]).toBeCloseTo(decoded.z(0), 6)
    // The last instance is the last node, not re-sorted.
    field.mesh.getMatrixAt(4999, m)
    expect(m.elements[12]).toBeCloseTo(decoded.x(4999), 6)
    expect(m.elements[13]).toBeCloseTo(decoded.y(4999), 6)
  })

  it('renders a 0-node snapshot with count 0 and no throw', () => {
    const field = new NodeField()
    field.update(snapshotOf(synthetic(3)), BRUSHES)
    expect(field.count).toBe(3)
    expect(() => field.update(snapshotOf([]), BRUSHES)).not.toThrow()
    expect(field.count).toBe(0)
    expect(field.mesh.count).toBe(0)
    expect(field.capacity).toBe(INITIAL_CAPACITY)
  })

  it('keeps the snapshot order: instance i is coloured by node i brush description', () => {
    const field = new NodeField()
    const nodes = synthetic(50)
    field.update(snapshotOf(nodes), BRUSHES)
    const c = new Color()
    nodes.forEach((n, i) => {
      field.mesh.getColorAt(i, c)
      const expected = colourFor(BRUSHES.get(n.brush)!.description)
      expect(Math.abs(c.r - expected.r)).toBeLessThan(1e-6)
      expect(Math.abs(c.g - expected.g)).toBeLessThan(1e-6)
      expect(Math.abs(c.b - expected.b)).toBeLessThan(1e-6)
    })
  })

  it('scales each disc by brush radius x (0.2 + 0.8 x weight)', () => {
    const field = new NodeField()
    const nodes: SyntheticNode[] = [
      { id: 1n, x: 0, y: 0, z: 0, weight: 0, brush: 1 },
      { id: 2n, x: 1, y: 0, z: 0, weight: 1, brush: 4 },
      { id: 3n, x: 2, y: 0, z: 0, weight: 0.5, brush: 2 },
    ]
    field.update(snapshotOf(nodes), BRUSHES)
    const m = new Matrix4()
    field.mesh.getMatrixAt(0, m)
    expect(m.elements[0]).toBeCloseTo(0.75 * 0.2, 6)
    field.mesh.getMatrixAt(1, m)
    expect(m.elements[0]).toBeCloseTo(1.3 * 1.0, 6)
    field.mesh.getMatrixAt(2, m)
    expect(m.elements[0]).toBeCloseTo(0.9 * (0.2 + 0.4), 6)
  })

  it('converts Q32.32 to float only through Number(BigInt) / 2^32 (exact for a whole unit)', () => {
    const buffer = new ArrayBuffer(NODE_STRIDE)
    const dv = new DataView(buffer)
    dv.setBigInt64(8, 3n * Q32_ONE, true)
    dv.setBigInt64(16, -Q32_ONE / 2n, true)
    const acc = decodeNodes(buffer, 1)
    expect(acc.x(0)).toBe(3)
    expect(acc.y(0)).toBe(-0.5)
    expect(() => decodeNodes(buffer, 2)).toThrow(RangeError)
  })

  it('uses the material rules: no depth write, transparent, built-in material', () => {
    const field = new NodeField()
    const material = field.mesh.material as { depthWrite: boolean; transparent: boolean; type: string }
    expect(material.depthWrite).toBe(false)
    expect(material.transparent).toBe(true)
    expect(material.type).toBe('MeshBasicMaterial')
  })
})
