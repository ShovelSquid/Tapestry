/**
 * ChatService — one in-app chat per open workspace (D-12).
 *
 * It owns, per workspace tree: the chat engine (D-16), the transcript shown in
 * the panel, and the Claude Code session id that lets a chat continue after
 * Stop, a crash or a relaunch.
 *
 * The panel's Claude is its own agent, `agent.claude-chat` (CHAT_AGENT_NAME).
 * Its token is issued afresh once per app launch and written only into a 0600
 * MCP config file under `<userData>/chat/` (0700), which the CLI reads to start
 * Tapestry's MCP shim. It is never in argv, the CLI's environment, a log, the
 * renderer or the tree, and the file is deleted when the chat is closed.
 *
 * Everything here goes through the ChatEngine interface; only the default
 * engine factory knows about the Claude Code CLI.
 */

import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentRegistry } from '../agents/registry'
import { chatShimLaunch } from '../agents/connect-command'
import { NO_WORKSPACE_MESSAGE, type OpenWorkspace } from '../workspace/sandbox'
import type { ChatEngine, ChatEvent } from './engine'
import { CHAT_MCP_SERVER, chatSystemPrompt, childEnv, notInstalledMessage, resolveClaudeBinary } from './claude-cli'
import { ClaudeCliEngine, STILL_ANSWERING_MESSAGE, type ClaudeCliEngineOptions } from './claude-cli-engine'

/** The panel's agent: commits read `actor plugin agent.claude-chat`. */
export const CHAT_AGENT_NAME = 'claude-chat'

export const BRIDGE_OFF_MESSAGE =
  "Agents are turned off in the Agents panel, so Claude can't reach the workspace tools. Turn agents on, then send again."
export const RESUMED_NOTICE =
  "Continuing your earlier conversation; earlier messages aren't shown here."
export const SESSION_LOST_NOTICE =
  "The earlier conversation couldn't be resumed, so this is a new one."

const MAX_MESSAGE_CHARS = 100_000
const MAX_TRANSCRIPT_EVENTS = 2000

export interface ChatLaunch {
  isPackaged: boolean
  appPath: string
  execPath: string
  resourcesPath: string
}

export interface ChatServiceOptions {
  userDataDir: string
  agents: AgentRegistry
  workspaces: { openWorkspaces(): OpenWorkspace[] }
  launch: ChatLaunch
  isBridgeEnabled: () => boolean
  emit: (treeId: string, event: ChatEvent) => void
  /** Test seam: build the engine from what the default CLI engine would get. */
  createEngine?: (options: ClaudeCliEngineOptions) => ChatEngine
  /** Test seam: where `claude` is. */
  claudeBinary?: () => { path: string } | { lookedIn: string[] }
}

export interface ChatOpenState {
  workspace: string
  sessionId: string | null
  transcript: ChatEvent[]
  busy: boolean
  resumed: boolean
}

interface Chat {
  treeId: string
  name: string
  realRoot: string
  engine: ChatEngine | null
  unsubscribe: (() => void) | null
  transcript: ChatEvent[]
  sessionId: string | null
  /** The session came from chats.json, written by an earlier launch. */
  resumedFromDisk: boolean
  /** The last message sent, for one resend after a lost session. */
  lastText: string | null
  resentAfterLoss: boolean
  /** Swallowing the failed turn of a lost session until its `done`. */
  recovering: boolean
}

