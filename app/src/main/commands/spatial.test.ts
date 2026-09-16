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
import { LOOK_DEFAULT_LIMIT, SpatialCommands, type LookResult } from './spatial'
import { runAgentTool, type AgentCommands } from './agent-tools'

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
