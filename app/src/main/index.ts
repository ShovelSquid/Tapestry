/**
 * Electron main process entry point.
 *
 * Creates the BrowserWindow with secure settings (nodeIntegration: false,
 * contextIsolation: true), registers IPC handlers via KernelBridge and
 * PluginHost, and handles app lifecycle events.
 *
 * Security: T-02-03 mitigated — renderer has no direct Node.js access.
 * All kernel access goes through the contextBridge preload.
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { KernelBridge } from './kernel-bridge'
import { PluginHost } from './plugin-host'

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
    if (data.path && existsSync(data.path)) {
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

function validateTreePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false

  const normalized = resolve(filePath)
  if (!normalized.endsWith('.tree')) return false

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

let bridge: KernelBridge
let pluginHost: PluginHost
let currentFilePath: string | null = null

/**
 * Discover and load plugins for the currently open world without letting a
 * plugin failure surface as a world-open failure (D-33: a broken plugin never
 * prevents the world from opening).
 */
async function loadPluginsSafely(): Promise<void> {
  try {
    await pluginHost.discoverAndLoadAll(bridge)
  } catch (err) {
    console.error('[Main] Plugin discovery failed:', err)
  }
}

app.whenReady().then(async () => {
  // Register kernel IPC handlers
  bridge = KernelBridge.registerHandlers(ipcMain)

  // Discover and load plugins
  const pluginsDir = join(app.getAppPath(), '..', 'plugins')
  pluginHost = new PluginHost(pluginsDir)

  // Register plugin IPC handlers
  PluginHost.registerHandlers(ipcMain, pluginHost)

  // Wire plugin error notifications to the renderer (D-34)
  pluginHost.onPluginError = (pluginName: string, message: string, canRestart: boolean) => {
    if (mainWindow) {
      mainWindow.webContents.send('plugin-error', pluginName, message, canRestart)
    }
  }

  // Register file-management IPC handlers
  ipcMain.handle('kernel:getFilePath', () => {
    return currentFilePath
  })

  // Override kernel:create to track file path and discover plugins
  ipcMain.removeHandler('kernel:create')
  ipcMain.handle('kernel:create', async (_event, path: string, worldName: string) => {
    if (!validateTreePath(path)) {
      throw new Error('Invalid .tree file path')
    }
    bridge.create(path, worldName)
    currentFilePath = path
    writeLastOpened(path)
    await loadPluginsSafely()
    return { ok: true }
  })

  // Override kernel:open to track file path and discover plugins
  ipcMain.removeHandler('kernel:open')
  ipcMain.handle('kernel:open', async (_event, path: string) => {
    if (!validateTreePath(path)) {
      throw new Error('Invalid .tree file path')
    }
    bridge.open(path)
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
    return { canceled: result.canceled, filePath: result.filePath }
  })

  // Create the window
  createWindow()

  // Try to reopen the last file (D-03)
  const lastFile = readLastOpened()
  if (lastFile) {
    // Open the kernel first; only a kernel failure means "no file loaded".
    let opened = false
    try {
      bridge.open(lastFile)
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
