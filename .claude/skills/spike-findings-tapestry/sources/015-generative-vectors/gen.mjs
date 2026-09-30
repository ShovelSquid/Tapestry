// Generative vectors: store the rules that make the object, not the object.
//
// A description is a few seed vectors, knots (relationships between seeds)
// and rules. expand() grows it level by level. Three properties are what make
// it a representation rather than a growth sim:
//
//   deterministic   Only +, -, *, / and sqrt touch geometry (all correctly
//                   rounded by IEEE 754), randomness comes from a hash of each
//                   vector's id, and neighbours are summed in a fixed order.
//                   No Math.sin/cos/pow/hypot: engines may round them
//                   differently.
//   additive        A level is frozen once built. Forces only bend the new
//                   children and a child starts on its parent's segment, so
//                   level N+1 adds to level N and never moves it.
//   local           A child depends only on its parent (and grandparent) and
//                   on frozen vectors within reach, so detail can be grown in
//                   one region and match a whole expansion there, which is the
//                   "what geometry should exist here at this resolution" query.
//
// Ids are paths from the seed ("trunk.2.0.1"), never counters (the same rule
// as data-drawing's STRK-03), so the same vector has the same name however
// much or little of the object was grown.

// --- deterministic randomness ------------------------------------------------

function hash32(str, salt) {
  let h = 0x811c9dc5 ^ salt
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // splitmix-style finaliser
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}
// A uniform in [0, 1), exactly representable (u32 / 2^32).
const rand = (id, salt) => hash32(id, salt) / 4294967296

// --- vector maths (exact-rounding operations only) --------------------------

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const length = (a) => Math.sqrt(dot(a, a))
function unit(a, fallback = [0, 1, 0]) {
  const l = length(a)
  return l > 1e-12 ? mul(a, 1 / l) : fallback
}
const end = (v) => add(v.start, mul(v.dir, v.len))

// Nearest point to p on segment v.
function nearestOn(v, p) {
  const t = Math.min(1, Math.max(0, dot(sub(p, v.start), v.dir) / v.len))
  return add(v.start, mul(v.dir, v.len * t))
}

// A direction perpendicular to d, picked by the id's hash.
function perpendicular(d, id) {
  const r = [rand(id, 11) - 0.5, rand(id, 12) - 0.5, rand(id, 13) - 0.5]
  const p = sub(r, mul(d, dot(r, d)))
  return unit(p, Math.abs(d[0]) < 0.9 ? unit(sub([1, 0, 0], mul(d, d[0]))) : unit(sub([0, 0, 1], mul(d, d[2]))))
}

// --- spatial index over frozen vectors ---------------------------------------

// One grid per level, each with cells sized to that level's longest vector.
// A single grid sized for the seeds turned deep levels into crowded cells:
// twice the vectors cost 3.3x the time (spike 015).
// The reference index: every frozen vector, no spatial pruning. Slow, but
// what any grid has to agree with (check.mjs compares hashes).
class Everything {
  constructor() { this.all = [] }
  insert(v) { this.all.push(v) }
  near() { return this.all }
}

class Levels {
  constructor() { this.grids = [] }
  insert(v, cell) {
    const g = this.grids[v.level] || (this.grids[v.level] = new Grid(cell))
    g.insert(v)
  }
  // Candidates from every level: a segment of level l is within `radius` of p
  // only if its midpoint is within radius + half its length.
  near(p, radius) {
    const out = []
    for (const g of this.grids) if (g) for (const v of g.near(p, radius + g.cell * 0.5)) out.push(v)
    return out
  }
}

class Grid {
  constructor(cell) { this.cell = cell; this.cells = new Map() }
  // Must stay below 2^53 to be exact: a key that rounds merges neighbouring
  // cells, a query then visits the same list twice and counts its forces
  // twice (spike 015 found this against the brute-force reference).
  key(x, y, z) {
    if (Math.abs(x) > 65535 || Math.abs(y) > 65535 || Math.abs(z) > 65535) throw new Error('grid cell out of range')
    return ((x + 65536) * 131072 + (y + 65536)) * 131072 + (z + 65536)
  }
  insert(v) {
    const m = mul(add(v.start, end(v)), 0.5)
    const k = this.key(Math.floor(m[0] / this.cell), Math.floor(m[1] / this.cell), Math.floor(m[2] / this.cell))
    ;(this.cells.get(k) || this.cells.set(k, []).get(k)).push(v)
  }
  // Everything whose midpoint lies in a cell within `radius`. The caller
  // sorts by order key, so a force sum is always added up the same way.
  near(p, radius) {
    const c = [Math.floor(p[0] / this.cell), Math.floor(p[1] / this.cell), Math.floor(p[2] / this.cell)]
    const r = Math.ceil(radius / this.cell)
    const out = []
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const list = this.cells.get(this.key(c[0] + dx, c[1] + dy, c[2] + dz))
      if (list) for (const v of list) out.push(v)
    }
    return out
  }
}

