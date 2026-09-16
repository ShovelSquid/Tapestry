/**
 * The agent bridge, end to end, through the real shim.
 *
 * This test spawns the built `out/main/mcp.js` as a real child process and
 * speaks JSON-RPC to it over stdio, exactly as Claude Code would. Nothing is
 * mocked: the shim opens the real Unix socket, the socket server verifies a
 * real token, and the command layer writes a real `.tree` file.
 *
 * What it proves:
 *  - an agent can grow a note from an existing note (D-04)
 *  - the commit is signed `actor plugin agent.claude`, an id the agent never
 *    supplied and could not have chosen (D-06)
 *  - the node and its `grew-from` edge land in ONE commit
 *  - no tool advertises an actor argument, and an extra `actor` key is refused
 *  - stdout carries protocol frames only
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { TreeRegistry } from '../trees/registry'
import { NoteCommands } from '../commands/notes'
import { ConnectionCommands } from '../commands/connections'
import { runAgentTool } from '../commands/agent-tools'
import { AgentRegistry, agentSocketPath } from '../agents/registry'
import { AgentSocketServer } from '../agents/socket-server'
import { agentActor, humanActor } from '../commands/actor'

/** The built shim. `npm run build:js` must have produced it. */
const SHIM_PATH = resolve(process.cwd(), 'out', 'main', 'mcp.js')

interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string
  result?: any
  error?: any
  method?: string
}

