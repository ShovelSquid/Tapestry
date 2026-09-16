/**
 * Ambient type declarations for the renderer process.
 * The tapestry API is exposed via contextBridge in the preload script.
 */

/** The pair written on a commit's `actor` line (D-06, D-07). */
interface TapestryActorRef {
  kind: string
  id: string
}

/**
 * A node's authorship, derived from the commits in the journal rather than
 * stored on the node. `changedBy` equals `createdBy` until somebody edits it.
 */
interface TapestryNodeHistory {
  createdSeq: number
  createdBy: TapestryActorRef
  changedSeq: number
  changedBy: TapestryActorRef
  deletedSeq: number | null
  deletedBy: TapestryActorRef | null
}

interface TapestryEdgeHistory {
  from: string
  to: string
  createdSeq: number
  createdBy: TapestryActorRef
  deletedSeq: number | null
  deletedBy: TapestryActorRef | null
}

/** Keyed by node/edge id: `n1`, `e3`. */
interface TapestryHistoryIndex {
  nodes: Record<string, TapestryNodeHistory>
  edges: Record<string, TapestryEdgeHistory>
}

interface TapestryKernelAPI {
  create(path: string, worldName: string): Promise<{ ok: boolean }>
  open(path: string): Promise<{ ok: boolean }>
  /** No actor argument: the main process stamps it (D-06/D-07). */
  submit(
    message: string,
    ops: any[],
  ): Promise<{
    seq: number
    digest: string
    nodeIds: string[]
    edgeIds: string[]
  }>
  getNodes(): Promise<
    Array<{
      id: string
      type: string
      props: Record<string, { type: string; value: string | number | boolean }>
    }>
  >
  getNode(
    id: string,
  ): Promise<{
    id: string
    type: string
    props: Record<string, { type: string; value: string | number | boolean }>
  } | null>
  getEdges(): Promise<any[]>
  status(): Promise<any>
  getHistoryIndex(): Promise<TapestryHistoryIndex>
  getFilePath(): Promise<string | null>
  undo(): Promise<{ ok: boolean }>
  redo(): Promise<{ ok: boolean }>
}

interface TapestryPluginsAPI {
  list(): Promise<
    Array<{
      /** Plugin id (directory name) — use for reload/enable/disable. */
      id: string
      /** Author-supplied manifest name (metadata). */
      name: string
      displayName: string
      version: string
      status: string
      reason?: string
      nodeTypes: string[]
      nodeViews: Record<string, string>
    }>
  >
  getContributions(): Promise<{
    nodeViews: Record<string, { nodeType: string; displayName: string; component: string }>
    commands: Record<string, { id: string; displayName: string; pluginName: string }>
    propertyPanels: Record<string, Array<{ nodeType: string; displayName: string; component: string; pluginName: string }>>
    inspectors: Record<string, { id: string; displayName: string; component: string; pluginName: string }>
  }>
  reload(name: string): Promise<{ status: string; reason?: string }>
  enable(name: string): Promise<{ status: string; reason?: string }>
  disable(name: string): Promise<{ ok: boolean }>
  executeCommand(
    commandId: string,
    args?: Record<string, unknown>,
    selectedNodes?: string[],
  ): Promise<{ ok: boolean; error?: string; crashed?: boolean }>
}

interface TapestryDialogAPI {
  showSave(): Promise<{ canceled: boolean; filePath?: string }>
}

interface TapestrySettingsAPI {
  /** The stored name (null before first run) and a suggestion to prefill. */
  getUserName(): Promise<{ userName: string | null; suggested: string }>
  setUserName(name: string): Promise<{ ok: boolean; error?: string }>
}

/** One row in the Agents panel. */
interface TapestryAgentSummary {
  name: string
  createdAt: string
  /** A request carrying this agent's token arrived in the last 2 minutes. */
  connected: boolean
  /** ISO timestamp, or null when it has never connected. */
  lastConnectedAt: string | null
}

interface TapestryAgentsAPI {
  list(): Promise<TapestryAgentSummary[]>
  /** The command carries the token, and is the only time it is shown. */
  create(
    name: string,
  ): Promise<{ ok: true; name: string; command: string } | { ok: false; error: string }>
  remove(name: string): Promise<{ ok: boolean }>
  getEnabled(): Promise<boolean>
  setEnabled(enabled: boolean): Promise<{ ok: boolean; error?: string }>
}

/** What an agent write into a rewound tree reports (UA-14). */
interface TapestryRedoDiscarded {
  treeId: string
  treeName: string
  actorId: string
}

interface TapestryAPI {
  kernel: TapestryKernelAPI
  plugins: TapestryPluginsAPI
  dialog: TapestryDialogAPI
  settings: TapestrySettingsAPI
  agents: TapestryAgentsAPI
  onFileOpened(callback: (filePath: string) => void): () => void
  /** A commit landed in a tree from outside the renderer (an agent, a plugin). */
  onTreeChanged(callback: (treeId: string) => void): () => void
  /** The agent list or a connection status changed. */
  onAgentsChanged(callback: () => void): () => void
  /** An agent write ended a rewound state, discarding redo (UA-14). */
  onRedoDiscarded(callback: (event: TapestryRedoDiscarded) => void): () => void
  onPluginError(
    callback: (pluginName: string, displayName: string, message: string, canRestart: boolean) => void,
  ): () => void
}

interface Window {
  tapestry: TapestryAPI
}
