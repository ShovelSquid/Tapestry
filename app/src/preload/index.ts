/**
 * Electron preload script — exposes the tapestry API to the renderer
 * via contextBridge.exposeInMainWorld().
 *
 * Security: T-02-03 mitigated — the renderer has no direct Node.js access.
 * All kernel operations go through typed IPC invoke calls.
 */

import { contextBridge, ipcRenderer } from 'electron'

// ---------------------------------------------------------------------------
// Tapestry API exposed to the renderer
// ---------------------------------------------------------------------------

const tapestryAPI = {
  kernel: {
    create: (path: string, worldName: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('kernel:create', path, worldName),

    open: (path: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('kernel:open', path),

    submit: (
      actorKind: string,
      actorId: string,
      message: string,
      ops: any[],
    ): Promise<any> =>
      ipcRenderer.invoke('kernel:submit', actorKind, actorId, message, ops),

    getNodes: (): Promise<any[]> =>
      ipcRenderer.invoke('kernel:getNodes'),

    getNode: (id: string): Promise<any> =>
      ipcRenderer.invoke('kernel:getNode', id),

    getEdges: (): Promise<any[]> =>
      ipcRenderer.invoke('kernel:getEdges'),

    status: (): Promise<any> =>
      ipcRenderer.invoke('kernel:status'),

    getFilePath: (): Promise<string | null> =>
      ipcRenderer.invoke('kernel:getFilePath'),
  },

  plugins: {
    list: (): Promise<any[]> =>
      ipcRenderer.invoke('plugin:list'),

    getContributions: (): Promise<any> =>
      ipcRenderer.invoke('plugin:getContributions'),

    reload: (name: string): Promise<any> =>
      ipcRenderer.invoke('plugin:reload', name),

    enable: (name: string): Promise<any> =>
      ipcRenderer.invoke('plugin:enable', name),

    disable: (name: string): Promise<any> =>
      ipcRenderer.invoke('plugin:disable', name),

    executeCommand: (commandId: string, args?: Record<string, unknown>): Promise<any> =>
      ipcRenderer.invoke('plugin:executeCommand', commandId, args || {}),
  },

  dialog: {
    showSave: (): Promise<{ canceled: boolean; filePath?: string }> =>
      ipcRenderer.invoke('dialog:showSave'),
  },

  /**
   * Listen for file-opened events from the main process
   * (e.g. when reopening the last file on launch).
   */
  onFileOpened: (callback: (filePath: string) => void): void => {
    ipcRenderer.on('file-opened', (_event, filePath) => {
      callback(filePath)
    })
  },

  /**
   * Listen for plugin error events from the main process (D-34).
   * Receives plugin display name, error message, and whether restart is available.
   */
  onPluginError: (callback: (pluginName: string, message: string, canRestart: boolean) => void): void => {
    ipcRenderer.on('plugin-error', (_event, pluginName, message, canRestart) => {
      callback(pluginName, message, canRestart)
    })
  },
}

contextBridge.exposeInMainWorld('tapestry', tapestryAPI)

// ---------------------------------------------------------------------------
// Type declaration for the renderer
// ---------------------------------------------------------------------------

export type TapestryAPI = typeof tapestryAPI
