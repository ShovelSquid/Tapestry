/**
 * The workspace sandbox (02.7 D-08, T-02.7-01..04): every refusal names its
 * reason and writes nothing. Run against a real temp workspace and the real
 * addon; every refusal is checked against a digest of every file under the
 * temp directory, including the sibling folder outside the workspace.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'path'
import { realpathSync } from 'fs'
import { TreeRegistry } from '../trees/registry'
import { WorkspaceService } from './workspace-service'
import { NO_WORKSPACE_MESSAGE, resolveWorkspaceTarget, type WorkspaceLookup } from './sandbox'
import { hashTree, makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'

let ws: TempWorkspace
let registry: TreeRegistry
let service: WorkspaceService
let name: string

beforeAll(async () => {
  ws = makeTempWorkspace()
  registry = new TreeRegistry()
  service = new WorkspaceService(registry, { treesDir: ws.treesDir })
  const tree = await service.addWorkspace(ws.root)
  name = tree.name
})

afterAll(() => {
  registry.closeAll()
  ws.cleanup()
})

function refused(args: { workspace?: string; path: string }, mode: 'read' | 'write' = 'write'): string {
  const before = hashTree(ws.dir)
  const result = resolveWorkspaceTarget(service, args, mode)
  expect(hashTree(ws.dir)).toBe(before)
  if (result.ok) throw new Error(`expected a refusal for ${args.path}`)
  return result.error
}

describe('resolveWorkspaceTarget', () => {
  it('refuses everything when no workspace is open', () => {
    const none: WorkspaceLookup = { openWorkspaces: () => [] }
    const result = resolveWorkspaceTarget(none, { path: 'src/hello.ts' }, 'read')
    expect(result).toEqual({ ok: false, error: NO_WORKSPACE_MESSAGE })
    expect(NO_WORKSPACE_MESSAGE).toMatch(/^No workspace is open in Tapestry\./)
  })

  it('refuses a tree that is not an open workspace', () => {
    expect(refused({ workspace: 'we', path: 'src/hello.ts' })).toBe('we is not an open workspace')
  })

  it('refuses NUL, backslashes and an empty path', () => {
    const msg = 'path must name a file inside the workspace, with / between folders'
    expect(refused({ path: 'src\0hello.ts' })).toBe(msg)
    expect(refused({ path: 'src\\hello.ts' })).toBe(msg)
    expect(refused({ path: '' })).toBe(msg)
  })

  it('refuses absolute paths outside the workspace', () => {
    const secret = join(ws.outside, 'secret.txt')
    expect(refused({ path: secret })).toBe(`${secret} is outside every open workspace`)
    expect(refused({ workspace: name, path: secret })).toBe(
      `${secret} is outside the workspace ${name} (${ws.root})`,
    )
    const sneaky = join(ws.root, '..', 'outside', 'secret.txt')
    // path.join normalises '..'; spell it raw.
    const raw = `${ws.root}/../outside/secret.txt`
    expect(sneaky).not.toBe(raw)
    expect(refused({ path: raw })).toBe(`${raw} uses '..'; paths must stay inside the workspace`)
  })

  it('refuses the workspace root itself', () => {
    const msg = 'path must name a file inside the workspace, not the workspace itself'
    expect(refused({ path: ws.root })).toBe(msg)
    expect(refused({ path: '.' })).toBe(msg)
    expect(refused({ path: 'src//hello.ts' })).toBe(msg)
  })

  it("refuses '..' segments", () => {
    expect(refused({ path: '../outside/secret.txt' })).toBe(
      "../outside/secret.txt uses '..'; paths must stay inside the workspace",
    )
    expect(refused({ path: 'src/../../outside/secret.txt' })).toBe(
      "src/../../outside/secret.txt uses '..'; paths must stay inside the workspace",
    )
  })

  it('refuses .git in any letter case', () => {
    expect(refused({ path: '.git/config' })).toBe(
      ".git/config is inside .git; file tools never read or write git's own files",
    )
    expect(refused({ path: '.GIT/config' })).toBe(
      ".GIT/config is inside .git; file tools never read or write git's own files",
    )
    expect(refused({ path: 'src/.Git/hooks/pre-commit' })).toMatch(/is inside \.git/)
  })

  it('refuses Tapestry temp files', () => {
    expect(refused({ path: 'src/.hello.ts.tapestry-tmp-1-abcd' })).toBe(
      'src/.hello.ts.tapestry-tmp-1-abcd is a Tapestry temporary file',
    )
  })

  it('refuses any symbolic link along the path, even one pointing inside', () => {
    expect(refused({ path: 'link-out/secret.txt' })).toBe(
      'link-out is a symbolic link; file tools never follow links',
    )
    expect(refused({ path: 'src/link.txt' }, 'read')).toBe(
      'src/link.txt is a symbolic link; file tools never follow links',
    )
  })

  it('refuses a file used as a folder, a folder used as a file, and a missing read', () => {
    expect(refused({ path: 'README.md/x' })).toBe('README.md is not a folder')
    expect(refused({ path: 'src/nested' })).toBe('src/nested is a folder, not a file')
    expect(refused({ path: 'src/missing.ts' }, 'read')).toBe(`src/missing.ts does not exist in ${name}`)
  })

  it('refuses git-ignored paths', () => {
    const msg = (p: string): string =>
      `${p} is ignored by git in ${name}; file tools reach only files the window shows`
    expect(refused({ path: 'node_modules/pkg/index.js' }, 'read')).toBe(msg('node_modules/pkg/index.js'))
    expect(refused({ path: '.env' }, 'read')).toBe(msg('.env'))
    expect(refused({ path: 'out/new.js' })).toBe(msg('out/new.js'))
  })

  it('accepts relative paths and absolute paths under either spelling of the root', () => {
    const rel = resolveWorkspaceTarget(service, { path: 'src/hello.ts' }, 'read')
    expect(rel.ok && rel.value.rel).toBe('src/hello.ts')
    expect(rel.ok && rel.value.exists).toBe(true)

    const real = realpathSync(ws.root)
    const abs = resolveWorkspaceTarget(service, { path: join(real, 'src', 'hello.ts') }, 'read')
    expect(abs.ok && abs.value.rel).toBe('src/hello.ts')
    const lexical = resolveWorkspaceTarget(service, { path: join(ws.root, 'src', 'hello.ts') }, 'read')
    expect(lexical.ok && lexical.value.abs).toBe(join(real, 'src', 'hello.ts'))

    const fresh = resolveWorkspaceTarget(service, { workspace: name, path: './src/new.ts' }, 'write')
    expect(fresh.ok && fresh.value).toMatchObject({ rel: 'src/new.ts', exists: false })
  })

  it('refuses a relative path when several workspaces are open', async () => {
    const second = makeTempWorkspace()
    try {
      const other = await service.addWorkspace(second.root)
      const msg = refused({ path: 'src/hello.ts' })
      expect(msg).toMatch(/^Several workspaces are open \(.+\); pass workspace$/)
      // Both are named "Work Space": the name is ambiguous, the id is not.
      expect(refused({ workspace: 'work space', path: 'src/hello.ts' })).toBe(
        'Workspace name work space is ambiguous; use the tree id',
      )
      const byId = resolveWorkspaceTarget(service, { workspace: other.id, path: 'src/hello.ts' }, 'read')
      expect(byId.ok).toBe(true)
      registry.close(other.id)
    } finally {
      second.cleanup()
    }
  })
})
