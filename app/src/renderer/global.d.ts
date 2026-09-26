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

/** Whether a tree can be read and written, or why it cannot. */
type TapestryTreeStatus = 'ok' | 'damaged' | 'locked' | 'missing'

/** One tree in the space, as `trees:list` reports it. */
interface TapestryTreeSummary {
  id: string
  name: string
  kind: 'native' | 'vault' | 'workspace'
  path: string
  vaultRoot?: string
  /** Where the tree's frame origin sits in world space, read from its placement edge in the forest tree (2.6 D-04). */
  /** For a workspace tree, the folder it mirrors (02.7). */
  workspaceRoot?: string
  /** Where the tree's frame origin sits in world space (D-18). */
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
  /** `notice`, when present, is an approved refusal to show verbatim (4.9, 4.10). */
  open(path: string): Promise<{ ok: boolean; treeId?: string; error?: string; notice?: string }>
  create(
    path: string,
    worldName: string,
  ): Promise<{ ok: boolean; treeId?: string; error?: string; notice?: string }>
  close(treeId: string): Promise<{ ok: boolean; error?: string; notice?: string }>
  /** Why the space did not open, in the approved wording, or null (4.1-4.8). */
  spaceProblem(): Promise<{ message: string | null }>
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
  /** Pick a workspace folder to mirror as a tree (02.7 D-01). */
  showOpenWorkspaceFolder(): Promise<{ canceled: boolean; folderPath?: string }>
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
  add(root: string): Promise<{ ok: boolean; treeId?: string; error?: string; notice?: string }>
}

/** What a window save did (02.7 D-04, D-05). */
interface TapestryWorkspaceSaveValue {
  note: string
  path: string
  written: boolean
  /** The file changed before the edit was written; the file's text won. */
  fileWins: boolean
  sha256: string | null
  seq: number
}

/** Whether a workspace's outside changes are being recorded (02.7 D-06). */
type TapestryWorkspaceStatusValue =
  | { kind: 'watching' }
  | { kind: 'not-watching'; reason: string }
  | { kind: 'folder-missing' }

type TapestryWorkspaceStatus = { treeId: string } & TapestryWorkspaceStatusValue

interface TapestryWorkspaceAPI {
  /** Mirror a workspace folder as its own tree. Main refuses an unpicked root. */
  add(root: string): Promise<{ ok: boolean; treeId?: string; error?: string }>
  /** Save a person's edit to the file a workspace note shows. */
  saveFile(
    treeId: string,
    nodeId: string,
    text: string,
    baseSha256: string | null,
  ): Promise<{ ok: true; value: TapestryWorkspaceSaveValue } | { ok: false; error: string }>
  /** Every open workspace's current watching status. */
  statuses(): Promise<TapestryWorkspaceStatus[]>
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

/** Why a chat turn failed (main/chat/engine.ts ChatErrorKind). */
type TapestryChatErrorKind =
  | 'not-installed'
  | 'signed-out'
  | 'crashed'
  | 'protocol'
  | 'bridge-off'
  | 'tools-unavailable'
  | 'session-lost'
  | 'timeout'
  | 'no-key'
  | 'refused'

/** One thing that happened in a chat (main/chat/engine.ts ChatEvent). */
type TapestryChatEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'user'; text: string }
  | { type: 'text-delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; isError: boolean; text: string }
  | { type: 'notice'; text: string }
  | { type: 'error'; kind: TapestryChatErrorKind; message: string }
  | { type: 'done'; ok: boolean; reason?: string }

type TapestryChatResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** One live chat event with its turn (main/chat/chat-service.ts ChatLiveEntry). */
interface TapestryChatLiveEntry {
  turn: number
  event: TapestryChatEvent
}

/** A chat session as main holds it (main/chat/chat-service.ts ChatSessionState). */
interface TapestryChatSessionState {
  /** The workspace's name. */
  workspace: string
  /** The session's agent name, without the `agent.` prefix. */
  agent: string
  sessionId: string | null
  /** Events not yet committed into the note, each tagged with its turn. */
  live: TapestryChatLiveEntry[]
  busy: boolean
  /** The chat's Allow shell (not sandboxed) switch (D-15); off after every relaunch. */
  allowShell: boolean
}

/** One chat event, with its session note and turn (`done` carries the turn just committed). */
interface TapestryChatEventPayload {
  treeId: string
  noteId: string
  turn: number
  event: TapestryChatEvent
}

/** The in-app chats (02.7 D-12, 02.8 D-02): each is a session note. No token or file path ever comes back. */
interface TapestryChatAPI {
  /** New chat: a session note in the workspace, at the next free spot. */
  create(treeId: string): Promise<TapestryChatResult<{ noteId: string; agent: string }>>
  open(treeId: string, noteId: string): Promise<TapestryChatResult<TapestryChatSessionState>>
  send(treeId: string, noteId: string, text: string): Promise<TapestryChatResult<null>>
  stop(treeId: string, noteId: string): Promise<TapestryChatResult<null>>
  /** Turn the chat's shell on or off from the next message on (D-15). */
  setAllowShell(treeId: string, noteId: string, on: boolean): Promise<TapestryChatResult<null>>
}

interface TapestryAPI {
  kernel: TapestryKernelAPI
  trees: TapestryTreesAPI
  vault: TapestryVaultAPI
  workspace: TapestryWorkspaceAPI
  plugins: TapestryPluginsAPI
  dialog: TapestryDialogAPI
  settings: TapestrySettingsAPI
  agents: TapestryAgentsAPI
  chat: TapestryChatAPI
  /** Something happened in a chat. */
  onChatEvent(callback: (payload: TapestryChatEventPayload) => void): () => void
  thread: TapestryThreadAPI
  /** The set of open trees changed: one opened, one closed, or the space restored. */
  onTreesChanged(callback: () => void): () => void
  /** A commit landed in a tree from outside the renderer (an agent, a plugin). */
  onTreeChanged(callback: (treeId: string) => void): () => void
  /** A vault is being read, is catching up, or is up to date (D-20). */
  onVaultStatus(callback: (status: TapestryVaultStatus) => void): () => void
  /** A workspace's watching status changed (D-06). */
  onWorkspaceStatus(callback: (status: TapestryWorkspaceStatus) => void): () => void
  /** The agent list or a connection status changed. */
  onAgentsChanged(callback: () => void): () => void
  /** An agent asked to show a workspace file's note in its window (open_file). */
  onRevealNote(callback: (payload: { treeId: string; noteId: string }) => void): () => void
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
