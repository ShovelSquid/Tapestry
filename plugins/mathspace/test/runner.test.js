/**
 * The run loop against a fake kernel: commits carry exactly the changed
 * lanes plus one advance, a foreign commit forces a rebuild, a rejected
 * submit forces a rebuild, and pause/step behave. The engine is real.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { loadModule } from './engine-cjs.js'

const require = createRequire(import.meta.url)
const { Runner } = require('../runner.js')

const HERE = fileURLToPath(new URL('.', import.meta.url))
const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'velocity.json'), 'utf8'))

/** A kernel that holds nodes in memory and records commits. */
function fakeKernel(nodes) {
  const state = { seq: 3, commits: [], nodes: structuredClone(nodes), reject: false }
  const kernel = {
    state,
    async getNodes() { return structuredClone(state.nodes) },
    async status() { return { kind: 'Ok', offset: 0, bytes: 0, lastGoodSeq: state.seq, reason: '' } },
    async submit(actorKind, actorId, message, ops) {
      if (state.reject) throw new Error('refused')
      for (const op of ops) {
        const node = state.nodes.find((n) => n.id === op.target)
        if (op.op === 'setProperty') node.props[op.key] = { type: op.type, value: op.value }
        else if (op.op === 'unsetProperty') delete node.props[op.key]
      }
      state.seq += 1
      state.commits.push({ seq: state.seq, actorKind, actorId, message, ops })
      return { seq: state.seq, digest: 'x', nodeIds: [], edgeIds: [] }
    },
  }
  return kernel
}

function makeRunner(overrides = {}) {
  const timers = { intervals: [] }
  const runner = new Runner({
    loadModule,
    commitEvery: 10,
    log: () => {},
    setInterval: (fn, ms) => { const t = { fn, ms }; timers.intervals.push(t); return t },
    clearInterval: (t) => { timers.intervals = timers.intervals.filter((x) => x !== t) },
    ...overrides,
  })
  return { runner, timers }
}

