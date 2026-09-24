import { describe, expect, it } from 'vitest'
import { KernelBridge, type OpObject } from '../kernel-bridge'
import { humanActor } from '../commands/actor'
import { WORKSPACE_REPLAY_REFUSAL, WORKSPACE_SUBMIT_REFUSAL, workspaceSubmitRefusal } from './guards'

const set = (key: string): OpObject => ({ op: 'setProperty', target: 'n1', key, type: 'real', value: 1 })
const unset = (key: string): OpObject => ({ op: 'unsetProperty', target: 'n1', key })

describe('workspaceSubmitRefusal', () => {
  it('refuses creating and deleting notes', () => {
    expect(workspaceSubmitRefusal([{ op: 'createNode', type: 'tapestry.notes/note@1', props: {} }])).toBe(
      WORKSPACE_SUBMIT_REFUSAL,
    )
    expect(workspaceSubmitRefusal([{ op: 'deleteNode', id: 'n1' }])).toBe(WORKSPACE_SUBMIT_REFUSAL)
  })

  it('refuses setting or unsetting any file.* key', () => {
    for (const key of ['file.text', 'file.path', 'file.sha256', 'file.anything']) {
      expect(workspaceSubmitRefusal([set(key)]), key).toBe(WORKSPACE_SUBMIT_REFUSAL)
      expect(workspaceSubmitRefusal([unset(key)]), key).toBe(WORKSPACE_SUBMIT_REFUSAL)
    }
  })

  it('refuses a property op without a string key', () => {
    expect(workspaceSubmitRefusal([{ op: 'setProperty', target: 'n1', key: 3 }])).toBe(WORKSPACE_SUBMIT_REFUSAL)
  })

  it('allows moving, resizing, pinning, collapsing and connecting', () => {
    const allowed: OpObject[] = [
      set('position.x'),
      set('position.y'),
      set('width'),
      set('height'),
      set('pinned'),
      set('collapsed'),
      unset('pinned'),
      { op: 'createEdge', from: 'n1', to: 'n2', label: '' },
      { op: 'deleteEdge', id: 'e1' },
    ]
    expect(workspaceSubmitRefusal(allowed)).toBeNull()
    expect(workspaceSubmitRefusal([])).toBeNull()
  })

  it('refuses a batch when any one op is refused', () => {
    expect(workspaceSubmitRefusal([set('position.x'), set('file.text')])).toBe(WORKSPACE_SUBMIT_REFUSAL)
  })

  it('names git for undo', () => {
    expect(WORKSPACE_REPLAY_REFUSAL).toContain('Use git')
  })
})

describe('registerHandlers guards', () => {
  type Handler = (...args: unknown[]) => unknown
  function wire(guards?: Parameters<typeof KernelBridge.registerHandlers>[3]): {
    handlers: Map<string, Handler>
    calls: string[]
  } {
    const handlers = new Map<string, Handler>()
    const calls: string[] = []
    const fake = {
      submitAs: () => {
        calls.push('submit')
        return { seq: 1, digest: '', nodeIds: [], edgeIds: [] }
      },
      undo: () => {
        calls.push('undo')
        return true
      },
      redo: () => {
        calls.push('redo')
        return true
      },
    } as unknown as KernelBridge
    KernelBridge.registerHandlers(
      { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
      () => fake,
      () => humanActor('kaelen'),
      guards,
    )
    return { handlers, calls }
  }

  it('without guards, submit, undo and redo reach the kernel', () => {
    const { handlers, calls } = wire()
    handlers.get('kernel:submit')!({}, 'w1', 'Create note', [{ op: 'createNode' }])
    expect(handlers.get('kernel:undo')!({}, 'w1')).toEqual({ ok: true })
    expect(handlers.get('kernel:redo')!({}, 'w1')).toEqual({ ok: true })
    expect(calls).toEqual(['submit', 'undo', 'redo'])
  })

  it('a refusal throws before the kernel sees anything', () => {
    const { handlers, calls } = wire({
      beforeSubmit: (treeId, ops) => (treeId === 'ws' ? workspaceSubmitRefusal(ops) : null),
      beforeReplay: (treeId) => (treeId === 'ws' ? WORKSPACE_REPLAY_REFUSAL : null),
    })
    expect(() => handlers.get('kernel:submit')!({}, 'ws', 'Create note', [{ op: 'createNode' }])).toThrow(
      WORKSPACE_SUBMIT_REFUSAL,
    )
    expect(() => handlers.get('kernel:undo')!({}, 'ws')).toThrow(WORKSPACE_REPLAY_REFUSAL)
    expect(() => handlers.get('kernel:redo')!({}, 'ws')).toThrow(WORKSPACE_REPLAY_REFUSAL)
    expect(calls).toEqual([])

    // A move in the workspace, and anything in another tree, still commits.
    handlers.get('kernel:submit')!({}, 'ws', 'Move', [set('position.x')])
    handlers.get('kernel:submit')!({}, 'native', 'Create note', [{ op: 'createNode' }])
    handlers.get('kernel:undo')!({}, 'native')
    expect(calls).toEqual(['submit', 'submit', 'undo'])
  })
})
