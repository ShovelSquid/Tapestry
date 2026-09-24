/**
 * Folder subspaces (02.7 D-21): the pure geometry main and the canvas share.
 * Positions are local to the parent folder; a collapsed folder is its header;
 * settling moves only positions and keeps siblings FRAME_GAP apart.
 */

import { describe, expect, it } from 'vitest'
import {
  FRAME_GAP,
  FRAME_HEADER_HEIGHT,
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
  FRAME_PADDING,
  computeFrameBounds,
  type FrameRect,
} from './frames'
import {
  CARD_ESTIMATE,
  FOLDER_FRAME,
  absolutePositions,
  folderHierarchy,
  revealExpanded,
  settleSubspace,
  subspaceRects,
  toLocalPosition,
  type DimsOf,
  type SubspaceNode,
  type SubspaceOp,
} from './subspaces'

const FOLDER = 'tapestry.workspace/folder@1'
const TEXT = 'tapestry.workspace/text@1'

function folder(id: string, path: string, x: number, y: number, collapsed = true): SubspaceNode {
  return {
    id,
    type: FOLDER,
    props: {
      'file.path': { type: 'text', value: path },
      'position.x': { type: 'real', value: x },
      'position.y': { type: 'real', value: y },
      subspace: { type: 'bool', value: true },
      collapsed: { type: 'bool', value: collapsed },
    },
  }
}

function file(id: string, path: string, x: number, y: number): SubspaceNode {
  return {
    id,
    type: TEXT,
    props: {
      'file.path': { type: 'text', value: path },
      'position.x': { type: 'real', value: x },
      'position.y': { type: 'real', value: y },
      width: { type: 'real', value: 280 },
    },
  }
}

const noDims: DimsOf = () => undefined

/**
 * A small workspace: README at the root, then `src` (holding hello.ts and the
 * folder `src/nested` with deep.txt) and `scripts` (holding run.sh) stacked as
 * collapsed headers below it.
 */
function workspace(opts: { srcOpen?: boolean; nestedOpen?: boolean } = {}): SubspaceNode[] {
  return [
    file('n1', 'README.md', 0, 0),
    folder('n2', 'src', 24, 432, !opts.srcOpen),
    file('n3', 'src/hello.ts', 0, 0),
    folder('n4', 'src/nested', 24, 432, !opts.nestedOpen),
    file('n5', 'src/nested/deep.txt', 0, 0),
    folder('n6', 'scripts', 24, 560),
    file('n7', 'scripts/run.sh', 0, 0),
  ]
}

function gapBetween(a: FrameRect, b: FrameRect): number {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width))
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height))
  return Math.max(dx, dy)
}

function apply(nodes: SubspaceNode[], ops: SubspaceOp[]): SubspaceNode[] {
  return nodes.map((node) => {
    const mine = ops.filter((op) => op.target === node.id)
    if (mine.length === 0) return node
    const props = { ...node.props }
    for (const op of mine) props[op.key] = { type: op.type, value: op.value }
    return { ...node, props }
  })
}

describe('folderHierarchy', () => {
  it('derives each node’s parent folder from its path', () => {
    const h = folderHierarchy(workspace())
    expect(h.parentOf.get('n1')).toBeNull()
    expect(h.parentOf.get('n2')).toBeNull()
    expect(h.parentOf.get('n3')).toBe('n2')
    expect(h.parentOf.get('n4')).toBe('n2')
    expect(h.parentOf.get('n5')).toBe('n4')
    expect(h.childrenOf.get(null)).toEqual(['n1', 'n6', 'n2'])
    expect(h.childrenOf.get('n2')).toEqual(['n3', 'n4'])
  })
})

describe('absolutePositions and toLocalPosition', () => {
  it('add every ancestor origin, and invert each other', () => {
    const nodes = workspace()
    const abs = absolutePositions(nodes)
    expect(abs.get('n2')).toEqual({ x: 24, y: 432 })
    expect(abs.get('n4')).toEqual({ x: 48, y: 864 })
    expect(abs.get('n5')).toEqual({ x: 48, y: 864 })
    expect(abs.get('n7')).toEqual({ x: 24, y: 560 })

    for (const node of nodes) {
      const local = toLocalPosition(nodes, node.id, abs.get(node.id)!)
      expect(local).toEqual({
        x: Number(node.props['position.x'].value),
        y: Number(node.props['position.y'].value),
      })
    }
    expect(toLocalPosition(nodes, 'n5', { x: 100, y: 1000 })).toEqual({ x: 52, y: 136 })
  })
})

