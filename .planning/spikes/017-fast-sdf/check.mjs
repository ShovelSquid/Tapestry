// 017 against 016a: same mesh (hash), whole and regional, and how much
// faster. Also a negative control (a narrow band too thin must break the
// hash) and deeper levels 016a couldn't reach comfortably.
// Writes results/check.json.
//
//   node check.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { expand, end } from '../015-generative-vectors/gen.mjs'
import { PRESETS } from '../015-generative-vectors/presets.mjs'
import { buildSdfMesh } from '../016a-sdf-surface-nets/sdf.mjs'
import { meshHash, topology } from '../016-shared/mesh-stats.mjs'
import { buildFastSdfMesh } from './fast.mjs'

const time = (f) => { const t = performance.now(); const r = f(); return [r, performance.now() - t] }
const rows = []
let failures = 0

for (const preset of ['tree', 'bridge', 'coral']) {
  for (const level of [3, 4, 5]) {
    const vectors = expand(PRESETS[preset], level).levels.flat()
    const center = end(expand(PRESETS[preset], 3).levels[3][10])
    const [slow, slowMs] = time(() => buildSdfMesh(vectors, { cell: 0.04 }))
    const [fast, fastMs] = time(() => buildFastSdfMesh(vectors, { cell: 0.04 }))
    const region = { center, radius: 0.8 }
    const slowRegion = buildSdfMesh(vectors, { cell: 0.04, region })
    const [fastRegion, fastRegionMs] = time(() => buildFastSdfMesh(vectors, { cell: 0.04, region }))
    const row = {
      preset, level, vectors: vectors.length,
      slow_ms: Math.round(slowMs), fast_ms: Math.round(fastMs), speedup: +(slowMs / fastMs).toFixed(1),
      identical: meshHash(slow) === meshHash(fast), region_identical: meshHash(slowRegion) === meshHash(fastRegion),
      fast_region_ms: Math.round(fastRegionMs), triangles: fast.indices.length / 3, watertight: topology(fast).watertight,
      evaluations: fast.stats.fieldEvaluations, bricks: `${fast.stats.bricksKept}/${fast.stats.bricks}`, crossing_cells: fast.stats.crossingCells,
    }
    if (!row.identical || !row.region_identical || !row.watertight) failures++
    rows.push(row)
    console.log(JSON.stringify(row))
  }
}

// Negative control: a narrow band thinner than the brick's half-diagonal
// must drop real surface, so the hash must change.
const v4 = expand(PRESETS.tree, 4).levels.flat()
const control = buildFastSdfMesh(v4, { cell: 0.04, margin: -3.5 })
const controlBreaks = meshHash(control) !== meshHash(buildSdfMesh(v4, { cell: 0.04 }))
console.log(`negative control (band too thin) changes the mesh: ${controlBreaks}, holes: ${topology(control).boundary}`)
if (!controlBreaks) failures++

// Deeper and finer, fast path only.
const deep = []
for (const [preset, level, cell] of [['tree', 6, 0.04], ['tree', 7, 0.04], ['tree', 5, 0.02], ['coral', 7, 0.04]]) {
  const vectors = expand(PRESETS[preset], level).levels.flat()
  const [m, ms] = time(() => buildFastSdfMesh(vectors, { cell }))
  const [, msN] = time(() => buildFastSdfMesh(vectors, { cell, normals: true }))
  const t = topology(m)
  const r = { preset, level, cell, vectors: vectors.length, ms: Math.round(ms), with_gradient_normals_ms: Math.round(msN), triangles: t.triangles, watertight: t.watertight, evaluations: m.stats.fieldEvaluations }
  deep.push(r)
  console.log(JSON.stringify(r))
}

mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
writeFileSync(new URL('./results/check.json', import.meta.url), JSON.stringify({ rows, controlBreaks, deep }, null, 2) + '\n')
console.log(failures ? `FAIL: ${failures}` : 'fast mesh identical to 016a everywhere; control breaks it')
process.exit(failures ? 1 : 0)
