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

export class AgentSocketServer {
  private readonly socketPath: string
  private readonly agents: AgentRegistry
  private readonly dispatch: AgentSocketServerOptions['dispatch']
  private readonly maxLineBytes: number
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()

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
  }

  async close(): Promise<void> {
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

  private writeLine(socket: Socket, payload: unknown): void {
    if (socket.destroyed) return
    try {
      socket.write(`${JSON.stringify(payload)}\n`)
    } catch (err) {
      console.error('[AgentSocketServer] could not write response:', err)
    }
  }
}
