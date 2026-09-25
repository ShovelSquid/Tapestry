/**
 * Every shipped preset compiles clean and does what its description
 * promises, on one engine build with no engine change between them (the
 * plan's phase 3 done condition, headless). The kernel is a fake that
 * numbers created nodes like the real one would; the engine is real.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { loadModule } from './engine-cjs.js'

const require = createRequire(import.meta.url)
const { Runner } = require('../runner.js')
const { buildWorld } = require('../world.js')
const { projectAll } = require('../projection.js')
const { loadPresets, presetOps, presetCommands, COMMAND_PREFIX } = require('../presets.js')

const RULE = 'mathspace/rule@1'
const VIEW = 'mathspace/view@1'

/** A kernel that numbers created nodes from n2 and records commits. */
function fakeKernel() {
  const state = { seq: 1, commits: [], nodes: [], nextId: 2 }
  return {
    state,
    async getNodes() { return structuredClone(state.nodes) },
    async status() { return { kind: 'Ok', offset: 0, bytes: 0, lastGoodSeq: state.seq, reason: '' } },
    async submit(actorKind, actorId, message, ops) {
      const nodeIds = []
      for (const op of ops) {
        if (op.op === 'createNode') {
          const id = `n${state.nextId++}`
          state.nodes.push({ id, type: op.type, props: structuredClone(op.props ?? {}) })
          nodeIds.push(id)
          continue
        }
        const node = state.nodes.find((n) => n.id === op.target)
        if (op.op === 'setProperty') node.props[op.key] = { type: op.type, value: op.value }
        else if (op.op === 'unsetProperty') delete node.props[op.key]
      }
      state.seq += 1
      state.commits.push({ seq: state.seq, actorKind, actorId, message, ops })
      return { seq: state.seq, digest: 'x', nodeIds, edgeIds: [] }
    },
  }
}

function makeRunner() {
  const timers = []
  return new Runner({
    loadModule,
    commitEvery: 1000,
    log: () => {},
    setInterval: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t },
    clearInterval: () => {},
  })
}

/** Apply a preset through its command, run `ticks` ticks, commit, return the world after. */
async function runPreset(preset, ticks) {
  const kernel = fakeKernel()
  const command = presetCommands([preset])[0]
  const result = await command.handler({ kernel })
  expect(result.nodeIds).toHaveLength(preset.nodes.length)
  expect(result.nodeIds).toEqual(kernel.state.nodes.map((n) => n.id))
  const presetCommits = kernel.state.commits.length
  const before = structuredClone(kernel.state.nodes)
  const runner = makeRunner()
  if (ticks === 1) {
    await runner.stepOnce(kernel)
  } else {
    await runner.start(kernel)
    for (let i = 0; i < ticks; i++) runner.tick()
    await runner.pause(kernel)
  }
  const problems = runner.image.problems
  runner.dispose()
  const ops = kernel.state.commits.slice(presetCommits).flatMap((c) => c.ops)
  const after = kernel.state.nodes
  const prop = (nodes, title, key) => nodes.find((n) => n.props.title.value === title).props[key]?.value
  return { before, after, ops, problems, prop, presetCommits }
}

/** Project `nodes` (a kernel's, after a preset) through every view they hold. */
async function projectNodes(nodes) {
  const mod = await loadModule()
  const { engine, image } = buildWorld(nodes, mod)
  try {
    expect(image.problems).toEqual([])
    const out = projectAll(engine, image)
    const title = (id) => nodes.find((n) => n.id === id).props.title.value
    return {
      errors: out.views.filter((v) => v.error).map((v) => `${title(v.id)}: ${v.error}`),
      points: Object.fromEntries(out.points.map((p) => [title(p.id), Object.fromEntries(Object.entries(p.byView).map(([v, xy]) => [title(v), xy]))])),
    }
  } finally {
    engine.destroy()
  }
}

const presets = loadPresets()
const byId = Object.fromEntries(presets.map((p) => [p.id, p]))

