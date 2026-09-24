/**
 * WorkspaceService — a folder becomes a tree, and stays one (02.7 D-01..D-06).
 *
 * The contract is the vault's: **the tree records what the files contain.**
 * Observations are signed `plugin workspace.watcher` and never guess an author
 * (D-06). Tapestry's own writes are signed by whoever made them — an agent
 * through the file tools, or a person typing in a window — and before any such
 * write is recorded, a disk state the tree has not yet seen is committed first
 * as an observation, so nobody is credited with a change they did not make.
 *
 * The tree lives in app data (`<userData>/workspaces/<name>-<hash8>.tree`),
 * never inside the workspace, so a git worktree stays clean.
 */

import { existsSync, lstatSync, mkdirSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, resolve } from 'path'
import type { Actor } from '../commands/actor'
import { SYSTEM_ACTOR, WORKSPACE_WATCHER_ACTOR } from '../commands/actor'
import { prepareWriteFor, type CommandHooks } from '../commands/notes'
import type { CommitResult, NodeData } from '../kernel-bridge'
import { writeFileAtomicSync } from '../mirror/atomic-write'
import { entriesFromPaths, isGitWorkTree, listGitFiles, sha256Hex, walkFolder } from '../mirror/fs'
import {
  buildMirrorModel,
  describeMirrorChanges,
  groupStamp,
  planMirror,
  planPathChange,
  planSubspaceMigration,
  readPathState,
  type MirrorModel,
  type PathState,
} from '../mirror/plan'
import { TAPESTRY_TMP_MARKER } from '../mirror/atomic-write'
import type { OpenTree, TreeEntry, TreeRegistry, UnavailableTree } from '../trees/registry'
import { resolveWorkspaceTarget, type OpenWorkspace, type WorkspaceLookup, type WorkspaceTarget } from './sandbox'
import type { CommandResult } from '../commands/notes'
import { validateWorkspaceText } from '../commands/file-tools'
import {
  FILE_PATH,
  isIgnoredWorkspacePath,
  MAX_WORKSPACE_FILES,
  WORKSPACE_FILE_TYPE,
  WORKSPACE_FOLDER_TYPE,
  WORKSPACE_SHAPE,
  WORKSPACE_TEXT_TYPE,
  workspaceTreeFiles,
} from './shapes'

export interface WorkspaceServiceOptions {
  /** `<userData>/workspaces` — where every workspace tree file lives. */
  treesDir: string
  hooks?: CommandHooks
}

interface RootInfo {
  root: string
  realRoot: string
  git: boolean | null
}

/** The mode a file created by an agent is written with, before the umask. */
const NEW_FILE_MODE = 0o644

/** How many times a catch-up rebuilds its model when a write lands meanwhile. */
const MAX_CATCH_UP_ATTEMPTS = 5

function isWorkspaceType(type: string): boolean {
  return type === WORKSPACE_TEXT_TYPE || type === WORKSPACE_FILE_TYPE || type === WORKSPACE_FOLDER_TYPE
}

function requireOpen(entry: TreeEntry): OpenTree {
  if (!('bridge' in entry)) throw new Error(entry.reason)
  return entry
}

function fail(message: string): never {
  throw new Error(message)
}

export class WorkspaceService implements WorkspaceLookup {
  private readonly registry: TreeRegistry
  private readonly treesDir: string
  readonly hooks: CommandHooks
  private readonly roots = new Map<string, RootInfo>()
  private readonly chains = new Map<string, Promise<void>>()

  constructor(registry: TreeRegistry, opts: WorkspaceServiceOptions) {
    this.registry = registry
    this.treesDir = opts.treesDir
    this.hooks = opts.hooks ?? {}
  }

  // -------------------------------------------------------------------------
  // Adding and restoring
  // -------------------------------------------------------------------------

