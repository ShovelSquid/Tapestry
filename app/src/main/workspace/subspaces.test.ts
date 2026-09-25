/**
 * Folder subspaces in real workspace trees (02.7 D-21): first import, the
 * one-time migration of a 02.7-01 flat layout, and appends. Real addon, real
 * temp folders, real git; nothing on disk is ever written by layout.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { WorkspaceService } from './workspace-service'
import {
  FILE_PATH,
  FOLDER_COLLAPSED,
  FOLDER_SUBSPACE,
  WORKSPACE_FOLDER_TYPE,
  WORKSPACE_LAYOUT,
  WORKSPACE_SHAPE,
  workspaceTreeFiles,
} from './shapes'
import type { NodeData } from '../kernel-bridge'
import { WORKSPACE_WATCHER_ACTOR, humanActor } from '../commands/actor'
import { SpatialCommands } from '../commands/spatial'
import {
  classifyRelation,
  noteSize,
  rectAt,
  resolveWhere,
  type PlacementNode,
} from '../../renderer/layout/placement'
import { entriesFromPaths, listGitFiles } from '../mirror/fs'
import { buildMirrorModel, planMirror, planSubspaceMigration, type MirrorShape } from '../mirror/plan'
import { FRAME_GAP, type FrameRect } from '../../renderer/layout/frames'
import {
  CARD_ESTIMATE,
  absolutePositions,
  folderHierarchy,
  subspaceRects,
} from '../../renderer/layout/subspaces'
import { makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function setup(): { ws: TempWorkspace; registry: TreeRegistry; service: WorkspaceService } {
  const ws = makeTempWorkspace()
  const registry = new TreeRegistry()
  const service = new WorkspaceService(registry, { treesDir: ws.treesDir })
  cleanups.push(() => {
    registry.closeAll()
    ws.cleanup()
  })
  return { ws, registry, service }
}

function byPath(tree: OpenTree): Map<string, NodeData> {
  const out = new Map<string, NodeData>()
  for (const node of tree.bridge.getNodes()) {
    const path = node.props[FILE_PATH]
    if (path) out.set(String(path.value), node)
  }
  return out
}

function position(node: NodeData): { x: number; y: number } {
  return { x: Number(node.props['position.x'].value), y: Number(node.props['position.y'].value) }
}

function gitStatus(root: string): string {
  return execFileSync('git', ['-C', root, 'status', '--porcelain', '--ignored'], { encoding: 'utf-8' })
}

function commitBlocks(tree: OpenTree): string[] {
  return readFileSync(tree.path, 'utf-8').split('@commit ').slice(1)
}

function overlaps(a: FrameRect, b: FrameRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Every pair of siblings, in every folder, as drawn (collapsed as stored). */
function assertNoSiblingOverlaps(nodes: NodeData[]): void {
  const { hierarchy, folderRects } = subspaceRects(nodes, () => undefined)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const rectOf = (id: string): FrameRect => {
    const rect = folderRects.get(id)
    if (rect) return rect
    const node = byId.get(id)!
    const width = Number(node.props['width']?.value ?? CARD_ESTIMATE.width)
    return { ...position(node), width, height: CARD_ESTIMATE.height }
  }
  for (const [parent, children] of hierarchy.childrenOf) {
    for (let i = 0; i < children.length; i += 1) {
      for (let j = i + 1; j < children.length; j += 1) {
        const a = rectOf(children[i])
        const b = rectOf(children[j])
        expect(overlaps(a, b), `${parent ?? 'root'}: ${children[i]} and ${children[j]}`).toBe(false)
      }
    }
  }
}

/** The 02.7-01 layout: one flat column of labelled groups, six cards wide. */
const FLAT_SHAPE: MirrorShape = {
  ...WORKSPACE_SHAPE,
  layout: { ...WORKSPACE_LAYOUT, columns: 6, rowStep: 224, subspaces: false },
}

/** A workspace tree as 02.7-01 built it, before this plan existed. */
async function buildFlatTree(ws: TempWorkspace): Promise<void> {
  const registry = new TreeRegistry()
  const files = workspaceTreeFiles(ws.treesDir, ws.root)
  mkdirSync(ws.treesDir, { recursive: true })
  const entry = registry.create(files.treePath, files.worldName, {
    kind: 'workspace',
    workspaceRoot: ws.root,
    name: files.name,
  })
  const listing = listGitFiles(ws.root)
  if (listing.kind !== 'git') throw new Error('expected a git workspace')
  const model = await buildMirrorModel(ws.root, entriesFromPaths(ws.root, listing.rels))
  const { ops } = planMirror({ nodes: [] }, model, FLAT_SHAPE)
  for (const chunk of ops) entry.bridge.submitAs(WORKSPACE_WATCHER_ACTOR, 'observed workspace (flat)', chunk)
  registry.closeAll()
}

