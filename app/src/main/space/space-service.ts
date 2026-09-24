/**
 * SpaceService — the space: which trees it holds and where their frames sit
 * (2.6 D-01, D-02, D-06, D-11).
 *
 * This runs as a host service in main rather than as a plugin, for the same
 * reason `VaultService` does: the arrangement is host state. The forest and
 * the Tapestry tree are held here, outside `TreeRegistry`, so plugins and
 * agents (who reach trees only through the registry) can neither read nor
 * write them (RESEARCH Pitfall 2, T-2.6-02).
 *
 * The join between the two worlds is by member identity: a registry entry is
 * matched to a forest stand-in by digest, or by path hint while the digest is
 * not yet known. A registry id is used only to look things up and is never
 * written: on disk a member is its path hint plus digest (D-03).
 *
 * Every write takes an `Actor` main has already resolved; nothing a caller
 * passes names who made it (T-2.6-11). There is exactly one forest (D-07),
 * and its bridge is never rewound, so every later drag can commit (D-09).
 */

import { basename, dirname, resolve } from 'path'
import { existsSync } from 'fs'
import { SYSTEM_ACTOR, type Actor } from '../commands/actor'
import { isSafeTreePath } from '../settings'
import type { SettingsStore } from '../settings'
import type { OpenTree, TreeEntry, TreeRegistry, TreeSummary } from '../trees/registry'
import type { ForestMember, ForestStore, MemberSeed } from './forest-store'
import type { TapestryHome } from './home-tree'
import {
  SPACE_NOT_OPEN,
  classifySpace,
  importFromSettings,
  reopenFromPointer,
  type SpacePaths,
  type SpaceProblem,
} from './migrate'
import {
  addTreeMessage,
  moveFrameMessage,
  recordIdentityMessage,
  removeTreeMessage,
} from './shapes'

/**
 * Where a new member's frame goes before the renderer measures it: right of
 * the rightmost frame, at its height. 480 and 64 are FRAME_MIN_WIDTH and
 * FRAME_GAP from renderer/layout/frames.ts, repeated rather than imported
 * because main and renderer are separate bundles.
 */
const FRAME_MIN_WIDTH = 480
const FRAME_GAP = 64

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpaceServiceHooks {
  /** Called for each restored member path, so main can approve it for IPC. */
  approvePath?(path: string): void
  /** Restore a vault member; without it, vault members stay in the forest unopened. */
  restoreVault?(req: { treePath: string; vaultRoot: string; name: string }): Promise<void>
}

export interface SpaceServiceOptions {
  registry: TreeRegistry
  settings: SettingsStore
  paths: SpacePaths
  hooks?: SpaceServiceHooks
}

/** One tree as the renderer sees it, with its frame from the forest. */
export interface SpaceTreeSummary extends TreeSummary {
  frame: { x: number; y: number }
}

// ---------------------------------------------------------------------------
// SpaceService
// ---------------------------------------------------------------------------

export class SpaceService {
  private readonly registry: TreeRegistry
  private readonly settings: SettingsStore
  private readonly paths: SpacePaths
  private readonly hooks: SpaceServiceHooks

  private home: TapestryHome | null = null
  private forest: ForestStore | null = null

  constructor(options: SpaceServiceOptions) {
    this.registry = options.registry
    this.settings = options.settings
    this.paths = options.paths
    this.hooks = options.hooks ?? {}
  }

  /** Whether the Tapestry tree and the forest are open. */
  get ready(): boolean {
    return this.home !== null && this.forest !== null
  }

  // -------------------------------------------------------------------------
  // Launch
  // -------------------------------------------------------------------------

  /**
   * Open the space: import on first launch (case A) or reopen from the
   * pointer (cases D-H), then restore every member from the forest.
   *
   * A problem opens no member and writes nothing (case G: if the forest is
   * locked, every member would be too).
   */
  async start(): Promise<{ problem: SpaceProblem | null; restored: number }> {
    if (this.ready) throw new Error('The space is already open')

    const pointer = this.settings.getTapestryPointer()
    const homePath = pointer ?? this.paths.home
    const launch = classifySpace({
      pointer,
      homeExists: existsSync(homePath),
      forestExists: existsSync(this.paths.forest),
    })

    let opened: { home: TapestryHome; forest: ForestStore } | SpaceProblem
    switch (launch) {
      case 'import':
        opened = importFromSettings(this.settings, this.paths)
        break
      case 'reopen':
        opened = reopenFromPointer(homePath)
        break
      case 'recover-home':
        // Case B: approved as (i); Plan 06 implements it. Until then, write nothing.
        opened = { kind: 'not-set-up', path: homePath }
        break
      case 'recover-forest':
        // Case C: approved as (i); Plan 06 implements it. Until then, write nothing.
        opened = { kind: 'not-set-up', path: this.paths.forest }
        break
    }

    if ('kind' in opened) return { problem: opened, restored: 0 }

    this.home = opened.home
    this.forest = opened.forest
    const restored = await this.restoreMembers(opened.forest)
    return { problem: null, restored }
  }

