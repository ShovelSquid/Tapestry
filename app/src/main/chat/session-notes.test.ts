/**
 * Session notes (02.8-01, D-02, D-03, D-07): who a session is, and the two
 * commits main writes for it, against a real workspace tree in a temp folder.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { WorkspaceService } from '../workspace/workspace-service'
import { agentActor, humanActor, isValidActorName } from '../commands/actor'
import { makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'
import { isWorkspaceNode } from '../../renderer/layout/subspaces'
import { overlaps, rectAt } from '../../renderer/layout/placement'
import { parseTranscript, SESSION_NODE_TYPE } from '../../shared/chat/transcript'
import {
  CHAT_AGENT_NAME,
  nextSessionSpot,
  persistKey,
  SESSION_NOT_FOUND_MESSAGE,
  SessionNotes,
  sessionAgentName,
  sessionKey,
} from './session-notes'

const MAX_TREE_ID = 'sha256:' + 'f'.repeat(64)

describe('session identity', () => {
  it('names the agent claude-chat-<8 hex>-<note id>, valid up to n9999999999', () => {
    const name = sessionAgentName(MAX_TREE_ID, 'n9999999999')
    expect(name).toBe(`${CHAT_AGENT_NAME}-ffffffff-n9999999999`)
    expect(isValidActorName(name)).toBe(true)
    expect(name.length).toBeLessThanOrEqual(32)
  })

  it('differs between workspaces for the same note id', () => {
    const a = sessionAgentName('sha256:0123abcd' + '0'.repeat(56), 'n1')
    const b = sessionAgentName('sha256:89abcdef' + '0'.repeat(56), 'n1')
    expect(a).toBe('claude-chat-0123abcd-n1')
    expect(a).not.toBe(b)
  })

  it('refuses a note id that would not make an actor name', () => {
    expect(() => sessionAgentName(MAX_TREE_ID, 'n99999999999')).toThrow()
  })

  it('keys a session in memory by tree and in chats.json by folder', () => {
    expect(sessionKey('sha256:ab', 'n3')).toBe('sha256:ab#n3')
    expect(persistKey('/tmp/Work Space', 'n3')).toBe('/tmp/Work Space#n3')
  })
})

describe('nextSessionSpot', () => {
  const size = { width: 360, height: 440 }

  it('puts the first session of an empty workspace at the origin', () => {
    expect(nextSessionSpot([], size)).toEqual({ x: 0, y: 0 })
  })

  it('goes right of everything, level with its top', () => {
    const nodes = [
      {
        id: 'n1',
        type: 'tapestry.notes/note@1',
        props: {
          'position.x': { type: 'real', value: 100 },
          'position.y': { type: 'real', value: -50 },
          width: { type: 'real', value: 200 },
          height: { type: 'real', value: 100 },
        },
      },
    ]
    expect(nextSessionSpot(nodes, size)).toEqual({ x: 100 + 200 + 80, y: -50 })
  })
})

// ---------------------------------------------------------------------------
// Against a real workspace tree
// ---------------------------------------------------------------------------

interface Setup {
  ws: TempWorkspace
  registry: TreeRegistry
  tree: OpenTree
  committed: Array<{ treeId: string; actor: string }>
  notes: SessionNotes
}

const setups: Setup[] = []

afterEach(() => {
  while (setups.length > 0) {
    const s = setups.pop()!
    s.registry.closeAll()
    s.ws.cleanup()
  }
})

async function setup(): Promise<Setup> {
  const ws = makeTempWorkspace({ git: false })
  const registry = new TreeRegistry()
  const workspaces = new WorkspaceService(registry, { treesDir: ws.treesDir })
  const tree = await workspaces.addWorkspace(ws.root)
  const committed: Setup['committed'] = []
  const notes = new SessionNotes({
    hooks: { onCommitted: (treeId, actor) => committed.push({ treeId, actor: `${actor.kind} ${actor.id}` }) },
  })
  const s = { ws, registry, tree, committed, notes }
  setups.push(s)
  return s
}

function commitBlocks(tree: OpenTree): string[] {
  return readFileSync(tree.path, 'utf-8').split('@commit ').slice(1)
}

const person = humanActor('test-person')

describe('SessionNotes', () => {
  it('create makes one commit, signed by the person, with the seven props', async () => {
    const s = await setup()
    const before = commitBlocks(s.tree).length
    const { noteId, seq } = s.notes.create(s.tree, person)

    const blocks = commitBlocks(s.tree)
    expect(blocks).toHaveLength(before + 1)
    expect(blocks.at(-1)).toContain('actor human user.test-person')
    expect(blocks.at(-1)).toContain('message "start chat \\"New chat\\""')
    expect(seq).toBeGreaterThan(0)
    expect(s.committed).toEqual([{ treeId: s.tree.id, actor: 'human user.test-person' }])

    const node = s.tree.bridge.getNode(noteId)!
    expect(node.type).toBe(SESSION_NODE_TYPE)
    expect(Object.keys(node.props).sort()).toEqual(
      ['body', 'chat.turns', 'height', 'position.x', 'position.y', 'title', 'width'].sort(),
    )
    expect(node.props['title'].value).toBe('New chat')
    expect(node.props['body'].value).toBe('')
    expect(node.props['chat.turns']).toMatchObject({ type: 'int', value: 0 })
    expect(node.props['width']).toMatchObject({ type: 'real', value: 360 })
    expect(node.props['height']).toMatchObject({ type: 'real', value: 440 })
    expect(Number.isFinite(Number(node.props['position.x'].value))).toBe(true)
    expect(Number.isFinite(Number(node.props['position.y'].value))).toBe(true)
  })

  it('places any number of sessions, each at its own clear spot', async () => {
    const s = await setup()
    const ids = [s.notes.create(s.tree, person), s.notes.create(s.tree, person), s.notes.create(s.tree, person)].map(
      (r) => r.noteId,
    )
    expect(new Set(ids).size).toBe(3)
    const rects = ids.map((id) => {
      const node = s.tree.bridge.getNode(id)!
      return rectAt(
        { x: Number(node.props['position.x'].value), y: Number(node.props['position.y'].value) },
        { width: 360, height: 440 },
      )
    })
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false)
    }
  })

  it('appendTurn makes one commit, signed by the given agent, setting body and chat.turns only', async () => {
    const s = await setup()
    const { noteId } = s.notes.create(s.tree, person)
    const nodesBefore = s.tree.bridge.getNodes().length
    const edgesBefore = s.tree.bridge.getEdges().length
    const agent = agentActor(sessionAgentName(s.tree.id, noteId))
    const before = commitBlocks(s.tree).length

    const first = s.notes.appendTurn(s.tree, noteId, agent, [
      { kind: 'you', text: 'hi' },
      { kind: 'claude', text: 'ok' },
    ])
    expect(first.turn).toBe(1)
    const blocks = commitBlocks(s.tree)
    expect(blocks).toHaveLength(before + 1)
    const block = blocks.at(-1)!
    expect(block).toContain(`actor plugin ${agent.id}`)
    expect(block).toContain('message "chat turn 1"')
    expect(block).not.toContain('create-node')
    expect(block).not.toContain('create-edge')
    expect(s.tree.bridge.getNodes()).toHaveLength(nodesBefore)
    expect(s.tree.bridge.getEdges()).toHaveLength(edgesBefore)

    const node = s.tree.bridge.getNode(noteId)!
    expect(node.props['chat.turns'].value).toBe(1)

    const second = s.notes.appendTurn(s.tree, noteId, agent, [{ kind: 'you', text: 'again' }])
    expect(second.turn).toBe(2)
    expect(parseTranscript(String(s.tree.bridge.getNode(noteId)!.props['body'].value))).toEqual([
      { turn: 1, items: [{ kind: 'you', text: 'hi' }, { kind: 'claude', text: 'ok' }] },
      { turn: 2, items: [{ kind: 'you', text: 'again' }] },
    ])
  })

  it('appendTurn refuses a note of another type, or none, and commits nothing', async () => {
    const s = await setup()
    const file = s.tree.bridge.getNodes().find(isWorkspaceNode)!
    const before = commitBlocks(s.tree).length
    const agent = agentActor('claude-chat-00000000-n1')
    expect(() => s.notes.appendTurn(s.tree, file.id, agent, [{ kind: 'you', text: 'x' }])).toThrow(
      SESSION_NOT_FOUND_MESSAGE,
    )
    expect(() => s.notes.appendTurn(s.tree, 'n999', agent, [{ kind: 'you', text: 'x' }])).toThrow(
      SESSION_NOT_FOUND_MESSAGE,
    )
    expect(() => s.notes.appendTurn(s.tree, 'e1', agent, [{ kind: 'you', text: 'x' }])).toThrow(
      SESSION_NOT_FOUND_MESSAGE,
    )
    expect(commitBlocks(s.tree)).toHaveLength(before)
    expect(s.committed).toEqual([])
  })
})