  /** Add a folder as a workspace: open or create its tree, then catch up. */
  async addWorkspace(root: string): Promise<OpenTree> {
    const target = this.requireWorkspaceRoot(root)
    const files = workspaceTreeFiles(this.treesDir, target)
    mkdirSync(this.treesDir, { recursive: true, mode: 0o700 })

    const opts = { kind: 'workspace' as const, workspaceRoot: target, name: files.name }
    const entry = existsSync(files.treePath)
      ? this.registry.tryOpen(files.treePath, opts)
      : this.registry.create(files.treePath, files.worldName, opts)
    const tree = requireOpen(entry)

    this.remember(tree.id, target)
    this.arrangeSubspaces(tree)
    await this.catchUp(tree.id)
    return tree
  }

  /**
   * The restore path: open the remembered tree (or recreate it — the mirror is
   * rebuildable) and catch up on what changed while Tapestry was closed.
   * Catch-up errors are logged, never thrown into launch.
   */
  async openWorkspace(root: string, treePath: string): Promise<OpenTree | UnavailableTree> {
    const target = resolve(root)
    let name = target.slice(target.lastIndexOf('/') + 1)
    const opts = { kind: 'workspace' as const, workspaceRoot: target, name }

    let entry: TreeEntry
    if (existsSync(treePath)) {
      entry = this.registry.tryOpen(treePath, opts)
    } else {
      const files = workspaceTreeFiles(this.treesDir, target)
      name = files.name
      mkdirSync(this.treesDir, { recursive: true, mode: 0o700 })
      entry = this.registry.create(treePath, files.worldName, opts)
    }
    if (!('bridge' in entry)) return entry

    this.remember(entry.id, target)
    try {
      this.arrangeSubspaces(entry)
    } catch (err) {
      console.error(`[WorkspaceService] arranging ${name} into folder subspaces failed:`, err)
    }
    try {
      await this.catchUp(entry.id)
    } catch (err) {
      console.error(`[WorkspaceService] catch-up of ${name} failed:`, err)
    }
    return entry
  }

  /**
   * The one-time arrangement of a tree laid out before folders were subspaces
   * (02.7 D-21): one commit by `system tapestry`, touching only positions,
   * `subspace` and `collapsed`. A tree already arranged writes nothing.
   */
  private arrangeSubspaces(tree: OpenTree): void {
    const ops = planSubspaceMigration(tree.bridge.getNodes(), WORKSPACE_SHAPE)
    if (ops.length === 0) return
    this.requireHealthy(tree)
    prepareWriteFor(tree, SYSTEM_ACTOR, this.hooks)
    const result = tree.bridge.submitAs(
      SYSTEM_ACTOR,
      `arrange workspace ${tree.name} into folder subspaces`,
      ops,
    )
    this.committed(tree.id, SYSTEM_ACTOR, result)
  }

  // -------------------------------------------------------------------------
  // The lookup the sandbox resolves against
  // -------------------------------------------------------------------------

  openWorkspaces(): OpenWorkspace[] {
    const out: OpenWorkspace[] = []
    for (const tree of this.registry.list()) {
      if (tree.kind !== 'workspace') continue
      const info = this.roots.get(tree.id)
      if (!info) continue
      if (info.git === null) info.git = isGitWorkTree(info.realRoot)
      out.push({ tree, root: info.root, realRoot: info.realRoot, git: info.git })
    }
    return out
  }

  /** The open workspace a tree id names, or null. */
  workspaceFor(treeId: string): OpenWorkspace | null {
    return this.openWorkspaces().find((ws) => ws.tree.id === treeId) ?? null
  }

  // -------------------------------------------------------------------------
  // Catch-up (D-06)
  // -------------------------------------------------------------------------

  /** Record everything the folder says that the tree does not. Serialized per tree. */
  catchUp(treeId: string): Promise<void> {
    const previous = this.chains.get(treeId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.runCatchUp(treeId))
    this.chains.set(treeId, next)
    return next
  }

