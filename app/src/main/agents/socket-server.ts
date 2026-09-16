/**
 * AgentSocketServer — the only door an agent's request comes through.
 *
 * Tapestry holds the journal's exclusive flock for the life of an open world,
 * so a second process cannot write a `.tree` file (RESEARCH Pattern 2). The
 * MCP shim therefore forwards every tool call here as a JSON line, and the app
 * does the writing.
 *
 * The socket is a **Unix domain socket** with mode 0600 inside a 0700
 * directory. No TCP port is opened anywhere in this file: a browser page
 * cannot address a Unix socket, which is what keeps DNS rebinding off the
 * table entirely (T-02.2-17).
 *
 * Wire protocol, one JSON object per line:
 *   in   { id, token, tool, args }
 *   out  { id, ok: true, value } | { id, ok: false, error }
 *
 * Tokens are never logged.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentRegistry } from './registry'
import type { CommandResult } from '../commands/notes'

export interface AgentSocketServerOptions {
  socketPath: string
  agents: AgentRegistry
  dispatch: (
    agentName: string,
    tool: string,
    args: unknown,
  ) => CommandResult<unknown> | Promise<CommandResult<unknown>>
  /** Refuse a single request larger than this. Defaults to 4 MiB. */
  maxLineBytes?: number
}

const DEFAULT_MAX_LINE_BYTES = 4 * 1024 * 1024
const NEWLINE = 0x0a

/**
 * How recently a request must have arrived for an agent to read as connected.
 *
 * The shim opens one connection per call and closes it again, so an open
 * socket is not what "connected" means here — a recent request is.
 */
const CONNECTED_WINDOW_MS = 120_000

/** How often an agent that has gone quiet is noticed to have idled out. */
const IDLE_CHECK_MS = 30_000

/** What the Agents panel shows for one agent. */
export interface AgentConnectionState {
  name: string
  connected: boolean
  /** ISO timestamp, persisted across restarts, or null if it never has. */
  lastConnectedAt: string | null
}

export class AgentSocketServer {
  private readonly socketPath: string
  private readonly agents: AgentRegistry
  private readonly dispatch: AgentSocketServerOptions['dispatch']
  private readonly maxLineBytes: number
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()

  /** When each agent's last authenticated request arrived. */
  private readonly lastSeen = new Map<string, number>()

  /** Agents currently shown as connected, so a change can be detected. */
  private readonly connectedNames = new Set<string>()

  private readonly connectionListeners = new Set<() => void>()

