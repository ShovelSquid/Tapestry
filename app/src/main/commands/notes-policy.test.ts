/**
 * D-05: an agent may read anything and connect anything, but may change only
 * what it created.
 *
 * The rule rests on the journal, not on a field: authorship comes from the
 * `actor` line of the commit that created the node (Plan 02's history index).
 * There is no created-by property for a writer to set about itself, so a
 * refusal here cannot be talked around by a model that ignores instructions,
 * and an agent cannot grant itself ownership by claiming it.
 *
 * Every refusal is asserted twice: that it returns `{ ok: false }`, and that
 * **nothing was written** — the file's size and the note's stored text are
 * unchanged. A refusal that still appended a commit would be a change that
 * D-05 exists to prevent.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { agentActor, humanActor, type Actor } from './actor'
import { ConnectionCommands } from './connections'
import { AGENT_NOTES_OPEN_TO_AGENTS, NON_AGENT_NOTES_DELETE_LOCKED } from './locks'
import { NoteCommands, docJsonToPlainText, plainTextToDocJson } from './notes'

const CLAUDE = agentActor('claude')
const CHATGPT = agentActor('chatgpt')
const KAELEN = humanActor('kaelen')

let dir: string
let treePath: string
let registry: TreeRegistry
let tree: OpenTree
let notes: NoteCommands
let connections: ConnectionCommands

/** Notes created by an agent, for the tests about what it may change. */
let claudeNote: string

/**
 * A world with n1 written by user.kaelen and one note grown by agent.claude.
 *
 * The agent's note is created through the command layer rather than by a raw
 * submit, so its authorship is recorded exactly as a real agent write records
 * it — the thing every assertion below reads back.
 */
