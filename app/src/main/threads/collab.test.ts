/**
 * Two collab states against one authority (D-20..D-22, RESEARCH Pattern 3):
 * a person's local `prosemirror-collab` state, driven directly by this test
 * (no renderer, no DOM), rebases correctly after an agent's write lands
 * through `ThreadService.applyAgentEdit` while the person's own steps were
 * still unsent — and the rebased steps carry their original arrival times
 * into the committed `thread.log`, not the moment the rebase happened.
 *
 * This proves `ThreadService.push`'s existing version-mismatch/rebase-reply
 * contract (`{ confirmed: false, missing: { steps, fromVersion } }`) is
 * exactly what `prosemirror-collab`'s own `receiveTransaction` expects, using
 * the library's real functions against a real `EditorState` — never a mock
 * of collab's own rebase math.
 */

import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { Fragment, Slice } from 'prosemirror-model'
import { collab, receiveTransaction, sendableSteps } from 'prosemirror-collab'
import { ReplaceStep, Step } from 'prosemirror-transform'
import { tapestrySchema } from '../../renderer/editor/schema'
import { agentActor, humanActor } from '../commands/actor'
import { createTempTree, type TempTree } from '../../../test/helpers/temp-tree'
import { parseBlock, parseBlockHeader } from '../../shared/threads/grammar'
import { ThreadService, type ThreadPushResult } from './thread-service'

const THREAD_TYPE = 'tapestry.threads/thread@1'

function createThreadOps(): Array<Record<string, unknown>> {
  return [
    {
      op: 'createNode',
      type: THREAD_TYPE,
      props: { body: { type: 'text', value: '' }, title: { type: 'text', value: '' } },
    },
  ]
}

/** Every absolute moment (`anchorMs + offsetMs`) an `ins` record was written
 * at, across every `thread.log` commit, in commit-then-line order. */
function insTimes(bridge: TempTree['bridge'], nodeId: string): number[] {
  const times: number[] = []
  for (const entry of bridge.getPropertyValues(nodeId, 'thread.log')) {
    const block = String(entry.value.value)
    const header = parseBlockHeader(block)
    for (const record of parseBlock(block)) {
      if (record.verb === 'ins') times.push(header.anchorMs + record.offsetMs)
    }
  }
  return times
}

describe('Collaborative editing: a person and an agent through one ThreadService authority', () => {
  it("a person's steps, unsent when an agent writes first, rebase and commit with their original arrival times preserved", () => {
    const tree = createTempTree('collab')
    try {
      tree.bridge.submitAs(humanActor('kaelen'), 'Create thread', createThreadOps() as any)
      const service = new ThreadService()
      const human = humanActor('kaelen')
      const agent = agentActor('claude')

      // The person types "X" first and it lands, so later inserts have an
      // unambiguous anchor point (RESEARCH Pattern 3's own collision case is
      // about *where* content lands, not about this test's own set-up).
      const opened = service.open(tree.bridge, human, 'tree', 'n1')
      const seed = service.push('tree', 'n1', human, opened.version, [
        insertCharStepJson(1, 'X'),
      ], [500], [null])
      expect(seed.confirmed).toBe(true)

      // The person's own local collab state, starting exactly at the
      // authority's version and document at this point (open() on an
      // already-open handle just reports its current state, no re-replay).
      const afterSeed = service.open(tree.bridge, human, 'tree', 'n1')
      let humanState = EditorState.create({
        doc: tapestrySchema.nodeFromJSON(afterSeed.doc as any),
        schema: tapestrySchema,
        plugins: [collab({ version: afterSeed.version })],
      })

      // The person types "Hi" -- two steps, each with its own real arrival
      // time -- but does not push yet.
      const HUMAN_TIME_H = 10_000
      const HUMAN_TIME_I = 10_150
      humanState = humanState.apply(humanState.tr.insertText('H', 2))
      humanState = humanState.apply(humanState.tr.insertText('i', 3))

      // Before the person ever pushes, an agent inserts at the same point
      // (the end of "X") -- this is what makes the person's still-local
      // steps stale by the time they do push.
      const flat = service.readFlatText(tree.bridge, agent, 'tree', 'n1')
      if ('error' in flat) throw new Error(flat.error)
      const agentResult = service.applyAgentEdit(tree.bridge, agent, 'tree', 'n1', {
        from: flat.endPos,
        to: flat.endPos,
        insertText: 'A',
      })
      expect(agentResult.ok).toBe(true)

      // The person pushes their two pending steps at the version they
      // started from -- now stale, because the agent's write moved the
      // authority forward by one version.
      const pending = sendableSteps(humanState)!
      const firstPush = service.push(
        'tree',
        'n1',
        human,
        pending.version,
        pending.steps.map((s) => s.toJSON()),
        [HUMAN_TIME_H, HUMAN_TIME_I],
        [null, null],
      )
      expect(firstPush.confirmed).toBe(false)
      const missing = (firstPush as Extract<ThreadPushResult, { confirmed: false; missing: unknown }>).missing
      expect(missing).toBeDefined()

      // Rebase locally with prosemirror-collab's own machinery, exactly as
      // the renderer's use-thread-editor.ts hook does on a version mismatch,
      // then resend -- `sendableSteps` after `receiveTransaction` returns the
      // person's own two steps, remapped, in the same relative order.
      const remoteSteps = missing.steps.map((json) => Step.fromJSON(tapestrySchema, json))
      humanState = humanState.apply(
        receiveTransaction(humanState, remoteSteps, remoteSteps.map(() => 'agent-claude')),
      )

      const resend = sendableSteps(humanState)!
      const secondPush = service.push(
        'tree',
        'n1',
        human,
        resend.version,
        resend.steps.map((s) => s.toJSON()),
        // The rebased steps keep the person's ORIGINAL arrival times, read
        // by this test's own array (matched by order, which collab
        // preserves for a client's own still-unconfirmed steps) -- never
        // reset to "now" just because a rebase happened.
        [HUMAN_TIME_H, HUMAN_TIME_I],
        [null, null],
      )
      expect(secondPush.confirmed).toBe(true)

      service.close('tree', 'n1')

      // The document reads correctly: both authors' letters survive a fresh
      // reopen, replayed from thread.log alone.
      const reopened = new ThreadService()
      const final = reopened.open(tree.bridge, human, 'tree', 'n1')
      const finalDoc = tapestrySchema.nodeFromJSON(final.doc as any)
      expect(finalDoc.textContent).toContain('X')
      expect(finalDoc.textContent).toContain('A')
      expect(finalDoc.textContent).toContain('H')
      expect(finalDoc.textContent).toContain('i')

      // The rebased steps committed with their ORIGINAL arrival times, not
      // the time the rebase/resend actually happened at.
      const times = insTimes(tree.bridge, 'n1')
      expect(times).toContain(HUMAN_TIME_H)
      expect(times).toContain(HUMAN_TIME_I)
    } finally {
      tree.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Test-only helpers
// ---------------------------------------------------------------------------

/** A single-character insertion step, as the renderer's collab plugin would
 * serialize it (`Step.toJSON()`). */
function insertCharStepJson(pos: number, char: string): unknown {
  const step = new ReplaceStep(pos, pos, new Slice(Fragment.from(tapestrySchema.text(char)), 0, 0))
  return step.toJSON()
}
