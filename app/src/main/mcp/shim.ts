/**
 * `tapestry-mcp` — the stdio MCP server an agent client launches.
 *
 * Claude Code (or any stdio MCP client) runs this file. It speaks MCP on
 * stdin/stdout and forwards each tool call to the running Tapestry over a 0600
 * Unix socket, where the token becomes `agent.<name>` (D-06) and the command
 * layer enforces D-04.
 *
 * Two rules govern this file:
 *
 * 1. **Nothing is ever written to stdout except the protocol.** stdout is the
 *    transport; a stray `console.log` corrupts the JSON-RPC stream. Every
 *    diagnostic goes to stderr.
 * 2. **No electron, no native addon, no `.tree` access.** The shim is a thin
 *    relay. Tapestry holds the journal lock and does all writing, so a second
 *    writer is impossible by construction rather than by agreement.
 *
 * This entry opens no TCP port. The loopback HTTP transport is Plan 14.
 */

import { connect } from 'node:net'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { agentSocketPath } from '../agents/registry'
import { buildMcpServer, type ToolCaller, type ToolCallResult } from './tools'

/** A single tool call gets this long before it is abandoned. */
const CALL_TIMEOUT_MS = 30_000

const NO_TOKEN_MESSAGE =
  'TAPESTRY_AGENT_TOKEN is not set. Connect this agent from the Agents panel in Tapestry.'
const NOT_RUNNING_MESSAGE = 'Tapestry is not running. Open Tapestry, then try again.'
const NO_USER_DATA_MESSAGE =
  'TAPESTRY_USER_DATA is not set. Re-add this server with the command shown in the Agents panel in Tapestry.'

/**
 * Forwards a tool call to the running app over the agent socket.
 *
 * One connection per call, which keeps the shim stateless: if Tapestry is
 * restarted between calls, the next call simply reconnects.
 */
class SocketCaller implements ToolCaller {
  private nextId = 1

  constructor(
    private readonly token: string,
    private readonly userDataDir: string,
  ) {}

  call(tool: string, args: unknown): Promise<ToolCallResult> {
    if (!this.token) {
      return Promise.resolve({ ok: false, error: NO_TOKEN_MESSAGE })
    }
    if (!this.userDataDir) {
      return Promise.resolve({ ok: false, error: NO_USER_DATA_MESSAGE })
    }

    const id = this.nextId++
    const socketPath = agentSocketPath(this.userDataDir)

    return new Promise<ToolCallResult>((resolvePromise) => {
      let settled = false
      const finish = (result: ToolCallResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        resolvePromise(result)
      }

      const timer = setTimeout(() => {
        finish({ ok: false, error: `Tapestry did not answer within ${CALL_TIMEOUT_MS / 1000}s` })
      }, CALL_TIMEOUT_MS)

      const socket = connect(socketPath)
      let buffer = ''

      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ id, token: this.token, tool, args })}\n`)
      })

      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8')
        const index = buffer.indexOf('\n')
        if (index === -1) return
        const line = buffer.slice(0, index)
        try {
          const parsed = JSON.parse(line) as { ok?: unknown; value?: unknown; error?: unknown }
          if (parsed.ok === true) {
            finish({ ok: true, value: parsed.value })
          } else {
            finish({
              ok: false,
              error: typeof parsed.error === 'string' ? parsed.error : 'Tapestry refused the request',
            })
          }
        } catch {
          finish({ ok: false, error: 'Tapestry sent a malformed response' })
        }
      })

      socket.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
          finish({ ok: false, error: NOT_RUNNING_MESSAGE })
          return
        }
        finish({ ok: false, error: err.message })
      })

      socket.on('close', () => {
        finish({ ok: false, error: NOT_RUNNING_MESSAGE })
      })
    })
  }
}

const caller = new SocketCaller(
  process.env.TAPESTRY_AGENT_TOKEN ?? '',
  process.env.TAPESTRY_USER_DATA ?? '',
)

serveStdio(() => buildMcpServer(caller), {
  onerror: (error: Error) => {
    console.error('[tapestry-mcp]', error.message)
  },
})
