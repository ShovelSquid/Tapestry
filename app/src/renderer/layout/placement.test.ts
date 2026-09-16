/**
 * Placement geometry is what `look` reports to agents and what `create_note`
 * uses to put a grown note beside its parent (Phase 2.5 D-07, D-18). It is
 * pure arithmetic, so it is pinned here rather than discovered on the canvas.
 *
 * The cases that matter are the boundaries: touching edges, a gap of exactly
 * NEAR_GAP, the 45-degree edge of the toward cone, id order past `n9`, and
 * every way a `pinned` value can look like "false" without being the bool.
 */

import { describe, expect, it } from 'vitest'
import {
  CHILD_GAP,
  DEFAULT_NOTE_HEIGHT,
  DEFAULT_NOTE_WIDTH,
  GREW_FROM_LABEL,
  NEAR_GAP,
  classifyRelation,
  compareIds,
  grewFromParent,
  idNumber,
  isFollowing,
  isKnot,
  isPlaced,
  liesToward,
  noteSize,
  orderNeighbours,
  overlaps,
  rectGap,
  storedRect,
  type PlacementEdge,
  type PlacementNode,
  type PlacementProp,
  type PlacementRect,
} from './placement'

/** A placed note at x, y with any extra stored properties. */
function node(id: string, x: number, y: number, extra: Record<string, PlacementProp> = {}): PlacementNode {
  return {
    id,
    type: 'tapestry.notes/note@1',
    props: {
      'position.x': { type: 'real', value: x },
      'position.y': { type: 'real', value: y },
      ...extra,
    },
  }
}

/** A knot (thread center) at x, y. */
function knot(id: string, x: number, y: number): PlacementNode {
  return { ...node(id, x, y), type: 'tapestry.notes/thread-center@1' }
}

/** A note with no stored position. */
function loose(id: string): PlacementNode {
  return { id, type: 'tapestry.notes/note@1', props: {} }
}

/** `child` grew from `parent`. */
function grew(edgeId: string, child: string, parent: string): PlacementEdge {
  return { id: edgeId, from: child, to: parent, label: GREW_FROM_LABEL }
}

function rect(x: number, y: number, width: number, height: number): PlacementRect {
  return { x, y, width, height }
}

const FOLLOWS: Record<string, PlacementProp> = { pinned: { type: 'bool', value: false } }

describe('constants', () => {
  it('holds the shared spacing values', () => {
    expect(DEFAULT_NOTE_WIDTH).toBe(280)
    expect(DEFAULT_NOTE_HEIGHT).toBe(120)
    expect(CHILD_GAP).toBe(80)
    expect(NEAR_GAP).toBe(160)
    expect(GREW_FROM_LABEL).toBe('grew-from')
  })
})

describe('ids', () => {
  it('orders ids numerically, not as strings', () => {
    expect(idNumber('n10')).toBeGreaterThan(idNumber('n9'))
    expect(compareIds('n9', 'n10')).toBeLessThan(0)
    expect(['n10', 'n2', 'n9', 'n1'].sort(compareIds)).toEqual(['n1', 'n2', 'n9', 'n10'])
  })

  it('sorts a malformed id after every real id', () => {
    expect(idNumber('n0')).toBe(Number.POSITIVE_INFINITY)
    expect(idNumber('x5')).toBe(Number.POSITIVE_INFINITY)
    expect(idNumber('e3')).toBe(3)
    expect(compareIds('bogus', 'n999999')).toBeGreaterThan(0)
  })
})