describe('Runner', () => {
  it('runs: commits every commitEvery ticks with the changed lanes and an advance', async () => {
    const kernel = fakeKernel(fixture.nodes)
    const { runner, timers } = makeRunner()
    await runner.start(kernel)
    expect(runner.running).toBe(true)
    expect(timers.intervals).toHaveLength(1)
    expect(timers.intervals[0].ms).toBeCloseTo(1000 / 60)
    for (let i = 0; i < 10; i++) runner.tick()
    await runner.flushing
    expect(kernel.state.commits).toHaveLength(1)
    expect(kernel.state.commits[0]).toMatchObject({ actorKind: 'plugin', actorId: 'mathspace', message: 'advance 10' })
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 10 },
      { op: 'setProperty', target: 'n2', key: 'position.y', type: 'real', value: 20 },
      { op: 'advance', ticks: 10 },
    ])
    for (let i = 0; i < 10; i++) runner.tick()
    await runner.flushing
    expect(kernel.state.commits).toHaveLength(2)
    expect(kernel.state.commits[1].ops[0]).toEqual({ op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 20 })
    await runner.pause(kernel)
    expect(runner.running).toBe(false)
    expect(timers.intervals).toHaveLength(0)
    expect(kernel.state.commits).toHaveLength(2) // nothing pending, so pause commits nothing
    runner.dispose()
  })

  it('pause commits the partial batch; the whole run reproduces the checkpoint fixture', async () => {
    const kernel = fakeKernel(fixture.nodes)
    const { runner } = makeRunner({ commitEvery: 60 })
    await runner.start(kernel)
    for (let i = 0; i < 25; i++) runner.tick()
    await runner.pause(kernel)
    expect(kernel.state.commits).toHaveLength(1)
    expect(kernel.state.commits[0].message).toBe('advance 25')
    await runner.start(kernel) // seq matches, but start always rebuilds from the kernel
    for (let i = 0; i < 35; i++) runner.tick()
    await runner.pause(kernel)
    expect(kernel.state.commits).toHaveLength(2)
    expect(kernel.state.commits[1].ops).toEqual([...fixture.expected, { op: 'advance', ticks: 35 }])
    runner.dispose()
  })

  it('a foreign commit drops pending ticks and rebuilds from the kernel', async () => {
    const kernel = fakeKernel(fixture.nodes)
    const { runner } = makeRunner()
    await runner.start(kernel)
    for (let i = 0; i < 9; i++) runner.tick()
    // A human drags n2 to (100, 100).
    kernel.state.nodes[0].props['position.x'] = { type: 'real', value: 100 }
    kernel.state.nodes[0].props['position.y'] = { type: 'real', value: 100 }
    kernel.state.seq += 1
    runner.tick() // 10th: triggers a flush, which sees the foreign seq
    await runner.flushing
    expect(kernel.state.commits).toHaveLength(0)
    expect(runner.seq).toBe(kernel.state.seq)
    for (let i = 0; i < 10; i++) runner.tick()
    await runner.flushing
    expect(kernel.state.commits).toHaveLength(1)
    expect(kernel.state.commits[0].ops[0]).toEqual({ op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 110 })
    runner.dispose()
  })

  it('a refused submit is reported and the next flush rebuilds', async () => {
    const kernel = fakeKernel(fixture.nodes)
    const logs = []
    const { runner } = makeRunner({ log: (m) => logs.push(m) })
    await runner.start(kernel)
    kernel.state.reject = true
    for (let i = 0; i < 10; i++) runner.tick()
    await runner.flushing
    expect(logs.some((m) => m.startsWith('commit failed: refused'))).toBe(true)
    kernel.state.reject = false
    for (let i = 0; i < 10; i++) runner.tick()
    await runner.flushing
    // Rebuilt from the kernel at (0,0), so the first successful commit starts over.
    expect(kernel.state.commits).toHaveLength(0)
    for (let i = 0; i < 10; i++) runner.tick()
    await runner.flushing
    expect(kernel.state.commits).toHaveLength(1)
    expect(kernel.state.commits[0].ops[0].value).toBe(10)
    runner.dispose()
  })

  it('stepOnce commits one tick and is a no-op while running', async () => {
    const kernel = fakeKernel(fixture.nodes)
    const { runner } = makeRunner()
    await runner.stepOnce(kernel)
    expect(kernel.state.commits).toHaveLength(1)
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 1 },
      { op: 'setProperty', target: 'n2', key: 'position.y', type: 'real', value: 2 },
      { op: 'advance', ticks: 1 },
    ])
    await runner.stepOnce(kernel)
    expect(kernel.state.commits[1].ops[0].value).toBe(2)
    await runner.start(kernel)
    await runner.stepOnce(kernel)
    expect(kernel.state.commits).toHaveLength(2)
    runner.dispose()
    expect(runner.running).toBe(false)
  })

  it('a rebuild whose image the engine rejects surfaces as an Error, not a crash', async () => {
    // Two space refs to a 1-dim space with a 2-lane position: image.js drops
    // the pos; nothing reaches the engine that it rejects. So provoke it
    // through a duplicate id instead.
    const kernel = fakeKernel([fixture.nodes[0], { ...fixture.nodes[0] }])
    const { runner } = makeRunner()
    await expect(runner.start(kernel)).rejects.toThrow(/engine rejected/)
    expect(runner.running).toBe(false)
    runner.dispose()
  })
})

