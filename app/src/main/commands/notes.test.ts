/**
 * The shared note command layer: what an agent may and may not do (D-04).
 *
 * Every refusal here is checked twice: that it returns `{ ok: false }`, and
 * that **nothing was written**. A refusal that still appended a commit would
 * leave a loose note in history, which is exactly what D-04 forbids, so the
 * file's size and the world's node count are asserted alongside every error.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { agentActor, humanActor } from './actor'
import { NoteCommands, docJsonToPlainText, plainTextToDocJson } from './notes'

const CLAUDE = agentActor('claude')
const KAELEN = humanActor('kaelen')

let dir: string
let treePath: string
let registry: TreeRegistry
let tree: OpenTree
let commands: NoteCommands

/** A world with one human-written note, n1. */
beforeEach(() => {
  dir = makeTempDir('notes')
  treePath = join(dir, 'notes.tree')
  registry = new TreeRegistry()
  tree = registry.create(treePath, 'notes')
  commands = new NoteCommands(registry)

  tree.bridge.submitAs(KAELEN, 'Create note', [
    {
      op: 'createNode',
      type: 'tapestry.notes/note@1',
      props: {
        'position.x': { type: 'real', value: 10 },
        'position.y': { type: 'real', value: 20 },
        'width': { type: 'real', value: 300 },
        title: { type: 'text', value: 'Seed' },
        body: { type: 'text', value: plainTextToDocJson('The first note') },
      },
    },
  ])
})

afterEach(() => {
  try {
    registry.closeAll()
  } catch {
    // Already closed.
  }
  rmSync(dir, { recursive: true, force: true })
})

/** Everything that must not change when a command is refused. */
function worldFingerprint(): { size: number; nodes: number; edges: number } {
  return {
    size: statSync(treePath).size,
    nodes: tree.bridge.getNodes().length,
    edges: tree.bridge.getEdges().length,
  }
}

/** The text of the most recent commit record. */
function lastCommitBlock(): string {
  const segments = readFileSync(treePath, 'utf-8').split(/^@commit /m)
  return segments[segments.length - 1]
}

// ---------------------------------------------------------------------------
// Refusals (D-04) — an agent can never create a loose note
// ---------------------------------------------------------------------------

describe('createFrom refusals', () => {
  it('refuses an unknown tree', () => {
    const before = worldFingerprint()
    const result = commands.createFrom(CLAUDE, {
      tree: 'no-such-tree',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'hi',
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('Unknown tree: no-such-tree')
    expect(worldFingerprint()).toEqual(before)
  })

  it('refuses a grewFrom note that does not exist', () => {
    const before = worldFingerprint()
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n99',
      title: 'Luna',
      text: 'hi',
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('grewFrom n99 is not a live note in notes')
    expect(worldFingerprint()).toEqual(before)
  })

  it('refuses a malformed grewFrom id', () => {
    const before = worldFingerprint()
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'x',
      title: 'Luna',
      text: 'hi',
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('is not a live note in notes')
    expect(worldFingerprint()).toEqual(before)
  })

  it('refuses a grewFrom note that was deleted', () => {
    // A second note, then deleted: the id was once real, which is precisely
    // the case a "does it parse" check would let through.
    const created = tree.bridge.submitAs(KAELEN, 'Create note', [
      {
        op: 'createNode',
        type: 'tapestry.notes/note@1',
        props: { title: { type: 'text', value: 'Doomed' } },
      },
    ])
    const doomed = created.nodeIds[0]
    tree.bridge.submitAs(KAELEN, 'Delete note', [{ op: 'deleteNode', id: doomed }])

    const before = worldFingerprint()
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: doomed,
      title: 'Luna',
      text: 'hi',
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe(
      `grewFrom ${doomed} is not a live note in notes`,
    )
    expect(worldFingerprint()).toEqual(before)
  })

  it('refuses a blank title', () => {
    const before = worldFingerprint()
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: '   ',
      text: 'hi',
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('title must not be empty')
    expect(worldFingerprint()).toEqual(before)
  })

  /**
   * Plan 03 refused this outright. Plan 04 reconciles instead (UA-14): the
   * tree returns to its latest state and the write lands, because refusing an
   * agent for a reason that is nothing to do with it — Kaelen happened to
   * press undo — loses the agent's work silently. The discarded redo is
   * announced through onRedoDiscarded, asserted in notes-policy.test.ts.
   */
  it('reconciles a rewound tree rather than refusing the commit', () => {
    expect(tree.bridge.undo()).toBe(true)
    const before = worldFingerprint()

    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'hi',
    })

    expect(result.ok).toBe(true)
    expect(tree.bridge.isRewound).toBe(false)
    expect(statSync(treePath).size).toBeGreaterThan(before.size)
  })
})

