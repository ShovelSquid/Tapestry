/**
 * The human save path (02.7 D-04, D-05): a person's edit in a file window is
 * committed first, then written if the file still matches the text the window
 * started from. Otherwise the file wins, its text is recorded as observed, and
 * the losing edit stays in history. Plus the restore path (openWorkspace).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { WorkspaceService } from './workspace-service'
import { humanActor } from '../commands/actor'
import { sha256Hex } from '../mirror/fs'
import type { NodeData } from '../kernel-bridge'
import { FILE_PATH, FILE_SHA256, FILE_TEXT } from './shapes'
import { makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

async function setup(): Promise<{
  ws: TempWorkspace
  registry: TreeRegistry
  service: WorkspaceService
  tree: OpenTree
}> {
  const ws = makeTempWorkspace()
  const registry = new TreeRegistry()
  const service = new WorkspaceService(registry, { treesDir: ws.treesDir })
  cleanups.push(() => {
    registry.closeAll()
    ws.cleanup()
  })
  const tree = await service.addWorkspace(ws.root)
  return { ws, registry, service, tree }
}

function node(tree: OpenTree, rel: string): NodeData | null {
  return tree.bridge.getNodes().find((n) => n.props[FILE_PATH]?.value === rel) ?? null
}

function blocks(tree: OpenTree): string[] {
  return readFileSync(tree.path, 'utf-8').split('@commit ').slice(1)
}

const kaelen = humanActor('kaelen')

describe('WorkspaceService.saveFile', () => {
  it('writes the file and records the edit as the person', async () => {
    const { ws, service, tree } = await setup()
    const hello = node(tree, 'src/hello.ts')!
    const next = "export const greeting = 'typed'\n"
    const result = service.saveFile(kaelen, tree.id, hello.id, next, String(hello.props[FILE_SHA256].value))

    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(result.ok && result.value).toMatchObject({ written: true, fileWins: false, sha256: sha256Hex(next) })
    expect(readFileSync(join(ws.root, 'src', 'hello.ts'), 'utf-8')).toBe(next)
    const last = blocks(tree).at(-1)!
    expect(last).toContain('actor human user.kaelen')
    expect(last).toContain('edit src/hello.ts')
  })

  it('lets the file win when it changed first, keeping the edit in history', async () => {
    const { ws, service, tree } = await setup()
    const hello = node(tree, 'src/hello.ts')!
    const base = String(hello.props[FILE_SHA256].value)
    const outside = "export const greeting = 'outside'\n"
    writeFileSync(join(ws.root, 'src', 'hello.ts'), outside)
    const before = blocks(tree).length

    const result = service.saveFile(kaelen, tree.id, hello.id, "export const greeting = 'mine'\n", base)
    expect(result.ok && result.value.fileWins).toBe(true)
    expect(result.ok && result.value.written).toBe(false)
    expect(readFileSync(join(ws.root, 'src', 'hello.ts'), 'utf-8')).toBe(outside)

    const all = blocks(tree)
    expect(all.length).toBe(before + 2)
    expect(all.at(-2)).toContain('actor human user.kaelen')
    expect(all.at(-2)).toContain('edit src/hello.ts')
    expect(all.at(-1)).toContain('actor plugin workspace.bridge')
    expect(all.at(-1)).toContain(
      "observed change to src/hello.ts (the file changed before Tapestry's edit was written; the file wins)",
    )
    expect(String(node(tree, 'src/hello.ts')!.props[FILE_TEXT].value)).toBe(outside)
  })

  it('lets a deleted file win: nothing written, the note deleted by the observation', async () => {
    const { ws, service, tree } = await setup()
    const hello = node(tree, 'src/hello.ts')!
    unlinkSync(join(ws.root, 'src', 'hello.ts'))
    const result = service.saveFile(kaelen, tree.id, hello.id, 'new text\n', String(hello.props[FILE_SHA256].value))
    expect(result.ok && result.value.fileWins).toBe(true)
    expect(() => statSync(join(ws.root, 'src', 'hello.ts'))).toThrow()
    expect(node(tree, 'src/hello.ts')).toBeNull()
    expect(blocks(tree).at(-1)).toContain('observed changes: deleted src/hello.ts')
  })

  it('refuses a file note, a folder note and a note from another tree', async () => {
    const { ws, service, tree } = await setup()
    const other = await setup()
    const size = statSync(tree.path).size
    const png = node(tree, 'image.png')!
    const folder = node(tree, 'src')!
    const foreign = node(other.tree, 'README.md')!

    for (const id of [png.id, folder.id]) {
      const result = service.saveFile(kaelen, tree.id, id, 'x\n', null)
      expect(result.ok).toBe(false)
    }
    // The other tree's README id may exist here too, as a different node;
    // naming a tree this service does not hold is refused outright.
    expect(service.saveFile(kaelen, other.tree.id, foreign.id, 'x\n', null).ok).toBe(false)
    expect(statSync(tree.path).size).toBe(size)
    expect(readFileSync(join(ws.root, 'README.md'), 'utf-8')).toBe('# Work Space\n\nA synthetic workspace.\n')
  })
})

describe('WorkspaceService.openWorkspace (restore)', () => {
  it('catches up on a change made while the tree was closed', async () => {
    const { ws, registry, tree } = await setup()
    const treePath = tree.path
    registry.close(tree.id)
    writeFileSync(join(ws.root, 'src', 'nested', 'deep.txt'), 'changed while closed\n')

    const registry2 = new TreeRegistry()
    cleanups.push(() => registry2.closeAll())
    const service2 = new WorkspaceService(registry2, { treesDir: ws.treesDir })
    const reopened = await service2.openWorkspace(ws.root, treePath)
    expect('bridge' in reopened).toBe(true)
    const opened = reopened as OpenTree
    const text = readFileSync(treePath, 'utf-8')
    expect(text.split('observed change to src/nested/deep.txt').length - 1).toBe(1)
    expect(blocks(opened).at(-1)).toContain('actor plugin workspace.bridge')
    expect(String(node(opened, 'src/nested/deep.txt')!.props[FILE_TEXT].value)).toBe('changed while closed\n')
  })
})
