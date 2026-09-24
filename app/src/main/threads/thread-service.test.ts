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
import { formatBlock, parseBlockHeader, parseBlock } from '../../shared/threads/grammar'
import { ThreadService } from './thread-service'

const THREAD_TYPE = 'tapestry.threads/thread@1'

function createThreadOps(timeoutSeconds?: number): Array<Record<string, unknown>> {
  const props: Record<string, unknown> = {
    body: { type: 'text', value: '' },
    title: { type: 'text', value: '' },
  }
  if (timeoutSeconds !== undefined) {
    props['thread.timeout'] = { type: 'real', value: timeoutSeconds }
  }
  return [
    {
      op: 'createNode',
      type: THREAD_TYPE,
      props,
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

/** Every absolute moment (`anchorMs + offsetMs`) an `out` record was written
 * at, across every `thread.log` commit -- the concrete fact T-02.3-06-02's
 * pin test checks a settings change never moves. */
function outMoments(bridge: TempTree['bridge'], nodeId: string): number[] {
  const moments: number[] = []
  for (const entry of bridge.getPropertyValues(nodeId, 'thread.log')) {
    const block = String(entry.value.value)
    const header = parseBlockHeader(block)
    for (const record of parseBlock(block)) {
      if (record.verb === 'out') moments.push(header.anchorMs + record.offsetMs)
    }
  }
  return moments
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

  it('writes an out record at the moment the time-out is detected, with no further push needed, and the next keystroke opens the next session (D-07/D-10)', () => {
    tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps(5) as any) // 5s timeout, to keep the test fast
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const service = new ThreadService()
    const actor = humanActor('kaelen')
    service.open(tree.bridge, actor, 'tree', 'n1')

    const first = service.push('tree', 'n1', actor, 0, [insertCharStepJson(1, 'a')], [0], [null])
    expect(first.confirmed).toBe(true)
    vi.advanceTimersByTime(1000) // idle/max-wait flushes the 'in' + 'ins' batch

    let text = threadLogBlocks(tree.path)
    expect(text).toMatch(/in 1/)
    expect(text).not.toMatch(/\bout\b/)

    // No further push at all -- the time-out timer itself is the trigger.
    vi.advanceTimersByTime(5000)

    text = threadLogBlocks(tree.path)
    expect(text).toMatch(/\bout\b/)
    expect(outMoments(tree.bridge, 'n1')).toEqual([5000])

    // The next keystroke opens session 2, not a continuation of session 1.
    const second = service.push(
      'tree',
      'n1',
      actor,
      (first as { version: number }).version,
      [insertCharStepJson(2, 'b')],
      [7000],
      [null],
    )
    expect(second.confirmed).toBe(true)
    vi.advanceTimersByTime(1000)

    text = threadLogBlocks(tree.path)
    expect(text).toMatch(/in 2/)
  })

  it('a settings change from 150 to 600 never moves an out record already written (T-02.3-06-02)', () => {
    tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps(150) as any)
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const service = new ThreadService()
    const actor = humanActor('kaelen')
    service.open(tree.bridge, actor, 'tree', 'n1')

    service.push('tree', 'n1', actor, 0, [insertCharStepJson(1, 'a')], [0], [null])
    vi.advanceTimersByTime(1000) // flush the 'in' + 'ins'
    vi.advanceTimersByTime(150_000) // the time-out timer detects and writes 'out'

    const before = outMoments(tree.bridge, 'n1')
    expect(before).toEqual([150_000])
    const commitsBefore = commitCount(tree.path)

    // Kaelen changes the per-thread setting after the fact -- an ordinary
    // recorded edit to `thread.timeout`, nothing to do with `thread.log`.
    tree.bridge.submitAs(actor, 'Change thread settings', [
      { op: 'setProperty', target: 'n1', key: 'thread.timeout', type: 'real', value: 600 },
    ] as any)

    expect(commitCount(tree.path)).toBe(commitsBefore + 1) // one commit: the setting, not thread.log
    expect(outMoments(tree.bridge, 'n1')).toEqual(before) // the past dash has not moved

    // A fresh reopen still derives the identical session boundary from the
    // unmoved thread.log records alone -- deriveSessions has no
    // timeoutSeconds parameter to have read the new 600 from in the first
    // place (sessions.ts's own pinning test proves the same invariant at
    // the unit level).
    const reopened = new ThreadService()
    const result = reopened.open(tree.bridge, actor, 'tree', 'n1')
    expect(result.totalChanges).toBe(2) // the 'in'+'ins' batch, then the 'out'
  })

  it('a missing out after a simulated crash is derived by the reader and written on the next write (D-06)', () => {
    tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps(150) as any)
    const actor = humanActor('kaelen')

    // Simulate a crash: a real thread.log commit with an `in` and one `ins`
    // but no `out` -- ThreadService never got the chance to write it.
    const crashBlock = formatBlock(
      [
        { verb: 'in', offsetMs: 0, session: 1 },
        { verb: 'ins', offsetMs: 0, cause: null, pos: 1, text: 'x', marks: [] },
      ],
      0,
      0,
    )
    tree.bridge.submitAs(actor, 'Simulated crash write', [
      { op: 'setProperty', target: 'n1', key: 'thread.log', type: 'text', value: crashBlock },
    ] as any)

    // "Now" is long after the crash -- well past the 150s timeout, so this
    // is unambiguously a crash, never a still-live resumed session.
    vi.useFakeTimers()
    vi.setSystemTime(10_000_000)

    const service = new ThreadService()
    const opened = service.open(tree.bridge, actor, 'tree', 'n1')

    // The next write: a fresh keystroke, as if the user reopened and kept
    // typing.
    const result = service.push('tree', 'n1', actor, opened.version, [insertCharStepJson(2, 'y')], [10_000_000], [null])
    expect(result.confirmed).toBe(true)
    vi.advanceTimersByTime(1000)

    const entries = tree.bridge.getPropertyValues('n1', 'thread.log')
    expect(entries).toHaveLength(3) // the crash block, the recovered out, the new session

    const recoveredBlock = String(entries[1].value.value)
    expect(parseBlock(recoveredBlock)).toEqual([{ verb: 'out', offsetMs: 0 }])
    // Anchored at the crashed session's own last known moment (0), never at
    // "now" (10,000,000) -- the derived boundary is honest about when the
    // session actually ended, not when it was noticed.
    expect(parseBlockHeader(recoveredBlock).anchorMs).toBe(0)

    const newBlock = String(entries[2].value.value)
    expect(parseBlock(newBlock)[0]).toMatchObject({ verb: 'in', session: 2 })
  })
})
