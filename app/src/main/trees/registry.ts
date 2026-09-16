/**
 * TreeRegistry — the open trees, keyed by the identity written in their file.
 *
 * Phase 2 held exactly one world in one KernelBridge. D-15 ("Tapestry shows
 * several trees in one space") needs several, and the agent bridge needs to
 * name one of them in a tool argument. Both want the same thing: a small table
 * of open trees that can be looked up by a stable id.
 *
 * The id is `bridge.getHeaderDigest()` — the digest that is already the parent
 * of commit 1 (Plan 02). It costs no new field, it survives close and reopen,
 * and it names the tree without naming its path, which is what cross-tree
 * links (D-16) will need.
 *
 * One tree, one bridge, one journal lock. The journal takes flock(LOCK_EX) for
 * the life of an open world, so opening the same path twice would fail; the
 * registry returns the existing entry instead.
 */

import { basename, resolve } from 'path'
import { KernelBridge } from '../kernel-bridge'
import type { CommitResult, EdgeData, JournalStatus, NodeData, OpObject } from '../kernel-bridge'
import type { Actor } from '../commands/actor'

/**
 * The subset of KernelBridge the plugin host reaches through.
 *
 * Only the methods plugins actually call are forwarded. Undo, redo and replay
 * are deliberately absent: navigating history is the person's action, not a
 * plugin's, and a plugin moving the visible world under them would be
 * indistinguishable from a bug.
 */
export interface PrimaryBridgeProxy {
  readonly isLoaded: boolean
  submit(actorKind: string, actorId: string, message: string, ops: OpObject[]): CommitResult
  submitAs(actor: Actor, message: string, ops: OpObject[]): CommitResult
  getNodes(): NodeData[]
  getNode(id: string): NodeData | null
  getEdges(): EdgeData[]
  status(): JournalStatus
}

/** Where a tree's content comes from: Tapestry itself, or a mirrored source. */
export type TreeKind = 'native' | 'vault'

/** An open tree and the bridge holding its journal lock. */
export interface OpenTree {
  /** `sha256:<hex>` — the tree's stable identity (Plan 02). */
  readonly id: string
  /** Resolved absolute path of the `.tree` file. */
  readonly path: string
  readonly kind: TreeKind
  /** Display name; the file's basename without `.tree` unless overridden. */
  readonly name: string
  /** For a vault tree, the folder it mirrors (D-13). */
  readonly vaultRoot?: string
  readonly bridge: KernelBridge
}

export interface OpenTreeOptions {
  kind?: TreeKind
  vaultRoot?: string
  name?: string
}

/** The file's basename without the `.tree` extension. */
function defaultName(path: string): string {
  return basename(path).replace(/\.tree$/i, '')
}

export class TreeRegistry {
  /** Keyed by tree id. Map preserves insertion order, which is open order. */
  private readonly trees = new Map<string, OpenTree>()

  /** The tree the single-tree UI acts on until Plan 05 opens the frame view. */
  private primaryId: string | null = null

  private readonly listeners = new Set<() => void>()

  // -------------------------------------------------------------------------
  // Opening and creating
  // -------------------------------------------------------------------------

  /**
   * Open an existing tree, or return the entry already holding that path.
   *
   * Reopening a path that is already open would deadlock against our own
   * journal lock, so the existing entry is returned unchanged.
   */
  open(path: string, opts: OpenTreeOptions = {}): OpenTree {
    const target = resolve(path)
    const existing = this.findByPath(target)
    if (existing) return existing

    const bridge = new KernelBridge()
    bridge.open(path)
    return this.adopt(bridge, target, opts)
  }

  /** Create a new tree at `path` and register it. */
  create(path: string, worldName: string, opts: OpenTreeOptions = {}): OpenTree {
    const target = resolve(path)
    const existing = this.findByPath(target)
    if (existing) return existing

    const bridge = new KernelBridge()
    bridge.create(path, worldName)
    return this.adopt(bridge, target, opts)
  }

  /**
   * Register an opened bridge, refusing a second path for the same identity.
   *
   * Two paths with one identity means the same world was copied. Opening both
   * would let a change land in one copy and be invisible in the other, so the
   * second open is refused and its bridge released immediately.
   */
  private adopt(bridge: KernelBridge, target: string, opts: OpenTreeOptions): OpenTree {
    let id: string
    try {
      id = bridge.getHeaderDigest()
    } catch (err) {
      bridge.close()
      throw err
    }

    const clash = this.trees.get(id)
    if (clash) {
      bridge.close()
      throw new Error(`${clash.name} is already open from ${clash.path}`)
    }

    const tree: OpenTree = {
      id,
      path: target,
      kind: opts.kind ?? 'native',
      name: opts.name ?? defaultName(target),
      ...(opts.vaultRoot !== undefined ? { vaultRoot: opts.vaultRoot } : {}),
      bridge,
    }

    this.trees.set(id, tree)
    if (tree.kind === 'native') this.primaryId = id
    this.emit()
    return tree
  }

