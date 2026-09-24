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
import { AgentRegistry, agentSocketPath } from './agents/registry'
import { AgentSocketServer } from './agents/socket-server'
import { SpaceService } from './space/space-service'
import { SPACE_NOT_OPEN, problemMessage, type SpacePaths } from './space/migrate'
import { FOREST_FILE, HOME_FILE, HOME_LOCATION } from './space/shapes'

// ---------------------------------------------------------------------------
// Plugin surface scheme (CANV-04)
// ---------------------------------------------------------------------------

// Must run before app 'ready': Electron refuses privileged-scheme
// registration afterwards. The handler itself is attached inside whenReady,
// once the plugins directory is known.
protocol.registerSchemesAsPrivileged([{ scheme: PLUGIN_SCHEME, privileges: SCHEME_PRIVILEGES }])

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
  KernelBridge.registerHandlers(ipcMain, resolveTree, getHumanActor)

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

  const agentCommands: AgentCommands = {
    notes: new NoteCommands(registry, commandHooks),
    connections: new ConnectionCommands(registry, commandHooks),
    spatial: new SpatialCommands(registry, commandHooks),
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
  // membership there too (Plan 04); only `trees:setFrame` still writes the old
  // settings list, until Plan 05.
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
    },
  })

  /**
   * Open or create a tree, then record it in the forest (2.6 D-01, D-02).
   *
   * The actor is resolved before anything opens (RESEARCH "Name-before-commit
   * gap", answer 2.7): the forest commit is signed by the person, so without a
   * name nothing is opened at all. If the forest cannot record a tree that
   * this call opened, it is closed again, so the registry and the forest never
   * disagree about what is in the space (T-2.6-24).
   */
  async function openIntoSpace(open: () => TreeEntry | Promise<TreeEntry>): Promise<
    { ok: true; treeId: string } | { ok: false; error: string }
  > {
    try {
      const actor = getHumanActor()
      if (!space || !space.ready) return { ok: false, error: SPACE_NOT_OPEN }
      const before = new Set(registry.summary().map((t) => t.id))
      const tree = await open()
      try {
        // A vault's first read is awaited above, so the space may have been
        // closed by a quit in the meantime.
        if (!space) throw new Error(SPACE_NOT_OPEN)
        space.addMember(tree, actor)
      } catch (err) {
        if (!before.has(tree.id)) registry.close(tree.id)
        throw err
      }
      notifyTreesChanged()
      return { ok: true, treeId: tree.id }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }

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
      if (!space || !space.ready) return { ok: false, error: SPACE_NOT_OPEN }
      if (!registry.entry(treeId)) return { ok: false, error: `Unknown tree ${treeId}` }

      // The forest first, while the registry entry still joins to its
      // stand-in. Deleting the stand-in deletes its placement, so the tree's
      // last position stays in the forest's history (2.6 D-01).
      space.removeMember(treeId, actor)
      registry.close(treeId)
      notifyTreesChanged()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
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
   * Persist a frame position (D-18).
   *
   * Deliberately does not emit 'trees-changed': the renderer already has the
   * position it just sent, and echoing it back would refresh every tree on
   * every drop.
   */
  ipcMain.handle('trees:setFrame', (_event, treeId: unknown, x: unknown, y: unknown) => {
    if (typeof treeId !== 'string') return { ok: false, error: 'Unknown tree' }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: 'A frame position must be two finite numbers' }
    }
    const tree = registry.get(treeId)
    if (!tree) return { ok: false, error: `Unknown tree ${treeId}` }

    settings.setTreeFrame(tree.path, { x: x as number, y: y as number })
    return { ok: true }
  })

  // -------------------------------------------------------------------------
  // Obsidian vault IPC (D-10, D-13): a vault folder becomes its own tree
  // -------------------------------------------------------------------------

  /**
   * The bridge runs here, in main, rather than as a plugin: it needs the
   * filesystem and the reserved `obsidian.bridge` actor a plugin may not claim.
   */
  const vaultService = new VaultService(registry, {
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

    return openIntoSpace(() => vaultService.addVault(target))
  })

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
  // (D-14); Plan 06 shows the problem in the window.
  try {
    const started = await space.start()
    if (started.problem) {
      console.error('[Main] space did not open:', problemMessage(started.problem))
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
  if (agentServer) {
    void agentServer.close()
    agentServer = null
  }
  // The forest and the Tapestry tree first, so every journal lock is released
  // and the next launch can open the space.
  space?.close()
  registry.closeAll()
})