describe('node predicates', () => {
  it('recognises a knot', () => {
    expect(isKnot(knot('n1', 0, 0))).toBe(true)
    expect(isKnot(node('n1', 0, 0))).toBe(false)
  })

  it('treats only finite numeric positions as placed', () => {
    expect(isPlaced(node('n1', 0, 0))).toBe(true)
    expect(isPlaced(loose('n1'))).toBe(false)
    expect(
      isPlaced({
        id: 'n1',
        type: 'tapestry.notes/note@1',
        props: {
          'position.x': { type: 'text', value: '10' },
          'position.y': { type: 'real', value: 0 },
        },
      }),
    ).toBe(false)
    expect(storedRect(loose('n1'))).toBeNull()
  })

  it('uses stored sizes above zero and falls back to 280 x 120 (D-07)', () => {
    expect(noteSize(node('n1', 0, 0))).toEqual({ width: 280, height: 120 })
    expect(
      noteSize(
        node('n1', 0, 0, {
          width: { type: 'real', value: 400 },
          height: { type: 'real', value: 90 },
        }),
      ),
    ).toEqual({ width: 400, height: 90 })
    expect(
      noteSize(
        node('n1', 0, 0, {
          width: { type: 'real', value: 0 },
          height: { type: 'real', value: -5 },
        }),
      ),
    ).toEqual({ width: 280, height: 120 })
    expect(storedRect(node('n1', 5, 6))).toEqual({ x: 5, y: 6, width: 280, height: 120 })
  })
})

describe('grewFromParent', () => {
  it('picks the grew-from edge with the lowest edge id', () => {
    const child = node('n3', 0, 0)
    const edges = [grew('e10', 'n3', 'n2'), grew('e9', 'n3', 'n1')]
    expect(grewFromParent(child, edges)).toBe('n1')
  })

  it('ignores other labels and edges into the node', () => {
    const child = node('n3', 0, 0)
    const edges: PlacementEdge[] = [
      { id: 'e1', from: 'n3', to: 'n1', label: 'link' },
      grew('e2', 'n4', 'n3'),
    ]
    expect(grewFromParent(child, edges)).toBeNull()
  })
})

describe('isFollowing (D-02)', () => {
  const parent = node('n1', 0, 0)
  const edges = [grew('e1', 'n2', 'n1')]

  it('is true only for pinned bool false with a live, placed, lower-id, non-knot parent', () => {
    const child = node('n2', 360, 0, FOLLOWS)
    expect(isFollowing(child, [parent, child], edges)).toBe(true)
  })

  it('is false with no pinned key', () => {
    const child = node('n2', 360, 0)
    expect(isFollowing(child, [parent, child], edges)).toBe(false)
  })

  it('is false for pinned bool true', () => {
    const child = node('n2', 360, 0, { pinned: { type: 'bool', value: true } })
    expect(isFollowing(child, [parent, child], edges)).toBe(false)
  })

  it('is false for pinned text "false"', () => {
    const child = node('n2', 360, 0, { pinned: { type: 'text', value: 'false' } })
    expect(isFollowing(child, [parent, child], edges)).toBe(false)
  })

  it('is false with no grew-from edge', () => {
    const child = node('n2', 360, 0, FOLLOWS)
    expect(isFollowing(child, [parent, child], [])).toBe(false)
  })

  it('is false when the parent has a higher id', () => {
    const child = node('n2', 360, 0, FOLLOWS)
    const later = node('n5', 0, 0)
    expect(isFollowing(child, [later, child], [grew('e1', 'n2', 'n5')])).toBe(false)
  })

  it('is false when the parent is a knot', () => {
    const child = node('n2', 360, 0, FOLLOWS)
    expect(isFollowing(child, [knot('n1', 0, 0), child], edges)).toBe(false)
  })

  it('is false when the parent is not placed', () => {
    const child = node('n2', 360, 0, FOLLOWS)
    expect(isFollowing(child, [loose('n1'), child], edges)).toBe(false)
  })

  it('is false when the parent is not in the node list', () => {
    const child = node('n2', 360, 0, FOLLOWS)
    expect(isFollowing(child, [child], edges)).toBe(false)
  })

  it('is false for a knot carrying pinned bool false', () => {
    const k = { ...knot('n2', 360, 0), props: { ...knot('n2', 360, 0).props, ...FOLLOWS } }
    expect(isFollowing(k, [parent, k], edges)).toBe(false)
  })
})

