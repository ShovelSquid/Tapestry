/**
 * File notes join the 2.4 lock model (02.7 D-09), and the note tools refuse
 * workspace trees (D-03). Locks are written here by a person through
 * submitAs, as the 2.4 suites do; nothing in production writes `lock.*`.
 *
 * Temp workspaces only (makeTempWorkspace); never a real worktree.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { NoteCommands } from '../commands/notes'
import { ConnectionCommands } from '../commands/connections'
import { SpatialCommands } from '../commands/spatial'
import { runAgentTool, type AgentCommands } from '../commands/agent-tools'
import { WorkspaceFileCommands } from '../commands/file-tools'
import { agentActor, humanActor, WORKSPACE_WATCHER_ACTOR } from '../commands/actor'
import {
  DEFAULT_LOCK_POLICY,
  lockPolicyForTree,
  resolveLock,
  WORKSPACE_LOCK_POLICY,
} from '../commands/locks'
import { WorkspaceService } from './workspace-service'
import { makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'

const CLAUDE = agentActor('claude')
const KAELEN = humanActor('kaelen')

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Harness {
  ws: TempWorkspace
  registry: TreeRegistry
  service: WorkspaceService
  commands: AgentCommands
  tree: OpenTree
  hello: string
  deep: string
}

async function setup(): Promise<Harness> {
  const ws = makeTempWorkspace()
  const registry = new TreeRegistry()
  const service = new WorkspaceService(registry, { treesDir: ws.treesDir })
  cleanups.push(() => {
    registry.closeAll()
    ws.cleanup()
  })
  const tree = await service.addWorkspace(ws.root)
  const commands: AgentCommands = {
    notes: new NoteCommands(registry),
    connections: new ConnectionCommands(registry),
    spatial: new SpatialCommands(registry),
    files: new WorkspaceFileCommands(service),
  }
  const hello = service.noteForPath(tree, 'src/hello.ts')!.id
  const deep = service.noteForPath(tree, 'src/nested/deep.txt')!.id
  return { ws, registry, service, commands, tree, hello, deep }
}

/** A person sets properties on a note (the fixture's way of writing locks). */
function setAsPerson(tree: OpenTree, note: string, props: Record<string, string>): void {
  tree.bridge.submitAs(
    KAELEN,
    'set lock',
    Object.entries(props).map(([key, value]) => ({ op: 'setProperty', target: note, key, type: 'text', value })),
  )
}

/** Bytes on disk, journal size and head: what a refusal must not change. */
function state(h: Harness): { bytes: string; journal: number; head: number; nodes: number } {
  return {
    bytes: readFileSync(join(h.ws.root, 'src', 'hello.ts'), 'utf-8'),
    journal: statSync(h.tree.path).size,
    head: h.tree.bridge.status().lastGoodSeq,
    nodes: h.tree.bridge.getNodes().length,
  }
}

function errorOf(result: { ok: boolean }): string {
  return (result as unknown as { error: string }).error
}

