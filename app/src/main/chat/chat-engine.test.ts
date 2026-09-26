/**
 * The in-app chat, end to end, with a fake `claude` (02.7 D-12..D-16), one
 * session note per chat (02.8 D-02, D-03, D-07).
 *
 * Real temp workspaces, a real TreeRegistry, WorkspaceService, AgentRegistry
 * and AgentSocketServer dispatching through runAgentTool as index.ts wires it,
 * and the built MCP shim. Only `claude` itself is a stand-in:
 * test/fixtures/fake-claude/fake-claude.mjs replays recorded stream-json and,
 * for edits, drives the real shim named in the chat's MCP config file. No test
 * here spends a token or needs a login.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { NoteCommands } from '../commands/notes'
import { ConnectionCommands } from '../commands/connections'
import { SpatialCommands } from '../commands/spatial'
import { runAgentTool } from '../commands/agent-tools'
import { WorkspaceFileCommands } from '../commands/file-tools'
import { AgentRegistry, agentSocketPath } from '../agents/registry'
import { AgentSocketServer } from '../agents/socket-server'
import { agentActor, humanActor } from '../commands/actor'
import { WorkspaceService } from '../workspace/workspace-service'
import { makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import {
  BRIDGE_OFF_MESSAGE,
  ChatService,
  CHAT_AGENT_NAME,
  MAX_LIVE_ENGINES,
  SESSION_LOST_NOTICE,
  SHELL_OFF_NOTICE,
  SHELL_ON_NOTICE,
  SHELL_RESET_NOTICE,
} from './chat-service'
import {
  ClaudeCliEngine,
  STILL_ANSWERING_MESSAGE,
  TURN_TIMEOUT_MESSAGE,
  type ClaudeCliEngineOptions,
} from './claude-cli-engine'
import { BUILTIN_TOOL_NAMES, SIGNED_OUT_MESSAGE, buildClaudeArgs, chatSystemPrompt } from './claude-cli'
import type { ChatEvent } from './engine'
import { persistKey, SESSION_NOT_FOUND_MESSAGE, SessionNotes } from './session-notes'
import { parseTranscript } from '../../shared/chat/transcript'

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
  /** The session note this harness talks to. */
  noteId: string
  /** Its agent name, `claude-chat-<8 hex>-<note id>`. */
  agent: string
  events: ChatEvent[]
  /** Every emitted payload, with its session and turn. */
  payloads: Array<{ treeId: string; noteId: string; turn: number; event: ChatEvent }>
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
  existing?: Pick<Harness, 'ws' | 'registry' | 'workspaces' | 'tree' | 'agents' | 'server' | 'noteId'>
  /** With `existing`: start a new session instead of reusing its note. */
  newSession?: boolean
}

type HarnessBase = Pick<Harness, 'ws' | 'registry' | 'workspaces' | 'tree' | 'agents' | 'server'>

async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  let base: HarnessBase | undefined = options.existing
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
  const payloads: Harness['payloads'] = []
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
    sessionNotes: new SessionNotes(),
    humanActor: () => humanActor('test-person'),
    emit: (treeId, noteId, turn, event) => {
      events.push(event)
      payloads.push({ treeId, noteId, turn, event })
    },
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

  const noteId =
    options.existing && !options.newSession ? options.existing.noteId : chat.createSession(base.tree.id).noteId
  const agent = chat.open(base.tree.id, noteId).agent
  const h: Harness = {
    ...base,
    owned: options.existing === undefined,
    chat,
    noteId,
    agent,
    events,
    payloads,
    record,
    bridge,
  }
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
  pid: number
}

function readRecord(path: string): Recorded {
  return JSON.parse(readFileSync(path, 'utf-8')) as Recorded
}

function configFor(h: Harness): { path: string; token: string; server: any } {
  const path = h.chat.configPathFor(h.tree.id, h.noteId)
  const config = JSON.parse(readFileSync(path, 'utf-8'))
  const server = config.mcpServers.tapestry
  return { path, token: server.env.TAPESTRY_AGENT_TOKEN, server }
}

describe('ChatService with the fake claude CLI', () => {
  it('streams a text reply: session, text-delta, text, done', async () => {
    const h = await startHarness({ scenario: 'text' })
    await h.chat.send(h.tree.id, h.noteId, 'hello there')
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
        mcpConfigPath: h.chat.configPathFor(h.tree.id, h.noteId),
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

    expect(h.chat.open(h.tree.id, h.noteId)).toMatchObject({
      workspace: h.tree.name,
      sessionId: session.sessionId,
      busy: false,
    })
  }, 30000)

  it("edits a file through the real shim as the session's own agent", async () => {
    const h = await startHarness({ scenario: 'edit' })
    await h.chat.send(h.tree.id, h.noteId, 'change the greeting')
    await waitFor(() => doneCount(h.events) === 1, 20000)

    const file = readFileSync(join(h.ws.root, 'src', 'hello.ts'), 'utf-8')
    expect(file).toContain('hello from chat')

    expect(h.agent).toMatch(/^claude-chat-[0-9a-f]{8}-n[1-9][0-9]*$/)
    const edits = commitBlocks(h).filter((b) => b.includes('edit src/hello.ts (1 replacement)'))
    expect(edits).toHaveLength(1)
    expect(edits[0]).toContain(`actor plugin agent.${h.agent}\n`)

    const call = h.events.find((e) => e.type === 'tool-call') as Extract<ChatEvent, { type: 'tool-call' }>
    expect(call.name).toBe('mcp__tapestry__edit_file')
    const result = h.events.find((e) => e.type === 'tool-result') as Extract<ChatEvent, { type: 'tool-result' }>
    expect(result.isError).toBe(false)
    expect(result.id).toBe(call.id)
    expect(h.events.at(-1)).toMatchObject({ type: 'done', ok: true })
  }, 30000)

  it('keeps the token in a 0600 config file that is deleted when the workspace closes', async () => {
    const h = await startHarness({ scenario: 'text' })
    await h.chat.send(h.tree.id, h.noteId, 'hi')
    await waitFor(() => doneCount(h.events) === 1)

    const { path, token, server } = configFor(h)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700)
    expect(h.agents.verify(token)?.name).toBe(h.agent)
    expect(server.command).toBe(process.execPath)
    expect(server.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(server.env.TAPESTRY_USER_DATA).toBe(h.ws.dir)

    await h.chat.closeWorkspace(h.tree.id)
    expect(existsSync(path)).toBe(false)
  }, 30000)
})