  private async runCatchUp(treeId: string): Promise<void> {
    const tree = this.registry.get(treeId)
    if (!tree) throw new Error(`Unknown tree ${treeId}`)
    const info = this.roots.get(treeId)
    if (!info) throw new Error(`${tree.name} is not an open workspace`)

    let isDir = false
    try {
      isDir = lstatSync(info.realRoot).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) throw new Error(`The workspace folder ${info.root} is missing; nothing was recorded`)

    let model: MirrorModel | null = null
    for (let attempt = 0; attempt < MAX_CATCH_UP_ATTEMPTS; attempt += 1) {
      const before = tree.bridge.status().lastGoodSeq
      const candidate = await this.readModel(tree, info)
      if (tree.bridge.status().lastGoodSeq === before) {
        model = candidate
        break
      }
    }
    if (!model) {
      // An in-process write kept landing while the folder was read; planning
      // against the old model would revert it. The next catch-up will see it.
      console.warn(`[WorkspaceService] ${tree.name} kept changing during catch-up; nothing recorded`)
      return
    }

    const nodes = tree.bridge.getNodes()
    const firstImport = !nodes.some((node) => isWorkspaceType(node.type))
    const { ops, summary } = planMirror({ nodes }, model, WORKSPACE_SHAPE)
    if (ops.length === 0) return

    let texts = 0
    let others = 0
    for (const state of model.paths.values()) {
      if (state.kind === 'text') texts += 1
      else others += 1
    }
    const base = firstImport
      ? `observed workspace ${tree.name}: ${texts} text files, ${others} other files, ${model.folders.size} folders`
      : describeMirrorChanges(summary)
    const stamp = ops.length > 1 ? groupStamp() : ''

    this.requireHealthy(tree)
    prepareWriteFor(tree, WORKSPACE_WATCHER_ACTOR, this.hooks)
    ops.forEach((chunk, index) => {
      const message = ops.length === 1 ? base : `${base} (group ${stamp}, ${index + 1} of ${ops.length})`
      const result = tree.bridge.submitAs(WORKSPACE_WATCHER_ACTOR, message, chunk)
      this.committed(tree.id, WORKSPACE_WATCHER_ACTOR, result)
    })
  }

  private async readModel(tree: OpenTree, info: RootInfo): Promise<MirrorModel> {
    const listing = listGitFiles(info.realRoot)
    let entries
    if (listing.kind === 'git') {
      info.git = true
      const rels = listing.rels.filter(
        (rel) =>
          !rel.split('/').some((s) => s.toLowerCase() === '.git' || s.includes(TAPESTRY_TMP_MARKER)),
      )
      entries = entriesFromPaths(info.realRoot, rels)
    } else {
      info.git = false
      entries = await walkFolder(info.realRoot, isIgnoredWorkspacePath)
    }
    const fileCount = entries.filter((entry) => entry.kind !== 'dir').length
    if (fileCount > MAX_WORKSPACE_FILES) {
      throw new Error(`${tree.name} has more than ${MAX_WORKSPACE_FILES} files; choose a smaller folder`)
    }
    return buildMirrorModel(info.realRoot, entries)
  }

  // -------------------------------------------------------------------------
  // Observing and writing one path
  // -------------------------------------------------------------------------

  /** The workspace node recording `rel`, or null. */
  noteForPath(tree: OpenTree, rel: string): NodeData | null {
    for (const node of tree.bridge.getNodes()) {
      if (!isWorkspaceType(node.type)) continue
      const path = node.props[FILE_PATH]
      if (path && path.value === rel) return node
    }
    return null
  }

  /**
   * Commit whatever the disk says about `rel` that the tree does not yet
   * record, as `plugin workspace.watcher` (D-06 observe-first). `why` is added
   * to the message in parentheses.
   */
  observePath(ws: OpenWorkspace, rel: string, why?: string): PathState {
    const state = readPathState(ws.realRoot, rel)
    this.recordObserved(ws, rel, state, why)
    return state
  }

