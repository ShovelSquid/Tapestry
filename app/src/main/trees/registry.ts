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

import { existsSync } from 'fs'
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
export type TreeKind = 'native' | 'vault' | 'workspace'

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
  /** For a workspace tree, the folder it mirrors (02.7 D-01). */
  readonly workspaceRoot?: string
  readonly bridge: KernelBridge
}

/** Why a tree is in the space but cannot be read or written. */
export type UnavailableStatus = 'damaged' | 'locked' | 'missing'

/**
 * A tree that would not open, kept in the space with its reason (T-02.2-32).
 *
 * It holds no bridge, which is the whole point: there is no handle through
 * which anything could write to it. It is still a member of the space, because
 * a frame that silently vanished when a file was moved or damaged would be
 * indistinguishable from a world that had been lost.
 */
export interface UnavailableTree {
  /**
   * `path:<resolved path>` — a tree that would not open has no header digest
   * to be named by, so it is named by the only thing known about it.
   */
  readonly id: string
  readonly path: string
  readonly kind: TreeKind
  readonly name: string
  readonly vaultRoot?: string
  readonly workspaceRoot?: string
  readonly status: UnavailableStatus
  /** The kernel's own words, so the frame can say what is actually wrong. */
  readonly reason: string
}

/** Either kind of member of the space. */
export type TreeEntry = OpenTree | UnavailableTree

/** One tree as the renderer sees it: no bridge, but always a status. */
export interface TreeSummary {
  id: string
  name: string
  kind: TreeKind
  path: string
  vaultRoot?: string
  workspaceRoot?: string
  status: 'ok' | UnavailableStatus
  reason?: string
}

export interface OpenTreeOptions {
  kind?: TreeKind
  vaultRoot?: string
  workspaceRoot?: string
  name?: string
}

/** The file's basename without the `.tree` extension. */
function defaultName(path: string): string {
  return basename(path).replace(/\.tree$/i, '')
}