describe('chats are session notes (02.8-01)', () => {
  it("a message sent in a session note becomes one committed passage signed by that session's agent", async () => {
    const h = await startHarness({ scenario: 'text' })
    const hex = h.tree.id.replace(/^sha256:/, '').slice(0, 8)
    expect(h.agent).toBe(`claude-chat-${hex}-${h.noteId}`)
    const before = commitBlocks(h).length

    await h.chat.send(h.tree.id, h.noteId, 'hi')
    await waitFor(() => doneCount(h.events) === 1)

    const blocks = commitBlocks(h)
    expect(blocks).toHaveLength(before + 1)
    const turn = blocks.at(-1)!
    expect(turn).toContain(`actor plugin agent.claude-chat-${hex}-${h.noteId}\n`)
    expect(turn).toContain('message "chat turn 1"')
    expect(turn).toContain(`set ${h.noteId} body text <<TEXT\nTurn 1\nYou: hi\nClaude: ok\nTEXT\n`)
    expect(turn).toContain(`set ${h.noteId} chat.turns int 1`)
    expect(turn).not.toContain('create-node')
    expect(turn).not.toContain('create-edge')

    // Every event is tagged with the session and its turn; done carries the turn just committed.
    expect(h.payloads.every((p) => p.treeId === h.tree.id && p.noteId === h.noteId && p.turn === 1)).toBe(true)
    expect(h.payloads.at(-1)?.event).toMatchObject({ type: 'done', ok: true })
    // The committed turn is in the note, so nothing of it is live any more.
    expect(h.chat.open(h.tree.id, h.noteId).live).toEqual([])
    expect(noteTurns(h)).toEqual([
      {
        turn: 1,
        items: [
          { kind: 'you', text: 'hi' },
          { kind: 'claude', text: 'ok' },
        ],
      },
    ])
  }, 30000)

  it('two sessions in one workspace have their own agents, tokens and config files', async () => {
    const h = await startHarness({ scenario: 'text' })
    const other = h.chat.createSession(h.tree.id)
    expect(other.agent).not.toBe(h.agent)
    await h.chat.send(h.tree.id, h.noteId, 'one')
    await waitFor(() => doneCount(h.events) === 1)
    await h.chat.send(h.tree.id, other.noteId, 'two')
    await waitFor(() => doneCount(h.events) === 2)

    const first = JSON.parse(readFileSync(h.chat.configPathFor(h.tree.id, h.noteId), 'utf-8'))
    const second = JSON.parse(readFileSync(h.chat.configPathFor(h.tree.id, other.noteId), 'utf-8'))
    const tokenOf = (config: any): string => config.mcpServers.tapestry.env.TAPESTRY_AGENT_TOKEN
    expect(tokenOf(first)).not.toBe(tokenOf(second))
    expect(h.agents.verify(tokenOf(first))?.name).toBe(h.agent)
    expect(h.agents.verify(tokenOf(second))?.name).toBe(other.agent)

    const turns = commitBlocks(h).filter((b) => b.includes('message "chat turn 1"'))
    expect(turns).toHaveLength(2)
    expect(turns[0]).toContain(`actor plugin agent.${h.agent}\n`)
    expect(turns[1]).toContain(`actor plugin agent.${other.agent}\n`)
  }, 30000)

  it('refuses a note that is not a live session note before any engine or config file exists', async () => {
    const h = await startHarness({ scenario: 'text' })
    const file = h.tree.bridge.getNodes().find((n) => n.type.startsWith('tapestry.workspace/'))!
    for (const noteId of [file.id, 'n999', 'e1', '../x', 42]) {
      await expect(h.chat.send(h.tree.id, noteId, 'hi')).rejects.toThrow("That chat isn't in this workspace")
      expect(() => h.chat.open(h.tree.id, noteId)).toThrow("That chat isn't in this workspace")
    }
    expect(existsSync(h.record)).toBe(false)
    expect(existsSync(h.chat.configPathFor(h.tree.id, file.id))).toBe(false)
    expect(h.events).toEqual([])
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
    await h.chat.send(h.tree.id, h.noteId, 'hi')

    // The message is still a turn: user, then the error, then done (02.8-02).
    expect(h.events.map((e) => e.type)).toEqual(['user', 'error', 'done'])
    const error = h.events.find((e) => e.type === 'error') as Extract<ChatEvent, { type: 'error' }>
    expect(error.kind).toBe('not-installed')
    expect(error.message).toContain("Claude Code isn't installed, or Tapestry can't find it.")
    expect(error.message).toContain('/usr/bin/claude, /opt/homebrew/bin/claude')
    expect(h.events.at(-1)).toEqual({ type: 'done', ok: false })
    expect(existsSync(h.record)).toBe(false)
    const turns = turnCommits(h)
    expect(turns).toHaveLength(1)
    expect(turns[0]).toContain('You: hi\n')
    expect(turns[0]).toContain('Error (not-installed): ')
  }, 30000)

  it('says agents are off and spawns nothing', async () => {
    const h = await startHarness()
    h.bridge.enabled = false
    await h.chat.send(h.tree.id, h.noteId, 'hi')

    expect(h.events).toEqual([
      { type: 'user', text: 'hi' },
      { type: 'error', kind: 'bridge-off', message: BRIDGE_OFF_MESSAGE },
      { type: 'done', ok: false },
    ])
    expect(existsSync(h.record)).toBe(false)
    const turns = turnCommits(h)
    expect(turns).toHaveLength(1)
    expect(turns[0]).toContain('You: hi\n')
    expect(turns[0]).toContain('Error (bridge-off): ')
    expect(h.chat.open(h.tree.id, h.noteId).live).toEqual([])
  }, 30000)

  it('names a signed-out Claude Code with the /login sentence', async () => {
    const h = await startHarness({ scenario: 'signed-out' })
    await h.chat.send(h.tree.id, h.noteId, 'hi')
    await waitFor(() => doneCount(h.events) === 1)

    const tail = h.events.slice(-2)
    expect(tail[0]).toEqual({ type: 'error', kind: 'signed-out', message: SIGNED_OUT_MESSAGE })
    expect(tail[1]).toMatchObject({ type: 'done', ok: false })
  }, 30000)

  it('names a crash, then resumes the same session on the next message', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'crash')
    const h = await startHarness({ scenarioFile })
    await h.chat.send(h.tree.id, h.noteId, 'first')
    await waitFor(() => doneCount(h.events) === 1)

    const error = h.events.find((e) => e.type === 'error') as Extract<ChatEvent, { type: 'error' }>
    expect(error.kind).toBe('crashed')
    expect(error.message).toContain('Claude Code stopped unexpectedly (exit code 3)')
    const sessionId = flagValue(recordedSpawns(h)[0].argv, '--session-id')!

    writeFileSync(scenarioFile, 'text')
    await h.chat.send(h.tree.id, h.noteId, 'second')
    await waitFor(() => doneCount(h.events) === 2)

    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(2)
    expect(flagValue(spawns[1].argv, '--resume')).toBe(sessionId)
    expect(spawns[1].argv).not.toContain('--session-id')
    expect(h.events.at(-1)).toMatchObject({ type: 'done', ok: true })
  }, 30000)

  it('refuses a second message while one is running, writing nothing more to stdin', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, h.noteId, 'first')
    await slowPids(h)

    await expect(h.chat.send(h.tree.id, h.noteId, 'second')).rejects.toThrow(STILL_ANSWERING_MESSAGE)
    const stdinLines = readFileSync(`${h.record}.stdin`, 'utf-8').trim().split('\n')
    expect(stdinLines).toHaveLength(1)
    expect(stdinLines[0]).toContain('first')
  }, 30000)

  it('Stop ends the turn and kills the whole process group, grandchildren included', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    expect(pidAlive(pids.fake)).toBe(true)
    expect(pidAlive(pids.sleep)).toBe(true)

    await h.chat.stop(h.tree.id, h.noteId)
    expect(h.events.at(-1)).toEqual({ type: 'done', ok: false, reason: 'stopped' })
    await expectAllDead(pids)
  }, 30000)

  it('closing the workspace leaves no process behind', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    await h.chat.closeWorkspace(h.tree.id)
    await expectAllDead(pids)
  }, 30000)

  it('disposeAll leaves no process behind', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    await h.chat.disposeAll()
    await expectAllDead(pids)
  }, 30000)

  it('killAllNow kills every chat process group synchronously, for app quit', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    h.chat.killAllNow()
    await expectAllDead(pids)
  }, 30000)

  it('stops a turn that runs past its time limit', async () => {
    const h = await startHarness({ scenario: 'slow', turnTimeoutMs: 200 })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    await waitFor(() => doneCount(h.events) === 1, 5000)

    expect(h.events).toContainEqual({ type: 'error', kind: 'timeout', message: TURN_TIMEOUT_MESSAGE })
    await expectAllDead(pids)
  }, 30000)

  it('starts a fresh session, once, when the earlier one is lost', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'text')
    const h = await startHarness({ scenarioFile })
    await h.chat.send(h.tree.id, h.noteId, 'first')
    await waitFor(() => doneCount(h.events) === 1)
    const firstSession = flagValue(recordedSpawns(h)[0].argv, '--session-id')!
    await h.chat.stop(h.tree.id, h.noteId)

    writeFileSync(scenarioFile, 'session-lost')
    await h.chat.send(h.tree.id, h.noteId, 'second')
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

  it('continues a session after a relaunch with --resume, and a second session starts fresh', async () => {
    const first = await startHarness({ scenario: 'text' })
    await first.chat.send(first.tree.id, first.noteId, 'remember this')
    await waitFor(() => doneCount(first.events) === 1)
    const sessionId = flagValue(readRecord(first.record).argv, '--session-id')!
    await first.chat.disposeAll()

    // A relaunch: a new service over the same app data and the same note.
    const second = await startHarness({ scenario: 'text', existing: first })
    expect(second.noteId).toBe(first.noteId)
    expect(second.chat.open(second.tree.id, second.noteId)).toMatchObject({ sessionId, live: [] })
    await second.chat.send(second.tree.id, second.noteId, 'what did I say?')
    await waitFor(() => doneCount(second.events) === 1)

    // The note shows the history, so there is no "earlier messages" notice.
    expect(second.events.some((e) => e.type === 'notice')).toBe(false)
    const argv = readRecord(second.record).argv
    expect(flagValue(argv, '--resume')).toBe(sessionId)
    expect(argv).not.toContain('--session-id')

    // A second session in the same workspace is a new conversation.
    const third = await startHarness({ scenario: 'text', existing: first, newSession: true })
    expect(third.noteId).not.toBe(first.noteId)
    expect(third.agent).not.toBe(first.agent)
    await third.chat.send(third.tree.id, third.noteId, 'fresh')
    await waitFor(() => doneCount(third.events) === 1)
    const freshArgv = readRecord(third.record).argv
    expect(flagValue(freshArgv, '--session-id')).toBeDefined()
    expect(flagValue(freshArgv, '--session-id')).not.toBe(sessionId)
    expect(freshArgv).not.toContain('--resume')

    const chatsPath = join(first.ws.dir, 'chat', 'chats.json')
    const chats = JSON.parse(readFileSync(chatsPath, 'utf-8'))
    const realRoot = second.workspaces.workspaceFor(second.tree.id)!.realRoot
    expect(chats.version).toBe(2)
    expect(chats.sessions[persistKey(realRoot, first.noteId)].sessionId).toBe(sessionId)
    expect(chats.sessions[persistKey(realRoot, third.noteId)].sessionId).toBe(flagValue(freshArgv, '--session-id'))
    expect(statSync(chatsPath).mode & 0o777).toBe(0o600)
  }, 30000)
})