describe('text locks on file notes', () => {
  it('lock.text refuses edit_file and write_file before any observe commit', async () => {
    const h = await setup()
    setAsPerson(h.tree, h.hello, { 'lock.text': 'user.kaelen' })
    // The file changed on disk since the tree last saw it; a refusal must not
    // even record that as observed.
    writeFileSync(join(h.ws.root, 'src', 'hello.ts'), 'changed outside\n')
    const before = state(h)
    const expected = `src/hello.ts: ${h.hello} text is locked by user.kaelen`

    const edit = runAgentTool(h.commands, CLAUDE, 'edit_file', {
      path: 'src/hello.ts',
      old_string: 'changed',
      new_string: 'edited',
    })
    expect(edit.ok).toBe(false)
    expect(errorOf(edit)).toBe(expected)
    expect(state(h)).toEqual(before)

    const write = runAgentTool(h.commands, CLAUDE, 'write_file', { path: 'src/hello.ts', text: 'mine\n' })
    expect(write.ok).toBe(false)
    expect(errorOf(write)).toBe(expected)
    expect(state(h)).toEqual(before)
  })

  it('lock.text.allow admits the named agent', async () => {
    const h = await setup()
    setAsPerson(h.tree, h.hello, { 'lock.text': 'user.kaelen', 'lock.text.allow': 'agent.claude' })
    const result = runAgentTool(h.commands, CLAUDE, 'edit_file', {
      path: 'src/hello.ts',
      old_string: "'hello'",
      new_string: "'allowed'",
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    // Another agent is still refused.
    const other = runAgentTool(h.commands, agentActor('other'), 'write_file', { path: 'src/hello.ts', text: 'x\n' })
    expect(errorOf(other)).toBe(`src/hello.ts: ${h.hello} text is locked by user.kaelen`)
  })

  it("lock.text 'open' admits every agent", async () => {
    const h = await setup()
    setAsPerson(h.tree, h.hello, { 'lock.text': 'open' })
    const result = runAgentTool(h.commands, CLAUDE, 'write_file', { path: 'src/hello.ts', text: 'open\n' })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(readFileSync(join(h.ws.root, 'src', 'hello.ts'), 'utf-8')).toBe('open\n')
  })

  it('a watcher-created note with no lock is open to agents', async () => {
    const h = await setup()
    const createdBy = h.tree.bridge.getHistoryIndex().nodes[h.deep].createdBy
    expect(createdBy.id).toBe(WORKSPACE_WATCHER_ACTOR.id)
    const result = runAgentTool(h.commands, CLAUDE, 'edit_file', {
      path: 'src/nested/deep.txt',
      old_string: 'deep',
      new_string: 'deeper',
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
  })

  it('a person-created note with no lock is open under the workspace policy only', () => {
    expect(resolveLock({}, KAELEN, 'text', WORKSPACE_LOCK_POLICY)).toEqual({ locked: false })
    expect(resolveLock({}, KAELEN, 'layout', WORKSPACE_LOCK_POLICY)).toEqual({ locked: false })
    expect(resolveLock({}, KAELEN, 'delete', WORKSPACE_LOCK_POLICY)).toEqual({ locked: false })
    expect(resolveLock({}, KAELEN, 'text', DEFAULT_LOCK_POLICY).locked).toBe(true)
    // Explicit locks still hold, and malformed ones still fail closed.
    expect(resolveLock({ 'lock.text': { type: 'text', value: 'user.kaelen' } }, KAELEN, 'text', WORKSPACE_LOCK_POLICY).locked).toBe(true)
    expect(resolveLock({ 'lock.text': { type: 'integer', value: 1 } }, KAELEN, 'text', WORKSPACE_LOCK_POLICY).locked).toBe(true)
    expect(lockPolicyForTree('workspace')).toBe(WORKSPACE_LOCK_POLICY)
    expect(lockPolicyForTree('native')).toBe(DEFAULT_LOCK_POLICY)
    expect(lockPolicyForTree('vault')).toBe(DEFAULT_LOCK_POLICY)
  })
})

describe('layout locks on file notes', () => {
  it('lock.layout refuses place, writing nothing', async () => {
    const h = await setup()
    setAsPerson(h.tree, h.hello, { 'lock.layout': 'user.kaelen' })
    const before = state(h)
    const result = runAgentTool(h.commands, CLAUDE, 'place', {
      tree: h.tree.id,
      note: h.hello,
      where: { near: h.deep },
    })
    expect(result.ok).toBe(false)
    expect(errorOf(result)).toBe(`${h.hello} layout is locked by user.kaelen`)
    expect(state(h)).toEqual(before)
  })

  it('place on an unlocked file note succeeds', async () => {
    const h = await setup()
    const before = h.tree.bridge.status().lastGoodSeq
    const result = runAgentTool(h.commands, CLAUDE, 'place', {
      tree: h.tree.id,
      note: h.hello,
      where: { near: h.deep },
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(h.tree.bridge.status().lastGoodSeq).toBe(before + 1)
  })

  it("a native tree keeps 2.4's default: a person's note is locked to them", async () => {
    const h = await setup()
    const native = h.registry.create(join(h.ws.dir, 'native.tree'), 'native')
    const note = (x: number, title: string) => ({
      op: 'createNode' as const,
      type: 'tapestry.notes/note@1',
      props: {
        'position.x': { type: 'real', value: x },
        'position.y': { type: 'real', value: 0 },
        title: { type: 'text', value: title },
      },
    })
    const created = native.bridge.submitAs(KAELEN, 'Create notes', [note(0, 'A'), note(400, 'B')])
    const [a, b] = created.nodeIds
    const result = runAgentTool(h.commands, CLAUDE, 'place', { tree: native.id, note: b, where: { near: a } })
    expect(result.ok).toBe(false)
    expect(errorOf(result)).toBe(`${b} layout is locked by user.kaelen`)
  })
})

describe('note tools refuse workspace trees', () => {
  it('create, update, rename and delete are refused naming the file tools; nothing is committed', async () => {
    const h = await setup()
    const before = state(h)
    const calls: Array<[string, Record<string, unknown>]> = [
      ['update_note', { tree: h.tree.id, note: h.hello, text: 'x' }],
      ['rename_note', { tree: h.tree.id, note: h.hello, title: 'x' }],
      ['delete_note', { tree: h.tree.id, note: h.hello }],
      ['create_note', { tree: h.tree.id, grewFrom: h.hello, title: 'x', text: 'y' }],
    ]
    for (const [tool, args] of calls) {
      const result = runAgentTool(h.commands, CLAUDE, tool, args)
      expect(result.ok, tool).toBe(false)
      expect(errorOf(result), tool).toContain('write_file')
      expect(errorOf(result), tool).toContain('edit_file')
      expect(errorOf(result), tool).toContain('its notes are files')
    }
    expect(state(h)).toEqual(before)
  })

  it('connect_notes between two file notes still works', async () => {
    const h = await setup()
    const edges = h.tree.bridge.getEdges().length
    const result = runAgentTool(h.commands, CLAUDE, 'connect_notes', {
      from: { tree: h.tree.id, note: h.hello },
      to: { tree: h.tree.id, note: h.deep },
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(h.tree.bridge.getEdges().length).toBe(edges + 1)
  })
})
