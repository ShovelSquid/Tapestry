/**
 * The agent socket: who may talk to Tapestry, and what it refuses.
 *
 * The socket is the only door an agent's request comes through, so these tests
 * are about the door rather than the command behind it: file permissions, token
 * verification before dispatch, and refusing a request too large to be honest.
 *
 * `dispatch` is a spy throughout — a request that reaches it has already passed
 * identity, which is precisely the property being asserted.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createConnection } from 'node:net'
import { createServer, type Server } from 'node:net'
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { AgentRegistry, agentSocketPath } from './registry'
import { AgentSocketServer } from './socket-server'
import type { CommandResult } from '../commands/notes'

const dirs: string[] = []
const servers: AgentSocketServer[] = []
const rawServers: Server[] = []

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix)
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()!.close()
  }
  while (rawServers.length > 0) {
    const raw = rawServers.pop()!
    await new Promise<void>((resolvePromise) => raw.close(() => resolvePromise()))
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

interface Harness {
  dir: string
  socketPath: string
  token: string
  calls: Array<{ agent: string; tool: string; args: unknown }>
  server: AgentSocketServer
}

async function startHarness(prefix: string, maxLineBytes?: number): Promise<Harness> {
  const dir = tempDir(prefix)
  const socketPath = agentSocketPath(dir)
  const agents = new AgentRegistry(join(dir, 'agents.json'))
  const { token } = agents.create('claude')

  const calls: Array<{ agent: string; tool: string; args: unknown }> = []
  const server = new AgentSocketServer({
    socketPath,
    agents,
    dispatch: (agent, tool, args): CommandResult<unknown> => {
      calls.push({ agent, tool, args })
      return { ok: true, value: { agent } }
    },
    ...(maxLineBytes !== undefined ? { maxLineBytes } : {}),
  })
  servers.push(server)
  await server.listen()

  return { dir, socketPath, token, calls, server }
}

/** Send one raw payload and resolve with the first response line. */
function sendRaw(socketPath: string, payload: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      rejectPromise(new Error('timed out waiting for a response'))
    }, 10000)

    socket.on('connect', () => socket.write(payload))
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8')
      const index = buffer.indexOf('\n')
      if (index === -1) return
      clearTimeout(timer)
      const line = buffer.slice(0, index)
      socket.destroy()
      resolvePromise(line)
    })
    socket.on('error', (err) => {
      clearTimeout(timer)
      rejectPromise(err)
    })
  })
}

function sendJson(socketPath: string, request: unknown): Promise<any> {
  return sendRaw(socketPath, `${JSON.stringify(request)}\n`).then((line) => JSON.parse(line))
}

