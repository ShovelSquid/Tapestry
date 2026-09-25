/**
 * `look`: what an agent sees around a note (Phase 2.5 SC1, D-12, D-14).
 *
 * These run against the real addon. Every refusal is checked for two things:
 * that it returns `{ ok: false }`, and that the `.tree` file did not change.
 * `look` is read-only, so even a successful call must leave the file, a
 * rewound view and the redo hook exactly as they were.
 *
 * D-14 is checked by walking the whole reply: the only numbers an agent is
 * ever handed are the `order` counters, and no refusal carries a coordinate.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import type { OpObject } from '../kernel-bridge'
import { agentActor, humanActor, type Actor } from './actor'
import { NoteCommands } from './notes'
import { ConnectionCommands } from './connections'
import {
  LOOK_DEFAULT_LIMIT,
  SpatialCommands,
  heldByPerson,
  placeMessage,
  placeOps,
  type LookResult,
  type PlaceResult,
} from './spatial'
import { runAgentTool, type AgentCommands } from './agent-tools'
import { PlaceArgs } from '../mcp/schemas'
import { displayPositions, type WherePlacement } from '../../renderer/layout/placement'

const KAELEN = humanActor('kaelen')
const CLAUDE = agentActor('claude')
const CHATGPT = agentActor('chatgpt')
/** The Obsidian bridge: a plugin that is not an agent, as it signs vault notes. */
const BRIDGE: Actor = { kind: 'plugin', id: 'obsidian.bridge' }
const VAULT_NOTE_TYPE = 'obsidian.vault/note@1'

const NOTE_TYPE = 'tapestry.notes/note@1'
const KNOT_TYPE = 'tapestry.notes/thread-center@1'

let dir: string
let treePath: string
let registry: TreeRegistry
let tree: OpenTree
let spatial: SpatialCommands

beforeEach(() => {
  dir = makeTempDir('spatial')
  treePath = join(dir, 'spatial.tree')
  registry = new TreeRegistry()
  tree = registry.create(treePath, 'spatial')
  spatial = new SpatialCommands(registry)
})

afterEach(() => {
  try {
    registry.closeAll()
  } catch {
    // Already closed.
  }
  rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NoteSeed {
  x?: number
  y?: number
  width?: number
  height?: number
  type?: string
  pinned?: boolean
}

function createOp(seed: NoteSeed): OpObject {
  const props: Record<string, { type: string; value: string | number | boolean }> = {
    title: { type: 'text', value: 'Note' },
    body: { type: 'text', value: '' },
  }
  if (seed.x !== undefined) props['position.x'] = { type: 'real', value: seed.x }
  if (seed.y !== undefined) props['position.y'] = { type: 'real', value: seed.y }
  if (seed.width !== undefined) props['width'] = { type: 'real', value: seed.width }
  if (seed.height !== undefined) props['height'] = { type: 'real', value: seed.height }
  if (seed.pinned !== undefined) props['pinned'] = { type: 'bool', value: seed.pinned }
  return { op: 'createNode', type: seed.type ?? NOTE_TYPE, props }
}

/** Seed notes in one commit into `into`; returns the ids the kernel issued. */
function seed(seeds: NoteSeed[], into: OpenTree = tree): string[] {
  return into.bridge.submitAs(KAELEN, 'Seed notes', seeds.map(createOp)).nodeIds
}

/** `child` grew from `parent`. */
function grow(child: string, parent: string): void {
  tree.bridge.submitAs(KAELEN, 'Grow', [
    { op: 'createEdge', from: child, to: parent, label: 'grew-from' },
  ])
}

/** The part of the world a read must never change. */
function fileSize(): number {
  return statSync(treePath).size
}

/** Every number anywhere in `value`, with the key path that led to it. */
function numbersIn(value: unknown, path: string[] = []): Array<{ path: string[]; value: number }> {
  if (typeof value === 'number') return [{ path, value }]
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => numbersIn(item, [...path, String(index)]))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => numbersIn(item, [...path, key]))
  }
  return []
}

function lookOk(args: Parameters<SpatialCommands['look']>[0]): LookResult {
  const result = spatial.look(args)
  if (!result.ok) throw new Error(`look refused: ${result.error}`)
  return result.value
}

function lookError(args: Parameters<SpatialCommands['look']>[0]): string {
  const before = fileSize()
  const result = spatial.look(args)
  expect(result.ok).toBe(false)
  expect(fileSize()).toBe(before)
  return result.ok ? '' : result.error
}

// ---------------------------------------------------------------------------
// The reply
// ---------------------------------------------------------------------------