describe('first import', () => {
  it('makes every folder a collapsed subspace with folder-local file positions', async () => {
    const { ws, service } = setup()
    const before = gitStatus(ws.root)
    const tree = await service.addWorkspace(ws.root)
    const nodes = byPath(tree)

    for (const rel of ['src', 'src/nested', 'scripts']) {
      const folder = nodes.get(rel)!
      expect(folder.type, rel).toBe(WORKSPACE_FOLDER_TYPE)
      expect(folder.props[FOLDER_SUBSPACE]?.value, rel).toBe(true)
      expect(folder.props[FOLDER_COLLAPSED]?.value, rel).toBe(true)
    }
    // Local to their folders: the first file of each folder sits at its origin.
    expect(position(nodes.get('src/hello.ts')!)).toEqual({ x: 0, y: 0 })
    expect(position(nodes.get('src/nested/deep.txt')!)).toEqual({ x: 0, y: 0 })
    expect(position(nodes.get('scripts/run.sh')!)).toEqual({ x: 0, y: 0 })
    // src/nested sits below src's files, inside src.
    expect(position(nodes.get('src/nested')!).y).toBeGreaterThan(CARD_ESTIMATE.height)

    assertNoSiblingOverlaps(tree.bridge.getNodes())
    expect(gitStatus(ws.root)).toBe(before)
  })
})

describe('migration of a flat 02.7-01 tree', () => {
  it('arranges it once as system tapestry, touching only layout keys, and never again', async () => {
    const { ws, registry, service } = setup()
    await buildFlatTree(ws)
    const statusBefore = gitStatus(ws.root)

    const tree = await service.addWorkspace(ws.root)
    const blocks = commitBlocks(tree)
    const arranged = blocks.filter((block) => block.includes('arrange workspace Work Space into folder subspaces'))
    expect(arranged).toHaveLength(1)
    const block = arranged[0]
    expect(block).toContain('actor system tapestry')

    const opLines = block.split('\n').filter((line) => /^(set|unset|create|delete|link|unlink|node|edge) /.test(line))
    expect(opLines.length).toBeGreaterThan(0)
    for (const line of opLines) {
      expect(line, line).toMatch(/^set \S+ (position\.x|position\.y|subspace|collapsed) /)
    }
    expect(block).not.toMatch(/ file\./)

    const nodes = byPath(tree)
    expect(position(nodes.get('src/hello.ts')!)).toEqual({ x: 0, y: 0 })
    for (const rel of ['src', 'src/nested', 'scripts']) {
      expect(nodes.get(rel)!.props[FOLDER_SUBSPACE]?.value, rel).toBe(true)
      expect(nodes.get(rel)!.props[FOLDER_COLLAPSED]?.value, rel).toBe(true)
    }
    assertNoSiblingOverlaps(tree.bridge.getNodes())
    expect(planSubspaceMigration(tree.bridge.getNodes(), WORKSPACE_SHAPE)).toEqual([])

    // A second open writes nothing.
    const seq = tree.bridge.status().lastGoodSeq
    const path = tree.path
    registry.close(tree.id)
    const registry2 = new TreeRegistry()
    cleanups.push(() => registry2.closeAll())
    const service2 = new WorkspaceService(registry2, { treesDir: ws.treesDir })
    const reopened = await service2.openWorkspace(ws.root, path)
    if (!('bridge' in reopened)) throw new Error(reopened.reason)
    expect(reopened.bridge.status().lastGoodSeq).toBe(seq)

    expect(gitStatus(ws.root)).toBe(statusBefore)
  })
})