describe('AgentSocketServer', () => {
  it('creates the socket at mode 0600 inside a 0700 directory', async () => {
    const h = await startHarness('sock-mode')

    expect(statSync(h.socketPath).isSocket()).toBe(true)
    expect(statSync(h.socketPath).mode & 0o777).toBe(0o600)
    // The socket's OWN parent: agentSocketPath falls back to /tmp when the
    // userData path is too long for a sockaddr_un, so asserting the temp dir
    // would silently check a directory the socket does not live in.
    expect(statSync(dirname(h.socketPath)).mode & 0o777).toBe(0o700)
  })

  it('dispatches a request carrying a valid token', async () => {
    const h = await startHarness('sock-ok')

    const response = await sendJson(h.socketPath, {
      id: 7,
      token: h.token,
      tool: 'create_note',
      args: { tree: 'notes' },
    })

    expect(response).toEqual({ id: 7, ok: true, value: { agent: 'claude' } })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].agent).toBe('claude')
  })

  it('refuses an unknown token without ever calling dispatch', async () => {
    const h = await startHarness('sock-token')

    const response = await sendJson(h.socketPath, {
      id: 1,
      token: 'not-the-token',
      tool: 'create_note',
      args: {},
    })

    expect(response).toEqual({ id: 1, ok: false, error: 'Unknown agent token' })
    // The point of the test: identity is checked before anything runs.
    expect(h.calls).toHaveLength(0)
  })

  it('refuses a malformed request', async () => {
    const h = await startHarness('sock-malformed')

    const response = await sendRaw(h.socketPath, 'this is not json\n')
    expect(JSON.parse(response)).toEqual({ ok: false, error: 'Malformed request' })
    expect(h.calls).toHaveLength(0)
  })

  it('refuses a line larger than the cap and closes the connection', async () => {
    const h = await startHarness('sock-large', 1024)

    // No newline: the request is already too large to ever be valid.
    const huge = 'x'.repeat(2048)
    const response = await sendRaw(h.socketPath, huge)

    expect(JSON.parse(response)).toEqual({ ok: false, error: 'Request too large' })
    expect(h.calls).toHaveLength(0)
  })

  it('replaces a stale socket left by a previous session', async () => {
    const dir = tempDir('sock-stale')
    const socketPath = agentSocketPath(dir)

    // A socket file sitting at the path, as a crashed session would leave.
    const stale = createServer()
    rawServers.push(stale)
    await new Promise<void>((resolvePromise) => stale.listen(socketPath, () => resolvePromise()))
    expect(statSync(socketPath).isSocket()).toBe(true)

    const agents = new AgentRegistry(join(dir, 'agents.json'))
    const { token } = agents.create('claude')
    const server = new AgentSocketServer({
      socketPath,
      agents,
      dispatch: () => ({ ok: true, value: 'replaced' }),
    })
    servers.push(server)

    await expect(server.listen()).resolves.toBeUndefined()

    const response = await sendJson(socketPath, {
      id: 1,
      token,
      tool: 'create_note',
      args: {},
    })
    expect(response).toEqual({ id: 1, ok: true, value: 'replaced' })
  })

  it('never deletes a regular file sitting at the socket path', async () => {
    const dir = tempDir('sock-regular')
    const socketPath = agentSocketPath(dir)
    writeFileSync(socketPath, 'precious user data')

    const agents = new AgentRegistry(join(dir, 'agents.json'))
    const server = new AgentSocketServer({
      socketPath,
      agents,
      dispatch: () => ({ ok: true, value: null }),
    })

    await expect(server.listen()).rejects.toThrow(/Refusing to replace non-socket file/)
    // The file is still there, untouched.
    expect(readFileSync(socketPath, 'utf-8')).toBe('precious user data')
  })
})

describe('AgentRegistry', () => {
  it('stores only a sha256 digest, never the token', () => {
    const dir = tempDir('agents-store')
    const filePath = join(dir, 'agents.json')
    const agents = new AgentRegistry(filePath)

    const { token } = agents.create('claude')
    const raw = readFileSync(filePath, 'utf-8')

    expect(raw).not.toContain(token)
    const stored = JSON.parse(raw).agents[0]
    expect(stored.tokenSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.name).toBe('claude')
  })

  it('verifies a token and rejects every other one', () => {
    const dir = tempDir('agents-verify')
    const agents = new AgentRegistry(join(dir, 'agents.json'))
    const { token } = agents.create('claude')

    expect(agents.verify(token)?.name).toBe('claude')
    expect(agents.verify(`${token}x`)).toBeNull()
    expect(agents.verify('')).toBeNull()
  })

  it('refuses a duplicate agent name', () => {
    const dir = tempDir('agents-dupe')
    const agents = new AgentRegistry(join(dir, 'agents.json'))
    agents.create('claude')

    expect(() => agents.create('claude')).toThrow('agent.claude already exists')
  })

  it('reads a corrupt agents.json as no agents, so every token is refused', () => {
    const dir = tempDir('agents-corrupt')
    const filePath = join(dir, 'agents.json')
    writeFileSync(filePath, '{ not json')

    const agents = new AgentRegistry(filePath)
    expect(agents.list()).toEqual([])
    expect(agents.verify('anything')).toBeNull()
  })
})
