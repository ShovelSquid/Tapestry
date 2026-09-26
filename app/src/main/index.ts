/**
 * Electron main process entry point.
 *
 * Creates the BrowserWindow with secure settings (nodeIntegration: false,
 * contextIsolation: true), registers IPC handlers via KernelBridge and
 * PluginHost, and handles app lifecycle events.
 *
 * Security: T-02-03 mitigated — renderer has no direct Node.js access.
 * All kernel access goes through the contextBridge preload.
 *
 * Open worlds live in a TreeRegistry (D-15). Until Plan 05 opens the frame
 * view the app still shows one tree at a time, but agents already address
 * trees by name through the shared command layer (D-01).
 */

import { app, BrowserWindow, ipcMain, dialog, net, protocol, shell } from 'electron'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { execFileSync } from 'child_process'
import { userInfo } from 'os'
import { KernelBridge } from './kernel-bridge'
import { PluginHost } from './plugin-host'
import { PLUGIN_SCHEME, SCHEME_PRIVILEGES, makePluginSchemeHandler } from './plugin-scheme'
import { SettingsStore, suggestUserName } from './settings'
import { agentActor, humanActor, isValidActorName, type Actor } from './commands/actor'
import { buildConnectCommand } from './agents/connect-command'
import { TreeRegistry, type TreeEntry } from './trees/registry'
import { VaultService } from './obsidian/vault-service'
import { NoteCommands, type CommandHooks } from './commands/notes'
import { ConnectionCommands } from './commands/connections'
import { SpatialCommands } from './commands/spatial'
import { runAgentTool, type AgentCommands } from './commands/agent-tools'
import { WorkspaceFileCommands } from './commands/file-tools'
import { WorkspaceService } from './workspace/workspace-service'
import { WORKSPACE_REPLAY_REFUSAL, workspaceSubmitRefusal } from './workspace/guards'
import { AgentRegistry, agentSocketPath } from './agents/registry'
import { AgentSocketServer } from './agents/socket-server'
import { ChatService } from './chat/chat-service'
import { SESSION_NOT_FOUND_MESSAGE, SESSION_NOTE_ID_RE, SessionNotes } from './chat/session-notes'
import { SpaceRefusal, SpaceService } from './space/space-service'
import { openWithRollback } from './space/open-into-space'
import { SPACE_NOT_OPEN, type SpacePaths } from './space/migrate'
import { FOREST_FILE, HOME_FILE, HOME_LOCATION } from './space/shapes'

// ---------------------------------------------------------------------------
// Plugin surface scheme (CANV-04)
// ---------------------------------------------------------------------------

// Must run before app 'ready': Electron refuses privileged-scheme
// registration afterwards. The handler itself is attached inside whenReady,
// once the plugins directory is known.
protocol.registerSchemesAsPrivileged([{ scheme: PLUGIN_SCHEME, privileges: SCHEME_PRIVILEGES }])
import { ThreadIpc } from './threads/thread-ipc'
import { ThreadService } from './threads/thread-service'
import { isVaultThread, writeVaultThreadFile } from './threads/vault-thread'

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Tapestry',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  // In dev mode electron-vite serves the renderer from a dev server.
  // In production, load the built HTML file.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ---------------------------------------------------------------------------
// Development-only path overrides (2.6 RESEARCH Pitfall 6, T-2.6-22)
// ---------------------------------------------------------------------------

/**
 * A folder named by an environment variable, honoured only in a development
 * build, so a check can run against copies instead of live data.
 *
 * A packaged build ignores both variables: they could otherwise redirect
 * where a person's arrangement is read and written. The value must be an
 * absolute path with no `..` segment.
 */
function devPathOverride(name: 'TAPESTRY_USER_DATA_DIR' | 'TAPESTRY_SPACE_DIR'): string | null {
  if (app.isPackaged) return null
  const value = process.env[name]
  if (!value || !isAbsolute(value)) return null
  if (value.split(/[\\/]/).includes('..')) return null
  return resolve(value)
}

// userData must be redirected before 'ready': settings.json, last-opened.json
// and the agent socket are all resolved from it.
if (!app.isPackaged) {
  const userDataOverride = devPathOverride('TAPESTRY_USER_DATA_DIR')
  if (userDataOverride) {
    console.log('[Main] development userData:', userDataOverride)
    app.setPath('userData', userDataOverride)
  }
}

// ---------------------------------------------------------------------------
// Phase 2's last-opened file (D-18)
// ---------------------------------------------------------------------------

/**
 * Phase 2's record of the one open world.
 *
 * The arrangement now lives in the forest tree (2.6 D-01, superseding 2.2
 * D-18). This file is read once, by the space's first-launch import, when the
 * old settings `trees` list is empty. Nothing writes it any more.
 */
function getLastOpenedPath(): string {
  return join(app.getPath('userData'), 'last-opened.json')
}

/**
 * Paths the user explicitly chose through a native dialog (or that were
 * restored from last-opened.json) this session. The renderer may only ask
 * the kernel to create/open a .tree file at one of these or under home, so
 * the save dialog and validateTreePath can never disagree: whatever location
 * the user picked is accepted, and a fabricated path outside home is not.
 */
const approvedPaths = new Set<string>()

/** Absolute, ends in .tree, no ".." segments. Shared by every path check. */
function isWellFormedTreePath(filePath: unknown): filePath is string {
  if (!filePath || typeof filePath !== 'string') return false
  if (!isAbsolute(filePath)) return false
  if (filePath.split(/[\\/]/).includes('..')) return false
  return resolve(filePath).endsWith('.tree')
}

