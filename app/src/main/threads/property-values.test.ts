/**
 * Reading every past `thread.log` value back through the bridge (D-06).
 *
 * Runs against the real native addon in a temp world: the question is
 * whether the addon's own scan over `Journal::commits()` reports what
 * actually landed there, not what a mock says it would.
 */

import { describe, expect, it } from 'vitest'
import { humanActor } from '../commands/actor'
import { createTempTree } from '../../../test/helpers/temp-tree'
import { getPropertyValues } from './property-values'

function createThreadOps(): Array<Record<string, unknown>> {
  return [
    {
      op: 'createNode',
      type: 'tapestry.threads/thread@1',
      props: {
        body: { type: 'text', value: '' },
        title: { type: 'text', value: '' },
      },
    },
  ]
}

function setLogOps(nodeId: string, block: string): Array<Record<string, unknown>> {
  return [{ op: 'setProperty', target: nodeId, key: 'thread.log', type: 'text', value: block }]
}

describe('getPropertyValues', () => {
  it('returns nothing for a node that never set the key', () => {
    const tree = createTempTree('property-values-empty')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps() as any)
      expect(tree.bridge.getPropertyValues('n1', 'thread.log')).toEqual([])
    } finally {
      tree.cleanup()
    }
  })

  it('returns every thread.log batch in commit order, with seq and actor', () => {
    const tree = createTempTree('property-values-order')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps() as any)
      tree.bridge.submitAs(
        humanActor('kaelen'),
        'Batch 1',
        setLogOps('n1', 'thread 1 v0\nat 2026-09-15T21:04:10.250Z\n+0.000 ins 1 "H"') as any,
      )
      tree.bridge.submitAs(
        humanActor('kaelen'),
        'Batch 2',
        setLogOps('n1', 'thread 1 v1\nat 2026-09-15T21:04:11.000Z\n+0.000 ins 2 "i"') as any,
      )

      const values = getPropertyValues(tree.bridge, 'n1', 'thread.log')
      expect(values).toHaveLength(2)
      expect(values[0].seq).toBe(2)
      expect(values[0].actor).toEqual({ kind: 'human', id: 'user.kaelen' })
      expect(values[0].value.value).toContain('v0')
      expect(values[1].seq).toBe(3)
      expect(values[1].value.value).toContain('v1')
    } finally {
      tree.cleanup()
    }
  })

  it('fromSeq excludes commits at or before it', () => {
    const tree = createTempTree('property-values-fromseq')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps() as any)
      tree.bridge.submitAs(humanActor('kaelen'), 'Batch 1', setLogOps('n1', 'first') as any)
      tree.bridge.submitAs(humanActor('kaelen'), 'Batch 2', setLogOps('n1', 'second') as any)

      const all = getPropertyValues(tree.bridge, 'n1', 'thread.log')
      expect(all).toHaveLength(2)

      const afterFirst = getPropertyValues(tree.bridge, 'n1', 'thread.log', all[0].seq)
      expect(afterFirst).toHaveLength(1)
      expect(afterFirst[0].value.value).toBe('second')
    } finally {
      tree.cleanup()
    }
  })

  it('throws on a malformed node id rather than reading the wrong node', () => {
    const tree = createTempTree('property-values-badid')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps() as any)
      expect(() => tree.bridge.getPropertyValues('not-a-node-id', 'thread.log')).toThrow()
    } finally {
      tree.cleanup()
    }
  })
})
