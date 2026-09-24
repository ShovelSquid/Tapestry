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
import { CreateNoteArgs } from '../mcp/schemas'
import { displayPositions } from '../../renderer/layout/placement'

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
// create_note's optional where (02.5 Plan 05, SC2, D-01, D-02, D-06, D-12)
// ---------------------------------------------------------------------------

/** Seed notes signed by Kaelen in one commit; returns the ids the kernel issued. */
function seedNotes(
  seeds: Array<{ x?: number; y?: number; width?: number; height?: number }>,
  into: OpenTree = tree,
): string[] {
  const ops = seeds.map((s) => {
    const props: Record<string, { type: string; value: string | number | boolean }> = {
      title: { type: 'text', value: 'Other' },
      body: { type: 'text', value: '' },
    }
    if (s.x !== undefined) props['position.x'] = { type: 'real', value: s.x }
    if (s.y !== undefined) props['position.y'] = { type: 'real', value: s.y }
    if (s.width !== undefined) props['width'] = { type: 'real', value: s.width }
    if (s.height !== undefined) props['height'] = { type: 'real', value: s.height }
    return { op: 'createNode' as const, type: 'tapestry.notes/note@1', props }
  })
  return into.bridge.submitAs(KAELEN, 'Seed notes', ops).nodeIds
}

/** How many commits the file holds. */
function commitRecords(): number {
  return (readFileSync(treePath, 'utf-8').match(/^@commit /gm) ?? []).length
}

/** The fingerprint a where refusal must leave alone, with the commit count. */
function whereFingerprint() {
  return { ...worldFingerprint(), commits: commitRecords() }
}

type WhereCall = { near: string } | { beyond: string; from: string }

/** create_note with where, expecting a refusal that writes nothing. */
function createWhereError(where: WhereCall, grewFrom = 'n1'): string {
  const before = whereFingerprint()
  const result = commands.createFrom(CLAUDE, { tree: 'notes', grewFrom, title: 'Luna', text: 'hi', where })
  expect(result.ok).toBe(false)
  expect(whereFingerprint()).toEqual(before)
  return result.ok ? '' : result.error
}

