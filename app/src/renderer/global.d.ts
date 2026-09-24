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
  undo(treeId: string): Promise<{ ok: boolean }>
  redo(treeId: string): Promise<{ ok: boolean }>
}

/** Whether a tree can be read and written, or why it cannot. */
type TapestryTreeStatus = 'ok' | 'damaged' | 'locked' | 'missing'

/** One tree in the space, as `trees:list` reports it. */
interface TapestryTreeSummary {
  id: string
  name: string
  kind: 'native' | 'vault'
  path: string
  vaultRoot?: string
  /** Where the tree's frame origin sits in world space, read from its placement edge in the forest tree (2.6 D-04). */
  frame: { x: number; y: number }
  /** A tree that would not open stays in the space with its reason. */
  status: TapestryTreeStatus
  reason?: string
}

/** One frame's new origin within a drop (2.6 D-11). */
interface TapestryFrameMove {
  treeId: string
  x: number
  y: number
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
  /** Try a damaged, locked or missing tree again (UI-SPEC "Reopen tree"). */
  reopen(treeId: string): Promise<{ ok: boolean; treeId?: string; error?: string }>
  /** An automatic correction, recorded by the system only when it moves the frame (D-12). */
  fitFrame(treeId: string, x: number, y: number): Promise<{ ok: boolean; committed?: boolean; error?: string }>
  /** One drop, the dragged frame first, as one forest commit. Main signs it; no actor is sent. */
  moveFrames(moves: TapestryFrameMove[]): Promise<{ ok: boolean; committed?: boolean; error?: string }>
  /** Put the last drop back as a new signed forest commit, never a rewind (D-08, D-09). */
  undoFrames(): Promise<TapestryFrameStepResult>
  /** Put an undone drop forward again as a new signed forest commit (D-08, D-09). */
  redoFrames(): Promise<TapestryFrameStepResult>
}

/** What a frame undo or redo did, and how many drops each way remain. */
interface TapestryFrameStepResult {
  ok: boolean
  committed?: boolean
  undoable?: number
  redoable?: number
  error?: string
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
    /**
     * Registered plugin surfaces (CANV-04), keyed by surface id. `pluginName`
     * is the plugin directory id; the renderer builds
     * `tapestry-plugin://<pluginName>/<entry>` from these two host-validated
     * values and nothing else.
     */
    surfaces: Record<
      string,
      { id: string; displayName: string; entry: string; placement: 'stage'; pluginName: string }
    >
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

// ---------------------------------------------------------------------------
// Plugin surface types (CANV-04)
//
// Mirrored from sdk/src/contributions.ts (SurfaceHost, SurfaceHandle,
// SurfaceModule) because tsconfig.web.json's rootDir is src/renderer and
// cannot import ../../../sdk/src. Keep member names in lockstep with the SDK.
// ---------------------------------------------------------------------------

/** Mirror of SDK `SurfaceHost`: what the host hands a surface at mount time. */
interface TapestrySurfaceHost {
  /** Host-owned, absolutely sized element; the plugin owns its children only. */
  readonly container: HTMLElement
  /** Identity of the tree the surface was opened for. */
  readonly treeId: string
  /** Subscribe to container size (CSS px width, height, DPR); returns unsubscribe. */
  onResize(cb: (width: number, height: number, dpr: number) => void): () => void
  /** Ask the host to unmount the surface (the host then calls dispose). */
  close(): void
}

/** Mirror of SDK `SurfaceHandle`: `dispose` must be idempotent. */
interface TapestrySurfaceHandle {
  dispose(): void
}

/** Mirror of SDK `SurfaceModule`: the surface entry module's default export. */
interface TapestrySurfaceModule {
  mount(host: TapestrySurfaceHost): Promise<TapestrySurfaceHandle> | TapestrySurfaceHandle
}

interface TapestryDialogAPI {
  showSave(): Promise<{ canceled: boolean; filePath?: string }>
  /** Pick an existing world to add to the space. */
  showOpenTree(): Promise<{ canceled: boolean; filePath?: string }>
  /** Pick an Obsidian vault folder to mirror as a tree (D-10, D-13). */
  showOpenVaultFolder(): Promise<{ canceled: boolean; folderPath?: string }>
}

/** Where a vault import has got to (D-20). */
interface TapestryVaultStatus {
  treeId: string
  kind: 'reading' | 'catching-up' | 'up-to-date'
  done: number
  total: number
}

interface TapestryVaultAPI {
  /** Mirror the vault folder as its own tree. Main refuses an unpicked root. */
  add(root: string): Promise<{ ok: boolean; treeId?: string; error?: string }>
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
  trees: TapestryTreesAPI
  vault: TapestryVaultAPI
  plugins: TapestryPluginsAPI
  dialog: TapestryDialogAPI
  settings: TapestrySettingsAPI
  agents: TapestryAgentsAPI
  /** The set of open trees changed: one opened, one closed, or the space restored. */
  onTreesChanged(callback: () => void): () => void
  /** A commit landed in a tree from outside the renderer (an agent, a plugin). */
  onTreeChanged(callback: (treeId: string) => void): () => void
  /** A vault is being read, is catching up, or is up to date (D-20). */
  onVaultStatus(callback: (status: TapestryVaultStatus) => void): () => void
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