interface ChatsFile {
  version: 1
  chats: Record<string, { sessionId: string }>
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Write a small file atomically at mode 0600. */
function writePrivateFile(path: string, contents: string): void {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, contents, { encoding: 'utf-8', mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

export class ChatService {
  private readonly options: ChatServiceOptions
  private readonly chatDir: string
  private readonly chats = new Map<string, Chat>()
  /** Issued once per launch, on the first chat that needs it. */
  private token: string | null = null

  constructor(options: ChatServiceOptions) {
    this.options = options
    this.chatDir = join(options.userDataDir, 'chat')
  }

  /** The chat for an open workspace, with what the panel needs to show it. */
  open(treeId: string): ChatOpenState {
    const chat = this.chatFor(treeId)
    return {
      workspace: chat.name,
      sessionId: chat.sessionId,
      transcript: [...chat.transcript],
      busy: chat.engine?.busy ?? false,
      resumed: chat.resumedFromDisk,
    }
  }

  async send(treeId: string, text: unknown): Promise<void> {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Type a message first')
    }
    if (text.length > MAX_MESSAGE_CHARS) {
      throw new Error(`A message can be at most ${MAX_MESSAGE_CHARS} characters`)
    }
    const chat = this.chatFor(treeId)
    if (chat.engine?.busy) throw new Error(STILL_ANSWERING_MESSAGE)

    if (!this.options.isBridgeEnabled()) {
      this.record(chat, { type: 'error', kind: 'bridge-off', message: BRIDGE_OFF_MESSAGE })
      return
    }

    const binary = (this.options.claudeBinary ?? defaultClaudeBinary)()
    if (!('path' in binary)) {
      this.record(chat, {
        type: 'error',
        kind: 'not-installed',
        message: notInstalledMessage(binary.lookedIn),
      })
      return
    }

    if (chat.engine?.busy) throw new Error(STILL_ANSWERING_MESSAGE)
    const engine = await this.ensureEngine(chat, binary.path)
    chat.lastText = text
    chat.resentAfterLoss = false
    this.record(chat, { type: 'user', text })
    engine.send(text)
  }

  async stop(treeId: string): Promise<void> {
    await this.chats.get(treeId)?.engine?.stop()
  }

  /** Forget this chat's conversation and start the next message fresh. */
  async newChat(treeId: string): Promise<void> {
    const chat = this.chatFor(treeId)
    await this.dropEngine(chat)
    chat.sessionId = null
    chat.resumedFromDisk = false
    chat.transcript = []
    chat.lastText = null
    this.persistSession(chat)
  }

  /** The workspace closed: stop its chat and delete its MCP config file. */
  async closeWorkspace(treeId: string): Promise<void> {
    const chat = this.chats.get(treeId)
    this.chats.delete(treeId)
    if (chat) await this.dropEngine(chat)
    this.removeConfigFile(treeId)
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.chats.keys()].map((treeId) => this.closeWorkspace(treeId)))
  }

  /** Kill every chat's process group at once, synchronously (app quit). */
  killAllNow(): void {}

  /** Stop every running turn (agents were switched off). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.chats.values()].map((chat) => chat.engine?.stop()))
  }

  // -------------------------------------------------------------------------

  private chatFor(treeId: string): Chat {
    const ws = this.options.workspaces.openWorkspaces().find((w) => w.tree.id === treeId)
    if (!ws) throw new Error(NO_WORKSPACE_MESSAGE)
    let chat = this.chats.get(treeId)
    if (!chat) {
      const persisted = this.readChats().chats[ws.realRoot]?.sessionId ?? null
      chat = {
        treeId,
        name: ws.tree.name,
        realRoot: ws.realRoot,
        engine: null,
        unsubscribe: null,
        transcript: [],
        sessionId: persisted,
        resumedFromDisk: persisted !== null,
        lastText: null,
        resentAfterLoss: false,
        recovering: false,
      }
      this.chats.set(treeId, chat)
    }
    return chat
  }

  private async ensureEngine(chat: Chat, binaryPath: string, fresh = false): Promise<ChatEngine> {
    if (chat.engine) return chat.engine

    if (this.token === null || !this.options.agents.verify(this.token)) {
      this.token = this.options.agents.issueToken(CHAT_AGENT_NAME)
    }
    const mcpConfigPath = this.writeConfigFile(chat.treeId, this.token)

    const engineOptions: ClaudeCliEngineOptions = {
      command: { path: binaryPath },
      mcpConfigPath,
      systemPrompt: chatSystemPrompt(chat.name),
      env: childEnv(process.env),
    }
    const engine = (this.options.createEngine ?? ((o) => new ClaudeCliEngine(o)))(engineOptions)
    chat.engine = engine
    chat.unsubscribe = engine.onEvent((event) => this.onEngineEvent(chat, engine, event))

    const resumeSessionId = fresh ? undefined : (chat.sessionId ?? undefined)
    await engine.start({ cwd: this.cwdFor(chat), resumeSessionId })
    if (resumeSessionId && chat.resumedFromDisk) {
      chat.resumedFromDisk = false
      this.record(chat, { type: 'notice', text: RESUMED_NOTICE })
    }
    return engine
  }

  /** Always the workspace's own root, never a fallback. */
  private cwdFor(chat: Chat): string {
    const ws = this.options.workspaces.openWorkspaces().find((w) => w.tree.id === chat.treeId)
    if (!ws) throw new Error(NO_WORKSPACE_MESSAGE)
    return ws.realRoot
  }