  /** Commit an already-read disk state as observed, when it differs. */
  recordObserved(ws: OpenWorkspace, rel: string, state: PathState, why?: string): CommitResult | null {
    const tree = ws.tree
    const plan = planPathChange({ nodes: tree.bridge.getNodes() }, rel, state, WORKSPACE_SHAPE)
    if (plan.ops.length === 0) return null

    this.requireHealthy(tree)
    prepareWriteFor(tree, WORKSPACE_WATCHER_ACTOR, this.hooks)
    const base = describeMirrorChanges({
      created: plan.change === 'created' ? [rel] : [],
      modified: plan.change === 'modified' ? [rel] : [],
      deleted: plan.change === 'deleted' ? [rel] : [],
    })
    const message = why ? `${base} (${why})` : base
    const result = tree.bridge.submitAs(WORKSPACE_WATCHER_ACTOR, message, plan.ops)
    this.committed(tree.id, WORKSPACE_WATCHER_ACTOR, result)
    return result
  }

  /**
   * An agent write: the file lands on disk first, then the tree records what
   * it now says, signed by `actor` (D-04).
   */
  commitWrite(
    actor: Actor,
    target: WorkspaceTarget,
    text: string,
    message: string,
  ): { note: string; seq: number; sha256: string } {
    const tree = target.workspace.tree
    this.requireHealthy(tree)
    prepareWriteFor(tree, actor, this.hooks)

    // A new file is 0644 under the process umask; an existing one keeps its
    // mode bits (writeFileAtomicSync reads them when no mode is passed).
    writeFileAtomicSync(target.abs, text, target.exists ? undefined : { mode: NEW_FILE_MODE & ~process.umask() })

    // The recorded text plus any missing ancestor folder notes go into one
    // commit (planPathChange emits the folders first); no ops, no commit.
    const sha256 = sha256Hex(text)
    const recorded = this.recordText(actor, tree, target.rel, text, sha256, message)
    return { ...recorded, sha256 }
  }

  /** Commit `text` as the content of `rel`, signed by `actor`. */
  recordText(
    actor: Actor,
    tree: OpenTree,
    rel: string,
    text: string,
    sha256: string,
    message: string,
  ): { note: string; seq: number } {
    const plan = planPathChange(
      { nodes: tree.bridge.getNodes() },
      rel,
      { kind: 'text', text, sha256 },
      WORKSPACE_SHAPE,
    )
    if (plan.ops.length === 0) {
      const existing = this.noteForPath(tree, rel)
      return { note: existing?.id ?? '', seq: tree.bridge.status().lastGoodSeq }
    }
    const result = tree.bridge.submitAs(actor, message, plan.ops)
    this.committed(tree.id, actor, result)
    const existing = this.noteForPath(tree, rel)
    const note = existing?.id ?? result.nodeIds[result.nodeIds.length - 1] ?? ''
    return { note, seq: result.seq }
  }

  // -------------------------------------------------------------------------
  // The human save path (D-04, D-05)
  // -------------------------------------------------------------------------