describe('look replies', () => {
  it('returns exactly note, space, relation, order and guess, nearest first', () => {
    seed([
      { x: 0, y: 0 },
      { x: 360, y: 0 },
      { x: 2000, y: 0 },
      { x: 100, y: 50 },
    ])

    const value = lookOk({ tree: 'spatial', from: 'n1' })
    expect(value.tree).toBe(tree.id)
    expect(value.from).toBe('n1')
    expect(value.neighbours).toEqual([
      { note: 'n4', space: tree.id, relation: 'overlapping', order: 1, guess: false },
      { note: 'n2', space: tree.id, relation: 'near', order: 2, guess: false },
      { note: 'n3', space: tree.id, relation: 'beyond', order: 3, guess: false },
    ])
    for (const neighbour of value.neighbours) {
      expect(Object.keys(neighbour).sort()).toEqual(['guess', 'note', 'order', 'relation', 'space'])
    }
  })

  it('uses stored sizes when a note has them', () => {
    seed([
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 10, y: 10, width: 20, height: 20 },
    ])
    expect(lookOk({ tree: 'spatial', from: 'n1' }).neighbours[0].relation).toBe('contains')
    expect(lookOk({ tree: 'spatial', from: 'n2' }).neighbours[0].relation).toBe('contained-by')
  })

  it('defaults to 20 results', () => {
    const seeds: NoteSeed[] = []
    for (let i = 0; i < 30; i++) seeds.push({ x: i * 400, y: 0 })
    seed(seeds)

    const value = lookOk({ tree: 'spatial', from: 'n1' })
    expect(LOOK_DEFAULT_LIMIT).toBe(20)
    expect(value.neighbours).toHaveLength(20)
    expect(value.neighbours.map((n) => n.order)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it('honours a limit above 100 (no ceiling)', () => {
    const seeds: NoteSeed[] = []
    for (let i = 0; i < 102; i++) seeds.push({ x: i * 400, y: 0 })
    seed(seeds)

    expect(lookOk({ tree: 'spatial', from: 'n1', limit: 150 }).neighbours).toHaveLength(101)
    expect(lookOk({ tree: 'spatial', from: 'n1', limit: 3 }).neighbours).toHaveLength(3)
  })

  it('leaves out knots and unplaced notes', () => {
    seed([{ x: 0, y: 0 }, { x: 300, y: 0, type: KNOT_TYPE }, {}, { x: 600, y: 0 }])

    const value = lookOk({ tree: 'spatial', from: 'n1' })
    expect(value.neighbours.map((n) => n.note)).toEqual(['n4'])
  })

  it('reports guess true for a note that follows its parent', () => {
    seed([
      { x: 0, y: 0 },
      { x: 360, y: 0, pinned: false },
      { x: 0, y: 200, pinned: true },
    ])
    grow('n2', 'n1')
    grow('n3', 'n1')

    const value = lookOk({ tree: 'spatial', from: 'n1' })
    const byNote = new Map(value.neighbours.map((n) => [n.note, n.guess]))
    expect(byNote.get('n2')).toBe(true)
    expect(byNote.get('n3')).toBe(false)
  })

  it('keeps only the notes that lie toward the named note', () => {
    seed([
      { x: 0, y: 0 }, // n1: from
      { x: 2000, y: 0 }, // n2: toward
      { x: 500, y: 0 }, // n3: straight ahead
      { x: 0, y: 800 }, // n4: perpendicular
      { x: -800, y: 0 }, // n5: behind
    ])

    const value = lookOk({ tree: 'spatial', from: 'n1', toward: 'n2' })
    expect(value.neighbours.map((n) => n.note)).toEqual(['n3', 'n2'])
  })
})

// ---------------------------------------------------------------------------
// Following notes: look sees them where they are drawn (D-02, D-05)
// ---------------------------------------------------------------------------

/** How many commits the file holds: each one writes exactly one `recorded` line. */
function commitCount(): number {
  return (readFileSync(treePath, 'utf8').match(/^recorded /gm) ?? []).length
}

function neighbourOf(value: LookResult, note: string) {
  return value.neighbours.find((n) => n.note === note)
}

describe('look and following notes', () => {
  it('reports a following note where it is drawn, beside its parent, as a guess', () => {
    seed([{ x: 0, y: 0 }, { x: 2000, y: 2000, pinned: false }])
    grow('n2', 'n1')

    const value = lookOk({ tree: 'spatial', from: 'n1' })
    expect(neighbourOf(value, 'n2')).toEqual({
      note: 'n2',
      space: tree.id,
      relation: 'near',
      order: 1,
      guess: true,
    })
  })

  it('keeps a grown note with no pinned, or pinned true, at its stored spot (D-02)', () => {
    seed([{ x: 0, y: 0 }, { x: 2000, y: 2000 }, { x: 2000, y: 2400, pinned: true }])
    grow('n2', 'n1')
    grow('n3', 'n1')

    const value = lookOk({ tree: 'spatial', from: 'n1' })
    expect(neighbourOf(value, 'n2')).toMatchObject({ relation: 'beyond', guess: false })
    expect(neighbourOf(value, 'n3')).toMatchObject({ relation: 'beyond', guess: false })
  })

  it("moves a follower with its parent without touching the follower's stored props (D-05)", () => {
    seed([{ x: 0, y: 0 }, { x: 2000, y: 2000, pinned: false }])
    grow('n2', 'n1')
    const followerBefore = tree.bridge.getNode('n2')
    const commitsBefore = commitCount()

    tree.bridge.submitAs(KAELEN, 'Move note', [
      { op: 'setProperty', target: 'n1', key: 'position.x', type: 'real', value: 5000 },
      { op: 'setProperty', target: 'n1', key: 'position.y', type: 'real', value: -3000 },
    ])

    expect(commitCount()).toBe(commitsBefore + 1)
    expect(tree.bridge.getNode('n1')?.props['position.x']?.value).toBe(5000)
    const followerAfter = tree.bridge.getNode('n2')
    for (const key of ['position.x', 'position.y', 'pinned']) {
      expect(followerAfter?.props[key]).toEqual(followerBefore?.props[key])
    }

    const size = fileSize()
    const value = lookOk({ tree: 'spatial', from: 'n1' })
    expect(neighbourOf(value, 'n2')).toMatchObject({ relation: 'near', guess: true })
    expect(fileSize()).toBe(size)
    expect(commitCount()).toBe(commitsBefore + 1)
  })

  it('measures from where a follower is drawn when looking from it', () => {
    seed([
      { x: 0, y: 0 }, // n1: parent
      { x: 2000, y: 2000, pinned: false }, // n2: follower, drawn at 360, 0
      { x: 700, y: 0 }, // n3: 60 right of n2's drawn spot
    ])
    grow('n2', 'n1')

    const value = lookOk({ tree: 'spatial', from: 'n2' })
    expect(neighbourOf(value, 'n3')).toMatchObject({ relation: 'near', order: 1, guess: false })
    expect(neighbourOf(value, 'n1')).toMatchObject({ relation: 'near', order: 2, guess: false })
  })

  it('still lists a follower that has no stored position, and looks from it', () => {
    seed([{ x: 0, y: 0 }, { pinned: false }])
    grow('n2', 'n1')

    expect(neighbourOf(lookOk({ tree: 'spatial', from: 'n1' }), 'n2')).toMatchObject({
      relation: 'near',
      guess: true,
    })
    expect(neighbourOf(lookOk({ tree: 'spatial', from: 'n2' }), 'n1')).toMatchObject({
      relation: 'near',
      guess: false,
    })
  })

  it('uses the drawn spot of a follower named as toward', () => {
    seed([
      { x: 0, y: 0 }, // n1: parent, drawn at 0, 0
      { x: 0, y: 5000, pinned: false }, // n2: follower drawn at 360, 0, stored far below
      { x: 1200, y: 0 }, // n3: straight toward n2's drawn spot
      { x: 0, y: 1500 }, // n4: toward n2's stored spot only
    ])
    grow('n2', 'n1')

    const value = lookOk({ tree: 'spatial', from: 'n1', toward: 'n2' })
    expect(value.neighbours.map((n) => n.note)).toEqual(['n2', 'n3'])
  })
})

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe('look refusals', () => {
  beforeEach(() => {
    seed([{ x: 0, y: 0 }, {}, { x: 0, y: 0, type: KNOT_TYPE }, { x: 0, y: 0 }, { x: 900, y: 0 }])
  })

  it('refuses a limit that is not a positive whole number', () => {
    expect(lookError({ tree: 'spatial', from: 'n1', limit: 0 })).toBe(
      'limit must be a positive whole number',
    )
    expect(lookError({ tree: 'spatial', from: 'n1', limit: 1.5 })).toBe(
      'limit must be a positive whole number',
    )
  })

  it('refuses an unknown tree', () => {
    expect(lookError({ tree: 'no-such-tree', from: 'n1' })).toContain('no-such-tree')
  })

  it('refuses malformed and missing notes', () => {
    expect(lookError({ tree: 'spatial', from: 'bogus' })).toBe(
      'bogus is not a live note in spatial',
    )
    expect(lookError({ tree: 'spatial', from: 'n99' })).toBe('n99 is not a live note in spatial')
  })

  it('refuses an unplaced note or a knot as from', () => {
    expect(lookError({ tree: 'spatial', from: 'n2' })).toBe('n2 is not placed in spatial')
    expect(lookError({ tree: 'spatial', from: 'n3' })).toBe('n3 is not placed in spatial')
  })

  it('refuses a bad toward', () => {
    expect(lookError({ tree: 'spatial', from: 'n1', toward: 'bogus' })).toBe(
      'toward bogus is not a live note in spatial',
    )
    expect(lookError({ tree: 'spatial', from: 'n1', toward: 'n1' })).toBe(
      'n1 cannot look toward itself',
    )
    expect(lookError({ tree: 'spatial', from: 'n1', toward: 'n99' })).toBe(
      'toward n99 is not a live note in spatial',
    )
    expect(lookError({ tree: 'spatial', from: 'n1', toward: 'n3' })).toBe(
      'toward n3 is not a live note in spatial',
    )
    expect(lookError({ tree: 'spatial', from: 'n1', toward: 'n2' })).toBe(
      'toward n2 is not placed in spatial',
    )
    expect(lookError({ tree: 'spatial', from: 'n1', toward: 'n4' })).toBe(
      'toward n4 has the same centre as n1 in spatial',
    )
  })

  it('refuses an id that is live only in another open tree as not a live note in spatial (D-12)', () => {
    const other = registry.create(join(dir, 'other.tree'), 'other')
    const ids = seed(
      Array.from({ length: 9 }, (_, i) => ({ x: i * 400, y: 0 })),
      other,
    )
    expect(ids).toContain('n9')
    expect(tree.bridge.getNode('n9')).toBeNull()

    expect(lookError({ tree: 'spatial', from: 'n9' })).toBe('n9 is not a live note in spatial')
    expect(lookError({ tree: 'spatial', from: 'n1', toward: 'n9' })).toBe(
      'toward n9 is not a live note in spatial',
    )
  })
})

// ---------------------------------------------------------------------------
// D-14: no coordinates anywhere
// ---------------------------------------------------------------------------

describe('look never hands out coordinates (D-14)', () => {
  it('walks the reply and finds numbers only under order', () => {
    seed([
      { x: 12.5, y: 37.25, width: 310, height: 140 },
      { x: 400, y: 0 },
      { x: 5000, y: 7000 },
      { x: 20, y: 40, width: 10, height: 10 },
    ])

    const value = lookOk({ tree: 'spatial', from: 'n1' })
    const numbers = numbersIn(value)
    expect(numbers.length).toBe(value.neighbours.length)
    for (const found of numbers) {
      expect(found.path[found.path.length - 1]).toBe('order')
    }
    expect(JSON.stringify(value)).not.toContain('position')
  })

  it('carries no digit in any refusal once node ids are removed', () => {
    seed([{ x: 123, y: 456 }, {}, { x: 123, y: 456 }])

    const errors = [
      lookError({ tree: 'spatial', from: 'n1', limit: 0 }),
      lookError({ tree: 'spatial', from: 'n77' }),
      lookError({ tree: 'spatial', from: 'n2' }),
      lookError({ tree: 'spatial', from: 'n1', toward: 'n2' }),
      lookError({ tree: 'spatial', from: 'n1', toward: 'n3' }),
      lookError({ tree: 'spatial', from: 'n1', toward: 'n1' }),
      lookError({ tree: 'spatial', from: 'n1', toward: 'n55' }),
    ]
    for (const error of errors) {
      expect(error.replace(/\bn[1-9][0-9]*\b/g, '')).not.toMatch(/[0-9]/)
    }
  })
})

// ---------------------------------------------------------------------------
// Read-only
// ---------------------------------------------------------------------------

describe('look is read-only', () => {
  it('succeeds on a rewound tree without reconciling it or announcing a discarded redo', () => {
    seed([{ x: 0, y: 0 }])
    seed([{ x: 400, y: 0 }])

    const discarded: string[] = []
    const hooked = new SpatialCommands(registry, {
      onRedoDiscarded: (treeId: string) => {
        discarded.push(treeId)
      },
      onCommitted: () => {
        throw new Error('look must not commit')
      },
    })

    expect(tree.bridge.undo()).toBe(true)
    expect(tree.bridge.isRewound).toBe(true)
    const before = fileSize()

    const result = hooked.look({ tree: 'spatial', from: 'n1' })
    expect(result.ok).toBe(true)
    expect(tree.bridge.isRewound).toBe(true)
    expect(discarded).toEqual([])
    expect(fileSize()).toBe(before)
  })

  it('leaves the file unchanged after a successful look', () => {
    seed([{ x: 0, y: 0 }, { x: 400, y: 0 }])
    const before = fileSize()
    lookOk({ tree: 'spatial', from: 'n1' })
    lookOk({ tree: 'spatial', from: 'n1', toward: 'n2' })
    expect(fileSize()).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Through the agent dispatch
// ---------------------------------------------------------------------------

describe('look through runAgentTool', () => {
  let commands: AgentCommands

  beforeEach(() => {
    seed([{ x: 0, y: 0 }, { x: 400, y: 0 }])
    commands = {
      notes: new NoteCommands(registry),
      connections: new ConnectionCommands(registry),
      spatial,
    }
  })

  it('refuses an extra actor key', () => {
    const before = fileSize()
    const result = runAgentTool(commands, CLAUDE, 'look', {
      tree: 'spatial',
      from: 'n1',
      actor: 'human',
    })
    expect(result.ok).toBe(false)
    expect(fileSize()).toBe(before)
  })

  it('accepts a limit of 1000', () => {
    const result = runAgentTool(commands, CLAUDE, 'look', {
      tree: 'spatial',
      from: 'n1',
      limit: 1000,
    })
    expect(result.ok).toBe(true)
    expect(result.ok && (result.value as LookResult).neighbours).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// place (Plan 04): the success path
// ---------------------------------------------------------------------------

/** Seed notes made by `actor` in one commit. Agent-made notes start open under 2.4's layout default. */
function seedAs(actor: Actor, seeds: NoteSeed[], into: OpenTree = tree): string[] {
  return into.bridge.submitAs(actor, 'Seed notes', seeds.map(createOp)).nodeIds
}

function treeText(): string {
  return readFileSync(treePath, 'utf8')
}

/** The last `@commit` block in the file, up to the end of the file. */
function lastCommitBlock(): string {
  const text = treeText()
  return text.slice(text.lastIndexOf('@commit '))
}

type PlaceCall = { tree: string; note: string; where: WherePlacement }

function placeOk(args: PlaceCall, actor: Actor = CLAUDE, commands: SpatialCommands = spatial): PlaceResult {
  const result = commands.place(actor, args)
  if (!result.ok) throw new Error(`place refused: ${result.error}`)
  return result.value
}

function propOf(note: string, key: string) {
  return tree.bridge.getNode(note)?.props[key]
}

describe('place success', () => {
  it('near its own grew-from parent follows, in one commit that states the intent (D-01, D-04)', () => {
    seed([{ x: 0, y: 0 }])
    seedAs(CLAUDE, [{ x: 2000, y: 2000 }])
    grow('n2', 'n1')

    const value = placeOk({ tree: 'spatial', note: 'n2', where: { near: 'n1' } })
    expect(value).toEqual({ tree: tree.id, note: 'n2', seq: expect.any(Number), follows: true })

    const block = lastCommitBlock()
    expect(block).toContain('actor plugin agent.claude')
    expect(block).toContain('Place note n2 near n1')
    expect(block).toMatch(/^set n2 position\.x real 360$/m)
    expect(block).toMatch(/^set n2 position\.y real 0$/m)
    expect(block).toMatch(/^set n2 pinned bool false$/m)
  })

  it('near another note is fixed and writes no pinned line', () => {
    seed([{ x: 0, y: 0 }, { x: 0, y: 1000 }])
    seedAs(CLAUDE, [{ x: 2000, y: 2000 }])
    grow('n3', 'n1')

    const value = placeOk({ tree: 'spatial', note: 'n3', where: { near: 'n2' } })
    expect(value.follows).toBe(false)
    const block = lastCommitBlock()
    expect(block).toContain('Place note n3 near n2')
    expect(block).toMatch(/^set n3 position\.x real 360$/m)
    expect(block).toMatch(/^set n3 position\.y real 1000$/m)
    expect(block).not.toContain('pinned')
  })

  it('beyond one note from another is fixed and lands 80 right of the beyond-note on a horizontal line', () => {
    seed([{ x: 0, y: 0 }, { x: -800, y: 0 }])
    seedAs(CLAUDE, [{ x: 2000, y: 2000 }])

    const value = placeOk({ tree: 'spatial', note: 'n3', where: { beyond: 'n1', from: 'n2' } })
    expect(value.follows).toBe(false)
    expect(propOf('n3', 'position.x')?.value).toBe(360)
    expect(propOf('n3', 'position.y')?.value).toBe(0)
    expect(lastCommitBlock()).toContain('Place note n3 beyond n1 from n2')
  })

  it('moving a following note to a fixed spot unsets pinned; a note with no pinned gets no unset (D-17)', () => {
    seed([{ x: 0, y: 0 }, { x: 0, y: 1000 }])
    seedAs(CLAUDE, [{ x: 2000, y: 2000, pinned: false }, { x: 3000, y: 3000 }])
    grow('n3', 'n1')

    placeOk({ tree: 'spatial', note: 'n3', where: { near: 'n2' } })
    expect(lastCommitBlock()).toMatch(/^unset n3 pinned$/m)
    expect(propOf('n3', 'pinned')).toBeUndefined()

    placeOk({ tree: 'spatial', note: 'n4', where: { beyond: 'n2', from: 'n1' } })
    const block = lastCommitBlock()
    expect(block).not.toContain('unset')
    expect(block).not.toContain('pinned')
  })

  it('fixing a note with pinned true writes only the two position lines and leaves pinned true (D-17, D-03)', () => {
    seed([{ x: 0, y: 0 }, { x: 0, y: 1000 }])
    seedAs(CLAUDE, [{ x: 2000, y: 2000, pinned: true }])
    grow('n3', 'n1')

    placeOk({ tree: 'spatial', note: 'n3', where: { near: 'n2' } })
    const block = lastCommitBlock()
    const opLines = block.split('\n').filter((line) => /^(set|unset) /.test(line))
    expect(opLines).toEqual(['set n3 position.x real 360', 'set n3 position.y real 1000'])
    expect(propOf('n3', 'pinned')).toEqual({ type: 'bool', value: true })
  })

  it('returns exactly tree, note, seq and follows, and seq is its only number (D-14)', () => {
    seed([{ x: 12.5, y: 37.25 }])
    seedAs(CLAUDE, [{ x: 2000, y: 2000 }])

    const value = placeOk({ tree: 'spatial', note: 'n2', where: { near: 'n1' } })
    expect(Object.keys(value).sort()).toEqual(['follows', 'note', 'seq', 'tree'])
    expect(numbersIn(value).map((found) => found.path)).toEqual([['seq']])
  })

  it('keeps the stored position and pinned across close and reopen, and draws the follower there (D-06)', () => {
    seed([{ x: 0, y: 0 }, { x: 0, y: 200, height: 400 }])
    seedAs(CLAUDE, [{ x: 2000, y: 2000 }])
    grow('n3', 'n1')

    placeOk({ tree: 'spatial', note: 'n3', where: { near: 'n1' } })
    const written = tree.bridge.getNode('n3')!
    const keys = ['position.x', 'position.y', 'pinned']

    registry.closeAll()
    tree = registry.open(treePath)
    const reopened = tree.bridge.getNode('n3')!
    for (const key of keys) expect(reopened.props[key]).toEqual(written.props[key])
    expect(reopened.props['pinned']).toEqual({ type: 'bool', value: false })

    const drawn = displayPositions(tree.bridge.getNodes(), tree.bridge.getEdges(), new Map()).get('n3')
    expect(drawn).toMatchObject({
      x: reopened.props['position.x'].value,
      y: reopened.props['position.y'].value,
      following: true,
    })
  })
})

describe('placeOps, placeMessage and heldByPerson', () => {
  const bare = { id: 'n2', type: NOTE_TYPE, props: {} }
  const withPinned = (value: boolean | string | number, type = 'bool') => ({
    id: 'n2',
    type: NOTE_TYPE,
    props: { pinned: { type, value } },
  })

  it('writes the two positions, and pinned false only when the note will follow', () => {
    expect(placeOps(bare, { x: 1, y: 2, follows: true })).toEqual([
      { op: 'setProperty', target: 'n2', key: 'position.x', type: 'real', value: 1 },
      { op: 'setProperty', target: 'n2', key: 'position.y', type: 'real', value: 2 },
      { op: 'setProperty', target: 'n2', key: 'pinned', type: 'bool', value: false },
    ])
    expect(placeOps(bare, { x: 1, y: 2, follows: false })).toHaveLength(2)
  })

  it('unsets pinned for a fixed placement only when it is exactly the bool false', () => {
    expect(placeOps(withPinned(false), { x: 1, y: 2, follows: false })[2]).toEqual({
      op: 'unsetProperty',
      target: 'n2',
      key: 'pinned',
    })
    expect(placeOps(withPinned('false', 'text'), { x: 1, y: 2, follows: false })).toHaveLength(2)
  })

  it('never writes or unsets pinned on a note with pinned true, whatever follows says', () => {
    for (const follows of [true, false]) {
      const ops = placeOps(withPinned(true), { x: 1, y: 2, follows })
      expect(ops.map((op) => op.key)).toEqual(['position.x', 'position.y'])
    }
  })

  it('only ever emits setProperty of position.x, position.y or pinned, or unsetProperty of pinned (D-08)', () => {
    const notes = [bare, withPinned(false), withPinned(true), withPinned('x', 'text')]
    for (const note of notes) {
      for (const follows of [true, false]) {
        for (const op of placeOps(note, { x: 5, y: 6, follows })) {
          if (op.op === 'setProperty') {
            expect(['position.x', 'position.y', 'pinned']).toContain(op.key)
          } else {
            expect(op).toEqual({ op: 'unsetProperty', target: 'n2', key: 'pinned' })
          }
        }
      }
    }
  })

  it('heldByPerson is false only for no pinned or the bool false', () => {
    expect(heldByPerson(bare)).toBe(false)
    expect(heldByPerson(withPinned(false))).toBe(false)
    expect(heldByPerson(withPinned(true))).toBe(true)
    expect(heldByPerson(withPinned('false', 'text'))).toBe(true)
    expect(heldByPerson(withPinned(0, 'int'))).toBe(true)
  })

  it('names the intent in the message (D-04)', () => {
    expect(placeMessage('n2', { near: 'n1' })).toBe('Place note n2 near n1')
    expect(placeMessage('n2', { beyond: 'n1', from: 'n3' })).toBe('Place note n2 beyond n1 from n3')
  })
})

describe('PlaceArgs (D-11)', () => {
  const ok = (where: unknown) => PlaceArgs.safeParse({ tree: 'spatial', note: 'n2', where }).success

  it('accepts near and beyond-from', () => {
    expect(ok({ near: 'n1' })).toBe(true)
    expect(ok({ beyond: 'n1', from: 'n3' })).toBe(true)
  })

  it('refuses the space form, the orientation form, a lone beyond, mixed forms and extra keys', () => {
    expect(ok({ on: 'space-1' })).toBe(false)
    expect(ok({ near: 'n1', facing: 'north' })).toBe(false)
    expect(ok({ beyond: 'n1' })).toBe(false)
    expect(ok({ near: 'n1', beyond: 'n3' })).toBe(false)
    expect(ok({ near: 'n1', beyond: 'n3', from: 'n4' })).toBe(false)
    expect(ok({ near: 'n1', extra: true })).toBe(false)
    expect(ok({ near: '' })).toBe(false)
    expect(ok('n1')).toBe(false)
  })

  it('refuses an actor key at either level', () => {
    expect(
      PlaceArgs.safeParse({ tree: 'spatial', note: 'n2', where: { near: 'n1' }, actor: 'human' }).success,
    ).toBe(false)
    expect(ok({ near: 'n1', actor: 'human' })).toBe(false)
  })
})

describe('place through runAgentTool', () => {
  it('passes the socket actor, never one from the arguments', () => {
    seed([{ x: 0, y: 0 }])
    seedAs(CLAUDE, [{ x: 2000, y: 2000 }])
    grow('n2', 'n1')
    const commands: AgentCommands = {
      notes: new NoteCommands(registry),
      connections: new ConnectionCommands(registry),
      spatial,
    }

    const result = runAgentTool(commands, CLAUDE, 'place', {
      tree: 'spatial',
      note: 'n2',
      where: { near: 'n1' },
    })
    expect(result.ok).toBe(true)
    expect(lastCommitBlock()).toContain('actor plugin agent.claude')
  })
})

// ---------------------------------------------------------------------------
// place (Plan 04): every refusal writes nothing
// ---------------------------------------------------------------------------

/** Calls made to the hooks `place` is given. */
interface HookCalls {
  committed: number
  discarded: number
}

let calls: HookCalls
let hooked: SpatialCommands

beforeEach(() => {
  calls = { committed: 0, discarded: 0 }
  hooked = new SpatialCommands(registry, {
    onCommitted: () => {
      calls.committed++
    },
    onRedoDiscarded: () => {
      calls.discarded++
    },
  })
})

/** How many commits the file holds, counted by their `@commit` records. */
function commitRecords(): number {
  return (treeText().match(/^@commit /gm) ?? []).length
}

/**
 * Everything a refused `place` must leave alone: the file, the world's
 * counts, the target note's position and pinned, and the onCommitted count.
 */
function fingerprint(note: string) {
  const node = tree.bridge.getNode(note)
  return {
    size: fileSize(),
    nodes: tree.bridge.getNodes().length,
    edges: tree.bridge.getEdges().length,
    commits: commitRecords(),
    x: node?.props['position.x'],
    y: node?.props['position.y'],
    pinned: node?.props['pinned'],
    committed: calls.committed,
  }
}

/** Every refusal sentence seen, for the D-14 digit check. */
const refusals: string[] = []

/** Place, expect a refusal, and prove the widened fingerprint is unchanged. */
function placeError(args: PlaceCall, actor: Actor = CLAUDE): string {
  const before = fingerprint(String(args.note))
  const result = hooked.place(actor, args)
  expect(result.ok).toBe(false)
  expect(fingerprint(String(args.note))).toEqual(before)
  const error = result.ok ? '' : result.error
  refusals.push(error)
  return error
}

/** Set a lock property the way 2.4's fixtures do: a raw `text` setProperty, signed by `by`. */
function setLock(note: string, key: string, value: string, by: Actor): void {
  tree.bridge.submitAs(by, 'Set lock', [{ op: 'setProperty', target: note, key, type: 'text', value }])
}

describe('place refusals write nothing (SC4)', () => {
  beforeEach(() => {
    // n1 placed, n2 unplaced, n3 a knot, n4 on n1's centre: all Kaelen's.
    seed([{ x: 0, y: 0 }, {}, { x: 0, y: 0, type: KNOT_TYPE }, { x: 0, y: 0 }])
    // n5 the agent's note, n6 an agent-made knot.
    seedAs(CLAUDE, [{ x: 2000, y: 2000 }, { x: 900, y: 900, type: KNOT_TYPE }])
  })

  it('refuses an unknown tree', () => {
    expect(placeError({ tree: 'no-such-tree', note: 'n5', where: { near: 'n1' } })).toBe(
      'Unknown tree: no-such-tree',
    )
  })

  it('refuses a malformed note id, a note that is not live, and a knot as the note', () => {
    expect(placeError({ tree: 'spatial', note: 'bogus', where: { near: 'n1' } })).toBe(
      'bogus is not a live note in spatial',
    )
    expect(placeError({ tree: 'spatial', note: 'n99', where: { near: 'n1' } })).toBe(
      'n99 is not a live note in spatial',
    )
    expect(placeError({ tree: 'spatial', note: 'n6', where: { near: 'n1' } })).toBe(
      'n6 is not a note place can move in spatial',
    )
  })

  it('refuses a near or from anchor that is not live, malformed or live', () => {
    expect(placeError({ tree: 'spatial', note: 'n5', where: { near: 'n99' } })).toBe(
      'near n99 is not a live note in spatial',
    )
    expect(placeError({ tree: 'spatial', note: 'n5', where: { near: 'bogus' } })).toBe(
      'near bogus is not a live note in spatial',
    )
    expect(placeError({ tree: 'spatial', note: 'n5', where: { beyond: 'n1', from: 'n99' } })).toBe(
      'from n99 is not a live note in spatial',
    )
    expect(placeError({ tree: 'spatial', note: 'n5', where: { beyond: 'n98', from: 'n1' } })).toBe(
      'beyond n98 is not a live note in spatial',
    )
  })

  it('refuses near an unplaced note and near a knot', () => {
    expect(placeError({ tree: 'spatial', note: 'n5', where: { near: 'n2' } })).toBe(
      'near n2 is not placed in spatial',
    )
    expect(placeError({ tree: 'spatial', note: 'n5', where: { near: 'n3' } })).toBe(
      'near n3 is not placed in spatial',
    )
  })

  it('refuses near itself, from itself, and beyond and from the same note', () => {
    expect(placeError({ tree: 'spatial', note: 'n5', where: { near: 'n5' } })).toBe(
      'n5 cannot be placed relative to itself',
    )
    expect(placeError({ tree: 'spatial', note: 'n5', where: { beyond: 'n1', from: 'n5' } })).toBe(
      'n5 cannot be placed relative to itself',
    )
    expect(placeError({ tree: 'spatial', note: 'n5', where: { beyond: 'n1', from: 'n1' } })).toBe(
      'beyond n1 from n1 names the same note twice',
    )
  })

  it('refuses two distinct anchors with the same centre (no line)', () => {
    expect(placeError({ tree: 'spatial', note: 'n5', where: { beyond: 'n1', from: 'n4' } })).toBe(
      'beyond n1 from n4 has no line to extend in spatial',
    )
  })

  it('refuses a column fully blocked by one tall note (no clear spot)', () => {
    // n7 right of n1, tall enough to cover every one of MAX_PLACE_STEPS steps.
    seed([{ x: 360, y: -100, height: 20000 }])
    expect(placeError({ tree: 'spatial', note: 'n5', where: { near: 'n1' } })).toBe(
      'no clear spot near n1 in spatial',
    )
  })

  it('refuses an anchor live only in another open tree (D-12)', () => {
    const other = registry.create(join(dir, 'other.tree'), 'other')
    seed(
      Array.from({ length: 9 }, (_, i) => ({ x: i * 400, y: 0 })),
      other,
    )
    expect(tree.bridge.getNode('n9')).toBeNull()
    expect(placeError({ tree: 'spatial', note: 'n5', where: { near: 'n9' } })).toBe(
      'near n9 is not a live note in spatial',
    )
  })

  it('refuses to move a note user.kaelen made, with no lock property, naming user.kaelen (SC4, #8)', () => {
    expect(tree.bridge.getNode('n1')?.props['lock.layout']).toBeUndefined()
    expect(placeError({ tree: 'spatial', note: 'n1', where: { near: 'n5' } })).toBe(
      'n1 layout is locked by user.kaelen',
    )
  })

  it('carries no digit in any refusal once node ids are removed (D-14)', () => {
    seed([{ x: 360, y: -100, height: 20000 }])
    placeError({ tree: 'no-such-tree', note: 'n5', where: { near: 'n1' } })
    placeError({ tree: 'spatial', note: 'n77', where: { near: 'n1' } })
    placeError({ tree: 'spatial', note: 'n6', where: { near: 'n1' } })
    placeError({ tree: 'spatial', note: 'n5', where: { near: 'n2' } })
    placeError({ tree: 'spatial', note: 'n5', where: { near: 'n5' } })
    placeError({ tree: 'spatial', note: 'n5', where: { beyond: 'n1', from: 'n1' } })
    placeError({ tree: 'spatial', note: 'n5', where: { beyond: 'n1', from: 'n4' } })
    placeError({ tree: 'spatial', note: 'n5', where: { near: 'n1' } })
    placeError({ tree: 'spatial', note: 'n1', where: { near: 'n5' } })
    expect(refusals.length).toBeGreaterThanOrEqual(9)
    for (const error of refusals) {
      expect(error.replace(/\bn[1-9][0-9]*\b/g, '')).not.toMatch(/[0-9]/)
    }
  })
})

describe("place and a person's takeover (D-17, D-03)", () => {
  beforeEach(() => {
    seed([{ x: 0, y: 0 }, { x: 0, y: 1000 }]) // n1 parent, n2 elsewhere
    seedAs(CLAUDE, [{ x: 360, y: 0, pinned: false }]) // n3 the agent's follower
    grow('n3', 'n1')
    // Kaelen drags it: position and pinned true in one commit (Plan 03's takeover).
    tree.bridge.submitAs(KAELEN, 'Move note', [
      { op: 'setProperty', target: 'n3', key: 'position.x', type: 'real', value: 800 },
      { op: 'setProperty', target: 'n3', key: 'position.y', type: 'real', value: 400 },
      { op: 'setProperty', target: 'n3', key: 'pinned', type: 'bool', value: true },
    ])
  })

  it('refuses near its own parent once pinned by a person, and writes nothing', () => {
    expect(placeError({ tree: 'spatial', note: 'n3', where: { near: 'n1' } })).toBe(
      'n3 was pinned by a person; it will not follow n1 again',
    )
    expect(propOf('n3', 'pinned')).toEqual({ type: 'bool', value: true })
    expect(calls.committed).toBe(0)
  })

  it('places it fixed near another note or beyond, and pinned stays true after reopening', () => {
    const near = placeOk({ tree: 'spatial', note: 'n3', where: { near: 'n2' } }, CLAUDE, hooked)
    expect(near.follows).toBe(false)
    let lines = lastCommitBlock()
      .split('\n')
      .filter((line) => /^(set|unset) /.test(line))
    expect(lines).toEqual(['set n3 position.x real 360', 'set n3 position.y real 1000'])
    expect(propOf('n3', 'pinned')).toEqual({ type: 'bool', value: true })

    placeOk({ tree: 'spatial', note: 'n3', where: { beyond: 'n2', from: 'n1' } }, CLAUDE, hooked)
    lines = lastCommitBlock()
      .split('\n')
      .filter((line) => /^(set|unset) /.test(line))
    expect(lines.map((line) => line.split(' ').slice(0, 3).join(' '))).toEqual([
      'set n3 position.x',
      'set n3 position.y',
    ])
    expect(calls.committed).toBe(2)

    registry.closeAll()
    tree = registry.open(treePath)
    expect(propOf('n3', 'pinned')).toEqual({ type: 'bool', value: true })
  })
})

describe('place and the layout lock (D-15)', () => {
  beforeEach(() => {
    seed([{ x: 0, y: 0 }]) // n1, Kaelen's anchor
    seedAs(CLAUDE, [{ x: 2000, y: 2000 }]) // n2, made by claude, then locked by chatgpt
    setLock('n2', 'lock.layout', 'agent.chatgpt', CHATGPT)
  })

  it('refuses a note whose layout is locked by agent.chatgpt, naming the owner', () => {
    expect(placeError({ tree: 'spatial', note: 'n2', where: { near: 'n1' } })).toBe(
      'n2 layout is locked by agent.chatgpt',
    )
  })

  it('lets an agent listed in lock.layout.allow place it', () => {
    setLock('n2', 'lock.layout.allow', 'agent.gemini agent.claude', CHATGPT)
    expect(placeOk({ tree: 'spatial', note: 'n2', where: { near: 'n1' } }, CLAUDE, hooked).note).toBe('n2')
    expect(calls.committed).toBe(1)
  })

  it('lets any agent place it once lock.layout is open', () => {
    setLock('n2', 'lock.layout', 'open', CHATGPT)
    expect(placeOk({ tree: 'spatial', note: 'n2', where: { near: 'n1' } }, CLAUDE, hooked).note).toBe('n2')
  })

  it("lets the lock's owner place it", () => {
    const value = placeOk({ tree: 'spatial', note: 'n2', where: { near: 'n1' } }, CHATGPT, hooked)
    expect(value.note).toBe('n2')
    expect(lastCommitBlock()).toContain('actor plugin agent.chatgpt')
  })
})

describe('place on a vault note (D-13)', () => {
  function seedVault(by: Actor): string {
    return tree.bridge.submitAs(by, 'Seed vault note', [
      {
        op: 'createNode',
        type: VAULT_NOTE_TYPE,
        props: {
          'position.x': { type: 'real', value: 2000 },
          'position.y': { type: 'real', value: 2000 },
          title: { type: 'text', value: 'Rune' },
          'md.path': { type: 'text', value: 'Characters/Rune.md' },
        },
      },
    ]).nodeIds[0]
  }

  beforeEach(() => {
    seed([{ x: 0, y: 0 }]) // n1, the anchor
  })

  it('refuses a vault note the obsidian.bridge created, by default', () => {
    const id = seedVault(BRIDGE)
    expect(placeError({ tree: 'spatial', note: id, where: { near: 'n1' } })).toBe(
      `${id} layout is locked by obsidian.bridge`,
    )
  })

  it('moves only the Tapestry-side position once its layout is open, leaving md.path byte-equal', () => {
    const id = seedVault(BRIDGE)
    setLock(id, 'lock.layout', 'open', KAELEN)
    const mdBefore = JSON.stringify(propOf(id, 'md.path'))
    const nodesBefore = tree.bridge.getNodes().length

    placeOk({ tree: 'spatial', note: id, where: { near: 'n1' } }, CLAUDE, hooked)

    expect(JSON.stringify(propOf(id, 'md.path'))).toBe(mdBefore)
    expect(propOf(id, 'md.path')).toEqual({ type: 'text', value: 'Characters/Rune.md' })
    expect(tree.bridge.getNodes().length).toBe(nodesBefore)
    expect(lastCommitBlock()).not.toMatch(/ md\./)
  })

  it('places a vault-typed note an agent created, which is open by default', () => {
    const id = seedVault(CLAUDE)
    placeOk({ tree: 'spatial', note: id, where: { near: 'n1' } }, CLAUDE, hooked)
    expect(propOf(id, 'md.path')).toEqual({ type: 'text', value: 'Characters/Rune.md' })
    expect(lastCommitBlock()).not.toMatch(/ md\./)
  })
})

describe('place on a rewound tree', () => {
  beforeEach(() => {
    seed([{ x: 0, y: 0 }, { x: 0, y: 1000 }]) // n1, n2
    seedAs(CLAUDE, [{ x: 2000, y: 2000 }]) // n3
    tree.bridge.submitAs(KAELEN, 'Retitle', [
      { op: 'setProperty', target: 'n1', key: 'title', type: 'text', value: 'Later' },
    ])
    expect(tree.bridge.undo()).toBe(true)
    expect(tree.bridge.isRewound).toBe(true)
  })

  it("refuses from the arguments alone without discarding a person's redo (rewound)", () => {
    const size = fileSize()
    for (const where of [{ near: 'n3' }, { beyond: 'n1', from: 'n1' }, { near: 'bogus' }] as WherePlacement[]) {
      const result = hooked.place(CLAUDE, { tree: 'spatial', note: 'n3', where })
      expect(result.ok).toBe(false)
    }
    const malformed = hooked.place(CLAUDE, { tree: 'spatial', note: 'bogus', where: { near: 'n1' } })
    expect(malformed.ok).toBe(false)

    expect(tree.bridge.isRewound).toBe(true)
    expect(calls.discarded).toBe(0)
    expect(calls.committed).toBe(0)
    expect(fileSize()).toBe(size)
    expect(tree.bridge.redo()).toBe(true)
  })

  it('reconciles a rewound tree for a valid placement, announces the discarded redo once, and commits', () => {
    const commits = commitRecords()
    placeOk({ tree: 'spatial', note: 'n3', where: { near: 'n2' } }, CLAUDE, hooked)
    expect(tree.bridge.isRewound).toBe(false)
    expect(tree.bridge.redo()).toBe(false)
    expect(calls.discarded).toBe(1)
    expect(calls.committed).toBe(1)
    // The retitle was discarded from the view, not from the file; one new commit follows it.
    expect(commitRecords()).toBe(commits + 1)
  })
})

describe('a following note after place (D-05)', () => {
  it("a person's move of the parent is one commit and leaves the follower's stored props alone", () => {
    seed([{ x: 0, y: 0 }])
    seedAs(CLAUDE, [{ x: 2000, y: 2000 }])
    grow('n2', 'n1')
    expect(placeOk({ tree: 'spatial', note: 'n2', where: { near: 'n1' } }, CLAUDE, hooked).follows).toBe(true)
    const followerBefore = tree.bridge.getNode('n2')!
    const commits = commitRecords()

    tree.bridge.submitAs(KAELEN, 'Move note', [
      { op: 'setProperty', target: 'n1', key: 'position.x', type: 'real', value: 5000 },
    ])

    expect(commitRecords()).toBe(commits + 1)
    const followerAfter = tree.bridge.getNode('n2')!
    for (const key of ['position.x', 'position.y', 'pinned']) {
      expect(followerAfter.props[key]).toEqual(followerBefore.props[key])
    }
  })
})

// ---------------------------------------------------------------------------
// Notes inside notes (renderer/layout/nesting.ts)
// ---------------------------------------------------------------------------

describe('look and place with notes inside notes', () => {
  /** n1: a container far to the right; n2: a note at the origin; n3 (Claude's): inside n1. */
  function seedNested(): void {
    seed([
      { x: 1000, y: 0, width: 400, height: 400 },
      { x: 0, y: 0 },
    ])
    tree.bridge.submitAs(CLAUDE, 'Create note', [
      {
        op: 'createNode',
        type: NOTE_TYPE,
        props: {
          title: { type: 'text', value: 'Inner' },
          body: { type: 'text', value: '' },
          'position.x': { type: 'real', value: 24 },
          'position.y': { type: 'real', value: 80 },
          inside: { type: 'ref', value: 'n1' },
        },
      },
    ])
  }

  it('sees a nested note where it is drawn, not at its container-local spot', () => {
    seedNested()
    const value = lookOk({ tree: 'spatial', from: 'n2' })
    const relationOf = (id: string) => value.neighbours.find((n) => n.note === id)?.relation
    // Stored at (24, 80) it would overlap n2; drawn at (1024, 80) it sits
    // beside its container, off to the right.
    expect(relationOf('n3')).toBe(relationOf('n1'))
  })

  it('writes a placed nested note back in its container, on its surface', () => {
    seedNested()
    placeOk({ tree: 'spatial', note: 'n3', where: { near: 'n2' } })
    expect(propOf('n3', 'inside')).toEqual({ type: 'ref', value: 'n1' })
    // The spot beside n2 is left of the container, so it is kept on its
    // surface: at its left edge, below its title row.
    expect(propOf('n3', 'position.x')?.value).toBe(0)
    expect(Number(propOf('n3', 'position.y')?.value)).toBeGreaterThanOrEqual(56)
  })
})