  private onEngineEvent(chat: Chat, engine: ChatEngine, event: ChatEvent): void {
    if (chat.engine !== engine) return

    if (chat.recovering) {
      if (event.type === 'done') {
        chat.recovering = false
        void this.resendAfterLoss(chat)
      }
      return
    }

    if (event.type === 'error' && event.kind === 'session-lost' && !chat.resentAfterLoss && chat.lastText) {
      chat.recovering = true
      this.record(chat, { type: 'notice', text: SESSION_LOST_NOTICE })
      return
    }

    if (event.type === 'session') {
      chat.sessionId = event.sessionId
      this.persistSession(chat)
    }
    this.record(chat, event)
  }

  private async resendAfterLoss(chat: Chat): Promise<void> {
    const text = chat.lastText
    await this.dropEngine(chat)
    chat.sessionId = null
    this.persistSession(chat)
    if (!text || this.chats.get(chat.treeId) !== chat) return
    const binary = (this.options.claudeBinary ?? defaultClaudeBinary)()
    if (!('path' in binary)) {
      this.record(chat, { type: 'error', kind: 'not-installed', message: notInstalledMessage(binary.lookedIn) })
      return
    }
    chat.resentAfterLoss = true
    const engine = await this.ensureEngine(chat, binary.path, true)
    engine.send(text)
  }

  private async dropEngine(chat: Chat): Promise<void> {
    const engine = chat.engine
    chat.engine = null
    chat.recovering = false
    chat.unsubscribe?.()
    chat.unsubscribe = null
    if (engine) await engine.dispose()
  }

  private record(chat: Chat, event: ChatEvent): void {
    chat.transcript.push(event)
    if (chat.transcript.length > MAX_TRANSCRIPT_EVENTS) {
      chat.transcript.splice(0, chat.transcript.length - MAX_TRANSCRIPT_EVENTS)
    }
    try {
      this.options.emit(chat.treeId, event)
    } catch (err) {
      console.error('[ChatService] emit failed:', err)
    }
  }

  // -------------------------------------------------------------------------
  // Files under <userData>/chat
  // -------------------------------------------------------------------------

  private ensureChatDir(): void {
    mkdirSync(this.chatDir, { recursive: true, mode: 0o700 })
    chmodSync(this.chatDir, 0o700)
  }

  /** `<userData>/chat/<first 16 hex of the tree id>.mcp.json`. */
  configPathFor(treeId: string): string {
    const hex = treeId.replace(/^sha256:/, '').replace(/[^0-9a-f]/gi, '').slice(0, 16)
    return join(this.chatDir, `${hex}.mcp.json`)
  }

  private writeConfigFile(treeId: string, token: string): string {
    this.ensureChatDir()
    const path = this.configPathFor(treeId)
    const server = chatShimLaunch({ ...this.options.launch, token, userDataDir: this.options.userDataDir })
    writePrivateFile(
      path,
      JSON.stringify({ mcpServers: { [CHAT_MCP_SERVER]: { type: 'stdio', ...server } } }, null, 2),
    )
    return path
  }

  private removeConfigFile(treeId: string): void {
    try {
      unlinkSync(this.configPathFor(treeId))
    } catch {
      // Never written, or already gone.
    }
  }

  private chatsFilePath(): string {
    return join(this.chatDir, 'chats.json')
  }

  private readChats(): ChatsFile {
    const path = this.chatsFilePath()
    if (!existsSync(path)) return { version: 1, chats: {} }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ChatsFile>
      const chats: ChatsFile['chats'] = {}
      if (parsed && typeof parsed.chats === 'object' && parsed.chats !== null) {
        for (const [root, entry] of Object.entries(parsed.chats)) {
          if (entry && typeof entry.sessionId === 'string' && entry.sessionId.length > 0) {
            chats[root] = { sessionId: entry.sessionId }
          }
        }
      }
      return { version: 1, chats }
    } catch (err) {
      console.error('[ChatService] could not read chats.json:', err)
      return { version: 1, chats: {} }
    }
  }

  private persistSession(chat: Chat): void {
    try {
      const file = this.readChats()
      if (chat.sessionId) {
        file.chats[chat.realRoot] = { sessionId: chat.sessionId }
      } else {
        delete file.chats[chat.realRoot]
      }
      this.ensureChatDir()
      writePrivateFile(this.chatsFilePath(), JSON.stringify(file, null, 2))
    } catch (err) {
      // Losing this only means the next launch starts a new conversation.
      console.error('[ChatService] could not write chats.json:', err)
    }
  }
}

function defaultClaudeBinary(): { path: string } | { lookedIn: string[] } {
  return resolveClaudeBinary({ env: process.env, home: homedir(), exists: isExecutableFile })
}
