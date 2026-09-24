/**
 * Drive the built MCP shim over stdio, as Claude Code would.
 *
 * Modelled on shim.test.ts: spawn `out/main/mcp.js` with the current Node,
 * write line-delimited JSON-RPC to stdin, read frames from stdout. Each
 * request times out after 15 s. `npm run build:js` must have run first.
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

/** The built shim, resolved like SHIM_PATH in shim.test.ts. */
export const SHIM_PATH = resolve(process.cwd(), 'out', 'main', 'mcp.js')

export interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string
  result?: any
  error?: any
  method?: string
}

export interface ShimSession {
  request(method: string, params?: unknown): Promise<JsonRpcMessage>
  notify(method: string, params?: unknown): void
  stdoutLines: string[]
  close(): void
}

export function startShim(env: Record<string, string>): ShimSession {
  const child = spawn(process.execPath, [SHIM_PATH], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const stdoutLines: string[] = []
  const waiters = new Map<number | string, (msg: JsonRpcMessage) => void>()
  let nextId = 1
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
      if (parsed.id !== undefined) {
        const waiter = waiters.get(parsed.id)
        if (waiter) {
          waiters.delete(parsed.id)
          waiter(parsed)
        }
      }
    }
  })

  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim()
    if (text.length > 0) console.error('[shim stderr]', text)
  })

  function write(message: Record<string, unknown>): void {
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  return {
    stdoutLines,
    request(method: string, params?: unknown): Promise<JsonRpcMessage> {
      const id = nextId
      nextId += 1
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
      write({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) })
      return pending
    },
    notify(method: string, params?: unknown): void {
      write({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) })
    },
    close(): void {
      child.kill()
    },
  }
}