// ---------------------------------------------------------------------------
// Success — node and edge in ONE commit
// ---------------------------------------------------------------------------

describe('createFrom', () => {
  it('writes the note and its grew-from edge in a single commit', () => {
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'Grown by Claude',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.note).toBe('n2')
    expect(result.value.tree).toBe(tree.id)

    // Both lines live in the SAME commit record: history never shows the note
    // existing unattached.
    const block = lastCommitBlock()
    expect(block).toContain('actor plugin agent.claude')
    expect(block).toContain('create-node n2 tapestry.notes/note@1')
    expect(block).toMatch(/create-edge e\d+ n2 n1 grew-from/)

    // Exactly one new node and one new edge.
    expect(tree.bridge.getNodes()).toHaveLength(2)
    expect(tree.bridge.getEdges()).toHaveLength(1)
  })

  it('places the new note to the right of the note it grew from', () => {
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'hi',
    })
    expect(result.ok).toBe(true)

    const child = tree.bridge.getNode('n2')!
    // parent x 10 + width 300 + gap 80
    expect(Number(child.props['position.x'].value)).toBe(390)
    expect(Number(child.props['position.y'].value)).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('readNote', () => {
  it('reports the text, the author and the connections', () => {
    const created = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'Grown by Claude\nsecond line',
    })
    expect(created.ok).toBe(true)

    const result = commands.readNote({ tree: 'notes', note: 'n2' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.title).toBe('Luna')
    expect(result.value.text).toBe('Grown by Claude\nsecond line')
    // Authorship is derived from the commit, not stored on the node (D-05).
    expect(result.value.author).toBe('agent.claude')
    expect(result.value.connections).toEqual([
      { edge: 'e1', label: 'grew-from', direction: 'out', other: 'n1' },
    ])
  })

  it('reports the parent side of the connection as incoming', () => {
    commands.createFrom(CLAUDE, { tree: 'notes', grewFrom: 'n1', title: 'Luna', text: 'hi' })

    const result = commands.readNote({ tree: 'notes', note: 'n1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.author).toBe('user.kaelen')
    expect(result.value.connections).toEqual([
      { edge: 'e1', label: 'grew-from', direction: 'in', other: 'n2' },
    ])
  })

  it('refuses a note that is not live', () => {
    const result = commands.readNote({ tree: 'notes', note: 'n99' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('n99 is not a live note in notes')
  })
})

describe('listTrees', () => {
  it('lists the open trees', () => {
    const result = commands.listTrees()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toEqual([
      { id: tree.id, name: 'notes', kind: 'native', path: treePath },
    ])
  })
})

// ---------------------------------------------------------------------------
// Commit hooks — what tells the renderer to refresh
// ---------------------------------------------------------------------------

describe('commit hooks', () => {
  it('reports a landed commit once, and a refused one never', () => {
    const seen: Array<{ treeId: string; actorId: string; seq: number }> = []
    const hooked = new NoteCommands(registry, {
      onCommitted: (treeId, actor, result) => {
        seen.push({ treeId, actorId: actor.id, seq: result.seq })
      },
    })

    const created = hooked.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'hi',
    })
    expect(created.ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0].treeId).toBe(tree.id)
    expect(seen[0].actorId).toBe('agent.claude')

    const refused = hooked.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n99',
      title: 'Nope',
      text: 'hi',
    })
    expect(refused.ok).toBe(false)
    // Still one. A refusal must never look like a change to the renderer,
    // or the canvas would flicker on every rejected agent request.
    expect(seen).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Body text round-trip (D-12)
// ---------------------------------------------------------------------------

describe('body text conversion', () => {
  it('round-trips plain text through editor JSON', () => {
    for (const text of ['', 'one line', 'two\nlines', 'a\n\nblank line between']) {
      expect(docJsonToPlainText(plainTextToDocJson(text))).toBe(text)
    }
  })

  it('returns a non-JSON body unchanged', () => {
    expect(docJsonToPlainText('just bare text')).toBe('just bare text')
  })
})
