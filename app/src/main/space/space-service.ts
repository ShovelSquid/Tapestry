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
import type { Actor } from '../commands/actor'
import { isSafeTreePath } from '../settings'
import type { SettingsStore } from '../settings'
import type { TreeEntry, TreeRegistry, TreeSummary } from '../trees/registry'
import type { ForestMember, ForestStore } from './forest-store'
import type { TapestryHome } from './home-tree'
import {
  SPACE_NOT_OPEN,
  classifySpace,
  importFromSettings,
  reopenFromPointer,
  type SpacePaths,
  type SpaceProblem,
} from './migrate'
import { moveFrameMessage } from './shapes'

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
      try {
        this.registry.tryOpen(hint, { kind: 'native' })
        restored += 1
      } catch (err) {
        console.error(`[SpaceService] could not restore ${hint}:`, err)
      }
    }
    return restored
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
   * stand-in matches (opened through a path Plan 04 has not yet converted)
   * sits at (0, 0).
   */
  list(): SpaceTreeSummary[] {
    const members = this.forest?.members() ?? []
    return this.registry.summary().map((entry) => {
      const placement = matchMember(members, entry)?.placement
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
    const forest = this.requireForest()
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
      const placement = entry ? matchMember(members, entry)?.placement : undefined
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
  // Closing
  // -------------------------------------------------------------------------

  /** Release the forest and the Tapestry tree. Never rewinds either. */
  close(): void {
    this.forest?.close()
    this.home?.close()
    this.forest = null
    this.home = null
  }

  private requireForest(): ForestStore {
    if (!this.forest) throw new Error(SPACE_NOT_OPEN)
    return this.forest
  }
}

// ---------------------------------------------------------------------------
// Joining the registry to the forest
// ---------------------------------------------------------------------------

/**
 * The stand-in for a registry entry: by digest for an open tree (falling back
 * to a path match on a stand-in whose digest is not yet recorded), by path
 * for a tree that would not open and so has no digest.
 */
function matchMember(
  members: ForestMember[],
  entry: TreeEntry | TreeSummary,
): ForestMember | undefined {
  const path = resolve(entry.path)
  if (entry.id.startsWith('sha256:')) {
    return (
      members.find((m) => m.digest === entry.id) ??
      members.find((m) => m.digest === undefined && resolve(m.pathHint) === path)
    )
  }
  return members.find((m) => resolve(m.pathHint) === path)
}
