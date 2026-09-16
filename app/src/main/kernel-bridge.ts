/**
 * KernelBridge — loads the native C++ addon and exposes kernel operations
 * for IPC registration in the Electron main process.
 *
 * The bridge holds a single kernel instance (one world open at a time) and
 * provides typed methods that map 1:1 to the addon's C++ methods. Plan 02
 * calls registerHandlers(ipcMain) to wire these into the IPC channel.
 */

import { join, resolve } from 'path'
import { existsSync } from 'fs'
import type { Actor } from './commands/actor'

// ---------------------------------------------------------------------------
// Load the native addon
// ---------------------------------------------------------------------------

// In development, the compiled .node file lives at app/native/build/Release/.
// In a packaged Electron app (via Forge), it's in the Resources directory
// as an extraResource.
function resolveAddonPath(): string {
  // Packaged: process.resourcesPath points to .app/Contents/Resources
  if (process.resourcesPath) {
    const packagedPath = join(process.resourcesPath, 'tapestry_addon.node')
    if (existsSync(packagedPath)) return packagedPath
  }
  // Development: relative to __dirname (out/main/)
  return join(__dirname, '..', '..', 'native', 'build', 'Release', 'tapestry_addon.node')
}

const addonPath = resolveAddonPath()

// eslint-disable-next-line @typescript-eslint/no-var-requires
let addon: any
try {
  addon = require(addonPath)
} catch (err) {
  // Provide a clear error when the addon is not compiled yet.
  const msg = err instanceof Error ? err.message : String(err)
  throw new Error(
    `Failed to load native addon from ${addonPath}. ` +
    `Run "npm run build:native" first. Original error: ${msg}`
  )
}

const TapestryAddon = addon.TapestryAddon

// ---------------------------------------------------------------------------
// Op and result types for the bridge layer
// ---------------------------------------------------------------------------

export interface OpObject {
  op: string
  [key: string]: unknown
}

export interface CommitResult {
  seq: number
  digest: string
  nodeIds: string[]
  edgeIds: string[]
}

export interface NodeData {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

export interface EdgeData {
  id: string
  from: string
  to: string
  label: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

export interface JournalStatus {
  kind: 'Ok' | 'TornTail' | 'Corrupt'
  offset: number
  bytes: number
  lastGoodSeq: number
  reason: string
}

// ---------------------------------------------------------------------------
// History: who made what, derived from the journal (D-05, HIST-08)
// ---------------------------------------------------------------------------

/** The pair written on a commit's `actor` line. */
export interface ActorRef {
  kind: string
  id: string
}

/**
 * A node's authorship as the commits describe it. There is no created-by
 * property anywhere in the file, so this is the only answer to "who made
 * this" — and one a writer cannot set for itself.
 */
export interface NodeHistoryEntry {
  createdSeq: number
  createdBy: ActorRef
  changedSeq: number
  changedBy: ActorRef
  /** null while the node is live. */
  deletedSeq: number | null
  deletedBy: ActorRef | null
}

export interface EdgeHistoryEntry {
  from: string
  to: string
  createdSeq: number
  createdBy: ActorRef
  deletedSeq: number | null
  deletedBy: ActorRef | null
}

/** Keyed by the same id strings the world uses: `n1`, `e3`. */
export interface HistoryIndex {
  nodes: Record<string, NodeHistoryEntry>
  edges: Record<string, EdgeHistoryEntry>
}

// ---------------------------------------------------------------------------
// KernelBridge
// ---------------------------------------------------------------------------

export class KernelBridge {
  private instance: any = null

  /** Resolved path of the currently open world, if any. */
  private openPath: string | null = null

  /**
   * Create a new .tree world at the given path.
   * Creates first so a failure keeps the current world open, then releases
   * the previous kernel (and its journal lock) explicitly.
   */
  create(path: string, worldName: string): void {
    const next = TapestryAddon.create(path, worldName)
    this.close()
    this.instance = next
    this.openPath = resolve(path)
    this.syncCurrentSeq()
  }

