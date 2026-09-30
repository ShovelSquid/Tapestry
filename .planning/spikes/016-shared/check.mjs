// 016a against 016b on spike 015's vectors: time, size, watertight,
// creases, determinism (two builds hash the same) and regional agreement
// (a surface built for one sphere lands on the whole surface's vertices).
// Writes ../016-shared/results/check.json.
//
//   node check.mjs [levels=3,4,5] [cell=0.04]

import { mkdirSync, writeFileSync } from 'node:fs'
import { expand, end } from '../015-generative-vectors/gen.mjs'
import { PRESETS } from '../015-generative-vectors/presets.mjs'
import { buildSdfMesh } from '../016a-sdf-surface-nets/sdf.mjs'
import { buildTubeMesh, chains } from '../016b-swept-tubes/tubes.mjs'
import { creases, meshHash, regionMatches, topology } from './mesh-stats.mjs'

const levels = (process.argv[2] || '3,4,5').split(',').map(Number)
const cell = Number(process.argv[3] || 0.04)

// Ground truth for creases: 015's separate cylinders (the bamboo), as a mesh.
function cylinders(vectors) {
  const RING = [[1, 0], [0.5, 0.8660254037844386], [-0.5, 0.8660254037844387], [-1, 0], [-0.5, -0.8660254037844387], [0.5, -0.8660254037844387]]
  const positions = []
  const indices = []
  for (const v of vectors) {
    const d = v.dir
    const helper = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    const k = helper[0] * d[0] + helper[1] * d[1] + helper[2] * d[2]
    let n1 = [helper[0] - d[0] * k, helper[1] - d[1] * k, helper[2] - d[2] * k]
    const l = Math.sqrt(n1[0] ** 2 + n1[1] ** 2 + n1[2] ** 2); n1 = n1.map((x) => x / l)
    const n2 = [d[1] * n1[2] - d[2] * n1[1], d[2] * n1[0] - d[0] * n1[2], d[0] * n1[1] - d[1] * n1[0]]
    const base = positions.length / 3
    for (const p of [v.start, end(v)]) for (const [c, s] of RING) positions.push(...[0, 1, 2].map((a) => p[a] + (n1[a] * c + n2[a] * s) * v.radius))
    for (let i = 0; i < 6; i++) { const a = base + i, b = base + ((i + 1) % 6); indices.push(a, a + 6, b, b, a + 6, b + 6) }
  }
  return { positions: new Float64Array(positions), indices: new Uint32Array(indices) }
}

const report = { cell, rows: [] }
for (const preset of ['tree', 'bridge']) {
  for (const L of levels) {
    const vectors = expand(PRESETS[preset], L).levels.flat()
    const leaf = expand(PRESETS[preset], 3).levels[3][10]
    const center = end(leaf)
    const radius = 0.8
    const row = { preset, level: L, vectors: vectors.length, chains: chains(vectors).length }

    const bamboo = cylinders(vectors)
    row.cylinders = { triangles: bamboo.indices.length / 3, ...topology(bamboo), ...creases(bamboo) }

    let t = performance.now()
    const a = buildSdfMesh(vectors, { cell })
    const aMs = performance.now() - t
    const a2 = buildSdfMesh(vectors, { cell })
    t = performance.now()
    const aRegion = buildSdfMesh(vectors, { cell, region: { center, radius } })
    const aRegionMs = performance.now() - t
    row.sdf = {
      ms: Math.round(aMs), ...topology(a), ...creases(a), ...a.stats,
      deterministic: meshHash(a) === meshHash(a2), hash: meshHash(a),
      region: { ms: Math.round(aRegionMs), ...regionMatches(a, aRegion, center, radius - 2 * cell) },
    }

    t = performance.now()
    const b = buildTubeMesh(vectors)
    const bMs = performance.now() - t
    const b2 = buildTubeMesh(vectors)
    const nearChain = (c) => c.some((v) => { const e = end(v); return Math.hypot(e[0] - center[0], e[1] - center[1], e[2] - center[2]) < radius + v.len })
    const regionVectors = chains(vectors).filter(nearChain).flat()
    const bRegion = buildTubeMesh(regionVectors)
    row.tubes = {
      ms: Math.round(bMs), ...topology(b), ...creases(b), ...b.stats,
      deterministic: meshHash(b) === meshHash(b2), hash: meshHash(b),
      region: regionMatches(b, bRegion, center, radius),
    }
    report.rows.push(row)
    const s = row.sdf, u = row.tubes, c = row.cylinders
    console.log(`${preset} L${L} (${row.vectors} vectors)`)
    console.log(`  cylinders  tris ${c.triangles}  boundary ${c.boundary}  crease p99/max ${c.dihedral_p99}/${c.dihedral_max}°`)
    console.log(`  016a sdf   ${s.ms} ms  tris ${s.triangles}  watertight ${s.watertight} (boundary ${s.boundary}, non-manifold ${s.nonManifold})  crease p99/max ${s.dihedral_p99}/${s.dihedral_max}°  det ${s.deterministic}  region ${s.region.ms} ms ${s.region.missing}/${s.region.inside} missing`)
    console.log(`  016b tubes ${u.ms} ms  tris ${u.triangles}  watertight ${u.watertight} (boundary ${u.boundary}, non-manifold ${u.nonManifold})  crease p99/max ${u.dihedral_p99}/${u.dihedral_max}°  det ${u.deterministic}  region ${u.region.missing}/${u.region.inside} missing  joints ${u.joints}`)
  }
}
mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
writeFileSync(new URL('./results/check.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