describe('MCP shim over stdio', () => {
  let dir: string
  let treePath: string
  let registry: TreeRegistry
  let server: AgentSocketServer
  let child: ChildProcessWithoutNullStreams

  /** Every line the shim wrote to stdout, parsed. */
  const stdoutLines: string[] = []
  const messages: JsonRpcMessage[] = []
  const waiters = new Map<number | string, (msg: JsonRpcMessage) => void>()

  function send(message: Record<string, unknown>): void {
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  function request(id: number, method: string, params?: unknown): Promise<JsonRpcMessage> {
    const pending = new Promise<JsonRpcMessage>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(
        () => rejectPromise(new Error(`Timed out waiting for response ${id} (${method})`)),
        15000,
      )
      waiters.set(id, (msg) => {
        clearTimeout(timer)
        resolvePromise(msg)
      })
    })
    send({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) })
    return pending
  }

  beforeAll(async () => {
    dir = makeTempDir('mcp')
    treePath = join(dir, 'agents.tree')

    registry = new TreeRegistry()
    const tree = registry.create(treePath, 'agents')

    // A note a person wrote, for the agent's note to grow from.
    tree.bridge.submitAs(humanActor('kaelen'), 'Create note', [
      {
        op: 'createNode',
        type: 'tapestry.notes/note@1',
        props: {
          'position.x': { type: 'real', value: 0 },
          'position.y': { type: 'real', value: 0 },
          title: { type: 'text', value: 'Seed' },
          body: { type: 'text', value: '' },
        },
      },
    ])

    const agents = new AgentRegistry(join(dir, 'agents.json'))
    const { token } = agents.create('claude')

    const commands = {
      notes: new NoteCommands(registry),
      connections: new ConnectionCommands(registry),
    }
    server = new AgentSocketServer({
      socketPath: agentSocketPath(dir),
      agents,
      dispatch: (name, tool, args) => runAgentTool(commands, agentActor(name), tool, args),
    })
    await server.listen()

    child = spawn(process.execPath, [SHIM_PATH], {
      env: {
        ...process.env,
        TAPESTRY_AGENT_TOKEN: token,
        TAPESTRY_USER_DATA: dir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let buffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8')
      for (;;) {
        const index = buffer.indexOf('\n')
        if (index === -1) break
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line.length === 0) continue
        stdoutLines.push(line)
        let parsed: JsonRpcMessage
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        messages.push(parsed)
        if (parsed.id !== undefined) {
          const waiter = waiters.get(parsed.id)
          if (waiter) {
            waiters.delete(parsed.id)
            waiter(parsed)
          }
        }
      }
    })

    // Diagnostics belong on stderr; surface them if the run goes wrong.
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim()
      if (text.length > 0) console.error('[shim stderr]', text)
    })

    const initialize = await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    })
    expect(initialize.error).toBeUndefined()

    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }, 30000)

  afterAll(async () => {
    child?.kill()
    await server?.close()
    registry?.closeAll()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('writes only JSON-RPC frames to stdout', () => {
    expect(stdoutLines.length).toBeGreaterThan(0)
    for (const line of stdoutLines) {
      const parsed = JSON.parse(line)
      expect(parsed.jsonrpc).toBe('2.0')
    }
  })

  it('advertises exactly the eight tools, with no actor argument anywhere', async () => {
    const listed = await request(2, 'tools/list', {})
    expect(listed.error).toBeUndefined()

    const tools: Array<{
      name: string
      inputSchema?: { properties?: Record<string, unknown> }
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
    }> = listed.result.tools

    // Exactly these, so a tool added later has to be a deliberate decision
    // rather than something that appeared in the agent's reach unnoticed.
    expect([...tools.map((t) => t.name)].sort()).toEqual([
      'connect_notes',
      'create_note',
      'delete_note',
      'list_trees',
      'read_note',
      'rename_note',
      'search_notes',
      'update_note',
    ])

    const byName = new Map(tools.map((t) => [t.name, t]))
    for (const readOnly of ['list_trees', 'search_notes', 'read_note']) {
      expect(byName.get(readOnly)?.annotations?.readOnlyHint).toBe(true)
    }
    expect(byName.get('delete_note')?.annotations?.destructiveHint).toBe(true)
    expect(byName.get('update_note')?.annotations?.destructiveHint).toBe(false)

    // D-06: an agent must not be able to name who it is.
    for (const tool of tools) {
      const keys = Object.keys(tool.inputSchema?.properties ?? {})
      expect(keys.filter((k) => /actor/i.test(k))).toEqual([])
    }
  })

  it('grows a note from an existing note, signed agent.claude, in one commit', async () => {
    const called = await request(3, 'tools/call', {
      name: 'create_note',
      arguments: {
        tree: 'agents',
        grewFrom: 'n1',
        title: 'Luna',
        text: 'Grown by Claude',
      },
    })

    expect(called.error).toBeUndefined()
    expect(called.result?.isError).not.toBe(true)

    const treeText = readFileSync(treePath, 'utf-8')
    // The agent id was stamped by the host from the token, not supplied.
    expect(treeText).toContain('actor plugin agent.claude')
    // Node and edge in the same commit: n2 grew from n1.
    expect(treeText).toMatch(/^create-edge e\d+ n2 n1 grew-from$/m)
  }, 30000)

  it('reads the note back, reporting the agent as its author', async () => {
    const called = await request(5, 'tools/call', {
      name: 'read_note',
      arguments: { tree: 'agents', note: 'n2' },
    })

    expect(called.error).toBeUndefined()
    expect(called.result?.isError).not.toBe(true)

    const payload = JSON.parse(called.result.content[0].text)
    expect(payload.title).toBe('Luna')
    expect(payload.text).toBe('Grown by Claude')
    // Derived from the commit's actor line, not from anything the agent sent.
    expect(payload.author).toBe('agent.claude')
    expect(payload.connections).toEqual([
      { edge: 'e1', label: 'grew-from', direction: 'out', other: 'n1' },
    ])
  }, 30000)

  it('refuses an extra actor key and writes nothing', async () => {
    const sizeBefore = statSync(treePath).size

    const called = await request(4, 'tools/call', {
      name: 'create_note',
      arguments: {
        tree: 'agents',
        grewFrom: 'n1',
        title: 'Spoofed',
        text: 'should not be written',
        actor: 'human',
      },
    })

    const refused = called.error !== undefined || called.result?.isError === true
    expect(refused).toBe(true)

    // No commit was appended.
    expect(statSync(treePath).size).toBe(sizeBefore)
  }, 30000)
})