  /**
   * Open an existing .tree world.
   * Opens first so a failure keeps the current world open, then releases
   * the previous kernel. Reopening the file that is already open releases
   * our own lock first, since the journal lock is exclusive per file.
   */
  open(path: string): void {
    const target = resolve(path)
    if (this.instance && this.openPath === target) {
      this.close()
    }
    const next = TapestryAddon.open(path)
    this.close()
    this.instance = next
    this.openPath = target
    this.syncCurrentSeq()
  }

  /**
   * Release the current kernel and its journal lock deterministically.
   * The addon's PosixSink holds flock(LOCK_EX) until the C++ object is
   * destroyed; without this, the lock lingers until V8 garbage-collects the
   * old wrapper and reopening the same file fails nondeterministically.
   */
  close(): void {
    if (this.instance) {
      try {
        this.instance.close()
      } catch (err) {
        console.error('[KernelBridge] close() failed:', err)
      }
      this.instance = null
    }
    this.openPath = null
    this.currentSeq = 0
    this.undoStack = []
  }

  /**
   * Submit a batch of operations as an atomic commit.
   */
  submit(actorKind: string, actorId: string, message: string, ops: OpObject[]): CommitResult {
    this.ensureLoaded()
    // A commit is always appended after the journal head (seq = lastSeq + 1,
    // parent = lastDigest). While the world is rewound by undo, the kernel
    // validates the proposal against the rewound world but appends it after
    // the commits that were "undone"; the next open replays every commit in
    // order, the new one fails to apply, and the journal is marked Corrupt.
    // Until undo is implemented as compensating commits or a real branch,
    // refuse to commit from a rewound position.
    if (this.currentSeq !== (this.instance.getLastSeq() as number)) {
      throw new Error(
        'Cannot commit while history is rewound; redo to the latest change or discard the undo first',
      )
    }
    const result = this.instance.submit(actorKind, actorId, message, ops)
    this.afterCommit(result.seq)
    return result
  }

  /**
   * Submit a commit on behalf of an actor the host has already resolved.
   *
   * This is the only submit path callers outside main should reach: the
   * Actor comes from the host (getHumanActor, pluginActor, agentActor), never
   * from the caller's arguments. See commands/actor.ts for the rule.
   */
  submitAs(actor: Actor, message: string, ops: OpObject[]): CommitResult {
    return this.submit(actor.kind, actor.id, message, ops)
  }

  /**
   * Return all live nodes in the world.
   */
  getNodes(): NodeData[] {
    this.ensureLoaded()
    return this.instance.getNodes()
  }

  /**
   * Return a single node by id string (e.g. "n1").
   */
  getNode(id: string): NodeData | null {
    this.ensureLoaded()
    return this.instance.getNode(id)
  }

  /**
   * Return all live edges in the world.
   */
  getEdges(): EdgeData[] {
    this.ensureLoaded()
    return this.instance.getEdges()
  }

  /**
   * Return the journal status.
   */
  status(): JournalStatus {
    this.ensureLoaded()
    return this.instance.status()
  }

  /**
   * Who created and last changed every node and edge.
   *
   * currentSeq, not the journal head, is what is scanned: while history is
   * rewound the display shows the world as of an earlier commit, and naming a
   * changer from a commit the reader cannot see would be a claim the visible
   * history does not support.
   */
  getHistoryIndex(): HistoryIndex {
    this.ensureLoaded()
    return this.instance.getHistoryIndex(this.currentSeq)
  }

  /**
   * This world's stable identity, `sha256:<header digest>`.
   */
  getHeaderDigest(): string {
    this.ensureLoaded()
    return this.instance.getHeaderDigest()
  }

  /**
   * The ids the next createNode and createEdge will receive, so a note and the
   * connection to it can go into one commit (D-04).
   *
   * Refused while rewound: the ids are read from the rewound world, but the
   * commit would be appended at the journal head, where they are already taken.
   */
  getNextIds(): { node: string; edge: string } {
    this.ensureLoaded()
    if (this.isRewound) {
      throw new Error('Cannot predict ids while history is rewound')
    }
    return this.instance.getNextIds()
  }