// --- the grammar -------------------------------------------------------------

export const DEFAULT_RULES = {
  version: 'gv-rules@1',
  branching: [3, 3, 3, 3, 2, 2],   // children per vector, per level (the last child continues the parent)
  lenRatio: 0.62,
  radiusRatio: 0.62,
  spread: 0.9,                     // slope of a side branch away from its parent
  curvature: 0.35,                 // carry the parent's bend into the child
  attract: 0.25,                   // knots of type attract, and attractor fields
  repel: 0.8,                      // away from frozen geometry and siblings
  align: 0.15,                     // towards the mean direction of frozen neighbours
  tropism: [0, 0.12, 0],           // a constant field (light, gravity)
  reach: 0.9,                      // repulsion radius, as a multiple of the child's length
  steps: 6,                        // relaxation passes per level
  step: 0.35,
}

function childCount(rules, level) {
  const b = rules.branching
  return b[Math.min(level, b.length - 1)]
}

// The children of v, bent by the knot field and the frozen geometry around
// them. Pure: depends on v, its parent, the knots, the rules, and `frozen`.
function grow(v, parentOf, frozen, desc, order) {
  const rules = desc.rules
  const n = v.grows === false ? 0 : childCount(rules, v.level)
  const pv = parentOf(v)
  const kids = []
  for (let i = 0; i < n; i++) {
    const id = `${v.id}.${i}`
    const continuing = i === n - 1
    const t = continuing ? 1 : 0.35 + 0.6 * ((i + rand(id, 1)) / n)
    const start = add(v.start, mul(v.dir, v.len * t))
    const slope = (continuing ? 0.25 : 1) * rules.spread * (0.6 + 0.8 * rand(id, 2))
    let dir = unit(add(v.dir, mul(perpendicular(v.dir, id), slope)))
    if (pv) dir = unit(add(dir, mul(sub(v.dir, pv.dir), rules.curvature)))
    const len = v.len * rules.lenRatio * (0.8 + 0.4 * rand(id, 3))
    kids.push({ id, level: v.level + 1, parent: v.id, seed: v.seed, kind: v.kind, start, dir, len,
      radius: v.radius * rules.radiusRatio, order: order + i })
  }

  // Neighbours once per child, not once per relaxation step: the child's end
  // stays within one length of its start however it turns, so everything
  // within reach of any end it takes is within reach + length of the start.
  // The per-step distance test below then sees exactly the same set.
  const candidates = kids.map((c) => frozen.near(c.start, rules.reach * c.len + c.len)
    .filter((o) => o.id !== v.id)
    .sort((a, b) => a.order - b.order))
  const knots = desc.knots.filter((k) => k.from === v.seed)
  const seedById = desc.seedById
  for (let s = 0; s < rules.steps; s++) {
    // Jacobi: every child's force is computed from the same state, so the
    // result doesn't depend on the order children are visited.
    const forces = kids.map((c, ci) => {
      const e = end(c)
      const R = rules.reach * c.len
      let f = [0, 0, 0]
      let alignSum = [0, 0, 0]
      for (const o of candidates[ci]) {
        const q = nearestOn(o, e)
        const d = sub(e, q)
        const dist = length(d)
        if (dist < R && dist > 1e-9) {
          f = add(f, mul(d, (rules.repel * (1 - dist / R)) / dist))
          alignSum = add(alignSum, o.dir)
        }
      }
      for (const sib of kids) {
        if (sib === c) continue
        const d = sub(e, end(sib))
        const dist = length(d)
        if (dist < R && dist > 1e-9) f = add(f, mul(d, (rules.repel * 0.5 * (1 - dist / R)) / dist))
      }
      if (length(alignSum) > 1e-9) f = add(f, mul(unit(alignSum), rules.align))
      for (const k of knots) {
        const target = seedById.get(k.to)
        const w = k.w ?? 1
        if (k.type === 'align') { f = add(f, mul(target.dir, rules.align * w)); continue }
        const q = nearestOn(target, e)
        const toward = unit(sub(q, e), [0, 0, 0])
        f = add(f, mul(toward, (k.type === 'repel' ? -1 : 1) * rules.attract * w))
      }
      for (const a of desc.attractors || []) {
        f = add(f, mul(unit(sub(a.p, e), [0, 0, 0]), rules.attract * (a.w ?? 1)))
      }
      return add(f, rules.tropism)
    })
    kids.forEach((c, i) => { c.dir = unit(add(c.dir, mul(forces[i], rules.step)), c.dir) })
  }
  return kids
}