describe('Runner with bound expressions', () => {
  const nodes = [
    {
      id: 'n2',
      type: 'tapestry.notes/note@1',
      props: {
        'position.x': { type: 'real', value: 1 },
        'position.y': { type: 'real', value: 0 },
        'velocity.x': { type: 'real', value: 1 },
        'velocity.y': { type: 'real', value: 0 },
        k: { type: 'real', value: 3 },
        'y.expr': { type: 'text', value: 'self.position.x * self.k' },
        'v.expr': { type: 'text', value: '[self.position.x, node(n3).k]' },
      },
    },
    {
      id: 'n3',
      type: 'tapestry.notes/note@1',
      props: {
        'position.x': { type: 'real', value: 0 },
        'position.y': { type: 'real', value: 0 },
        k: { type: 'real', value: 0.5 },
        'bad.expr': { type: 'text', value: 'self.k +' },
        'worse.expr': { type: 'text', value: 'self.nope' },
      },
    },
  ]

  it('binds <f>.expr props after the image and commits their values; failures are logged problems', async () => {
    const kernel = fakeKernel(nodes)
    const logs = []
    const { runner } = makeRunner({ log: (m) => logs.push(m) })
    await runner.stepOnce(kernel)
    expect(runner.image.bindings.map((b) => `${b.node} ${b.name}`)).toEqual(['n2 v', 'n2 y', 'n3 bad', 'n3 worse'])
    expect(runner.image.problems).toEqual([
      { id: 'n3', key: 'bad.expr', reason: 'parse:UnexpectedEnd at 8' },
      { id: 'n3', key: 'worse.expr', reason: expect.stringMatching(/^compile:UnknownRef at \d+$/) },
    ])
    expect(logs.filter((m) => m.startsWith('skipping n3'))).toHaveLength(2)
    expect(kernel.state.commits).toHaveLength(1)
    // After one tick: position.x = 2, y = 2 * 3, v = [2, 0.5]; n3 unchanged.
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 2 },
      { op: 'setProperty', target: 'n2', key: 'v.x', type: 'real', value: 2 },
      { op: 'setProperty', target: 'n2', key: 'v.y', type: 'real', value: 0.5 },
      { op: 'setProperty', target: 'n2', key: 'y', type: 'real', value: 6 },
      { op: 'advance', ticks: 1 },
    ])
    // The committed values round-trip: a rebuild sets y then binds it, and
    // the next tick moves on from the committed state.
    await runner.stepOnce(kernel)
    expect(kernel.state.commits[1].ops).toEqual([
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 3 },
      { op: 'setProperty', target: 'n2', key: 'v.x', type: 'real', value: 3 },
      { op: 'setProperty', target: 'n2', key: 'y', type: 'real', value: 9 },
      { op: 'advance', ticks: 1 },
    ])
    runner.dispose()
  })

  it('a bound field takes the expression\'s dim (the store zeroes it on a shape change); a bad key is a problem', async () => {
    const kernel = fakeKernel([
      {
        id: 'n2',
        type: 'tapestry.notes/note@1',
        props: {
          'position.x': { type: 'real', value: 0 },
          'position.y': { type: 'real', value: 0 },
          'w.x': { type: 'real', value: 1 },
          'w.y': { type: 'real', value: 1 },
          'w.expr': { type: 'text', value: 'self.position.x' },
          'x.y.expr': { type: 'text', value: '1' },
        },
      },
    ])
    const { runner } = makeRunner()
    await runner.stepOnce(kernel)
    expect(runner.image.problems).toEqual([{ id: 'n2', key: 'x.y.expr', reason: '"x.y" is not a field name' }])
    // w was [1, 1]; bound as a scalar it restarts at zero and evaluates to position.x.
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n2', key: 'w', type: 'real', value: 0 },
      { op: 'advance', ticks: 1 },
    ])
    runner.dispose()
  })
})


