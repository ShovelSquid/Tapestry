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

import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { userInfo } from 'os'
import { KernelBridge } from './kernel-bridge'
import { PluginHost } from './plugin-host'
import { SettingsStore, suggestUserName } from './settings'
import { agentActor, humanActor, type Actor } from './commands/actor'
import { TreeRegistry, type OpenTree } from './trees/registry'
import { NoteCommands } from './commands/notes'
import { runAgentTool } from './commands/agent-tools'
import { AgentRegistry, agentSocketPath } from './agents/registry'
import { AgentSocketServer } from './agents/socket-server'

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
// Last-opened file persistence (D-03)
// ---------------------------------------------------------------------------

function getLastOpenedPath(): string {
  return join(app.getPath('userData'), 'last-opened.json')
}

function readLastOpened(): string | null {
  const filePath = getLastOpenedPath()
  if (!existsSync(filePath)) return null
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    // Apply the same well-formedness rules as the IPC validator; the home
    // restriction is not applied because the user may have chosen a location
    // outside home through the native dialog in an earlier session.
    if (isWellFormedTreePath(data.path) && existsSync(data.path)) {
      return data.path
    }
  } catch {
    // Corrupted or unreadable — treat as no last file
  }
  return null
}

function writeLastOpened(treePath: string): void {
  try {
    writeFileSync(getLastOpenedPath(), JSON.stringify({ path: treePath }), 'utf-8')
  } catch {
    // Non-critical — best effort
  }
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

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

/** Every open tree, keyed by the identity in its file (D-15). */
const registry = new TreeRegistry()

let pluginHost: PluginHost
let agentServer: AgentSocketServer | null = null
let currentFilePath: string | null = null

/** The tree the renderer acts on, or an error naming what to do about it. */
function requirePrimary(): OpenTree {
  const tree = registry.primary()
  if (!tree) {
    throw new Error('No kernel loaded — call create() or open() first')
  }
  return tree
}

/**
 * Keep exactly one tree open until Plan 05 introduces the frame view.
 *
 * The newly opened tree is adopted first and the previous one released after,
 * so a failed open leaves the current world untouched.
 */
function adoptAsOnlyTree(tree: OpenTree): void {
  for (const other of registry.list()) {
    if (other.id !== tree.id) registry.close(other.id)
  }
  registry.setPrimary(tree.id)
}

/**
 * Discover and load plugins for the currently open world without letting a
 * plugin failure surface as a world-open failure (D-33: a broken plugin never
 * prevents the world from opening).
 */
async function loadPluginsSafely(): Promise<void> {
  try {
    const tree = registry.primary()
    if (!tree) return
    await pluginHost.discoverAndLoadAll(tree.bridge)
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

  // Register kernel IPC handlers against whichever tree is primary.
  KernelBridge.registerHandlers(ipcMain, () => requirePrimary().bridge, getHumanActor)

  // Discover and load plugins
  const pluginsDir = join(app.getAppPath(), '..', 'plugins')
  pluginHost = new PluginHost(pluginsDir)
  // Commands know who asked for them; their commits are still signed by the
  // plugin (D-06).
  pluginHost.invokerActor = getHumanActor

  // Register plugin IPC handlers
  PluginHost.registerHandlers(ipcMain, pluginHost)

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
  const noteCommands = new NoteCommands(registry)

  agentServer = new AgentSocketServer({
    socketPath: agentSocketPath(app.getPath('userData')),
    agents,
    // The agent name comes from the verified token, never from the request.
    dispatch: (name, tool, args) => runAgentTool(noteCommands, agentActor(name), tool, args),
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

  await startAgentBridgeSafely()

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

  // Register file-management IPC handlers
  ipcMain.handle('kernel:getFilePath', () => {
    return currentFilePath
  })

  // kernel:create — validates the path, then opens through the registry.
  ipcMain.handle('kernel:create', async (_event, path: string, worldName: string) => {
    if (!validateTreePath(path)) {
      throw new Error('Invalid .tree file path')
    }
    const tree = registry.create(path, worldName)
    adoptAsOnlyTree(tree)
    currentFilePath = path
    writeLastOpened(path)
    await loadPluginsSafely()
    return { ok: true }
  })

  // kernel:open — same, for an existing world.
  ipcMain.handle('kernel:open', async (_event, path: string) => {
    if (!validateTreePath(path)) {
      throw new Error('Invalid .tree file path')
    }
    const tree = registry.open(path)
    adoptAsOnlyTree(tree)
    currentFilePath = path
    writeLastOpened(path)
    await loadPluginsSafely()
    return { ok: true }
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
    // the filter extension) and approve the user's choice so kernel:create
    // accepts exactly the path the dialog returned.
    let filePath = resolve(result.filePath)
    if (!filePath.endsWith('.tree')) filePath = `${filePath}.tree`
    approvedPaths.add(filePath)
    return { canceled: false, filePath }
  })

  // Create the window
  createWindow()

  // Try to reopen the last file (D-03)
  const lastFile = readLastOpened()
  if (lastFile) {
    // The restored path was chosen by the user in an earlier session
    approvedPaths.add(resolve(lastFile))
    // Open the kernel first; only a kernel failure means "no file loaded".
    let opened = false
    try {
      const tree = registry.open(lastFile)
      adoptAsOnlyTree(tree)
      currentFilePath = lastFile
      opened = true
    } catch {
      // D-03: if last file is missing/unreadable, show empty canvas
      currentFilePath = null
    }

    if (opened) {
      // Plugin problems must not be mistaken for a missing file (D-33)
      await loadPluginsSafely()
      if (mainWindow) {
        const sendFileOpened = () => mainWindow?.webContents.send('file-opened', lastFile)
        if (mainWindow.webContents.isLoading()) {
          mainWindow.webContents.once('did-finish-load', sendFileOpened)
        } else {
          sendFileOpened()
        }
      }
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
  registry.closeAll()
})