  /** Open every member through the registry, in stand-in order. */
  private async restoreMembers(forest: ForestStore): Promise<number> {
    let restored = 0
    for (const member of forest.members()) {
      const hint = member.pathHint
      if (!isSafeTreePath(hint)) {
        console.error(`[SpaceService] skipped member ${member.nodeId}: unusable path hint`)
        continue
      }

      if (member.kind === 'vault') {
        // Kept in the forest either way; restored only when main supplies the
        // vault launch path (RESEARCH Pitfall 9).
        if (!this.hooks.restoreVault) continue
        const vaultRoot = member.vaultRootHint ?? dirname(hint)
        this.approve(hint)
        try {
          await this.hooks.restoreVault({ treePath: hint, vaultRoot, name: basename(vaultRoot) })
          restored += 1
        } catch (err) {
          console.error(`[SpaceService] could not restore vault ${hint}:`, err)
        }
        continue
      }

      this.approve(hint)
      let entry: TreeEntry
      try {
        entry = this.registry.tryOpen(hint, { kind: 'native' })
        restored += 1
      } catch (err) {
        console.error(`[SpaceService] could not restore ${hint}:`, err)
        continue
      }
      if (isOpen(entry)) this.settleIdentityQuietly(member.nodeId, entry)
    }
    return restored
  }

  /** Record a restored member's identity without letting a failure stop the launch. */
  private settleIdentityQuietly(nodeId: string, tree: OpenTree): void {
    try {
      this.settleIdentity(nodeId, tree)
    } catch (err) {
      console.error(`[SpaceService] could not record the identity of ${tree.path}:`, err)
    }
  }

