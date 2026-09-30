// The spike's three claims, measured:
//   deterministic   two expansions in fresh module instances hash the same
//   additive        every vector of level ≤ N is bit-identical in the N+1 expansion
//   local           growing detail only inside a sphere reproduces, bit for
//                   bit, every vector the whole expansion has inside it
// plus compression (description bytes vs generated vectors) and timing.
// Writes results/check.json.
//
//   node check.mjs [maxLevel=4]

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { canonical, end, expand, expandRegion, expandWhere, length, sub } from './gen.mjs'
import { PRESETS } from './presets.mjs'

const MAX = Number(process.argv[2] || 4)
const sha = (buf) => createHash('sha256').update(Buffer.from(buf.buffer)).digest('hex')
const bitsEqual = (a, b) => a.start.every((x, i) => Object.is(x, b.start[i])) && a.dir.every((x, i) => Object.is(x, b.dir[i]))
  && Object.is(a.len, b.len) && Object.is(a.radius, b.radius)

async function fresh() {
  // A second, independent module instance: no shared caches or state.
  return import(`./gen.mjs?instance=${Math.random()}`)
}

const report = { maxLevel: MAX, presets: {} }
let failures = 0

for (const [name, desc] of Object.entries(PRESETS)) {
  const r = {}
  // Deterministic
  const t0 = performance.now()
  const a = expand(desc, MAX)
  r.expand_ms = +(performance.now() - t0).toFixed(1)
  const b = (await fresh()).expand(desc, MAX)
  const ha = sha(canonical(a.levels).buf)
  const hb = sha(canonical(b.levels).buf)
  r.hash = ha.slice(0, 16)
  r.deterministic = ha === hb

  // Index-independent: the spatial grid agrees with testing every vector
  if (MAX <= 5) {
    const brute = canonical(expandWhere(desc, MAX, () => true, { brute: true }).levels)
    r.index_matches_brute_force = sha(brute.buf) === ha
  }

  // Order-independent: visiting each level's parents backwards changes nothing
  const rev = new Map(expandWhere(desc, MAX, () => true, { reverse: true }).levels.flat().map((v) => [v.id, v]))
  r.order_independent = a.levels.flat().every((v) => rev.has(v.id) && bitsEqual(v, rev.get(v.id)))

  // Additive: levels 0..N of expand(N) inside expand(N+1), for every N < MAX
  r.additive = true
  for (let n = 0; n < MAX; n++) {
    const small = new Map(expand(desc, n).levels.flat().map((v) => [v.id, v]))
    const big = new Map(expand(desc, n + 1).levels.flat().map((v) => [v.id, v]))
    for (const [id, v] of small) if (!big.has(id) || !bitsEqual(v, big.get(id))) { r.additive = false; r.additive_first_break = { n, id }; break }
    if (!r.additive) break
  }

  // Local: a sphere around a leaf-level point, grown alone
  const whole = a.levels.flat()
  const leaves = a.levels[MAX]
  const probe = leaves[Math.floor(leaves.length / 3)]
  const center = end(probe)
  const radius = probe.len * 3
  const t1 = performance.now()
  const regional = expandRegion(desc, MAX, center, radius)
  r.region_ms = +(performance.now() - t1).toFixed(1)
  const regionById = new Map(regional.levels.flat().map((v) => [v.id, v]))
  const inside = whole.filter((v) => length(sub(v.start, center)) <= radius)
  let missing = 0
  let differ = 0
  for (const v of inside) {
    const w = regionById.get(v.id)
    if (!w) missing++
    else if (!bitsEqual(v, w)) differ++
  }
  r.local = { inside: inside.length, missing, differ, regional_vectors: regionById.size, whole_vectors: whole.length }

  // Compression
  const descBytes = Buffer.byteLength(JSON.stringify(desc))
  r.description_bytes = descBytes
  r.seeds = desc.seeds.length
  r.knots = (desc.knots || []).length
  r.vectors_per_level = a.levels.map((l) => l.length)
  r.vectors = whole.length
  r.vector_bytes = whole.length * 8 * 8
  r.ratio = +(r.vector_bytes / descBytes).toFixed(1)

  if (!r.deterministic || r.index_matches_brute_force === false || !r.order_independent || !r.additive || r.local.missing || r.local.differ) failures++
  report.presets[name] = r
  console.log(name, JSON.stringify(r))
}

mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
writeFileSync(new URL('./results/check.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(failures ? `FAIL: ${failures} preset(s)` : 'all presets deterministic, additive and local')
process.exit(failures ? 1 : 0)
