/**
 * Notes inside notes. What matters: a bad `inside` never breaks a tree (it
 * leaves the note at the top level), positions compose down any depth, a
 * container grows to hold what is in it, a drop never lands a note inside
 * itself, and zooming out hides contents behind an outline.
 */

import { describe, expect, it } from 'vitest'
import {
  CHILD_TOP,
  CONTAINER_PADDING,
  MAX_NESTING_DEPTH,
  NESTABLE_TYPE,
  OUTLINE_BELOW_PX,
  absolutePositions,
  buildNesting,
  containerMinSizes,
  dropContainer,
  isWithin,
  moveIntoOps,
  newChildSpot,
  outlineState,
  subtreeDeepestFirst,
  type NestingNode,
} from './nesting'

function note(id: string, x: number, y: number, inside?: string): NestingNode {
  const props: NestingNode['props'] = {
    'position.x': { type: 'real', value: x },
    'position.y': { type: 'real', value: y },
  }
  if (inside !== undefined) props.inside = { type: 'ref', value: inside }
  return { id, type: NESTABLE_TYPE, props }
}

const localOf = (nodes: NestingNode[]) => (id: string) => {
  const n = nodes.find((node) => node.id === id)!
  return { x: Number(n.props['position.x'].value), y: Number(n.props['position.y'].value) }
}

describe('buildNesting', () => {
  it('reads containers and depths', () => {
    const nodes = [note('n1', 0, 0), note('n2', 10, 10, 'n1'), note('n3', 5, 5, 'n2')]
    const nesting = buildNesting(nodes)
    expect(nesting.containerOf.get('n3')).toBe('n2')
    expect(nesting.depthOf.get('n3')).toBe(2)
    expect(nesting.childrenOf.get(null)).toEqual(['n1'])
  })

  it('leaves a note at the top level for a missing, foreign or self container', () => {
    const thread = { id: 'n9', type: 'tapestry.threads/thread@1', props: {} }
    const nodes = [note('n1', 0, 0, 'n404'), note('n2', 0, 0, 'n9'), note('n3', 0, 0, 'n3'), thread]
    const nesting = buildNesting(nodes)
    for (const id of ['n1', 'n2', 'n3']) expect(nesting.containerOf.get(id)).toBeNull()
    expect(nesting.containerOf.has('n9')).toBe(false)
  })

  it('breaks a cycle instead of looping', () => {
    const nesting = buildNesting([note('n1', 0, 0, 'n2'), note('n2', 0, 0, 'n1')])
    expect(nesting.containerOf.get('n1')).toBeNull()
    expect(nesting.containerOf.get('n2')).toBeNull()
  })

  it('treats an over-deep chain as top level', () => {
    const nodes = [note('n0', 0, 0)]
    for (let i = 1; i <= MAX_NESTING_DEPTH + 2; i += 1) nodes.push(note(`n${i}`, 0, 0, `n${i - 1}`))
    const nesting = buildNesting(nodes)
    const deepest = `n${MAX_NESTING_DEPTH + 2}`
    for (const depth of nesting.depthOf.values()) expect(depth).toBeLessThanOrEqual(MAX_NESTING_DEPTH)
    expect(nesting.depthOf.get(deepest)).toBeDefined()
  })
})

describe('absolutePositions', () => {
  it('adds every container on the way down', () => {
    const nodes = [note('n1', 100, 200), note('n2', 10, 20, 'n1'), note('n3', 1, 2, 'n2')]
    const abs = absolutePositions(buildNesting(nodes), localOf(nodes))
    expect(abs.get('n3')).toEqual({ x: 111, y: 222 })
  })
})

describe('containerMinSizes', () => {
  it('grows a container to hold its contents, and its container in turn', () => {
    const nodes = [note('n1', 0, 0), note('n2', 300, 100, 'n1'), note('n3', 400, 50, 'n2')]
    const size = () => ({ width: 200, height: 100 })
    const mins = containerMinSizes(buildNesting(nodes), localOf(nodes), size)
    expect(mins.get('n2')).toEqual({ width: 400 + 200 + CONTAINER_PADDING, height: 50 + 100 + CONTAINER_PADDING })
    expect(mins.get('n1')?.width).toBe(300 + 400 + 200 + CONTAINER_PADDING + CONTAINER_PADDING)
    expect(mins.has('n3')).toBe(false)
  })
})

