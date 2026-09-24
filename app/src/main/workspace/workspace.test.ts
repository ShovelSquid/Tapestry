/**
 * Workspace trees (02.7 D-01..D-03, D-06): a folder mirrored into a tree kept
 * in app data, byte-exact, with git's view deciding what is mirrored. Real
 * addon, real temp folders, real git.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { WorkspaceService } from './workspace-service'
import {
  FILE_PATH,
  FILE_TEXT,
  FILE_UNREADABLE,
  WORKSPACE_FILE_TYPE,
  WORKSPACE_FOLDER_TYPE,
  WORKSPACE_TEXT_TYPE,
} from './shapes'
import type { NodeData } from '../kernel-bridge'
import { agentActor } from '../commands/actor'
import { WorkspaceFileCommands } from '../commands/file-tools'
import { hashTree, makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function setup(opts: { git?: boolean } = {}): {
  ws: TempWorkspace
  registry: TreeRegistry
  service: WorkspaceService
} {
  const ws = makeTempWorkspace(opts)
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

function gitStatus(root: string): string {
  return execFileSync('git', ['-C', root, 'status', '--porcelain', '--ignored'], { encoding: 'utf-8' })
}

function journal(tree: OpenTree): string {
  return readFileSync(tree.path, 'utf-8')
}

/** How many `commit` blocks the journal holds. */
function commitCount(tree: OpenTree): number {
  return tree.bridge.status().lastGoodSeq
}

describe('addWorkspace', () => {
  it('keeps the tree in app data and leaves the workspace untouched', async () => {
    const { ws, service } = setup()
    const before = gitStatus(ws.root)
    const tree = await service.addWorkspace(ws.root)

    expect(tree.path.startsWith(ws.treesDir)).toBe(true)
    expect(tree.path).toMatch(/Work Space-[0-9a-f]{8}\.tree$/)
    expect(tree.kind).toBe('workspace')
    expect(tree.workspaceRoot).toBe(ws.root)
    expect(gitStatus(ws.root)).toBe(before)
    expect(readdirSync(ws.root).some((name) => name.endsWith('.tree'))).toBe(false)
  })

  it("mirrors git's view byte-exactly and survives close and reopen", async () => {
    const { ws, registry, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const path = tree.path
    registry.close(tree.id)

    const registry2 = new TreeRegistry()
    cleanups.push(() => registry2.closeAll())
    const service2 = new WorkspaceService(registry2, { treesDir: ws.treesDir })
    const reopened = await service2.addWorkspace(ws.root)
    expect(reopened.path).toBe(path)

    const nodes = byPath(reopened)
    for (const rel of ['README.md', 'src/hello.ts', 'src/nested/deep.txt', 'scripts/run.sh', 'crlf.txt', '.gitignore']) {
      const node = nodes.get(rel)
      expect(node?.type, rel).toBe(WORKSPACE_TEXT_TYPE)
      expect(Buffer.from(String(node!.props[FILE_TEXT].value), 'utf-8').equals(readFileSync(join(ws.root, rel))), rel).toBe(true)
    }
    expect(String(nodes.get('crlf.txt')!.props[FILE_TEXT].value)).toContain('\r\n')

    for (const rel of ['image.png', 'link-out', 'src/link.txt']) {
      const node = nodes.get(rel)
      expect(node?.type, rel).toBe(WORKSPACE_FILE_TYPE)
      expect(node!.props[FILE_TEXT], rel).toBeUndefined()
      expect(String(node!.props[FILE_UNREADABLE]?.value ?? ''), rel).not.toBe('')
    }
    expect(String(nodes.get('src/link.txt')!.props[FILE_UNREADABLE].value)).toBe('symbolic link not followed')

    for (const rel of ['node_modules', 'node_modules/pkg/index.js', 'out/build.js', 'out', '.env', '.git']) {
      expect(nodes.has(rel), rel).toBe(false)
    }
    for (const rel of ['src', 'src/nested', 'scripts']) {
      expect(nodes.get(rel)?.type, rel).toBe(WORKSPACE_FOLDER_TYPE)
    }
    expect([...nodes.keys()].some((rel) => rel.startsWith('.git/'))).toBe(false)

    const text = journal(reopened)
    expect(text).toContain('actor plugin workspace.bridge')
    expect(text).toMatch(/observed workspace Work Space: \d+ text files, \d+ other files, \d+ folders/)
  })

  it('writes no commit when catching up an unchanged folder', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const seq = commitCount(tree)
    const size = statSync(tree.path).size
    await service.catchUp(tree.id)
    expect(commitCount(tree)).toBe(seq)
    expect(statSync(tree.path).size).toBe(size)
  })

  it('records an outside change as workspace.bridge on catch-up', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    writeFileSync(join(ws.root, 'src', 'nested', 'deep.txt'), 'changed outside\n')
    await service.catchUp(tree.id)
    const text = journal(tree)
    expect(text).toContain('observed change to src/nested/deep.txt')
    expect(String(byPath(tree).get('src/nested/deep.txt')!.props[FILE_TEXT].value)).toBe('changed outside\n')
  })

  it('refuses a catch-up whose folder is missing and commits nothing', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const seq = commitCount(tree)
    const count = tree.bridge.getNodes().length
    renameSync(ws.root, join(ws.dir, 'moved away'))
    await expect(service.catchUp(tree.id)).rejects.toThrow(
      `The workspace folder ${ws.root} is missing; nothing was recorded`,
    )
    expect(commitCount(tree)).toBe(seq)
    expect(tree.bridge.getNodes().length).toBe(count)
  })

  it('mirrors a folder outside git with the vault rules plus node_modules', async () => {
    const { ws, service } = setup({ git: false })
    const tree = await service.addWorkspace(ws.root)
    const nodes = byPath(tree)
    expect(nodes.get('src/hello.ts')?.type).toBe(WORKSPACE_TEXT_TYPE)
    expect(nodes.get('out/build.js')?.type).toBe(WORKSPACE_TEXT_TYPE)
    for (const rel of ['node_modules', 'node_modules/pkg/index.js', '.env', '.gitignore']) {
      expect(nodes.has(rel), rel).toBe(false)
    }
    expect(existsSync(join(ws.root, '.git'))).toBe(false)
    expect(service.openWorkspaces()[0].git).toBe(false)
  })
})

