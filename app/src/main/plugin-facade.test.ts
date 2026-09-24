/**
 * Plugins are signed as themselves and can never write as a human (D-06).
 *
 * The facade is the only kernel surface a plugin is handed. These tests read
 * the `.tree` file as text, because the question is not what the facade
 * returned but what ended up in the journal a person will later read.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { makePluginKernelFacade } from './plugin-host'
import { createTempTree } from '../../test/helpers/temp-tree'

/** A minimal note-creating op batch. */
function createNoteOps(): Array<Record<string, unknown>> {
  return [
    {
      op: 'createNode',
      type: 'tapestry.notes/note@1',
      props: {
        'position.x': { type: 'real', value: 0 },
        'position.y': { type: 'real', value: 0 },
        body: { type: 'text', value: '' },
        title: { type: 'text', value: '' },
      },
    },
  ]
}

function actorLines(treePath: string): string[] {
  return readFileSync(treePath, 'utf-8')
    .split('\n')
    .filter((line) => line.startsWith('actor '))
}

describe('makePluginKernelFacade', () => {
  it('records the plugin id whatever actor pair the plugin passes', () => {
    const tree = createTempTree('facade')
    try {
      const facade = makePluginKernelFacade('example-plugin', () => tree.bridge)

      facade.submit('plugin', 'whatever', 'Plugin note', createNoteOps())

      expect(actorLines(tree.path)).toContain('actor plugin example-plugin')
      expect(actorLines(tree.path)).not.toContain('actor plugin whatever')
    } finally {
      tree.cleanup()
    }
  })

  it('refuses kind human and writes nothing', () => {
    const tree = createTempTree('facade-human')
    try {
      const facade = makePluginKernelFacade('example-plugin', () => tree.bridge)
      const seqBefore = tree.bridge.status().lastGoodSeq

      expect(() =>
        facade.submit('human', 'user.kaelen', 'Impersonated note', createNoteOps()),
      ).toThrow('Plugins cannot commit as human or system')

      expect(tree.bridge.status().lastGoodSeq).toBe(seqBefore)
      expect(actorLines(tree.path)).not.toContain('actor human user.kaelen')
    } finally {
      tree.cleanup()
    }
  })

  it('refuses kind system and writes nothing', () => {
    const tree = createTempTree('facade-system')
    try {
      const facade = makePluginKernelFacade('example-plugin', () => tree.bridge)
      const seqBefore = tree.bridge.status().lastGoodSeq

      expect(() =>
        facade.submit('system', 'tapestry', 'Host-looking note', createNoteOps()),
      ).toThrow('Plugins cannot commit as human or system')

      expect(tree.bridge.status().lastGoodSeq).toBe(seqBefore)
      expect(actorLines(tree.path)).not.toContain('actor system tapestry')
    } finally {
      tree.cleanup()
    }
  })

  it('refuses a plugin id in a reserved namespace', () => {
    const tree = createTempTree('facade-reserved')
    try {
      const facade = makePluginKernelFacade('agent.claude', () => tree.bridge)

      expect(() => facade.submit('plugin', 'agent.claude', 'Fake agent note', createNoteOps()))
        .toThrow('Reserved plugin id: agent.claude')

      expect(actorLines(tree.path)).not.toContain('actor plugin agent.claude')
    } finally {
      tree.cleanup()
    }
  })

  it('delegates reads to the bound bridge', () => {
    const tree = createTempTree('facade-reads')
    try {
      const facade = makePluginKernelFacade('example-plugin', () => tree.bridge)
      const result = facade.submit('plugin', 'ignored', 'Plugin note', createNoteOps())
      const nodeId = result.nodeIds[0]

      expect(facade.getNodes()).toHaveLength(1)
      expect(facade.getNode(nodeId)?.id).toBe(nodeId)
      expect(facade.getEdges()).toEqual([])
      expect(facade.status().kind).toBe('Ok')
    } finally {
      tree.cleanup()
    }
  })
})
