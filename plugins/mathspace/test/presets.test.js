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
const { loadPresets, presetOps, presetCommands, COMMAND_PREFIX } = require('../presets.js')

const RULE = 'mathspace/rule@1'

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
  const ops = kernel.state.commits.slice(1).flatMap((c) => c.ops)
  const after = kernel.state.nodes
  const prop = (nodes, title, key) => nodes.find((n) => n.props.title.value === title).props[key]?.value
  return { before, after, ops, problems, prop }
}

const presets = loadPresets()
const byId = Object.fromEntries(presets.map((p) => [p.id, p]))

describe('presets', () => {
  it('ships the plan\'s presets and the three roadmap examples, one command each, listed in the manifest', () => {
    expect(presets.map((p) => p.id)).toEqual(['anger', 'contact', 'drag', 'gold', 'gravity-field', 'nbody', 'push', 'spring-to-anchor'])
    const manifest = require('../tapestry.plugin.json')
    for (const p of presets) {
      expect(manifest.contributions.commands).toContain(COMMAND_PREFIX + p.id)
      expect(p.nodes.filter((n) => n.type === RULE).length).toBeGreaterThanOrEqual(1)
      expect(p.description).not.toBe('')
      for (const op of presetOps(p)) expect(op).toMatchObject({ op: 'createNode', type: expect.any(String) })
    }
  })

  it('rejects a directory with a broken preset by name', () => {
    expect(() => loadPresets(new URL('./fixtures', import.meta.url).pathname)).toThrow(/preset .*\.json: /)
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