  // -------------------------------------------------------------------------
  // Closing
  // -------------------------------------------------------------------------

  /**
   * Close a tree and release its journal lock.
   *
   * The lock is held by the C++ sink until the kernel is destroyed, so this is
   * what makes the file openable again in the same process.
   */
  close(treeId: string): void {
    const tree = this.trees.get(treeId)
    if (!tree) return
    try {
      tree.bridge.close()
    } catch (err) {
      console.error('[TreeRegistry] close() failed:', err)
    }
    this.trees.delete(treeId)
    if (this.primaryId === treeId) this.primaryId = this.lastNativeId()
    this.emit()
  }

  closeAll(): void {
    for (const id of [...this.trees.keys()]) {
      const tree = this.trees.get(id)!
      try {
        tree.bridge.close()
      } catch (err) {
        console.error('[TreeRegistry] close() failed:', err)
      }
      this.trees.delete(id)
    }
    this.primaryId = null
    this.emit()
  }

  // -------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------

  get(treeId: string): OpenTree | null {
    return this.trees.get(treeId) ?? null
  }

  /** Open trees, in the order they were opened. */
  list(): OpenTree[] {
    return [...this.trees.values()]
  }

  /** The most recently opened or created native tree. */
  primary(): OpenTree | null {
    if (this.primaryId) {
      const tree = this.trees.get(this.primaryId)
      if (tree) return tree
    }
    const fallback = this.lastNativeId()
    return fallback ? (this.trees.get(fallback) ?? null) : null
  }

  setPrimary(treeId: string): void {
    if (!this.trees.has(treeId)) throw new Error(`Unknown tree: ${treeId}`)
    this.primaryId = treeId
    this.emit()
  }

  /**
   * The open trees without their bridges or their frames.
   *
   * Frames live in settings, not here: where a frame sits is a preference
   * about the space, while this table is about which worlds are loaded. The
   * caller joins the two (see `trees:list`).
   */
  summary(): Array<{ id: string; name: string; kind: TreeKind; path: string; vaultRoot?: string }> {
    return this.list().map((tree) => ({
      id: tree.id,
      name: tree.name,
      kind: tree.kind,
      path: tree.path,
      ...(tree.vaultRoot !== undefined ? { vaultRoot: tree.vaultRoot } : {}),
    }))
  }

  /**
   * A bridge-shaped facade that always forwards to the current primary tree.
   *
   * Plugins were written against a single kernel and their SDK is unchanged
   * (D-15 is a host concern, not a plugin one), so they keep one facade. It is
   * bound to whichever native tree is primary at call time rather than to a
   * bridge captured at load, so a plugin loaded before a second world opened
   * does not keep writing into a tree the user has since closed.
   */
  primaryBridgeProxy(): PrimaryBridgeProxy {
    const requirePrimary = (): KernelBridge => {
      const tree = this.primary()
      if (!tree) {
        throw new Error('No kernel loaded — open a tree first')
      }
      return tree.bridge
    }

    const registry = this
    return {
      get isLoaded(): boolean {
        const tree = registry.primary()
        return tree !== null && tree.bridge.isLoaded
      },
      submit: (actorKind, actorId, message, ops) =>
        requirePrimary().submit(actorKind, actorId, message, ops),
      submitAs: (actor, message, ops) => requirePrimary().submitAs(actor, message, ops),
      getNodes: () => requirePrimary().getNodes(),
      getNode: (id) => requirePrimary().getNode(id),
      getEdges: () => requirePrimary().getEdges(),
      status: () => requirePrimary().status(),
    }
  }

  /**
   * Resolve a tree reference from an agent or a plugin.
   *
   * An id is matched exactly; otherwise a name is matched case-insensitively,
   * and an ambiguous name is refused rather than guessed — picking one of two
   * trees named "Notes" would write into the wrong world silently.
   */
  resolveRef(ref: string): OpenTree {
    const byId = this.trees.get(ref)
    if (byId) return byId

    const lowered = ref.toLowerCase()
    const matches = [...this.trees.values()].filter((t) => t.name.toLowerCase() === lowered)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      throw new Error(`Tree name ${ref} is ambiguous; use the tree id`)
    }
    throw new Error(`Unknown tree: ${ref}`)
  }

  // -------------------------------------------------------------------------
  // Change notification
  // -------------------------------------------------------------------------

  /** Subscribe to open/close/primary changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (err) {
        console.error('[TreeRegistry] onChange listener threw:', err)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private findByPath(target: string): OpenTree | null {
    for (const tree of this.trees.values()) {
      if (tree.path === target) return tree
    }
    return null
  }

  private lastNativeId(): string | null {
    let found: string | null = null
    for (const [id, tree] of this.trees) {
      if (tree.kind === 'native') found = id
    }
    return found
  }
}
