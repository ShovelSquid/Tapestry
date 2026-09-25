/**
 * The dogfood path, end to end (02.7 D-07, D-10, D-11): the real shim, the
 * real socket, the strict schemas, the dispatch switch, the workspace
 * sandbox, the atomic disk write and the tree commit — against a temp
 * workspace, never a real worktree.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { NoteCommands } from '../commands/notes'
import { ConnectionCommands } from '../commands/connections'
import { SpatialCommands } from '../commands/spatial'
import { runAgentTool } from '../commands/agent-tools'
import { WorkspaceFileCommands } from '../commands/file-tools'
import { AgentRegistry, agentSocketPath } from '../agents/registry'
import { AgentSocketServer } from '../agents/socket-server'
import { agentActor } from '../commands/actor'
import { WorkspaceService } from '../workspace/workspace-service'
import { HELLO_LINE, makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'
import { startShim, type ShimSession } from '../../../test/helpers/mcp-stdio'

describe('workspace file tools over the MCP shim', () => {
  let ws: TempWorkspace
  let registry: TreeRegistry
  let server: AgentSocketServer
  let shim: ShimSession
  let tree: OpenTree
  let service: WorkspaceService
  const reveals: Array<[string, string]> = []

  beforeAll(async () => {
    ws = makeTempWorkspace()
    registry = new TreeRegistry()
    service = new WorkspaceService(registry, { treesDir: ws.treesDir })
    tree = await service.addWorkspace(ws.root)

    const agents = new AgentRegistry(join(ws.dir, 'agents.json'))
    const { token } = agents.create('claude')
    const commands = {
      notes: new NoteCommands(registry),
      connections: new ConnectionCommands(registry),
      spatial: new SpatialCommands(registry),
      files: new WorkspaceFileCommands(service, {
        onReveal: (treeId, noteId) => {
          reveals.push([treeId, noteId])
          return true
        },
      }),
    }
    server = new AgentSocketServer({
      socketPath: agentSocketPath(ws.dir),
      agents,
      dispatch: (name, tool, args) => runAgentTool(commands, agentActor(name), tool, args),
    })
    await server.listen()

    shim = startShim({ TAPESTRY_AGENT_TOKEN: token, TAPESTRY_USER_DATA: ws.dir })
    const init = await shim.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    })
    expect(init.error).toBeUndefined()
    shim.notify('notifications/initialized')
  }, 30000)

  afterAll(async () => {
    shim?.close()
    await server?.close()
    registry?.closeAll()
    ws?.cleanup()
  })

  it('lists the file tools with no actor argument', async () => {
    const listed = await shim.request('tools/list', {})
    const tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> =
      listed.result.tools
    const byName = new Map(tools.map((t) => [t.name, t]))
    for (const name of ['list_files', 'read_file', 'write_file', 'edit_file', 'open_file']) {
      const tool = byName.get(name)
      expect(tool, name).toBeDefined()
      expect(Object.keys(tool!.inputSchema?.properties ?? {})).not.toContain('actor')
    }
  })

  it('reads a file', async () => {
    const called = await shim.request('tools/call', {
      name: 'read_file',
      arguments: { path: 'src/hello.ts' },
    })
    expect(called.result?.isError).not.toBe(true)
    const value = JSON.parse(called.result.content[0].text)
    expect(value.text).toBe(readFileSync(join(ws.root, 'src', 'hello.ts'), 'utf-8'))
    expect(value.path).toBe('src/hello.ts')
    expect(value.note).toMatch(/^n\d+$/)
  }, 30000)

  it('edits a file on disk and records it as agent.claude', async () => {
    const abs = join(ws.root, 'src', 'hello.ts')
    const called = await shim.request('tools/call', {
      name: 'edit_file',
      arguments: { path: abs, old_string: "'hello'", new_string: "'hello from tapestry'" },
    })
    expect(called.result?.isError, JSON.stringify(called.result)).not.toBe(true)

    expect(readFileSync(abs, 'utf-8')).toContain("export const greeting = 'hello from tapestry'")
    expect(readFileSync(abs, 'utf-8')).not.toContain(HELLO_LINE + '\n')
    const diff = execFileSync('git', ['-C', ws.root, 'diff', '--name-only'], { encoding: 'utf-8' })
    expect(diff.trim()).toBe('src/hello.ts')

    const journal = readFileSync(tree.path, 'utf-8')
    const lastCommit = journal.slice(journal.lastIndexOf('@commit '))
    expect(lastCommit).toContain('actor plugin agent.claude')
    expect(lastCommit).toContain('edit src/hello.ts (1 replacement)')
  }, 30000)

  it("refuses '..' and writes nothing", async () => {
    const secret = join(ws.outside, 'secret.txt')
    const before = readFileSync(secret)
    const size = statSync(tree.path).size
    const called = await shim.request('tools/call', {
      name: 'edit_file',
      arguments: { path: '../outside/secret.txt', old_string: 'outside', new_string: 'inside' },
    })
    expect(called.result?.isError).toBe(true)
    expect(called.result.content[0].text).toBe(
      "../outside/secret.txt uses '..'; paths must stay inside the workspace",
    )
    expect(readFileSync(secret).equals(before)).toBe(true)
    expect(statSync(tree.path).size).toBe(size)
  }, 30000)

  it('creates a file and its folder with write_file, recorded in one commit as agent.claude', async () => {
    const abs = join(ws.root, 'src', 'new', 'made.ts')
    const text = 'export const made = true\n'
    const called = await shim.request('tools/call', {
      name: 'write_file',
      arguments: { path: 'src/new/made.ts', text },
    })
    expect(called.result?.isError, JSON.stringify(called.result)).not.toBe(true)
    const value = JSON.parse(called.result.content[0].text)
    expect(value.created).toBe(true)
    expect(value.path).toBe('src/new/made.ts')

    expect(readFileSync(abs, 'utf-8')).toBe(text)
    const status = execFileSync('git', ['-C', ws.root, 'status', '--porcelain'], { encoding: 'utf-8' })
    expect(status.split('\n')).toContain('?? src/new/')

    const nodes = tree.bridge.getNodes()
    const folder = nodes.find((n) => n.props['file.path']?.value === 'src/new')
    const file = nodes.find((n) => n.props['file.path']?.value === 'src/new/made.ts')
    expect(folder?.type).toBe('tapestry.workspace/folder@1')
    expect(file?.type).toBe('tapestry.workspace/text@1')
    expect(file?.id).toBe(value.note)

    // Both notes were created by the same, last commit.
    const journal = readFileSync(tree.path, 'utf-8')
    const lastCommit = journal.slice(journal.lastIndexOf('@commit '))
    expect(lastCommit).toContain('actor plugin agent.claude')
    expect(lastCommit).toContain('create src/new/made.ts')
    expect(lastCommit).toContain(folder!.id)
    expect(lastCommit).toContain(file!.id)

    const listed = await shim.request('tools/call', { name: 'list_files', arguments: { path: 'src' } })
    expect(listed.result?.isError, JSON.stringify(listed.result)).not.toBe(true)
    const listing = JSON.parse(listed.result.content[0].text)
    expect(listing.folder).toBe('src')
    const made = listing.files.find((f: { path: string }) => f.path === 'src/new/made.ts')
    expect(made).toEqual({ path: 'src/new/made.ts', bytes: Buffer.byteLength(text), kind: 'text', note: value.note })
    expect(listing.files.every((f: { path: string }) => f.path.startsWith('src/'))).toBe(true)
  }, 30000)

  it('opens a file in its window with open_file', async () => {
    const called = await shim.request('tools/call', { name: 'open_file', arguments: { path: 'src/hello.ts' } })
    expect(called.result?.isError, JSON.stringify(called.result)).not.toBe(true)
    const value = JSON.parse(called.result.content[0].text)
    const note = service.noteForPath(tree, 'src/hello.ts')!.id
    expect(value).toEqual({ workspace: tree.name, path: 'src/hello.ts', note, shown: true })
    expect(reveals).toEqual([[tree.id, note]])
  }, 30000)
})