// ---------------------------------------------------------------------------
// Every way a turn can end is one honest passage (02.8-02, D-07, SC2)
// ---------------------------------------------------------------------------

describe('every way a turn ends is one passage (02.8-02)', () => {
  it('a crash: one commit with You and Error (crashed)', async () => {
    const h = await startHarness({ scenario: 'crash' })
    const before = turnCommits(h).length
    await h.chat.send(h.tree.id, h.noteId, 'hi')
    await waitFor(() => doneCount(h.events) === 1)
    const turns = turnCommits(h)
    expect(turns).toHaveLength(before + 1)
    const lines = passageLines(turns.at(-1)!)
    expect(lines.filter((line) => line === 'You: hi')).toHaveLength(1)
    expect(lines.some((line) => line.startsWith('Error (crashed): '))).toBe(true)
  }, 30000)

  it('Stop: one commit ending with the line Stopped', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    await h.chat.stop(h.tree.id, h.noteId)
    await expectAllDead(pids)
    const turns = turnCommits(h)
    expect(turns).toHaveLength(1)
    const lines = passageLines(turns[0])
    expect(lines).toContain('You: take your time')
    expect(lines.at(-1)).toBe('Stopped')
  }, 30000)

  it('a timeout: one commit with Error (timeout)', async () => {
    const h = await startHarness({ scenario: 'slow', turnTimeoutMs: 300 })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    await waitFor(() => doneCount(h.events) === 1, 5000)
    await expectAllDead(pids)
    const turns = turnCommits(h)
    expect(turns).toHaveLength(1)
    const lines = passageLines(turns[0])
    expect(lines).toContain('You: take your time')
    expect(lines.some((line) => line.startsWith('Error (timeout): '))).toBe(true)
  }, 30000)

  it('a lost session after a relaunch: one commit, You once, and the notice as a Note', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'text')
    const first = await startHarness({ scenarioFile })
    await first.chat.send(first.tree.id, first.noteId, 'remember this')
    await waitFor(() => doneCount(first.events) === 1)
    await first.chat.disposeAll()

    writeFileSync(scenarioFile, 'session-lost')
    const second = await startHarness({ scenarioFile, existing: first })
    const before = turnCommits(second).length
    await second.chat.send(second.tree.id, second.noteId, 'hi')
    await waitFor(() => doneCount(second.events) === 1)

    const turns = turnCommits(second)
    expect(turns).toHaveLength(before + 1)
    const lines = passageLines(turns.at(-1)!)
    expect(lines[0]).toBe('Turn 2')
    expect(lines.filter((line) => line === 'You: hi')).toHaveLength(1)
    expect(lines).toContain(`Note: ${SESSION_LOST_NOTICE}`)
    expect(lines.some((line) => line.startsWith('Error'))).toBe(false)
    expect(second.events.filter((e) => e.type === 'user')).toHaveLength(1)
    expect(second.events.at(-1)).toMatchObject({ type: 'done', ok: true })
  }, 30000)

  it("a shell turn's watcher commit comes before its passage", async () => {
    const h = await startHarness({ scenario: 'shell-edit' })
    await h.chat.setAllowShell(h.tree.id, h.noteId, true)
    await h.chat.send(h.tree.id, h.noteId, 'run echo shell was here >> src/nested/deep.txt')
    await waitFor(() => doneCount(h.events) === 1, 20000)

    const blocks = commitBlocks(h)
    const observed = blocks.findIndex((b) => b.includes('observed change to src/nested/deep.txt'))
    const turn = blocks.findIndex((b) => b.includes('message "chat turn 1"'))
    expect(observed).toBeGreaterThanOrEqual(0)
    expect(turn).toBeGreaterThan(observed)
    const seqOf = (block: string): number => Number(/^([0-9]+)/.exec(block)?.[1] ?? NaN)
    if (Number.isFinite(seqOf(blocks[observed]))) expect(seqOf(blocks[turn])).toBeGreaterThan(seqOf(blocks[observed]))
  }, 30000)

  it('disposeAll mid-turn commits the turn with Stopped before it resolves, and the trees still close', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    const turnsBefore = turnCommits(h).length
    const agent = h.agent

    const disposing = h.chat.disposeAll()
    // Already on disk, before disposeAll resolves: at quit, the trees close next.
    const turns = commitBlocks(h).filter((b) => b.includes(`actor plugin agent.${agent}\n`))
    expect(turns).toHaveLength(turnsBefore + 1)
    const lines = passageLines(turns.at(-1)!)
    expect(lines).toEqual(['Turn 1', 'You: take your time', 'Stopped'])
    await disposing
    await expectAllDead(pids)
    // One commit for the turn: the engine's own later done wrote nothing.
    expect(commitBlocks(h).filter((b) => b.includes(`actor plugin agent.${agent}\n`))).toHaveLength(1)
    expect(() => h.registry.closeAll()).not.toThrow()
  }, 30000)

  it('closing the workspace mid-turn commits the turn with Stopped', async () => {
    const h = await startHarness({ scenario: 'slow' })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    const agent = h.agent
    const closing = h.chat.closeWorkspace(h.tree.id)
    const turns = commitBlocks(h).filter((b) => b.includes(`actor plugin agent.${agent}\n`))
    expect(turns).toHaveLength(1)
    expect(passageLines(turns[0]).at(-1)).toBe('Stopped')
    await closing
    await expectAllDead(pids)
  }, 30000)
})