describe('Runner with rule nodes', () => {
  const RULE = 'mathspace/rule@1'
  const at = (x, y, extra = {}) => ({ 'position.x': { type: 'real', value: x }, 'position.y': { type: 'real', value: y }, ...extra })
  const text = (value) => ({ type: 'text', value })
  const nodes = [
    { id: 'n2', type: 'tapestry.notes/note@1', props: at(0, 0, { 'velocity.x': { type: 'real', value: 0 }, 'velocity.y': { type: 'real', value: 0 }, mass: { type: 'real', value: 2 } }) },
    { id: 'n3', type: 'tapestry.notes/note@1', props: at(10, 0) }, // no velocity: forces never move it
    // Unary weight rule: -mass along y, plus a constant push along x.
    { id: 'n4', type: RULE, props: at(50, 50, { scope: text('unary'), 'force.expr': text('[1, 0 - self.mass]') }) },
    // Selects nothing at first (x >= 20), then n2 once it has moved that far.
    { id: 'n5', type: RULE, props: at(60, 60, { 'select.expr': text('self.position.x >= 20'), 'force.expr': text('[0, 4]') }) },
    // Broken: an unknown ref and a bad scope, with a stale error text from before.
    { id: 'n6', type: RULE, props: at(70, 70, { 'force.expr': text('[self.nope, 0]'), 'mathspace.error': text('stale') }) },
    { id: 'n7', type: RULE, props: at(80, 80, { scope: text('everywhere'), 'force.expr': text('[1, 0]') }) },
    // Was broken, fixed by a human: the old error text goes away.
    { id: 'n8', type: RULE, props: at(90, 90, { 'force.expr': text('[0, 0]'), 'mathspace.error': text('force.expr: old') }) },
  ]

  it('a rule node moves a note through the runner; only bodies are committed, rules get their error text', async () => {
    const kernel = fakeKernel(nodes)
    const { runner } = makeRunner()
    await runner.stepOnce(kernel)
    expect(runner.image.problems.map((p) => p.id)).toEqual(['n7', 'n6'])
    // Tick 1: n2 velocity += [1, -2] / 2 = [0.5, -1], pos = [0.5, -1]. Rule 5 selects nothing.
    // n4 reads self.mass, which n3 lacks: a runtime skip reported on the rule.
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n4', key: 'mathspace.error', type: 'text', value: 'step: skipped 1 visit (NoSuchField)' },
      { op: 'setProperty', target: 'n6', key: 'mathspace.error', type: 'text', value: expect.stringMatching(/^force\.expr: compile:UnknownRef at \d+$/) },
      { op: 'setProperty', target: 'n7', key: 'mathspace.error', type: 'text', value: 'scope: scope must be one of unary, pair, global' },
      { op: 'unsetProperty', target: 'n8', key: 'mathspace.error' },
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 0.5 },
      { op: 'setProperty', target: 'n2', key: 'position.y', type: 'real', value: -1 },
      { op: 'setProperty', target: 'n2', key: 'velocity.x', type: 'real', value: 0.5 },
      { op: 'setProperty', target: 'n2', key: 'velocity.y', type: 'real', value: -1 },
      { op: 'advance', ticks: 1 },
    ])
    expect(kernel.state.nodes.find((n) => n.id === 'n8').props['mathspace.error']).toBeUndefined()
    // The next step rebuilds from the kernel, which now holds the same errors: no error ops again.
    await runner.stepOnce(kernel)
    expect(kernel.state.commits[1].ops.map((o) => o.target + ' ' + o.key)).toEqual([
      'n2 position.x', 'n2 position.y', 'n2 velocity.x', 'n2 velocity.y', 'undefined undefined',
    ])
    expect(kernel.state.commits[1].ops[0].value).toBe(1.5)
    runner.dispose()
  })

  it('select gates a rule: the lift kicks in once the target is past x >= 20', async () => {
    const kernel = fakeKernel(nodes)
    const { runner } = makeRunner({ commitEvery: 1000 })
    await runner.start(kernel)
    // With velocity.x growing by 0.5 each tick, x(t) = 0.5 * t(t+1)/2 passes 20 at t = 9 (x = 22.5).
    for (let i = 0; i < 9; i++) runner.tick()
    await runner.pause(kernel)
    const ops = kernel.state.commits[0].ops
    const y9 = ops.find((o) => o.target === 'n2' && o.key === 'position.y').value
    const vy9 = ops.find((o) => o.target === 'n2' && o.key === 'velocity.y').value
    expect(vy9).toBe(-9) // weight only
    await runner.start(kernel)
    runner.tick()
    await runner.pause(kernel)
    const ops10 = kernel.state.commits[1].ops
    expect(ops10.find((o) => o.target === 'n2' && o.key === 'velocity.y').value).toBe(vy9 - 1 + 2) // lift [0, 4] / mass 2
    expect(ops10.find((o) => o.target === 'n2' && o.key === 'position.y').value).toBe(y9 + vy9 + 1)
    expect(ops.some((o) => o.target === 'n3')).toBe(false)
    runner.dispose()
  })

  it('a set.<f> rule assigns a field the body already has; a missing field is a skip', async () => {
    const kernel = fakeKernel([
      { id: 'n2', type: 'tapestry.notes/note@1', props: at(3, 0, { 'velocity.x': { type: 'real', value: 1 }, 'velocity.y': { type: 'real', value: 0 }, heat: { type: 'real', value: 0 } }) },
      { id: 'n3', type: 'tapestry.notes/note@1', props: at(7, 0) }, // no heat: the rule never creates it
      { id: 'n4', type: RULE, props: at(50, 50, { 'set.heat.expr': text('self.position.x * 2') }) },
    ])
    const { runner } = makeRunner()
    await runner.stepOnce(kernel)
    expect(runner.image.problems).toEqual([])
    // heat is set from this tick's integrated x (3 + 1 = 4); n3's missing heat is reported on the rule.
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n4', key: 'mathspace.error', type: 'text', value: 'step: skipped 1 visit (NoTargetField)' },
      { op: 'setProperty', target: 'n2', key: 'heat', type: 'real', value: 8 },
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 4 },
      { op: 'advance', ticks: 1 },
    ])
    runner.dispose()
  })

  it('runtime skips are summed over the ticks of a commit and unset once the rule runs clean', async () => {
    const kernel = fakeKernel([
      { id: 'n2', type: 'tapestry.notes/note@1', props: at(0, 0, { 'velocity.x': { type: 'real', value: 0 }, 'velocity.y': { type: 'real', value: 0 }, mass: { type: 'real', value: 1 } }) },
      { id: 'n3', type: 'tapestry.notes/note@1', props: at(10, 0) }, // no mass: self.mass fails here every tick
      { id: 'n4', type: RULE, props: at(50, 50, { 'force.expr': text('[self.mass, 0]') }) },
    ])
    const { runner } = makeRunner()
    await runner.start(kernel)
    for (let i = 0; i < 10; i++) runner.tick()
    await runner.flushing
    expect(runner.image.problems).toEqual([])
    expect(kernel.state.commits[0].ops[0]).toEqual(
      { op: 'setProperty', target: 'n4', key: 'mathspace.error', type: 'text', value: 'step: skipped 10 visits (NoSuchField)' })
    expect(kernel.state.nodes.find((n) => n.id === 'n4').props['mathspace.error'].value).toBe('step: skipped 10 visits (NoSuchField)')
    // A human gives n3 a mass: the foreign commit forces a rebuild, and the
    // next commit finds the rule clean and unsets the text.
    kernel.state.nodes.find((n) => n.id === 'n3').props.mass = { type: 'real', value: 1 }
    kernel.state.seq += 1
    for (let i = 0; i < 10; i++) runner.tick()
    await runner.flushing // rebuilt, nothing committed
    expect(kernel.state.commits).toHaveLength(1)
    for (let i = 0; i < 10; i++) runner.tick()
    await runner.flushing
    expect(kernel.state.commits).toHaveLength(2)
    expect(kernel.state.commits[1].ops[0]).toEqual({ op: 'unsetProperty', target: 'n4', key: 'mathspace.error' })
    expect(kernel.state.nodes.find((n) => n.id === 'n4').props['mathspace.error']).toBeUndefined()
    await runner.pause(kernel)
    runner.dispose()
  })

  it('a pair rule binds other: a spring swaps two bodies at rest', async () => {
    const kernel = fakeKernel([
      { id: 'n2', type: 'tapestry.notes/note@1', props: at(0, 0, { 'velocity.x': { type: 'real', value: 0 }, 'velocity.y': { type: 'real', value: 0 } }) },
      { id: 'n3', type: 'tapestry.notes/note@1', props: at(10, 0, { 'velocity.x': { type: 'real', value: 0 }, 'velocity.y': { type: 'real', value: 0 } }) },
      { id: 'n4', type: RULE, props: at(50, 50, { scope: text('pair'), 'force.expr': text('other.position - self.position') }) },
    ])
    const { runner } = makeRunner()
    await runner.stepOnce(kernel)
    expect(runner.image.problems).toEqual([])
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 10 },
      { op: 'setProperty', target: 'n2', key: 'velocity.x', type: 'real', value: 10 },
      { op: 'setProperty', target: 'n3', key: 'position.x', type: 'real', value: 0 },
      { op: 'setProperty', target: 'n3', key: 'velocity.x', type: 'real', value: -10 },
      { op: 'advance', ticks: 1 },
    ])
    runner.dispose()
  })

  it('a constraint.expr rod pulls a bob to its length; compliance softens it', async () => {
    const bodies = () => [
      { id: 'n2', type: 'tapestry.notes/note@1', props: at(0, 0, { 'velocity.x': { type: 'real', value: 0 }, 'velocity.y': { type: 'real', value: 0 }, pinned: { type: 'bool', value: true } }) },
      { id: 'n3', type: 'tapestry.notes/note@1', props: at(15, 0, { 'velocity.x': { type: 'real', value: 0 }, 'velocity.y': { type: 'real', value: 0 } }) },
    ]
    const rigid = fakeKernel([
      ...bodies(),
      { id: 'n4', type: RULE, props: at(50, 50, { scope: text('pair'), 'constraint.expr': text('norm(other.position - self.position) - 10') }) },
    ])
    const { runner } = makeRunner()
    await runner.stepOnce(rigid)
    expect(runner.image.problems).toEqual([])
    // The anchor is pinned, so the bob takes the whole correction in one pass.
    expect(rigid.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n3', key: 'position.x', type: 'real', value: 10 },
      { op: 'setProperty', target: 'n3', key: 'velocity.x', type: 'real', value: -5 },
      { op: 'advance', ticks: 1 },
    ])
    expect(rigid.state.nodes.find((n) => n.id === 'n4').props['mathspace.error']).toBeUndefined()
    runner.dispose()

    const soft = fakeKernel([
      ...bodies(),
      { id: 'n4', type: RULE, props: at(50, 50, { scope: text('pair'), compliance: { type: 'real', value: 1 }, 'constraint.expr': text('norm(other.position - self.position) - 10') }) },
    ])
    const { runner: runner2 } = makeRunner()
    await runner2.stepOnce(soft)
    // Half the remaining error per pass over four passes: 15 -> 10.3125.
    expect(soft.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n3', key: 'position.x', type: 'real', value: 10.3125 },
      { op: 'setProperty', target: 'n3', key: 'velocity.x', type: 'real', value: -4.6875 },
      { op: 'advance', ticks: 1 },
    ])
    runner2.dispose()
  })

  it('a view node projects a note of its space on demand and is never committed or moved', async () => {
    const VIEW = 'mathspace/view@1'
    const ref = (value) => ({ type: 'ref', value })
    const real = (value) => ({ type: 'real', value })
    const kernel = fakeKernel([
      { id: 'n1', type: 'mathspace/space@1', props: { dim: { type: 'int', value: 3 } } },
      { id: 'n2', type: 'tapestry.notes/note@1', props: { space: ref('n1'), 'position.x': real(4), 'position.y': real(6), 'position.z': real(0), 'velocity.x': real(0), 'velocity.y': real(0), 'velocity.z': real(1) } },
      // A perspective-like view; it has a position of its own that gravity must not touch.
      { id: 'n3', type: VIEW, props: { space: ref('n1'), 'position.x': real(9), 'position.y': real(9), 'position.z': real(9), 'velocity.x': real(0), 'velocity.y': real(0), 'velocity.z': real(0), 'project.expr': text('[self.position.x, self.position.y] / (self.position.z + 2)') } },
      // Compiles, but is not a map to the plane.
      { id: 'n4', type: VIEW, props: { space: ref('n1'), 'project.expr': text('self.position.z') } },
      { id: 'n5', type: RULE, props: { space: ref('n1'), 'force.expr': text('[0, 0, 1]') } },
    ])
    const { runner } = makeRunner()
    await runner.stepOnce(kernel)
    expect(runner.image.problems).toEqual([])
    // Only the body moves: pos (4, 6, 0) + velocity (0, 0, 1 + 1); the views' fields are never written back.
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n2', key: 'position.z', type: 'real', value: 2 },
      { op: 'setProperty', target: 'n2', key: 'velocity.z', type: 'real', value: 2 },
      { op: 'advance', ticks: 1 },
    ])
    // project = [4, 6] / (2 + 2), evaluated against the engine as it is now.
    expect(runner.engine.project(3n, 2n)).toEqual({ lanes: [BigInt(2 ** 32), BigInt(1.5 * 2 ** 32)] })
    expect(runner.engine.project(4n, 2n)).toEqual({ error: 'world:BadDim' })
    expect(runner.engine.project(3n, 5n)).toEqual({ error: 'eval:NoSuchField' })
    expect(runner.engine.project(2n, 3n)).toEqual({ error: 'world:BadKind' })
    runner.dispose()
  })

  it('a pinned note is held still under velocity and force (RULE-08)', async () => {
    const kernel = fakeKernel([
      { id: 'n2', type: 'tapestry.notes/note@1', props: at(0, 0, { 'velocity.x': { type: 'real', value: 1 }, 'velocity.y': { type: 'real', value: 0 }, pinned: { type: 'bool', value: true } }) },
      { id: 'n3', type: 'tapestry.notes/note@1', props: at(0, 0, { 'velocity.x': { type: 'real', value: 1 }, 'velocity.y': { type: 'real', value: 0 }, pinned: { type: 'bool', value: false } }) },
      { id: 'n4', type: RULE, props: at(50, 50, { 'force.expr': text('[0, 1]') }) },
    ])
    const { runner } = makeRunner()
    await runner.stepOnce(kernel)
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n3', key: 'position.x', type: 'real', value: 1 },
      { op: 'setProperty', target: 'n3', key: 'position.y', type: 'real', value: 1 },
      { op: 'setProperty', target: 'n3', key: 'velocity.y', type: 'real', value: 1 },
      { op: 'advance', ticks: 1 },
    ])
    runner.dispose()
  })
})

