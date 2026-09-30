// 016b: tubes swept along continuation chains. A chain follows a branch
// through its continuing child (the last child, which starts at the parent's
// end), so a whole limb is one smooth tube instead of a stack of cylinders.
// Side branches start their own chain, closed at both ends, and meet their
// parent by overlapping it with a flared collar.
//
// Deterministic: frames come from double reflection (rotation-minimising,
// dot products only), and ring directions are written-out constants, not
// Math.cos/sin.

// cos/sin of 2πk/12 as literals: the same doubles in every engine.
const RING = [
  [1, 0], [0.8660254037844387, 0.5], [0.5, 0.8660254037844386], [0, 1],
  [-0.5, 0.8660254037844387], [-0.8660254037844387, 0.5], [-1, 0], [-0.8660254037844387, -0.5],
  [-0.5, -0.8660254037844387], [0, -1], [0.5, -0.8660254037844387], [0.8660254037844387, -0.5],
]

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a) => { const l = Math.sqrt(dot(a, a)); return l > 1e-12 ? mul(a, 1 / l) : [0, 1, 0] }

// Catmull-Rom through the chain's joints, `sub` samples per segment.
function smooth(points, radii, subdiv) {
  const P = []
  const R = []
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))]
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv, t2 = t * t, t3 = t2 * t
      const c = (a, b, c2, d) => 0.5 * ((2 * b) + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3)
      P.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2])])
      R.push(radii[i] + (radii[i + 1] - radii[i]) * t)
    }
  }
  P.push(points[points.length - 1])
  R.push(radii[radii.length - 1])
  return { P, R }
}

export function chains(vectors) {
  const byId = new Map(vectors.map((v) => [v.id, v]))
  const childCount = new Map()
  for (const v of vectors) if (v.parent) childCount.set(v.parent, Math.max(childCount.get(v.parent) || 0, Number(v.id.slice(v.parent.length + 1)) + 1))
  const continues = (v) => v.parent && Number(v.id.slice(v.parent.length + 1)) === childCount.get(v.parent) - 1
  const out = []
  for (const v of [...vectors].sort((a, b) => a.order - b.order)) {
    if (continues(v)) continue // it belongs to its parent's chain
    const chain = [v]
    for (;;) {
      const last = chain[chain.length - 1]
      const n = childCount.get(last.id)
      const next = n ? byId.get(`${last.id}.${n - 1}`) : null
      if (!next) break
      chain.push(next)
    }
    out.push(chain)
  }
  return out
}

// options: subdiv (samples per vector), collar (flare at a side branch's base).
export function buildTubeMesh(vectors, { subdiv = 4, collar = 1.6 } = {}) {
  const byId = new Map(vectors.map((v) => [v.id, v]))
  const positions = []
  const indices = []
  let joints = 0
  for (const chain of chains(vectors)) {
    const pts = chain.map((v) => v.start)
    pts.push(add(chain[chain.length - 1].start, mul(chain[chain.length - 1].dir, chain[chain.length - 1].len)))
    const radii = chain.map((v) => v.radius)
    radii.push(chain[chain.length - 1].radius * 0.35)
    const parent = chain[0].parent ? byId.get(chain[0].parent) : null
    if (parent) { radii[0] = Math.min(parent.radius, chain[0].radius * collar); joints++ }
    const { P, R } = smooth(pts, radii, subdiv)

    // Rotation-minimising frames by double reflection (Wang et al. 2008).
    const T = P.map((_, i) => unit(sub(P[Math.min(i + 1, P.length - 1)], P[Math.max(i - 1, 0)])))
    const helper = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    let r = unit(sub(helper, mul(T[0], dot(helper, T[0]))))
    const frames = [r]
    for (let i = 0; i < P.length - 1; i++) {
      const v1 = sub(P[i + 1], P[i])
      const c1 = dot(v1, v1)
      if (c1 < 1e-24) { frames.push(r); continue }
      const rL = sub(r, mul(v1, (2 / c1) * dot(v1, r)))
      const tL = sub(T[i], mul(v1, (2 / c1) * dot(v1, T[i])))
      const v2 = sub(T[i + 1], tL)
      const c2 = dot(v2, v2)
      r = c2 < 1e-24 ? rL : sub(rL, mul(v2, (2 / c2) * dot(v2, rL)))
      frames.push(r)
    }

    const base = positions.length / 3
    P.forEach((p, i) => {
      const n1 = frames[i]
      const n2 = cross(T[i], n1)
      for (const [c, s] of RING) positions.push(...add(p, add(mul(n1, c * R[i]), mul(n2, s * R[i]))))
    })
    const N = RING.length
    for (let i = 0; i < P.length - 1; i++)
      for (let k = 0; k < N; k++) {
        const a = base + i * N + k, b = base + i * N + ((k + 1) % N)
        const c = a + N, d = b + N
        indices.push(a, c, b, b, c, d)
      }
    // Caps: a fan to the axis point at each end, so every tube is closed.
    const startCap = positions.length / 3; positions.push(...P[0])
    const endCap = positions.length / 3; positions.push(...P[P.length - 1])
    const last = base + (P.length - 1) * N
    for (let k = 0; k < N; k++) {
      indices.push(startCap, base + k, base + ((k + 1) % N))
      indices.push(endCap, last + ((k + 1) % N), last + k)
    }
  }
  return { positions: new Float64Array(positions), indices: new Uint32Array(indices), stats: { chains: chains(vectors).length, joints } }
}