describe('dropContainer', () => {
  const nodes = [note('n1', 0, 0), note('n2', 20, 20, 'n1'), note('n3', 500, 0)]
  const nesting = buildNesting(nodes)
  const rects: Record<string, { x: number; y: number; width: number; height: number }> = {
    n1: { x: 0, y: 0, width: 400, height: 400 },
    n2: { x: 20, y: 20, width: 100, height: 100 },
    n3: { x: 500, y: 0, width: 100, height: 100 },
  }
  const rectOf = (id: string) => rects[id] ?? null

  it('picks the deepest note under the point', () => {
    expect(dropContainer(nesting, rectOf, 'n3', { x: 50, y: 50 })).toBe('n2')
    expect(dropContainer(nesting, rectOf, 'n3', { x: 300, y: 300 })).toBe('n1')
    expect(dropContainer(nesting, rectOf, 'n3', { x: 900, y: 900 })).toBeNull()
  })

  it('never drops a note into itself or its own contents', () => {
    expect(dropContainer(nesting, rectOf, 'n1', { x: 50, y: 50 })).toBeNull()
    expect(isWithin(nesting, 'n2', 'n1')).toBe(true)
  })
})

describe('outlineState', () => {
  const nodes = [note('n1', 0, 0), note('n2', 0, 0, 'n1'), note('n3', 0, 0, 'n2')]
  const nesting = buildNesting(nodes)
  const width = () => 200

  it('draws everything at a readable zoom', () => {
    const s = outlineState(nesting, width, 1)
    expect(s.outlined.size + s.hidden.size).toBe(0)
  })

  it('outlines small nested notes and hides what is inside them, never the top level', () => {
    const zoom = (OUTLINE_BELOW_PX - 1) / 200
    const s = outlineState(nesting, width, zoom)
    expect([...s.outlined]).toEqual(['n2'])
    expect([...s.hidden]).toEqual(['n3'])
  })
})

describe('moveIntoOps', () => {
  it('moves into a container in local coordinates, clamped to its surface', () => {
    expect(moveIntoOps('n5', 'n1', { x: 150, y: 90 }, { x: 100, y: 100 }, null)).toEqual([
      { op: 'setProperty', target: 'n5', key: 'position.x', type: 'real', value: 50 },
      { op: 'setProperty', target: 'n5', key: 'position.y', type: 'real', value: CHILD_TOP },
      { op: 'setProperty', target: 'n5', key: 'inside', type: 'ref', value: 'n1' },
    ])
  })

  it('moves out to the top level by unsetting inside', () => {
    const ops = moveIntoOps('n5', null, { x: -40, y: 10 }, null, 'n1')
    expect(ops[0]).toMatchObject({ value: -40 })
    expect(ops[2]).toEqual({ op: 'unsetProperty', target: 'n5', key: 'inside' })
  })

  it('writes only the position within the same container', () => {
    expect(moveIntoOps('n5', 'n1', { x: 110, y: 110 }, { x: 100, y: 100 }, 'n1')).toHaveLength(2)
  })
})

describe('subtrees and new children', () => {
  const nodes = [note('n1', 0, 0), note('n2', 24, 150, 'n1'), note('n3', 0, 0, 'n2')]
  const nesting = buildNesting(nodes)

  it('lists a subtree deepest first, for deleting', () => {
    expect(subtreeDeepestFirst(nesting, 'n1')).toEqual(['n3', 'n2', 'n1'])
  })

  it('puts a new child under the lowest one, or under the text when empty', () => {
    const size = () => ({ width: 200, height: 100 })
    expect(newChildSpot(nesting, 'n1', localOf(nodes), size, 999).y).toBe(250 + CONTAINER_PADDING / 2)
    expect(newChildSpot(nesting, 'n3', localOf(nodes), size, 120).y).toBe(120 + CONTAINER_PADDING / 2)
  })
})
