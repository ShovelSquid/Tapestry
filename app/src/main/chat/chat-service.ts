/**
 * ChatService — the in-app chats, one per session note (02.7 D-12, 02.8 D-02).
 *
 * A chat is a session note in its workspace tree, addressed by (tree id, note
 * id). For each session this service owns the chat engine (D-16), the turn in
 * progress (committed turns live in the note's text, D-07/D-09), and the
 * Claude Code session id that lets a chat continue after Stop, a crash or a
 * relaunch. The workspace is one attribute of a session (its cwd and its
 * tree), never the chat's identity: every method names the session note, and a
 * note id that is not a live `tapestry.chat/session@1` node in that open
 * workspace is refused before any engine, token or config file exists.
 *
 * Every session is its own agent, `agent.claude-chat-<8 hex>-<note id>`
 * (D-03, session-notes.ts). Its token is issued when the session is created
 * and again once per app launch, and written only into that session's 0600
 * MCP config file under `<userData>/chat/` (0700), which the CLI reads to
 * start Tapestry's MCP shim. It is never in argv, the CLI's environment, a
 * log, the renderer or the tree, and the file is deleted when the workspace
 * closes.
 *
 * Each completed turn is appended to the session note in one commit signed by
 * the session's agent, after any shell catch-up and before its `done` is
 * shown, so the panel can drop the live turn as soon as the note has it.
 *
 * Everything here goes through the ChatEngine interface; only the default
 * engine factory knows about the Claude Code CLI.
 *
 * Each chat has an **Allow shell (not sandboxed)** switch (D-15). It is off for
 * every new chat and after every relaunch: a person's consent lasts for this
 * session of the app. chats.json keeps its last state only so the chat can say
 * it was reset. Whatever Claude changes through the shell or Claude Code's own
 * file tools bypasses Tapestry's tools, so after each turn that ran with the
 * shell on, the workspace is caught up and those changes enter the tree as
 * `plugin workspace.watcher` observed changes (D-06), never as the chat agent.
 */

import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentRegistry } from '../agents/registry'
import { chatShimLaunch } from '../agents/connect-command'
import { agentActor, type Actor } from '../commands/actor'
import { NO_WORKSPACE_MESSAGE, type OpenWorkspace } from '../workspace/sandbox'
import { isSessionNode, committedTurns, turnItemsFromEvents } from '../../shared/chat/transcript'
import type { ChatEngine, ChatEvent } from './engine'
import { CHAT_MCP_SERVER, chatSystemPrompt, childEnv, notInstalledMessage, resolveClaudeBinary } from './claude-cli'
import { ClaudeCliEngine, STILL_ANSWERING_MESSAGE, type ClaudeCliEngineOptions } from './claude-cli-engine'
import {
  CHAT_AGENT_NAME,
  persistKey,
  SESSION_NOT_FOUND_MESSAGE,
  SESSION_NOTE_ID_RE,
  sessionAgentName,
  sessionKey,
  type SessionNotes,
} from './session-notes'

export { CHAT_AGENT_NAME }

export const BRIDGE_OFF_MESSAGE =
  "Agents are turned off in the Agents panel, so Claude can't reach the workspace tools. Turn agents on, then send again."
export const SESSION_LOST_NOTICE =
  "The earlier conversation couldn't be resumed, so this is a new one."
export const SHELL_ON_NOTICE =
  "Shell access is on for this chat — not sandboxed. From your next message Claude can run commands and use Claude Code's own file tools in the workspace folder, and anything your account can reach. Its file changes are recorded as observed changes, author unknown."
export const SHELL_OFF_NOTICE =
  "Shell access is off for this chat. From your next message Claude can reach only Tapestry's workspace tools."
export const SHELL_RESET_NOTICE =
  'Shell access was on in this chat before Tapestry restarted. It is off now; turn it on again if you still want it.'

/** Said in the chat when a finished turn could not be written into its note. */
export function turnNotSavedNotice(reason: string): string {
  return `This turn couldn't be saved into the note: ${reason}`
}

const MAX_MESSAGE_CHARS = 100_000
const MAX_LIVE_EVENTS = 2000

export interface ChatLaunch {
  isPackaged: boolean
  appPath: string
  execPath: string
  resourcesPath: string
}

