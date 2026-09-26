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
import { SET_STATUS_REFUSAL } from '../commands/agent-tools'
import type { CommandResult } from '../commands/notes'
import { NO_WORKSPACE_MESSAGE, type OpenWorkspace } from '../workspace/sandbox'
import { isSessionNode, committedTurns, turnItemsFromEvents } from '../../shared/chat/transcript'
import { clampLevel, statusTextAfterTurn } from '../../shared/chat/session-status'
import type { ChatEngine, ChatEvent } from './engine'
import { CHAT_MCP_SERVER, chatSystemPrompt, childEnv, notInstalledMessage, resolveClaudeBinary } from './claude-cli'
import { ClaudeCliEngine, STILL_ANSWERING_MESSAGE, type ClaudeCliEngineOptions } from './claude-cli-engine'
import {
  CHAT_AGENT_NAME,
  checkSessionPlacement,
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

/**
 * How many session processes stay alive while idle (orchestrator resolution
 * 3). Past it, the least recently used idle one is ended quietly and resumes
 * with `--resume` at its next message; a running turn is never ended for room.
 */
export const MAX_LIVE_ENGINES = 4

const MAX_MESSAGE_CHARS = 100_000
const MAX_LIVE_EVENTS = 2000
/** The most of a session's last status text kept in chats.json (D-12). */
export const MAX_LAST_STATUS_CHARS = 200

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
  /**
   * The session's last status text (D-12), kept outside every tree, or null
   * when none is known. After a relaunch the card shows Idle with it.
   */
  lastStatus: string | null
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
  /** The engine's `done` for a turn whose shell catch-up is still running. */
  pendingDone: Extract<ChatEvent, { type: 'done' }> | null
  /** Bumped at each send; the least recently used idle engine is ended first. */
  lastUsed: number
  /** The last status text (D-12): chrome, in memory and in chats.json, never in the tree. */
  lastStatus: string | null
}

interface ChatsEntry {
  sessionId?: string
  /** The shell switch's last state; `on` is rewritten to false at each launch. */
  shell?: { on: boolean; changedAt: string }
  /** The session's last status text (D-12), at most MAX_LAST_STATUS_CHARS. */
  lastStatus?: string
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
  /** The last send's number, for least-recently-used order. */
  private useCounter = 0
  /** Sessions (session keys) being deleted: refused until the note is gone. */
  private readonly deleting = new Set<string>()

  constructor(options: ChatServiceOptions) {
    this.options = options
    this.chatDir = join(options.userDataDir, 'chat')
    this.resetShellsFromLastLaunch()
  }

  /**
   * Start a new chat in an open workspace (D-02): a session note written by
   * the person, and its agent issued a token at once so the agent is listed,
   * with its colour, before any turn. Placement is the next free spot, or
   * `{ at: { x, y } }`, a frame-local point (the pointer), where the note goes
   * at the first clear spot at or below it. Anything else is refused before
   * any commit.
   */
  createSession(treeId: string, placement?: unknown): { noteId: string; agent: string } {
    const checked = checkSessionPlacement(placement)
    const ws = this.workspaceFor(treeId)
    const { noteId } = this.options.sessionNotes.create(ws.tree, this.options.humanActor(), checked)
    const session = this.sessionFor(treeId, noteId)
    session.token = this.options.agents.issueToken(session.agent)
    this.agentsChanged()
    return { noteId, agent: session.agent }
  }

