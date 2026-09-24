/**
 * The in-app chat, end to end, with a fake `claude` (D-12..D-16).
 *
 * Real temp workspaces, a real TreeRegistry, WorkspaceService, AgentRegistry
 * and AgentSocketServer dispatching through runAgentTool as index.ts wires it,
 * and the built MCP shim. Only `claude` itself is a stand-in:
 * test/fixtures/fake-claude/fake-claude.mjs replays recorded stream-json and,
 * for edits, drives the real shim named in the chat's MCP config file. No test
 * here spends a token or needs a login.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { NoteCommands } from '../commands/notes'
import { ConnectionCommands } from '../commands/connections'
import { SpatialCommands } from '../commands/spatial'
import { runAgentTool } from '../commands/agent-tools'
import { WorkspaceFileCommands } from '../commands/file-tools'
import { AgentRegistry, agentSocketPath } from '../agents/registry'
import { AgentSocketServer } from '../agents/socket-server'
import { agentActor } from '../commands/actor'
import { WorkspaceService } from '../workspace/workspace-service'
import { makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'
import { ChatService, CHAT_AGENT_NAME } from './chat-service'
import { ClaudeCliEngine, type ClaudeCliEngineOptions } from './claude-cli-engine'
import { buildClaudeArgs, chatSystemPrompt } from './claude-cli'
import type { ChatEvent } from './engine'

const FAKE_CLAUDE = resolve(process.cwd(), 'test', 'fixtures', 'fake-claude', 'fake-claude.mjs')

interface Harness {
  ws: TempWorkspace
  registry: TreeRegistry
  workspaces: WorkspaceService
  tree: OpenTree
  agents: AgentRegistry
  server: AgentSocketServer
  chat: ChatService
  events: ChatEvent[]
  record: string
  bridge: { enabled: boolean }
}

const harnesses: Harness[] = []

afterEach(async () => {
  while (harnesses.length > 0) {
    const h = harnesses.pop()!
    await h.chat.disposeAll()
    await h.server.close()
    h.registry.closeAll()
    h.ws.cleanup()
  }
})

interface HarnessOptions {
  scenario?: string
  /** A file whose content picks the fake's scenario at each spawn. */
  scenarioFile?: string
  userDataDir?: string
  turnTimeoutMs?: number
  claudeBinary?: () => { path: string } | { lookedIn: string[] }
  existing?: Pick<Harness, 'ws' | 'registry' | 'workspaces' | 'tree' | 'agents' | 'server'>
}

async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  let base = options.existing
  if (!base) {
    const ws = makeTempWorkspace()
    const registry = new TreeRegistry()
    const workspaces = new WorkspaceService(registry, { treesDir: ws.treesDir })
    const tree = await workspaces.addWorkspace(ws.root)
    const agents = new AgentRegistry(join(ws.dir, 'agents.json'))
    const commands = {
      notes: new NoteCommands(registry),
      connections: new ConnectionCommands(registry),
      spatial: new SpatialCommands(registry),
      files: new WorkspaceFileCommands(workspaces),
    }
    const server = new AgentSocketServer({
      socketPath: agentSocketPath(ws.dir),
      agents,
      dispatch: (name, tool, args) => runAgentTool(commands, agentActor(name), tool, args),
    })
    await server.listen()
    base = { ws, registry, workspaces, tree, agents, server }
  }

  const record = join(base.ws.dir, `record-${harnesses.length}.json`)
  const events: ChatEvent[] = []
  const bridge = { enabled: true }
  const chat = new ChatService({
    userDataDir: options.userDataDir ?? base.ws.dir,
    agents: base.agents,
    workspaces: base.workspaces,
    launch: {
      isPackaged: false,
      appPath: process.cwd(),
      execPath: process.execPath,
      resourcesPath: '',
    },
    isBridgeEnabled: () => bridge.enabled,
    emit: (_treeId, event) => events.push(event),
    claudeBinary: options.claudeBinary ?? (() => ({ path: 'claude' })),
    createEngine: (engineOptions: ClaudeCliEngineOptions) =>
      new ClaudeCliEngine({
        ...engineOptions,
        command: { path: process.execPath, prefixArgs: [FAKE_CLAUDE] },
        env: {
          ...engineOptions.env,
          FAKE_CLAUDE_RECORD: record,
          FAKE_CLAUDE_SCENARIO: options.scenario ?? 'text',
          ...(options.scenarioFile ? { FAKE_CLAUDE_SCENARIO_FILE: options.scenarioFile } : {}),
        },
        ...(options.turnTimeoutMs !== undefined ? { turnTimeoutMs: options.turnTimeoutMs } : {}),
      }),
  })

  const h: Harness = { ...base, chat, events, record, bridge }
  harnesses.push(h)
  return h
}

async function waitFor(check: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  if (!check()) throw new Error('timed out waiting')
}

function doneCount(events: ChatEvent[]): number {
  return events.filter((e) => e.type === 'done').length
}

interface Recorded {
  argv: string[]
  cwd: string
  env: Record<string, string>
}

