/**
 * ClaudeCliEngine — the chat engine that runs the person's own `claude`
 * (D-13), confined to Tapestry's sandboxed workspace tools (D-14).
 *
 * One long-lived process per chat. With `--input-format stream-json` the CLI
 * reads one JSON user message per stdin line and keeps its session across
 * turns. It is spawned lazily on the first message; after Stop, a crash or a
 * relaunch the next message respawns it with `--resume <session-id>`.
 *
 * The process is spawned with an argument array and `shell: false`, in the
 * workspace root, as the leader of its own process group (`detached: true`),
 * so Stop can kill the CLI and everything it started (the MCP shim, any tool
 * process) as one group: SIGTERM, then SIGKILL after 3 s.
 *
 * Message text goes only over stdin. The panel agent's token is only in the
 * MCP config file the CLI reads; it is never in argv or in the environment.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { ChatEngine, ChatEvent, ChatStartOptions } from './engine'
import {
  buildClaudeArgs,
  classifyExit,
  notInstalledMessage,
  parseStreamJsonLine,
  userMessageLine,
} from './claude-cli'

export const STILL_ANSWERING_MESSAGE = 'Claude is still answering; stop it or wait'
export const TURN_TIMEOUT_MESSAGE = 'The turn ran longer than 30 minutes and was stopped.'

/** A single stdout line longer than this is not an honest stream-json event. */
const MAX_LINE_CHARS = 8 * 1024 * 1024
/** Only the tail of stderr is kept, for naming a failure. */
const STDERR_RING_CHARS = 8 * 1024
/** How long SIGTERM gets before the group is killed outright. */
const KILL_GRACE_MS = 3_000
const POLL_MS = 50

export interface ClaudeCliEngineOptions {
  /** The `claude` binary, plus arguments before the CLI's own (tests run a node script). */
  command: { path: string; prefixArgs?: string[] }
  mcpConfigPath: string
  systemPrompt: string
  /** The CLI's whole environment; see childEnv(). */
  env: Record<string, string>
  /** A turn running longer than this is stopped. Defaults to 30 minutes. */
  turnTimeoutMs?: number
}

interface RunningProcess {
  child: ChildProcess
  pid: number | undefined
  /** Set once Tapestry decided to end it, so its exit is not a crash. */
  stopping: boolean
  exited: boolean
  stderr: string
}

/** True while any process in the group led by `pid` is alive. */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // Already gone.
  }
}

export class ClaudeCliEngine implements ChatEngine {
  readonly kind = 'claude-cli' as const

  private readonly options: ClaudeCliEngineOptions
  private readonly turnTimeoutMs: number
  private readonly listeners = new Set<(event: ChatEvent) => void>()

  private cwd: string | null = null
  private sessionId: string | null = null
  /** The session exists on Claude Code's side, so the next spawn resumes it. */
  private hasHistory = false
  private proc: RunningProcess | null = null
  /**
   * Every process group this engine started that may still be alive, including
   * one being stopped, so killNow can reach it too.
   */
  private readonly liveGroups = new Set<number>()
  private turnBusy = false
  private turnTimer: ReturnType<typeof setTimeout> | null = null
  private sawAssistant = false
  private disposed = false

  constructor(options: ClaudeCliEngineOptions) {
    this.options = options
    this.turnTimeoutMs = options.turnTimeoutMs ?? 30 * 60_000
  }

  get busy(): boolean {
    return this.turnBusy
  }

  async start(options: ChatStartOptions): Promise<{ sessionId: string; resumed: boolean }> {
    this.cwd = options.cwd
    const resumed = typeof options.resumeSessionId === 'string' && options.resumeSessionId.length > 0
    this.sessionId = resumed ? options.resumeSessionId! : randomUUID()
    this.hasHistory = resumed
    return { sessionId: this.sessionId, resumed }
  }

  send(text: string): void {
    if (this.disposed) throw new Error('This chat has been closed')
    if (this.cwd === null || this.sessionId === null) throw new Error('The chat has not been started')
    if (this.turnBusy) throw new Error(STILL_ANSWERING_MESSAGE)

    if (!this.proc || this.proc.exited || this.proc.stopping) {
      this.spawnProcess()
    }
    const proc = this.proc
    if (!proc) {
      // The spawn itself failed and has said why; end the turn it began.
      this.emit({ type: 'done', ok: false })
      return
    }

    this.turnBusy = true
    this.sawAssistant = false
    this.turnTimer = setTimeout(() => {
      this.emit({ type: 'error', kind: 'timeout', message: TURN_TIMEOUT_MESSAGE })
      void this.stopWith('timeout')
    }, this.turnTimeoutMs)
    this.turnTimer.unref?.()

    proc.child.stdin?.write(userMessageLine(text))
  }