  private idleTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: AgentSocketServerOptions) {
    this.socketPath = options.socketPath
    this.agents = options.agents
    this.dispatch = options.dispatch
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
  }

  async listen(): Promise<void> {
    const dir = dirname(this.socketPath)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    // mkdirSync's mode is subject to the process umask, so set it explicitly.
    chmodSync(dir, 0o700)

    // A stale socket from a crashed session is replaced. Anything that is not
    // a socket is left alone: deleting an unexpected regular file at this path
    // could destroy data that has nothing to do with us.
    let existing: ReturnType<typeof lstatSync> | null = null
    try {
      existing = lstatSync(this.socketPath)
    } catch {
      existing = null
    }
    if (existing) {
      if (!existing.isSocket()) {
        throw new Error(`Refusing to replace non-socket file at ${this.socketPath}`)
      }
      unlinkSync(this.socketPath)
    }

    const server = createServer((socket) => this.handleConnection(socket))
    this.server = server

    // The socket's permissions are set by the umask at bind time; chmod after
    // the fact would leave a window where it was world-writable.
    const previousUmask = process.umask(0o177)
    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const onError = (err: Error): void => {
          server.removeListener('listening', onListening)
          rejectPromise(err)
        }
        const onListening = (): void => {
          server.removeListener('error', onError)
          resolvePromise()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(this.socketPath)
      })
    } finally {
      process.umask(previousUmask)
    }

    chmodSync(this.socketPath, 0o600)

    // An agent that simply stops calling has to stop reading as connected.
    // unref'd so this timer alone never holds the process open.
    this.idleTimer = setInterval(() => this.sweepIdle(), IDLE_CHECK_MS)
    this.idleTimer.unref?.()
  }

  async close(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    this.lastSeen.clear()
    this.connectedNames.clear()

    for (const socket of [...this.sockets]) {
      socket.destroy()
    }
    this.sockets.clear()

    const server = this.server
    this.server = null
    if (server) {
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise())
      })
    }

    try {
      if (existsSync(this.socketPath) && lstatSync(this.socketPath).isSocket()) {
        unlinkSync(this.socketPath)
      }
    } catch {
      // Already gone, or not ours to remove.
    }
  }

  // -------------------------------------------------------------------------
  // Connection handling
  // -------------------------------------------------------------------------

  private handleConnection(socket: Socket): void {
    this.sockets.add(socket)
    let buffer = Buffer.alloc(0)
    let closed = false

    const refuseTooLarge = (): void => {
      closed = true
      this.writeLine(socket, { ok: false, error: 'Request too large' })
      socket.destroy()
      this.sockets.delete(socket)
    }

    socket.on('data', (chunk: Buffer) => {
      if (closed) return
      buffer = Buffer.concat([buffer, chunk])

      for (;;) {
        const index = buffer.indexOf(NEWLINE)
        if (index === -1) {
          // An unterminated request already over the cap will never be valid.
          if (buffer.length > this.maxLineBytes) refuseTooLarge()
          return
        }
        const line = buffer.subarray(0, index)
        buffer = buffer.subarray(index + 1)
        if (line.length > this.maxLineBytes) {
          refuseTooLarge()
          return
        }
        void this.handleLine(socket, line.toString('utf-8'))
      }
    })

    socket.on('close', () => {
      this.sockets.delete(socket)
    })

    // A client that disappears mid-write must not raise an unhandled error.
    socket.on('error', () => {
      this.sockets.delete(socket)
    })
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    if (line.trim().length === 0) return

    let request: { id?: unknown; token?: unknown; tool?: unknown; args?: unknown }
    try {
      request = JSON.parse(line)
    } catch {
      this.writeLine(socket, { ok: false, error: 'Malformed request' })
      return
    }

    const id = typeof request?.id === 'number' || typeof request?.id === 'string' ? request.id : null

    if (
      !request ||
      typeof request.token !== 'string' ||
      typeof request.tool !== 'string' ||
      typeof request.args !== 'object' ||
      request.args === null ||
      Array.isArray(request.args)
    ) {
      this.writeLine(socket, { id, ok: false, error: 'Malformed request' })
      return
    }

    // Identity first: an unknown token never reaches a command.
    const agent = this.agents.verify(request.token)
    if (!agent) {
      this.writeLine(socket, { id, ok: false, error: 'Unknown agent token' })
      return
    }

    // Only a request that passed identity counts as this agent being here.
    this.noteSeen(agent.name)

    try {
      this.agents.markConnected(agent.name, new Date())
    } catch (err) {
      // Bookkeeping only — a failure here must not refuse a valid request.
      console.error('[AgentSocketServer] could not record connection time:', err)
    }

    try {
      const result = await this.dispatch(agent.name, request.tool, request.args)
      this.writeLine(socket, { id, ...result })
    } catch (err) {
      this.writeLine(socket, {
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // -------------------------------------------------------------------------
  // Connection status (Agents panel)
  // -------------------------------------------------------------------------

  /**
   * Every known agent, with whether it is connected right now.
   *
   * `connected` is observed — a request carrying that agent's token arrived
   * within the window — while `lastConnectedAt` is the persisted time, so an
   * agent that has not called since the app started still shows when it last
   * did rather than looking as though it never had.
   */
  connectionStates(now: number = Date.now()): AgentConnectionState[] {
    return this.agents.list().map((agent) => {
      const seen = this.lastSeen.get(agent.name)
      return {
        name: agent.name,
        connected: seen !== undefined && now - seen <= CONNECTED_WINDOW_MS,
        lastConnectedAt: agent.lastConnectedAt ?? null,
      }
    })
  }

  /** Subscribe to connect/idle-out changes. Returns an unsubscribe function. */
  onConnectionsChanged(listener: () => void): () => void {
    this.connectionListeners.add(listener)
    return () => {
      this.connectionListeners.delete(listener)
    }
  }

  /** Record a request, announcing an agent that has just become connected. */
  private noteSeen(name: string): void {
    this.lastSeen.set(name, Date.now())
    if (!this.connectedNames.has(name)) {
      this.connectedNames.add(name)
      this.emitConnectionsChanged()
    }
  }

  /** Drop agents whose last request has fallen outside the window. */
  private sweepIdle(): void {
    const now = Date.now()
    let changed = false
    for (const name of [...this.connectedNames]) {
      const seen = this.lastSeen.get(name)
      if (seen === undefined || now - seen > CONNECTED_WINDOW_MS) {
        this.connectedNames.delete(name)
        changed = true
      }
    }
    if (changed) this.emitConnectionsChanged()
  }

  private emitConnectionsChanged(): void {
    for (const listener of [...this.connectionListeners]) {
      try {
        listener()
      } catch (err) {
        console.error('[AgentSocketServer] onConnectionsChanged listener threw:', err)
      }
    }
  }

  private writeLine(socket: Socket, payload: unknown): void {
    if (socket.destroyed) return
    try {
      socket.write(`${JSON.stringify(payload)}\n`)
    } catch (err) {
      console.error('[AgentSocketServer] could not write response:', err)
    }
  }
}