function readRecord(path: string): Recorded {
  return JSON.parse(readFileSync(path, 'utf-8')) as Recorded
}

function configFor(h: Harness): { path: string; token: string; server: any } {
  const path = h.chat.configPathFor(h.tree.id)
  const config = JSON.parse(readFileSync(path, 'utf-8'))
  const server = config.mcpServers.tapestry
  return { path, token: server.env.TAPESTRY_AGENT_TOKEN, server }
}

describe('ChatService with the fake claude CLI', () => {
  it('streams a text reply: session, text-delta, text, done', async () => {
    const h = await startHarness({ scenario: 'text' })
    await h.chat.send(h.tree.id, 'hello there')
    await waitFor(() => doneCount(h.events) === 1)

    expect(h.events.map((e) => e.type)).toEqual(['user', 'session', 'text-delta', 'text', 'done'])
    expect(h.events[0]).toEqual({ type: 'user', text: 'hello there' })
    expect(h.events.at(-1)).toEqual({ type: 'done', ok: true, reason: 'success' })

    const recorded = readRecord(h.record)
    const session = h.events[1] as { sessionId: string }
    expect(recorded.argv).toEqual(
      buildClaudeArgs({
        sessionId: session.sessionId,
        resume: false,
        mcpConfigPath: h.chat.configPathFor(h.tree.id),
        systemPrompt: chatSystemPrompt(h.tree.name),
      }),
    )
    const realRoot = h.workspaces.workspaceFor(h.tree.id)!.realRoot
    expect(recorded.cwd).toBe(realRoot)

    // The token is only in the config file: not in argv, not in the env.
    const { token } = configFor(h)
    expect(token.length).toBeGreaterThan(20)
    expect(recorded.argv.some((a) => a.includes(token))).toBe(false)
    expect(Object.values(recorded.env).some((v) => v === token || v.includes(token))).toBe(false)
    expect(Object.keys(recorded.env).some((k) => k.startsWith('ELECTRON_'))).toBe(false)
    // The message went over stdin, never argv.
    expect(recorded.argv.some((a) => a.includes('hello there'))).toBe(false)

    expect(h.chat.open(h.tree.id)).toMatchObject({
      workspace: h.tree.name,
      sessionId: session.sessionId,
      busy: false,
    })
  }, 30000)

  it('edits a file through the real shim as agent.claude-chat', async () => {
    const h = await startHarness({ scenario: 'edit' })
    await h.chat.send(h.tree.id, 'change the greeting')
    await waitFor(() => doneCount(h.events) === 1, 20000)

    const file = readFileSync(join(h.ws.root, 'src', 'hello.ts'), 'utf-8')
    expect(file).toContain('hello from chat')

    const journal = readFileSync(h.tree.path, 'utf-8')
    const lastCommit = journal.slice(journal.lastIndexOf('@commit '))
    expect(lastCommit).toContain(`actor plugin agent.${CHAT_AGENT_NAME}`)
    expect(lastCommit).toContain('edit src/hello.ts (1 replacement)')

    const call = h.events.find((e) => e.type === 'tool-call') as Extract<ChatEvent, { type: 'tool-call' }>
    expect(call.name).toBe('mcp__tapestry__edit_file')
    const result = h.events.find((e) => e.type === 'tool-result') as Extract<ChatEvent, { type: 'tool-result' }>
    expect(result.isError).toBe(false)
    expect(result.id).toBe(call.id)
    expect(h.events.at(-1)).toMatchObject({ type: 'done', ok: true })
  }, 30000)

  it('keeps the token in a 0600 config file that is deleted when the workspace closes', async () => {
    const h = await startHarness({ scenario: 'text' })
    await h.chat.send(h.tree.id, 'hi')
    await waitFor(() => doneCount(h.events) === 1)

    const { path, token, server } = configFor(h)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700)
    expect(h.agents.verify(token)?.name).toBe(CHAT_AGENT_NAME)
    expect(server.command).toBe(process.execPath)
    expect(server.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(server.env.TAPESTRY_USER_DATA).toBe(h.ws.dir)

    await h.chat.closeWorkspace(h.tree.id)
    expect(existsSync(path)).toBe(false)
  }, 30000)
})

describe('AgentRegistry.issueToken', () => {
  it('replaces the previous token, which stops verifying at once', () => {
    const ws = makeTempWorkspace({ git: false })
    try {
      const agents = new AgentRegistry(join(ws.dir, 'agents.json'))
      const first = agents.issueToken(CHAT_AGENT_NAME)
      expect(agents.verify(first)?.name).toBe(CHAT_AGENT_NAME)
      const second = agents.issueToken(CHAT_AGENT_NAME)
      expect(second).not.toBe(first)
      expect(agents.verify(first)).toBeNull()
      expect(agents.verify(second)?.name).toBe(CHAT_AGENT_NAME)
      expect(agents.list().filter((a) => a.name === CHAT_AGENT_NAME)).toHaveLength(1)
      expect(readFileSync(join(ws.dir, 'agents.json'), 'utf-8')).not.toContain(second)
    } finally {
      ws.cleanup()
    }
  })
})