function prepare(desc) {
  const rules = { ...DEFAULT_RULES, ...(desc.rules || {}) }
  // The order key reads a path in bijective base `fanout`: children and seeds
  // must each number fewer than it. 16 by default (every spike 015 hash);
  // drawn descriptions (spike 018) pass more.
  const fanout = desc.fanout ?? 16
  if (desc.seeds.length > fanout) throw new Error(`at most ${fanout} seeds`)
  const seeds = desc.seeds.map((s, i) => ({
    id: s.id, level: 0, parent: null, seed: s.id, kind: s.kind || 'stem',
    start: s.start, dir: unit(s.dir), len: s.len, radius: s.radius ?? 0.12, order: i,
    // An anchor (grow: false) takes part in the forces, so growth avoids or
    // seeks it, but never branches itself: a ground, a wall, a skeleton.
    grows: s.grow !== false,
  }))
  return { ...desc, fanout, rules, seeds, seedById: new Map(seeds.map((s) => [s.id, s])), knots: desc.knots || [] }
}

// Grows the whole object to maxLevel. Returns every vector, level by level.
export function expand(description, maxLevel) {
  return expandWhere(description, maxLevel, () => true)
}

// Grows only where `wanted(v, level)` says a parent's children are needed.
// Used for regional detail; with () => true it is the whole expansion.
export function expandWhere(description, maxLevel, wanted, { reverse = false, brute = false } = {}) {
  const desc = prepare(description)
  const byId = new Map()
  const frozen = brute ? new Everything() : new Levels()
  const cellAt = (level) => maxLenAt(description, level)
  const levels = [desc.seeds]
  for (const s of desc.seeds) { byId.set(s.id, s); frozen.insert(s, cellAt(0)) }
  const parentOf = (v) => (v.parent ? byId.get(v.parent) : null)
  for (let level = 0; level < maxLevel; level++) {
    const next = []
    // A global order key that is the same in whole and regional expansions:
    // the path read as bijective base 16, (parent + 1) * 16 + child, which is
    // unique across levels (up to 15 children and 16 seeds).
    // `reverse` visits parents backwards: a check that the result doesn't
    // depend on visiting order (it shouldn't, because a level is frozen only
    // once it's complete).
    const parents = reverse ? [...levels[level]].reverse() : levels[level]
    for (const v of parents) {
      if (!wanted(v, level)) continue
      for (const c of grow(v, parentOf, frozen, desc, (v.order + 1) * desc.fanout)) next.push(c)
    }
    // Freeze the whole level only after it is built, so siblings in other
    // parents never see each other mid-level (that would make the result
    // depend on visiting order and break regional growth).
    for (const c of next) { byId.set(c.id, c); frozen.insert(c, cellAt(level + 1)) }
    levels.push(next)
  }
  return { levels, rules: desc.rules }
}

// The longest a vector at `level` can be, for halo sizing.
export function maxLenAt(description, level) {
  const desc = prepare(description)
  let l = Math.max(...desc.seeds.map((s) => s.len))
  for (let i = 0; i < level; i++) l *= desc.rules.lenRatio * 1.2
  return l
}

// Regional detail: every vector that starts inside a sphere, exactly as the
// whole expansion has it, growing as little else as possible.
//
// What a level-k vector depends on: its parent (its start lies on the
// parent, within one length of it), its grandparent, its siblings (grown with
// it), and frozen vectors within (reach + 1) of its own length of its start.
// So if level-k vectors must be exact within need[k] of the centre, every
// level below k must be exact within need[k] + (reach + 2) * len[k], and a
// parent at level k - 1 must be grown if its segment comes within
// need[k] + len[k]. The halo is that recursion, not a padded guess.
export function expandRegion(description, maxLevel, center, radius) {
  const desc = prepare(description)
  const len = (l) => maxLenAt(description, l)
  const need = []
  need[maxLevel] = radius
  for (let k = maxLevel; k > 0; k--) need[k - 1] = need[k] + (desc.rules.reach + 2) * len(k)
  return expandWhere(description, maxLevel, (v, level) => {
    const d = length(sub(nearestOn(v, center), center))
    return d <= need[level + 1] + len(level + 1)
  })
}

// Canonical bytes: every vector's numbers in order-key order.
export function canonical(levels) {
  const all = levels.flat().slice().sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
  const buf = new Float64Array(all.length * 8)
  all.forEach((v, i) => buf.set([...v.start, ...v.dir, v.len, v.radius], i * 8))
  return { ids: all.map((v) => v.id), buf }
}

export { end, unit, length, sub }