// ---------------------------------------------------------------------------
// Many sessions stay independent and bounded (02.8-02, D-02, D-03)
// ---------------------------------------------------------------------------

function chatsFile(h: Harness): any {
  return JSON.parse(readFileSync(join(h.ws.dir, 'chat', 'chats.json'), 'utf-8'))
}

describe('many sessions (02.8-02)', () => {
  it('two sessions have their own agent, 0600 config file, session id and chats.json entry, and close cleanly', async () => {
    const h = await startHarness({ scenario: 'text' })
    const b = h.chat.createSession(h.tree.id)

    // Refused before anything runs: a file note, a tree id, '' and n0.
    const file = h.tree.bridge.getNodes().find((n) => n.type.startsWith('tapestry.workspace/'))!
    for (const noteId of [file.id, h.tree.id, '', 'n0']) {
      await expect(h.chat.send(h.tree.id, noteId, 'hi')).rejects.toThrow(SESSION_NOT_FOUND_MESSAGE)
      expect(() => h.chat.open(h.tree.id, noteId)).toThrow(SESSION_NOT_FOUND_MESSAGE)
      await expect(h.chat.stop(h.tree.id, noteId)).rejects.toThrow(SESSION_NOT_FOUND_MESSAGE)
      await expect(h.chat.setAllowShell(h.tree.id, noteId, true)).rejects.toThrow(SESSION_NOT_FOUND_MESSAGE)
    }
    expect(existsSync(h.record)).toBe(false)

    await h.chat.send(h.tree.id, h.noteId, 'one')
    await waitFor(() => doneCount(h.events) === 1)
    await h.chat.send(h.tree.id, b.noteId, 'two')
    await waitFor(() => doneCount(h.events) === 2)

    expect(b.agent).not.toBe(h.agent)
    const paths = [h.chat.configPathFor(h.tree.id, h.noteId), h.chat.configPathFor(h.tree.id, b.noteId)]
    expect(paths[0]).not.toBe(paths[1])
    for (const path of paths) expect(statSync(path).mode & 0o777).toBe(0o600)

    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(2)
    const ids = spawns.map((spawn) => flagValue(spawn.argv, '--session-id'))
    expect(ids[0]).toBeDefined()
    expect(ids[1]).toBeDefined()
    expect(ids[0]).not.toBe(ids[1])
    expect(flagValue(spawns[0].argv, '--mcp-config')).toBe(paths[0])
    expect(flagValue(spawns[1].argv, '--mcp-config')).toBe(paths[1])

    const realRoot = h.workspaces.workspaceFor(h.tree.id)!.realRoot
    const sessions = chatsFile(h).sessions
    expect(Object.keys(sessions).sort()).toEqual([persistKey(realRoot, h.noteId), persistKey(realRoot, b.noteId)].sort())
    expect(sessions[persistKey(realRoot, h.noteId)].sessionId).toBe(ids[0])
    expect(sessions[persistKey(realRoot, b.noteId)].sessionId).toBe(ids[1])

    await h.chat.closeWorkspace(h.tree.id)
    for (const path of paths) expect(existsSync(path)).toBe(false)
    await waitFor(() => spawns.every((spawn) => !pidAlive(spawn.pid)), 5000)
    for (const spawn of spawns) expect(pidAlive(spawn.pid)).toBe(false)
  }, 30000)

  it(`keeps at most ${MAX_LIVE_ENGINES} idle processes; an ended one resumes its conversation`, async () => {
    expect(MAX_LIVE_ENGINES).toBe(4)
    const h = await startHarness({ scenario: 'text' })
    const notes = [h.noteId]
    for (let i = 1; i < 5; i++) notes.push(h.chat.createSession(h.tree.id).noteId)
    for (const [i, noteId] of notes.entries()) {
      await h.chat.send(h.tree.id, noteId, `hello ${i + 1}`)
      await waitFor(() => doneCount(h.events) === i + 1)
    }

    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(5)
    expect(spawns.filter((spawn) => pidAlive(spawn.pid)).length).toBeLessThanOrEqual(MAX_LIVE_ENGINES)
    // The least recently used, session 1, was ended quietly: no extra done.
    expect(pidAlive(spawns[0].pid)).toBe(false)
    expect(doneCount(h.events)).toBe(5)

    const firstId = flagValue(spawns[0].argv, '--session-id')!
    await h.chat.send(h.tree.id, notes[0], 'still there?')
    await waitFor(() => doneCount(h.events) === 6)
    const again = recordedSpawns(h)
    expect(again).toHaveLength(6)
    expect(flagValue(again[5].argv, '--resume')).toBe(firstId)
    expect(again.filter((spawn) => pidAlive(spawn.pid)).length).toBeLessThanOrEqual(MAX_LIVE_ENGINES)
    // Session 1 has two passages now, both signed by its own agent.
    expect(noteTurns(h).map((turn) => turn.turn)).toEqual([1, 2])
  }, 30000)

  it('never ends a running turn to make room', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'slow')
    const h = await startHarness({ scenarioFile })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)

    writeFileSync(scenarioFile, 'text')
    for (let i = 1; i <= MAX_LIVE_ENGINES; i++) {
      const { noteId } = h.chat.createSession(h.tree.id)
      await h.chat.send(h.tree.id, noteId, `hello ${i}`)
      await waitFor(() => doneCount(h.events) === i)
    }
    expect(pidAlive(pids.fake)).toBe(true)
    expect(pidAlive(pids.sleep)).toBe(true)
    expect(h.chat.open(h.tree.id, h.noteId).busy).toBe(true)
    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(1 + MAX_LIVE_ENGINES)
    expect(spawns.filter((spawn) => pidAlive(spawn.pid)).length).toBeLessThanOrEqual(MAX_LIVE_ENGINES)

    await h.chat.stop(h.tree.id, h.noteId)
    await expectAllDead(pids)
  }, 30000)

  it('a version 1 chats.json opens as no sessions and keeps its v1 map when rewritten', async () => {
    const first = await startHarness({ scenario: 'text' })
    const realRoot = first.workspaces.workspaceFor(first.tree.id)!.realRoot
    const v1Chats = { [realRoot]: { sessionId: 'old' } }
    mkdirSync(join(first.ws.dir, 'chat'), { recursive: true, mode: 0o700 })
    writeFileSync(join(first.ws.dir, 'chat', 'chats.json'), JSON.stringify({ version: 1, chats: v1Chats }))

    // A relaunch over that file.
    const second = await startHarness({ scenario: 'text', existing: first })
    expect(second.chat.open(second.tree.id, second.noteId).sessionId).toBeNull()
    await second.chat.send(second.tree.id, second.noteId, 'hi')
    await waitFor(() => doneCount(second.events) === 1)

    const argv = readRecord(second.record).argv
    expect(argv).not.toContain('--resume')
    expect(flagValue(argv, '--session-id')).not.toBe('old')
    expect(argv).not.toContain('old')

    const file = chatsFile(second)
    expect(file.version).toBe(2)
    expect(file.chats).toEqual(v1Chats)
    expect(Object.keys(file.sessions)).toEqual([persistKey(realRoot, second.noteId)])
    expect(file.sessions[persistKey(realRoot, second.noteId)].sessionId).toBe(flagValue(argv, '--session-id'))
  }, 30000)
})