describe('subspaceRects', () => {
  it('draws a collapsed folder as its header band only', () => {
    const { folderRects, expanded } = subspaceRects(workspace(), noDims)
    const src = folderRects.get('n2')!
    expect(src.width).toBe(FOLDER_FRAME.minWidth)
    expect(src.height).toBe(FOLDER_FRAME.headerHeight)
    // The header sits where the open frame's header would: padding and header above the origin.
    expect(src.x).toBe(24 - FOLDER_FRAME.padding)
    expect(src.y).toBe(432 - FOLDER_FRAME.padding - FOLDER_FRAME.headerHeight)
    expect(expanded.has('n2')).toBe(false)
  })

  it('expands to hold its cards and child folders, and the parent grows', () => {
    const closed = subspaceRects(workspace(), noDims)
    const open = subspaceRects(workspace(), noDims, new Set(['n2']))
    const src = open.folderRects.get('n2')!
    expect(open.expanded.has('n2')).toBe(true)
    // hello.ts card at (0,0) plus the collapsed nested header below it.
    const nested = open.folderRects.get('n4')!
    expect(src).toEqual(
      computeFrameBounds({ x: 24, y: 432 }, [
        { x: 0, y: 0, width: 280, height: CARD_ESTIMATE.height },
        nested,
      ], FOLDER_FRAME),
    )
    const closedRoot = computeFrameBounds({ x: 0, y: 0 }, closed.rootBoxes)
    const openRoot = computeFrameBounds({ x: 0, y: 0 }, open.rootBoxes)
    expect(openRoot.height).toBeGreaterThan(closedRoot.height)
  })

  it('uses measured dims when given', () => {
    const open = subspaceRects(workspace({ srcOpen: true }), (id) =>
      id === 'n3' ? { width: 720, height: 600 } : undefined,
    )
    expect(open.folderRects.get('n2')!.width).toBe(720 + FOLDER_FRAME.padding * 2)
  })
})

describe('settleSubspace', () => {
  it('moves an overlapped sibling clear by FRAME_GAP after an expand, with position keys only', () => {
    const nodes = workspace()
    const ops = settleSubspace(nodes, noDims, 'n2', { expanded: new Set(['n2']) })
    expect(ops.length).toBeGreaterThan(0)
    for (const op of ops) expect(['position.x', 'position.y']).toContain(op.key)
    expect(ops.some((op) => op.target === 'n6')).toBe(true)
    expect(ops.some((op) => op.target === 'n2')).toBe(false)
    // Nothing inside src is rewritten.
    for (const id of ['n3', 'n4', 'n5']) expect(ops.some((op) => op.target === id)).toBe(false)

    const after = apply(
      nodes.map((n) => (n.id === 'n2' ? folder('n2', 'src', 24, 432, false) : n)),
      ops,
    )
    const rects = subspaceRects(after, noDims).folderRects
    expect(gapBetween(rects.get('n2')!, rects.get('n6')!)).toBeGreaterThanOrEqual(FRAME_GAP)
  })

  it('writes nothing when nothing overlaps', () => {
    const nodes = workspace()
    expect(settleSubspace(nodes, noDims, 'n6')).toEqual([])
  })
})

describe('revealExpanded', () => {
  it('returns the ancestor folders, outermost first', () => {
    expect(revealExpanded(workspace(), 'n5')).toEqual(['n2', 'n4'])
    expect(revealExpanded(workspace(), 'n1')).toEqual([])
  })
})

describe('computeFrameBounds without options', () => {
  it('returns what it returned before folder sizes existed', () => {
    expect(computeFrameBounds({ x: 10, y: 20 }, [])).toEqual({
      x: 10 - FRAME_PADDING,
      y: 20 - FRAME_PADDING - FRAME_HEADER_HEIGHT,
      width: FRAME_MIN_WIDTH,
      height: FRAME_MIN_HEIGHT,
    })
    const box = { x: 0, y: 0, width: 1000, height: 900 }
    expect(computeFrameBounds({ x: 0, y: 0 }, [box])).toEqual({
      x: -FRAME_PADDING,
      y: -FRAME_PADDING - FRAME_HEADER_HEIGHT,
      width: 1000 + FRAME_PADDING * 2,
      height: 900 + FRAME_PADDING * 2 + FRAME_HEADER_HEIGHT,
    })
    expect(computeFrameBounds({ x: 0, y: 0 }, [box], {})).toEqual(computeFrameBounds({ x: 0, y: 0 }, [box]))
  })
})