describe('classifyRelation', () => {
  const from = rect(0, 0, 280, 120)

  it('yields contains, contained-by and overlapping', () => {
    expect(classifyRelation(from, rect(10, 10, 50, 50))).toBe('contains')
    expect(classifyRelation(rect(10, 10, 50, 50), from)).toBe('contained-by')
    expect(classifyRelation(from, rect(200, 0, 280, 120))).toBe('overlapping')
  })

  it('calls identical rects contains', () => {
    expect(classifyRelation(from, rect(0, 0, 280, 120))).toBe('contains')
  })

  it('calls touching edges near, not overlapping', () => {
    const touching = rect(280, 0, 280, 120)
    expect(overlaps(from, touching)).toBe(false)
    expect(rectGap(from, touching)).toBe(0)
    expect(classifyRelation(from, touching)).toBe('near')
  })

  it('treats a gap of exactly 160 as near and 161 as beyond', () => {
    expect(classifyRelation(from, rect(440, 0, 280, 120))).toBe('near')
    expect(classifyRelation(from, rect(441, 0, 280, 120))).toBe('beyond')
  })

  it('measures a diagonal gap on the larger axis', () => {
    const diagonalNear = rect(380, 270, 50, 50)
    expect(rectGap(from, diagonalNear)).toBe(150)
    expect(classifyRelation(from, diagonalNear)).toBe('near')

    const diagonalFar = rect(380, 290, 50, 50)
    expect(rectGap(from, diagonalFar)).toBe(170)
    expect(classifyRelation(from, diagonalFar)).toBe('beyond')
  })
})

describe('orderNeighbours', () => {
  const from = rect(0, 0, 100, 100)

  it('sorts by gap, then centre distance, then numeric id', () => {
    const candidates = [
      { id: 'n4', rect: rect(500, 0, 100, 100) },
      { id: 'n10', rect: rect(150, 0, 100, 100) },
      { id: 'n9', rect: rect(150, 0, 100, 100) },
      // Both overlap (gap 0); n3's centre is closer.
      { id: 'n5', rect: rect(80, 0, 100, 100) },
      { id: 'n3', rect: rect(40, 0, 100, 100) },
    ]
    const snapshot = JSON.parse(JSON.stringify(candidates))

    const ordered = orderNeighbours(from, candidates)
    expect(ordered.map((entry) => entry.id)).toEqual(['n3', 'n5', 'n9', 'n10', 'n4'])
    expect(ordered.map((entry) => entry.relation)).toEqual([
      'overlapping',
      'overlapping',
      'near',
      'near',
      'beyond',
    ])
    // The input is untouched.
    expect(candidates).toEqual(snapshot)
  })
})

describe('liesToward', () => {
  const from = rect(0, 0, 100, 100) // centre 50, 50
  const toward = rect(1000, 0, 100, 100) // aim (1000, 0)

  /** A 100 x 100 rect whose centre is offset (dx, dy) from `from`'s centre. */
  function at(dx: number, dy: number): PlacementRect {
    return rect(dx, dy, 100, 100)
  }

  it('keeps a note straight ahead', () => {
    expect(liesToward(from, at(300, 0), toward)).toBe(true)
  })

  it('keeps a note exactly on the 45-degree edge', () => {
    expect(liesToward(from, at(300, 300), toward)).toBe(true)
    expect(liesToward(from, at(300, -300), toward)).toBe(true)
  })

  it('drops notes at 60 degrees, perpendicular and behind', () => {
    expect(liesToward(from, at(100, 174), toward)).toBe(false)
    expect(liesToward(from, at(0, 300), toward)).toBe(false)
    expect(liesToward(from, at(-300, 0), toward)).toBe(false)
  })
})