// ---------------------------------------------------------------------------
// The Allow shell switch (02.7-04, D-15)
// ---------------------------------------------------------------------------

const SHELL_ON_TOOLS = 'Bash,Read,Edit,Write,Glob,Grep'
const SHELL_ON_ALLOWED = 'mcp__tapestry,Bash,Read,Edit,Write,Glob,Grep'

/** The argv the chat would get with the shell off: exactly 02.7-02's default. */
function defaultArgv(h: Harness, sessionId: string, resume: boolean): string[] {
  return buildClaudeArgs({
    sessionId,
    resume,
    mcpConfigPath: h.chat.configPathFor(h.tree.id, h.noteId),
    systemPrompt: chatSystemPrompt(h.tree.name),
  })
}

function expectNoBuiltinTool(argv: string[]): void {
  for (const element of argv) {
    for (const part of element.split(',')) {
      for (const tool of BUILTIN_TOOL_NAMES) {
        expect(part === tool || part.startsWith(tool)).toBe(false)
      }
    }
  }
}

function expectShellArgv(argv: string[]): void {
  expect(flagValue(argv, '--tools')).toBe(SHELL_ON_TOOLS)
  expect(flagValue(argv, '--allowedTools')).toBe(SHELL_ON_ALLOWED)
}

function chatsEntry(h: Harness): { sessionId?: string; shell?: { on: boolean; changedAt: string } } | undefined {
  const chats = JSON.parse(readFileSync(join(h.ws.dir, 'chat', 'chats.json'), 'utf-8'))
  return chats.sessions[persistKey(h.workspaces.workspaceFor(h.tree.id)!.realRoot, h.noteId)]
}

