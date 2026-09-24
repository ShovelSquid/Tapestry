/**
 * Pure helpers for running the person's own Claude Code CLI as the chat
 * engine (D-13, D-14).
 *
 * Nothing here spawns anything or touches the file system: the only import is
 * node:path, and binary lookup takes an `exists` function from the caller, so
 * every function can be tested without the real `claude`.
 *
 * Verified against `claude --help` of Claude Code 2.1.282 (02.7-02 Task 2).
 */

import { delimiter, join } from 'node:path'
import type { ChatErrorKind, ChatEvent } from './engine'

/** The MCP server name the panel's config file declares. */
export const CHAT_MCP_SERVER = 'tapestry'

/**
 * Claude Code's built-in tools. None of these may appear in the default argv:
 * with the shell off (D-14) the panel's Claude reaches files only through
 * Tapestry's sandboxed tools.
 */
export const BUILTIN_TOOL_NAMES = [
  'Bash',
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
  'LS',
  'MultiEdit',
] as const

export interface ClaudeArgsOptions {
  sessionId: string
  /** Continue an existing session (`--resume`) rather than naming a new one. */
  resume: boolean
  mcpConfigPath: string
  systemPrompt: string
}

/**
 * The CLI's argument list, one value per element.
 *
 * Why each flag is here:
 * - `-p`, `--input-format stream-json`, `--output-format stream-json`,
 *   `--verbose`: one long-lived process reads a JSON user message per stdin
 *   line and writes JSON events per stdout line (`--verbose` is required for
 *   stream-json output). Message text never goes in argv.
 * - `--include-partial-messages`: text deltas, so replies stream into the panel.
 * - `--mcp-config <file>` + `--strict-mcp-config`: load Tapestry's MCP shim and
 *   nothing else — not the person's other servers, not the workspace's.
 * - `--tools ''`: every built-in tool is off, Bash and the file tools included
 *   (D-14). The shell switch (02.7-04) is the only way to turn them on.
 * - `--allowedTools mcp__tapestry`: Tapestry's tools run without asking.
 * - `--permission-mode dontAsk` + `--permission-prompts none`: anything else
 *   that would prompt is denied, since nobody can answer a prompt in -p.
 * - `--setting-sources user`: -p skips the workspace-trust dialog, so an
 *   untrusted repository's project/local settings (hooks, permissions, MCP
 *   servers) must not load. The person's own user settings still apply.
 * - `--append-system-prompt`: tells Claude where it is and which tools to use.
 * - `--session-id <uuid>` (new) or `--resume <uuid>` (continuing): the chat's
 *   id is known before the first reply and survives restarts.
 *
 * Every variadic option (`--mcp-config`, `--tools`, `--allowedTools`) is
 * followed by another option and there is no positional argument, so a
 * variadic list cannot swallow anything that follows it.
 */
export function buildClaudeArgs(options: ClaudeArgsOptions): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config',
    options.mcpConfigPath,
    '--strict-mcp-config',
    '--tools',
    '',
    '--allowedTools',
    `mcp__${CHAT_MCP_SERVER}`,
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--setting-sources',
    'user',
    '--append-system-prompt',
    options.systemPrompt,
    ...(options.resume ? ['--resume', options.sessionId] : ['--session-id', options.sessionId]),
  ]
}

/** One user message as a stream-json stdin line. */
export function userMessageLine(text: string): string {
  return (
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) +
    '\n'
  )
}

/** Tool results shown in the panel are cut to this many characters. */
const TOOL_RESULT_MAX_CHARS = 4000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolResultText(content: unknown): string {
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .filter((part) => part.length > 0)
      .join('\n')
  }
  return text.length > TOOL_RESULT_MAX_CHARS ? text.slice(0, TOOL_RESULT_MAX_CHARS) : text
}

/** MCP statuses that are not a failure at init time. */
const MCP_OK_STATUSES = new Set(['connected', 'pending'])

