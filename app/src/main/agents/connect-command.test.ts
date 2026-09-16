/**
 * Connecting an agent: the command Kaelen runs, and what "connected" means.
 *
 * Two separate concerns share this file because they are the two halves of
 * the Agents panel's contract with the main process:
 *
 * 1. **The command is built, not typed.** Every interpolated value is single
 *    quoted, so a userData path containing a space ("House Party", the first
 *    vault) stays one argument and a name can never end the quoting early
 *    (T-02.2-23). The token appears exactly once, because the panel shows it
 *    exactly once.
 * 2. **Connection status is observed, not reported.** An agent counts as
 *    connected because a request carrying its token arrived recently, not
 *    because anything announced itself.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createConnection } from 'node:net'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { AgentRegistry, agentSocketPath } from './registry'
import { AgentSocketServer } from './socket-server'
import { buildConnectCommand, shellQuote } from './connect-command'

const dirs: string[] = []
const servers: AgentSocketServer[] = []

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix)
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()!.close()
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// shellQuote
// ---------------------------------------------------------------------------

describe('shellQuote', () => {
  it('wraps a value in single quotes', () => {
    expect(shellQuote('tapestry')).toBe("'tapestry'")
  })

  it('keeps a path containing a space as one argument', () => {
    // The first vault Tapestry is built against lives at ~/House Party.
    expect(shellQuote('/Users/kaelen/House Party')).toBe("'/Users/kaelen/House Party'")
  })

  it("escapes an embedded single quote as '\\''", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })

  it('cannot be ended early by a crafted value', () => {
    // A value trying to close the quote and append its own command stays
    // entirely inside one quoted argument.
    const hostile = "x'; rm -rf /; echo '"
    const quoted = shellQuote(hostile)
    expect(quoted.startsWith("'")).toBe(true)
    expect(quoted.endsWith("'")).toBe(true)
    // Every original quote became the escaped form, so no bare ' survives.
    expect(quoted).toBe("'x'\\''; rm -rf /; echo '\\'''")
  })
})

// ---------------------------------------------------------------------------
// buildConnectCommand
// ---------------------------------------------------------------------------

const BASE = {
  token: 'tok-abc',
  userDataDir: '/Users/kaelen/Library/Application Support/Tapestry',
  appPath: '/Users/kaelen/Tapestry/app',
  execPath: '/Applications/Tapestry.app/Contents/MacOS/Tapestry',
  resourcesPath: '/Applications/Tapestry.app/Contents/Resources',
}

describe('buildConnectCommand', () => {
  it('builds the development variant, run under system node', () => {
    const command = buildConnectCommand({ ...BASE, isPackaged: false })

    expect(command).toBe(
      "claude mcp add tapestry --scope user --transport stdio " +
        "--env 'TAPESTRY_AGENT_TOKEN=tok-abc' " +
        "--env 'TAPESTRY_USER_DATA=/Users/kaelen/Library/Application Support/Tapestry' " +
        "-- node '/Users/kaelen/Tapestry/app/out/main/mcp.js'",
    )
  })

  it('builds the packaged variant, run under Electron as node', () => {
    const command = buildConnectCommand({ ...BASE, isPackaged: true })

    expect(command).toBe(
      "claude mcp add tapestry --scope user --transport stdio " +
        "--env 'TAPESTRY_AGENT_TOKEN=tok-abc' " +
        "--env 'TAPESTRY_USER_DATA=/Users/kaelen/Library/Application Support/Tapestry' " +
        "--env 'ELECTRON_RUN_AS_NODE=1' " +
        "-- '/Applications/Tapestry.app/Contents/MacOS/Tapestry' " +
        "'/Applications/Tapestry.app/Contents/Resources/app.asar/out/main/mcp.js'",
    )
  })

  // The old order named the server after the env flags, and that command
  // reached a real terminal as:
  //   Invalid environment variable format: tapestry, environment variables
  //   should be added as: -e KEY1=value1 -e KEY2=value2
  // The CLI's usage is `claude mcp add [options] <name> <commandOrUrl>
  // [args...]`, and its `-e, --env <env...>` option is variadic, so it keeps
  // consuming following non-option tokens until an option or `--`. This test
  // states that rule instead of a string someone could simply update to match
  // whatever the builder happens to emit.
  it('puts the server name before --env, which is variadic and would swallow it', () => {
    for (const isPackaged of [false, true]) {
      // Splitting on spaces is safe here: the only value containing a space is
      // the quoted userData path, whose fragments are neither `--`, `-e` nor
      // `--env`.
      const tokens = buildConnectCommand({ ...BASE, isPackaged }).split(' ')
      const nameIndex = tokens.indexOf('tapestry')
      const envIndexes = tokens.flatMap((t, i) => (t === '--env' || t === '-e' ? [i] : []))
      const separatorIndexes = tokens.flatMap((t, i) => (t === '--' ? [i] : []))

      // The name is present, and it leads the env flags rather than becoming
      // one of their values.
      expect(nameIndex).toBeGreaterThan(-1)
      expect(envIndexes.length).toBeGreaterThan(0)
      expect(nameIndex).toBeLessThan(envIndexes[0])

      // Exactly one separator, and it closes the variadic env list, so no env
      // value can run into the runtime command.
      expect(separatorIndexes).toHaveLength(1)
      const separatorIndex = separatorIndexes[0]
      for (const envIndex of envIndexes) {
        expect(envIndex).toBeLessThan(separatorIndex)
      }

      // The runtime command starts on the token right after the separator.
      expect(tokens[separatorIndex + 1]).toBe(isPackaged ? shellQuote(BASE.execPath) : 'node')
    }
  })

  it('names the token exactly once, because it is shown exactly once', () => {
    for (const isPackaged of [false, true]) {
      const command = buildConnectCommand({ ...BASE, isPackaged })
      expect(command.split('tok-abc')).toHaveLength(2)
    }
  })

  it('keeps a userData path containing a space as one argument', () => {
    const command = buildConnectCommand({
      ...BASE,
      isPackaged: false,
      userDataDir: '/Users/kaelen/House Party',
    })

    expect(command).toContain("--env 'TAPESTRY_USER_DATA=/Users/kaelen/House Party'")
  })
})

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

interface Harness {
  dir: string
  socketPath: string
  token: string
  agents: AgentRegistry
  server: AgentSocketServer
}

async function startHarness(prefix: string): Promise<Harness> {
  const dir = tempDir(prefix)
  const socketPath = agentSocketPath(dir)
  const agents = new AgentRegistry(join(dir, 'agents.json'))
  const { token } = agents.create('claude')

  const server = new AgentSocketServer({
    socketPath,
    agents,
    dispatch: () => ({ ok: true, value: null }),
  })
  servers.push(server)
  await server.listen()

  return { dir, socketPath, token, agents, server }
}

/** Send one request and resolve with the parsed response. */
function sendJson(socketPath: string, request: unknown): Promise<any> {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      rejectPromise(new Error('timed out waiting for a response'))
    }, 10000)

    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8')
      const index = buffer.indexOf('\n')
      if (index === -1) return
      clearTimeout(timer)
      const line = buffer.slice(0, index)
      socket.destroy()
      resolvePromise(JSON.parse(line))
    })
    socket.on('error', (err) => {
      clearTimeout(timer)
      rejectPromise(err)
    })
  })
}