  /** Whether the displayed world sits behind the journal head (undo). */
  get isRewound(): boolean {
    return this.instance !== null && this.currentSeq !== (this.instance.getLastSeq() as number)
  }

  /**
   * Whether a kernel instance is currently loaded.
   */
  get isLoaded(): boolean {
    return this.instance !== null
  }

  // -----------------------------------------------------------------------
  // Undo/Redo (D-22): navigate the commit history without erasing evidence
  // -----------------------------------------------------------------------

  /** Current replay position — the seq the world is displaying. */
  private currentSeq: number = 0

  /** Stack of seqs that have been undone so redo can reach them. */
  private undoStack: number[] = []

  /**
   * Undo: save the current position, replay up to (current - 1).
   * Returns true if undo succeeded, false if already at the beginning.
   */
  undo(): boolean {
    this.ensureLoaded()
    if (this.currentSeq <= 0) return false
    this.undoStack.push(this.currentSeq)
    this.currentSeq -= 1
    this.instance.replayUpTo(this.currentSeq)
    return true
  }

  /**
   * Redo: pop from the undo stack and replay up to that seq.
   * Returns true if redo succeeded, false if nothing to redo.
   */
  redo(): boolean {
    this.ensureLoaded()
    if (this.undoStack.length === 0) return false
    const targetSeq = this.undoStack.pop()!
    this.currentSeq = targetSeq
    this.instance.replayUpTo(this.currentSeq)
    return true
  }

  /**
   * After a new commit, update currentSeq and clear the redo stack.
   * A new edit after undo discards the redo stack (D-22).
   */
  private afterCommit(commitSeq: number): void {
    this.currentSeq = commitSeq
    this.undoStack = []
  }

  /**
   * Synchronize currentSeq after opening/creating a world.
   */
  private syncCurrentSeq(): void {
    if (this.instance) {
      this.currentSeq = this.instance.getLastSeq() as number
      this.undoStack = []
    }
  }

  /**
   * Register IPC handlers on the given ipcMain instance. The main process
   * entry point calls this to wire the bridge into Electron's IPC.
   *
   * getHumanActor supplies the actor for every renderer-originated commit.
   * The renderer never sends one (D-06/D-07): a sandboxed window that could
   * name its own actor could sign changes as anyone.
   */
  static registerHandlers(ipcMain: any, getHumanActor: () => Actor): KernelBridge {
    const bridge = new KernelBridge()

    ipcMain.handle('kernel:create', (_event: any, path: string, worldName: string) => {
      bridge.create(path, worldName)
      return { ok: true }
    })

    ipcMain.handle('kernel:open', (_event: any, path: string) => {
      bridge.open(path)
      return { ok: true }
    })

    // (message, ops) only. A call in the old four-argument shape fails here,
    // before the kernel sees it, rather than being reinterpreted.
    ipcMain.handle('kernel:submit', (_event: any, message: unknown, ops: unknown) => {
      if (typeof message !== 'string' || !Array.isArray(ops)) {
        throw new Error('kernel:submit expects (message: string, ops: Op[])')
      }
      return bridge.submitAs(getHumanActor(), message, ops as OpObject[])
    })

    ipcMain.handle('kernel:getNodes', () => {
      return bridge.getNodes()
    })

    ipcMain.handle('kernel:getNode', (_event: any, id: string) => {
      return bridge.getNode(id)
    })

    ipcMain.handle('kernel:getEdges', () => {
      return bridge.getEdges()
    })

    ipcMain.handle('kernel:status', () => {
      return bridge.status()
    })

    ipcMain.handle('kernel:getHistoryIndex', () => {
      return bridge.getHistoryIndex()
    })

    ipcMain.handle('kernel:undo', () => {
      return { ok: bridge.undo() }
    })

    ipcMain.handle('kernel:redo', () => {
      return { ok: bridge.redo() }
    })

    return bridge
  }

  private ensureLoaded(): void {
    if (!this.instance) {
      throw new Error('No kernel loaded — call create() or open() first')
    }
  }
}
