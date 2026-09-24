#!/usr/bin/env node
/**
 * A token-free stand-in for the `claude` CLI, used by every chat test.
 *
 * Run as `process.execPath fake-claude.mjs <claude args>`. It spends no tokens,
 * needs no login and never contacts anything but the Tapestry MCP shim named
 * in its --mcp-config file.
 *
 * Environment:
 *   FAKE_CLAUDE_RECORD         write { argv, cwd, env, pid } here as JSON at start,
 *                              and append the same line to <RECORD>.log; every
 *                              stdin user line is appended to <RECORD>.stdin
 *   FAKE_CLAUDE_SCENARIO       text | edit | signed-out | crash | slow | session-lost |
 *                              shell-edit | delayed-text
 *   FAKE_CLAUDE_SCENARIO_FILE  if set and readable, its trimmed content
 *                              overrides FAKE_CLAUDE_SCENARIO for this spawn
 *
 * Scenarios act on each stdin user line:
 *   text          replay text-turn.jsonl with this process's session id
 *   edit          call edit_file through the real MCP shim, then report it
 *   signed-out    "Not logged in · Please run /login" on stderr, exit 1
 *   crash         one text delta, then exit 3
 *   slow          start `sleep 60` in our process group, record both pids, never answer
 *   session-lost  with --resume: an error result "No conversation found ...";
 *                 otherwise the text scenario
 *   shell-edit    append "shell was here" to src/nested/deep.txt in its cwd with
 *                 node fs (a stand-in for Bash, which a test must not need),
 *                 reported as a Bash tool_use, its tool_result, text and result
 *   delayed-text  the init line, then the text scenario 400 ms later
 */

import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)

function flagValue(name) {
  const index = argv.indexOf(name)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined
}

const resumed = argv.includes('--resume')
const sessionId = flagValue('--resume') ?? flagValue('--session-id') ?? 'no-session'

const record = process.env.FAKE_CLAUDE_RECORD
if (record) {
  const payload = JSON.stringify({ argv, cwd: process.cwd(), env: process.env, pid: process.pid })
  writeFileSync(record, payload)
  appendFileSync(`${record}.log`, `${payload}\n`)
}

let scenario = process.env.FAKE_CLAUDE_SCENARIO ?? 'text'
if (process.env.FAKE_CLAUDE_SCENARIO_FILE) {
  try {
    scenario = readFileSync(process.env.FAKE_CLAUDE_SCENARIO_FILE, 'utf-8').trim() || scenario
  } catch {
    // Keep the env scenario.
  }
}

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

/** The built-in tools --tools asked for, as the real CLI lists them at init. */
const builtinTools = (flagValue('--tools') ?? '').split(',').filter((t) => t.length > 0)

function init() {
  emit({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    tools: builtinTools,
    mcp_servers: [{ name: 'tapestry', status: 'connected' }],
    permissionMode: 'dontAsk',
  })
}

function result(isError, text, subtype = isError ? 'error_during_execution' : 'success') {
  emit({ type: 'result', subtype, is_error: isError, result: text, session_id: sessionId })
}

function replayText() {
  const lines = readFileSync(join(here, 'text-turn.jsonl'), 'utf-8').split('\n')
  for (const line of lines) {
    if (line.trim().length === 0) continue
    const message = JSON.parse(line)
    if ('session_id' in message) message.session_id = sessionId
    emit(message)
  }
}

// ---------------------------------------------------------------------------
// The edit scenario: a minimal MCP client over the configured shim
// ---------------------------------------------------------------------------

let mcp = null

function startMcp() {
  const configPath = flagValue('--mcp-config')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  const server = config.mcpServers.tapestry
  const child = spawn(server.command, server.args ?? [], {
    env: { ...process.env, ...(server.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const waiters = new Map()
  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf-8')
    for (;;) {
      const index = buffer.indexOf('\n')
      if (index === -1) break
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      const waiter = parsed.id !== undefined ? waiters.get(parsed.id) : undefined
      if (waiter) {
        waiters.delete(parsed.id)
        waiter(parsed)
      }
    }
  })
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))
  let nextId = 1
  return {
    child,
    request(method, params) {
      const id = nextId++
      return new Promise((resolvePromise) => {
        waiters.set(id, resolvePromise)
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    },
    notify(method) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`)
    },
  }
}

async function editTurn() {
  if (!mcp) {
    mcp = startMcp()
    await mcp.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fake-claude', version: '0' },
    })
    mcp.notify('notifications/initialized')
  }
  const input = { path: 'src/hello.ts', old_string: "'hello'", new_string: "'hello from chat'" }
  const toolUseId = 'toolu_fake_0001'
  emit({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: toolUseId, name: 'mcp__tapestry__edit_file', input }],
    },
    session_id: sessionId,
  })
  const called = await mcp.request('tools/call', { name: 'edit_file', arguments: input })
  const text = called.error
    ? String(called.error.message ?? 'error')
    : (called.result?.content ?? []).map((c) => c.text ?? '').join('\n')
  const isError = Boolean(called.error) || called.result?.isError === true
  emit({
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: [{ type: 'text', text }] },
      ],
    },
    session_id: sessionId,
  })
  emit({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'I changed the greeting.' }] },
    session_id: sessionId,
  })
  result(false, 'I changed the greeting.')
}

// ---------------------------------------------------------------------------
// The shell-edit scenario: what Claude Code's Bash would do, done directly
// ---------------------------------------------------------------------------

function shellEditTurn() {
  const command = 'echo shell was here >> src/nested/deep.txt'
  const toolUseId = 'toolu_fake_shell_0001'
  emit({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command } }],
    },
    session_id: sessionId,
  })
  appendFileSync(join(process.cwd(), 'src', 'nested', 'deep.txt'), 'shell was here\n')
  emit({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: false, content: '' }],
    },
    session_id: sessionId,
  })
  emit({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'I ran the command.' }] },
    session_id: sessionId,
  })
  result(false, 'I ran the command.')
}

// ---------------------------------------------------------------------------

let initialised = false

async function onUserLine() {
  switch (scenario) {
    case 'signed-out':
      process.stderr.write('Not logged in · Please run /login\n')
      process.exit(1)
      return
    case 'crash':
      init()
      emit({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partly' } },
        session_id: sessionId,
      })
      process.exit(3)
      return
    case 'slow': {
      init()
      const sleeper = spawn('sleep', ['60'], { stdio: 'ignore' })
      if (record) {
        writeFileSync(`${record}.pids`, JSON.stringify({ fake: process.pid, sleep: sleeper.pid }))
      }
      return
    }
    case 'session-lost':
      if (resumed) {
        result(true, `No conversation found with session ID ${sessionId}`)
        return
      }
      replayText()
      return
    case 'edit':
      if (!initialised) init()
      initialised = true
      await editTurn()
      return
    case 'shell-edit':
      if (!initialised) init()
      initialised = true
      shellEditTurn()
      return
    case 'delayed-text':
      init()
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
      replayText()
      return
    case 'text':
    default:
      replayText()
  }
}

const lines = createInterface({ input: process.stdin })
let queue = Promise.resolve()
lines.on('line', (line) => {
  if (line.trim().length === 0) return
  let parsed
  try {
    parsed = JSON.parse(line)
  } catch {
    return
  }
  if (parsed?.type !== 'user') return
  if (record) appendFileSync(`${record}.stdin`, `${line}\n`)
  queue = queue.then(onUserLine)
})
lines.on('close', () => {
  void queue.then(() => {
    if (mcp) mcp.child.kill()
    if (scenario !== 'slow') process.exit(0)
  })
})