  /**
   * Delete a chat (chat:delete): its engine is ended (the open turn is not
   * committed, because the note is going), its MCP config file and chats.json
   * entry are deleted, and the note is removed in one `deleteNode` commit
   * signed by the person, with every edge touching it. Its agent stays in
   * agents.json, because its commits are attributed to it. The conversation
   * stays readable in the journal's history.
   */
  async deleteSession(treeId: string, noteId: unknown): Promise<void> {
    const session = this.sessionFor(treeId, noteId)
    const actor = this.options.humanActor()
    const key = sessionKey(session.treeId, session.noteId)
    this.deleting.add(key)
    try {
      session.turnOpen = false
      this.sessions.delete(key)
      await this.dropEngine(session)
      this.removeConfigFile(key)
      this.forgetEntry(session)
      const ws = this.workspaceFor(treeId)
      this.options.sessionNotes.delete(ws.tree, session.noteId, actor)
    } finally {
      this.deleting.delete(key)
    }
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
      lastStatus: session.lastStatus,
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
    if (session.engine?.busy || session.turnOpen) throw new Error(STILL_ANSWERING_MESSAGE)

    // Every accepted message is a turn (D-07): whatever happens next, the
    // note gets one passage that starts with it and says how it ended.
    session.lastUsed = ++this.useCounter
    session.lastText = text
    session.resentAfterLoss = false
    session.turnOpen = true
    this.record(session, { type: 'user', text })

    if (!this.options.isBridgeEnabled()) {
      this.failTurn(session, { type: 'error', kind: 'bridge-off', message: BRIDGE_OFF_MESSAGE })
      return
    }

    const binary = (this.options.claudeBinary ?? defaultClaudeBinary)()
    if (!('path' in binary)) {
      this.failTurn(session, {
        type: 'error',
        kind: 'not-installed',
        message: notInstalledMessage(binary.lookedIn),
      })
      return
    }

    let engine: ChatEngine
    try {
      engine = await this.ensureEngine(session, binary.path)
    } catch (err) {
      this.failTurn(session, { type: 'error', kind: 'crashed', message: startFailedMessage(err) })
      return
    }
    if (!this.isCurrent(session) || !session.turnOpen) return
    this.sendToEngine(session, engine, text)
  }

  /**
   * `set_status` from a session's own agent (D-13): a few words about what it
   * is doing, and whether it needs the person. The actor comes from the
   * socket's token; the tool has no session argument, so a session can only
   * ever set its own status (T-02.8-17), and any agent that is not a loaded
   * session's is refused (T-02.8-18). The status is recorded into the open
   * turn (or ahead of the next one, between turns) and sent to the renderer.
   * Chrome, never history (D-10): nothing is written to any tree, and the
   * turn's passage leaves it out.
   */
  setStatus(
    actor: Actor,
    args: { text: string; needs?: boolean; level?: number },
  ): CommandResult<{ shown: true }> {
    const session = [...this.sessions.values()].find(
      (candidate) =>
        agentActor(candidate.agent).id === actor.id &&
        !this.deleting.has(sessionKey(candidate.treeId, candidate.noteId)),
    )
    if (!session) return { ok: false, error: SET_STATUS_REFUSAL }
    const needs = args.needs === true
    this.record(session, {
      type: 'status',
      text: args.text,
      needs,
      level: clampLevel(args.level ?? (needs ? 3 : 1)),
    })
    const open = session.committed + 1
    this.rememberStatus(
      session,
      statusTextAfterTurn(session.live.filter((entry) => entry.turn === open).map((entry) => entry.event)),
    )
    return { ok: true, value: { shown: true } }
  }

  async stop(treeId: string, noteId: unknown): Promise<void> {
    const session = this.sessionFor(treeId, noteId)
    await session.engine?.stop()
  }

  /**
   * The workspace closed: stop every chat in it and delete their MCP config
   * files. A turn still open is committed first, synchronously and before any
   * engine is dropped, while the tree is still open: what arrived so far and a
   * `Stopped` line, so the person's message is never lost (one commit per
   * turn, D-07). The engine's own later `done` is not heard.
   */
  async closeWorkspace(treeId: string): Promise<void> {
    const closing = [...this.sessions.values()].filter((session) => session.treeId === treeId)
    for (const session of closing) this.commitOnClose(session)
    for (const session of closing) this.sessions.delete(sessionKey(session.treeId, session.noteId))
    await Promise.all(closing.map((session) => this.dropEngine(session)))
    for (const [key, file] of [...this.configFiles]) {
      if (file.treeId === treeId) this.removeConfigFile(key)
    }
  }

