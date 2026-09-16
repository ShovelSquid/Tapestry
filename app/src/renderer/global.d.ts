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

/** One value a property was ever set to, and the commit that set it
 * (tapestry/kernel/PropertyValues.hpp `PropertyValueEntry`). */
interface TapestryPropertyValueEntry {
  seq: number
  /** RFC 3339 UTC, whole seconds (the commit's own `recorded` stamp). */
  recorded: string
  actor: TapestryActorRef
  value: { type: string; value: string | number | boolean }
}

/**
 * Kernel operations, each naming its tree first (D-15). A tree id is the
 * `sha256:<hex>` header digest the main process minted when it opened the file.
 */
interface TapestryKernelAPI {
  /** No actor argument: the main process stamps it (D-06/D-07). */
  submit(
    treeId: string,
    message: string,
    ops: any[],
  ): Promise<{
    seq: number
    digest: string
    nodeIds: string[]
    edgeIds: string[]
  }>
  getNodes(treeId: string): Promise<
    Array<{
      id: string
      type: string
      props: Record<string, { type: string; value: string | number | boolean }>
    }>
  >
  getNode(
    treeId: string,
    id: string,
  ): Promise<{
    id: string
    type: string
    props: Record<string, { type: string; value: string | number | boolean }>
  } | null>
  getEdges(treeId: string): Promise<any[]>
  status(treeId: string): Promise<any>
  getHistoryIndex(treeId: string): Promise<TapestryHistoryIndex>
  getPropertyValues(
    treeId: string,
    nodeId: string,
    key: string,
    fromSeq?: number,
  ): Promise<TapestryPropertyValueEntry[]>
  undo(treeId: string): Promise<{ ok: boolean }>
  redo(treeId: string): Promise<{ ok: boolean }>
}

/** One tree in the space, as `trees:list` reports it. */
interface TapestryTreeSummary {
  id: string
  name: string
  kind: 'native' | 'vault'
  path: string
  vaultRoot?: string
  /** Where the tree's frame origin sits in world space (D-18). */
  frame: { x: number; y: number }
}

interface TapestryTreesAPI {
  list(): Promise<TapestryTreeSummary[]>
  open(path: string): Promise<{ ok: boolean; treeId?: string; error?: string }>
  create(
    path: string,
    worldName: string,
  ): Promise<{ ok: boolean; treeId?: string; error?: string }>
  close(treeId: string): Promise<{ ok: boolean; error?: string }>
  /** Show the tree's file in Finder. The renderer names an id, never a path. */
  reveal(treeId: string): Promise<{ ok: boolean; error?: string }>
  setFrame(treeId: string, x: number, y: number): Promise<{ ok: boolean; error?: string }>
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
  /** Pick an existing world to add to the space. */
  showOpenTree(): Promise<{ canceled: boolean; filePath?: string }>
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

/**
 * Thread editing (D-06, D-09): the collab push/pull surface for
 * ThreadService, the single write authority in main. No actor argument on
 * `push` -- the main process stamps it, like `kernel.submit`.
 */
interface TapestryThreadOpenResult {
  /** The collab version to start the renderer's `collab()` plugin at. */
  version: number
  /** ProseMirror JSON, replayed from `thread.log` records alone. Falls back
   * to the `body` checkpoint alone when `unreadable` is true. */
  doc: unknown
  /** The number of `thread.log` values found on open (never an estimate). */
  totalChanges: number
  /** True when at least one `thread.log` value failed to parse: the thread
   * stays read-only on the last checkpoint (T-02.3-03-01). */
  unreadable?: boolean
  /** Present when `unreadable` is true: why the parse failed. */
  unreadableReason?: string
}

type TapestryThreadPushResult =
  | { confirmed: true; version: number }
  | { confirmed: false; missing: { steps: unknown[]; fromVersion: number } }
  | { confirmed: false; rejected: true; reason: string }

interface TapestryThreadAPI {
  open(treeId: string, nodeId: string): Promise<TapestryThreadOpenResult>
  push(
    treeId: string,
    nodeId: string,
    version: number,
    steps: unknown[],
    times: number[],
    causes: (string | null)[],
  ): Promise<TapestryThreadPushResult>
  close(treeId: string, nodeId: string): Promise<{ ok: boolean }>
  /** D-22 (TA-07): the Authors legend's refused-change count, per actor id. */
  getRefusedCounts(treeId: string, nodeId: string): Promise<Record<string, number>>
}

/** What an agent write into a rewound tree reports (UA-14). */
interface TapestryRedoDiscarded {
  treeId: string
  treeName: string
  actorId: string
}

interface TapestryAPI {
  kernel: TapestryKernelAPI
  trees: TapestryTreesAPI
  plugins: TapestryPluginsAPI
  dialog: TapestryDialogAPI
  settings: TapestrySettingsAPI
  agents: TapestryAgentsAPI
  thread: TapestryThreadAPI
  /** The set of open trees changed: one opened, one closed, or the space restored. */
  onTreesChanged(callback: () => void): () => void
  /** A commit landed in a tree from outside the renderer (an agent, a plugin). */
  onTreeChanged(callback: (treeId: string) => void): () => void
  /** The agent list or a connection status changed. */
  onAgentsChanged(callback: () => void): () => void
  /** An agent write ended a rewound state, discarding redo (UA-14). */
  onRedoDiscarded(callback: (event: TapestryRedoDiscarded) => void): () => void
  onPluginError(
    callback: (pluginName: string, displayName: string, message: string, canRestart: boolean) => void,
  ): () => void
  /** A thread's pending batch was durably committed (D-06). */
  onThreadConfirmed(callback: (treeId: string, nodeId: string, version: number) => void): () => void
  /** A thread's flush was refused; the batch retries, but "Saved" would lie. */
  onThreadFlushError(callback: (treeId: string, nodeId: string, reason: string) => void): () => void
}

interface Window {
  tapestry: TapestryAPI
}