/** The `@commit` blocks of a journal, in order. */
function commitBlocks(tree: OpenTree): string[] {
  return journal(tree).split('@commit ').slice(1)
}

describe('editFile (agent writes, D-04/D-06)', () => {
  it('writes the file, keeps its mode and records the edit as the agent', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const files = new WorkspaceFileCommands(service)
    const script = join(ws.root, 'scripts', 'run.sh')

    const result = files.editFile(agentActor('claude'), {
      path: 'scripts/run.sh',
      old_string: 'echo run',
      new_string: 'echo ran',
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(readFileSync(script, 'utf-8')).toBe('#!/bin/sh\necho ran\n')
    expect(statSync(script).mode & 0o7777).toBe(0o755)
    const last = commitBlocks(tree).at(-1)!
    expect(last).toContain('actor plugin agent.claude')
    expect(last).toContain('edit scripts/run.sh (1 replacement)')
    expect(String(byPath(tree).get('scripts/run.sh')!.props[FILE_TEXT].value)).toBe('#!/bin/sh\necho ran\n')
    expect(readdirSync(join(ws.root, 'scripts'))).toEqual(['run.sh'])
  })

  it('observes an outside change first, then records the agent edit', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const files = new WorkspaceFileCommands(service)
    writeFileSync(join(ws.root, 'src', 'hello.ts'), "export const greeting = 'hi'\n")
    const before = commitBlocks(tree).length

    const result = files.editFile(agentActor('claude'), {
      path: 'src/hello.ts',
      old_string: "'hi'",
      new_string: "'hey'",
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)

    const blocks = commitBlocks(tree)
    expect(blocks.length).toBe(before + 2)
    expect(blocks.at(-2)).toContain('actor plugin workspace.bridge')
    expect(blocks.at(-2)).toContain('observed change to src/hello.ts')
    expect(blocks.at(-1)).toContain('actor plugin agent.claude')
    expect(blocks.at(-1)).toContain('edit src/hello.ts (1 replacement)')
  })

  it('refuses a missing, repeated or unchanged string and writes nothing', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const files = new WorkspaceFileCommands(service)
    writeFileSync(join(ws.root, 'src', 'nested', 'deep.txt'), 'twice twice\n')
    await service.catchUp(tree.id)

    const cases: Array<[{ path: string; old_string: string; new_string: string }, string]> = [
      [{ path: 'src/hello.ts', old_string: 'nowhere', new_string: 'x' }, 'old_string was not found in src/hello.ts'],
      [
        { path: 'src/nested/deep.txt', old_string: 'twice', new_string: 'once' },
        'old_string occurs 2 times in src/nested/deep.txt; add surrounding lines to make it unique, or pass replace_all',
      ],
      [{ path: 'src/hello.ts', old_string: 'hello', new_string: 'hello' }, 'new_string must differ from old_string'],
      [{ path: 'image.png', old_string: 'PNG', new_string: 'GIF' }, 'image.png is not a text file (contains a NUL byte); Tapestry shows only its name and size'],
    ]
    for (const [args, error] of cases) {
      const digest = hashTree(ws.dir)
      const size = statSync(tree.path).size
      expect(files.editFile(agentActor('claude'), args)).toEqual({ ok: false, error })
      expect(hashTree(ws.dir)).toBe(digest)
      expect(statSync(tree.path).size).toBe(size)
    }

    const all = files.editFile(agentActor('claude'), {
      path: 'src/nested/deep.txt',
      old_string: 'twice',
      new_string: 'once',
      replace_all: true,
    })
    expect(all.ok && all.value.replacements).toBe(2)
    expect(commitBlocks(tree).at(-1)).toContain('edit src/nested/deep.txt (2 replacements)')
  })

  it('refuses everything with no workspace open', () => {
    const registry = new TreeRegistry()
    const service = new WorkspaceService(registry, { treesDir: '/nonexistent-tapestry-test' })
    const files = new WorkspaceFileCommands(service)
    const read = files.readFile({ path: 'src/hello.ts' })
    expect(read.ok).toBe(false)
    expect(!read.ok && read.error).toMatch(/^No workspace is open in Tapestry/)
  })
})
