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
import { readFileSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs'
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
import { makeTempDir } from '../../../test/helpers/temp-tree'
import {
  BRIDGE_OFF_MESSAGE,
  ChatService,
  CHAT_AGENT_NAME,
  RESUMED_NOTICE,
  SESSION_LOST_NOTICE,
} from './chat-service'
import {
  ClaudeCliEngine,
  STILL_ANSWERING_MESSAGE,
  TURN_TIMEOUT_MESSAGE,
  type ClaudeCliEngineOptions,
} from './claude-cli-engine'
import { SIGNED_OUT_MESSAGE, buildClaudeArgs, chatSystemPrompt } from './claude-cli'
import type { ChatEvent } from './engine'

const FAKE_CLAUDE = resolve(process.cwd(), 'test', 'fixtures', 'fake-claude', 'fake-claude.mjs')

interface Harness {
  /** False for a second service sharing another harness's workspace and server. */
  owned: boolean
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
const scenarioDirs: string[] = []

/** A temp folder for a scenario file that switches the fake between spawns. */
function makeScenarioDir(): string {
  const dir = makeTempDir('fake-claude-scenario')
  scenarioDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (scenarioDirs.length > 0) rmSync(scenarioDirs.pop()!, { recursive: true, force: true })
  while (harnesses.length > 0) {
    const h = harnesses.pop()!
    await h.chat.disposeAll()
    if (!h.owned) continue
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

  const h: Harness = { ...base, owned: options.existing === undefined, chat, events, record, bridge }
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

// ---------------------------------------------------------------------------
// Failures, Stop, relaunch and stray processes (Task 4)
// ---------------------------------------------------------------------------

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function slowPids(h: Harness): Promise<{ fake: number; sleep: number }> {
  await waitFor(() => existsSync(`${h.record}.pids`))
  return JSON.parse(readFileSync(`${h.record}.pids`, 'utf-8'))
}

async function expectAllDead(pids: { fake: number; sleep: number }): Promise<void> {
  await waitFor(() => !pidAlive(pids.fake) && !pidAlive(pids.sleep), 5000)
  expect(pidAlive(pids.fake)).toBe(false)
  expect(pidAlive(pids.sleep)).toBe(false)
}

function recordedSpawns(h: Harness): Recorded[] {
  const log = `${h.record}.log`
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Recorded)
}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

describe('ChatService failures and lifecycle', () => {
  it('says where it looked when claude is missing, and spawns nothing', async () => {
    const lookedIn = ['/usr/bin/claude', '/opt/homebrew/bin/claude']
    const h = await startHarness({ claudeBinary: () => ({ lookedIn }) })
    await h.chat.send(h.tree.id, 'hi')

    const error = h.events.find((e) => e.type === 'error') as Extract<ChatEvent, { type: 'error' }>
    expect(error.kind).toBe('not-installed')
    expect(error.message).toContain("Claude Code isn't installed, or Tapestry can't find it.")
    expect(error.message).toContain('/usr/bin/claude, /opt/homebrew/bin/claude')
    expect(existsSync(h.record)).toBe(false)
  }, 30000)

  it('says agents are off and spawns nothing', async () => {
    const h = await startHarness()
    h.bridge.enabled = false
    await h.chat.send(h.tree.id, 'hi')

    expect(h.events).toEqual([{ type: 'error', kind: 'bridge-off', message: BRIDGE_OFF_MESSAGE }])
    expect(existsSync(h.record)).toBe(false)
  }, 30000)

  it('names a signed-out Claude Code with the /login sentence', async () => {
    const h = await startHarness({ scenario: 'signed-out' })
    await h.chat.send(h.tree.id, 'hi')
    await waitFor(() => doneCount(h.events) === 1)

    const tail = h.events.slice(-2)
    expect(tail[0]).toEqual({ type: 'error', kind: 'signed-out', message: SIGNED_OUT_MESSAGE })
    expect(tail[1]).toMatchObject({ type: 'done', ok: false })
  }, 30000)

  it('names a crash, then resumes the same session on the next message', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'crash')
    const h = await startHarness({ scenarioFile })
    await h.chat.send(h.tree.id, 'first')
    await waitFor(() => doneCount(h.events) === 1)

    const error = h.events.find((e) => e.type === 'error') as Extract<ChatEvent, { type: 'error' }>
    expect(error.kind).toBe('crashed')
    expect(error.message).toContain('Claude Code stopped unexpectedly (exit code 3)')
    const sessionId = flagValue(recordedSpawns(h)[0].argv, '--session-id')!

    writeFileSync(scenarioFile, 'text')
    await h.chat.send(h.tree.id, 'second')
    await waitFor(() => doneCount(h.events) === 2)

    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(2)
    expect(flagValue(spawns[1].argv, '--resume')).toBe(sessionId)
    expect(spawns[1].argv).not.toContain('--session-id')
    expect(h.events.at(-1)).toMatchObject({ type: 'done', ok: true })
  }, 30000)

  it('refuses a second message while one is running, writing nothing more to stdin', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, 'first')
    await slowPids(h)

    await expect(h.chat.send(h.tree.id, 'second')).rejects.toThrow(STILL_ANSWERING_MESSAGE)
    const stdinLines = readFileSync(`${h.record}.stdin`, 'utf-8').trim().split('\n')
    expect(stdinLines).toHaveLength(1)
    expect(stdinLines[0]).toContain('first')
  }, 30000)

  it('Stop ends the turn and kills the whole process group, grandchildren included', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, 'take your time')
    const pids = await slowPids(h)
    expect(pidAlive(pids.fake)).toBe(true)
    expect(pidAlive(pids.sleep)).toBe(true)

    await h.chat.stop(h.tree.id)
    expect(h.events.at(-1)).toEqual({ type: 'done', ok: false, reason: 'stopped' })
    await expectAllDead(pids)
  }, 30000)

  it('closing the workspace leaves no process behind', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, 'take your time')
    const pids = await slowPids(h)
    await h.chat.closeWorkspace(h.tree.id)
    await expectAllDead(pids)
  }, 30000)

  it('disposeAll leaves no process behind', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, 'take your time')
    const pids = await slowPids(h)
    await h.chat.disposeAll()
    await expectAllDead(pids)
  }, 30000)

  it('killAllNow kills every chat process group synchronously, for app quit', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, 'take your time')
    const pids = await slowPids(h)
    h.chat.killAllNow()
    await expectAllDead(pids)
  }, 30000)

  it('stops a turn that runs past its time limit', async () => {
    const h = await startHarness({ scenario: 'slow', turnTimeoutMs: 200 })
    await h.chat.send(h.tree.id, 'take your time')
    const pids = await slowPids(h)
    await waitFor(() => doneCount(h.events) === 1, 5000)

    expect(h.events).toContainEqual({ type: 'error', kind: 'timeout', message: TURN_TIMEOUT_MESSAGE })
    await expectAllDead(pids)
  }, 30000)

  it('starts a fresh session, once, when the earlier one is lost', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'text')
    const h = await startHarness({ scenarioFile })
    await h.chat.send(h.tree.id, 'first')
    await waitFor(() => doneCount(h.events) === 1)
    const firstSession = flagValue(recordedSpawns(h)[0].argv, '--session-id')!
    await h.chat.stop(h.tree.id)

    writeFileSync(scenarioFile, 'session-lost')
    await h.chat.send(h.tree.id, 'second')
    await waitFor(() => doneCount(h.events) === 2)

    expect(h.events).toContainEqual({ type: 'notice', text: SESSION_LOST_NOTICE })
    expect(h.events.some((e) => e.type === 'error' && e.kind === 'session-lost')).toBe(false)
    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(3)
    expect(flagValue(spawns[1].argv, '--resume')).toBe(firstSession)
    const fresh = flagValue(spawns[2].argv, '--session-id')
    expect(fresh).toBeDefined()
    expect(fresh).not.toBe(firstSession)
    expect(spawns[2].argv).not.toContain('--resume')
    expect(h.events.at(-1)).toMatchObject({ type: 'done', ok: true })
    // The message was sent again, not recorded twice.
    expect(h.events.filter((e) => e.type === 'user')).toHaveLength(2)
  }, 30000)

  it('continues the conversation after a relaunch, and forgets it after New chat', async () => {
    const first = await startHarness({ scenario: 'text' })
    await first.chat.send(first.tree.id, 'remember this')
    await waitFor(() => doneCount(first.events) === 1)
    const sessionId = flagValue(readRecord(first.record).argv, '--session-id')!
    await first.chat.disposeAll()

    // A relaunch: a new service over the same app data.
    const second = await startHarness({ scenario: 'text', existing: first })
    expect(second.chat.open(second.tree.id)).toMatchObject({ sessionId, resumed: true })
    await second.chat.send(second.tree.id, 'what did I say?')
    await waitFor(() => doneCount(second.events) === 1)

    expect(second.events[0]).toEqual({ type: 'notice', text: RESUMED_NOTICE })
    const argv = readRecord(second.record).argv
    expect(flagValue(argv, '--resume')).toBe(sessionId)
    expect(argv).not.toContain('--session-id')

    await second.chat.newChat(second.tree.id)
    const chats = JSON.parse(readFileSync(join(first.ws.dir, 'chat', 'chats.json'), 'utf-8'))
    const realRoot = second.workspaces.workspaceFor(second.tree.id)!.realRoot
    expect(chats.chats[realRoot]).toBeUndefined()
    expect(statSync(join(first.ws.dir, 'chat', 'chats.json')).mode & 0o777).toBe(0o600)
  }, 30000)
})
