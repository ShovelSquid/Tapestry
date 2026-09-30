// Shared measurements for spike 016's two surfaces. A mesh is
// { positions: Float64Array (xyz), indices: Uint32Array (triangles) }.

import { createHash } from 'node:crypto'

// Watertight means every edge is used by exactly two triangles. Boundary
// edges (used once) are holes; edges used more than twice are non-manifold.
export function topology(mesh) {
  const uses = new Map()
  const n = mesh.positions.length / 3
  const idx = mesh.indices
  for (let t = 0; t < idx.length; t += 3) {
    for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
      const key = a < b ? a * n + b : b * n + a
      uses.set(key, (uses.get(key) || 0) + 1)
    }
  }
  let boundary = 0
  let nonManifold = 0
  for (const u of uses.values()) {
    if (u === 1) boundary++
    else if (u > 2) nonManifold++
  }
  return { vertices: n, triangles: idx.length / 3, edges: uses.size, boundary, nonManifold, watertight: boundary === 0 && nonManifold === 0 }
}

// Face normals, and the largest and 99th-percentile angle between the
// normals of triangles that share an edge. A bamboo seam or a crease shows up
// as a large angle; a smooth weld keeps it low.
export function creases(mesh) {
  const p = mesh.positions
  const idx = mesh.indices
  const nTri = idx.length / 3
  const normals = new Float64Array(nTri * 3)
  for (let t = 0; t < nTri; t++) {
    const [a, b, c] = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]]
    const u = [p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]]
    const v = [p[3 * c] - p[3 * a], p[3 * c + 1] - p[3 * a + 1], p[3 * c + 2] - p[3 * a + 2]]
    const nx = u[1] * v[2] - u[2] * v[1]
    const ny = u[2] * v[0] - u[0] * v[2]
    const nz = u[0] * v[1] - u[1] * v[0]
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    normals.set([nx / l, ny / l, nz / l], 3 * t)
  }
  const nV = p.length / 3
  const owner = new Map()
  const angles = []
  for (let t = 0; t < nTri; t++) {
    for (let e = 0; e < 3; e++) {
      const a = idx[3 * t + e]
      const b = idx[3 * t + ((e + 1) % 3)]
      const key = a < b ? a * nV + b : b * nV + a
      const other = owner.get(key)
      if (other === undefined) { owner.set(key, t); continue }
      const d = normals[3 * t] * normals[3 * other] + normals[3 * t + 1] * normals[3 * other + 1] + normals[3 * t + 2] * normals[3 * other + 2]
      angles.push(Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI)
    }
  }
  angles.sort((x, y) => x - y)
  const q = (f) => (angles.length ? +angles[Math.min(angles.length - 1, Math.floor(f * angles.length))].toFixed(1) : 0)
  return { dihedral_p50: q(0.5), dihedral_p99: q(0.99), dihedral_max: q(1) }
}

export function meshHash(mesh) {
  return createHash('sha256').update(Buffer.from(mesh.positions.buffer)).update(Buffer.from(mesh.indices.buffer)).digest('hex').slice(0, 16)
}

// Vertices of `part` inside a sphere must appear, bit for bit, in `whole`.
export function regionMatches(whole, part, center, radius) {
  const key = (p, i) => `${p[3 * i]},${p[3 * i + 1]},${p[3 * i + 2]}`
  const all = new Set()
  for (let i = 0; i < whole.positions.length / 3; i++) all.add(key(whole.positions, i))
  let inside = 0
  let missing = 0
  for (let i = 0; i < part.positions.length / 3; i++) {
    const dx = part.positions[3 * i] - center[0]
    const dy = part.positions[3 * i + 1] - center[1]
    const dz = part.positions[3 * i + 2] - center[2]
    if (dx * dx + dy * dy + dz * dz > radius * radius) continue
    inside++
    if (!all.has(key(part.positions, i))) missing++
  }
  return { inside, missing }
}