function validateTreePath(filePath: string): boolean {
  if (!isWellFormedTreePath(filePath)) return false

  const normalized = resolve(filePath)
  if (approvedPaths.has(normalized)) return true

  const home = resolve(app.getPath('home'))
  const relativeToHome = relative(home, normalized)
  return (
    relativeToHome !== '..' &&
    !relativeToHome.startsWith(`..${sep}`) &&
    !isAbsolute(relativeToHome)
  )
}

/**
 * Vault folders the user chose through the native folder dialog this session.
 *
 * A vault root is a door into a whole directory tree, so unlike a `.tree` path
 * there is no "anywhere under home" fallback: the only roots `vault:add` will
 * accept are the ones a person picked in a dialog (T-02.2-37).
 */
const approvedVaultRoots = new Set<string>()

/**
 * Workspace folders chosen through the folder dialog this session, or
 * restored from settings (T-02.7-08). `workspace:add` accepts no other root.
 */
const approvedWorkspaceRoots = new Set<string>()

/** Node ids the kernel issues: `n1`, `n2`, ... */
const NODE_ID_PATTERN = /^n[1-9][0-9]*$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

/** Absolute, non-empty, no `..` segment. The shape check before the dialog check. */
function isWellFormedVaultRoot(folderPath: unknown): folderPath is string {
  if (!folderPath || typeof folderPath !== 'string') return false
  if (!isAbsolute(folderPath)) return false
  return !folderPath.split(/[\\/]/).includes('..')
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

/** Every open tree, keyed by the identity in its file (D-15). */
const registry = new TreeRegistry()

/**
 * The forest tree and the Tapestry tree (2.6 D-01, D-02). Held outside the
 * registry, so plugins and agents cannot reach either; null until launch.
 */
let space: SpaceService | null = null

let pluginHost: PluginHost
let agentServer: AgentSocketServer | null = null
/** The in-app chats (02.7 D-12, 02.8 D-02), one per session note. */
let chatService: ChatService | null = null
/** Kept at module level so will-quit can stop every workspace watcher. */
let workspaceServiceRef: WorkspaceService | null = null
let threadService: ThreadService | null = null
/** Assigned once the vault IPC section below runs; read by the thread flush
 * hook (D-25), which is wired earlier — the closure captures this binding by
 * reference, not by the value at wiring time. */
let vaultService: VaultService | null = null

/** A tree id is exactly what the registry mints: `sha256:` + 64 hex digits. */
const TREE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The bridge for a tree the renderer named, or an error (T-02.2-26).
 *
 * The shape is checked before the lookup so a malformed argument is refused
 * as a malformed argument rather than as a missing tree. A renderer cannot
 * address a tree that is not open: ids come from files main opened, so this
 * is not a name the window can invent.
 */
function resolveTree(treeId: unknown): KernelBridge {
  // A tree that would not open is refused with the reason, not as unknown: it
  // is in the space and on screen, so "unknown tree" would be a worse answer
  // than "this tree is damaged" (T-02.2-29).
  if (typeof treeId === 'string') {
    const refusal = registry.refusalFor(treeId)
    if (refusal) throw new Error(refusal)
  }

  if (typeof treeId !== 'string' || !TREE_ID_PATTERN.test(treeId)) {
    throw new Error(`Unknown tree ${String(treeId)}`)
  }
  const tree = registry.get(treeId)
  if (!tree) {
    throw new Error(`Unknown tree ${String(treeId)}`)
  }
  return tree.bridge
}

/** The space changed: a tree opened, closed, or was renamed. */
function notifyTreesChanged(): void {
  mainWindow?.webContents.send('trees-changed')
}

/**
 * Discover and load plugins without letting a plugin failure surface as a
 * world-open failure (D-33: a broken plugin never prevents a world opening).
 *
 * Plugins are loaded once, against a facade bound to whichever tree is
 * primary, rather than reloaded per tree: their SDK is unchanged by D-15.
 */
async function loadPluginsSafely(): Promise<void> {
  try {
    await pluginHost.discoverAndLoadAll(registry.primaryBridgeProxy())
  } catch (err) {
    console.error('[Main] Plugin discovery failed:', err)
  }
}

/**
 * The macOS account's full name ("Kaelen Cook"), or null.
 *
 * Used only to prefill the first-run prompt, so every failure mode — another
 * platform, a missing `id`, a slow directory lookup — is simply "no
 * suggestion" rather than an error the user has to read.
 */
function readMacFullName(): string | null {
  if (process.platform !== 'darwin') return null
  try {
    return execFileSync('id', ['-F'], { encoding: 'utf-8', timeout: 2000 }).trim() || null
  } catch {
    return null
  }
}

app.whenReady().then(async () => {
  // Settings (D-07): the stored user name signs every human commit.
  const settings = new SettingsStore(app.getPath('userData'))

  /**
   * Resolve the actor for a renderer-originated commit.
   *
   * This is the only place a human actor is constructed. Throwing when no
   * name is stored is deliberate: a change must never be signed with a
   * placeholder, so the first-run prompt has to be answered before any commit
   * can land.
   */
  function getHumanActor(): Actor {
    const name = settings.getUserName()
    if (name === null) {
      throw new Error('Set your name before making changes')
    }
    return humanActor(name)
  }

  // Register kernel IPC handlers. Every channel names its tree first (D-15).
  // Workspace trees (02.7 D-03): the window may move and resize cards and
  // connect notes, never create or delete notes, set file.* keys or rewind.
  const isWorkspaceTree = (treeId: unknown): boolean =>
    typeof treeId === 'string' && registry.get(treeId)?.kind === 'workspace'
  KernelBridge.registerHandlers(ipcMain, resolveTree, getHumanActor, {
    // A chat session note's conversation is written only by its chat (02.8 T-02.8-07).
    beforeSubmit: (treeId, ops) =>
      isWorkspaceTree(treeId)
        ? workspaceSubmitRefusal(ops, (id) => registry.get(treeId as string)?.bridge.getNode(id)?.type)
        : null,
    beforeReplay: (treeId) => (isWorkspaceTree(treeId) ? WORKSPACE_REPLAY_REFUSAL : null),
  })

  // Thread IPC (D-06): the single write authority for every open thread.
  // notifyConfirmed reaches every window, not just the one that pushed the
  // steps that triggered the flush -- the same broadcast shape as
  // 'tree-changed' below.
  threadService = new ThreadService()
  ThreadIpc.registerHandlers(
    ipcMain,
    threadService,
    resolveTree,
    getHumanActor,
    (treeId, nodeId, version) => {
      mainWindow?.webContents.send('thread:confirmed', treeId, nodeId, version)
      // D-25: a vault thread's current text reaches its `.md` file on the
      // same cadence as every other thread flush. `vaultService` is assigned
      // later in this function (the vault IPC section below) — by the time
      // a real flush ever fires, startup has long finished, so the closure
      // sees the assigned value even though it reads `vaultService` before
      // that line runs at parse time.
      const tree = registry.get(treeId)
      const node = tree?.bridge.getNode(nodeId)
      if (tree && node && vaultService && threadService && isVaultThread(node)) {
        writeVaultThreadFile(vaultService, threadService, tree.bridge, getHumanActor(), treeId, nodeId).catch(
          (err) => {
            console.error('[VaultThread] failed to sync the vault file:', err)
          },
        )
      }
    },
    (treeId, nodeId, reason) => {
      mainWindow?.webContents.send('thread:flush-error', treeId, nodeId, reason)
    },
  )

  // Discover and load plugins
  const pluginsDir = join(app.getAppPath(), '..', 'plugins')
  pluginHost = new PluginHost(pluginsDir)
  // Commands know who asked for them; their commits are still signed by the
  // plugin (D-06).
  pluginHost.invokerActor = getHumanActor

  // Register plugin IPC handlers
  PluginHost.registerHandlers(ipcMain, pluginHost)

  // Serve plugin surface modules, their Workers and .wasm from the same
  // plugins directory PluginHost loads from (CANV-04). The handler only ever
  // serves what resolvePluginFile returns; everything else is a 404.
  protocol.handle(
    PLUGIN_SCHEME,
    makePluginSchemeHandler(pluginsDir, { fetchFile: (fileUrl) => net.fetch(fileUrl) }),
  )

  // Wire plugin error notifications to the renderer (D-34)
  pluginHost.onPluginError = (
    pluginName: string,
    displayName: string,
    message: string,
    canRestart: boolean,
  ) => {
    if (mainWindow) {
      mainWindow.webContents.send('plugin-error', pluginName, displayName, message, canRestart)
    }
  }

  // -------------------------------------------------------------------------
  // Agent bridge (D-03/D-06): MCP shim -> Unix socket -> shared commands
  // -------------------------------------------------------------------------

  const agents = new AgentRegistry(join(app.getPath('userData'), 'agents.json'))

  // A commit that did not come from the renderer still has to show up there.
  // The command layer reports every landed commit, and main forwards the tree
  // it landed in, so the canvas refreshes without Kaelen doing anything.
  const commandHooks: CommandHooks = {
    onCommitted: (treeId) => {
      mainWindow?.webContents.send('tree-changed', treeId)
    },
    // An agent's write had to return a rewound tree to its latest state, so
    // the redo Kaelen could have used is gone. Saying so is the whole point:
    // losing a redo silently would be the failure UA-14 describes.
    onRedoDiscarded: (treeId, actor) => {
      mainWindow?.webContents.send('redo-discarded', {
        treeId,
        treeName: registry.get(treeId)?.name ?? treeId,
        actorId: actor.id,
      })
    },
  }

  // Workspace trees (02.7): folders mirrored into trees kept in app data,
  // never inside the folder, so a git worktree stays clean.
  const workspaceService = new WorkspaceService(registry, {
    treesDir: join(app.getPath('userData'), 'workspaces'),
    hooks: commandHooks,
    // Watching, not watching, or folder missing: the frame header says which.
    onStatus: (treeId, status) => {
      mainWindow?.webContents.send('workspace-status', { treeId, ...status })
    },
  })
  workspaceServiceRef = workspaceService

  const agentNotes = new NoteCommands(registry, commandHooks)
  const agentCommands: AgentCommands = {
    notes: agentNotes,
    connections: new ConnectionCommands(registry, commandHooks),
    spatial: new SpatialCommands(registry, commandHooks),
    files: new WorkspaceFileCommands(workspaceService, {
      // open_file (02.7 SC2): pan the canvas to the file's note and open its
      // window. Returns whether there was a window to show it in.
      onReveal: (treeId, noteId) => {
        if (!mainWindow) return false
        mainWindow.webContents.send('reveal-note', { treeId, noteId })
        return true
      },
    }),
    // D-20..D-24 thread tools (Plan 08): only available once threadService
    // exists, which it always does by this point in startup -- guarded
    // rather than asserted so a future reordering fails soft (a clear "not
    // available" refusal) instead of a startup crash.
    threads: threadService ? { registry, threadService, notes: agentNotes } : undefined,
  }

  agentServer = new AgentSocketServer({
    socketPath: agentSocketPath(app.getPath('userData')),
    agents,
    // The agent name comes from the verified token, never from the request.
    dispatch: (name, tool, args) => runAgentTool(agentCommands, agentActor(name), tool, args),
  })

  /**
   * Start the agent bridge without letting it block the app (Phase 2 D-33).
   * A socket that cannot bind must never stop a world from opening.
   */
  async function startAgentBridgeSafely(): Promise<void> {
    try {
      await agentServer?.listen()
    } catch (err) {
      console.error('[AgentBridge] socket failed:', err)
    }
  }

  /** The Agents panel re-reads its list whenever this fires. */
  function notifyAgentsChanged(): void {
    mainWindow?.webContents.send('agents-changed')
  }

  agentServer.onConnectionsChanged(notifyAgentsChanged)

  // The switch is honoured from launch: with agents turned off, no socket is
  // opened at all, rather than opened and then refused.
  if (settings.read().agentsEnabled) {
    await startAgentBridgeSafely()
  }

  // -------------------------------------------------------------------------
  // In-app chats (02.7 D-12..D-16, 02.8 D-02): the person's own claude,
  // confined to Tapestry's workspace tools. Each chat is a session note in its
  // workspace tree and signs as its own agent, agent.claude-chat-<8 hex>-<note>
  // -------------------------------------------------------------------------

  const sessionNotes = new SessionNotes({ hooks: commandHooks })
  const chat = new ChatService({
    userDataDir: app.getPath('userData'),
    agents,
    workspaces: workspaceService,
    launch: {
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      execPath: process.execPath,
      resourcesPath: process.resourcesPath,
    },
    isBridgeEnabled: () => settings.read().agentsEnabled,
    sessionNotes,
    humanActor: getHumanActor,
    onAgentsChanged: notifyAgentsChanged,
    emit: (treeId, noteId, turn, event) =>
      mainWindow?.webContents.send('chat-event', { treeId, noteId, turn, event }),
  })
  chatService = chat

  /** A chat's workspace is addressed by its tree's id, checked like every tree id. */
  function chatTreeId(treeId: unknown): string {
    if (typeof treeId !== 'string' || !TREE_ID_PATTERN.test(treeId)) {
      throw new Error(`Unknown tree ${String(treeId)}`)
    }
    return treeId
  }

  /**
   * A chat is its session note (D-02). The shape is checked here; whether it
   * is a live session note in that workspace is ChatService's check.
   */
  function chatNoteId(noteId: unknown): string {
    if (typeof noteId !== 'string' || !SESSION_NOTE_ID_RE.test(noteId)) {
      throw new Error(SESSION_NOT_FOUND_MESSAGE)
    }
    return noteId
  }

  // New chat (D-01: the only way a session note is made). The placement is
  // checked in ChatService: undefined, or `{ at: { x, y } }` (the pointer).
  ipcMain.handle('chat:create', (_event, treeId: unknown, placement: unknown) => {
    try {
      return { ok: true, value: chat.createSession(chatTreeId(treeId), placement) }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  // Delete a chat (02.8-02): its engine, config file and chats.json entry go,
  // and the note is removed in one commit signed by the person.
  ipcMain.handle('chat:delete', async (_event, treeId: unknown, noteId: unknown) => {
    try {
      await chat.deleteSession(chatTreeId(treeId), chatNoteId(noteId))
      return { ok: true, value: null }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle('chat:open', (_event, treeId: unknown, noteId: unknown) => {
    try {
      return { ok: true, value: chat.open(chatTreeId(treeId), chatNoteId(noteId)) }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle('chat:send', async (_event, treeId: unknown, noteId: unknown, text: unknown) => {
    try {
      const id = chatTreeId(treeId)
      const note = chatNoteId(noteId)
      if (typeof text !== 'string') return { ok: false, error: 'A message must be text' }
      await chat.send(id, note, text)
      return { ok: true, value: null }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle('chat:stop', async (_event, treeId: unknown, noteId: unknown) => {
    try {
      await chat.stop(chatTreeId(treeId), chatNoteId(noteId))
      return { ok: true, value: null }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  // The shell switch (D-15). The panel asks for confirmation before `on`; a
  // non-boolean is refused rather than read as either state.
  ipcMain.handle('chat:setAllowShell', async (_event, treeId: unknown, noteId: unknown, on: unknown) => {
    try {
      const id = chatTreeId(treeId)
      const note = chatNoteId(noteId)
      if (typeof on !== 'boolean') return { ok: false, error: 'The shell switch must be on or off' }
      await chat.setAllowShell(id, note, on)
      return { ok: true, value: null }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  // -------------------------------------------------------------------------
  // Agents IPC — connect, list, remove, and the bridge switch
  // -------------------------------------------------------------------------

  ipcMain.handle('agents:list', () => {
    const states = new Map(
      (agentServer?.connectionStates() ?? []).map((state) => [state.name, state]),
    )
    return agents.list().map((agent) => ({
      name: agent.name,
      createdAt: agent.createdAt,
      connected: states.get(agent.name)?.connected ?? false,
      lastConnectedAt: agent.lastConnectedAt,
    }))
  })

  ipcMain.handle('agents:create', (_event, name: unknown) => {
    // Validated here as well as in the dialog: the renderer decides what to
    // enable, main decides what exists (T-02.2-22).
    if (!isValidActorName(name)) {
      return {
        ok: false,
        error: 'Use lowercase letters, numbers, - or _ (1 to 32 characters).',
      }
    }

    try {
      const { token } = agents.create(name)
      const command = buildConnectCommand({
        token,
        userDataDir: app.getPath('userData'),
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        execPath: process.execPath,
        resourcesPath: process.resourcesPath,
      })
      notifyAgentsChanged()
      // The token travels back exactly once, inside the command; it is never
      // stored in plaintext, so this is the only chance to show it.
      return { ok: true, name, command }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('already exists')) {
        return { ok: false, error: `agent.${name} already exists. Choose another name.` }
      }
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('agents:remove', (_event, name: unknown) => {
    if (typeof name !== 'string') return { ok: false }
    // The stored digest goes with it, so the token stops verifying on the
    // agent's very next request (T-02.2-19). Its past commits stay in history.
    const ok = agents.remove(name)
    if (ok) notifyAgentsChanged()
    return { ok }
  })

  ipcMain.handle('agents:getEnabled', () => {
    return settings.read().agentsEnabled
  })

  ipcMain.handle('agents:setEnabled', async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { ok: false, error: 'enabled must be true or false' }
    }

    settings.update((current) => ({ ...current, agentsEnabled: enabled }))

    if (enabled) {
      await startAgentBridgeSafely()
    } else {
      // Closing removes the socket file, so an agent cannot reach the command
      // layer at all while the switch is off.
      await agentServer?.close()
      // The chat's tools would fail from here on, so its turns stop too.
      await chatService?.stopAll()
    }

    notifyAgentsChanged()
    return { ok: true }
  })

  // Name settings (D-07). The renderer reads and sets the name, but never
  // uses it to build an actor: getHumanActor above is the only place that
  // happens.
  ipcMain.handle('settings:getUserName', () => {
    return {
      userName: settings.getUserName(),
      suggested: suggestUserName(readMacFullName(), userInfo().username),
    }
  })

  ipcMain.handle('settings:setUserName', (_event, name: unknown) => {
    try {
      settings.setUserName(name)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // -------------------------------------------------------------------------
  // Trees IPC (D-15): which worlds are in the space, and where
  //
  // Frames live in the forest tree, one placement edge per member (2.6 D-01,
  // D-04). `trees:list` reads them there and `trees:moveFrames` writes them
  // there. `trees:open`, `trees:create`, `trees:close` and `vault:add` record
  // membership there too (Plan 04), and `trees:undoFrames`, `trees:redoFrames`
  // and `trees:fitFrame` write there as well (Plan 05). Nothing writes frame
  // positions to settings.json any more.
  // -------------------------------------------------------------------------

  // The space folder (D-06): ~/Documents/Tapestry, unless a development build
  // was pointed at a scratch folder. The Tapestry tree sits beside the forest
  // (answer 1.10), readable without the app.
  const spaceDir = devPathOverride('TAPESTRY_SPACE_DIR') ?? join(app.getPath('documents'), 'Tapestry')
  const spacePaths: SpacePaths = {
    forest: join(spaceDir, FOREST_FILE),
    home:
      HOME_LOCATION === 'space-dir'
        ? join(spaceDir, HOME_FILE)
        : join(app.getPath('userData'), HOME_FILE),
    lastOpenedFile: getLastOpenedPath(),
  }

  // No vault launch-restore branch exists yet (2.2 Plan 08 has not landed on
  // this branch), so vault members stay in the forest unopened: there is no
  // restoreVault hook to give the service.
  space = new SpaceService({
    registry,
    settings,
    paths: spacePaths,
    hooks: {
      // Members were chosen by the person in an earlier session.
      approvePath: (path) => {
        approvedPaths.add(resolve(path))
      },
      // A workspace member (02.7) is restored through the workspace service:
      // its folder is approved again, its tree in app data opened or rebuilt,
      // and its watcher started. Its frame and membership are the forest's.
      restoreWorkspace: async ({ treePath, workspaceRoot, expect }) => {
        approvedWorkspaceRoots.add(resolve(workspaceRoot))
        const entry = await workspaceService.openWorkspace(workspaceRoot, treePath, expect)
        if ('bridge' in entry) startWatchingSafely(entry.id)
      },
    },
  })

  /**
   * Open or create a tree, then record it in the forest (2.6 D-01, D-02).
   *
   * The actor is resolved before anything opens (RESEARCH "Name-before-commit
   * gap", answer 2.7): the forest commit is signed by the person, so without a
   * name nothing is opened at all. If opening fails part-way (a vault tree
   * that will not open, a failed catch-up) or the forest cannot record the
   * tree, `openWithRollback` closes every registry entry this call introduced
   * that joins no stand-in, so the registry and the forest never disagree
   * about what is in the space (T-2.6-24, review WR-02).
   */
  async function openIntoSpace(open: () => TreeEntry | Promise<TreeEntry>): Promise<
    { ok: true; treeId: string } | { ok: false; error: string; notice?: string }
  > {
    try {
      const actor = getHumanActor()
      if (!space || !space.ready) throw new SpaceRefusal()
      const tree = await openWithRollback(registry, {
        open,
        record: (entry) => {
          // A vault's first read is awaited inside open(), so the space may
          // have been closed by a quit in the meantime (review IN-02).
          if (!space || !space.ready) throw new SpaceRefusal()
          space.addMember(entry, actor)
        },
        isMember: (id) => space?.isMember(id) ?? false,
      })
      notifyTreesChanged()
      return { ok: true, treeId: tree.id }
    } catch (err) {
      return spaceFailure(err)
    }
  }

  /**
   * A failed space action. `notice` carries an approved sentence (4.9 or
   * 4.10) the window shows verbatim in place of its generic wording.
   */
  function spaceFailure(err: unknown): { ok: false; error: string; notice?: string } {
    const notice = err instanceof SpaceRefusal ? err.message : space?.noticeFor(err) ?? undefined
    return notice === undefined
      ? { ok: false, error: errorMessage(err) }
      : { ok: false, error: errorMessage(err), notice }
  }

  /**
   * Why the space did not open, in the approved wording (4.2-4.8), or null.
   * The window asks on load and on every trees-changed, and shows each
   * distinct message once in the app-error banner (answer 4.1).
   */
  ipcMain.handle('trees:spaceProblem', () => {
    return { message: space?.problemNotice() ?? null }
  })

  ipcMain.handle('trees:list', () => {
    // Frames come from placement edges in the forest (2.6 D-04), never from
    // settings.json.
    if (space) return space.list()
    return registry.summary().map((tree) => ({ ...tree, frame: { x: 0, y: 0 } }))
  })

  /**
   * Record one drop: the dragged frame first, then every frame it pushed
   * aside, as exactly one forest commit (2.6 D-11).
   *
   * Main signs it with the person's name; the renderer sends no actor
   * (T-2.6-11). The batch is passed untouched to the service, which checks it
   * in full before writing anything (T-2.6-05).
   *
   * Deliberately does not emit 'trees-changed': the renderer already has the
   * positions it just sent, and echoing them back would refresh every tree on
   * every drop.
   */
  ipcMain.handle('trees:moveFrames', (_event, moves: unknown) => {
    try {
      const actor = getHumanActor()
      if (!space || !space.ready) return { ok: false, error: SPACE_NOT_OPEN }
      const { committed } = space.moveFrames(moves, actor)
      return { ok: true, committed }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  /**
   * Put the last drop back (2.6 D-08, D-09): a new forest commit signed by
   * the person, writing origins main read from the forest before the drop.
   * The renderer sends nothing; the forest is never rewound, so `kernel:undo`
   * never reaches it (the forest is not in the registry).
   *
   * Does not emit 'trees-changed': the renderer refreshes the frames itself
   * when something was committed.
   */
  ipcMain.handle('trees:undoFrames', () => {
    try {
      const actor = getHumanActor()
      if (!space || !space.ready) return { ok: false, error: SPACE_NOT_OPEN }
      const { committed, undoable, redoable } = space.undoFrames(actor)
      return { ok: true, committed, undoable, redoable }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  /** Put an undone drop forward again (2.6 D-08, D-09); the mirror of `trees:undoFrames`. */
  ipcMain.handle('trees:redoFrames', () => {
    try {
      const actor = getHumanActor()
      if (!space || !space.ready) return { ok: false, error: SPACE_NOT_OPEN }
      const { committed, undoable, redoable } = space.redoFrames(actor)
      return { ok: true, committed, undoable, redoable }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  /**
   * Open an existing world beside the ones already in the space.
   *
   * Nothing is closed: D-15 is precisely that several trees share one space.
   * Failures are returned rather than thrown, because the common one is worth
   * reading — opening a copy of a world that is already open is refused by
   * identity (T-02.2-28), and "already open" is a sentence, not a stack trace.
   */
  ipcMain.handle('trees:open', async (_event, path: unknown) => {
    if (typeof path !== 'string' || !validateTreePath(path)) {
      return { ok: false, error: 'Invalid .tree file path' }
    }
    // A world that will not open still joins the space, as a frame carrying
    // its reason: silently refusing it would leave Kaelen with a file picker
    // that appeared to do nothing.
    return openIntoSpace(() => registry.tryOpen(path, { kind: 'native' }))
  })

  ipcMain.handle('trees:create', async (_event, path: unknown, worldName: unknown) => {
    if (typeof path !== 'string' || !validateTreePath(path)) {
      return { ok: false, error: 'Invalid .tree file path' }
    }
    if (typeof worldName !== 'string' || worldName.length === 0) {
      return { ok: false, error: 'A world needs a name' }
    }
    return openIntoSpace(() => registry.create(path, worldName, { kind: 'native' }))
  })

  /**
   * Take a tree out of the space. Its file and history stay on disk — this
   * closes a window onto a world, it does not end the world.
   */
  ipcMain.handle('trees:close', (_event, treeId: unknown) => {
    if (typeof treeId !== 'string') return { ok: false, error: 'Unknown tree' }
    try {
      const actor = getHumanActor()
      if (!space || !space.ready) throw new SpaceRefusal()
      const entry = registry.entry(treeId)
      if (!entry) return { ok: false, error: `Unknown tree ${treeId}` }

      // A workspace's chat goes with it: its process group is stopped and its
      // MCP config file (which holds the panel agent's token) is deleted, and
      // watching ends with the frame (02.7 D-06).
      if (entry.kind === 'workspace') {
        void chatService?.closeWorkspace(treeId).catch((err) => {
          console.error('[Main] could not close the workspace chat:', err)
        })
        workspaceServiceRef?.stopWatching(treeId)
      }

      // The forest first, while the registry entry still joins to its
      // stand-in. Deleting the stand-in deletes its placement, so the tree's
      // last position stays in the forest's history (2.6 D-01).
      space.removeMember(treeId, actor)
      registry.close(treeId)
      notifyTreesChanged()
      return { ok: true }
    } catch (err) {
      return spaceFailure(err)
    }
  })

  /**
   * Show a tree's file in Finder (UI-SPEC "Tree options > Show in Finder").
   *
   * The renderer names a tree by id and never by path: the path is read from
   * the registry, so this cannot be aimed at an arbitrary file on disk
   * (T-02.2-30). An id that names nothing in the space is refused.
   */
  ipcMain.handle('trees:reveal', (_event, treeId: unknown) => {
    if (typeof treeId !== 'string') return { ok: false, error: 'Unknown tree' }
    const tree = registry.entry(treeId)
    if (!tree) return { ok: false, error: `Unknown tree ${treeId}` }

    shell.showItemInFolder(tree.path)
    return { ok: true }
  })

  /**
   * Try a tree that would not open again (UI-SPEC "Reopen tree").
   *
   * Kaelen's action rather than a retry loop: the cause — another Tapestry
   * holding the lock, a file being put back — is outside this process, so
   * polling for it would only burn cycles being wrong (T-02.2-31).
   */
  ipcMain.handle('trees:reopen', (_event, treeId: unknown) => {
    if (typeof treeId !== 'string') return { ok: false, error: 'Unknown tree' }

    try {
      // Through the space, so a first successful open records the member's
      // identity, and a duplicate it reveals is folded (2.6 D-03).
      const tree = space ? space.reopenMember(treeId) : registry.reopen(treeId)
      if (!tree) return { ok: false, error: `Unknown tree ${treeId}` }
      notifyTreesChanged()
      return { ok: true, treeId: tree.id }
    } catch (err) {
      // The retry itself failed in a way that is about the space (the same
      // world is already open elsewhere): the list still changed.
      notifyTreesChanged()
      return { ok: false, error: errorMessage(err) }
    }
  })

  /**
   * The renderer's automatic correction of a frame it found crowding a
   * neighbour when first measured (2.6 D-12). Signed by the system, never the
   * person; the service writes only when the origin changes, at most once per
   * member per session, and never over a frame the person moved (T-2.6-01).
   * Needs no name, since the person is not signing it.
   *
   * Deliberately does not emit 'trees-changed': the renderer already has the
   * position it just sent.
   */
  ipcMain.handle('trees:fitFrame', (_event, treeId: unknown, x: unknown, y: unknown) => {
    try {
      if (!space || !space.ready) return { ok: false, error: SPACE_NOT_OPEN }
      const { committed } = space.fitFrame(treeId, x, y)
      return { ok: true, committed }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  // -------------------------------------------------------------------------
  // Obsidian vault IPC (D-10, D-13): a vault folder becomes its own tree
  // -------------------------------------------------------------------------

  /**
   * The bridge runs here, in main, rather than as a plugin: it needs the
   * filesystem and the reserved `obsidian.bridge` actor a plugin may not claim.
   */
  vaultService = new VaultService(registry, {
    onStatus: (treeId, status) => {
      mainWindow?.webContents.send('vault-status', { treeId, ...status })
    },
    // Its commits did not come from the renderer, so the canvas is told the
    // same way an agent's commits tell it.
    onCommitted: (treeId) => {
      mainWindow?.webContents.send('tree-changed', treeId)
    },
  })

  ipcMain.handle('dialog:showOpenVaultFolder', async () => {
    if (!mainWindow) return { canceled: true, folderPath: undefined }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an Obsidian vault folder',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, folderPath: undefined }
    }
    const folderPath = resolve(result.filePaths[0])
    approvedVaultRoots.add(folderPath)
    return { canceled: false, folderPath }
  })

  /**
   * Mirror a vault as a tree (D-10). The confirmation dialog the UI-SPEC
   * describes, and restoring vault trees at launch, are Plan 08.
   */
  ipcMain.handle('vault:add', async (_event, root: unknown) => {
    if (!isWellFormedVaultRoot(root)) {
      return { ok: false, error: 'Invalid vault folder path' }
    }
    const target = resolve(root)
    if (!approvedVaultRoots.has(target)) {
      return { ok: false, error: 'Choose the vault folder with Add Obsidian Vault... first.' }
    }

    // Assigned above in this same startup; guarded so a reordering fails
    // soft (02.3 D-25 reads the binding by reference for the thread flush).
    const vaults = vaultService
    if (!vaults) return { ok: false, error: 'Vault service is not ready yet' }
    return openIntoSpace(() => vaults.addVault(target))
  })

  /** A watcher that cannot start must never fail adding or restoring a workspace. */
  function startWatchingSafely(treeId: string): void {
    try {
      workspaceService.startWatching(treeId)
    } catch (err) {
      console.error('[Main] could not watch the workspace:', err)
    }
  }

  ipcMain.handle('dialog:showOpenWorkspaceFolder', async () => {
    if (!mainWindow) return { canceled: true, folderPath: undefined }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a workspace folder',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, folderPath: undefined }
    }
    const folderPath = resolve(result.filePaths[0])
    approvedWorkspaceRoots.add(folderPath)
    return { canceled: false, folderPath }
  })

  /** Add a workspace folder as a tree (02.7 D-01). */
  ipcMain.handle('workspace:add', async (_event, root: unknown) => {
    if (!isWellFormedVaultRoot(root)) {
      return { ok: false, error: 'Invalid workspace folder path' }
    }
    const target = resolve(root)
    if (!approvedWorkspaceRoots.has(target)) {
      return { ok: false, error: 'Choose the folder with Add Workspace Folder... first.' }
    }
    // Recorded in the forest like any other member (2.6 D-01); its frame is
    // a placement edge there, never a settings entry.
    const result = await openIntoSpace(() => workspaceService.addWorkspace(target))
    // From now on, outside changes are recorded within moments (D-06).
    if (result.ok) startWatchingSafely(result.treeId)
    return result
  })

  /**
   * A person's edit in a file window (02.7 D-04, D-05). The renderer sends
   * only ids, the text and the hash it started from; the path comes from the
   * note, and the actor is main's (T-02.7-07).
   */
  ipcMain.handle(
    'workspace:saveFile',
    async (_event, treeId: unknown, nodeId: unknown, text: unknown, baseSha256: unknown) => {
      if (typeof treeId !== 'string' || !TREE_ID_PATTERN.test(treeId)) {
        return { ok: false, error: 'Invalid tree id' }
      }
      if (typeof nodeId !== 'string' || !NODE_ID_PATTERN.test(nodeId)) {
        return { ok: false, error: 'Invalid note id' }
      }
      if (typeof text !== 'string') return { ok: false, error: 'text must be a string' }
      if (baseSha256 !== null && (typeof baseSha256 !== 'string' || !SHA256_PATTERN.test(baseSha256))) {
        return { ok: false, error: 'Invalid base hash' }
      }
      let actor: Actor
      try {
        actor = getHumanActor()
      } catch (err) {
        return { ok: false, error: errorMessage(err) }
      }
      return workspaceService.saveFile(actor, treeId, nodeId, text, baseSha256)
    },
  )

  /** Current watching statuses, for a renderer that loaded after they were sent. */
  ipcMain.handle('workspace:statuses', () => workspaceService.allStatuses())

  // Save dialog for creating new .tree files
  ipcMain.handle('dialog:showSave', async () => {
    if (!mainWindow) return { canceled: true, filePath: undefined }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Create New World',
      defaultPath: 'untitled.tree',
      filters: [{ name: 'Tapestry World', extensions: ['tree'] }],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true, filePath: undefined }
    }
    // Normalize to the .tree extension (not every platform's dialog appends
    // the filter extension) and approve the user's choice so trees:create
    // accepts exactly the path the dialog returned.
    let filePath = resolve(result.filePath)
    if (!filePath.endsWith('.tree')) filePath = `${filePath}.tree`
    approvedPaths.add(filePath)
    return { canceled: false, filePath }
  })

  // Open dialog for adding an existing world to the space
  ipcMain.handle('dialog:showOpenTree', async () => {
    if (!mainWindow) return { canceled: true, filePath: undefined }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Tapestry World',
      properties: ['openFile'],
      filters: [{ name: 'Tapestry World', extensions: ['tree'] }],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, filePath: undefined }
    }
    // Approve exactly what the user picked, so trees:open accepts a world
    // deliberately chosen outside home (the same rule dialog:showSave uses).
    const filePath = resolve(result.filePaths[0])
    approvedPaths.add(filePath)
    return { canceled: false, filePath }
  })

  // Create the window first: reopening worlds replays their journals, and
  // that work should happen behind a window rather than before one.
  createWindow()

  // -------------------------------------------------------------------------
  // Open the space (2.6 D-02): the Tapestry tree, its forest, and every member
  // -------------------------------------------------------------------------

  // On first launch this imports the settings arrangement into the forest
  // (D-10); afterwards it reopens from the settings pointer. A tree that has
  // been moved, deleted or damaged comes back as an unavailable frame holding
  // its reason. A space that cannot open writes nothing and opens no member
  // (D-14); the window asks for the problem through `trees:spaceProblem`.
  try {
    await space.start()
    const problem = space.problemNotice()
    if (problem !== null) {
      console.error('[Main] space did not open:', problem)
    }
  } catch (err) {
    console.error('[Main] space did not open:', err)
  }

  // Plugin problems must not be mistaken for a missing world (D-33)
  await loadPluginsSafely()

  if (mainWindow) {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', notifyTreesChanged)
    } else {
      notifyTreesChanged()
    }
  }
})

// macOS: re-create window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Release every kernel (and its journal lock) deterministically at exit so a
// relaunched instance can reopen the same world immediately, and remove the
// agent socket so a stale file does not outlive the app.
app.on('will-quit', () => {
  // No chat process may outlive Tapestry. disposeAll sends SIGTERM to each
  // chat's process group at once, but will-quit cannot wait for it, so every
  // group is then killed synchronously as the last resort, and the MCP config
  // files holding the panel's token are deleted.
  if (chatService) {
    void chatService.disposeAll()
    chatService.killAllNow()
    chatService = null
  }
  // Flush every open thread's pending batch and checkpoint before the
  // journal locks are released below -- a clean quit should lose nothing.
  threadService?.closeAll()
  if (agentServer) {
    void agentServer.close()
    agentServer = null
  }
  // No watcher may fire into a kernel that is being closed.
  workspaceServiceRef?.stopAll()
  workspaceServiceRef = null
  // The forest and the Tapestry tree first, so every journal lock is released
  // and the next launch can open the space.
  space?.close()
  registry.closeAll()
})