export interface ChatServiceOptions {
  userDataDir: string
  agents: AgentRegistry
  workspaces: {
    openWorkspaces(): OpenWorkspace[]
    /** Record what the folder says that the tree does not, as observed (D-06). */
    catchUp(treeId: string): Promise<void>
  }
  launch: ChatLaunch
  isBridgeEnabled: () => boolean
  /** The session commits (create, and one per completed turn). */
  sessionNotes: SessionNotes
  /** The person, who signs a session's creation. */
  humanActor: () => Actor
  /** A session's agent was added to agents.json. */
  onAgentsChanged?: () => void
  /** `turn` is the turn the event belongs to; `done` carries the turn just committed. */
  emit: (treeId: string, noteId: string, turn: number, event: ChatEvent) => void
  /** Test seam: build the engine from what the default CLI engine would get. */
  createEngine?: (options: ClaudeCliEngineOptions) => ChatEngine
  /** Test seam: where `claude` is. */
  claudeBinary?: () => { path: string } | { lookedIn: string[] }
}

/** One live event, tagged with the turn it belongs to. */
export interface ChatLiveEntry {
  turn: number
  event: ChatEvent
}

/** What the panel needs to show a session. Committed turns come from the note. */
export interface ChatSessionState {
  workspace: string
  /** The session's agent name, without the `agent.` prefix. */
  agent: string
  sessionId: string | null
  /** Events not yet in the note, each tagged with its turn. */
  live: ChatLiveEntry[]
  busy: boolean
  /** The chat's shell switch (D-15). */
  allowShell: boolean
}

interface Session {
  treeId: string
  noteId: string
  /** `claude-chat-<8 hex>-<note id>` */
  agent: string
  /** The workspace's name. */
  name: string
  realRoot: string
  /** This launch's token for the session's agent, or null before one is issued. */
  token: string | null
  /** Turns committed into the note. */
  committed: number
  /** Events not yet committed, each tagged with its turn. */
  live: ChatLiveEntry[]
  /** A message was accepted and its turn has not ended. */
  turnOpen: boolean
  engine: ChatEngine | null
  unsubscribe: (() => void) | null
  sessionId: string | null
  /** The last message sent, for one resend after a lost session. */
  lastText: string | null
  resentAfterLoss: boolean
  /** Swallowing the failed turn of a lost session until its `done`. */
  recovering: boolean
  /** The shell switch (D-15): off for every new chat and after every relaunch. */
  allowShell: boolean
  /** The running turn started with the shell on, so it ends with a catch-up. */
  turnShell: boolean
  /** A shell-on turn's catch-up, recorded before its `done`; null when none runs. */
  settling: Promise<void> | null
  /** Switch changes reaching the engine, in order. */
  shellChange: Promise<void>
}

interface ChatsEntry {
  sessionId?: string
  /** The shell switch's last state; `on` is rewritten to false at each launch. */
  shell?: { on: boolean; changedAt: string }
}

/**
 * `<userData>/chat/chats.json`. Version 2 keys sessions by
 * `<realRoot>#<noteId>`. A version 1 file's `chats` map (one conversation per
 * workspace, before sessions were notes) is carried over unchanged and never
 * read: that conversation has no note.
 */
interface ChatsFile {
  version: 2
  sessions: Record<string, ChatsEntry>
  chats?: unknown
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
  /** Keyed `sessionKey(treeId, noteId)`. */
  private readonly sessions = new Map<string, Session>()
  /** Engines not yet fully disposed, for killAllNow. */
  private readonly liveEngines = new Set<ChatEngine>()
  /** Sessions whose MCP config file may exist, by session key. */
  private readonly configFiles = new Map<string, { treeId: string; noteId: string }>()
  /** Sessions (persist keys) whose shell was on before this launch, until they say so. */
  private readonly shellResetKeys = new Set<string>()

  constructor(options: ChatServiceOptions) {
    this.options = options
    this.chatDir = join(options.userDataDir, 'chat')
    this.resetShellsFromLastLaunch()
  }

  /**
   * Start a new chat in an open workspace (D-02): a session note written by
   * the person, and its agent issued a token at once so the agent is listed,
   * with its colour, before any turn. Placement is the next free spot; a
   * requested spot comes later (02.8-02).
   */
  createSession(treeId: string, placement?: unknown): { noteId: string; agent: string } {
    if (placement !== undefined) throw new Error('A new chat goes at the next free spot in its workspace')
    const ws = this.workspaceFor(treeId)
    const { noteId } = this.options.sessionNotes.create(ws.tree, this.options.humanActor())
    const session = this.sessionFor(treeId, noteId)
    session.token = this.options.agents.issueToken(session.agent)
    try {
      this.options.onAgentsChanged?.()
    } catch (err) {
      console.error('[ChatService] agents-changed listener threw:', err)
    }
    return { noteId, agent: session.agent }
  }

