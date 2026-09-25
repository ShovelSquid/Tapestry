/**
 * Actor stamping: the host decides who a change is signed by.
 *
 * The integration tests here run against the real native addon and read the
 * resulting `.tree` file as text, because the `actor` line is the artifact
 * that matters — a mocked bridge would prove nothing about what gets written.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { rmSync } from 'fs'
import {
  ACTOR_NAME_RE,
  agentActor,
  assertPluginSubmitKind,
  humanActor,
  isValidActorName,
  OBSIDIAN_BRIDGE_ACTOR,
  WORKSPACE_WATCHER_ACTOR,
  pluginActor,
  SYSTEM_ACTOR,
} from './actor'
import { KernelBridge } from '../kernel-bridge'
import { createTempTree, makeTempDir } from '../../../test/helpers/temp-tree'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Records the handlers KernelBridge.registerHandlers installs. */
function makeFakeIpcMain(): {
  handle(channel: string, fn: (...args: any[]) => any): void
  invoke(channel: string, ...args: any[]): any
} {
  const handlers = new Map<string, (...args: any[]) => any>()
  return {
    handle(channel, fn) {
      handlers.set(channel, fn)
    },
    invoke(channel, ...args) {
      const fn = handlers.get(channel)
      if (!fn) throw new Error(`No handler registered for ${channel}`)
      return fn(null, ...args)
    },
  }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('actor names', () => {
  it('accepts lowercase names and rejects anything else', () => {
    expect(ACTOR_NAME_RE.test('kaelen')).toBe(true)
    expect(isValidActorName('kaelen')).toBe(true)
    expect(isValidActorName('a-b_9')).toBe(true)
    expect(isValidActorName('Kaelen')).toBe(false)
    expect(isValidActorName('kaelen cook')).toBe(false)
    expect(isValidActorName('')).toBe(false)
    expect(isValidActorName('-leading')).toBe(false)
    expect(isValidActorName('x'.repeat(33))).toBe(false)
    expect(isValidActorName(undefined)).toBe(false)
  })
})

describe('humanActor', () => {
  it('signs as user.<name> (D-07)', () => {
    expect(humanActor('kaelen')).toEqual({ kind: 'human', id: 'user.kaelen' })
  })

  it('refuses a name that would break the actor line', () => {
    expect(() => humanActor('Kaelen Cook')).toThrow(
      'User name must match ^[a-z0-9][a-z0-9_-]{0,31}$',
    )
  })
})

describe('agentActor', () => {
  it('signs as plugin agent.<name> (D-06)', () => {
    expect(agentActor('claude')).toEqual({ kind: 'plugin', id: 'agent.claude' })
  })

  it('refuses an invalid agent name', () => {
    expect(() => agentActor('Claude Code')).toThrow()
  })
})

describe('pluginActor', () => {
  it('refuses reserved namespaces a plugin could impersonate', () => {
    expect(() => pluginActor('agent.evil')).toThrow('Reserved plugin id: agent.evil')
    expect(() => pluginActor('user.x')).toThrow('Reserved plugin id: user.x')
    expect(() => pluginActor('obsidian.bridge')).toThrow('Reserved plugin id: obsidian.bridge')
    expect(() => pluginActor('tapestry')).toThrow('Reserved plugin id: tapestry')
  })

  it('accepts the plugin ids that already exist on disk', () => {
    expect(pluginActor('tapestry-notes')).toEqual({ kind: 'plugin', id: 'tapestry-notes' })
    expect(pluginActor('example-plugin')).toEqual({ kind: 'plugin', id: 'example-plugin' })
  })
})

describe('assertPluginSubmitKind', () => {
  it('throws for human and system, passes for plugin', () => {
    expect(() => assertPluginSubmitKind('human')).toThrow(
      'Plugins cannot commit as human or system',
    )
    expect(() => assertPluginSubmitKind('system')).toThrow(
      'Plugins cannot commit as human or system',
    )
    expect(() => assertPluginSubmitKind('plugin')).not.toThrow()
  })
})

describe('fixed actors', () => {
  it('names the bridge and the host', () => {
    expect(OBSIDIAN_BRIDGE_ACTOR).toEqual({ kind: 'plugin', id: 'obsidian.bridge' })
    expect(SYSTEM_ACTOR).toEqual({ kind: 'system', id: 'tapestry' })
  })
})

// ---------------------------------------------------------------------------
// Integration: the IPC handler writes the host's actor, not the caller's
// ---------------------------------------------------------------------------

describe('kernel:submit handler', () => {
  it('writes `actor human user.kaelen` for a renderer commit', () => {
    const dir = makeTempDir('actor')
    const treePath = join(dir, 'actor.tree')
    const ipc = makeFakeIpcMain()
    // index.ts owns trees:create/trees:open now (it validates the path and
    // updates the tree registry), so the test opens the world itself and hands
    // registerHandlers a resolver for the one tree the renderer acts on.
    const bridge = new KernelBridge()
    bridge.create(treePath, 'actor')
    const treeId = bridge.getHeaderDigest()
    KernelBridge.registerHandlers(
      ipc as any,
      (id) => {
        // Every channel names its tree first (D-15); an id that is not open is
        // refused rather than falling back to "whichever world is loaded".
        if (id !== treeId) throw new Error(`Unknown tree ${String(id)}`)
        return bridge
      },
      () => humanActor('kaelen'),
    )

    try {
      ipc.invoke('kernel:submit', treeId, 'Create note', createNoteOps())

      const lines = readFileSync(treePath, 'utf-8').split('\n')
      expect(lines).toContain('actor human user.kaelen')
    } finally {
      bridge.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses calls that do not name a tree first', () => {
    const dir = makeTempDir('actor-legacy')
    const treePath = join(dir, 'legacy.tree')
    const ipc = makeFakeIpcMain()
    const bridge = new KernelBridge()
    bridge.create(treePath, 'legacy')
    const treeId = bridge.getHeaderDigest()
    KernelBridge.registerHandlers(
      ipc as any,
      (id) => {
        if (id !== treeId) throw new Error(`Unknown tree ${String(id)}`)
        return bridge
      },
      () => humanActor('kaelen'),
    )

    try {
      // The pre-D-15 shape (message, ops). Reinterpreting it would treat the
      // message as a tree id and land the commit in the wrong journal, so it
      // has to fail here rather than be guessed at.
      expect(() => ipc.invoke('kernel:submit', 'Create note', createNoteOps())).toThrow(
        'kernel:submit expects',
      )

      // The original four-argument shape, in which the caller named its own
      // actor — still refused, so a renderer cannot sign as anyone (D-06).
      expect(() =>
        ipc.invoke('kernel:submit', 'human', 'local', 'Create note', createNoteOps()),
      ).toThrow('kernel:submit expects')

      // A refusal writes nothing: the world is untouched by either attempt.
      expect(bridge.getNodes()).toEqual([])
    } finally {
      bridge.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Old history stays valid (D-07: `local` lines remain readable)
// ---------------------------------------------------------------------------

describe('worlds written before D-07', () => {
  it('reopens a world containing `actor human local` with status Ok', () => {
    const tree = createTempTree('legacy')

    try {
      tree.bridge.submit('human', 'local', 'Old note', createNoteOps() as any)
      expect(readFileSync(tree.path, 'utf-8').split('\n')).toContain('actor human local')
      tree.bridge.close()

      const reopened = new KernelBridge()
      reopened.open(tree.path)
      try {
        expect(reopened.status().kind).toBe('Ok')
        expect(reopened.getNodes().length).toBe(1)
      } finally {
        reopened.close()
      }
    } finally {
      tree.cleanup()
    }
  })
})

describe('WORKSPACE_WATCHER_ACTOR (02.7 D-06)', () => {
  it('is plugin workspace.watcher, and plugins may not claim it', () => {
    expect(WORKSPACE_WATCHER_ACTOR).toEqual({ kind: 'plugin', id: 'workspace.watcher' })
    expect(Object.isFrozen(WORKSPACE_WATCHER_ACTOR)).toBe(true)
    expect(() => pluginActor('workspace.watcher')).toThrow('Reserved plugin id: workspace.watcher')
  })
})