describe('presets', () => {
  it('ships the plan\'s presets, the three roadmap examples and the default views, one command each, listed in the manifest', () => {
    expect(presets.map((p) => p.id)).toEqual(['anger', 'brush', 'contact', 'drag', 'gold', 'gravity-field', 'nbody', 'poincare', 'push', 'sphere', 'spring-to-anchor', 'view-2d', 'view-3d', 'view-4d'])
    const manifest = require('../tapestry.plugin.json')
    for (const p of presets) {
      expect(manifest.contributions.commands).toContain(COMMAND_PREFIX + p.id)
      expect(p.nodes.filter((n) => n.type === RULE || n.type === VIEW).length).toBeGreaterThanOrEqual(1)
      expect(p.description).not.toBe('')
      for (const op of presetOps(p)) expect(op).toMatchObject({ op: 'createNode', type: expect.any(String) })
    }
  })

  it('rejects a directory with a broken preset by name', () => {
    expect(() => loadPresets(new URL('./fixtures', import.meta.url).pathname)).toThrow(/preset .*\.json: /)
  })

  it('rejects a local ref that points outside the preset, at itself, or at a node with local refs', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'ms-presets-'))
    const write = (nodes) => writeFileSync(join(dir, 'bad.json'), JSON.stringify({ name: 'Bad', nodes }))
    const space = { type: 'mathspace/space@1', props: { dim: { type: 'int', value: 3 } } }
    const member = (value) => ({ type: 'tapestry.notes/note@1', props: { space: { type: 'ref', value } } })
    write([space, member('$2')])
    expect(() => loadPresets(dir)).toThrow(/node 1 prop space refers to node \$2/)
    write([space, member('$1')])
    expect(() => loadPresets(dir)).toThrow(/refers to node \$1/)
    write([space, member('$x')])
    expect(() => loadPresets(dir)).toThrow(/refers to node \$x/)
    write([space, member('$0'), member('$1')])
    expect(() => loadPresets(dir)).toThrow(/node 2 prop space refers to node 1, which has local refs/)
    write([space, member('$0')])
    expect(loadPresets(dir)).toHaveLength(1)
  })

  for (const preset of presets) {
    it(`${preset.id}: compiles clean and reports no runtime skip over one step and over 60 ticks`, async () => {
      for (const ticks of [1, 60]) {
        const { ops, problems } = await runPreset(preset, ticks)
        expect(problems).toEqual([])
        expect(ops.filter((o) => o.key === 'mathspace.error')).toEqual([])
        // Something the rule promised happened: at least one body changed.
        expect(ops.some((o) => o.op === 'setProperty')).toBe(true)
      }
    })
  }

  it('anger: proximity to chips raises anger, and only Sam\'s', async () => {
    const { before, after, prop } = await runPreset(byId.anger, 60)
    expect(prop(after, 'Sam', 'anger')).toBeGreaterThan(prop(before, 'Sam', 'anger'))
    expect(prop(after, 'Chips', 'anger')).toBeUndefined()
    expect(prop(after, 'Sam', 'position.x')).toBe(prop(before, 'Sam', 'position.x'))
    // Out of reach: no change. The same preset, chips moved away, no engine change.
    const far = structuredClone(byId.anger)
    far.nodes.find((n) => n.props.title.value === 'Chips').props['position.x'].value = 400
    const distant = await runPreset(far, 60)
    expect(distant.ops.filter((o) => o.key === 'anger')).toEqual([])
  })

  it('brush: the pen body chases its target with momentum and overshoots it', async () => {
    // k = 1/64, c = 1/8: underdamped with a damped period near 58 ticks, so
    // at tick 30 the body is around its first peak, past the target at 120.
    const { before, after, prop } = await runPreset(byId.brush, 30)
    expect(prop(before, 'Pen', 'position.x')).toBe(0)
    expect(prop(after, 'Pen', 'position.x')).toBeGreaterThan(120)
    expect(prop(after, 'Pen', 'position.y')).toBe(0)
    expect(prop(after, 'Pen', 'target.x')).toBe(120)
  })

  it('gold: each note accumulates its own income', async () => {
    const { before, after, prop } = await runPreset(byId.gold, 60)
    expect(prop(after, 'Treasury', 'gold')).toBe(prop(before, 'Treasury', 'gold') + 60)
    expect(prop(after, 'Mine', 'gold')).toBe(prop(before, 'Mine', 'gold') + 15)
  })

  it('push: the cart moves along +x and the rock with push 0 stays', async () => {
    const { before, after, prop } = await runPreset(byId.push, 60)
    expect(prop(after, 'Cart', 'position.x')).toBeGreaterThan(prop(before, 'Cart', 'position.x') + 100)
    expect(prop(after, 'Cart', 'position.y')).toBe(prop(before, 'Cart', 'position.y'))
    expect(prop(after, 'Rock', 'position.x')).toBe(prop(before, 'Rock', 'position.x'))
  })

  it('contact: the ball rests on the floor and never enters the bumper', async () => {
    const { after, prop } = await runPreset(byId.contact, 120)
    const x = prop(after, 'Ball', 'position.x')
    const y = prop(after, 'Ball', 'position.y')
    expect(y).toBeGreaterThan(199)
    expect(y).toBeLessThanOrEqual(200)
    expect(Math.hypot(x - 0, y - 100)).toBeGreaterThanOrEqual(60)
    // Slid off the bumper to the side it started on.
    expect(x).toBeGreaterThan(10)
    const early = await runPreset(byId.contact, 12)
    const ex = early.prop(early.after, 'Ball', 'position.x')
    const ey = early.prop(early.after, 'Ball', 'position.y')
    expect(Math.hypot(ex, ey - 100)).toBeGreaterThanOrEqual(59.9)
    expect(ey).toBeLessThan(100)
  })

  it('poincare: a metric on the space bends both paths toward the rim, which they never reach', async () => {
    const { before, after, prop, presetCommits, ops } = await runPreset(byId.poincare, 240)
    expect(presetCommits).toBe(2)
    expect(ops.filter((o) => o.key === 'mathspace.error')).toEqual([])
    const radius = (nodes, title) => Math.hypot(prop(nodes, title, 'position.x'), prop(nodes, title, 'position.y'))
    for (const title of ['Upward', 'Leftward']) {
      expect(radius(after, title)).toBeGreaterThan(radius(before, title))
      expect(radius(after, title)).toBeLessThan(100)
    }
    // Curved, not straight: the lane the note did not move along has changed.
    expect(prop(after, 'Upward', 'position.x')).not.toBe(30)
    expect(prop(after, 'Leftward', 'position.y')).not.toBe(60)
    // The identity view shows the chart as drawn.
    const seen = await projectNodes(after)
    expect(seen.errors).toEqual([])
    expect(seen.points.Upward.Disk).toEqual([prop(after, 'Upward', 'position.x'), prop(after, 'Upward', 'position.y')])
  })

  it('sphere: only great circles are geodesics, so the equator note stays near the equator and the pole note leaves its parallel', async () => {
    const { before, after, prop, ops } = await runPreset(byId.sphere, 240)
    expect(ops.filter((o) => o.key === 'mathspace.error')).toEqual([])
    // Equator: phi advances at nearly the full 240/64 = 3.75 (sin theta ~ 1) and theta
    // swings within [1.5, pi - 1.5] (1.64 at tick 120, back toward 1.5 by 240).
    // Pole: theta climbs from 0.25 past 0.9 and phi slows as it does, since
    // sin(theta)^2 * phi' is conserved along a geodesic.
    const theta = (title) => prop(after, title, 'position.x')
    const phi = (title) => prop(after, title, 'position.y')
    expect(phi('Equator')).toBeGreaterThan(3.5)
    expect(theta('Equator')).not.toBe(1.5)
    expect(theta('Equator')).toBeGreaterThanOrEqual(1.5 - 1e-6)
    expect(theta('Equator')).toBeLessThanOrEqual(Math.PI - 1.5 + 1e-6)
    expect(prop(before, 'Pole', 'position.x')).toBe(0.25)
    expect(theta('Pole')).toBeGreaterThan(0.9)
    expect(theta('Pole')).toBeLessThan(Math.PI / 2)
    expect(phi('Pole')).toBeGreaterThan(1)
    expect(phi('Pole')).toBeLessThan(2)
    // The side view embeds the chart: the equator note is drawn near height 0.
    const seen = await projectNodes(after)
    expect(seen.errors).toEqual([])
    expect(Math.abs(seen.points.Equator.Side[1])).toBeLessThan(10)
    expect(Math.hypot(...seen.points.Pole.Side)).toBeLessThanOrEqual(100.001)
  })

  it('view presets: the space comes one commit before its members, and $0 is the space\'s id', async () => {
    const two = await runPreset(byId['view-2d'], 1)
    expect(two.presetCommits).toBe(1)
    const four = await runPreset(byId['view-4d'], 1)
    expect(four.presetCommits).toBe(2)
    const space = four.before.find((n) => n.type === 'mathspace/space@1')
    for (const n of four.before) {
      if (n === space) continue
      expect(n.props.space).toEqual({ type: 'ref', value: space.id })
    }
  })

  it('view-2d: the identity view puts every note where the page draws it', async () => {
    const { before, after } = await runPreset(byId['view-2d'], 60)
    const seen = await projectNodes(after)
    expect(seen.errors).toEqual([])
    for (const n of after.filter((n) => n.type === 'tapestry.notes/note@1')) {
      expect(seen.points[n.props.title.value]['Page view']).toEqual([n.props['position.x'].value, n.props['position.y'].value])
    }
    expect(after.find((n) => n.props.title.value === 'Drifting').props['position.x'].value)
      .toBe(before.find((n) => n.props.title.value === 'Drifting').props['position.x'].value + 60)
  })

  it('view-3d: one 3-space through a perspective and three orthographic views at once', async () => {
    const { before, after, prop } = await runPreset(byId['view-3d'], 60)
    expect(prop(after, 'Receding', 'position.z')).toBe(prop(before, 'Receding', 'position.z') + 120)
    const seen = await projectNodes(after)
    expect(seen.errors).toEqual([])
    const { Perspective, ...ortho } = seen.points.Corner
    expect(ortho).toEqual({ 'Top (xy)': [120, 80], 'Front (xz)': [120, -100], 'Side (yz)': [80, -100] })
    expect(Perspective[0]).toBe(160)
    expect(Perspective[1]).toBeCloseTo(80 * 400 / 300, 6) // fixed-point division, not a double
    // Receding: the perspective image shrinks toward the axis, the top view stays.
    const start = await projectNodes(before)
    expect(start.points.Receding.Perspective).toEqual([-80, 40])
    expect(Math.abs(seen.points.Receding.Perspective[0])).toBeLessThan(80)
    expect(seen.points.Receding['Top (xy)']).toEqual([-80, 40])
  })

  it('view-4d: one 4-space viewable through two View nodes at once (phase 5 done condition)', async () => {
    const { before, after, prop } = await runPreset(byId['view-4d'], 60)
    expect(prop(after, 'Rising in w', 'position.w')).toBe(prop(before, 'Rising in w', 'position.w') + 60)
    const seen = await projectNodes(after)
    expect(seen.errors).toEqual([])
    expect(Object.keys(seen.points)).toEqual(['Origin', 'Diagonal', 'Rising in w'])
    expect(seen.points.Diagonal).toEqual({ xy: [100, 60], zw: [-40, 80] })
    expect(seen.points['Rising in w']).toEqual({ xy: [-60, 20], zw: [50, 60] })
    expect(seen.points.Origin).toEqual({ xy: [0, 0], zw: [0, 0] })
  })

  it('gravity-field, drag, spring-to-anchor, nbody: bodies move as described', async () => {
    const g = await runPreset(byId['gravity-field'], 60)
    expect(g.prop(g.after, 'Ball', 'velocity.y')).toBeGreaterThan(g.prop(g.before, 'Ball', 'velocity.y'))
    const d = await runPreset(byId.drag, 60)
    expect(d.prop(d.after, 'Puck', 'velocity.x')).toBeLessThan(1)
    expect(d.prop(d.after, 'Stone', 'velocity.x')).toBeGreaterThan(d.prop(d.after, 'Puck', 'velocity.x')) // heavier slows less
    const s = await runPreset(byId['spring-to-anchor'], 60)
    expect(Math.abs(s.prop(s.after, 'Weight', 'position.x'))).toBeLessThan(Math.abs(s.prop(s.before, 'Weight', 'position.x')))
    const n = await runPreset(byId.nbody, 60)
    for (const title of ['A', 'B', 'C']) {
      expect(n.prop(n.after, title, 'position.x')).not.toBe(n.prop(n.before, title, 'position.x'))
    }
  })
})