  onEvent(listener: (event: ChatEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  stop(): Promise<void> {
    return this.stopWith('stopped')
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    try {
      this.proc?.child.stdin?.end()
    } catch {
      // Already closed.
    }
    await this.stop()
    this.listeners.clear()
  }

  /**
   * SIGKILL every process group this engine started, synchronously. For app
   * quit, where stop() and dispose() cannot be awaited.
   */
  killNow(): void {
    this.disposed = true
    const proc = this.proc
    this.proc = null
    if (proc) proc.stopping = true
    this.endTurn()
    for (const pid of this.liveGroups) killGroup(pid, 'SIGKILL')
    this.liveGroups.clear()
    this.listeners.clear()
  }

  // -------------------------------------------------------------------------

  private emit(event: ChatEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (err) {
        console.error('[ClaudeCliEngine] listener threw:', err)
      }
    }
  }

  private endTurn(): void {
    this.turnBusy = false
    if (this.turnTimer) {
      clearTimeout(this.turnTimer)
      this.turnTimer = null
    }
  }

  private async stopWith(reason: string): Promise<void> {
    const proc = this.proc
    const wasBusy = this.turnBusy
    this.proc = null
    this.endTurn()
    if (wasBusy) this.emit({ type: 'done', ok: false, reason })
    if (proc) await this.terminate(proc)
  }

  /** SIGTERM the group, then SIGKILL it if anything is still alive after 3 s. */
  private async terminate(proc: RunningProcess): Promise<void> {
    proc.stopping = true
    const pid = proc.pid
    if (pid === undefined) return
    killGroup(pid, 'SIGTERM')
    const deadline = Date.now() + KILL_GRACE_MS
    while (Date.now() < deadline) {
      if (!groupAlive(pid)) {
        this.liveGroups.delete(pid)
        return
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_MS))
    }
    killGroup(pid, 'SIGKILL')
    const hardDeadline = Date.now() + 1_000
    while (Date.now() < hardDeadline && groupAlive(pid)) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_MS))
    }
    if (!groupAlive(pid)) this.liveGroups.delete(pid)
  }

  private spawnProcess(): void {
    const { command, mcpConfigPath, systemPrompt, env } = this.options
    const args = [
      ...(command.prefixArgs ?? []),
      ...buildClaudeArgs({
        sessionId: this.sessionId!,
        resume: this.hasHistory,
        mcpConfigPath,
        systemPrompt,
      }),
    ]

    let child: ChildProcess
    try {
      child = spawn(command.path, args, {
        cwd: this.cwd!,
        env,
        stdio: 'pipe',
        shell: false,
        detached: true,
      })
    } catch (err) {
      this.emit({
        type: 'error',
        kind: 'crashed',
        message: `Claude Code could not be started: ${err instanceof Error ? err.message : String(err)}`,
      })
      return
    }

    const proc: RunningProcess = { child, pid: child.pid, stopping: false, exited: false, stderr: '' }
    this.proc = proc
    if (child.pid !== undefined) this.liveGroups.add(child.pid)

    // The turn this process is answering ends at most once.
    const failTurn = (event: ChatEvent): void => {
      if (this.proc === proc) this.proc = null
      if (proc.stopping || !this.turnBusy) return
      this.endTurn()
      this.emit(event)
      this.emit({ type: 'done', ok: false })
    }

    child.on('error', (err: NodeJS.ErrnoException) => {
      proc.exited = true
      if (err.code === 'ENOENT') {
        failTurn({ type: 'error', kind: 'not-installed', message: notInstalledMessage([command.path]) })
      } else {
        failTurn({
          type: 'error',
          kind: 'crashed',
          message: `Claude Code stopped unexpectedly: ${err.message}`,
        })
      }
    })

    child.on('exit', () => {
      proc.exited = true
    })

    // 'close' comes after stdout and stderr have drained, so the failure is
    // named from everything the process said.
    child.on('close', (code, signal) => {
      proc.exited = true
      // The CLI ended on its own: anything it left running in its group (the
      // MCP shim, a tool process) goes with it.
      if (!proc.stopping && proc.pid !== undefined) {
        if (groupAlive(proc.pid)) killGroup(proc.pid, 'SIGKILL')
        this.liveGroups.delete(proc.pid)
      }
      const failure = classifyExit({
        code,
        signal,
        stderrTail: proc.stderr,
        sawAssistant: this.sawAssistant,
      })
      failTurn({ type: 'error', kind: failure.kind, message: failure.message })
    })

    // A write to a process that has just died must not throw.
    child.stdin?.on('error', () => undefined)

    const stderrDecoder = new StringDecoder('utf8')
    child.stderr?.on('data', (chunk: Buffer) => {
      proc.stderr = (proc.stderr + stderrDecoder.write(chunk)).slice(-STDERR_RING_CHARS)
    })

    const stdoutDecoder = new StringDecoder('utf8')
    let buffer = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      if (proc.stopping) return
      buffer += stdoutDecoder.write(chunk)
      for (;;) {
        const index = buffer.indexOf('\n')
        if (index === -1) break
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        this.handleLine(proc, line)
        if (proc.stopping) return
      }
      if (buffer.length > MAX_LINE_CHARS) {
        buffer = ''
        this.emit({
          type: 'error',
          kind: 'protocol',
          message: 'Claude Code sent a line longer than 8 MiB, so the turn was stopped.',
        })
        void this.stopWith('protocol')
      }
    })
  }

  private handleLine(proc: RunningProcess, line: string): void {
    if (this.proc !== proc) return
    for (const event of parseStreamJsonLine(line)) {
      if (event.type === 'session') {
        this.sessionId = event.sessionId
        this.hasHistory = true
      } else if (event.type === 'text' || event.type === 'text-delta' || event.type === 'tool-call') {
        this.sawAssistant = true
      } else if (event.type === 'done') {
        this.endTurn()
      }
      this.emit(event)
    }
  }
}
