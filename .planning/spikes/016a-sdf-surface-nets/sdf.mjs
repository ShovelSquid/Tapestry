// 016a: the vectors as capsules in one signed distance field, blended with a
// smooth minimum so joints weld into fillets, then meshed with surface nets
// on a sparse lattice. Pure JS; only correctly-rounded maths touches the
// field, and every lattice point is on a global grid, so a region's surface
// lands on exactly the same vertices as the whole one.

const KEYBASE = 32768 // lattice coordinates must stay within ±32767 (keys below 2^53)
const key = (i, j, k) => ((i + KEYBASE) * 65536 + (j + KEYBASE)) * 65536 + (k + KEYBASE)

function capsuleDistance(px, py, pz, c) {
  const pax = px - c.ax, pay = py - c.ay, paz = pz - c.az
  let h = (pax * c.bx + pay * c.by + paz * c.bz) / c.bb
  h = h < 0 ? 0 : h > 1 ? 1 : h
  const dx = pax - c.bx * h, dy = pay - c.by * h, dz = paz - c.bz * h
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - c.r
}

// Polynomial smooth minimum: a fillet of width k where two shapes meet.
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

// options: cell (voxel size), blend (fillet as a multiple of radius),
// minRadius (twigs thinner than this are thickened, else they vanish
// between lattice points), region ({center, radius}) to mesh one sphere only.
export function buildSdfMesh(vectors, { cell = 0.04, blend = 1.2, minRadius = 1.0, region = null, mesher = 'tetra' } = {}) {
  const h = cell
  const caps = vectors.map((v) => {
    const r = Math.max(v.radius, minRadius * h)
    const bx = v.dir[0] * v.len, by = v.dir[1] * v.len, bz = v.dir[2] * v.len
    return { ax: v.start[0], ay: v.start[1], az: v.start[2], bx, by, bz, bb: bx * bx + by * by + bz * bz, r, k: blend * r, order: v.order }
  }).sort((a, b) => a.order - b.order)

  // Bucket capsules on a coarse grid; a field query sums every capsule whose
  // bucket is near, in order-key order, so the value never depends on which
  // other capsules exist far away.
  const maxInfluence = Math.max(...caps.map((c) => c.r + c.k)) + 2 * h
  const bucket = Math.max(maxInfluence, 0.25)
  const buckets = new Map()
  const bkey = (x, y, z) => key(Math.floor(x / bucket), Math.floor(y / bucket), Math.floor(z / bucket))
  caps.forEach((c, i) => {
    const pad = c.r + c.k + 2 * h
    const lo = [Math.min(c.ax, c.ax + c.bx) - pad, Math.min(c.ay, c.ay + c.by) - pad, Math.min(c.az, c.az + c.bz) - pad]
    const hi = [Math.max(c.ax, c.ax + c.bx) + pad, Math.max(c.ay, c.ay + c.by) + pad, Math.max(c.az, c.az + c.bz) + pad]
    for (let x = Math.floor(lo[0] / bucket); x <= Math.floor(hi[0] / bucket); x++)
      for (let y = Math.floor(lo[1] / bucket); y <= Math.floor(hi[1] / bucket); y++)
        for (let z = Math.floor(lo[2] / bucket); z <= Math.floor(hi[2] / bucket); z++) {
          const k = key(x, y, z)
          ;(buckets.get(k) || buckets.set(k, []).get(k)).push(i)
        }
  })
  const FAR = maxInfluence
  function field(x, y, z) {
    const list = buckets.get(bkey(x, y, z))
    if (!list) return FAR
    let d = FAR
    let first = true
    for (const i of list) { // ascending capsule index = order-key order
      const c = caps[i]
      const dc = capsuleDistance(x, y, z, c)
      if (dc > c.r + c.k + 2 * h) continue // too far to matter, anywhere it is summed
      d = first ? dc : smin(d, dc, c.k)
      first = false
    }
    return d
  }

  // Active cells: those a capsule's padded box touches (clipped to region).
  const inRegion = region
    ? (i, j, k) => {
        const dx = (i + 0.5) * h - region.center[0], dy = (j + 0.5) * h - region.center[1], dz = (k + 0.5) * h - region.center[2]
        return dx * dx + dy * dy + dz * dz <= region.radius * region.radius
      }
    : () => true
  const cells = new Map()
  for (const c of caps) {
    const pad = c.r + c.k + h
    for (let i = Math.floor((Math.min(c.ax, c.ax + c.bx) - pad) / h); i <= Math.floor((Math.max(c.ax, c.ax + c.bx) + pad) / h); i++)
      for (let j = Math.floor((Math.min(c.ay, c.ay + c.by) - pad) / h); j <= Math.floor((Math.max(c.ay, c.ay + c.by) + pad) / h); j++)
        for (let k = Math.floor((Math.min(c.az, c.az + c.bz) - pad) / h); k <= Math.floor((Math.max(c.az, c.az + c.bz) + pad) / h); k++)
          if (inRegion(i, j, k)) cells.set(key(i, j, k), [i, j, k])
  }

  const corner = new Map()
  const value = (i, j, k) => {
    const kk = key(i, j, k)
    let v = corner.get(kk)
    if (v === undefined) { v = field(i * h, j * h, k * h); corner.set(kk, v) }
    return v
  }

  const sortedCells = [...cells.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
  if (mesher === 'tetra') return marchTetrahedra(sortedCells, value, h, { capsules: caps.length, cells: cells.size, get fieldEvaluations() { return corner.size } })

  // Surface nets: one vertex per cell the surface crosses, at the mean of its
  // edge crossings; one quad per lattice edge the surface crosses.
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
  const vertexOf = new Map()
  const positions = []
  for (const [i, j, k] of sortedCells) {
    const v = []
    for (let n = 0; n < 8; n++) v.push(value(i + (n & 1), j + ((n >> 1) & 1), k + ((n >> 2) & 1)))
    let sx = 0, sy = 0, sz = 0, count = 0
    for (const [a, b] of EDGES) {
      if ((v[a] < 0) === (v[b] < 0)) continue
      const t = v[a] / (v[a] - v[b])
      const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1
      const bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1
      sx += ax + (bx - ax) * t; sy += ay + (by - ay) * t; sz += az + (bz - az) * t
      count++
    }
    if (!count) continue
    vertexOf.set(key(i, j, k), positions.length / 3)
    positions.push((i + sx / count) * h, (j + sy / count) * h, (k + sz / count) * h)
  }

  const indices = []
  for (const [i, j, k] of sortedCells) {
    const v0 = value(i, j, k)
    // Edges from this cell's min corner along +x, +y, +z; each is shared by
    // the four cells around it.
    const dirs = [
      [value(i + 1, j, k), [[0, 0, 0], [0, -1, 0], [0, -1, -1], [0, 0, -1]]],
      [value(i, j + 1, k), [[0, 0, 0], [0, 0, -1], [-1, 0, -1], [-1, 0, 0]]],
      [value(i, j, k + 1), [[0, 0, 0], [-1, 0, 0], [-1, -1, 0], [0, -1, 0]]],
    ]
    for (const [v1, around] of dirs) {
      if ((v0 < 0) === (v1 < 0)) continue
      const q = around.map(([di, dj, dk]) => vertexOf.get(key(i + di, j + dj, k + dk)))
      if (q.some((x) => x === undefined)) continue // quad leaves the meshed area (region edge)
      if (v0 < 0) indices.push(q[0], q[1], q[2], q[0], q[2], q[3])
      else indices.push(q[0], q[2], q[1], q[0], q[3], q[2])
    }
  }
  return { positions: new Float64Array(positions), indices: new Uint32Array(indices), stats: { capsules: caps.length, cells: cells.size, fieldEvaluations: corner.size } }
}

// Marching tetrahedra on the Freudenthal split: every cube becomes the same
// six tetrahedra around its 0→7 diagonal, so neighbouring cubes split their
// shared faces the same way. No ambiguous cases, so the surface is manifold
// and, away from a region's edge, watertight. Surface nets was not: two
// sheets through one cell share a vertex, giving 33–257 non-manifold edges
// on the tree (spike 016a).
const TETS = [[0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]]

function marchTetrahedra(sortedCells, value, h, stats) {
  const positions = []
  const indices = []
  const edgeVertex = new Map()
  const cornerKey = (i, j, k) => key(i, j, k)
  function vertexOn(ca, va, cb, vb) {
    const ka = cornerKey(...ca), kb = cornerKey(...cb)
    const [k1, k2, p1, p2, v1, v2] = ka < kb ? [ka, kb, ca, cb, va, vb] : [kb, ka, cb, ca, vb, va]
    const id = `${k1}:${k2}`
    let index = edgeVertex.get(id)
    if (index === undefined) {
      const t = v1 / (v1 - v2)
      index = positions.length / 3
      positions.push((p1[0] + (p2[0] - p1[0]) * t) * h, (p1[1] + (p2[1] - p1[1]) * t) * h, (p1[2] + (p2[2] - p1[2]) * t) * h)
      edgeVertex.set(id, index)
    }
    return index
  }
  function emit(tri, insideAt, outsideAt) {
    // Face the triangle from inside to outside.
    const P = (n) => [positions[3 * n], positions[3 * n + 1], positions[3 * n + 2]]
    const [a, b, c] = tri.map(P)
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const d = [outsideAt[0] - insideAt[0], outsideAt[1] - insideAt[1], outsideAt[2] - insideAt[2]]
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0) indices.push(tri[0], tri[2], tri[1])
    else indices.push(tri[0], tri[1], tri[2])
  }
  const mean = (pts) => pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length, m[2] + p[2] / pts.length], [0, 0, 0])
  for (const [i, j, k] of sortedCells) {
    const C = []
    const V = []
    for (let n = 0; n < 8; n++) {
      const c = [i + (n & 1), j + ((n >> 1) & 1), k + ((n >> 2) & 1)]
      C.push(c)
      V.push(value(...c))
    }
    for (const tet of TETS) {
      const ins = tet.filter((n) => V[n] < 0)
      const outs = tet.filter((n) => !(V[n] < 0))
      if (!ins.length || !outs.length) continue
      const inAt = mean(ins.map((n) => C[n])), outAt = mean(outs.map((n) => C[n]))
      const on = (a, b) => vertexOn(C[a], V[a], C[b], V[b])
      if (ins.length === 1 || outs.length === 1) {
        const [lone, others] = ins.length === 1 ? [ins[0], outs] : [outs[0], ins]
        emit(others.map((o) => on(lone, o)), inAt, outAt)
      } else {
        const [a, b] = ins, [c, d] = outs
        const q = [on(a, c), on(a, d), on(b, d), on(b, c)]
        emit([q[0], q[1], q[2]], inAt, outAt)
        emit([q[0], q[2], q[3]], inAt, outAt)
      }
    }
  }
  return { positions: new Float64Array(positions), indices: new Uint32Array(indices), stats }
}