describe('appends', () => {
  it('places a file new to src/nested below everything already there', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const workspace = service.workspaceFor(tree.id)!
    const deepBefore = position(byPath(tree).get('src/nested/deep.txt')!)

    writeFileSync(join(ws.root, 'src', 'nested', 'later.txt'), 'arrived later\n')
    service.observePath(workspace, 'src/nested/later.txt')

    const nodes = byPath(tree)
    const later = position(nodes.get('src/nested/later.txt')!)
    expect(later.y).toBeGreaterThanOrEqual(deepBefore.y + CARD_ESTIMATE.height + FRAME_GAP)
    expect(later.x).toBe(0)
    // Nothing existing moved.
    expect(position(nodes.get('src/nested/deep.txt')!)).toEqual(deepBefore)
    assertNoSiblingOverlaps(tree.bridge.getNodes())
  })

  it('appends a new folder, collapsed, below everything its parent holds', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const workspace = service.workspaceFor(tree.id)!

    mkdirSync(join(ws.root, 'src', 'fresh'))
    writeFileSync(join(ws.root, 'src', 'fresh', 'one.txt'), 'one\n')
    service.observePath(workspace, 'src/fresh/one.txt')

    const nodes = byPath(tree)
    const fresh = nodes.get('src/fresh')!
    expect(fresh.props[FOLDER_SUBSPACE]?.value).toBe(true)
    expect(fresh.props[FOLDER_COLLAPSED]?.value).toBe(true)
    expect(position(fresh).y).toBeGreaterThan(position(nodes.get('src/nested')!).y)
    expect(position(nodes.get('src/fresh/one.txt')!)).toEqual({ x: 0, y: 0 })
    const hierarchy = folderHierarchy(tree.bridge.getNodes())
    expect(hierarchy.parentOf.get(fresh.id)).toBe(nodes.get('src')!.id)
    assertNoSiblingOverlaps(tree.bridge.getNodes())
  })
})

/** The nodes as look and place should see them: every position absolute. */
function absoluteNodes(nodes: NodeData[]): NodeData[] {
  const abs = absolutePositions(nodes)
  return nodes.map((node) => {
    const at = abs.get(node.id)!
    return {
      ...node,
      props: {
        ...node.props,
        'position.x': { type: 'real', value: at.x },
        'position.y': { type: 'real', value: at.y },
      },
    }
  })
}

function rectOfNode(node: PlacementNode, at: { x: number; y: number }) {
  return rectAt(at, noteSize(node))
}

describe('look and place across folders', () => {
  it('look reports the relation between notes in two folders from absolute positions', async () => {
    const { ws, registry, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const spatial = new SpatialCommands(registry)
    const nodes = tree.bridge.getNodes()
    const paths = byPath(tree)
    const hello = paths.get('src/hello.ts')!
    const run = paths.get('scripts/run.sh')!

    // Read as local, both files sit at their folder's (0, 0): the same spot.
    expect(position(hello)).toEqual(position(run))
    const asLocal = classifyRelation(rectOfNode(hello, position(hello)), rectOfNode(run, position(run)))

    const abs = absolutePositions(nodes)
    const expected = classifyRelation(
      rectOfNode(hello, abs.get(hello.id)!),
      rectOfNode(run, abs.get(run.id)!),
    )
    expect(expected).not.toBe(asLocal)

    const looked = spatial.look({ tree: tree.id, from: hello.id, limit: 100 })
    expect(looked.ok, JSON.stringify(looked)).toBe(true)
    if (!looked.ok) return
    const seen = looked.value.neighbours.find((n) => n.note === run.id)
    expect(seen?.relation).toBe(expected)
  })

  it('place resolves in workspace coordinates and writes the folder-local position', async () => {
    const { ws, registry, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const spatial = new SpatialCommands(registry)
    const paths = byPath(tree)
    const hello = paths.get('src/hello.ts')!
    const readme = paths.get('README.md')!
    const before = gitStatus(ws.root)

    const absNodes = absoluteNodes(tree.bridge.getNodes())
    const expected = resolveWhere(
      { nodes: absNodes, edges: tree.bridge.getEdges() },
      absNodes.find((node) => node.id === hello.id)!,
      { near: readme.id },
    )
    expect(expected.ok).toBe(true)
    if (!expected.ok) return

    const placed = spatial.place(humanActor('kaelen'), { tree: tree.id, note: hello.id, where: { near: readme.id } })
    expect(placed.ok, JSON.stringify(placed)).toBe(true)

    const after = tree.bridge.getNodes()
    const stored = position(after.find((node) => node.id === hello.id)!)
    const src = position(byPath(tree).get('src')!)
    // Stored local to src, so it differs from the absolute spot by src's origin.
    expect(stored).toEqual({ x: expected.x - src.x, y: expected.y - src.y })
    expect(absolutePositions(after).get(hello.id)).toEqual({ x: expected.x, y: expected.y })
    expect(gitStatus(ws.root)).toBe(before)
  })
})