  /**
   * Save a person's edit from a file window. The edit is committed first, as
   * the person; then, if the file still matches the text the window started
   * from (`baseSha256`), it is written. Otherwise the file wins: nothing is
   * written, the file's state is recorded as observed, and the person's edit
   * stays in history (02.2 D-11). The path comes from the note, never the
   * caller (T-02.7-07).
   */
  saveFile(
    actor: Actor,
    treeId: string,
    nodeId: string,
    text: string,
    baseSha256: string | null,
  ): CommandResult<{
    note: string
    path: string
    written: boolean
    fileWins: boolean
    sha256: string | null
    seq: number
  }> {
    try {
      const ws = this.workspaceFor(treeId)
      if (!ws) return { ok: false, error: `${treeId} is not an open workspace` }
      const tree = ws.tree
      const node = tree.bridge.getNode(nodeId)
      if (!node || node.type !== WORKSPACE_TEXT_TYPE) {
        return { ok: false, error: `${nodeId} is not a text file in ${tree.name}` }
      }
      const pathProp = node.props[FILE_PATH]
      if (!pathProp || typeof pathProp.value !== 'string') {
        return { ok: false, error: `${nodeId} has no file path` }
      }
      const rel = pathProp.value

      const resolved = resolveWorkspaceTarget(this, { workspace: tree.id, path: rel }, 'write')
      if (!resolved.ok) return resolved
      const target = resolved.value

      const invalid = validateWorkspaceText(text)
      if (invalid) return { ok: false, error: invalid }

      this.requireHealthy(tree)
      prepareWriteFor(tree, actor, this.hooks)
      const disk = readPathState(ws.realRoot, rel)

      // The person's edit goes into history first, whatever happens next.
      const sha256 = sha256Hex(text)
      const edited = this.recordText(actor, tree, rel, text, sha256, `edit ${rel}`)

      if (disk.kind !== 'text' || disk.sha256 !== baseSha256) {
        const observed = this.recordObserved(
          ws,
          rel,
          disk,
          "the file changed before Tapestry's edit was written; the file wins",
        )
        const current = this.noteForPath(tree, rel)
        return {
          ok: true,
          value: {
            note: current?.id ?? edited.note,
            path: rel,
            written: false,
            fileWins: true,
            sha256: disk.kind === 'text' ? disk.sha256 : null,
            seq: observed?.seq ?? edited.seq,
          },
        }
      }

      try {
        writeFileAtomicSync(target.abs, text)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        this.recordObserved(ws, rel, readPathState(ws.realRoot, rel), `Tapestry's write failed: ${reason}`)
        return { ok: false, error: `Could not write ${rel} -- ${reason}. Your edit is kept in history.` }
      }

      return {
        ok: true,
        value: { note: edited.note, path: rel, written: true, fileWins: false, sha256, seq: edited.seq },
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  requireHealthy(tree: OpenTree): void {
    if (tree.bridge.status().kind !== 'Ok') {
      fail(`${tree.name}'s tree is damaged; Tapestry will not write to it`)
    }
  }

  private committed(treeId: string, actor: Actor, result: CommitResult): void {
    try {
      this.hooks.onCommitted?.(treeId, actor, result)
    } catch (err) {
      console.error('[WorkspaceService] onCommitted listener threw:', err)
    }
  }

  private remember(treeId: string, root: string): void {
    let realRoot = root
    try {
      realRoot = realpathSync(root)
    } catch {
      // A missing folder keeps its spelling; catch-up will say it is missing.
    }
    this.roots.set(treeId, { root, realRoot, git: null })
  }

  /**
   * A workspace root is an absolute path to a real directory that is not a
   * symlink, and not `/` or the home folder (T-02.7-08).
   */
  private requireWorkspaceRoot(root: unknown): string {
    if (typeof root !== 'string' || root.length === 0 || !isAbsolute(root)) {
      return fail('A workspace folder must be an absolute path')
    }
    const target = resolve(root)
    let stats
    try {
      stats = lstatSync(target)
    } catch {
      return fail(`There is no folder at ${target}`)
    }
    if (stats.isSymbolicLink()) {
      return fail(`${target} is a symbolic link; choose the workspace folder itself`)
    }
    if (!stats.isDirectory()) return fail(`${target} is not a folder`)

    const real = realpathSync(target)
    const home = (() => {
      try {
        return realpathSync(homedir())
      } catch {
        return homedir()
      }
    })()
    if (real === '/' || target === '/' || real === home || target === homedir()) {
      return fail(`${target} is too broad to open as a workspace; choose a project folder`)
    }
    return target
  }
}