function tapestryServerStatus(servers: unknown): string | null {
  if (Array.isArray(servers)) {
    for (const server of servers) {
      if (isRecord(server) && server.name === CHAT_MCP_SERVER) {
        return typeof server.status === 'string' ? server.status : 'unknown'
      }
    }
    return null
  }
  if (isRecord(servers) && CHAT_MCP_SERVER in servers) {
    const entry = servers[CHAT_MCP_SERVER]
    if (typeof entry === 'string') return entry
    if (isRecord(entry) && typeof entry.status === 'string') return entry.status
    return 'unknown'
  }
  return null
}

/**
 * Turn one stdout line into chat events. Never throws: empty, non-JSON and
 * unknown lines give no events.
 */
export function parseStreamJsonLine(line: string): ChatEvent[] {
  const trimmed = line.trim()
  if (trimmed.length === 0) return []
  let message: unknown
  try {
    message = JSON.parse(trimmed)
  } catch {
    return []
  }
  if (!isRecord(message)) return []

  switch (message.type) {
    case 'system': {
      if (message.subtype !== 'init') return []
      const events: ChatEvent[] = []
      if (typeof message.session_id === 'string' && message.session_id.length > 0) {
        events.push({ type: 'session', sessionId: message.session_id })
      }
      const status = tapestryServerStatus(message.mcp_servers)
      if (status !== null && !MCP_OK_STATUSES.has(status)) {
        events.push({
          type: 'error',
          kind: 'tools-unavailable',
          message: `Claude couldn't start Tapestry's workspace tools (${status}).`,
        })
      }
      return events
    }

    case 'stream_event': {
      const event = message.event
      if (!isRecord(event) || event.type !== 'content_block_delta') return []
      const delta = event.delta
      if (isRecord(delta) && delta.type === 'text_delta' && typeof delta.text === 'string') {
        return [{ type: 'text-delta', text: delta.text }]
      }
      return []
    }

    case 'assistant': {
      const content = isRecord(message.message) ? message.message.content : undefined
      if (!Array.isArray(content)) return []
      const events: ChatEvent[] = []
      for (const block of content) {
        if (!isRecord(block)) continue
        if (block.type === 'text' && typeof block.text === 'string') {
          events.push({ type: 'text', text: block.text })
        } else if (block.type === 'tool_use' && typeof block.id === 'string') {
          events.push({
            type: 'tool-call',
            id: block.id,
            name: typeof block.name === 'string' ? block.name : '',
            input: block.input ?? null,
          })
        }
      }
      return events
    }

    case 'user': {
      const content = isRecord(message.message) ? message.message.content : undefined
      if (!Array.isArray(content)) return []
      const events: ChatEvent[] = []
      for (const block of content) {
        if (!isRecord(block) || block.type !== 'tool_result') continue
        events.push({
          type: 'tool-result',
          id: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
          isError: block.is_error === true,
          text: toolResultText(block.content),
        })
      }
      return events
    }

    case 'result': {
      const isError = message.is_error === true
      const events: ChatEvent[] = []
      if (isError) {
        const parts: string[] = []
        if (typeof message.result === 'string') parts.push(message.result)
        if (Array.isArray(message.errors)) {
          for (const e of message.errors) if (typeof e === 'string') parts.push(e)
        }
        const failure = classifyExit({
          code: null,
          signal: null,
          stderrTail: '',
          resultText: parts.join('\n'),
          sawAssistant: false,
        })
        events.push({ type: 'error', kind: failure.kind, message: failure.message })
      }
      events.push({
        type: 'done',
        ok: !isError,
        ...(typeof message.subtype === 'string' ? { reason: message.subtype } : {}),
      })
      return events
    }

    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

export const SIGNED_OUT_MESSAGE =
  "Claude Code isn't signed in. Run claude in a terminal and sign in with /login, then send your message again."

export const SESSION_LOST_MESSAGE = "Claude Code couldn't find the earlier conversation."

const SIGNED_OUT_PATTERN =
  /not (logged|signed) in|please run \/login|\/login|invalid api key|authentication|oauth/i
const SESSION_LOST_PATTERN = /no conversation found|session .* not found/i

export interface ExitInfo {
  code: number | null
  signal: NodeJS.Signals | string | null
  stderrTail: string
  resultText?: string
  sawAssistant: boolean
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].length > 0) return lines[i]
  }
  return ''
}

