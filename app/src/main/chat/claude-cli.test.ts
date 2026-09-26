/**
 * The pure Claude Code CLI helpers (D-13, D-14).
 *
 * The one test that runs the real `claude` asks only for `--help`, which needs
 * no login and spends no tokens, and is skipped when `claude` is not installed.
 */

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  BUILTIN_TOOL_NAMES,
  CHAT_MCP_SERVER,
  SHELL_TOOLS,
  SIGNED_OUT_MESSAGE,
  buildClaudeArgs,
  chatSystemPrompt,
  childEnv,
  classifyExit,
  notInstalledMessage,
  parseStreamJsonLine,
  resolveClaudeBinary,
  userMessageLine,
} from './claude-cli'

const FIXTURE = resolve(process.cwd(), 'test', 'fixtures', 'fake-claude', 'text-turn.jsonl')

const BASE = {
  sessionId: '11111111-2222-4333-8444-555555555555',
  mcpConfigPath: '/data/chat/abc.mcp.json',
  systemPrompt: 'You are working inside Tapestry.',
}

function after(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

describe('buildClaudeArgs', () => {
  for (const resume of [false, true]) {
    it(`gives Claude only Tapestry's tools (${resume ? 'resume' : 'new'})`, () => {
      const args = buildClaudeArgs({ ...BASE, resume })

      expect(after(args, '--tools')).toBe('')
      expect(after(args, '--allowedTools')).toBe(`mcp__${CHAT_MCP_SERVER}`)
      expect(args).toContain('--strict-mcp-config')
      expect(after(args, '--permission-prompts')).toBe('none')
      expect(after(args, '--permission-mode')).toBe('dontAsk')
      expect(after(args, '--setting-sources')).toBe('user')
      expect(after(args, '--mcp-config')).toBe(BASE.mcpConfigPath)
      expect(args[0]).toBe('-p')
      expect(after(args, '--input-format')).toBe('stream-json')
      expect(after(args, '--output-format')).toBe('stream-json')
      expect(args).toContain('--verbose')
      expect(args).toContain('--include-partial-messages')

      for (const element of args) {
        for (const tool of BUILTIN_TOOL_NAMES) {
          expect(element === tool || element.startsWith(tool)).toBe(false)
        }
      }
    })
  }

  it('names a new session with --session-id and a continued one with --resume', () => {
    const fresh = buildClaudeArgs({ ...BASE, resume: false })
    expect(after(fresh, '--session-id')).toBe(BASE.sessionId)
    expect(fresh).not.toContain('--resume')

    const resumed = buildClaudeArgs({ ...BASE, resume: true })
    expect(after(resumed, '--resume')).toBe(BASE.sessionId)
    expect(resumed).not.toContain('--session-id')
  })

  it('keeps hostile values as single unchanged elements', () => {
    const hostile = `a b "c" 'd'; rm -rf $(whoami)\n--tools Bash`
    const args = buildClaudeArgs({
      ...BASE,
      resume: false,
      systemPrompt: hostile,
      mcpConfigPath: `/tmp/x y/"q";$(id)\n.json`,
    })
    expect(after(args, '--append-system-prompt')).toBe(hostile)
    expect(after(args, '--mcp-config')).toBe(`/tmp/x y/"q";$(id)\n.json`)
    expect(args.filter((a) => a === '--tools')).toHaveLength(1)
    expect(args).toHaveLength(buildClaudeArgs({ ...BASE, resume: false }).length)
  })
})

describe('buildClaudeArgs and the shell switch (D-15)', () => {
  const SHELL_ON_TOOLS = 'Bash,Read,Edit,Write,Glob,Grep'
  const SHELL_ON_ALLOWED = 'mcp__tapestry,Bash,Read,Edit,Write,Glob,Grep'

  for (const resume of [false, true]) {
    for (const allowShell of [undefined, false] as const) {
      it(`names no built-in tool with the shell ${allowShell === undefined ? 'omitted' : 'off'} (${resume ? 'resume' : 'new'})`, () => {
        const args = buildClaudeArgs({ ...BASE, resume, ...(allowShell === undefined ? {} : { allowShell }) })
        expect(args).toEqual(buildClaudeArgs({ ...BASE, resume }))
        for (const element of args) {
          for (const part of element.split(',')) {
            for (const tool of BUILTIN_TOOL_NAMES) {
              expect(part === tool || part.startsWith(tool)).toBe(false)
            }
          }
        }
      })
    }

    it(`gives the shell tools, and changes nothing else, with the shell on (${resume ? 'resume' : 'new'})`, () => {
      const on = buildClaudeArgs({ ...BASE, resume, allowShell: true })
      const off = buildClaudeArgs({ ...BASE, resume })
      expect(SHELL_TOOLS.join(',')).toBe(SHELL_ON_TOOLS)
      expect(after(on, '--tools')).toBe(SHELL_ON_TOOLS)
      expect(after(on, '--allowedTools')).toBe(SHELL_ON_ALLOWED)
      expect(on).toHaveLength(off.length)

      // Without those two values, the argv is exactly the sandboxed one.
      const strip = (args: string[]): string[] =>
        args.filter((_, i) => args[i - 1] !== '--tools' && args[i - 1] !== '--allowedTools')
      expect(strip(on)).toEqual(strip(off))
      expect(after(on, '--permission-mode')).toBe('dontAsk')
      expect(on).toContain('--strict-mcp-config')
      expect(on).not.toContain('--restricted')
      for (const tool of ['WebFetch', 'WebSearch', 'Task', 'NotebookEdit']) {
        expect(on.some((element) => element.split(',').includes(tool))).toBe(false)
      }
    })
  }
})

describe('userMessageLine', () => {
  it('is one stream-json user message ending in a newline', () => {
    const line = userMessageLine('line one\nline "two"')
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(JSON.parse(line)).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'line one\nline "two"' }] },
    })
  })
})

