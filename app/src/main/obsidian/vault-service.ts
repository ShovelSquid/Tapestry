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

import { createHash } from 'crypto'
import { existsSync, lstatSync } from 'fs'
import { rename, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'
import type { Actor } from '../commands/actor'
import { OBSIDIAN_BRIDGE_ACTOR } from '../commands/actor'
import type { NodeData } from '../kernel-bridge'
import type { OpenTree, TreeEntry, TreeRegistry } from '../trees/registry'
import { buildVaultModel, planReconcile, type ReconcileSummary } from './reconcile'
import { MD_PATH, MD_SHA256, MD_TEXT } from './shapes'
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

    // Predicted ids let a note and the connections to it go into one commit
    // (D-31). They are read from the journal head, so a rewound world has none
    // to offer; the reconciler then creates the nodes and leaves their edges
    // for the next catch-up rather than writing them against a guess.
    let nextIds
    try {
      nextIds = tree.bridge.getNextIds()
    } catch {
      nextIds = undefined
    }

    const { ops, summary } = planReconcile(
      { nodes: before, edges: tree.bridge.getEdges() },
      model,
      nextIds,
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

  /**
   * Writes `text` to a vault note's `.md` file and records the tree's own
   * `md.text`/`md.sha256` to match (02.3-09 D-25) — the one and only place
   * a byte ever moves from Tapestry into the vault. `threads/vault-thread.ts`
   * calls this after a vault thread's `ThreadService` batch flushes; nothing
   * else in the codebase writes to a vault file, matching this class's own
   * header comment ("it never writes to a `.md` file" was true until this
   * method existed to be that one path, not a second one beside it).
   *
   * A write whose sha256 already matches the tree's own record is skipped
   * entirely (no file touch, no commit) — the same "an unchanged catch-up
   * writes nothing" discipline `catchUp` already keeps, so Tapestry's own
   * repeated flushes of unchanged text can never echo into the journal.
   *
   * The write is atomic (write a sibling temp file, then rename), and the
   * temp name matches `vault-fs.ts`'s own `.*.tapestry-tmp` ignore pattern so
   * a concurrent vault walk never trips over it mid-write.
   */
  async writeThreadFile(treeId: string, nodeId: string, text: string, actor: Actor): Promise<void> {
    const tree = this.registry.get(treeId)
    if (!tree || !tree.vaultRoot) {
      throw new Error(`${treeId} is not an open vault tree`)
    }
    const node = tree.bridge.getNode(nodeId)
    if (!node) {
      throw new Error(`Unknown node ${nodeId} in ${tree.name}`)
    }
    const relPath = stringProp(node, MD_PATH)
    if (!relPath) {
      throw new Error(`${nodeId} has no ${MD_PATH}; it is not a mirrored vault note`)
    }

    const bytes = Buffer.from(text, 'utf-8')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (stringProp(node, MD_SHA256) === sha256) {
      return
    }

    const root = resolve(tree.vaultRoot)
    const abs = resolve(root, ...relPath.split('/'))
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error(`refusing to write outside the vault: ${relPath}`)
    }

    const tmp = join(dirname(abs), `.${basename(abs)}.${process.pid}-${Date.now()}.tapestry-tmp`)
    await writeFile(tmp, bytes)
    await rename(tmp, abs)

    tree.bridge.submitAs(actor, `Thread write reaches ${relPath}`, [
      { op: 'setProperty', target: nodeId, key: MD_TEXT, type: 'text', value: text },
      { op: 'setProperty', target: nodeId, key: MD_SHA256, type: 'text', value: sha256 },
    ])

    this.hooks.onCommitted?.(treeId)
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

/** A node's own string property, or `null` when absent or a different type. */
function stringProp(node: NodeData, key: string): string | null {
  const prop = node.props[key]
  return prop && typeof prop.value === 'string' ? prop.value : null
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
