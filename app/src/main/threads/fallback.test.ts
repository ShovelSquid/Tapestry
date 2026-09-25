/**
 * A thread stays readable with the plugin off, and honest when its history
 * cannot be parsed (PLUG-04, D-33/D-35, T-02.3-03-01).
 *
 * Runs against the real native addon in a temp world, like property-values
 * and thread-service's own tests: the question is whether the ordinary
 * `getNodes` path already carries a thread's checkpoint text with no
 * thread-specific code running at all (the "plugin disabled" case has no
 * plugin code involved by construction), and whether `ThreadService.open`
 * degrades gracefully rather than throwing when `thread.log` cannot be
 * parsed.
 */

import { describe, expect, it } from 'vitest'
import { humanActor } from '../commands/actor'
import { createTempTree } from '../../../test/helpers/temp-tree'
import { ThreadService } from './thread-service'

function createThreadOps(body: string): Array<Record<string, unknown>> {
  return [
    {
      op: 'createNode',
      type: 'tapestry.threads/thread@1',
      props: {
        body: { type: 'text', value: body },
        title: { type: 'text', value: '' },
      },
    },
  ]
}

function setLogOps(nodeId: string, block: string): Array<Record<string, unknown>> {
  return [{ op: 'setProperty', target: nodeId, key: 'thread.log', type: 'text', value: block }]
}

describe('a thread with no plugin registered', () => {
  it("is still retrievable through the ordinary getNodes property path (no thread-specific code runs at all)", () => {
    const tree = createTempTree('fallback-no-plugin')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps('') as any)
      tree.bridge.submitAs(
        humanActor('kaelen'),
        'Thread batch',
        setLogOps('n1', 'thread 1 v0\nat 2026-09-15T21:04:10.250Z\n+0.000 ins 1 "H"\n+0.100 ins 2 "i"') as any,
      )
      tree.bridge.submitAs(
        humanActor('kaelen'),
        'Thread checkpoint',
        [{ op: 'setProperty', target: 'n1', key: 'body', type: 'text', value: 'Hi' }] as any,
      )

      // The generic node-listing path FallbackNodeView renders through --
      // no ThreadService, no plugin, no thread-specific IPC at all.
      const nodes = tree.bridge.getNodes()
      const thread = nodes.find((n) => n.id === 'n1')
      expect(thread).toBeDefined()
      expect(thread!.type).toBe('tapestry.threads/thread@1')
      expect(thread!.props.body.value).toBe('Hi')
      // The last thread.log value is still on the node too (readable raw
      // record text, per 02.3-PATTERNS.md's "Readable fallback" pattern).
      expect(String(thread!.props['thread.log'].value)).toContain('ins 1 "H"')
    } finally {
      tree.cleanup()
    }
  })
})

describe('ThreadService.open with a corrupted thread.log value', () => {
  it('returns a parse rejection (unreadable: true) rather than throwing, falling back to the last checkpoint', () => {
    const tree = createTempTree('fallback-corrupt')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps('Hi') as any)
      tree.bridge.submitAs(
        humanActor('kaelen'),
        'Thread batch',
        // Not a valid thread.log block at all: no "thread <version> v<n>"
        // header line, so parseBlockHeader must throw when this is parsed.
        setLogOps('n1', 'this is not a thread.log block') as any,
      )

      const service = new ThreadService()
      let result: ReturnType<ThreadService['open']> | undefined
      expect(() => {
        result = service.open(tree.bridge, humanActor('kaelen'), 'tree-1', 'n1')
      }).not.toThrow()

      expect(result!.unreadable).toBe(true)
      expect(result!.unreadableReason).toBeTruthy()
      // The fallback document is the last body checkpoint, not a half-read
      // thread.log -- nothing about the corrupted value leaks into what a
      // reader sees.
      expect(JSON.stringify(result!.doc)).toContain('Hi')
    } finally {
      tree.cleanup()
    }
  })

  it('does not register a write handle for an unreadable thread, so a push refuses rather than building on it', () => {
    const tree = createTempTree('fallback-corrupt-push')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps('Hi') as any)
      tree.bridge.submitAs(humanActor('kaelen'), 'Thread batch', setLogOps('n1', 'garbage') as any)

      const service = new ThreadService()
      service.open(tree.bridge, humanActor('kaelen'), 'tree-1', 'n1')

      expect(() => service.push('tree-1', 'n1', humanActor('kaelen'), 0, [], [], [])).toThrow(/Thread not open/)
    } finally {
      tree.cleanup()
    }
  })
})
