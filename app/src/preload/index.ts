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
}

contextBridge.exposeInMainWorld('tapestry', tapestryAPI)

// ---------------------------------------------------------------------------
// Type declaration for the renderer
// ---------------------------------------------------------------------------

export type TapestryAPI = typeof tapestryAPI
