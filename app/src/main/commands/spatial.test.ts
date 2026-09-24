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
import { agentActor, humanActor } from './actor'
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
function seedAs(actor: typeof CLAUDE, seeds: NoteSeed[], into: OpenTree = tree): string[] {
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

function placeOk(args: PlaceCall, actor = CLAUDE, commands = spatial): PlaceResult {
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
