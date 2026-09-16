/**
 * VaultService — a vault folder becomes a tree, and stays one (D-10, D-13).
 *
 * This runs as a host service in main rather than as a plugin, because it needs
 * the filesystem and the reserved `obsidian.bridge` actor that plugins may not
 * claim (Plan 01, `RESERVED_PLUGIN_ID_PREFIXES`).
 *
 * The contract is one sentence: **the tree records what the files contain.**
 * Every commit it writes is an observation, signed `plugin obsidian.bridge`,
 * and it never writes to a `.md` file — sending Tapestry edits out to the vault
 * is Plan 10's half, deliberately separate from this one.
 */

import { existsSync, lstatSync } from 'fs'
import { isAbsolute, resolve } from 'path'
import { OBSIDIAN_BRIDGE_ACTOR } from '../commands/actor'
import type { OpenTree, TreeEntry, TreeRegistry } from '../trees/registry'
import { buildVaultModel, planReconcile, type ReconcileSummary } from './reconcile'
import { vaultTreeFiles, walkVault } from './vault-fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultStatus {
  /**
   * `reading` is the first import of a vault, `catching-up` is everything
   * after. They are named apart because they feel different: the first says
   * "this is going to take a moment", the second says "you were away".
   */
  kind: 'reading' | 'catching-up' | 'up-to-date'
  done: number
  total: number
}

export interface VaultServiceHooks {
  onStatus?(treeId: string, status: VaultStatus): void
  onCommitted?(treeId: string): void
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function list(paths: string[]): string {
  return paths.join(', ')
}

/**
 * What a catch-up says it saw.
 *
 * One changed file gets a sentence naming it, because that is the case a person
 * actually reads in the history; anything larger is itemised by what happened
 * to it. Neither form claims an author: D-21 is that an observed change is
 * recorded as observed, never guessed at.
 */
function describeChanges(summary: ReconcileSummary): string {
  const { created, modified, deleted } = summary
  if (created.length === 0 && deleted.length === 0 && modified.length === 1) {
    return `observed change to ${modified[0]}`
  }

  const parts: string[] = []
  if (created.length > 0) parts.push(`created ${list(created)}`)
  if (modified.length > 0) parts.push(`modified ${list(modified)}`)
  if (deleted.length > 0) parts.push(`deleted ${list(deleted)}`)
  return `observed changes: ${parts.join('; ')}`
}

/** A whole-second stamp, shared by every commit of one catch-up group (D-23). */
function groupStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ---------------------------------------------------------------------------
// VaultService
// ---------------------------------------------------------------------------

export class VaultService {
  private readonly registry: TreeRegistry
  private readonly hooks: VaultServiceHooks

  constructor(registry: TreeRegistry, hooks: VaultServiceHooks = {}) {
    this.registry = registry
    this.hooks = hooks
  }

  /**
   * Add a vault to the space: open or create `<root>/<name>.tree` and catch up.
   *
   * The tree lives inside the vault folder so the two travel together (D-13) —
   * copy the vault to another machine and its history comes with it.
   */
  async addVault(root: string): Promise<OpenTree> {
    const target = this.requireVaultRoot(root)
    const files = vaultTreeFiles(target)

    const entry: TreeEntry = existsSync(files.treePath)
      ? this.registry.tryOpen(files.treePath, {
          kind: 'vault',
          vaultRoot: target,
          name: files.name,
        })
      : this.registry.create(files.treePath, files.worldName, {
          kind: 'vault',
          vaultRoot: target,
          name: files.name,
        })

    const tree = requireOpen(entry)
    await this.catchUp(tree.id)
    return tree
  }

  /** Open a vault whose tree already exists, then catch up (D-20). */
  async openVault(root: string): Promise<OpenTree> {
    const target = this.requireVaultRoot(root)
    const files = vaultTreeFiles(target)

    const tree = requireOpen(
      this.registry.tryOpen(files.treePath, {
        kind: 'vault',
        vaultRoot: target,
        name: files.name,
      }),
    )
    await this.catchUp(tree.id)
    return tree
  }

  /**
   * Record everything the vault says that the tree does not (D-20).
   *
   * The journal is opened once, by the registry, and reused: reopening it per
   * file would replay the whole history each time, which is what makes a vault
   * with any history at all feel slow.
   */
  async catchUp(treeId: string): Promise<void> {
    const tree = this.registry.get(treeId)
    if (!tree) throw new Error(`Unknown tree ${treeId}`)
    if (!tree.vaultRoot) throw new Error(`${tree.name} is not a vault tree`)

    const root = tree.vaultRoot
    const before = tree.bridge.getNodes()
    const firstImport = before.length === 0
    const phase: VaultStatus['kind'] = firstImport ? 'reading' : 'catching-up'

    const entries = await walkVault(root)
    const total = entries.filter((entry) => entry.kind !== 'dir').length
    this.report(treeId, { kind: phase, done: 0, total })

    const model = await buildVaultModel(root, entries, (done) => {
      this.report(treeId, { kind: phase, done, total })
    })

    const { ops, summary } = planReconcile(
      { nodes: before, edges: tree.bridge.getEdges() },
      model,
    )

    if (ops.length > 0) {
      const base = firstImport
        ? `observed vault ${tree.name}: ${model.notes.size} notes, ` +
          `${model.folders.size} folders, ${model.files.size} files`
        : describeChanges(summary)

      // One stamp for the whole group, so several chunks read as one event
      // rather than as several unrelated ones (research Pitfall 6, D-23).
      const stamp = ops.length > 1 ? groupStamp() : ''

      ops.forEach((chunk, index) => {
        const message =
          ops.length === 1 ? base : `${base} (group ${stamp}, ${index + 1} of ${ops.length})`
        tree.bridge.submitAs(OBSIDIAN_BRIDGE_ACTOR, message, chunk)
      })

      this.hooks.onCommitted?.(treeId)
    }

    this.report(treeId, { kind: 'up-to-date', done: total, total })
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * A vault root must be an absolute path to a real directory that is not a
   * symlink (T-02.2-37). Checked with `lstat`, so a symlink pointing at a
   * directory is refused rather than silently followed out of the vault.
   */
  private requireVaultRoot(root: unknown): string {
    if (typeof root !== 'string' || root.length === 0 || !isAbsolute(root)) {
      return fail('A vault folder must be an absolute path')
    }
    const target = resolve(root)

    let stats
    try {
      stats = lstatSync(target)
    } catch {
      return fail(`There is no folder at ${target}`)
    }
    if (stats.isSymbolicLink()) {
      return fail(`${target} is a symbolic link; choose the vault folder itself`)
    }
    if (!stats.isDirectory()) {
      return fail(`${target} is not a folder`)
    }
    return target
  }

  private report(treeId: string, status: VaultStatus): void {
    try {
      this.hooks.onStatus?.(treeId, status)
    } catch (err) {
      // A status listener must never be able to fail an import.
      console.error('[VaultService] onStatus listener threw:', err)
    }
  }
}

function fail(message: string): never {
  throw new Error(message)
}

/**
 * A vault that will not open is an error here rather than a dashed frame.
 *
 * The frame is what Plan 06 gives a tree that was already in the space; a vault
 * being added right now has nowhere to sit, and the reason belongs in front of
 * the person who just chose the folder.
 */
function requireOpen(entry: TreeEntry): OpenTree {
  if (!('bridge' in entry)) {
    throw new Error(entry.reason)
  }
  return entry
}
