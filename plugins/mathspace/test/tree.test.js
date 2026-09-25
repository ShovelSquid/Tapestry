/**
 * The headless half of the phase 1 done condition (mathspace_plan.md):
 * a note given a velocity moves under Run, Pause leaves a commit whose
 * `set position.x` lines are in the .tree, and reopening the file shows
 * the note where it stopped. The kernel is the real native addon over a
 * temp world, the plugin sees it through the same facade the host hands
 * it, and the engine is the real Wasm. Only the GUI (clicking Run) is
 * left to a human.
 *
 * Needs app/native/build/Release/tapestry_addon.node (`npm run
 * build:native` in app/); the suite is skipped when it is missing.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { loadModule } from './engine-cjs.js'

const require = createRequire(import.meta.url)
const { Runner } = require('../runner.js')

const ADDON = fileURLToPath(new URL('../../../app/native/build/Release/tapestry_addon.node', import.meta.url))

describe.skipIf(!existsSync(ADDON))('run loop over a real .tree', () => {
  it('Run, Pause: the file has the set and advance lines and reopens with the note moved', async () => {
    const { createTempTree } = await import('../../../app/test/helpers/temp-tree.ts')
    const { makePluginKernelFacade } = await import('../../../app/src/main/plugin-host.ts')
    const { KernelBridge } = await import('../../../app/src/main/kernel-bridge.ts')

    const tree = createTempTree('mathspace')
    let treePath = tree.path
    try {
      // What a person would do in the inspector: a note with a velocity.
      const seed = tree.bridge.submitAs({ kind: 'human', id: 'user.test' }, 'A moving note', [{
        op: 'createNode',
        type: 'tapestry.notes/note@1',
        props: {
          title: { type: 'text', value: 'mover' },
          'position.x': { type: 'real', value: 0 },
          'position.y': { type: 'real', value: 0 },
          'velocity.x': { type: 'real', value: 1 },
          'velocity.y': { type: 'real', value: 2 },
        },
      }])
      const noteId = seed.nodeIds[0]

      const kernel = makePluginKernelFacade('mathspace', () => tree.bridge)
      const logs = []
      const runner = new Runner({
        loadModule,
        log: (m) => logs.push(m),
        setInterval: () => ({}),
        clearInterval: () => {},
      })
      await runner.start(kernel)
      for (let i = 0; i < 60; i++) runner.tick() // one commit at tick 60
      await runner.flushing
      for (let i = 0; i < 10; i++) runner.tick()
      await runner.pause(kernel) // a second, partial commit
      runner.dispose()

      const text = readFileSync(treePath, 'utf8')
      const lines = text.split('\n')
      expect(lines).toContain('actor plugin mathspace')
      expect(lines).toContain(`set ${noteId} position.x real 60`)
      expect(lines).toContain(`set ${noteId} position.y real 120`)
      expect(lines).toContain('advance 60')
      expect(lines).toContain(`set ${noteId} position.x real 70`)
      expect(lines).toContain(`set ${noteId} position.y real 140`)
      expect(lines).toContain('advance 10')
      expect(lines.filter((l) => l.startsWith('set ') && l.includes('velocity'))).toHaveLength(2) // only the seed
      expect(logs.some((m) => m.startsWith('skipping'))).toBe(false)

      // Reopen: the note is where it stopped, without the engine.
      tree.bridge.close()
      const again = new KernelBridge()
      again.open(treePath)
      try {
        const node = again.getNode(noteId)
        expect(node.props['position.x']).toEqual({ type: 'real', value: 70 })
        expect(node.props['position.y']).toEqual({ type: 'real', value: 140 })
        expect(again.status().kind).toBe('Ok')
      } finally {
        again.close()
      }
    } finally {
      tree.cleanup()
    }
  })

  it('a human edit during the run wins: the engine rebuilds instead of overwriting it', async () => {
    const { createTempTree } = await import('../../../app/test/helpers/temp-tree.ts')
    const { makePluginKernelFacade } = await import('../../../app/src/main/plugin-host.ts')

    const tree = createTempTree('mathspace-edit')
    try {
      const seed = tree.bridge.submitAs({ kind: 'human', id: 'user.test' }, 'A moving note', [{
        op: 'createNode',
        type: 'tapestry.notes/note@1',
        props: {
          'position.x': { type: 'real', value: 0 },
          'position.y': { type: 'real', value: 0 },
          'velocity.x': { type: 'real', value: 1 },
        },
      }])
      const noteId = seed.nodeIds[0]
      const kernel = makePluginKernelFacade('mathspace', () => tree.bridge)
      const runner = new Runner({ loadModule, log: () => {}, setInterval: () => ({}), clearInterval: () => {} })
      await runner.start(kernel)
      for (let i = 0; i < 30; i++) runner.tick()
      // A drag lands while the engine is mid-batch.
      tree.bridge.submitAs({ kind: 'human', id: 'user.test' }, 'Drag', [
        { op: 'setProperty', target: noteId, key: 'position.x', type: 'real', value: 500 },
      ])
      for (let i = 0; i < 30; i++) runner.tick()
      await runner.flushing // sees the foreign seq, rebuilds from x=500, commits nothing
      for (let i = 0; i < 60; i++) runner.tick()
      await runner.pause(kernel)
      runner.dispose()

      const lines = readFileSync(tree.path, 'utf8').split('\n')
      expect(lines).toContain(`set ${noteId} position.x real 500`)
      expect(lines).toContain(`set ${noteId} position.x real 560`)
      expect(lines.some((l) => l === `set ${noteId} position.x real 60`)).toBe(false)
      expect(tree.bridge.getNode(noteId).props['position.x'].value).toBe(560)
    } finally {
      tree.cleanup()
    }
  })
})
