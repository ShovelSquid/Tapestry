/**
 * ThreadService: the single write authority for one open thread (D-06).
 *
 * Runs against the real native addon in a temp world -- the question this
 * plan cares about is whether a real `.tree` file ends up with a readable
 * `thread.log` block, not whether a mock says it would.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { Fragment, Slice } from 'prosemirror-model'
import { ReplaceStep } from 'prosemirror-transform'
import { tapestrySchema } from '../../renderer/editor/schema'
import { humanActor } from '../commands/actor'
import { createTempTree, type TempTree } from '../../../test/helpers/temp-tree'
import { ThreadService } from './thread-service'

const THREAD_TYPE = 'tapestry.threads/thread@1'

function createThreadOps(): Array<Record<string, unknown>> {
  return [
    {
      op: 'createNode',
      type: THREAD_TYPE,
      props: {
        body: { type: 'text', value: '' },
        title: { type: 'text', value: '' },
      },
    },
  ]
}

/** A single-character insertion step, as the renderer's collab plugin would
 * serialize it (`Step.toJSON()`), targeting an empty document's paragraph. */
function insertCharStepJson(pos: number, char: string): unknown {
  const step = new ReplaceStep(pos, pos, new Slice(Fragment.from(tapestrySchema.text(char)), 0, 0))
  return step.toJSON()
}

function commitCount(treePath: string): number {
  return readFileSync(treePath, 'utf-8')
    .split('\n')
    .filter((line) => line.startsWith('@commit ')).length
}

function threadLogBlocks(treePath: string): string {
  return readFileSync(treePath, 'utf-8')
}

describe('ThreadService', () => {
  let tree: TempTree

  beforeEach(() => {
    tree = createTempTree('thread-service')
  })

  afterEach(() => {
    tree.cleanup()
    vi.useRealTimers()
  })

  it('typing one letter, closing and reopening shows it back, read from thread.log alone', () => {
    tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps() as any)

    const service = new ThreadService()
    const actor = humanActor('kaelen')

    const opened = service.open(tree.bridge, actor, 'irrelevant-tree-id', 'n1')
    expect(opened.version).toBe(0)
    expect(opened.totalChanges).toBe(0)

    const result = service.push('irrelevant-tree-id', 'n1', actor, 0, [insertCharStepJson(1, 'H')], [1000], [null])
    expect(result).toEqual({ confirmed: true, version: 1 })

    service.close('irrelevant-tree-id', 'n1')

    // The letter is on disk, readable, before Tapestry ever reads it back.
    const fileText = threadLogBlocks(tree.path)
    expect(fileText).toContain('thread.log')
    expect(fileText).toMatch(/ins 1 "H"/)

    // Reopen: a fresh service, replaying purely from thread.log.
    const reopened = new ThreadService()
    const afterReopen = reopened.open(tree.bridge, actor, 'irrelevant-tree-id', 'n1')
    expect(afterReopen.totalChanges).toBeGreaterThan(0)
    const doc = tapestrySchema.nodeFromJSON(afterReopen.doc as any)
    expect(doc.textContent).toBe('H')
  })

  it('rejects a step application failure without committing anything', () => {
    tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps() as any)
    const service = new ThreadService()
    const actor = humanActor('kaelen')
    service.open(tree.bridge, actor, 'tree', 'n1')

    const before = commitCount(tree.path)
    // Position 999 does not exist in an empty single-paragraph doc.
    const badStep = insertCharStepJson(999, 'x')
    const result = service.push('tree', 'n1', actor, 0, [badStep], [0], [null])
    expect(result.confirmed).toBe(false)
    expect((result as { rejected?: boolean }).rejected).toBe(true)

    // Nothing committed: the journal's last seq is unchanged.
    expect(commitCount(tree.path)).toBe(before)
  })

  it('flushes on idle 300ms OR max-wait ~1s, so continuous typing still commits (Pitfall 1)', () => {
    tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps() as any)
    vi.useFakeTimers()

    const service = new ThreadService()
    const actor = humanActor('kaelen')
    service.open(tree.bridge, actor, 'tree', 'n1')

    const before = commitCount(tree.path)

    let version = 0
    let now = 0
    // A step every 100ms for 5s: continuous typing never lets the 300ms idle
    // timer fire, so only the ~1s max-wait can be producing commits.
    for (let i = 0; i < 50; i++) {
      now += 100
      const step = insertCharStepJson(1, 'a')
      const result = service.push('tree', 'n1', actor, version, [step], [now], [null])
      expect(result.confirmed).toBe(true)
      version = (result as { version: number }).version
      vi.advanceTimersByTime(100)
    }
    // Let the final max-wait timer (if any) fire.
    vi.advanceTimersByTime(1000)

    const after = commitCount(tree.path)
    expect(after - before).toBeGreaterThanOrEqual(4)
  })
})
