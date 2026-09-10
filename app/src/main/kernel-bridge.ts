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

interface OpObject {
  op: string
  [key: string]: unknown
}

interface CommitResult {
  seq: number
  digest: string
  nodeIds: string[]
  edgeIds: string[]
}

interface NodeData {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

interface EdgeData {
  id: string
  from: string
  to: string
  label: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

interface JournalStatus {
  kind: 'Ok' | 'TornTail' | 'Corrupt'
  offset: number
  bytes: number
  lastGoodSeq: number
  reason: string
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
   * Register IPC handlers on the given ipcMain instance. Plan 02 calls this
   * from the main process entry point to wire the bridge into Electron's IPC.
   */
  static registerHandlers(ipcMain: any): KernelBridge {
    const bridge = new KernelBridge()

    ipcMain.handle('kernel:create', (_event: any, path: string, worldName: string) => {
      bridge.create(path, worldName)
      return { ok: true }
    })

    ipcMain.handle('kernel:open', (_event: any, path: string) => {
      bridge.open(path)
      return { ok: true }
    })

    ipcMain.handle('kernel:submit', (
      _event: any,
      actorKind: string,
      actorId: string,
      message: string,
      ops: OpObject[],
    ) => {
      return bridge.submit(actorKind, actorId, message, ops)
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
