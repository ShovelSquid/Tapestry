/**
 * Provenance read back through the bridge: who made a note, who changed it
 * last, and what those answers become when history is rewound.
 *
 * These run against the real native addon in a temp world. A mocked bridge
 * would prove nothing here — the whole point is that the answers come from
 * actor lines the kernel actually wrote into a `.tree` file.
 */

import { describe, expect, it } from 'vitest'
import { KernelBridge } from './kernel-bridge'
import { agentActor, humanActor } from './commands/actor'
import { createTempTree } from '../../test/helpers/temp-tree'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function setBodyOps(nodeId: string, body: string): Array<Record<string, unknown>> {
  return [{ op: 'setProperty', target: nodeId, key: 'body', type: 'text', value: body }]
}

// ---------------------------------------------------------------------------
// Authorship
// ---------------------------------------------------------------------------

describe('getHistoryIndex', () => {
  it('reports the creator and the last changer separately', () => {
    const tree = createTempTree('history')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create note', createNoteOps() as any)
      tree.bridge.submitAs(agentActor('claude'), 'Update note text', setBodyOps('n1', 'grown') as any)

      const index = tree.bridge.getHistoryIndex()
      expect(index.nodes.n1.createdBy.id).toBe('user.kaelen')
      expect(index.nodes.n1.createdBy.kind).toBe('human')
      expect(index.nodes.n1.changedBy.id).toBe('agent.claude')
      expect(index.nodes.n1.changedBy.kind).toBe('plugin')
      // Live node: no deletion recorded.
      expect(index.nodes.n1.deletedSeq).toBeNull()
      expect(index.nodes.n1.deletedBy).toBeNull()
    } finally {
      tree.cleanup()
    }
  })

  it('does not attribute a change the rewound view cannot show', () => {
    const tree = createTempTree('history-undo')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create note', createNoteOps() as any)
      tree.bridge.submitAs(agentActor('claude'), 'Update note text', setBodyOps('n1', 'grown') as any)
      expect(tree.bridge.getHistoryIndex().nodes.n1.changedBy.id).toBe('agent.claude')

      expect(tree.bridge.undo()).toBe(true)

      // The agent's commit is no longer part of the displayed history, so the
      // person who made the note is once again its last changer.
      expect(tree.bridge.getHistoryIndex().nodes.n1.changedBy.id).toBe('user.kaelen')
    } finally {
      tree.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Tree identity
// ---------------------------------------------------------------------------

describe('getHeaderDigest', () => {
  it('is a sha256 digest that survives close and reopen', () => {
    const tree = createTempTree('digest')
    try {
      const digest = tree.bridge.getHeaderDigest()
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/)

      tree.bridge.submitAs(humanActor('kaelen'), 'Create note', createNoteOps() as any)
      // Committing does not change the world's identity.
      expect(tree.bridge.getHeaderDigest()).toBe(digest)

      tree.bridge.close()
      const reopened = new KernelBridge()
      reopened.open(tree.path)
      try {
        expect(reopened.getHeaderDigest()).toBe(digest)
      } finally {
        reopened.close()
      }
    } finally {
      tree.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Id prediction (D-04: a note and its connection in one commit)
// ---------------------------------------------------------------------------

describe('getNextIds', () => {
  it('names the ids the next creations will receive', () => {
    const tree = createTempTree('next-ids')
    try {
      expect(tree.bridge.getNextIds()).toEqual({ node: 'n1', edge: 'e1' })

      tree.bridge.submitAs(humanActor('kaelen'), 'Create note', createNoteOps() as any)
      expect(tree.bridge.getNextIds()).toEqual({ node: 'n2', edge: 'e1' })
    } finally {
      tree.cleanup()
    }
  })

  it('refuses to predict while history is rewound', () => {
    const tree = createTempTree('next-ids-undo')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create note', createNoteOps() as any)
      expect(tree.bridge.isRewound).toBe(false)

      expect(tree.bridge.undo()).toBe(true)
      expect(tree.bridge.isRewound).toBe(true)
      expect(() => tree.bridge.getNextIds()).toThrow('Cannot predict ids while history is rewound')
    } finally {
      tree.cleanup()
    }
  })
})