describe('createFrom without where (D-02: unchanged)', () => {
  it('without where writes no pinned, no placed text, four set lines, and returns only tree, note, edge and seq', () => {
    const result = commands.createFrom(CLAUDE, { tree: 'notes', grewFrom: 'n1', title: 'Luna', text: 'hi' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(Object.keys(result.value).sort()).toEqual(['edge', 'note', 'seq', 'tree'])
    expect(tree.bridge.getNode('n2')!.props['pinned']).toBeUndefined()

    const block = lastCommitBlock()
    expect(block).not.toContain('pinned')
    expect(block).not.toContain('placed')
    expect(block).toContain('message "grow note \\"Luna\\" from n1"\n')
    const setLines = block.split('\n').filter((line) => line.trimStart().startsWith('set n2 '))
    expect(setLines).toHaveLength(4)
    expect(setLines.some((line) => line.includes('position.x'))).toBe(true)
    expect(setLines.some((line) => line.includes('position.y'))).toBe(true)
    expect(setLines.some((line) => line.includes(' body '))).toBe(true)
    expect(setLines.some((line) => line.includes(' title '))).toBe(true)
    expect(block).toContain('create-node n2 tapestry.notes/note@1')
    expect(block).toMatch(/create-edge e\d+ n2 n1 grew-from/)
  })

  it('without where still overlaps a note already at the parent right (no collision step)', () => {
    seedNotes([{ x: 390, y: 20 }])
    const result = commands.createFrom(CLAUDE, { tree: 'notes', grewFrom: 'n1', title: 'Luna', text: 'hi' })
    expect(result.ok).toBe(true)

    const child = tree.bridge.getNode('n3')!
    expect(child.props['position.x'].value).toBe(390)
    expect(child.props['position.y'].value).toBe(20)
    expect(child.props['pinned']).toBeUndefined()
  })
})

describe('createFrom with where', () => {
  it('near its own grewFrom follows: pinned bool false at the drawn spot, and the message says where', () => {
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'hi',
      where: { near: 'n1' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toEqual({
      tree: tree.id,
      note: 'n2',
      edge: 'e1',
      seq: expect.any(Number),
      follows: true,
    })
    const child = tree.bridge.getNode('n2')!
    expect(child.props['position.x'].value).toBe(390)
    expect(child.props['position.y'].value).toBe(20)
    expect(child.props['pinned']).toEqual({ type: 'bool', value: false })

    // PROV-03 / TREE-01: one commit, signed by the agent, node and edge together.
    const block = lastCommitBlock()
    expect(block).toContain('actor plugin agent.claude')
    expect(block).toContain('create-node n2 tapestry.notes/note@1')
    expect(block).toMatch(/create-edge e\d+ n2 n1 grew-from/)
    expect(block).toContain('message "grow note \\"Luna\\" from n1, placed near n1"\n')
    expect(block).toMatch(/set n2 pinned bool false/)
  })

  it('follows past a note already beside the parent, and is drawn exactly at its stored spot (D-06)', () => {
    seedNotes([{ x: 390, y: 20 }])
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'hi',
      where: { near: 'n1' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.note).toBe('n3')

    const child = tree.bridge.getNode('n3')!
    // 20 + default height 120 + gutter 24
    expect(child.props['position.x'].value).toBe(390)
    expect(child.props['position.y'].value).toBe(164)

    const drawn = displayPositions(tree.bridge.getNodes(), tree.bridge.getEdges(), new Map()).get('n3')
    expect(drawn?.following).toBe(true)
    expect(drawn?.x).toBe(390)
    expect(drawn?.y).toBe(164)
  })

  it('near another note is fixed: no pinned key and follows false', () => {
    seedNotes([{ x: 1000, y: 1000 }])
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'hi',
      where: { near: 'n2' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.follows).toBe(false)

    const child = tree.bridge.getNode('n3')!
    // n2 at 1000 + default width 280 + gap 80
    expect(child.props['position.x'].value).toBe(1360)
    expect(child.props['position.y'].value).toBe(1000)
    expect(child.props['pinned']).toBeUndefined()
    expect(lastCommitBlock()).toContain('message "grow note \\"Luna\\" from n1, placed near n2"\n')
    expect(lastCommitBlock()).not.toContain('pinned')
  })

  it('beyond one note from another is fixed: no pinned key and follows false', () => {
    seedNotes([{ x: 1000, y: 20 }])
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'hi',
      where: { beyond: 'n2', from: 'n1' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.follows).toBe(false)

    const child = tree.bridge.getNode('n3')!
    expect(Number(child.props['position.x'].value)).toBeGreaterThan(1000)
    expect(Number.isFinite(Number(child.props['position.y'].value))).toBe(true)
    expect(child.props['pinned']).toBeUndefined()
    expect(lastCommitBlock()).toContain('message "grow note \\"Luna\\" from n1, placed beyond n2 from n1"\n')
    expect(lastCommitBlock()).not.toContain('pinned')
  })

  it('beyond its own grewFrom is still fixed (only near the parent follows, D-01)', () => {
    seedNotes([{ x: -1000, y: 20 }])
    const result = commands.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'hi',
      where: { beyond: 'n1', from: 'n2' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.follows).toBe(false)
    expect(tree.bridge.getNode('n3')!.props['pinned']).toBeUndefined()
  })
})

describe('createFrom where refusals write nothing (SC4, D-12)', () => {
  it('refuses an anchor that is not live or malformed', () => {
    expect(createWhereError({ near: 'n99' })).toBe('near n99 is not a live note in notes')
    expect(createWhereError({ near: 'bogus' })).toBe('near bogus is not a live note in notes')
    expect(createWhereError({ beyond: 'n1', from: 'n98' })).toBe('from n98 is not a live note in notes')
    expect(createWhereError({ beyond: 'n98', from: 'n1' })).toBe('beyond n98 is not a live note in notes')
  })

  it('refuses beyond and from naming the same note', () => {
    expect(createWhereError({ beyond: 'n1', from: 'n1' })).toBe('beyond n1 from n1 names the same note twice')
  })

  it('refuses near an unplaced note', () => {
    seedNotes([{}])
    expect(createWhereError({ near: 'n2' })).toBe('near n2 is not placed in notes')
  })

  it('refuses a fully blocked column', () => {
    seedNotes([{ x: 390, y: -100, height: 20000 }])
    expect(createWhereError({ near: 'n1' })).toBe('no clear spot near n1 in notes')
  })

  it('refuses two anchors with the same centre (no line)', () => {
    seedNotes([{ x: 10, y: 20, width: 300 }])
    expect(createWhereError({ beyond: 'n1', from: 'n2' })).toBe('beyond n1 from n2 has no line to extend in notes')
  })

  it('refuses an anchor live only in another open tree (D-12)', () => {
    const other = registry.create(join(dir, 'other.tree'), 'other')
    seedNotes(
      Array.from({ length: 5 }, (_, i) => ({ x: i * 400, y: 0 })),
      other,
    )
    expect(tree.bridge.getNode('n5')).toBeNull()
    expect(createWhereError({ near: 'n5' })).toBe('near n5 is not a live note in notes')
  })

  it('refuses near the id the new note would receive', () => {
    expect(tree.bridge.getNextIds().node).toBe('n2')
    expect(createWhereError({ near: 'n2' })).toBe('near n2 is not a live note in notes')
  })

  it('does not report a refused where to onCommitted', () => {
    let committed = 0
    const hooked = new NoteCommands(registry, { onCommitted: () => void committed++ })
    const refused = hooked.createFrom(CLAUDE, {
      tree: 'notes',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'hi',
      where: { near: 'n99' },
    })
    expect(refused.ok).toBe(false)
    expect(committed).toBe(0)
  })
})

describe('CreateNoteArgs.where (D-11)', () => {
  const base = { tree: 'notes', grewFrom: 'n1', title: 'Luna', text: 'hi' }
  const ok = (where: unknown) => CreateNoteArgs.safeParse({ ...base, where }).success

  it('accepts where absent, near, and beyond-from', () => {
    expect(CreateNoteArgs.safeParse(base).success).toBe(true)
    expect(ok({ near: 'n1' })).toBe(true)
    expect(ok({ beyond: 'n1', from: 'n3' })).toBe(true)
  })

  it('refuses the space form, the orientation form, a lone beyond, mixed forms and extra keys', () => {
    expect(ok({ on: 'space-1' })).toBe(false)
    expect(ok({ near: 'n1', facing: 'north' })).toBe(false)
    expect(ok({ beyond: 'n1' })).toBe(false)
    expect(ok({ near: 'n1', beyond: 'n3' })).toBe(false)
    expect(ok({ near: 'n1', extra: true })).toBe(false)
    expect(ok({ near: 'n1', actor: 'human' })).toBe(false)
    expect(CreateNoteArgs.safeParse({ ...base, where: { near: 'n1' }, actor: 'human' }).success).toBe(false)
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
