/**
 * Electron preload script — exposes the tapestry API to the renderer
 * via contextBridge.exposeInMainWorld().
 *
 * Security: T-02-03 mitigated — the renderer has no direct Node.js access.
 * All kernel operations go through typed IPC invoke calls.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

// ---------------------------------------------------------------------------
// Tapestry API exposed to the renderer
// ---------------------------------------------------------------------------

const tapestryAPI = {
  /**
   * Kernel operations, each naming its tree first (D-15).
   *
   * Several trees are open at once, so there is no "current world" for the
   * main process to infer — the caller says which tree it means, and an id
   * that is not open is refused.
   */
  kernel: {
    /**
     * Submit a commit to one tree. No actor is sent: the main process stamps
     * `human user.<name>` from the stored settings (D-06/D-07).
     */
    submit: (treeId: string, message: string, ops: any[]): Promise<any> =>
      ipcRenderer.invoke('kernel:submit', treeId, message, ops),

    getNodes: (treeId: string): Promise<any[]> =>
      ipcRenderer.invoke('kernel:getNodes', treeId),

    getNode: (treeId: string, id: string): Promise<any> =>
      ipcRenderer.invoke('kernel:getNode', treeId, id),

    getEdges: (treeId: string): Promise<any[]> =>
      ipcRenderer.invoke('kernel:getEdges', treeId),

    status: (treeId: string): Promise<any> =>
      ipcRenderer.invoke('kernel:status', treeId),

    /** Who created and last changed each node, derived from the journal. */
    getHistoryIndex: (treeId: string): Promise<any> =>
      ipcRenderer.invoke('kernel:getHistoryIndex', treeId),

    undo: (treeId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('kernel:undo', treeId),

    redo: (treeId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('kernel:redo', treeId),
  },

  /**
   * The trees in the space and where their frames sit (D-15, D-18).
   *
   * There is no forest file: `open`, `create` and `close` change both the open
   * set and what the next launch restores.
   */
  trees: {
    list: (): Promise<
      Array<{
        id: string
        name: string
        kind: 'native' | 'vault'
        path: string
        vaultRoot?: string
        frame: { x: number; y: number }
      }>
    > => ipcRenderer.invoke('trees:list'),

    open: (path: string): Promise<{ ok: boolean; treeId?: string; error?: string }> =>
      ipcRenderer.invoke('trees:open', path),

    create: (
      path: string,
      worldName: string,
    ): Promise<{ ok: boolean; treeId?: string; error?: string }> =>
      ipcRenderer.invoke('trees:create', path, worldName),

    close: (treeId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('trees:close', treeId),

    setFrame: (
      treeId: string,
      x: number,
      y: number,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('trees:setFrame', treeId, x, y),
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

    executeCommand: (
      commandId: string,
      args?: Record<string, unknown>,
      selectedNodes?: string[],
    ): Promise<any> =>
      ipcRenderer.invoke('plugin:executeCommand', commandId, args || {}, selectedNodes || []),
  },

  dialog: {
    showSave: (): Promise<{ canceled: boolean; filePath?: string }> =>
      ipcRenderer.invoke('dialog:showSave'),

    /** Pick an existing world to add to the space. */
    showOpenTree: (): Promise<{ canceled: boolean; filePath?: string }> =>
      ipcRenderer.invoke('dialog:showOpenTree'),
  },

  settings: {
    /** The stored name, plus a suggestion for the first-run prompt. */
    getUserName: (): Promise<{ userName: string | null; suggested: string }> =>
      ipcRenderer.invoke('settings:getUserName'),

    setUserName: (name: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:setUserName', name),
  },

  /**
   * Connecting, listing and removing agents (D-03, D-06).
   *
   * `create` returns the whole `claude mcp add` command with the token in it,
   * once. Only the token's digest is stored, so the renderer showing it is the
   * only chance anyone has to copy it.
   */
  agents: {
    list: (): Promise<
      Array<{
        name: string
        createdAt: string
        connected: boolean
        lastConnectedAt: string | null
      }>
    > => ipcRenderer.invoke('agents:list'),

    create: (
      name: string,
    ): Promise<{ ok: true; name: string; command: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('agents:create', name),

    remove: (name: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('agents:remove', name),

    getEnabled: (): Promise<boolean> => ipcRenderer.invoke('agents:getEnabled'),

    setEnabled: (enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('agents:setEnabled', enabled),
  },

  /**
   * Thread editing (D-06, D-09): the collab push/pull surface for the single
   * write authority in main. No actor argument on `push` -- the main process
   * stamps `human user.<name>` from the stored settings, exactly like
   * `kernel.submit`.
   */
  thread: {
    open: (treeId: string, nodeId: string): Promise<any> => ipcRenderer.invoke('thread:open', treeId, nodeId),

    push: (
      treeId: string,
      nodeId: string,
      version: number,
      steps: unknown[],
      times: number[],
      causes: (string | null)[],
    ): Promise<any> => ipcRenderer.invoke('thread:push', treeId, nodeId, version, steps, times, causes),

    close: (treeId: string, nodeId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('thread:close', treeId, nodeId),
  },

  /**
   * Listen for changes to the set of open trees — one opened, one closed, or
   * the space restored at launch. Carries no payload: the renderer re-reads
   * the list, so it can never hold half an update.
   */
  onTreesChanged: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }
    ipcRenderer.on('trees-changed', handler)
    return () => ipcRenderer.removeListener('trees-changed', handler)
  },

  /**
   * Listen for commits that landed from outside the renderer — an agent
   * through the MCP bridge, or a plugin. Carries the id of the tree that
   * changed so the canvas can refresh.
   */
  onTreeChanged: (callback: (treeId: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, treeId: string) => {
      callback(treeId)
    }
    ipcRenderer.on('tree-changed', handler)
    return () => ipcRenderer.removeListener('tree-changed', handler)
  },

  /**
   * Listen for changes to the agent list or their connection status, so the
   * Agents panel updates live without polling.
   */
  onAgentsChanged: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }
    ipcRenderer.on('agents-changed', handler)
    return () => ipcRenderer.removeListener('agents-changed', handler)
  },

  /**
   * An agent's write returned a rewound tree to its latest state, so the redo
   * Kaelen could have used is gone (UA-14).
   */
  onRedoDiscarded: (
    callback: (event: { treeId: string; treeName: string; actorId: string }) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      payload: { treeId: string; treeName: string; actorId: string },
    ) => {
      callback(payload)
    }
    ipcRenderer.on('redo-discarded', handler)
    return () => ipcRenderer.removeListener('redo-discarded', handler)
  },

  /**
   * Listen for plugin error events from the main process (D-34).
   * Receives the plugin id (for reload/enable/disable), its display name,
   * the error message, and whether restart is available.
   */
  onPluginError: (
    callback: (pluginName: string, displayName: string, message: string, canRestart: boolean) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      pluginName: string,
      displayName: string,
      message: string,
      canRestart: boolean,
    ) => {
      callback(pluginName, displayName, message, canRestart)
    }
    ipcRenderer.on('plugin-error', handler)
    return () => ipcRenderer.removeListener('plugin-error', handler)
  },

  /**
   * A thread's pending batch was durably committed (D-06). Fired for every
   * open window watching that thread, not just the one that typed the
   * letters -- the overlay uses this to retire "Saving…" to "Saved".
   */
  onThreadConfirmed: (callback: (treeId: string, nodeId: string, version: number) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, treeId: string, nodeId: string, version: number) => {
      callback(treeId, nodeId, version)
    }
    ipcRenderer.on('thread:confirmed', handler)
    return () => ipcRenderer.removeListener('thread:confirmed', handler)
  },

  /**
   * A thread's flush was refused (T-02.3-02-06): the batch stays pending and
   * keeps retrying, but the overlay must show "Not saved" rather than
   * implying the letters are safely on disk.
   */
  onThreadFlushError: (callback: (treeId: string, nodeId: string, reason: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, treeId: string, nodeId: string, reason: string) => {
      callback(treeId, nodeId, reason)
    }
    ipcRenderer.on('thread:flush-error', handler)
    return () => ipcRenderer.removeListener('thread:flush-error', handler)
  },
}

contextBridge.exposeInMainWorld('tapestry', tapestryAPI)

// ---------------------------------------------------------------------------
// Type declaration for the renderer
// ---------------------------------------------------------------------------

export type TapestryAPI = typeof tapestryAPI
