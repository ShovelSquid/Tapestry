/**
 * write_file and list_files through the real dispatch (02.7 D-07): a real
 * TreeRegistry, a real WorkspaceService and temp workspaces only.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { NoteCommands } from '../commands/notes'
import { ConnectionCommands } from '../commands/connections'
import { SpatialCommands } from '../commands/spatial'
import { runAgentTool, type AgentCommands } from '../commands/agent-tools'
import { WorkspaceFileCommands } from '../commands/file-tools'
import { agentActor } from '../commands/actor'
import { NO_WORKSPACE_MESSAGE } from './sandbox'
import { WorkspaceService } from './workspace-service'
import { makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'

const CLAUDE = agentActor('claude')

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Harness {
  ws: TempWorkspace
  registry: TreeRegistry
  service: WorkspaceService
  commands: AgentCommands
  tree: OpenTree
}

async function setup(): Promise<Harness> {
  const ws = makeTempWorkspace()
  const registry = new TreeRegistry()
  const service = new WorkspaceService(registry, { treesDir: ws.treesDir })
  cleanups.push(() => {
    registry.closeAll()
    ws.cleanup()
  })
  const tree = await service.addWorkspace(ws.root)
  const commands: AgentCommands = {
    notes: new NoteCommands(registry),
    connections: new ConnectionCommands(registry),
    spatial: new SpatialCommands(registry),
    files: new WorkspaceFileCommands(service),
  }
  return { ws, registry, service, commands, tree }
}

function currentUmask(): number {
  return process.umask()
}

describe('write_file', () => {
  it("replacing a file keeps its mode bits", async () => {
    const h = await setup()
    const abs = join(h.ws.root, 'scripts', 'run.sh')
    const result = runAgentTool(h.commands, CLAUDE, 'write_file', {
      path: 'scripts/run.sh',
      text: '#!/bin/sh\necho replaced\n',
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(readFileSync(abs, 'utf-8')).toBe('#!/bin/sh\necho replaced\n')
    expect(statSync(abs).mode & 0o7777).toBe(0o755)
    const value = (result as { value: { created: boolean } }).value
    expect(value.created).toBe(false)
    const journal = readFileSync(h.tree.path, 'utf-8')
    expect(journal.slice(journal.lastIndexOf('@commit '))).toContain('write scripts/run.sh')
  })

  it('a new file is 0644 under the umask', async () => {
    const h = await setup()
    const result = runAgentTool(h.commands, CLAUDE, 'write_file', { path: 'notes/new.md', text: '# New\n' })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    const stats = statSync(join(h.ws.root, 'notes', 'new.md'))
    expect(stats.mode & 0o7777).toBe(0o644 & ~currentUmask())
    expect(statSync(join(h.ws.root, 'notes')).isDirectory()).toBe(true)
  })

  it('refuses a non-text file', async () => {
    const h = await setup()
    const before = readFileSync(join(h.ws.root, 'image.png'))
    const size = statSync(h.tree.path).size
    const result = runAgentTool(h.commands, CLAUDE, 'write_file', { path: 'image.png', text: 'x' })
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain('write_file replaces only text files')
    expect(readFileSync(join(h.ws.root, 'image.png')).equals(before)).toBe(true)
    expect(statSync(h.tree.path).size).toBe(size)
  })

  it('refuses an ignored path', async () => {
    const h = await setup()
    const result = runAgentTool(h.commands, CLAUDE, 'write_file', { path: '.env', text: 'SECRET=2\n' })
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain('ignored by git')
    expect(readFileSync(join(h.ws.root, '.env'), 'utf-8')).toBe('SECRET=1\n')
  })

  it('an identical write changes nothing and commits nothing', async () => {
    const h = await setup()
    const abs = join(h.ws.root, 'src', 'hello.ts')
    const text = readFileSync(abs, 'utf-8')
    const mtime = statSync(abs).mtimeMs
    const size = statSync(h.tree.path).size
    const result = runAgentTool(h.commands, CLAUDE, 'write_file', { path: 'src/hello.ts', text })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect((result as { value: { unchanged?: boolean } }).value.unchanged).toBe(true)
    expect(statSync(abs).mtimeMs).toBe(mtime)
    expect(statSync(h.tree.path).size).toBe(size)
  })

  it('refuses text with NUL and writes nothing', async () => {
    const h = await setup()
    const size = statSync(h.tree.path).size
    const result = runAgentTool(h.commands, CLAUDE, 'write_file', { path: 'src/nul.ts', text: 'a\0b' })
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain('NUL')
    expect(() => statSync(join(h.ws.root, 'src', 'nul.ts'))).toThrow()
    expect(statSync(h.tree.path).size).toBe(size)
  })

  it('records a change the tree had not seen as observed before the write', async () => {
    const h = await setup()
    writeFileSync(join(h.ws.root, 'README.md'), '# Changed outside\n')
    const result = runAgentTool(h.commands, CLAUDE, 'write_file', { path: 'README.md', text: '# Mine\n' })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    const commits = readFileSync(h.tree.path, 'utf-8').split(/^@commit /m)
    const last = commits[commits.length - 1]
    const previous = commits[commits.length - 2]
    expect(previous).toContain('workspace.watcher')
    expect(last).toContain('actor plugin agent.claude')
    expect(last).toContain('write README.md')
  })
})

describe('list_files', () => {
  it('lists git\'s view with notes, and truncates at the limit', async () => {
    const h = await setup()
    const all = runAgentTool(h.commands, CLAUDE, 'list_files', {})
    expect(all.ok, JSON.stringify(all)).toBe(true)
    const full = (all as { value: { files: Array<{ path: string; note: string | null; kind: string | null }>; total: number; truncated: boolean } }).value
    const paths = full.files.map((f) => f.path)
    expect(paths).toContain('src/hello.ts')
    expect(paths).toContain('image.png')
    expect(paths.some((p) => p.startsWith('node_modules/') || p.startsWith('out/') || p === '.env')).toBe(false)
    expect(paths.some((p) => p.split('/').includes('.git'))).toBe(false)
    expect([...paths].sort()).toEqual(paths)
    expect(full.truncated).toBe(false)
    expect(full.total).toBe(full.files.length)
    const hello = full.files.find((f) => f.path === 'src/hello.ts')!
    expect(hello.kind).toBe('text')
    expect(hello.note).toBe(h.service.noteForPath(h.tree, 'src/hello.ts')!.id)
    expect(full.files.find((f) => f.path === 'image.png')!.kind).toBe('file')

    const limited = runAgentTool(h.commands, CLAUDE, 'list_files', { limit: 2 })
    expect(limited.ok).toBe(true)
    const two = (limited as { value: { files: unknown[]; total: number; truncated: boolean } }).value
    expect(two.files).toHaveLength(2)
    expect(two.truncated).toBe(true)
    expect(two.total).toBe(full.total)
  })

  it('refuses a folder that is not there, and a file named as a folder', async () => {
    const h = await setup()
    const missing = runAgentTool(h.commands, CLAUDE, 'list_files', { path: 'nope' })
    expect((missing as { error: string }).error).toContain('is not a folder in')
    const file = runAgentTool(h.commands, CLAUDE, 'list_files', { path: 'README.md' })
    expect((file as { error: string }).error).toContain('is not a folder in')
  })

  it('reports that no workspace is open', () => {
    const registry = new TreeRegistry()
    cleanups.push(() => registry.closeAll())
    const service = new WorkspaceService(registry, { treesDir: '/nonexistent-tapestry-test' })
    const commands: AgentCommands = {
      notes: new NoteCommands(registry),
      connections: new ConnectionCommands(registry),
      spatial: new SpatialCommands(registry),
      files: new WorkspaceFileCommands(service),
    }
    const result = runAgentTool(commands, CLAUDE, 'list_files', {})
    expect(result).toEqual({ ok: false, error: NO_WORKSPACE_MESSAGE })
    const bare = runAgentTool({ ...commands, files: undefined }, CLAUDE, 'list_files', {})
    expect(bare).toEqual({ ok: false, error: NO_WORKSPACE_MESSAGE })
  })
})