/** Name a failed turn or a dead process in plain words. */
export function classifyExit(info: ExitInfo): { kind: ChatErrorKind; message: string } {
  const combined = `${info.stderrTail}\n${info.resultText ?? ''}`
  if (SIGNED_OUT_PATTERN.test(combined)) {
    return { kind: 'signed-out', message: SIGNED_OUT_MESSAGE }
  }
  if (SESSION_LOST_PATTERN.test(combined)) {
    return { kind: 'session-lost', message: SESSION_LOST_MESSAGE }
  }
  const how =
    info.code !== null
      ? `exit code ${info.code}`
      : info.signal
        ? `signal ${info.signal}`
        : 'the turn failed'
  const detail = (lastNonEmptyLine(info.stderrTail) || lastNonEmptyLine(info.resultText ?? '')).slice(
    0,
    300,
  )
  return {
    kind: 'crashed',
    message: `Claude Code stopped unexpectedly (${how})${detail ? `: ${detail}` : ''}`,
  }
}

// ---------------------------------------------------------------------------
// Finding the binary
// ---------------------------------------------------------------------------

export interface ResolveClaudeOptions {
  env: Record<string, string | undefined>
  home: string
  /** True when `path` is an executable file. */
  exists: (path: string) => boolean
}

/**
 * Find the person's `claude`. A Finder-launched app has a minimal PATH, so the
 * usual install locations are checked after it.
 */
export function resolveClaudeBinary(
  options: ResolveClaudeOptions,
): { path: string } | { lookedIn: string[] } {
  const candidates: string[] = []
  const override = options.env.TAPESTRY_CLAUDE_PATH
  if (override && override.trim().length > 0) candidates.push(override)
  for (const dir of (options.env.PATH ?? '').split(delimiter)) {
    if (dir.length > 0) candidates.push(join(dir, 'claude'))
  }
  candidates.push(
    join(options.home, '.local', 'bin', 'claude'),
    join(options.home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  )

  const lookedIn: string[] = []
  for (const candidate of candidates) {
    if (lookedIn.includes(candidate)) continue
    lookedIn.push(candidate)
    if (options.exists(candidate)) return { path: candidate }
  }
  return { lookedIn }
}

export function notInstalledMessage(lookedIn: string[]): string {
  return `Claude Code isn't installed, or Tapestry can't find it. Install Claude Code, or set TAPESTRY_CLAUDE_PATH to its location. Tapestry looked in: ${lookedIn.join(', ')}.`
}

// ---------------------------------------------------------------------------
// Environment and system prompt
// ---------------------------------------------------------------------------

/**
 * The CLI's environment: a copy of Tapestry's, minus the Electron keys (above
 * all ELECTRON_RUN_AS_NODE, which would change how a node-based `claude`
 * starts) and minus any agent token Tapestry itself happened to inherit.
 *
 * It never adds a key, and it has no parameter through which a token or API
 * key could be passed: the panel's token lives only in the MCP config file.
 */
export function childEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (key.startsWith('ELECTRON_')) continue
    if (key === 'TAPESTRY_AGENT_TOKEN') continue
    out[key] = value
  }
  return out
}

/**
 * The system prompt appended for the life of a chat. It stays constant, since
 * `--system-prompt-snapshot` reuses the first one on every resume, so it
 * already covers the shell switch 02.7-04 adds.
 */
export function chatSystemPrompt(workspaceName: string): string {
  return [
    `You are working inside Tapestry on the workspace ${workspaceName}; your working directory is its root.`,
    'Use the tapestry tools (read_file, edit_file and the others it lists) for every file, with paths relative to the workspace root; each edit is saved to disk and recorded as yours.',
    'Unless shell access is turned on for this chat, you have no shell and no built-in file tools; if it is on, still prefer the tapestry tools for editing files.',
  ].join('\n')
}
