/**
 * The five MCP thread tools (D-20..D-24), against a real temp `.tree` world
 * through a real `TreeRegistry` and `ThreadService` — the question this
 * plan cares about is whether an agent can really write into a shared
 * thread and really cannot touch a letter it did not write, not whether a
 * mock says it would.
 *
 * `treeId()` always resolves the registry's own sha256 identity: every real
 * caller (thread-tools.ts's own dispatch, thread-ipc.ts) keys `ThreadService`
 * by that id, never by the display name `"world"` used in tool arguments, so
 * a test driving `ThreadService` directly (to seed a human's own letters,
 * for the D-22 tests below) must use the same key or it opens a second,
 * unrelated handle for the identical node.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { agentActor, humanActor } from '../commands/actor'
import { NoteCommands } from '../commands/notes'
import { TreeRegistry } from '../trees/registry'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { ThreadService } from './thread-service'
import {
  THREAD_NODE_TYPE,
  runThreadTool,
  _resetThreadToolRateLimiterForTests,
  type ThreadToolCommands,
} from './thread-tools'

function commitCount(treePath: string): number {
  return readFileSync(treePath, 'utf-8')
    .split('\n')
    .filter((line) => line.startsWith('@commit ')).length
}

function treeText(treePath: string): string {
  return readFileSync(treePath, 'utf-8')
}

describe('thread-tools (D-20..D-24)', () => {
  let dir: string
  let treePath: string
  let registry: TreeRegistry
  let threadService: ThreadService
  let commands: ThreadToolCommands
  const human = humanActor('kaelen')
  const agent = agentActor('claude')

  beforeEach(() => {
    _resetThreadToolRateLimiterForTests()
    dir = makeTempDir('thread-tools')
    treePath = join(dir, 'world.tree')
    registry = new TreeRegistry()
    registry.create(treePath, 'world')
    threadService = new ThreadService()
    commands = { registry, threadService, notes: new NoteCommands(registry) }
  })

  afterEach(() => {
    // closeAll() cancels every handle's own idle/max-wait/time-out timers so
    // none of them fire later against a bridge this same afterEach is about
    // to close (they would otherwise log a harmless but noisy flush-retry
    // error once the kernel underneath them is gone).
    threadService.closeAll()
    registry.closeAll()
    rmSync(dir, { recursive: true, force: true })
  })

  function treeId(): string {
    return registry.resolveRef('world').id
  }

  /** A note a person wrote, for a thread to grow from (D-24). */
  function createSeedNote(): string {
    const tree = registry.resolveRef('world')
    const result = tree.bridge.submitAs(human, 'Create note', [
      {
        op: 'createNode',
        type: 'tapestry.notes/note@1',
        props: {
          'position.x': { type: 'real', value: 0 },
          'position.y': { type: 'real', value: 0 },
          title: { type: 'text', value: 'Seed' },
          body: { type: 'text', value: '' },
        },
      },
    ])
    return result.nodeIds[0]
  }

  /** Creates a thread grown from a fresh seed note, returning its node id. */
  function createThreadFixture(): string {
    const noteId = createSeedNote()
    const created = runThreadTool(commands, agent, 'create_thread', {
      tree: 'world',
      grewFrom: noteId,
      title: 'A thread',
    })
    expect(created.ok).toBe(true)
    return (created as { ok: true; value: { thread: string } }).value.thread
  }

  function flatTextNow(actor: typeof agent, threadNodeId: string): string {
    const bridge = registry.resolveRef('world').bridge
    const result = threadService.readFlatText(bridge, actor, treeId(), threadNodeId)
    if ('error' in result) throw new Error(result.error)
    return result.text
  }

  // ---------------------------------------------------------------------
  // create_thread (D-24)
  // ---------------------------------------------------------------------

  describe('create_thread', () => {
    it('is refused without a live grewFrom note, and commits nothing', () => {
      const before = commitCount(treePath)
      const result = runThreadTool(commands, agent, 'create_thread', {
        tree: 'world',
        grewFrom: 'n99',
        title: 'Loose thread',
      })
      expect(result.ok).toBe(false)
      expect(commitCount(treePath)).toBe(before)
    })

    it('with a live grewFrom note, creates the thread node and the grew-from edge in one commit', () => {
      const noteId = createSeedNote()
      const before = commitCount(treePath)

      const result = runThreadTool(commands, agent, 'create_thread', {
        tree: 'world',
        grewFrom: noteId,
        title: 'Grown thread',
      })
      expect(result.ok).toBe(true)
      const value = (result as { ok: true; value: { thread: string; edge: string } }).value

      // Exactly one new commit for the node+edge.
      expect(commitCount(treePath)).toBe(before + 1)

      const text = treeText(treePath)
      expect(text).toMatch(new RegExp(`^create-edge ${value.edge} ${value.thread} ${noteId} grew-from$`, 'm'))

      const node = registry.resolveRef('world').bridge.getNode(value.thread)
      expect(node?.type).toBe(THREAD_NODE_TYPE)
    })

    it('with initial text, seeds the thread.log with a real first commit', () => {
      const noteId = createSeedNote()
      const result = runThreadTool(commands, agent, 'create_thread', {
        tree: 'world',
        grewFrom: noteId,
        title: 'Grown thread',
        text: 'Hello',
      })
      expect(result.ok).toBe(true)
      const threadId = (result as { ok: true; value: { thread: string } }).value.thread
      threadService.close(treeId(), threadId)

      const text = treeText(treePath)
      expect(text).toMatch(/ins 1 "Hello"/)
    })
  })

  // ---------------------------------------------------------------------
  // append_to_thread / insert_into_thread (D-20)
  // ---------------------------------------------------------------------

  describe('append_to_thread', () => {
    it('lands the text and produces a real commit once flushed', () => {
      const threadId = createThreadFixture()

      const result = runThreadTool(commands, agent, 'append_to_thread', {
        tree: 'world',
        thread: threadId,
        text: 'Hello world',
      })
      expect(result.ok).toBe(true)

      threadService.close(treeId(), threadId)
      const text = treeText(treePath)
      expect(text).toMatch(/ins 1 "Hello world"/)
      expect(text).toContain('actor plugin agent.claude')
    })

    it('never reads an actor from its own arguments — an actor key is a validation failure', () => {
      const threadId = createThreadFixture()
      const result = runThreadTool(commands, agent, 'append_to_thread', {
        tree: 'world',
        thread: threadId,
        text: 'Hi',
        actor: 'human',
      } as unknown as Record<string, unknown>)
      expect(result.ok).toBe(false)
    })
  })

  describe('insert_into_thread', () => {
    it('inserts after an exact quote that matches once', () => {
      const threadId = createThreadFixture()
      runThreadTool(commands, agent, 'append_to_thread', { tree: 'world', thread: threadId, text: 'Hello world' })

      const result = runThreadTool(commands, agent, 'insert_into_thread', {
        tree: 'world',
        thread: threadId,
        after: 'Hello',
        text: ' there',
      })
      expect(result.ok).toBe(true)
      expect(flatTextNow(agent, threadId)).toBe('Hello there world')
    })

    it('is refused when the quote matches zero times, and commits nothing', () => {
      const threadId = createThreadFixture()
      runThreadTool(commands, agent, 'append_to_thread', { tree: 'world', thread: threadId, text: 'Hello world' })
      threadService.close(treeId(), threadId)
      const before = commitCount(treePath)

      // Reopens the thread (a read, not a commit) via the same ensureHandle
      // path the successful tools above use, then refuses the edit itself --
      // no second close() here, since close() unconditionally writes a body
      // checkpoint on ANY open handle and would otherwise manufacture a
      // commit unrelated to the refusal this assertion is about.
      const result = runThreadTool(commands, agent, 'insert_into_thread', {
        tree: 'world',
        thread: threadId,
        after: 'nonexistent',
        text: 'x',
      })
      expect(result.ok).toBe(false)
      expect(commitCount(treePath)).toBe(before)
    })

    it('is refused when the quote matches more than once, and commits nothing', () => {
      const threadId = createThreadFixture()
      runThreadTool(commands, agent, 'append_to_thread', { tree: 'world', thread: threadId, text: 'ab ab' })
      threadService.close(treeId(), threadId)
      const before = commitCount(treePath)

      const result = runThreadTool(commands, agent, 'insert_into_thread', {
        tree: 'world',
        thread: threadId,
        after: 'ab',
        text: 'x',
      })
      expect(result.ok).toBe(false)
      expect(commitCount(treePath)).toBe(before)
    })

    it('at: start / at: end insert at the document boundaries', () => {
      const threadId = createThreadFixture()
      runThreadTool(commands, agent, 'append_to_thread', { tree: 'world', thread: threadId, text: 'middle' })

      runThreadTool(commands, agent, 'insert_into_thread', { tree: 'world', thread: threadId, at: 'start', text: 'A' })
      runThreadTool(commands, agent, 'insert_into_thread', { tree: 'world', thread: threadId, at: 'end', text: 'Z' })

      expect(flatTextNow(agent, threadId)).toBe('AmiddleZ')
    })
  })

  // ---------------------------------------------------------------------
  // D-22: agents add anywhere but delete/rewrite only their own letters
  // ---------------------------------------------------------------------

  describe('D-22 authorship enforcement', () => {
    it('an agent editing letters it wrote succeeds', () => {
      const threadId = createThreadFixture()
      runThreadTool(commands, agent, 'append_to_thread', { tree: 'world', thread: threadId, text: 'Hello world' })

      const result = runThreadTool(commands, agent, 'replace_in_thread', {
        tree: 'world',
        thread: threadId,
        quote: 'world',
        text: 'there',
      })
      expect(result.ok).toBe(true)
      expect(flatTextNow(agent, threadId)).toBe('Hello there')
    })

    it('an agent deleting a user-written letter is refused, and the journal\'s commit count is unchanged', () => {
      const threadId = createThreadFixture()
      // The human writes into the same thread, via the exact same
      // authoritative path an agent write would use (ThreadService).
      const bridge = registry.resolveRef('world').bridge
      threadService.applyAgentEdit(bridge, human, treeId(), threadId, { from: 1, to: 1, insertText: 'Kaelen wrote this' })
      threadService.close(treeId(), threadId)
      const before = commitCount(treePath)

      const result = runThreadTool(commands, agent, 'delete_from_thread', {
        tree: 'world',
        thread: threadId,
        quote: 'Kaelen',
      })
      expect(result.ok).toBe(false)
      // No further close() here: it would unconditionally write a body
      // checkpoint for the handle the refused call's own ensureHandle just
      // reopened, which is a real commit but not one this refusal caused.
      expect(commitCount(treePath)).toBe(before)

      // Nothing changed: the text is exactly as the human left it.
      expect(flatTextNow(human, threadId)).toBe('Kaelen wrote this')
    })

    it('an agent replacing a user-written letter is refused, and nothing is written', () => {
      const threadId = createThreadFixture()
      const bridge = registry.resolveRef('world').bridge
      threadService.applyAgentEdit(bridge, human, treeId(), threadId, { from: 1, to: 1, insertText: 'mine' })
      threadService.close(treeId(), threadId)
      const before = commitCount(treePath)

      const result = runThreadTool(commands, agent, 'replace_in_thread', {
        tree: 'world',
        thread: threadId,
        quote: 'mine',
        text: 'yours',
      })
      expect(result.ok).toBe(false)
      expect(commitCount(treePath)).toBe(before)
    })

    it("refuses to delete a quote that spans both the user's and the agent's own letters", () => {
      const threadId = createThreadFixture()
      const bridge = registry.resolveRef('world').bridge
      threadService.applyAgentEdit(bridge, human, treeId(), threadId, { from: 1, to: 1, insertText: 'human' })
      threadService.applyAgentEdit(bridge, agent, treeId(), threadId, { from: 6, to: 6, insertText: 'agent' })
      threadService.close(treeId(), threadId)
      const before = commitCount(treePath)

      // "humanagent" -- the quote "manag" straddles both authors' letters.
      const result = runThreadTool(commands, agent, 'delete_from_thread', {
        tree: 'world',
        thread: threadId,
        quote: 'manag',
      })
      expect(result.ok).toBe(false)
      expect(commitCount(treePath)).toBe(before)
    })
  })

  it('a thread node is identifiable by THREAD_NODE_TYPE for the update_note guard (T-02.3-08-02)', () => {
    const threadId = createThreadFixture()
    const node = registry.resolveRef('world').bridge.getNode(threadId)
    expect(node?.type).toBe(THREAD_NODE_TYPE)
  })
})