/** The events main still holds for the session (not yet in its note). */
function liveEvents(h: Harness): ChatEvent[] {
  return h.chat.open(h.tree.id, h.noteId).live.map((entry) => entry.event)
}

/** The session note's committed turns, parsed from its text. */
function noteTurns(h: Harness): ReturnType<typeof parseTranscript> {
  return parseTranscript(String(h.tree.bridge.getNode(h.noteId)?.props['body']?.value ?? ''))
}

function notices(h: Harness): string[] {
  return h.events.filter((e) => e.type === 'notice').map((e) => (e as { text: string }).text)
}

/** Every commit block in the tree file. */
function commitBlocks(h: Harness): string[] {
  return readFileSync(h.tree.path, 'utf-8').split('@commit ').slice(1)
}

/** The commit blocks of this harness's session turns, in journal order. */
function turnCommits(h: Harness, noteId = h.noteId): string[] {
  return commitBlocks(h).filter(
    (b) => /message "chat turn [0-9]+"/.test(b) && b.includes(`actor plugin agent.${sessionAgent(h, noteId)}\n`),
  )
}

function sessionAgent(h: Harness, noteId: string): string {
  return h.chat.open(h.tree.id, noteId).agent
}

/** The body text a turn commit sets, as its lines. */
function passageLines(block: string): string[] {
  const match = /body text <<TEXT\n([\s\S]*?)\nTEXT\n/.exec(block)
  if (!match) return []
  const lines = match[1].split('\n')
  // Only the last turn's block: the lines after its `Turn k` header.
  let start = 0
  lines.forEach((line, index) => {
    if (/^Turn [0-9]+$/.test(line)) start = index
  })
  return lines.slice(start)
}

