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
 *  - `look` reports the notes around a note as relations, never coordinates (D-14)
 *  - `place` moves an agent's note and makes it follow its parent, and refuses
 *    a person's note because its layout is locked to them (02.5 D-15)
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
import { SpatialCommands } from '../commands/spatial'
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
      spatial: new SpatialCommands(registry),
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

  it('advertises exactly the twenty tools, with no actor argument anywhere', async () => {
    const listed = await request(2, 'tools/list', {})
    expect(listed.error).toBeUndefined()

    const tools: Array<{
      name: string
      inputSchema?: { properties?: Record<string, unknown> }
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
    }> = listed.result.tools

    // Exactly these, so a tool added later has to be a deliberate decision
    // rather than something that appeared in the agent's reach unnoticed.
    // Plan 08 added the five D-20..D-24 thread tools alongside the original
    // eight note/connection tools.
    expect([...tools.map((t) => t.name)].sort()).toEqual([
      'append_to_thread',
      'connect_notes',
      'create_note',
      'create_thread',
      'delete_from_thread',
      'delete_note',
      'edit_file',
      'insert_into_thread',
      'list_files',
      'list_trees',
      'look',
      'open_file',
      'place',
      'read_file',
      'read_note',
      'rename_note',
      'replace_in_thread',
      'search_notes',
      'update_note',
      'write_file',
    ])

    const byName = new Map(tools.map((t) => [t.name, t]))
    for (const readOnly of ['list_trees', 'search_notes', 'read_note', 'look']) {
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

  it('looks around the grown note and sees relations, never coordinates', async () => {
    const called = await request(6, 'tools/call', {
      name: 'look',
      arguments: { tree: 'agents', from: 'n2' },
    })

    expect(called.error).toBeUndefined()
    expect(called.result?.isError).not.toBe(true)

    const text: string = called.result.content[0].text
    const payload = JSON.parse(text)
    const [only] = registry.list()
    // n1 sits at 0,0 with the default size; n2 was grown to 360,0, so the gap is 80.
    expect(payload.neighbours).toEqual([
      { note: 'n1', space: only.id, relation: 'near', order: 1, guess: false },
    ])
    expect(text).not.toContain('position')
  }, 30000)

  it('places the grown note near the note it grew from, so it follows', async () => {
    const called = await request(7, 'tools/call', {
      name: 'place',
      arguments: { tree: 'agents', note: 'n2', where: { near: 'n1' } },
    })

    expect(called.error).toBeUndefined()
    expect(called.result?.isError).not.toBe(true)

    const treeText = readFileSync(treePath, 'utf-8')
    expect(treeText).toContain('Place note n2 near n1')
    expect(treeText).toMatch(/^set n2 pinned bool false$/m)
  }, 30000)

  it("refuses to move the person's note, naming user.kaelen, and writes nothing", async () => {
    const sizeBefore = statSync(treePath).size

    const called = await request(8, 'tools/call', {
      name: 'place',
      arguments: { tree: 'agents', note: 'n1', where: { near: 'n2' } },
    })

    const refused = called.error !== undefined || called.result?.isError === true
    expect(refused).toBe(true)
    expect(JSON.stringify(called.error ?? called.result)).toContain('user.kaelen')
    expect(statSync(treePath).size).toBe(sizeBefore)
  }, 30000)

  it('creates a note with where near the note it grew from, so it follows, stepping past n2', async () => {
    const called = await request(9, 'tools/call', {
      name: 'create_note',
      arguments: {
        tree: 'agents',
        grewFrom: 'n1',
        title: 'Near',
        text: 'placed by where',
        where: { near: 'n1' },
      },
    })

    expect(called.error).toBeUndefined()
    expect(called.result?.isError).not.toBe(true)

    // n1 is at 0,0 with the default size and n2 already sits at 360,0, so the
    // new note steps down once: 0 + height 120 + gutter 24.
    const treeText = readFileSync(treePath, 'utf-8')
    expect(treeText).toContain('create-node n3')
    expect(treeText).toMatch(/^set n3 pinned bool false$/m)
    expect(treeText).toMatch(/^set n3 position\.x real 360$/m)
    expect(treeText).toMatch(/^set n3 position\.y real 144$/m)
    expect(treeText).toContain('placed near n1')
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

/** Poll until `check` is true or the time runs out. */
async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  return check()
}

describe('MCP shim connect-on-start (D-20)', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterAll(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!()
    }
  })

  function spawnShim(
    dir: string,
    token: string,
    extraEnv: Record<string, string> = {},
  ): { child: ChildProcessWithoutNullStreams; stdout: () => string } {
    let stdout = ''
    const shim = spawn(process.execPath, [SHIM_PATH], {
      env: { ...process.env, TAPESTRY_AGENT_TOKEN: token, TAPESTRY_USER_DATA: dir, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    shim.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    shim.stderr.on('data', () => {
      // A failed hello may say so once on stderr; that is allowed.
    })
    cleanups.push(() => {
      shim.kill()
    })
    return { child: shim, stdout: () => stdout }
  }

  it('shows the agent connected before any tool call or MCP initialize', async () => {
    const dir = makeTempDir('mcp-hello')
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const agents = new AgentRegistry(join(dir, 'agents.json'))
    const { token } = agents.create('claude')
    const calls: string[] = []
    const helloServer = new AgentSocketServer({
      socketPath: agentSocketPath(dir),
      agents,
      dispatch: (_name, tool) => {
        calls.push(tool)
        return { ok: true, value: null }
      },
    })
    await helloServer.listen()
    cleanups.push(() => helloServer.close())

    const shim = spawnShim(dir, token)

    const connected = await waitFor(
      () => helloServer.connectionStates().find((a) => a.name === 'claude')?.connected === true,
      3000,
    )
    expect(connected).toBe(true)
    expect(calls).toEqual([])
    // No initialize was sent, so the protocol has nothing to say yet.
    expect(shim.stdout()).toBe('')
  }, 15000)

  it('retries its hello until Tapestry starts, with nothing but protocol on stdout', async () => {
    const dir = makeTempDir('mcp-hello-late')
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const agents = new AgentRegistry(join(dir, 'agents.json'))
    const { token } = agents.create('claude')

    // The shim starts first, so its first hello finds no socket.
    const shim = spawnShim(dir, token, { TAPESTRY_HELLO_INTERVAL_MS: '200' })
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))

    const lateServer = new AgentSocketServer({
      socketPath: agentSocketPath(dir),
      agents,
      dispatch: () => ({ ok: true, value: null }),
    })
    await lateServer.listen()
    cleanups.push(() => lateServer.close())

    const connected = await waitFor(
      () => lateServer.connectionStates().find((a) => a.name === 'claude')?.connected === true,
      2000,
    )
    expect(connected).toBe(true)

    for (const line of shim.stdout().split('\n').filter((l) => l.trim().length > 0)) {
      expect(JSON.parse(line).jsonrpc).toBe('2.0')
    }
    expect(shim.stdout()).toBe('')
  }, 15000)
})
