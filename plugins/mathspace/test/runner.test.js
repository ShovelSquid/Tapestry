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
        if (op.op !== 'setProperty') continue
        const node = state.nodes.find((n) => n.id === op.target)
        node.props[op.key] = { type: op.type, value: op.value }
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