  /**
   * App quit: every chat is closed. Each open turn is committed synchronously
   * (closeWorkspace does so before its first await), so will-quit may close
   * the trees right after calling this without awaiting it.
   */
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
    if (this.deleting.has(key)) throw new Error(SESSION_NOT_FOUND_MESSAGE)
    let session = this.sessions.get(key)
    if (!session) {
      const saved = persistKey(ws.realRoot, noteId)
      const entry = this.readChats().sessions[saved]
      const persisted = entry?.sessionId ?? null
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
        pendingDone: null,
        lastUsed: 0,
        lastStatus: entry?.lastStatus ?? null,
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
    try {
      engine.send(text)
    } catch (err) {
      session.turnShell = false
      this.failTurn(session, { type: 'error', kind: 'crashed', message: startFailedMessage(err) })
    }
  }

  /** The session is still the one this service holds for its note. */
  private isCurrent(session: Session): boolean {
    return this.sessions.get(sessionKey(session.treeId, session.noteId)) === session
  }

  /**
   * At most MAX_LIVE_ENGINES session processes stay alive while idle. Before
   * a new one starts, the least recently used idle sessions are ended
   * quietly (no `done`; the conversation id is kept, so the next message
   * resumes it). A running or settling turn is never ended: with more turns
   * running at once than the cap, the cap is exceeded.
   */
  private async makeRoomForEngine(except: Session): Promise<void> {
    for (;;) {
      const holding = [...this.sessions.values()].filter((session) => session.engine !== null)
      if (holding.length < MAX_LIVE_ENGINES) return
      const idle = holding
        .filter(
          (session) =>
            session !== except &&
            !session.turnOpen &&
            !session.recovering &&
            session.settling === null &&
            !(session.engine?.busy ?? false),
        )
        .sort((a, b) => a.lastUsed - b.lastUsed)
      const oldest = idle[0]
      if (!oldest) return
      await this.dropEngine(oldest)
    }
  }

  private async ensureEngine(session: Session, binaryPath: string, fresh = false): Promise<ChatEngine> {
    if (session.engine) return session.engine
    await this.makeRoomForEngine(session)
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
      // The lost session's failed attempt: its error and `done` never reach
      // the passage; the message is sent once more in a fresh session.
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
      // Recorded into the open turn, so the passage says it as a Note.
      this.record(session, { type: 'notice', text: SESSION_LOST_NOTICE })
      return
    }

    if (event.type === 'session') {
      session.sessionId = event.sessionId
      this.persistSession(session)
    }

