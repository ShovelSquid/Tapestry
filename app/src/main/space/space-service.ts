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
import {
  TreeIdentityClash,
  type ExpectedTree,
  type OpenTree,
  type TreeEntry,
  type TreeRegistry,
  type TreeSummary,
} from '../trees/registry'
import type { ForestMember, ForestStore, MemberSeed } from './forest-store'
import type { TapestryHome } from './home-tree'
import {
  SPACE_NOT_OPEN,
  classifySpace,
  differentWorldReason,
  importFromSettings,
  reopenFromPointer,
  reservedFileRefusal,
  type SpacePaths,
  type SpaceProblem,
} from './migrate'
import {
  addTreeMessage,
  forgetDuplicateMessage,
  moveFrameMessage,
  recordIdentityMessage,
  redoMoveFrameMessage,
  removeTreeMessage,
  undoMoveFrameMessage,
} from './shapes'

/**
 * Where a new member's frame goes before the renderer measures it: right of
 * the rightmost frame, at its height. 480 and 64 are FRAME_MIN_WIDTH and
 * FRAME_GAP from renderer/layout/frames.ts, repeated rather than imported
 * because main and renderer are separate bundles.
 */
const FRAME_MIN_WIDTH = 480
const FRAME_GAP = 64

/**
 * How many drops frame undo and redo remember in one session (T-2.6-17).
 * Pushing past it forgets the oldest; the forest's history keeps everything.
 */
export const FRAME_HISTORY_LIMIT = 100

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpaceServiceHooks {
  /** Called for each restored member path, so main can approve it for IPC. */
  approvePath?(path: string): void
  /**
   * Restore a vault member; without it, vault members stay in the forest
   * unopened. `expect` is the member's recorded digest and the approved
   * reason, for the hook to pass to `registry.tryOpen` (D-03, Pitfall 5).
   */
  restoreVault?(req: {
    treePath: string
    vaultRoot: string
    name: string
    expect?: ExpectedTree
  }): Promise<void>
}

export interface SpaceServiceOptions {
  registry: TreeRegistry
  settings: SettingsStore
  paths: SpacePaths
  hooks?: SpaceServiceHooks
  /** Steps each frame-history stack keeps; defaults to FRAME_HISTORY_LIMIT. */
  frameHistoryLimit?: number
}

/** One tree as the renderer sees it, with its frame from the forest. */
export interface SpaceTreeSummary extends TreeSummary {
  frame: { x: number; y: number }
}

/**
 * One drop as frame undo remembers it (D-09, RESEARCH Pattern 3): every
 * placement it changed, with the origin read from the forest before the write
 * (`before`) and the origin written (`after`). `name` is the dragged frame.
 */
interface FrameStep {
  name: string
  entries: Array<{
    edgeId: string
    before: { x: number; y: number }
    after: { x: number; y: number }
  }>
}

/** What a frame undo or redo did, and how many steps each way remain. */
export interface FrameStepResult {
  committed: boolean
  undoable: number
  redoable: number
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

  // Frame undo and redo for this session (D-08, D-09). In memory only: the
  // forest's history is the durable record, and a relaunch starts empty.
  private readonly frameHistoryLimit: number
  private undoSteps: FrameStep[] = []
  private redoSteps: FrameStep[] = []

  constructor(options: SpaceServiceOptions) {
    this.registry = options.registry
    this.settings = options.settings
    this.paths = options.paths
    this.hooks = options.hooks ?? {}
    const limit = options.frameHistoryLimit ?? FRAME_HISTORY_LIMIT
    this.frameHistoryLimit = Number.isInteger(limit) && limit > 0 ? limit : FRAME_HISTORY_LIMIT
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
    // Tapestry's own files are never members (RESEARCH Pitfall 4). Reserved
    // before restoring, so a hand-edited forest naming itself is refused too.
    this.registry.setReserved({
      paths: [opened.forest.path, opened.home.path],
      ids: [opened.forest.digest(), opened.home.digest()],
      refusal: reservedFileRefusal,
    })
    const restored = await this.restoreMembers(opened.forest)
    return { problem: null, restored }
  }

