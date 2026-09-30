// 017: spike 016a's surface, fast, and unchanged. The field, the lattice and
// the marching-tetrahedra traversal are the same arithmetic in the same
// order, so the mesh must hash identically to 016a's; every property 016a
// proved (watertight, deterministic, regional) carries over by equality.
//
// What changed is bookkeeping, which was 98% of 016a's time:
//   - narrow band: space is split into 4×4×4-cell bricks; the field is
//     evaluated once at each brick's centre, and a brick whose value is
//     further from zero than its half-diagonal (plus a margin) is skipped,
//     because the field changes no faster than distance does. 016a visited
//     every cell in every capsule's bounding box, 634k at level 4.
//   - only cells the surface crosses are kept, then sorted into 016a's order.
//   - edge vertices are keyed by number (lower corner × 8 + direction), not
//     by string.
//   - no per-cell or per-tetrahedron arrays.

const KEYBASE = 32768
const key = (i, j, k) => ((i + KEYBASE) * 65536 + (j + KEYBASE)) * 65536 + (k + KEYBASE)

function capsuleDistance(px, py, pz, c) {
  const pax = px - c.ax, pay = py - c.ay, paz = pz - c.az
  let h = (pax * c.bx + pay * c.by + paz * c.bz) / c.bb
  h = h < 0 ? 0 : h > 1 ? 1 : h
  const dx = pax - c.bx * h, dy = pay - c.by * h, dz = paz - c.bz * h
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - c.r
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

// Same six tetrahedra as 016a, as corner indices (bit 0 = x, 1 = y, 2 = z).
const TETS = [[0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]]
const BRICK = 4

export function buildFastSdfMesh(vectors, { cell = 0.04, blend = 1.2, minRadius = 1.0, region = null, margin = 1, normals = false } = {}) {
  const h = cell
  const caps = vectors.map((v) => {
    const r = Math.max(v.radius, minRadius * h)
    const bx = v.dir[0] * v.len, by = v.dir[1] * v.len, bz = v.dir[2] * v.len
    return { ax: v.start[0], ay: v.start[1], az: v.start[2], bx, by, bz, bb: bx * bx + by * by + bz * bz, r, k: blend * r, order: v.order }
  }).sort((a, b) => a.order - b.order)

  // --- the field: identical to 016a ---
  const maxInfluence = Math.max(...caps.map((c) => c.r + c.k)) + 2 * h
  const bucket = Math.max(maxInfluence, 0.25)
  const buckets = new Map()
  const bkey = (x, y, z) => key(Math.floor(x / bucket), Math.floor(y / bucket), Math.floor(z / bucket))
  caps.forEach((c, i) => {
    const pad = 2 * c.r + c.k + 2 * h // reach from the axis (see 016a)
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
  let evaluations = 0
  function field(x, y, z) {
    evaluations++
    const list = buckets.get(bkey(x, y, z))
    if (!list) return FAR
    let d = FAR
    let first = true
    for (const i of list) {
      const c = caps[i]
      const dc = capsuleDistance(x, y, z, c)
      if (dc > c.r + c.k + 2 * h) continue
      d = first ? dc : smin(d, dc, c.k)
      first = false
    }
    return d
  }
  const inRegion = region
    ? (i, j, k) => {
        const dx = (i + 0.5) * h - region.center[0], dy = (j + 0.5) * h - region.center[1], dz = (k + 0.5) * h - region.center[2]
        return dx * dx + dy * dy + dz * dz <= region.radius * region.radius
      }
    : () => true

  // --- narrow band over bricks ---
  // Candidate bricks: those holding any cell 016a would have visited.
  const bricks = new Map()
  for (const c of caps) {
    const pad = c.r + c.k + h
    const lo = [Math.floor((Math.min(c.ax, c.ax + c.bx) - pad) / h), Math.floor((Math.min(c.ay, c.ay + c.by) - pad) / h), Math.floor((Math.min(c.az, c.az + c.bz) - pad) / h)]
    const hi = [Math.floor((Math.max(c.ax, c.ax + c.bx) + pad) / h), Math.floor((Math.max(c.ay, c.ay + c.by) + pad) / h), Math.floor((Math.max(c.az, c.az + c.bz) + pad) / h)]
    for (let I = Math.floor(lo[0] / BRICK); I <= Math.floor(hi[0] / BRICK); I++)
      for (let J = Math.floor(lo[1] / BRICK); J <= Math.floor(hi[1] / BRICK); J++)
        for (let K = Math.floor(lo[2] / BRICK); K <= Math.floor(hi[2] / BRICK); K++) bricks.set(key(I, J, K), [I, J, K])
  }
  // Per-brick capsule lists: every capsule whose field-padded box reaches the
  // brick, in ascending order, so a point in the brick sums exactly the
  // capsules 016a's coarse bucket would sum after its reach test (the rest
  // are skipped by that test anyway). No Map lookup per evaluation, and a
  // much shorter loop than a 0.25+ unit bucket's list.
  const lists = new Map()
  caps.forEach((c, index) => {
    const pad = 2 * c.r + c.k + 2 * h // reach from the axis
    const bs = BRICK * h
    for (let I = Math.floor((Math.min(c.ax, c.ax + c.bx) - pad) / bs); I <= Math.floor((Math.max(c.ax, c.ax + c.bx) + pad) / bs); I++)
      for (let J = Math.floor((Math.min(c.ay, c.ay + c.by) - pad) / bs); J <= Math.floor((Math.max(c.ay, c.ay + c.by) + pad) / bs); J++)
        for (let K = Math.floor((Math.min(c.az, c.az + c.bz) - pad) / bs); K <= Math.floor((Math.max(c.az, c.az + c.bz) + pad) / bs); K++) {
          const kk = key(I, J, K)
          ;(lists.get(kk) || lists.set(kk, []).get(kk)).push(index)
        }
  })
  function brickField(list, x, y, z) {
    evaluations++
    if (!list) return FAR
    let d = FAR
    let first = true
    for (let q = 0; q < list.length; q++) {
      const c = caps[list[q]]
      const dc = capsuleDistance(x, y, z, c)
      if (dc > c.r + c.k + 2 * h) continue
      d = first ? dc : smin(d, dc, c.k)
      first = false
    }
    return d
  }

  const half = Math.sqrt(3) * (BRICK / 2) * h
  const threshold = half + margin * h
  // Each kept brick holds its (B+1)^3 corner values in a flat array, filled
  // once. A shared face is evaluated by both bricks, but the field at one
  // lattice point is one value, so the mesh can't change. A Map lookup per
  // corner was 46% of the time, and garbage collection another 20%.
  const S = BRICK + 1
  const blocks = new Map()
  const at = (a, b, c) => (a * S + b) * S + c
  const crossing = []
  let bricksKept = 0
  // A region skips whole bricks that can't hold a cell inside the sphere
  // before evaluating anything (017 was first slower than 016a here: it
  // filled every brick, then dropped cells).
  const brickReach = Math.sqrt(3) * (BRICK / 2) * h
  const brickNear = region
    ? (I, J, K) => {
        const dx = (I * BRICK + BRICK / 2) * h - region.center[0], dy = (J * BRICK + BRICK / 2) * h - region.center[1], dz = (K * BRICK + BRICK / 2) * h - region.center[2]
        const r = region.radius + brickReach
        return dx * dx + dy * dy + dz * dz <= r * r
      }
    : () => true
  for (const [I, J, K] of bricks.values()) {
    if (!brickNear(I, J, K)) continue
    const list = lists.get(key(I, J, K))
    const fc = brickField(list, (I * BRICK + BRICK / 2) * h, (J * BRICK + BRICK / 2) * h, (K * BRICK + BRICK / 2) * h)
    if (fc > threshold || fc < -threshold) continue
    bricksKept++
    const block = new Float64Array(S * S * S)
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) for (let c = 0; c < S; c++)
      block[at(a, b, c)] = brickField(list, (I * BRICK + a) * h, (J * BRICK + b) * h, (K * BRICK + c) * h)
    blocks.set(key(I, J, K), block)
    for (let a = 0; a < BRICK; a++) for (let b = 0; b < BRICK; b++) for (let c = 0; c < BRICK; c++) {
      const i = I * BRICK + a, j = J * BRICK + b, k = K * BRICK + c
      if (!inRegion(i, j, k)) continue
      const s = block[at(a, b, c)] < 0
      if (s !== (block[at(a + 1, b, c)] < 0) || s !== (block[at(a, b + 1, c)] < 0) || s !== (block[at(a + 1, b + 1, c)] < 0)
        || s !== (block[at(a, b, c + 1)] < 0) || s !== (block[at(a + 1, b, c + 1)] < 0) || s !== (block[at(a, b + 1, c + 1)] < 0)
        || s !== (block[at(a + 1, b + 1, c + 1)] < 0)) crossing.push(key(i, j, k))
    }
  }
  crossing.sort((a, b) => a - b) // key order is (i, j, k) order: 016a's traversal

  // --- marching tetrahedra, 016a's arithmetic in 016a's order ---
  let positions = new Float64Array(1 << 16), nPos = 0
  let indices = new Uint32Array(1 << 16), nIdx = 0
  const pushPos = (x, y, z) => {
    if (nPos + 3 > positions.length) { const g = new Float64Array(positions.length * 2); g.set(positions); positions = g }
    positions[nPos++] = x; positions[nPos++] = y; positions[nPos++] = z
  }
  const pushTri = (a, b, c) => {
    if (nIdx + 3 > indices.length) { const g = new Uint32Array(indices.length * 2); g.set(indices); indices = g }
    indices[nIdx++] = a; indices[nIdx++] = b; indices[nIdx++] = c
  }
  const edgeVertex = new Map()
  const C = new Int32Array(24)
  const V = new Float64Array(8)
  const KB2 = 65536 * 65536
  function vertexOn(a, b) {
    // Freudenthal edges join a corner to one that dominates it, so the lower
    // key is the componentwise-lower corner: the same (p1, p2) order as 016a.
    const ka = key(C[3 * a], C[3 * a + 1], C[3 * a + 2]), kb = key(C[3 * b], C[3 * b + 1], C[3 * b + 2])
    const lo = ka < kb ? a : b, hi = ka < kb ? b : a
    const id = Math.min(ka, kb) * 8 + (lo ^ hi)
    let index = edgeVertex.get(id)
    if (index === undefined) {
      const v1 = V[lo], v2 = V[hi]
      const t = v1 / (v1 - v2)
      index = nPos / 3
      pushPos((C[3 * lo] + (C[3 * hi] - C[3 * lo]) * t) * h, (C[3 * lo + 1] + (C[3 * hi + 1] - C[3 * lo + 1]) * t) * h, (C[3 * lo + 2] + (C[3 * hi + 2] - C[3 * lo + 2]) * t) * h)
      edgeVertex.set(id, index)
    }
    return index
  }
  const inAt = [0, 0, 0], outAt = [0, 0, 0]
  function meanInto(target, list, n) {
    // 016a: pts.reduce((m, p) => m + p / pts.length), component by component
    let x = 0, y = 0, z = 0
    for (let q = 0; q < n; q++) { const c = list[q]; x = x + C[3 * c] / n; y = y + C[3 * c + 1] / n; z = z + C[3 * c + 2] / n }
    target[0] = x; target[1] = y; target[2] = z
  }
  function emit(t0, t1, t2) {
    const ax = positions[3 * t0], ay = positions[3 * t0 + 1], az = positions[3 * t0 + 2]
    const ux = positions[3 * t1] - ax, uy = positions[3 * t1 + 1] - ay, uz = positions[3 * t1 + 2] - az
    const wx = positions[3 * t2] - ax, wy = positions[3 * t2 + 1] - ay, wz = positions[3 * t2 + 2] - az
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
    const dx = outAt[0] - inAt[0], dy = outAt[1] - inAt[1], dz = outAt[2] - inAt[2]
    if (nx * dx + ny * dy + nz * dz < 0) pushTri(t0, t2, t1)
    else pushTri(t0, t1, t2)
  }
  const ins = [0, 0, 0, 0], outs = [0, 0, 0, 0]
  for (const ck of crossing) {
    const k = (ck % 65536) - KEYBASE
    const j = (Math.floor(ck / 65536) % 65536) - KEYBASE
    const i = Math.floor(ck / KB2) - KEYBASE
    const I = Math.floor(i / BRICK), J = Math.floor(j / BRICK), K = Math.floor(k / BRICK)
    const block = blocks.get(key(I, J, K))
    const a0 = i - I * BRICK, b0 = j - J * BRICK, c0 = k - K * BRICK
    for (let n = 0; n < 8; n++) {
      const da = n & 1, db = (n >> 1) & 1, dc = (n >> 2) & 1
      C[3 * n] = i + da; C[3 * n + 1] = j + db; C[3 * n + 2] = k + dc
      V[n] = block[at(a0 + da, b0 + db, c0 + dc)]
    }
    for (const tet of TETS) {
      let ni = 0, no = 0
      for (const n of tet) { if (V[n] < 0) ins[ni++] = n; else outs[no++] = n }
      if (!ni || !no) continue
      meanInto(inAt, ins, ni); meanInto(outAt, outs, no)
      if (ni === 1) emit(vertexOn(ins[0], outs[0]), vertexOn(ins[0], outs[1]), vertexOn(ins[0], outs[2]))
      else if (no === 1) emit(vertexOn(outs[0], ins[0]), vertexOn(outs[0], ins[1]), vertexOn(outs[0], ins[2]))
      else {
        const q0 = vertexOn(ins[0], outs[0]), q1 = vertexOn(ins[0], outs[1]), q2 = vertexOn(ins[1], outs[1]), q3 = vertexOn(ins[1], outs[0])
        emit(q0, q1, q2)
        emit(q0, q2, q3)
      }
    }
  }

  positions = positions.slice(0, nPos)
  indices = indices.slice(0, nIdx)
  const mesh = { positions, indices,
    stats: { capsules: caps.length, bricks: bricks.size, bricksKept, crossingCells: crossing.length, fieldEvaluations: evaluations } }
  // Normals from the field's gradient (central differences at h/2): smooth
  // shading without the stair-steps that face-averaged normals show.
  if (normals) {
    const e = h * 0.5
    const n = new Float32Array(positions.length)
    for (let p = 0; p < positions.length; p += 3) {
      const x = positions[p], y = positions[p + 1], z = positions[p + 2] // eslint-disable-line
      const gx = field(x + e, y, z) - field(x - e, y, z)
      const gy = field(x, y + e, z) - field(x, y - e, z)
      const gz = field(x, y, z + e) - field(x, y, z - e)
      const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1
      n[p] = gx / l; n[p + 1] = gy / l; n[p + 2] = gz / l
    }
    mesh.normals = n
  }
  return mesh
}
