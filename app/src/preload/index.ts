/**
 * Electron preload script — exposes the tapestry API to the renderer
 * via contextBridge.exposeInMainWorld().
 *
 * Security: T-02-03 mitigated — the renderer has no direct Node.js access.
 * All kernel operations go through typed IPC invoke calls.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { ChatEvent } from '../main/chat/engine'

/** Every chat call answers like this. */
type ChatResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** What the panel needs to show a workspace's chat. */
interface ChatOpenState {
  workspace: string
  sessionId: string | null
  transcript: ChatEvent[]
  busy: boolean
  resumed: boolean
  allowShell: boolean
}

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
   * The trees in the space and where their frames sit (D-15).
   *
   * The arrangement lives in the forest tree, a readable `Forest.tree` that
   * the Tapestry tree references (2.6 D-01): each frame is a placement edge
   * there, and a move is a signed commit rather than a settings write.
   */
  trees: {
    list: (): Promise<
      Array<{
        id: string
        name: string
        kind: 'native' | 'vault' | 'workspace'
        path: string
        vaultRoot?: string
        workspaceRoot?: string
        frame: { x: number; y: number }
      }>
    > => ipcRenderer.invoke('trees:list'),

    /** `notice`, when present, is an approved refusal to show verbatim (4.9, 4.10). */
    open: (
      path: string,
    ): Promise<{ ok: boolean; treeId?: string; error?: string; notice?: string }> =>
      ipcRenderer.invoke('trees:open', path),

    create: (
      path: string,
      worldName: string,
    ): Promise<{ ok: boolean; treeId?: string; error?: string; notice?: string }> =>
      ipcRenderer.invoke('trees:create', path, worldName),

    close: (treeId: string): Promise<{ ok: boolean; error?: string; notice?: string }> =>
      ipcRenderer.invoke('trees:close', treeId),

    /** Why the space did not open, in the approved wording, or null (4.1-4.8). */
    spaceProblem: (): Promise<{ message: string | null }> =>
      ipcRenderer.invoke('trees:spaceProblem'),

    /** Show the tree's `.tree` file in Finder. Main resolves the path. */
    reveal: (treeId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('trees:reveal', treeId),

    /** Try a damaged, locked or missing tree again, once its cause is gone. */
    reopen: (treeId: string): Promise<{ ok: boolean; treeId?: string; error?: string }> =>
      ipcRenderer.invoke('trees:reopen', treeId),

    /**
     * An automatic correction, recorded by the system only when it moves the
     * frame (D-12). Main signs it; no actor is sent.
     */
    fitFrame(
      treeId: string,
      x: number,
      y: number,
    ): Promise<{ ok: boolean; committed?: boolean; error?: string }> {
      return ipcRenderer.invoke('trees:fitFrame', treeId, x, y)
    },

    /** One drop, with every frame it pushed aside, is one forest commit (D-11). */
    moveFrames: (
      moves: Array<{ treeId: string; x: number; y: number }>,
    ): Promise<{ ok: boolean; committed?: boolean; error?: string }> =>
      ipcRenderer.invoke('trees:moveFrames', moves),

    /** Put the last drop back as a new signed forest commit, never a rewind (D-08, D-09). */
    undoFrames: (): Promise<{
      ok: boolean
      committed?: boolean
      undoable?: number
      redoable?: number
      error?: string
    }> => ipcRenderer.invoke('trees:undoFrames'),

    /** Put an undone drop forward again as a new signed forest commit (D-08, D-09). */
    redoFrames: (): Promise<{
      ok: boolean
      committed?: boolean
      undoable?: number
      redoable?: number
      error?: string
    }> => ipcRenderer.invoke('trees:redoFrames'),
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

    /** Pick an Obsidian vault folder to mirror as a tree (D-10, D-13). */
    showOpenVaultFolder: (): Promise<{ canceled: boolean; folderPath?: string }> =>
      ipcRenderer.invoke('dialog:showOpenVaultFolder'),
    /** Pick a workspace folder to mirror as a tree (02.7 D-01). */
    showOpenWorkspaceFolder: (): Promise<{ canceled: boolean; folderPath?: string }> =>
      ipcRenderer.invoke('dialog:showOpenWorkspaceFolder'),
  },

  /**
   * Mirroring an Obsidian vault (D-10, D-13).
   *
   * The renderer names a folder the user just picked in the dialog; main
   * refuses any other root, creates `<vault>/<name>.tree` and catches up.
   */
  vault: {
    add: (
      root: string,
    ): Promise<{ ok: boolean; treeId?: string; error?: string; notice?: string }> =>
      ipcRenderer.invoke('vault:add', root),
  },

  /**
   * Workspace folders (02.7): add one the user just picked, and save a
   * person's edit from a file window. Main takes the path from the note.
   */
  workspace: {
    add: (root: string): Promise<{ ok: boolean; treeId?: string; error?: string }> =>
      ipcRenderer.invoke('workspace:add', root),
    saveFile: (
      treeId: string,
      nodeId: string,
      text: string,
      baseSha256: string | null,
    ): Promise<
      | {
          ok: true
          value: {
            note: string
            path: string
            written: boolean
            fileWins: boolean
            sha256: string | null
            seq: number
          }
        }
      | { ok: false; error: string }
    > => ipcRenderer.invoke('workspace:saveFile', treeId, nodeId, text, baseSha256),
    /** Every open workspace's current watching status, for a renderer that loaded late. */
    statuses: (): Promise<
      Array<
        | { treeId: string; kind: 'watching' }
        | { treeId: string; kind: 'not-watching'; reason: string }
        | { treeId: string; kind: 'folder-missing' }
      >
    > => ipcRenderer.invoke('workspace:statuses'),
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
   * The in-app chat for a workspace (02.7 D-12). Every call names the
   * workspace's tree; main owns the process, the token and the config file,
   * none of which ever reach the renderer.
   */
  chat: {
    open: (treeId: string): Promise<ChatResult<ChatOpenState>> => ipcRenderer.invoke('chat:open', treeId),
    send: (treeId: string, text: string): Promise<ChatResult<null>> =>
      ipcRenderer.invoke('chat:send', treeId, text),
    stop: (treeId: string): Promise<ChatResult<null>> => ipcRenderer.invoke('chat:stop', treeId),
    newChat: (treeId: string): Promise<ChatResult<null>> => ipcRenderer.invoke('chat:new', treeId),
    /** The chat's Allow shell (not sandboxed) switch (D-15), from the next message. */
    setAllowShell: (treeId: string, on: boolean): Promise<ChatResult<null>> =>
      ipcRenderer.invoke('chat:setAllowShell', treeId, on),
  },

  /** Something happened in a workspace's chat. */
  onChatEvent: (callback: (payload: { treeId: string; event: ChatEvent }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: { treeId: string; event: ChatEvent }) => {
      callback(payload)
    }
    ipcRenderer.on('chat-event', handler)
    return () => ipcRenderer.removeListener('chat-event', handler)
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
   * Progress while a vault is being read or caught up (D-20).
   *
   * Reading a vault takes long enough to need saying so, and "up-to-date" is
   * the only honest way to end the sentence it starts.
   */
  onVaultStatus: (
    callback: (status: {
      treeId: string
      kind: 'reading' | 'catching-up' | 'up-to-date'
      done: number
      total: number
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      payload: {
        treeId: string
        kind: 'reading' | 'catching-up' | 'up-to-date'
        done: number
        total: number
      },
    ) => {
      callback(payload)
    }
    ipcRenderer.on('vault-status', handler)
    return () => ipcRenderer.removeListener('vault-status', handler)
  },

  /**
   * A workspace started or stopped recording outside changes, or its folder
   * went missing (02.7 D-06). The frame header says which.
   */
  onWorkspaceStatus: (
    callback: (
      status:
        | { treeId: string; kind: 'watching' }
        | { treeId: string; kind: 'not-watching'; reason: string }
        | { treeId: string; kind: 'folder-missing' },
    ) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      payload:
        | { treeId: string; kind: 'watching' }
        | { treeId: string; kind: 'not-watching'; reason: string }
        | { treeId: string; kind: 'folder-missing' },
    ) => {
      callback(payload)
    }
    ipcRenderer.on('workspace-status', handler)
    return () => ipcRenderer.removeListener('workspace-status', handler)
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
   * An agent asked to show a workspace file (open_file, 02.7 SC2): pan to its
   * note and open its window.
   */
  onRevealNote: (callback: (payload: { treeId: string; noteId: string }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: { treeId: string; noteId: string }) => {
      callback(payload)
    }
    ipcRenderer.on('reveal-note', handler)
    return () => ipcRenderer.removeListener('reveal-note', handler)
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
}

contextBridge.exposeInMainWorld('tapestry', tapestryAPI)

// ---------------------------------------------------------------------------
// Type declaration for the renderer
// ---------------------------------------------------------------------------

export type TapestryAPI = typeof tapestryAPI