  /**
   * Open every member through the registry, in stand-in order.
   *
   * Restore is fold-safe: a fold can rewrite or delete a stand-in the loop
   * has not reached yet, so each stand-in's facts are read again just before
   * it is opened. One whose world is already open (through a stand-in folded
   * into it) is skipped, so a world never appears twice.
   */
  private async restoreMembers(forest: ForestStore): Promise<number> {
    let restored = 0
    for (const nodeId of forest.members().map((m) => m.nodeId)) {
      const member = forest.members().find((m) => m.nodeId === nodeId)
      if (!member) continue
      if (member.digest !== undefined && this.registry.get(member.digest)) continue

      const hint = member.pathHint
      if (!isSafeTreePath(hint)) {
        console.error(`[SpaceService] skipped member ${member.nodeId}: unusable path hint`)
        continue
      }
      // A stand-in with a digest opens only as that world; a different world
      // at its path is listed unavailable and nothing is written (Pitfall 5).
      const expect: ExpectedTree | undefined =
        member.digest !== undefined
          ? { id: member.digest, reason: differentWorldReason(hint) }
          : undefined

      if (member.kind === 'vault') {
        // Kept in the forest either way; restored only when main supplies the
        // vault launch path (RESEARCH Pitfall 9).
        if (!this.hooks.restoreVault) continue
        const vaultRoot = member.vaultRootHint ?? dirname(hint)
        this.approve(hint)
        try {
          await this.hooks.restoreVault({
            treePath: hint,
            vaultRoot,
            name: basename(vaultRoot),
            ...(expect ? { expect } : {}),
          })
          restored += 1
        } catch (err) {
          if (err instanceof TreeIdentityClash && member.digest === undefined) {
            this.foldQuietly(member, err)
          } else {
            console.error(`[SpaceService] could not restore vault ${hint}:`, err)
          }
          continue
        }
        const tree = this.registry.list().find((t) => samePath(t.path, hint))
        if (tree && (member.digest === undefined || member.digest === tree.id)) {
          this.settleIdentityQuietly(member.nodeId, tree)
        }
        continue
      }

      this.approve(hint)
      let entry: TreeEntry
      try {
        entry = this.registry.tryOpen(hint, { kind: 'native', ...(expect ? { expect } : {}) })
        restored += 1
      } catch (err) {
        if (err instanceof TreeIdentityClash && member.digest === undefined) {
          this.foldQuietly(member, err)
        } else {
          console.error(`[SpaceService] could not restore ${hint}:`, err)
        }
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

  /** Fold a duplicate found at launch without letting a failure stop the launch. */
  private foldQuietly(standIn: ForestMember, clash: TreeIdentityClash): void {
    try {
      this.foldDuplicate(standIn, clash)
    } catch (err) {
      console.error(`[SpaceService] could not fold ${standIn.pathHint}:`, err)
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
    const resolved: Array<{
      name: string
      edgeId: string
      x: number
      y: number
      before: { x: number; y: number }
      changed: boolean
    }> = []
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
        // The stored origin, read from the forest: frame undo writes this
        // back, and the renderer never supplies it (T-2.6-16).
        before: { x: placement.x, y: placement.y },
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

    this.pushStep(this.undoSteps, {
      name: changes[0].name,
      entries: changes.map(({ edgeId, x, y, before }) => ({ edgeId, before, after: { x, y } })),
    })
    this.redoSteps = []
    return { committed: true }
  }

  // -------------------------------------------------------------------------
  // Frame undo and redo (D-08, D-09)
  // -------------------------------------------------------------------------

  /**
   * Put the last recorded drop back, as a new commit signed by `actor`.
   *
   * The forest is never rewound (D-09): a rewound forest refuses the next
   * drag. Instead the origins read from the forest before the drop are
   * written again. An entry applies only while its placement is still live
   * and still at the origin the drop wrote; one moved since (by a fit, or by
   * a stand-in removed) is skipped. A step where nothing applies writes
   * nothing and is still consumed.
   */
  undoFrames(actor: Actor): FrameStepResult {
    return this.stepFrames(this.undoSteps, this.redoSteps, actor, undoMoveFrameMessage)
  }

  /** The mirror of `undoFrames`: put an undone drop forward again. */
  redoFrames(actor: Actor): FrameStepResult {
    return this.stepFrames(this.redoSteps, this.undoSteps, actor, redoMoveFrameMessage)
  }

  private stepFrames(
    from: FrameStep[],
    to: FrameStep[],
    actor: Actor,
    message: (name: string) => string,
  ): FrameStepResult {
    const forest = this.requireReady()
    const step = from.pop()
    if (!step) return this.frameStepResult(false)

    const live = new Map<string, { x: number; y: number }>()
    for (const member of forest.members()) {
      if (member.placement) live.set(member.placement.edgeId, member.placement)
    }
    const applied = step.entries.filter((entry) => {
      const current = live.get(entry.edgeId)
      return current !== undefined && current.x === entry.after.x && current.y === entry.after.y
    })
    if (applied.length === 0) return this.frameStepResult(false)

    forest.setOrigins(
      applied.map(({ edgeId, before }) => ({ edgeId, x: before.x, y: before.y })),
      actor,
      message(step.name),
    )
    this.pushStep(to, {
      name: step.name,
      entries: applied.map(({ edgeId, before, after }) => ({ edgeId, before: after, after: before })),
    })
    return this.frameStepResult(true)
  }

  private pushStep(stack: FrameStep[], step: FrameStep): void {
    stack.push(step)
    while (stack.length > this.frameHistoryLimit) stack.shift()
  }

  private frameStepResult(committed: boolean): FrameStepResult {
    return { committed, undoable: this.undoSteps.length, redoable: this.redoSteps.length }
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

    // The person opened a member's world from a new path: its old hint is
    // stale. Reuse the stand-in, frame and all, and update the hint in one
    // commit signed by the person (CONTEXT discretion). This is the only
    // way a moved file is found again; there is no filesystem search. A
    // copy of an open world never gets here: the registry refuses it first.
    if (recorded && isOpen(entry) && recorded.digest === entry.id) {
      forest.writeMemberFacts(
        [{ nodeId: recorded.nodeId, ...hintsOf(entry) }],
        [],
        actor,
        addTreeMessage(entry.name),
      )
      this.dropStaleRecord(recorded.pathHint, entry.path)
      return { committed: true }
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

  /**
   * Try an unavailable member again (UI-SPEC "Reopen tree"). On success its
   * identity is recorded as on any first open. If its world turns out to be
   * open through another member already, the digest-less stand-in is folded
   * away and the clash is rethrown, so the handler still reports it.
   */
  reopenMember(treeId: string): TreeEntry | null {
    const entry = this.registry.entry(treeId)
    const standIn = entry && this.forest ? this.memberFor(entry) : undefined

    let reopened: TreeEntry | null
    try {
      reopened = this.registry.reopen(treeId)
    } catch (err) {
      if (err instanceof TreeIdentityClash && standIn && standIn.digest === undefined) {
        this.foldDuplicate(standIn, err)
      }
      throw err
    }
    if (reopened && isOpen(reopened) && standIn) this.settleIdentity(standIn.nodeId, reopened)
    return reopened
  }

  /**
   * Record that a member now lives elsewhere (2.2's `vault:locate`): one
   * commit signed by the person, updating the path hint and, for a vault,
   * the vault root hint. A member already recorded there writes nothing.
   */
  relocateMember(
    treeId: string,
    treePath: string,
    vaultRoot: string | undefined,
    actor: Actor,
  ): { committed: boolean } {
    const forest = this.requireReady()
    const entry = this.registry.entry(treeId)
    const standIn = entry ? this.memberFor(entry, forest.members()) : undefined
    if (!entry || !standIn) throw new Error(`Unknown tree ${treeId}`)

    const pathHint = resolve(treePath)
    const vaultRootHint = vaultRoot !== undefined ? resolve(vaultRoot) : undefined
    const change = {
      nodeId: standIn.nodeId,
      ...(pathHint !== standIn.pathHint ? { pathHint } : {}),
      ...(vaultRootHint !== undefined && vaultRootHint !== standIn.vaultRootHint
        ? { vaultRootHint }
        : {}),
    }
    if (change.pathHint === undefined && change.vaultRootHint === undefined) {
      return { committed: false }
    }
    forest.writeMemberFacts([change], [], actor, addTreeMessage(entry.name))
    return { committed: true }
  }

  /**
   * Write the digest of `tree` to stand-in `nodeId` if it has none yet,
   * signed by the system.
   *
   * If another stand-in already carries that digest, the two are one world
   * (RESEARCH Pitfall 10). Its tree cannot be open, since `tree` is: so the
   * established stand-in takes the path that opened, keeping its own frame,
   * and the digest-less one is deleted, in one system commit naming both.
   * Its frame stays in history. This happens only because the person once
   * added the path that opened; there is never a filesystem search.
   */
  private settleIdentity(nodeId: string, tree: OpenTree): { committed: boolean } {
    const forest = this.requireReady()
    const members = forest.members()
    const standIn = members.find((m) => m.nodeId === nodeId)
    if (!standIn || standIn.digest !== undefined) return { committed: false }

    const established = members.find((m) => m.nodeId !== nodeId && m.digest === tree.id)
    if (established) {
      forest.writeMemberFacts(
        [{ nodeId: established.nodeId, ...hintsOf(tree) }],
        [standIn.nodeId],
        SYSTEM_ACTOR,
        forgetDuplicateMessage(memberName(standIn), standIn.pathHint, memberName(established)),
      )
      this.dropStaleRecord(established.pathHint, tree.path)
      return { committed: true }
    }

    forest.writeMemberFacts(
      [{ nodeId, digest: tree.id }],
      [],
      SYSTEM_ACTOR,
      recordIdentityMessage(tree.name),
    )
    return { committed: true }
  }

  /**
   * A digest-less stand-in whose file opened as a world already open through
   * another member: delete it in one system commit naming both (Pitfall 10).
   */
  private foldDuplicate(standIn: ForestMember, clash: TreeIdentityClash): void {
    const forest = this.requireReady()
    if (!forest.members().some((m) => m.nodeId === standIn.nodeId)) return
    forest.writeMemberFacts(
      [],
      [standIn.nodeId],
      SYSTEM_ACTOR,
      forgetDuplicateMessage(memberName(standIn), standIn.pathHint, clash.openName),
    )
  }

  /**
   * Take the registry's in-memory `path:` record for a stale hint out of the
   * space, so a member found at a new path is not shown twice.
   */
  private dropStaleRecord(staleHint: string, currentPath: string): void {
    if (samePath(staleHint, currentPath)) return
    const stale = this.registry.unavailableList().find((t) => samePath(t.path, staleHint))
    if (stale) this.registry.close(stale.id)
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
    if (this.forest) this.registry.setReserved(null)
    this.forest?.close()
    this.home?.close()
    this.forest = null
    this.home = null
    this.undoSteps = []
    this.redoSteps = []
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

/** The facts a stand-in keeps about where an entry lives. */
function hintsOf(entry: TreeEntry): { pathHint: string; vaultRootHint?: string } {
  return {
    pathHint: entry.path,
    ...(entry.kind === 'vault' && entry.vaultRoot !== undefined
      ? { vaultRootHint: entry.vaultRoot }
      : {}),
  }
}

/** A stand-in's readable name, as the registry would name its tree. */
function memberName(member: ForestMember): string {
  if (member.kind === 'vault') return basename(member.vaultRootHint ?? dirname(member.pathHint))
  return basename(member.pathHint).replace(/\.tree$/i, '')
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