describe('the Allow shell switch', () => {
  it('starts off, and turning it on while idle ends the process and resumes with the shell tools', async () => {
    const h = await startHarness({ scenario: 'text' })
    expect(h.chat.open(h.tree.id, h.noteId).allowShell).toBe(false)
    await h.chat.send(h.tree.id, h.noteId, 'first')
    await waitFor(() => doneCount(h.events) === 1)

    const first = recordedSpawns(h)[0]
    const sessionId = flagValue(first.argv, '--session-id')!
    expect(first.argv).toEqual(defaultArgv(h, sessionId, false))
    expectNoBuiltinTool(first.argv)
    expect(pidAlive(first.pid)).toBe(true)

    await h.chat.setAllowShell(h.tree.id, h.noteId, true)
    // Ended quietly: its group is gone and no turn was reported as ended.
    await waitFor(() => !pidAlive(first.pid), 5000)
    expect(doneCount(h.events)).toBe(1)
    expect(h.chat.open(h.tree.id, h.noteId).allowShell).toBe(true)
    expect(notices(h)).toEqual([SHELL_ON_NOTICE])
    expect(liveEvents(h)).toContainEqual({ type: 'notice', text: SHELL_ON_NOTICE })
    expect(chatsEntry(h)?.shell?.on).toBe(true)
    expect(chatsEntry(h)?.sessionId).toBe(sessionId)

    await h.chat.send(h.tree.id, h.noteId, 'second')
    await waitFor(() => doneCount(h.events) === 2)
    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(2)
    expect(flagValue(spawns[1].argv, '--resume')).toBe(sessionId)
    expectShellArgv(spawns[1].argv)
    expect(spawns[1].cwd).toBe(h.workspaces.workspaceFor(h.tree.id)!.realRoot)

    // Off again: the next spawn is the default argv once more.
    await h.chat.setAllowShell(h.tree.id, h.noteId, false)
    await waitFor(() => !pidAlive(spawns[1].pid), 5000)
    expect(notices(h)).toEqual([SHELL_ON_NOTICE, SHELL_OFF_NOTICE])
    expect(chatsEntry(h)?.shell?.on).toBe(false)
    await h.chat.send(h.tree.id, h.noteId, 'third')
    await waitFor(() => doneCount(h.events) === 3)
    const third = recordedSpawns(h)[2]
    expect(third.argv).toEqual(defaultArgv(h, sessionId, true))
    expectNoBuiltinTool(third.argv)
  }, 30000)

  it('refuses a switch value that is not a boolean', async () => {
    const h = await startHarness()
    await expect(h.chat.setAllowShell(h.tree.id, h.noteId, 'yes')).rejects.toThrow('The shell switch must be on or off')
    expect(h.chat.open(h.tree.id, h.noteId).allowShell).toBe(false)
  }, 30000)

  it('a change during a turn leaves that turn running until Stop, then applies', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'slow')
    const h = await startHarness({ scenarioFile })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)

    await h.chat.setAllowShell(h.tree.id, h.noteId, true)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
    expect(pidAlive(pids.fake)).toBe(true)
    expect(pidAlive(pids.sleep)).toBe(true)
    expect(h.chat.open(h.tree.id, h.noteId).busy).toBe(true)

    await h.chat.stop(h.tree.id, h.noteId)
    await expectAllDead(pids)

    writeFileSync(scenarioFile, 'text')
    await h.chat.send(h.tree.id, h.noteId, 'now')
    await waitFor(() => h.events.filter((e) => e.type === 'done').length === 2)
    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(2)
    expectShellArgv(spawns[1].argv)
    expect(flagValue(spawns[1].argv, '--resume')).toBe(flagValue(spawns[0].argv, '--session-id'))
  }, 30000)

  it('a change during a turn applies after that turn\'s done', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'delayed-text')
    const h = await startHarness({ scenarioFile })
    await h.chat.send(h.tree.id, h.noteId, 'first')
    await waitFor(() => h.events.some((e) => e.type === 'session'))
    const first = recordedSpawns(h)[0]

    await h.chat.setAllowShell(h.tree.id, h.noteId, true)
    expect(pidAlive(first.pid)).toBe(true)
    await waitFor(() => doneCount(h.events) === 1)
    expect(h.events.at(-1)).toMatchObject({ type: 'done', ok: true })
    await waitFor(() => !pidAlive(first.pid), 5000)
    expect(doneCount(h.events)).toBe(1)

    writeFileSync(scenarioFile, 'text')
    await h.chat.send(h.tree.id, h.noteId, 'second')
    await waitFor(() => doneCount(h.events) === 2)
    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(2)
    expectShellArgv(spawns[1].argv)
    expect(flagValue(spawns[1].argv, '--resume')).toBe(flagValue(first.argv, '--session-id'))
  }, 30000)

  it('is off again after a relaunch, and the chat says it was reset', async () => {
    const first = await startHarness({ scenario: 'text' })
    await first.chat.send(first.tree.id, first.noteId, 'hello')
    await waitFor(() => doneCount(first.events) === 1)
    const sessionId = flagValue(recordedSpawns(first)[0].argv, '--session-id')!
    await first.chat.setAllowShell(first.tree.id, first.noteId, true)
    expect(chatsEntry(first)?.shell?.on).toBe(true)
    await first.chat.disposeAll()

    // A relaunch: a new service over the same app data.
    const second = await startHarness({ scenario: 'text', existing: first })
    expect(chatsEntry(first)?.shell?.on).toBe(false)
    const opened = second.chat.open(second.tree.id, second.noteId)
    expect(opened.allowShell).toBe(false)
    expect(opened.live.map((entry) => entry.event)).toContainEqual({ type: 'notice', text: SHELL_RESET_NOTICE })

    await second.chat.send(second.tree.id, second.noteId, 'still there?')
    await waitFor(() => doneCount(second.events) === 1)
    const argv = readRecord(second.record).argv
    expect(argv).toEqual(defaultArgv(second, sessionId, true))
    expectNoBuiltinTool(argv)

    // Said once, not at every open: now in the note's turn 2, and no longer live.
    expect(liveEvents(second).filter((e) => e.type === 'notice' && e.text === SHELL_RESET_NOTICE)).toHaveLength(0)
    const saidInNote = noteTurns(second)
      .flatMap((turn) => turn.items)
      .filter((item) => item.kind === 'note' && item.text === SHELL_RESET_NOTICE)
    expect(saidInNote).toHaveLength(1)
  }, 30000)

  it('New chat starts with the shell off', async () => {
    const h = await startHarness({ scenario: 'text' })
    await h.chat.setAllowShell(h.tree.id, h.noteId, true)
    const { noteId } = h.chat.createSession(h.tree.id)
    expect(noteId).not.toBe(h.noteId)
    expect(h.chat.open(h.tree.id, noteId).allowShell).toBe(false)
    expect(h.chat.open(h.tree.id, h.noteId).allowShell).toBe(true)

    await h.chat.send(h.tree.id, noteId, 'fresh')
    await waitFor(() => doneCount(h.events) === 1)
    const argv = readRecord(h.record).argv
    expect(argv).toEqual(defaultArgv({ ...h, noteId }, flagValue(argv, '--session-id')!, false))
  }, 30000)

  it('records a file the shell changed as observed by workspace.watcher, after the turn', async () => {
    const h = await startHarness({ scenario: 'shell-edit' })
    await h.chat.setAllowShell(h.tree.id, h.noteId, true)
    await h.chat.send(h.tree.id, h.noteId, 'run echo shell was here >> src/nested/deep.txt')
    await waitFor(() => doneCount(h.events) === 1, 20000)

    expectShellArgv(readRecord(h.record).argv)
    expect(readFileSync(join(h.ws.root, 'src', 'nested', 'deep.txt'), 'utf-8')).toBe(
      'deep text\nshell was here\n',
    )
    const call = h.events.find((e) => e.type === 'tool-call') as Extract<ChatEvent, { type: 'tool-call' }>
    expect(call.name).toBe('Bash')

    // Already in the tree when the turn's done is shown.
    const blocks = commitBlocks(h)
    const observed = blocks.filter((b) => b.includes('observed change to src/nested/deep.txt'))
    expect(observed).toHaveLength(1)
    expect(observed[0]).toContain('actor plugin workspace.watcher')
    expect(observed[0]).not.toContain(`agent.${CHAT_AGENT_NAME}`)
    // The session agent signs only the turn's passage, never the file change.
    const signed = blocks.filter((b) => b.includes(`actor plugin agent.${h.agent}\n`))
    expect(signed).toHaveLength(1)
    expect(signed[0]).toContain('message "chat turn 1"')
    // Its only ops set the session note's body and turn count.
    const ops = signed[0].split('\n').filter((line) => /^(set|unset|create|delete)-?/.test(line))
    expect(ops.map((line) => line.split(' ').slice(0, 3).join(' '))).toEqual([
      `set ${h.noteId} body`,
      `set ${h.noteId} chat.turns`,
    ])
    expect(h.events.at(-1)).toMatchObject({ type: 'done', ok: true })
  }, 30000)
})