describe('Runner with a metric on a space', () => {
  const SPACE = 'mathspace/space@1'
  const text = (value) => ({ type: 'text', value })
  const real = (value) => ({ type: 'real', value })
  const body = (space, extra = {}) => ({ space: { type: 'ref', value: space }, 'position.x': real(0), 'position.y': real(0), 'velocity.x': real(1), 'velocity.y': real(0), ...extra })
  const nodes = [
    // Euclidean written out: steps exactly as no metric would.
    { id: 'n1', type: SPACE, props: { dim: { type: 'int', value: 2 }, 'metric.expr': text('[1, 1]'), 'mathspace.error': text('stale') } },
    { id: 'n2', type: 'tapestry.notes/note@1', props: body('n1') },
    // Wrong dim for a 2-space: BadMetric on the space, its notes step Euclidean.
    { id: 'n3', type: SPACE, props: { dim: { type: 'int', value: 2 }, 'metric.expr': text('self.position.x') } },
    { id: 'n4', type: 'tapestry.notes/note@1', props: body('n3') },
    // Does not parse: a compile problem on the space, with the offset in what the user wrote.
    { id: 'n5', type: SPACE, props: { dim: { type: 'int', value: 2 }, 'metric.expr': text('[1, self.position.q]') } },
    { id: 'n6', type: 'tapestry.notes/note@1', props: body('n5') },
  ]

  it('binds metric.expr on the space and reports the engine\'s BadMetric there', async () => {
    const kernel = fakeKernel(nodes)
    const { runner } = makeRunner()
    await runner.stepOnce(kernel)
    expect(runner.image.bindings.map((b) => `${b.node} ${b.name}`)).toEqual(['n1 metric', 'n3 metric', 'n5 metric'])
    expect(runner.image.problems).toEqual([{ id: 'n5', key: 'metric.expr', reason: 'parse:BadComponent at 18' }]) // 18 in what the user wrote, not in the rewritten `self.pos.q`
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'unsetProperty', target: 'n1', key: 'mathspace.error' },
      { op: 'setProperty', target: 'n3', key: 'mathspace.error', type: 'text', value: 'step: skipped 1 visit (BadMetric)' },
      { op: 'setProperty', target: 'n5', key: 'mathspace.error', type: 'text', value: 'metric.expr: parse:BadComponent at 18' },
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 1 },
      { op: 'setProperty', target: 'n4', key: 'position.x', type: 'real', value: 1 },
      { op: 'setProperty', target: 'n6', key: 'position.x', type: 'real', value: 1 },
      { op: 'advance', ticks: 1 },
    ])
    // The space's own lanes are never committed, and a repeated failure with the same text is not rewritten.
    await runner.stepOnce(kernel)
    expect(kernel.state.commits[1].ops.map((o) => `${o.target ?? ''} ${o.key ?? o.op}`)).toEqual([
      'n2 position.x', 'n4 position.x', 'n6 position.x', ' advance',
    ])
  })

  it('a Poincaré metric bends a straight path and keeps the note inside the disk', async () => {
    const disk = [
      { id: 'n1', type: SPACE, props: { dim: { type: 'int', value: 2 }, 'metric.expr': text('4 / pow(1 - dot(self.position, self.position) / 10000, 2) * [1, 1]') } },
      { id: 'n2', type: 'tapestry.notes/note@1', props: body('n1', { 'position.x': real(30), 'velocity.x': real(0), 'velocity.y': real(1) }) },
    ]
    const kernel = fakeKernel(disk)
    const { runner } = makeRunner({ commitEvery: 1000 })
    await runner.start(kernel)
    for (let i = 0; i < 240; i++) runner.tick()
    await runner.pause(kernel)
    expect(kernel.state.commits).toHaveLength(1)
    expect(kernel.state.commits[0].ops.filter((o) => o.key === 'mathspace.error')).toEqual([])
    const n2 = kernel.state.nodes.find((n) => n.id === 'n2').props
    const r = Math.hypot(n2['position.x'].value, n2['position.y'].value)
    expect(r).toBeGreaterThan(30)
    expect(r).toBeLessThan(100)
    expect(n2['position.x'].value).not.toBe(30) // curved, not the straight line x = 30
    runner.dispose()
  })
})