  /** A session, with what the panel needs to show it. */
  open(treeId: string, noteId: unknown): ChatSessionState {
    const session = this.sessionFor(treeId, noteId)
    return {
      workspace: session.name,
      agent: session.agent,
      sessionId: session.sessionId,
      live: session.live.map((entry) => ({ ...entry })),
      busy: (session.engine?.busy ?? false) || session.settling !== null,
      allowShell: session.allowShell,
    }
  }

  /**
   * Turn a chat's shell on or off (D-15), from the next message on. The
   * panel asks for confirmation before turning it on. Each change is recorded
   * as a notice in the chat and as the session's state in chats.json.
   */
  async setAllowShell(treeId: string, noteId: unknown, on: unknown): Promise<void> {
    if (typeof on !== 'boolean') throw new Error('The shell switch must be on or off')
    const session = this.sessionFor(treeId, noteId)
    if (session.allowShell !== on) {
      session.allowShell = on
      this.persistShell(session)
      this.record(session, { type: 'notice', text: on ? SHELL_ON_NOTICE : SHELL_OFF_NOTICE })
    }
    // Serialized, so a quick on/off/on cannot leave two processes.
    const engine = session.engine
    const change = session.shellChange
      .catch(() => undefined)
      .then(() => engine?.setAllowShell?.(session.allowShell))
    session.shellChange = change.catch(() => undefined)
    await change
  }

  async send(treeId: string, noteId: unknown, text: unknown): Promise<void> {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Type a message first')
    }
    if (text.length > MAX_MESSAGE_CHARS) {
      throw new Error(`A message can be at most ${MAX_MESSAGE_CHARS} characters`)
    }
    const session = this.sessionFor(treeId, noteId)
    if (session.engine?.busy) throw new Error(STILL_ANSWERING_MESSAGE)
    // A switch change or the last shell turn's catch-up finishes first.
    await session.shellChange
    if (session.settling) await session.settling
    if (session.engine?.busy) throw new Error(STILL_ANSWERING_MESSAGE)

    if (!this.options.isBridgeEnabled()) {
      this.record(session, { type: 'error', kind: 'bridge-off', message: BRIDGE_OFF_MESSAGE })
      return
    }

    const binary = (this.options.claudeBinary ?? defaultClaudeBinary)()
    if (!('path' in binary)) {
      this.record(session, {
        type: 'error',
        kind: 'not-installed',
        message: notInstalledMessage(binary.lookedIn),
      })
      return
    }