  /** Call the approvePath hook without letting it break the launch. */
  private approve(path: string): void {
    try {
      this.hooks.approvePath?.(path)
    } catch (err) {
      console.error('[SpaceService] approvePath hook threw:', err)
    }
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * The registry's trees, each with its frame from the forest. A tree no
   * stand-in matches (which the membership handlers never leave behind)
   * sits at (0, 0).
   */
  list(): SpaceTreeSummary[] {
    const members = this.forest?.members() ?? []
    return this.registry.summary().map((entry) => {
      const placement = this.memberFor(entry, members)?.placement
      return { ...entry, frame: placement ? { x: placement.x, y: placement.y } : { x: 0, y: 0 } }
    })
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /**
   * Record one drop, the dragged frame first and every frame it pushed aside
   * after it, as exactly one forest commit (D-11).
   *
   * The batch is untrusted (T-2.6-05): it is checked in full before anything
   * is written, and a batch that changes nothing makes no history entry.
   */
  moveFrames(moves: unknown, actor: Actor): { committed: boolean } {
    const forest = this.requireReady()
    const members = forest.members()

    if (!Array.isArray(moves) || moves.length === 0 || moves.length > members.length) {
      throw new Error(`Frame moves must be a list of 1 to ${members.length} moves`)
    }

    const seen = new Set<string>()
    const resolved: Array<{ name: string; edgeId: string; x: number; y: number; changed: boolean }> =
      []
    for (const move of moves) {
      if (!move || typeof move !== 'object' || Array.isArray(move)) {
        throw new Error('Each frame move must be an object')
      }
      const { treeId, x, y } = move as Record<string, unknown>
      if (typeof treeId !== 'string') throw new Error('A frame move needs a tree id')
      if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
        throw new Error(`The frame for ${treeId} needs finite x and y`)
      }
      if (seen.has(treeId)) throw new Error(`Tree ${treeId} is moved twice in one drop`)
      seen.add(treeId)

      const entry = this.registry.entry(treeId)
      const placement = entry ? this.memberFor(entry, members)?.placement : undefined
      if (!entry || !placement) throw new Error(`Unknown tree ${treeId}`)
      if (resolved.some((r) => r.edgeId === placement.edgeId)) {
        throw new Error(`Tree ${treeId} is moved twice in one drop`)
      }

      resolved.push({
        name: entry.name,
        edgeId: placement.edgeId,
        x,
        y,
        changed: x !== placement.x || y !== placement.y,
      })
    }

    const changes = resolved.filter((r) => r.changed)
    if (changes.length === 0) return { committed: false }

    forest.setOrigins(
      changes.map(({ edgeId, x, y }) => ({ edgeId, x, y })),
      actor,
      moveFrameMessage(changes[0].name, changes.length - 1),
    )
    return { committed: true }
  }

  // -------------------------------------------------------------------------
  // Membership (D-01, D-02, D-03)
  // -------------------------------------------------------------------------

  /**
   * Put a registry entry in the forest, signed by the person who added it.
   *
   * A tree that is already recorded at this path keeps its frame (re-adding
   * never moves it, as with the old settings list); only a missing digest is
   * filled in. Otherwise a new stand-in and placement are written in one
   * commit, right of the rightmost frame. An open tree then has its digest
   * recorded by the system (CONTEXT discretion: the first open is the system's).
   */
  addMember(entry: TreeEntry, actor: Actor): { committed: boolean } {
    const forest = this.requireReady()
    const members = forest.members()

    const recorded = this.memberFor(entry, members)
    if (recorded && samePath(recorded.pathHint, entry.path)) {
      return isOpen(entry) ? this.settleIdentity(recorded.nodeId, entry) : { committed: false }
    }

    const seed: MemberSeed = {
      kind: entry.kind,
      pathHint: entry.path,
      ...(entry.kind === 'vault' && entry.vaultRoot !== undefined
        ? { vaultRootHint: entry.vaultRoot }
        : {}),
      origin: nextFrameOrigin(members),
    }
    const { nodeId } = forest.addMember(seed, actor, addTreeMessage(entry.name))
    if (isOpen(entry)) this.settleIdentity(nodeId, entry)
    return { committed: true }
  }

  /**
   * Write an open tree's digest to its stand-in once, signed by the system.
   * A stand-in that already has one is left alone, so a later launch writes
   * nothing.
   */
  recordIdentity(entry: OpenTree): { committed: boolean } {
    const forest = this.requireReady()
    const standIn = this.memberFor(entry, forest.members())
    if (!standIn) return { committed: false }
    return this.settleIdentity(standIn.nodeId, entry)
  }

  /**
   * Take a tree out of the forest, signed by the person. Call it before
   * `registry.close`, while the registry entry still joins to its stand-in.
   * A tree that is not a member writes nothing.
   */
  removeMember(treeId: string, actor: Actor): { committed: boolean } {
    const forest = this.requireReady()
    const entry = this.registry.entry(treeId)
    if (!entry) return { committed: false }
    const standIn = this.memberFor(entry, forest.members())
    if (!standIn) return { committed: false }
    forest.removeMember(standIn.nodeId, actor, removeTreeMessage(entry.name))
    return { committed: true }
  }

  /** Write the digest of `tree` to stand-in `nodeId` if it has none yet. */
  private settleIdentity(nodeId: string, tree: OpenTree): { committed: boolean } {
    const forest = this.requireReady()
    const standIn = forest.members().find((m) => m.nodeId === nodeId)
    if (!standIn || standIn.digest !== undefined) return { committed: false }
    forest.writeMemberFacts(
      [{ nodeId, digest: tree.id }],
      [],
      SYSTEM_ACTOR,
      recordIdentityMessage(tree.name),
    )
    return { committed: true }
  }

  /**
   * The stand-in for a registry entry (the join rule `list`, `moveFrames`
   * and membership all use): by digest for an open tree, falling back to a
   * path match on a stand-in whose digest is not yet recorded; by path for a
   * tree that would not open and so has no digest.
   */
  private memberFor(
    entry: TreeEntry | TreeSummary,
    members: ForestMember[] = this.forest?.members() ?? [],
  ): ForestMember | undefined {
    if (entry.id.startsWith('sha256:')) {
      return (
        members.find((m) => m.digest === entry.id) ??
        members.find((m) => m.digest === undefined && samePath(m.pathHint, entry.path))
      )
    }
    return members.find((m) => samePath(m.pathHint, entry.path))
  }

  // -------------------------------------------------------------------------
  // Closing
  // -------------------------------------------------------------------------

  /** Release the forest and the Tapestry tree. Never rewinds either. */
  close(): void {
    this.forest?.close()
    this.home?.close()
    this.forest = null
    this.home = null
  }

  /** The forest, or the approved 4.9 refusal when the space is not open. */
  private requireReady(): ForestStore {
    if (!this.forest || !this.home) throw new Error(SPACE_NOT_OPEN)
    return this.forest
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isOpen(entry: TreeEntry): entry is OpenTree {
  return 'bridge' in entry
}

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b)
}

/** Right of the rightmost placed frame, at its height; (0, 0) in an empty forest. */
function nextFrameOrigin(members: ForestMember[]): { x: number; y: number } {
  let rightmost: { x: number; y: number } | null = null
  for (const member of members) {
    const p = member.placement
    if (p && (rightmost === null || p.x > rightmost.x)) rightmost = p
  }
  if (rightmost === null) return { x: 0, y: 0 }
  return { x: rightmost.x + FRAME_MIN_WIDTH + FRAME_GAP, y: rightmost.y }
}