describe('Runner with identify on a space', () => {
  const SPACE = 'mathspace/space@1'
  const text = (value) => ({ type: 'text', value })
  const real = (value) => ({ type: 'real', value })
  const nodes = [
    // x wraps at ±100, y is open: 99 + 2 lands at -99.
    { id: 'n1', type: SPACE, props: { dim: { type: 'int', value: 2 }, 'identify.x': real(100) } },
    { id: 'n2', type: 'tapestry.notes/note@1', props: { space: { type: 'ref', value: 'n1' }, 'position.x': real(99), 'position.y': real(5), 'velocity.x': real(2), 'velocity.y': real(1) } },
    // A bound identify holds zero lanes on the first step, so it wraps only from the second.
    { id: 'n3', type: SPACE, props: { dim: { type: 'int', value: 2 }, 'identify.expr': text('[100, 0]') } },
    { id: 'n4', type: 'tapestry.notes/note@1', props: { space: { type: 'ref', value: 'n3' }, 'position.x': real(99), 'position.y': real(0), 'velocity.x': real(2), 'velocity.y': real(0) } },
  ]

  it('wraps a note past the half-width and never commits the space\'s lanes', async () => {
    const kernel = fakeKernel(nodes)
    const { runner } = makeRunner()
    await runner.stepOnce(kernel)
    expect(runner.image.problems).toEqual([])
    expect(kernel.state.commits[0].ops).toEqual([
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: -99 },
      { op: 'setProperty', target: 'n2', key: 'position.y', type: 'real', value: 6 },
      { op: 'setProperty', target: 'n4', key: 'position.x', type: 'real', value: 101 },
      { op: 'advance', ticks: 1 },
    ])
    await runner.stepOnce(kernel)
    expect(kernel.state.commits[1].ops).toEqual([
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: -97 },
      { op: 'setProperty', target: 'n2', key: 'position.y', type: 'real', value: 7 },
      { op: 'setProperty', target: 'n4', key: 'position.x', type: 'real', value: -97 },
      { op: 'advance', ticks: 1 },
    ])
  })
})