    if (session.engine?.busy) throw new Error(STILL_ANSWERING_MESSAGE)
    const engine = await this.ensureEngine(session, binary.path)
    session.lastText = text
    session.resentAfterLoss = false
    session.turnOpen = true
    this.record(session, { type: 'user', text })
    this.sendToEngine(session, engine, text)
  }

  async stop(treeId: string, noteId: unknown): Promise<void> {
    const session = this.sessionFor(treeId, noteId)
    await session.engine?.stop()
  }

  /** The workspace closed: stop every chat in it and delete their MCP config files. */
  async closeWorkspace(treeId: string): Promise<void> {
    const closing = [...this.sessions.values()].filter((session) => session.treeId === treeId)
    for (const session of closing) this.sessions.delete(sessionKey(session.treeId, session.noteId))
    await Promise.all(closing.map((session) => this.dropEngine(session)))
    for (const [key, file] of [...this.configFiles]) {
      if (file.treeId === treeId) this.removeConfigFile(key)
    }
  }

  async disposeAll(): Promise<void> {
    const treeIds = new Set<string>([
      ...[...this.sessions.values()].map((session) => session.treeId),
      ...[...this.configFiles.values()].map((file) => file.treeId),
    ])
    await Promise.all([...treeIds].map((treeId) => this.closeWorkspace(treeId)))
  }

  /**
   * Kill every chat's process group at once, synchronously, and delete every
   * MCP config file (app quit, where nothing can be awaited). Reaches engines
   * that disposeAll has already begun stopping.
   */
  killAllNow(): void {
    for (const engine of this.liveEngines) {
      try {
        engine.killNow?.()
      } catch (err) {
        console.error('[ChatService] could not kill a chat process:', err)
      }
    }
    this.liveEngines.clear()
    for (const key of [...this.configFiles.keys()]) this.removeConfigFile(key)
    this.sessions.clear()
  }

  /** Stop every running turn (agents were switched off). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.engine?.stop()))
  }

  // -------------------------------------------------------------------------

  private workspaceFor(treeId: string): OpenWorkspace {
    const ws = this.options.workspaces.openWorkspaces().find((w) => w.tree.id === treeId)
    if (!ws) throw new Error(NO_WORKSPACE_MESSAGE)
    return ws
  }

  /**
   * The gate for every method: the note must be a live session note in that
   * open workspace's tree. Runs before any engine, token or config file work.
   */
  private sessionFor(treeId: string, noteId: unknown): Session {
    const ws = this.workspaceFor(treeId)
    if (typeof noteId !== 'string' || !SESSION_NOTE_ID_RE.test(noteId)) {
      throw new Error(SESSION_NOT_FOUND_MESSAGE)
    }
    const node = ws.tree.bridge.getNode(noteId)
    if (!node || !isSessionNode(node)) throw new Error(SESSION_NOT_FOUND_MESSAGE)

    const key = sessionKey(treeId, noteId)
    let session = this.sessions.get(key)
    if (!session) {
      const saved = persistKey(ws.realRoot, noteId)
      const persisted = this.readChats().sessions[saved]?.sessionId ?? null
      session = {
        treeId,
        noteId,
        agent: sessionAgentName(treeId, noteId),
        name: ws.tree.name,
        realRoot: ws.realRoot,
        token: null,
        committed: committedTurns(node),
        live: [],
        turnOpen: false,
        engine: null,
        unsubscribe: null,
        sessionId: persisted,
        lastText: null,
        resentAfterLoss: false,
        recovering: false,
        allowShell: false,
        turnShell: false,
        settling: null,
        shellChange: Promise.resolve(),
      }
      this.sessions.set(key, session)
      if (this.shellResetKeys.delete(saved)) {
        this.record(session, { type: 'notice', text: SHELL_RESET_NOTICE })
      }
    }
    return session
  }

  /** Send one message, noting whether its turn runs with the shell on. */
  private sendToEngine(session: Session, engine: ChatEngine, text: string): void {
    session.turnShell = session.allowShell
    engine.send(text)
  }

  private async ensureEngine(session: Session, binaryPath: string, fresh = false): Promise<ChatEngine> {
    if (session.engine) return session.engine

    if (session.token === null || this.options.agents.verify(session.token)?.name !== session.agent) {
      session.token = this.options.agents.issueToken(session.agent)
    }
    const mcpConfigPath = this.writeConfigFile(session, session.token)

    const engineOptions: ClaudeCliEngineOptions = {
      command: { path: binaryPath },
      mcpConfigPath,
      systemPrompt: chatSystemPrompt(session.name),
      env: childEnv(process.env),
      allowShell: session.allowShell,
    }
    const engine = (this.options.createEngine ?? ((o) => new ClaudeCliEngine(o)))(engineOptions)
    session.engine = engine
    this.liveEngines.add(engine)
    session.unsubscribe = engine.onEvent((event) => this.onEngineEvent(session, engine, event))

    const resumeSessionId = fresh ? undefined : (session.sessionId ?? undefined)
    await engine.start({ cwd: this.cwdFor(session), resumeSessionId })
    return engine
  }

  /** Always the workspace's own root, never a fallback. */
  private cwdFor(session: Session): string {
    return this.workspaceFor(session.treeId).realRoot
  }

  private onEngineEvent(session: Session, engine: ChatEngine, event: ChatEvent): void {
    if (session.engine !== engine) return

    if (session.recovering) {
      if (event.type === 'done') {
        session.recovering = false
        void this.resendAfterLoss(session)
      }
      return
    }

    if (
      event.type === 'error' &&
      event.kind === 'session-lost' &&
      !session.resentAfterLoss &&
      session.lastText
    ) {
      session.recovering = true
      this.record(session, { type: 'notice', text: SESSION_LOST_NOTICE })
      return
    }

    if (event.type === 'session') {
      session.sessionId = event.sessionId
      this.persistSession(session)
    }

    // A turn that ran with the shell on (ok or not: a crash or Stop may follow
    // a command that changed files) is caught up before its `done` is shown,
    // so what it changed is in the tree, as observed, when the turn ends.
    if (event.type === 'done' && session.turnShell) {
      session.turnShell = false
      const settling = this.catchUpAfterShellTurn(session).finally(() => {
        if (session.settling === settling) session.settling = null
        this.finishTurn(session, event)
      })
      session.settling = settling
      return
    }
    if (event.type === 'done') {
      this.finishTurn(session, event)
      return
    }
    this.record(session, event)
  }

  /**
   * A turn ended (D-07): its passage is appended to the session note in one
   * commit signed by the session's agent, then its `done` is recorded, tagged
   * with the turn just committed. The passage holds the turn's events from its
   * user message on, plus the notices recorded before it (the shell switch).
   * A failed commit is logged and said in the chat, never thrown.
   */
  private finishTurn(session: Session, done: Extract<ChatEvent, { type: 'done' }>): void {
    if (!session.turnOpen) {
      this.record(session, done)
      return
    }
    session.turnOpen = false
    const open = session.committed + 1
    const events = session.live.filter((entry) => entry.turn === open).map((entry) => entry.event)
    let userIndex = -1
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'user') {
        userIndex = i
        break
      }
    }
    const turnEvents =
      userIndex < 0
        ? [...events, done]
        : [
            ...events.slice(0, userIndex).filter((event) => event.type === 'notice'),
            ...events.slice(userIndex),
            done,
          ]

    try {
      const ws = this.workspaceFor(session.treeId)
      const { turn } = this.options.sessionNotes.appendTurn(
        ws.tree,
        session.noteId,
        agentActor(session.agent),
        turnItemsFromEvents(turnEvents),
      )
      session.committed = turn
      session.live = session.live.filter((entry) => entry.turn > turn)
      // Sent, not kept: the note holds this turn now.
      this.emitEvent(session, done, turn)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error('[ChatService] could not save a chat turn into its note:', err)
      this.record(session, { type: 'notice', text: turnNotSavedNotice(reason) })
      this.record(session, done)
    }
  }

  /** Never throws: a failed catch-up is logged, and the next one retries. */
  private async catchUpAfterShellTurn(session: Session): Promise<void> {
    try {
      await this.options.workspaces.catchUp(session.treeId)
    } catch (err) {
      console.error('[ChatService] could not record the shell turn\'s file changes:', err)
    }
  }

  private async resendAfterLoss(session: Session): Promise<void> {
    const text = session.lastText
    await this.dropEngine(session)
    session.sessionId = null
    this.persistSession(session)
    if (!text || this.sessions.get(sessionKey(session.treeId, session.noteId)) !== session) return
    const binary = (this.options.claudeBinary ?? defaultClaudeBinary)()
    if (!('path' in binary)) {
      this.record(session, { type: 'error', kind: 'not-installed', message: notInstalledMessage(binary.lookedIn) })
      return
    }
    session.resentAfterLoss = true
    const engine = await this.ensureEngine(session, binary.path, true)
    this.sendToEngine(session, engine, text)
  }

  private async dropEngine(session: Session): Promise<void> {
    const engine = session.engine
    session.engine = null
    session.recovering = false
    session.turnShell = false
    session.unsubscribe?.()
    session.unsubscribe = null
    if (engine) {
      await engine.dispose()
      this.liveEngines.delete(engine)
    }
  }

  /** Keep an event for the panel and send it, tagged with its turn. */
  private record(session: Session, event: ChatEvent, turn = session.committed + 1): void {
    session.live.push({ turn, event })
    if (session.live.length > MAX_LIVE_EVENTS) {
      session.live.splice(0, session.live.length - MAX_LIVE_EVENTS)
    }
    this.emitEvent(session, event, turn)
  }

  private emitEvent(session: Session, event: ChatEvent, turn: number): void {
    try {
      this.options.emit(session.treeId, session.noteId, turn, event)
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

  /** `<userData>/chat/<first 16 hex of the tree id>-<note id>.mcp.json`. */
  configPathFor(treeId: string, noteId: string): string {
    const hex = treeId.replace(/^sha256:/, '').replace(/[^0-9a-f]/gi, '').slice(0, 16)
    const note = noteId.replace(/[^a-z0-9]/gi, '')
    return join(this.chatDir, `${hex}-${note}.mcp.json`)
  }

  private writeConfigFile(session: Session, token: string): string {
    this.ensureChatDir()
    const path = this.configPathFor(session.treeId, session.noteId)
    this.configFiles.set(sessionKey(session.treeId, session.noteId), {
      treeId: session.treeId,
      noteId: session.noteId,
    })
    const server = chatShimLaunch({ ...this.options.launch, token, userDataDir: this.options.userDataDir })
    writePrivateFile(
      path,
      JSON.stringify({ mcpServers: { [CHAT_MCP_SERVER]: { type: 'stdio', ...server } } }, null, 2),
    )
    return path
  }

  private removeConfigFile(key: string): void {
    const file = this.configFiles.get(key)
    this.configFiles.delete(key)
    if (!file) return
    try {
      unlinkSync(this.configPathFor(file.treeId, file.noteId))
    } catch {
      // Never written, or already gone.
    }
  }

  private chatsFilePath(): string {
    return join(this.chatDir, 'chats.json')
  }

  private readChats(): ChatsFile {
    const path = this.chatsFilePath()
    if (!existsSync(path)) return { version: 2, sessions: {} }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
        version?: unknown
        sessions?: unknown
        chats?: unknown
      } | null
      const file: ChatsFile = { version: 2, sessions: {} }
      if (!parsed || typeof parsed !== 'object') return file
      // The v1 map, carried over unchanged and never read.
      if (parsed.chats !== undefined) file.chats = parsed.chats
      if (parsed.version !== 2 || typeof parsed.sessions !== 'object' || parsed.sessions === null) return file
      for (const [key, raw] of Object.entries(parsed.sessions as Record<string, unknown>)) {
        const entry = raw as Partial<ChatsEntry> | null
        if (!entry || typeof entry !== 'object') continue
        const kept: ChatsEntry = {}
        if (typeof entry.sessionId === 'string' && entry.sessionId.length > 0) {
          kept.sessionId = entry.sessionId
        }
        const shell = entry.shell
        if (shell && typeof shell === 'object' && typeof shell.on === 'boolean') {
          kept.shell = {
            on: shell.on,
            changedAt: typeof shell.changedAt === 'string' ? shell.changedAt : '',
          }
        }
        if (kept.sessionId !== undefined || kept.shell !== undefined) file.sessions[key] = kept
      }
      return file
    } catch (err) {
      console.error('[ChatService] could not read chats.json:', err)
      return { version: 2, sessions: {} }
    }
  }

  private writeChats(file: ChatsFile): void {
    this.ensureChatDir()
    writePrivateFile(this.chatsFilePath(), JSON.stringify(file, null, 2))
  }

  /** Change one session's entry, dropping it when nothing is left in it. */
  private updateEntry(session: Session, change: (entry: ChatsEntry) => void): void {
    const key = persistKey(session.realRoot, session.noteId)
    const file = this.readChats()
    const entry: ChatsEntry = { ...file.sessions[key] }
    change(entry)
    if (entry.sessionId === undefined && entry.shell === undefined) {
      delete file.sessions[key]
    } else {
      file.sessions[key] = entry
    }
    this.writeChats(file)
  }

  private persistSession(session: Session): void {
    try {
      this.updateEntry(session, (entry) => {
        if (session.sessionId) entry.sessionId = session.sessionId
        else delete entry.sessionId
      })
    } catch (err) {
      // Losing this only means the next launch starts a new conversation.
      console.error('[ChatService] could not write chats.json:', err)
    }
  }

  private persistShell(session: Session): void {
    try {
      this.updateEntry(session, (entry) => {
        entry.shell = { on: session.allowShell, changedAt: new Date().toISOString() }
      })
    } catch (err) {
      // The switch itself still works; only the record of it is missing.
      console.error('[ChatService] could not write chats.json:', err)
    }
  }

  /**
   * A relaunch turns every chat's shell off (D-15). Each session whose shell
   * was on says so the first time it is opened.
   */
  private resetShellsFromLastLaunch(): void {
    if (!existsSync(this.chatsFilePath())) return
    try {
      const file = this.readChats()
      const changedAt = new Date().toISOString()
      for (const [key, entry] of Object.entries(file.sessions)) {
        if (entry.shell?.on !== true) continue
        entry.shell = { on: false, changedAt }
        this.shellResetKeys.add(key)
      }
      if (this.shellResetKeys.size > 0) this.writeChats(file)
    } catch (err) {
      // The switch is off in memory whatever the file says.
      console.error('[ChatService] could not reset the shell switches in chats.json:', err)
    }
  }
}

function defaultClaudeBinary(): { path: string } | { lookedIn: string[] } {
  return resolveClaudeBinary({ env: process.env, home: homedir(), exists: isExecutableFile })
}