describe('AgentSocketServer.connectionStates', () => {
  it('reports an agent that has never connected', async () => {
    const h = await startHarness('states-never')

    expect(h.server.connectionStates()).toEqual([
      { name: 'claude', connected: false, lastConnectedAt: null },
    ])
  })

  it('reports an agent connected after a request carrying its token', async () => {
    const h = await startHarness('states-now')

    await sendJson(h.socketPath, { id: 1, token: h.token, tool: 'list_trees', args: {} })

    const states = h.server.connectionStates()
    expect(states).toHaveLength(1)
    expect(states[0].name).toBe('claude')
    expect(states[0].connected).toBe(true)
    expect(states[0].lastConnectedAt).not.toBeNull()
  })

  it('idles out after 120 seconds, keeping the persisted last-connected time', async () => {
    const h = await startHarness('states-idle')

    await sendJson(h.socketPath, { id: 1, token: h.token, tool: 'list_trees', args: {} })

    // Still connected a minute later...
    const withinWindow = h.server.connectionStates(Date.now() + 60_000)
    expect(withinWindow[0].connected).toBe(true)

    // ...and no longer connected past the window, but the app still knows
    // when it last was, because that is persisted rather than remembered.
    const past = h.server.connectionStates(Date.now() + 121_000)
    expect(past[0].connected).toBe(false)
    expect(past[0].lastConnectedAt).not.toBeNull()
  })

  it('never reports an unknown token as a connection', async () => {
    const h = await startHarness('states-unknown')

    await sendJson(h.socketPath, { id: 1, token: 'not-the-token', tool: 'list_trees', args: {} })

    expect(h.server.connectionStates()[0].connected).toBe(false)
  })

  it('announces the moment an agent first becomes connected, once', async () => {
    const h = await startHarness('states-events')

    let fired = 0
    h.server.onConnectionsChanged(() => {
      fired += 1
    })

    await sendJson(h.socketPath, { id: 1, token: h.token, tool: 'list_trees', args: {} })
    expect(fired).toBe(1)

    // A second request from an agent already shown as connected changes
    // nothing on screen, so it must not re-announce.
    await sendJson(h.socketPath, { id: 2, token: h.token, tool: 'list_trees', args: {} })
    expect(fired).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// markConnected throttling
// ---------------------------------------------------------------------------

describe('AgentRegistry.markConnected', () => {
  it('persists at most once per 60 seconds per agent', () => {
    const dir = tempDir('mark-throttle')
    const agents = new AgentRegistry(join(dir, 'agents.json'))
    agents.create('claude')

    const first = new Date('2026-09-16T10:00:00.000Z')
    agents.markConnected('claude', first)
    expect(agents.list()[0].lastConnectedAt).toBe(first.toISOString())

    // Every tool call would otherwise rewrite agents.json; within the window
    // the stored time stays where it was.
    agents.markConnected('claude', new Date('2026-09-16T10:00:30.000Z'))
    expect(agents.list()[0].lastConnectedAt).toBe(first.toISOString())

    // Past the window it is written again.
    const later = new Date('2026-09-16T10:01:01.000Z')
    agents.markConnected('claude', later)
    expect(agents.list()[0].lastConnectedAt).toBe(later.toISOString())
  })

  it('throttles each agent separately', () => {
    const dir = tempDir('mark-separate')
    const agents = new AgentRegistry(join(dir, 'agents.json'))
    agents.create('claude')
    agents.create('chatgpt')

    const at = new Date('2026-09-16T10:00:00.000Z')
    agents.markConnected('claude', at)
    // chatgpt has its own window, so its first write is not swallowed by
    // claude's.
    agents.markConnected('chatgpt', new Date('2026-09-16T10:00:10.000Z'))

    const byName = new Map(agents.list().map((a) => [a.name, a.lastConnectedAt]))
    expect(byName.get('claude')).toBe(at.toISOString())
    expect(byName.get('chatgpt')).toBe('2026-09-16T10:00:10.000Z')
  })
})