beforeEach(() => {
  dir = makeTempDir('notes-policy')
  treePath = join(dir, 'policy.tree')
  registry = new TreeRegistry()
  tree = registry.create(treePath, 'policy')
  notes = new NoteCommands(registry)
  connections = new ConnectionCommands(registry)

  tree.bridge.submitAs(KAELEN, 'Create note', [
    {
      op: 'createNode',
      type: 'tapestry.notes/note@1',
      props: {
        'position.x': { type: 'real', value: 0 },
        'position.y': { type: 'real', value: 0 },
        title: { type: 'text', value: 'Seed' },
        body: { type: 'text', value: plainTextToDocJson('Written by Kaelen') },
      },
    },
  ])

  const grown = notes.createFrom(CLAUDE, {
    tree: 'policy',
    grewFrom: 'n1',
    title: 'Luna',
    text: 'Grown by Claude',
  })
  if (!grown.ok) throw new Error(`setup failed: ${grown.error}`)
  claudeNote = grown.value.note
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

function bodyTextOf(noteId: string): string {
  return docJsonToPlainText(String(tree.bridge.getNode(noteId)!.props['body']?.value ?? ''))
}

function titleOf(noteId: string): string {
  return String(tree.bridge.getNode(noteId)!.props['title']?.value ?? '')
}

// ---------------------------------------------------------------------------
// An agent changing its own notes (D-05, allowed)
// ---------------------------------------------------------------------------

describe('an agent changing a note it created', () => {
  it('updates the text in one commit signed agent.claude', () => {
    const result = notes.updateNote(CLAUDE, {
      tree: 'policy',
      note: claudeNote,
      text: 'Rewritten by Claude',
    })

    expect(result.ok).toBe(true)
    expect(bodyTextOf(claudeNote)).toBe('Rewritten by Claude')

    const block = lastCommitBlock()
    expect(block).toContain('actor plugin agent.claude')
    expect(block).toContain(`update note ${claudeNote}`)
  })

  it('renames it in one commit signed agent.claude', () => {
    const result = notes.renameNote(CLAUDE, {
      tree: 'policy',
      note: claudeNote,
      title: 'Lunara',
    })

    expect(result.ok).toBe(true)
    expect(titleOf(claudeNote)).toBe('Lunara')
    expect(lastCommitBlock()).toContain('actor plugin agent.claude')
  })

  it('deletes it in one commit signed agent.claude', () => {
    const result = notes.deleteNote(CLAUDE, { tree: 'policy', note: claudeNote })

    expect(result.ok).toBe(true)
    expect(tree.bridge.getNode(claudeNote)).toBeNull()
    expect(lastCommitBlock()).toContain('actor plugin agent.claude')
  })
})

// ---------------------------------------------------------------------------
// An agent changing somebody else's note (D-05, refused)
// ---------------------------------------------------------------------------

describe("an agent changing a note it did not create", () => {
  it('refuses to update a note created by user.kaelen, and writes nothing', () => {
    const before = worldFingerprint()

    const result = notes.updateNote(CLAUDE, {
      tree: 'policy',
      note: 'n1',
      text: 'Claude was here',
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('n1 text is locked by user.kaelen')
    // Nothing was appended, and the note still says what Kaelen wrote.
    expect(worldFingerprint()).toEqual(before)
    expect(bodyTextOf('n1')).toBe('Written by Kaelen')
  })

  it('refuses to rename a note created by user.kaelen, and writes nothing', () => {
    const before = worldFingerprint()

    const result = notes.renameNote(CLAUDE, { tree: 'policy', note: 'n1', title: 'Claimed' })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('n1 text is locked by user.kaelen')
    expect(worldFingerprint()).toEqual(before)
    expect(titleOf('n1')).toBe('Seed')
  })

  it('deletes a note created by user.kaelen only if its delete is open (NON_AGENT_NOTES_DELETE_LOCKED)', () => {
    const before = worldFingerprint()

    const result = notes.deleteNote(CLAUDE, { tree: 'policy', note: 'n1' })

    if (NON_AGENT_NOTES_DELETE_LOCKED) {
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe('n1 delete is locked by user.kaelen')
      expect(worldFingerprint()).toEqual(before)
      expect(tree.bridge.getNode('n1')).not.toBeNull()
    } else {
      expect(result.ok).toBe(true)
      expect(tree.bridge.getNode('n1')).toBeNull()
    }
  })

  /**
   * 02.2 D-06 still makes agents distinguishable from each other. 02.4 D-06
   * makes a note an agent created open to every agent by default, so whether
   * another agent may change it follows AGENT_NOTES_OPEN_TO_AGENTS. When the
   * constant is false, the note is locked to the agent that created it.
   */
  it("lets one agent update another agent's note unless it is locked (AGENT_NOTES_OPEN_TO_AGENTS)", () => {
    const before = worldFingerprint()

    const result = notes.updateNote(CHATGPT, {
      tree: 'policy',
      note: claudeNote,
      text: 'ChatGPT was here',
    })

    if (AGENT_NOTES_OPEN_TO_AGENTS) {
      expect(result.ok).toBe(true)
      expect(bodyTextOf(claudeNote)).toBe('ChatGPT was here')
      expect(lastCommitBlock()).toContain('actor plugin agent.chatgpt')
    } else {
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe(
        `${claudeNote} text is locked by agent.claude`,
      )
      expect(worldFingerprint()).toEqual(before)
      expect(bodyTextOf(claudeNote)).toBe('Grown by Claude')
    }
  })

  it('refuses a note that is not live at all', () => {
    const before = worldFingerprint()

    const result = notes.updateNote(CLAUDE, { tree: 'policy', note: 'n99', text: 'hi' })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('n99 is not a live note in policy')
    expect(worldFingerprint()).toEqual(before)
  })

  /** A person is not restricted: D-05 limits agents, not the human. */
  it('lets user.kaelen change a note an agent created', () => {
    const result = notes.updateNote(KAELEN, {
      tree: 'policy',
      note: claudeNote,
      text: 'Kaelen edited this',
    })

    expect(result.ok).toBe(true)
    expect(bodyTextOf(claudeNote)).toBe('Kaelen edited this')
  })
})

// ---------------------------------------------------------------------------
// Connections (D-05: any agent may connect any notes)
// ---------------------------------------------------------------------------

describe('connect_notes', () => {
  it('connects a human note to an agent note, for an agent that owns neither', () => {
    const result = connections.connect(CHATGPT, {
      from: { tree: 'policy', note: 'n1' },
      to: { tree: 'policy', note: claudeNote },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const edge = tree.bridge.getEdges().find((e) => e.id === result.value.edge)!
    expect(edge.from).toBe('n1')
    expect(edge.to).toBe(claudeNote)
    // The same label a human connection uses (App.tsx handleEdgeCreate).
    expect(edge.label).toBe('link')
    expect(lastCommitBlock()).toContain('actor plugin agent.chatgpt')
  })

  it("stores a given label as Tapestry's own edge property", () => {
    const result = connections.connect(CLAUDE, {
      from: { tree: 'policy', note: 'n1' },
      to: { tree: 'policy', note: claudeNote },
      label: 'grew out of this thought',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const edge = tree.bridge.getEdges().find((e) => e.id === result.value.edge)!
    expect(edge.props['tapestry.label']?.value).toBe('grew out of this thought')
  })

  it('refuses a label longer than 80 characters, and writes nothing', () => {
    const before = worldFingerprint()

    const result = connections.connect(CLAUDE, {
      from: { tree: 'policy', note: 'n1' },
      to: { tree: 'policy', note: claudeNote },
      label: 'x'.repeat(81),
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('at most 80 characters')
    expect(worldFingerprint()).toEqual(before)
  })

  it('refuses endpoints in different trees, and writes nothing', () => {
    // A second world. Its name differs from the first because a tree's id is
    // the digest of its header, and two same-named worlds created in the same
    // second would collide.
    const otherPath = join(dir, 'other.tree')
    const other = registry.create(otherPath, 'other')
    other.bridge.submitAs(KAELEN, 'Create note', [
      {
        op: 'createNode',
        type: 'tapestry.notes/note@1',
        props: { title: { type: 'text', value: 'Elsewhere' } },
      },
    ])

    const before = worldFingerprint()

    const result = connections.connect(CLAUDE, {
      from: { tree: 'policy', note: 'n1' },
      to: { tree: 'other', note: 'n1' },
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('from and to must be in the same tree')
    expect(worldFingerprint()).toEqual(before)
  })

  it('refuses an endpoint that is not a live note, and writes nothing', () => {
    const before = worldFingerprint()

    const result = connections.connect(CLAUDE, {
      from: { tree: 'policy', note: 'n1' },
      to: { tree: 'policy', note: 'n99' },
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe('n99 is not a live note in policy')
    expect(worldFingerprint()).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// search_notes (read-only: D-05 lets an agent read anything)
// ---------------------------------------------------------------------------

describe('search_notes', () => {
  it('finds a case-insensitive substring in a title and in the text', () => {
    const byTitle = notes.searchNotes({ tree: 'policy', query: 'luna' })
    expect(byTitle.ok).toBe(true)
    if (!byTitle.ok) return
    expect(byTitle.value.map((r) => r.note)).toEqual([claudeNote])

    const byText = notes.searchNotes({ tree: 'policy', query: 'WRITTEN BY KAELEN' })
    expect(byText.ok).toBe(true)
    if (!byText.ok) return
    expect(byText.value.map((r) => r.note)).toEqual(['n1'])
  })

  it('searches every open tree when no tree is named', () => {
    const otherPath = join(dir, 'searchable.tree')
    const other = registry.create(otherPath, 'searchable')
    other.bridge.submitAs(KAELEN, 'Create note', [
      {
        op: 'createNode',
        type: 'tapestry.notes/note@1',
        props: { title: { type: 'text', value: 'Luna in another tree' } },
      },
    ])

    const result = notes.searchNotes({ query: 'luna' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.map((r) => r.treeName).sort()).toEqual(['policy', 'searchable'])
  })

  it('returns no results rather than an error when nothing matches', () => {
    const result = notes.searchNotes({ tree: 'policy', query: 'nothing here says this' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([])
  })

  it('caps a snippet at 120 characters', () => {
    const long = `${'a'.repeat(400)} findme ${'b'.repeat(400)}`
    const grown = notes.createFrom(CLAUDE, {
      tree: 'policy',
      grewFrom: 'n1',
      title: 'Long',
      text: long,
    })
    expect(grown.ok).toBe(true)

    const result = notes.searchNotes({ tree: 'policy', query: 'findme' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toHaveLength(1)
    expect(result.value[0].snippet.length).toBeLessThanOrEqual(120)
    // The snippet is a window around the match, so it shows what was found.
    expect(result.value[0].snippet).toContain('findme')
  })

  it('returns at most `limit` results, defaulting to 20 and capped at 100', () => {
    for (let i = 0; i < 25; i += 1) {
      const grown = notes.createFrom(CLAUDE, {
        tree: 'policy',
        grewFrom: 'n1',
        title: `Repeated ${i}`,
        text: 'needle',
      })
      expect(grown.ok).toBe(true)
    }

    const defaulted = notes.searchNotes({ tree: 'policy', query: 'needle' })
    expect(defaulted.ok).toBe(true)
    if (!defaulted.ok) return
    expect(defaulted.value).toHaveLength(20)

    const limited = notes.searchNotes({ tree: 'policy', query: 'needle', limit: 5 })
    expect(limited.ok).toBe(true)
    if (!limited.ok) return
    expect(limited.value).toHaveLength(5)

    const tooMany = notes.searchNotes({ tree: 'policy', query: 'needle', limit: 1000 })
    expect(tooMany.ok).toBe(false)
    expect(tooMany.ok === false && tooMany.error).toContain('limit')
  })
})

// ---------------------------------------------------------------------------
// Agent writes into a rewound tree (UA-14, research Pitfall 10)
// ---------------------------------------------------------------------------

describe('an agent writing while Kaelen has undone changes', () => {
  it('returns the tree to its latest state, appends the commit, and says so once', () => {
    const discarded: Array<{ treeId: string; actorId: string }> = []
    const hooked = new NoteCommands(registry, {
      onRedoDiscarded: (treeId: string, actor: Actor) => {
        discarded.push({ treeId, actorId: actor.id })
      },
    })

    // Kaelen undoes: the displayed world sits behind the journal head.
    expect(tree.bridge.undo()).toBe(true)
    expect(tree.bridge.isRewound).toBe(true)

    const result = hooked.createFrom(CLAUDE, {
      tree: 'policy',
      grewFrom: 'n1',
      title: 'Arrived anyway',
      text: 'hi',
    })

    // The agent's write lands rather than failing silently...
    expect(result.ok).toBe(true)
    // ...the view is back at the latest state...
    expect(tree.bridge.isRewound).toBe(false)
    // ...redo is genuinely gone, not merely hidden...
    expect(tree.bridge.redo()).toBe(false)
    // ...and Kaelen is told exactly once.
    expect(discarded).toEqual([{ treeId: tree.id, actorId: 'agent.claude' }])
  })

  it('does not announce a discarded redo when nothing was rewound', () => {
    const discarded: string[] = []
    const hooked = new NoteCommands(registry, {
      onRedoDiscarded: (treeId: string) => {
        discarded.push(treeId)
      },
    })

    const result = hooked.createFrom(CLAUDE, {
      tree: 'policy',
      grewFrom: 'n1',
      title: 'Ordinary',
      text: 'hi',
    })

    expect(result.ok).toBe(true)
    expect(discarded).toEqual([])
  })

  it('reconciles a rewound tree for an update too', () => {
    expect(tree.bridge.undo()).toBe(true)

    const result = notes.updateNote(CLAUDE, {
      tree: 'policy',
      note: claudeNote,
      text: 'Written past the undo',
    })

    expect(result.ok).toBe(true)
    expect(tree.bridge.isRewound).toBe(false)
    expect(bodyTextOf(claudeNote)).toBe('Written past the undo')
  })
})