describe('parseStreamJsonLine', () => {
  it('turns the recorded text turn into session, text-delta, text and done', () => {
    const lines = readFileSync(FIXTURE, 'utf-8').split('\n')
    const events = lines.flatMap((line) => parseStreamJsonLine(line))
    expect(events).toEqual([
      { type: 'session', sessionId: '00000000-0000-4000-8000-000000000001' },
      { type: 'text-delta', text: 'ok' },
      { type: 'text', text: 'ok' },
      { type: 'done', ok: true, reason: 'success' },
    ])
  })

  it('never throws on junk', () => {
    expect(parseStreamJsonLine('')).toEqual([])
    expect(parseStreamJsonLine('not json')).toEqual([])
    expect(parseStreamJsonLine('[1,2]')).toEqual([])
    expect(parseStreamJsonLine('null')).toEqual([])
    expect(parseStreamJsonLine('{"type":"mystery"}')).toEqual([])
    expect(
      parseStreamJsonLine(
        '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hm"}}}',
      ),
    ).toEqual([])
  })

  it('reports Tapestry tools that failed to start', () => {
    const events = parseStreamJsonLine(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 's1',
        mcp_servers: [{ name: 'tapestry', status: 'failed' }],
      }),
    )
    expect(events).toEqual([
      { type: 'session', sessionId: 's1' },
      {
        type: 'error',
        kind: 'tools-unavailable',
        message: "Claude couldn't start Tapestry's workspace tools (failed).",
      },
    ])
  })

  it('reads tool calls and tool results', () => {
    expect(
      parseStreamJsonLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 't1', name: 'mcp__tapestry__edit_file', input: { path: 'a' } },
            ],
          },
        }),
      ),
    ).toEqual([{ type: 'tool-call', id: 't1', name: 'mcp__tapestry__edit_file', input: { path: 'a' } }])

    const long = 'x'.repeat(5000)
    const results = parseStreamJsonLine(
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'no' }] },
            { type: 'tool_result', tool_use_id: 't2', content: long },
          ],
        },
      }),
    )
    expect(results[0]).toEqual({ type: 'tool-result', id: 't1', isError: true, text: 'no' })
    expect(results[1]).toMatchObject({ type: 'tool-result', id: 't2', isError: false })
    expect((results[1] as { text: string }).text).toHaveLength(4000)
  })

  it('precedes a failed result with its error', () => {
    const events = parseStreamJsonLine(
      JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'No conversation found with session ID abc' }),
    )
    expect(events.map((e) => e.type)).toEqual(['error', 'done'])
    expect(events[0]).toMatchObject({ kind: 'session-lost' })
    expect(events[1]).toEqual({ type: 'done', ok: false, reason: 'error_during_execution' })
  })
})