/** The id an unopenable tree is known by. */
function unavailableId(resolvedPath: string): string {
  return `path:${resolvedPath}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Which kind of failure an open error describes.
 *
 * The kernel reports a second writer as "another process holds the journal
 * lock" (journal/Journal.cpp), so the word "locked" never actually reaches
 * this string: the lock is matched by that phrase rather than by the word.
 * Anything else that opened badly is treated as damage, which is the
 * conservative answer — a damaged tree is never written to.
 */
function classifyOpenFailure(detail: string): 'locked' | 'damaged' {
  return /journal lock|\blocked\b/i.test(detail) ? 'locked' : 'damaged'
}

/** Release a bridge without letting the release itself throw. */
function closeQuietly(bridge: KernelBridge): void {
  try {
    bridge.close()
  } catch (err) {
    console.error('[TreeRegistry] close() failed:', err)
  }
}

/**
 * What each refusal says. Every one names the same consequence, because that
 * is the part a caller has to act on; the cause is what explains it.
 */
const refusalCause: Record<UnavailableStatus, string> = {
  damaged: 'This tree is damaged',
  locked: 'This tree is open in another Tapestry window',
  missing: "This tree's file cannot be found",
}

export class TreeRegistry {
  /** Keyed by tree id. Map preserves insertion order, which is open order. */
  private readonly trees = new Map<string, OpenTree>()

  /** Trees in the space that would not open, keyed by their `path:` id. */
  private readonly unavailable = new Map<string, UnavailableTree>()

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
   * Open a tree, or keep it in the space with the reason it would not open.
   *
   * This is the launch and Add-tree path: a world that has been moved, damaged
   * or left open in another Tapestry must not cost the user the rest of their
   * space, and must not disappear from it either.
   *
   * A tree whose journal opened but did not verify is closed again straight
   * away, so nothing holds a handle that could append to it. Nothing here ever
   * repairs a file: repair is an explicit act, elsewhere (Phase 1 PD-04).
   *
   * An identity clash still throws, because it is a fact about the space
   * rather than about the file — the same world is already open from another
   * path, and recording a permanent "damaged" frame for it would be untrue.
   */
  tryOpen(path: string, opts: OpenTreeOptions = {}): OpenTree | UnavailableTree {
    const target = resolve(path)

    const existing = this.findByPath(target)
    if (existing) return existing

    // Checked here rather than left to the kernel: its "missing" detail is the
    // path again, which says nothing a reader did not already know.
    if (!existsSync(target)) {
      return this.recordUnavailable(target, opts, 'missing', `No file at ${target}`)
    }

    const bridge = new KernelBridge()
    try {
      bridge.open(target)
    } catch (err) {
      const detail = errorMessage(err)
      return this.recordUnavailable(target, opts, classifyOpenFailure(detail), detail)
    }

    let status
    try {
      status = bridge.status()
    } catch (err) {
      closeQuietly(bridge)
      return this.recordUnavailable(target, opts, 'damaged', errorMessage(err))
    }

    if (status.kind !== 'Ok') {
      // Torn or corrupt: hold nothing open on it, and say why.
      closeQuietly(bridge)
      return this.recordUnavailable(
        target,
        opts,
        'damaged',
        status.reason || `the journal is ${status.kind}`,
      )
    }

    const tree = this.adopt(bridge, target, opts)
    // It opened, so any earlier record of it failing to is no longer true.
    this.unavailable.delete(unavailableId(target))
    return tree
  }

  /**
   * Try an unavailable tree again, once its cause is gone (UI-SPEC "Reopen
   * tree"). Returns null when the id names nothing unavailable.
   *
   * The old entry is dropped first, so a retry that fails records a fresh
   * reason rather than leaving a stale one beside it.
   */
  reopen(treeId: string): OpenTree | UnavailableTree | null {
    const entry = this.unavailable.get(treeId)
    if (!entry) return null

    this.unavailable.delete(treeId)
    return this.tryOpen(entry.path, {
      kind: entry.kind,
      name: entry.name,
      ...(entry.vaultRoot !== undefined ? { vaultRoot: entry.vaultRoot } : {}),
      ...(entry.workspaceRoot !== undefined ? { workspaceRoot: entry.workspaceRoot } : {}),
    })
  }

  /** Record a tree as present in the space but unopenable. */
  private recordUnavailable(
    target: string,
    opts: OpenTreeOptions,
    status: UnavailableStatus,
    reason: string,
  ): UnavailableTree {
    const entry: UnavailableTree = {
      id: unavailableId(target),
      path: target,
      kind: opts.kind ?? 'native',
      name: opts.name ?? defaultName(target),
      ...(opts.vaultRoot !== undefined ? { vaultRoot: opts.vaultRoot } : {}),
      ...(opts.workspaceRoot !== undefined ? { workspaceRoot: opts.workspaceRoot } : {}),
      status,
      reason,
    }

    this.unavailable.set(entry.id, entry)
    this.emit()
    return entry
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
      ...(opts.workspaceRoot !== undefined ? { workspaceRoot: opts.workspaceRoot } : {}),
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
    // An unavailable tree holds no bridge and no lock: closing it is simply
    // taking it out of the space, which is what Close tree means for it too.
    if (this.unavailable.delete(treeId)) {
      this.emit()
      return
    }

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
    this.unavailable.clear()
    this.primaryId = null
    this.emit()
  }

  // -------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------

  get(treeId: string): OpenTree | null {
    return this.trees.get(treeId) ?? null
  }

  /** The trees in the space that would not open, in the order they failed. */
  unavailableList(): UnavailableTree[] {
    return [...this.unavailable.values()]
  }

  /**
   * Any member of the space by id, open or not.
   *
   * Close tree and Show in Finder act on both kinds, and both only ever need
   * the path — which is exactly why the renderer may name an id and never a
   * path of its own (T-02.2-30).
   */
  entry(treeId: string): TreeEntry | null {
    return this.trees.get(treeId) ?? this.unavailable.get(treeId) ?? null
  }

  /**
   * Why this tree cannot be written to, or null when it can be.
   *
   * This is the one place a write is refused for being *about* an unavailable
   * tree, so a damaged journal cannot be appended to through any path that
   * names a tree by id.
   */
  refusalFor(treeId: string): string | null {
    const entry = this.unavailable.get(treeId)
    if (!entry) return null
    return `${refusalCause[entry.status]}; Tapestry will not write to it`
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
  summary(): TreeSummary[] {
    const open: TreeSummary[] = this.list().map((tree) => ({
      id: tree.id,
      name: tree.name,
      kind: tree.kind,
      path: tree.path,
      ...(tree.vaultRoot !== undefined ? { vaultRoot: tree.vaultRoot } : {}),
      ...(tree.workspaceRoot !== undefined ? { workspaceRoot: tree.workspaceRoot } : {}),
      status: 'ok' as const,
    }))

    // Unavailable trees are listed too, with why: dropping them here is how a
    // tree would silently disappear from the space (T-02.2-32).
    const unavailable: TreeSummary[] = this.unavailableList().map((tree) => ({
      id: tree.id,
      name: tree.name,
      kind: tree.kind,
      path: tree.path,
      ...(tree.vaultRoot !== undefined ? { vaultRoot: tree.vaultRoot } : {}),
      ...(tree.workspaceRoot !== undefined ? { workspaceRoot: tree.workspaceRoot } : {}),
      status: tree.status,
      reason: tree.reason,
    }))

    return [...open, ...unavailable]
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
