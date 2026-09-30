// Strokes as seeds, measured:
//   deterministic    the same actions give the same seeds, vectors and mesh (fresh module instances)
//   fidelity         how far the drawn samples lie from the fitted seed chain, per tolerance
//   stable ids       adding a stroke leaves every earlier stroke's seeds bit-identical
//   edit reach       editing or removing one stroke: which other seeds and vectors change
//   pen-up latency   fit, grow and surface times
// Writes results/check.json.
//
//   node check.mjs

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { canonical, expand } from '../015-generative-vectors/gen.mjs'
import { buildFastSdfMesh } from '../017-fast-sdf/fast.mjs'
import { SESSIONS, stroke } from './sessions.mjs'
import { fitStrokes, readActions } from './strokes.mjs'

const sha = (...bufs) => { const h = createHash('sha256'); for (const b of bufs) h.update(Buffer.from(b.buffer)); return h.digest('hex').slice(0, 16) }
const time = (f) => { const t = performance.now(); const r = f(); return [r, performance.now() - t] }
const report = {}
let failures = 0

function pipeline(actions, mod = { fitStrokes }, options = {}) {
  const [{ description, fit }, fitMs] = time(() => mod.fitStrokes(actions, options))
  const [levels, growMs] = time(() => expand(description, 4).levels)
  const [mesh, surfaceMs] = time(() => buildFastSdfMesh(levels.flat(), { cell: 0.05 }))
  return { description, fit, levels, mesh, fitMs, growMs, surfaceMs, vec: sha(canonical(levels).buf), meshHash: sha(mesh.positions, mesh.indices) }
}

// Distance from every ink/lead sample to its stroke's fitted chain.
function fidelity(actions, tolerance) {
  const { description } = fitStrokes(actions, { tolerance })
  let worst = 0, sum = 0, n = 0
  for (const s of readActions(actions)) {
    const role = s.brush.description
    if (role !== 'ink' && role !== 'lead') continue
    const chain = description.seeds.filter((x) => x.stroke === s.id)
    for (const smp of s.samples) {
      const p = [0, 1, 2].map((i) => s.origin[i] + s.right[i] * smp.u / 65536 + s.up[i] * smp.v / 65536)
      let best = Infinity
      for (const x of chain) {
        const e = x.start.map((a, i) => a + x.dir[i] * x.len)
        const ab = e.map((b, i) => b - x.start[i]), ap = p.map((c, i) => c - x.start[i])
        const t = Math.min(1, Math.max(0, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / (x.len * x.len)))
        const d = Math.hypot(...p.map((c, i) => c - (x.start[i] + ab[i] * t)))
        best = Math.min(best, d)
      }
      worst = Math.max(worst, best); sum += best; n++
    }
  }
  return { tolerance, seeds: description.seeds.length, mean: +(sum / n).toFixed(3), worst: +worst.toFixed(3) }
}

for (const [name, make] of Object.entries(SESSIONS)) {
  const actions = make()
  const a = pipeline(actions)
  const b = pipeline(actions, await import(`./strokes.mjs?fresh=${Math.random()}`))
  const r = {
    strokes: a.fit.strokes, samples: a.fit.samples, action_bytes: JSON.stringify(actions).length, byRole: a.fit.byRole,
    seeds: a.fit.seeds, knots: a.fit.knots, attractors: a.fit.attractors, vectors: a.levels.flat().length, triangles: a.mesh.indices.length / 3,
    deterministic: a.vec === b.vec && a.meshHash === b.meshHash, vectors_hash: a.vec, mesh_hash: a.meshHash,
    pen_up_ms: { fit: +a.fitMs.toFixed(1), grow: Math.round(a.growMs), surface: Math.round(a.surfaceMs) },
    fidelity: [0.02, 0.05, 0.1, 0.18, 0.3].map((t) => fidelity(actions, t)),
  }

  // Stable ids: append a stroke; every earlier seed is bit-identical.
  const extra = stroke(99, 'ink', 'front', (t) => [2.5 + t * 0.4, t * 2])
  const appended = fitStrokes([...actions, ...extra]).description.seeds
  const before = new Map(a.description.seeds.map((s) => [s.id, JSON.stringify(s)]))
  r.append_keeps_earlier_seeds = [...before].every(([id, s]) => JSON.stringify(appended.find((x) => x.id === id)) === s)

  // Edit reach: move stroke 2 by 0.3 in u; which seeds and vectors change?
  const edited = actions.map((x) => (x.kind === 'StrokeSamples' && x.strokeId === 2 ? { ...x, samples: x.samples.map((s) => ({ ...s, u: s.u + 19661 })) } : x))
  const e = pipeline(edited)
  const seedsChanged = e.description.seeds.filter((s) => before.get(s.id) !== JSON.stringify(s)).map((s) => s.id)
  const va = new Map(a.levels.flat().map((v) => [v.id, JSON.stringify([v.start, v.dir, v.len])]))
  const changedVectors = e.levels.flat().filter((v) => va.get(v.id) !== JSON.stringify([v.start, v.dir, v.len]))
  const fromOtherStrokes = changedVectors.filter((v) => !v.seed.startsWith('s2.'))
  r.edit_stroke_2 = { seeds_changed: seedsChanged, vectors_changed: changedVectors.length, of: a.levels.flat().length,
    vectors_changed_outside_stroke_2: fromOtherStrokes.length, outside_via: [...new Set(fromOtherStrokes.map((v) => v.seed))] }

  // Remove the last rust stroke: its knots go, and the joined strokes regrow.
  const lastRust = readActions(actions).filter((s) => s.brush.description === 'rust').pop()
  if (lastRust) {
    const removed = pipeline(actions.filter((x) => x.strokeId !== lastRust.id))
    const changed = removed.levels.flat().filter((v) => va.get(v.id) !== JSON.stringify([v.start, v.dir, v.len]))
    r.remove_knot_stroke = { knots_before: a.fit.knots, knots_after: removed.fit.knots, vectors_changed: changed.length, of: a.levels.flat().length }
  }
  if (!r.deterministic || !r.append_keeps_earlier_seeds) failures++
  report[name] = r
  console.log(name, JSON.stringify(r, null, 1))
}

mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
writeFileSync(new URL('./results/check.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(failures ? `FAIL: ${failures}` : 'deterministic, and appending a stroke keeps every earlier seed')
process.exit(failures ? 1 : 0)