describe('classifyExit', () => {
  it('recognises a signed-out CLI', () => {
    expect(
      classifyExit({ code: 1, signal: null, stderrTail: 'Not logged in · Please run /login\n', sawAssistant: false }),
    ).toEqual({ kind: 'signed-out', message: SIGNED_OUT_MESSAGE })
    expect(SIGNED_OUT_MESSAGE).toContain("isn't signed in")
  })

  it('recognises a lost session', () => {
    expect(
      classifyExit({
        code: 1,
        signal: null,
        stderrTail: 'No conversation found with session ID 1234',
        sawAssistant: false,
      }).kind,
    ).toBe('session-lost')
  })

  it('names a crash with its exit code and last stderr line', () => {
    const crashed = classifyExit({
      code: 3,
      signal: null,
      stderrTail: 'warming up\nsegfault in thing\n\n',
      sawAssistant: true,
    })
    expect(crashed).toEqual({
      kind: 'crashed',
      message: 'Claude Code stopped unexpectedly (exit code 3): segfault in thing',
    })
    const killed = classifyExit({ code: null, signal: 'SIGKILL', stderrTail: '', sawAssistant: false })
    expect(killed.message).toBe('Claude Code stopped unexpectedly (signal SIGKILL)')
    const long = classifyExit({ code: 2, signal: null, stderrTail: 'y'.repeat(900), sawAssistant: false })
    expect(long.message.length).toBeLessThan(360)
  })
})

describe('resolveClaudeBinary', () => {
  const home = '/Users/someone'

  it('prefers TAPESTRY_CLAUDE_PATH, then PATH, then the usual places', () => {
    const env = { TAPESTRY_CLAUDE_PATH: '/custom/claude', PATH: '/a:/b' }
    expect(resolveClaudeBinary({ env, home, exists: () => true })).toEqual({ path: '/custom/claude' })
    expect(resolveClaudeBinary({ env, home, exists: (p) => p === '/b/claude' })).toEqual({
      path: '/b/claude',
    })
    expect(
      resolveClaudeBinary({ env: { PATH: '/a' }, home, exists: (p) => p === join(home, '.local/bin/claude') }),
    ).toEqual({ path: join(home, '.local/bin/claude') })
  })

  it('lists every place it looked when nothing is there', () => {
    const found = resolveClaudeBinary({ env: { PATH: '/a::/b' }, home, exists: () => false })
    expect(found).toEqual({
      lookedIn: [
        '/a/claude',
        '/b/claude',
        join(home, '.local/bin/claude'),
        join(home, '.claude/local/claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
      ],
    })
    const message = notInstalledMessage((found as { lookedIn: string[] }).lookedIn)
    expect(message).toMatch(/^Claude Code isn't installed, or Tapestry can't find it\./)
    expect(message).toContain('/opt/homebrew/bin/claude')
  })
})

describe('childEnv', () => {
  it('drops Electron keys and adds nothing', () => {
    const env = childEnv({
      PATH: '/bin',
      HOME: '/h',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      TAPESTRY_AGENT_TOKEN: 'secret',
      EMPTY: undefined,
    })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' })
  })
})

describe('chatSystemPrompt', () => {
  it('names the workspace and the rule for tools', () => {
    const prompt = chatSystemPrompt('windows')
    expect(prompt).toContain('on the workspace windows; your working directory is its root.')
    expect(prompt).toContain('Unless shell access is turned on for this chat')
    expect(chatSystemPrompt('windows')).toBe(prompt)
  })

  it('tells Claude to say what it is doing with set_status, and to raise needs when it asks (02.8 D-13)', () => {
    const prompt = chatSystemPrompt('windows')
    expect(prompt).toContain('set_status')
    expect(prompt).toContain('needs: true')
  })
})

function installedClaude(): string | null {
  try {
    return execFileSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf-8' }).trim() || null
  } catch {
    return null
  }
}

const claudePath = installedClaude()

describe('the installed claude CLI', () => {
  it.skipIf(!claudePath)('lists every flag we pass in claude --help', () => {
    const help = execFileSync(claudePath!, ['--help'], { encoding: 'utf-8', timeout: 20000 })
    const flags = buildClaudeArgs({ ...BASE, resume: false })
      .concat(buildClaudeArgs({ ...BASE, resume: true }))
      .filter((a) => a.startsWith('-'))
    for (const flag of new Set(flags)) {
      expect(help, flag).toContain(flag)
    }
  })
})