    // A turn that ran with the shell on (ok or not: a crash or Stop may follow
    // a command that changed files) is caught up before its passage is
    // committed, so the file changes precede the passage in the journal.
    if (event.type === 'done' && session.turnShell) {
      session.turnShell = false
      session.pendingDone = event
      const settling = this.catchUpAfterShellTurn(session).finally(() => {
        if (session.settling === settling) session.settling = null
        session.pendingDone = null
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
   * A turn failed before or instead of reaching the engine (agents off, no
   * `claude`, a start that threw): its error is recorded and the turn is
   * committed like any other, so the note says what happened.
   */
  private failTurn(session: Session, error: Extract<ChatEvent, { type: 'error' }>): void {
    this.record(session, error)
    this.finishTurn(session, { type: 'done', ok: false })
  }

  /**
   * A turn ended (D-07): its passage is appended to the session note in one
   * commit signed by the session's agent, then its `done` is sent, tagged
   * with the turn just committed. A failed commit is logged and said in the
   * chat, never thrown.
   */
  private finishTurn(session: Session, done: Extract<ChatEvent, { type: 'done' }>): void {
    if (!session.turnOpen) {
      this.record(session, done)
      return
    }
    try {
      const turn = this.commitOpenTurn(session, [done])
      if (turn === null) {
        this.record(session, done)
        return
      }
      // Sent, not kept: the note holds this turn now.
      this.emitEvent(session, done, turn)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error('[ChatService] could not save a chat turn into its note:', err)
      this.record(session, { type: 'notice', text: turnNotSavedNotice(reason) })
      this.record(session, done)
    }
  }

  /**
   * Commit the open turn as one passage (D-07): its events from its user
   * message on, the notices recorded before it (the shell switch), and
   * `extra` (how it ended). Returns the committed turn number, or null when
   * no turn was open. The turn is closed even when the commit throws.
   */
  private commitOpenTurn(session: Session, extra: ChatEvent[] = []): number | null {
    if (!session.turnOpen) return null
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
        ? [...events, ...extra]
        : [
            ...events.slice(0, userIndex).filter((event) => event.type === 'notice'),
            ...events.slice(userIndex),
            ...extra,
          ]

    // The last status text (D-12) is chrome: kept beside the tree, never in it.
    this.rememberStatus(session, statusTextAfterTurn(turnEvents))

    const ws = this.workspaceFor(session.treeId)
    const { turn } = this.options.sessionNotes.appendTurn(
      ws.tree,
      session.noteId,
      agentActor(session.agent),
      turnItemsFromEvents(turnEvents),
    )
    session.committed = turn
    session.live = session.live.filter((entry) => entry.turn > turn)
    return turn
  }

  /**
   * The workspace is closing or Tapestry is quitting: an open turn is
   * committed now, with what arrived so far and a `Stopped` line (or, when
   * its shell catch-up is still running, the `done` it already had). Never
   * throws.
   */
  private commitOnClose(session: Session): void {
    if (!session.turnOpen) return
    const done = session.pendingDone ?? { type: 'done', ok: false, reason: 'stopped' }
    try {
      this.commitOpenTurn(session, [done])
    } catch (err) {
      console.error('[ChatService] could not save an open chat turn while closing:', err)
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

  /**
   * One resend after a lost session, in a fresh session. The message is not
   * recorded a second time: the open turn already starts with it.
   */
  private async resendAfterLoss(session: Session): Promise<void> {
    const text = session.lastText
    await this.dropEngine(session)
    session.sessionId = null
    this.persistSession(session)
    if (!text || !this.isCurrent(session) || !session.turnOpen) return
    const binary = (this.options.claudeBinary ?? defaultClaudeBinary)()
    if (!('path' in binary)) {
      this.failTurn(session, { type: 'error', kind: 'not-installed', message: notInstalledMessage(binary.lookedIn) })
      return
    }
    session.resentAfterLoss = true
    let engine: ChatEngine
    try {
      engine = await this.ensureEngine(session, binary.path, true)
    } catch (err) {
      this.failTurn(session, { type: 'error', kind: 'crashed', message: startFailedMessage(err) })
      return
    }
    if (!this.isCurrent(session) || !session.turnOpen) return
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
        if (typeof entry.lastStatus === 'string' && entry.lastStatus.length > 0) {
          kept.lastStatus = entry.lastStatus.slice(0, MAX_LAST_STATUS_CHARS)
        }
        if (kept.sessionId !== undefined || kept.shell !== undefined || kept.lastStatus !== undefined) {
          file.sessions[key] = kept
        }
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
    if (entry.sessionId === undefined && entry.shell === undefined && entry.lastStatus === undefined) {
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

  /**
   * Keep a session's last status text (D-12) in memory and in chats.json.
   * An empty text is not kept; a write that fails only loses it for the next
   * launch.
   */
  private rememberStatus(session: Session, text: string): void {
    const kept = text.slice(0, MAX_LAST_STATUS_CHARS)
    if (kept.length === 0 || kept === session.lastStatus) return
    session.lastStatus = kept
    try {
      this.updateEntry(session, (entry) => {
        entry.lastStatus = kept
      })
    } catch (err) {
      console.error('[ChatService] could not write chats.json:', err)
    }
  }

  /** Remove a session's chats.json entry (its note is being deleted). */
  private forgetEntry(session: Session): void {
    try {
      const key = persistKey(session.realRoot, session.noteId)
      const file = this.readChats()
      if (!(key in file.sessions)) return
      delete file.sessions[key]
      this.writeChats(file)
    } catch (err) {
      console.error('[ChatService] could not write chats.json:', err)
    }
  }

  private agentsChanged(): void {
    try {
      this.options.onAgentsChanged?.()
    } catch (err) {
      console.error('[ChatService] agents-changed listener threw:', err)
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

/** Said when Claude Code could not be started for a turn. */
function startFailedMessage(err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err)
  return `Claude Code couldn't be started: ${reason}`
}

function defaultClaudeBinary(): { path: string } | { lookedIn: string[] } {
  return resolveClaudeBinary({ env: process.env, home: homedir(), exists: isExecutableFile })
}