describe('the Allow shell switch at its edges', () => {
  it('on, off, on within 100 ms while idle: on, one respawn, three notices, no orphan', async () => {
    const h = await startHarness({ scenario: 'text' })
    await h.chat.send(h.tree.id, h.noteId, 'first')
    await waitFor(() => doneCount(h.events) === 1)
    const first = recordedSpawns(h)[0]
    expect(pidAlive(first.pid)).toBe(true)

    const started = Date.now()
    await Promise.all([
      h.chat.setAllowShell(h.tree.id, h.noteId, true),
      h.chat.setAllowShell(h.tree.id, h.noteId, false),
      h.chat.setAllowShell(h.tree.id, h.noteId, true),
    ])
    expect(Date.now() - started).toBeLessThan(5000)
    expect(h.chat.open(h.tree.id, h.noteId).allowShell).toBe(true)
    expect(notices(h)).toEqual([SHELL_ON_NOTICE, SHELL_OFF_NOTICE, SHELL_ON_NOTICE])
    expect(chatsEntry(h)?.shell?.on).toBe(true)
    // The old process is gone once the switch calls resolve, not later.
    expect(pidAlive(first.pid)).toBe(false)
    expect(recordedSpawns(h)).toHaveLength(1)

    await h.chat.send(h.tree.id, h.noteId, 'second')
    await waitFor(() => doneCount(h.events) === 2)
    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(2)
    expectShellArgv(spawns[1].argv)
    expect(flagValue(spawns[1].argv, '--resume')).toBe(flagValue(first.argv, '--session-id'))
    // Exactly one chat process is alive: the new one.
    expect(spawns.filter((spawn) => pidAlive(spawn.pid)).map((spawn) => spawn.pid)).toEqual([spawns[1].pid])
  }, 30000)

  it('on, off, on while a turn runs leaves that one process, which keeps the shell on after Stop', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'slow')
    const h = await startHarness({ scenarioFile })
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    await Promise.all([
      h.chat.setAllowShell(h.tree.id, h.noteId, true),
      h.chat.setAllowShell(h.tree.id, h.noteId, false),
      h.chat.setAllowShell(h.tree.id, h.noteId, true),
    ])
    expect(pidAlive(pids.fake)).toBe(true)
    expect(recordedSpawns(h)).toHaveLength(1)
    await h.chat.stop(h.tree.id, h.noteId)
    await expectAllDead(pids)

    writeFileSync(scenarioFile, 'text')
    await h.chat.send(h.tree.id, h.noteId, 'now')
    await waitFor(() => doneCount(h.events) === 2)
    expect(recordedSpawns(h)).toHaveLength(2)
    expectShellArgv(recordedSpawns(h)[1].argv)
  }, 30000)

  it('a crash during a shell-on turn still records its file changes, and the shell stays on', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'crash')
    const h = await startHarness({ scenarioFile })
    const catchUp = vi.spyOn(h.workspaces, 'catchUp')
    await h.chat.setAllowShell(h.tree.id, h.noteId, true)

    // What a command did before Claude Code died.
    writeFileSync(join(h.ws.root, 'src', 'nested', 'deep.txt'), 'deep text\ncrashed mid-command\n')
    await h.chat.send(h.tree.id, h.noteId, 'run something')
    await waitFor(() => doneCount(h.events) === 1)

    expect(h.events.at(-1)).toMatchObject({ type: 'done', ok: false })
    expect(h.events.some((e) => e.type === 'error' && e.kind === 'crashed')).toBe(true)
    expect(catchUp).toHaveBeenCalledWith(h.tree.id)
    const observed = commitBlocks(h).filter((b) => b.includes('observed change to src/nested/deep.txt'))
    expect(observed).toHaveLength(1)
    expect(observed[0]).toContain('actor plugin workspace.watcher')

    writeFileSync(scenarioFile, 'text')
    await h.chat.send(h.tree.id, h.noteId, 'again')
    await waitFor(() => doneCount(h.events) === 2)
    const spawns = recordedSpawns(h)
    expect(spawns).toHaveLength(2)
    expectShellArgv(spawns[1].argv)
    expect(flagValue(spawns[1].argv, '--resume')).toBe(flagValue(spawns[0].argv, '--session-id'))
    expect(h.chat.open(h.tree.id, h.noteId).allowShell).toBe(true)
  }, 30000)

  it('Stop during a shell-on turn kills the CLI and its grandchild; the shell stays on', async () => {
    const scenarioFile = join(makeScenarioDir(), 'scenario')
    writeFileSync(scenarioFile, 'slow')
    const h = await startHarness({ scenarioFile })
    const catchUp = vi.spyOn(h.workspaces, 'catchUp')
    await h.chat.setAllowShell(h.tree.id, h.noteId, true)
    await h.chat.send(h.tree.id, h.noteId, 'take your time')
    const pids = await slowPids(h)
    expectShellArgv(recordedSpawns(h)[0].argv)

    await h.chat.stop(h.tree.id, h.noteId)
    await expectAllDead(pids)
    await waitFor(() => doneCount(h.events) === 1)
    expect(h.events.at(-1)).toEqual({ type: 'done', ok: false, reason: 'stopped' })
    // A stopped shell turn may have changed files too.
    expect(catchUp).toHaveBeenCalledTimes(1)

    writeFileSync(scenarioFile, 'text')
    await h.chat.send(h.tree.id, h.noteId, 'next')
    await waitFor(() => doneCount(h.events) === 2)
    expectShellArgv(recordedSpawns(h)[1].argv)
    expect(h.chat.open(h.tree.id, h.noteId).allowShell).toBe(true)
  }, 30000)

  it('never catches up for a turn that ran with the shell off', async () => {
    const h = await startHarness({ scenario: 'delayed-text' })
    const catchUp = vi.spyOn(h.workspaces, 'catchUp')
    await h.chat.send(h.tree.id, h.noteId, 'hello')
    await waitFor(() => h.events.some((e) => e.type === 'session'))
    // Another process changes a file while the turn runs.
    writeFileSync(join(h.ws.root, 'src', 'nested', 'deep.txt'), 'deep text\nchanged elsewhere\n')
    await waitFor(() => doneCount(h.events) === 1)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))

    expect(catchUp).not.toHaveBeenCalled()
    expect(commitBlocks(h).some((b) => b.includes('observed change to src/nested/deep.txt'))).toBe(false)

    // Only the relaunch catch-up (Plan 01), or 02.7-06's watcher, records it.
    await h.workspaces.catchUp(h.tree.id)
    const observed = commitBlocks(h).filter((b) => b.includes('observed change to src/nested/deep.txt'))
    expect(observed).toHaveLength(1)
    expect(observed[0]).toContain('actor plugin workspace.watcher')
  }, 30000)
})
