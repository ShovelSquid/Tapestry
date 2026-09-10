/**
 * KernelBridge — loads the native C++ addon and exposes kernel operations
 * for IPC registration in the Electron main process.
 *
 * The bridge holds a single kernel instance (one world open at a time) and
 * provides typed methods that map 1:1 to the addon's C++ methods. Plan 02
 * calls registerHandlers(ipcMain) to wire these into the IPC channel.
 */

import { join } from 'path'

// ---------------------------------------------------------------------------
// Load the native addon
// ---------------------------------------------------------------------------

// The compiled .node file lives in app/native/build/Release/ after cmake-js
// builds it. In a packaged Electron app, the path will need adjustment — that
// is Plan 02's concern.
const addonPath = join(__dirname, '..', '..', 'native', 'build', 'Release', 'tapestry_addon.node')

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

  /**
   * Create a new .tree world at the given path.
   */
  create(path: string, worldName: string): void {
    this.instance = TapestryAddon.create(path, worldName)
    this.syncCurrentSeq()
  }

  /**
   * Open an existing .tree world.
   */
  open(path: string): void {
    this.instance = TapestryAddon.open(path)
    this.syncCurrentSeq()
  }

  /**
   * Submit a batch of operations as an atomic commit.
   */
  submit(actorKind: string, actorId: string, message: string, ops: OpObject[]): CommitResult {
    this.ensureLoaded()
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
