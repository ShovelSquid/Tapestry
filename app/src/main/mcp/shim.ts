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

/**
 * D-20: how often the shim says hello while its client runs.
 *
 * Well inside the socket server's 120 s CONNECTED_WINDOW_MS, so an idle but
 * running client keeps reading as `Connected now`.
 */
export const HELLO_INTERVAL_MS = 60_000

/** A hello is a small bookkeeping call; it gives up quickly. */
const HELLO_TIMEOUT_MS = 5_000

/** Tests may shorten the interval; it never goes below this. */
const MIN_HELLO_INTERVAL_MS = 100

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
    return this.request({ token: this.token, tool, args }, CALL_TIMEOUT_MS)
  }

  /**
   * D-20: tell Tapestry this agent's MCP client is running.
   *
   * Resolves true when Tapestry accepted the hello. Never rejects and never
   * writes to stdout: a hello that fails (Tapestry not running, a revoked
   * token) is simply retried by the next keep-alive.
   */
  async hello(onFailure?: (error: string) => void): Promise<boolean> {
    if (!this.token || !this.userDataDir) return false
    const result = await this.request({ token: this.token, type: 'hello' }, HELLO_TIMEOUT_MS)
    if (!result.ok) onFailure?.(result.error)
    return result.ok
  }

  /** One connection, one JSON line out, one JSON line back. */
  private request(payload: Record<string, unknown>, timeoutMs: number): Promise<ToolCallResult> {
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
        finish({ ok: false, error: `Tapestry did not answer within ${timeoutMs / 1000}s` })
      }, timeoutMs)

      const socket = connect(socketPath)
      let buffer = ''

      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ id, ...payload })}\n`)
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

/**
 * The keep-alive interval: TAPESTRY_HELLO_INTERVAL_MS (tests only), clamped to
 * at least 100 ms, else HELLO_INTERVAL_MS.
 */
function helloInterval(): number {
  const raw = process.env.TAPESTRY_HELLO_INTERVAL_MS
  if (raw === undefined || raw.trim() === '') return HELLO_INTERVAL_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return HELLO_INTERVAL_MS
  return Math.max(MIN_HELLO_INTERVAL_MS, parsed)
}

/** Failure kinds already reported on stderr, so each is said at most once. */
const reportedHelloFailures = new Set<string>()

function reportHelloFailure(error: string): void {
  if (reportedHelloFailures.has(error)) return
  reportedHelloFailures.add(error)
  // stderr only: stdout is the protocol.
  console.error('[tapestry-mcp] hello:', error)
}

function sayHello(): void {
  void caller.hello(reportHelloFailure)
}

// D-20: the Agents panel shows this agent as connected as soon as its client
// starts the shim, not only after its first tool call. The timer is unref'd,
// so it never keeps the shim alive once the client has gone.
if (process.env.TAPESTRY_AGENT_TOKEN && process.env.TAPESTRY_USER_DATA) {
  sayHello()
  setInterval(sayHello, helloInterval()).unref()
}

serveStdio(() => buildMcpServer(caller), {
  onerror: (error: Error) => {
    console.error('[tapestry-mcp]', error.message)
  },
})
