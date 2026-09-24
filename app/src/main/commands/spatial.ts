/**
 * Spatial commands — the spatial half of the shared command layer (02.2 D-01).
 *
 * `look` is read-only and returns relations only, never coordinates (D-14):
 * an agent learns that a note is near or beyond another, not where either one
 * sits. Anchors (`from`, `toward`) resolve only inside the tree the call names
 * (D-12); an id that is live in some other open tree is simply not live here.
 *
 * The geometry lives in the pure module `renderer/layout/placement.ts` (D-18),
 * so the canvas and this layer measure notes the same way. `look` measures
 * every note where it is drawn (`displayPositions`): a note that follows its
 * parent is reported beside that parent, with `guess: true`, not at its
 * stored spot (D-05).
 *
 * `place` moves a note near another note, or beyond one note as seen from
 * another (D-09, D-10). The host resolves the spot with the same geometry and
 * stores it with `pinned`: a note placed near its own grew-from parent
 * follows it (`pinned` bool false); every other placement is fixed (D-01).
 * One placement is one commit whose message states the intent (D-04).
 *
 * `place` is gated only by Phase 2.4's layout lock (`checkLock` on the
 * `layout` aspect, D-15): a note no agent created is locked to its creator,
 * an agent's note is open to agents, and `lock.layout` / `lock.layout.allow`
 * override that. The superseded D-05 authorship gate in `notes.ts` is
 * deliberately not used. A person's takeover (`pinned` true) is never removed
 * or overwritten (D-03, D-17).
 *
 * `place` writes only `position.x`, `position.y` and `pinned` (D-08). It never
 * reads or writes an `md.` key and never calls a vault service, so placing a
 * vault note never moves its file (D-13).
 */

import type { OpenTree, TreeRegistry } from '../trees/registry'
import type { Actor } from './actor'
import type { CommandHooks, CommandResult } from './notes'
import { prepareWriteFor } from './notes'
import { checkLock } from './locks'
import type { NodeData, OpObject } from '../kernel-bridge'
import {
  displayPositions,
  grewFromParent,
  isKnot,
  liesToward,
  noteSize,
  orderNeighbours,
  rectAt,
  resolveWhere,
  whereRefusalText,
  type PlacementNode,
  type PlacementRect,
  type Relation,
  type WherePlacement,
  type WhereRefusal,
  type WhereRole,
} from '../../renderer/layout/placement'

/**
 * Node ids the kernel issues: `n1`, `n2`, ... (never `n0`). Re-declared here
 * rather than exported from notes.ts, following the connections.ts precedent.
 */
const NODE_ID_RE = /^n[1-9][0-9]*$/

/** The error convention used across the main process (as in connections.ts). */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** How many neighbours `look` returns when no limit is given (the search_notes precedent). */
export const LOOK_DEFAULT_LIMIT = 20

/** One note around the note being looked from. */
export interface LookNeighbour {
  /** The neighbour's node id. */
  note: string
  /** The id of the tree both notes are in. */
  space: string
  /** How the neighbour sits relative to the note being looked from. */
  relation: Relation
  /** 1 for the nearest neighbour, counting up. */
  order: number
  /** Whether the neighbour follows the note it grew from (D-02). */
  guess: boolean
}

export interface LookResult {
  tree: string
  from: string
  neighbours: LookNeighbour[]
}

/** What a successful `place` returns. It carries no coordinate (D-14). */
export interface PlaceResult {
  tree: string
  note: string
  /** The sequence number of the placement's commit. */
  seq: number
  /** Whether the note now follows its grew-from parent (D-01). */
  follows: boolean
}

/**
 * Whether a person has taken the note's position over (D-03, D-17).
 *
 * True when the note has a `pinned` property whose value is anything other
 * than exactly the bool false: in practice the `pinned` true a person's drag
 * writes. Absent, or the bool false, gives false.
 *
 * A note an agent created and a person then dragged has no default layout
 * lock, so this value is the only record of the takeover, and `place` must
 * never remove or overwrite it.
 */
export function heldByPerson(note: Pick<PlacementNode, 'props'>): boolean {
  const pinned = note.props['pinned']
  if (pinned === undefined) return false
  return !(pinned.type === 'bool' && pinned.value === false)
}

/**
 * The ops one placement writes (D-01, D-08, D-17).
 *
 * Always a `setProperty` of `position.x` and of `position.y`. Then:
 * - a note `heldByPerson` gets nothing more: its `pinned` is left exactly as
 *   it is, whatever `follows` says (`place` has already refused the follow
 *   case for it);
 * - otherwise a following placement sets `pinned` to the bool false;
 * - otherwise (fixed) `pinned` is unset only when it is exactly the bool
 *   false, and nothing is written when it is absent (the kernel refuses to
 *   unset an absent key).
 *
 * Invariant: after `place`, `pinned` is the bool false (following), absent
 * (fixed), or the person's untouched `pinned` true (fixed). An agent never
 * removes or overwrites a takeover.
 */
export function placeOps(
  note: Pick<PlacementNode, 'id' | 'props'>,
  spot: { x: number; y: number; follows: boolean },
): OpObject[] {
  const ops: OpObject[] = [
    { op: 'setProperty', target: note.id, key: 'position.x', type: 'real', value: spot.x },
    { op: 'setProperty', target: note.id, key: 'position.y', type: 'real', value: spot.y },
  ]
  if (heldByPerson(note)) return ops
  if (spot.follows) {
    ops.push({ op: 'setProperty', target: note.id, key: 'pinned', type: 'bool', value: false })
  } else if (note.props['pinned'] !== undefined) {
    // Not held by a person and present, so it is exactly the bool false.
    ops.push({ op: 'unsetProperty', target: note.id, key: 'pinned' })
  }
  return ops
}

/** The commit message for a placement: the intent, in words (D-04). */
export function placeMessage(noteId: string, where: WherePlacement): string {
  return 'beyond' in where
    ? `Place note ${noteId} beyond ${where.beyond} from ${where.from}`
    : `Place note ${noteId} near ${where.near}`
}

export class SpatialCommands {
  /** `look` writes nothing and calls none of the hooks; `place` calls them as a note command does. */
  constructor(
    private readonly registry: TreeRegistry,
    private readonly hooks: CommandHooks = {},
  ) {}

  /**
   * The notes around `from` in the named tree, nearest first, as relations.
   *
   * Read-only: it never returns a rewound tree to its latest state, never
   * commits, and never reports a coordinate, in a result or in a refusal.
   */
  look(args: { tree: string; from: string; toward?: string; limit?: number }): CommandResult<LookResult> {
    let limit = LOOK_DEFAULT_LIMIT
    if (args.limit !== undefined) {
      if (typeof args.limit !== 'number' || !Number.isInteger(args.limit) || args.limit < 1) {
        return { ok: false, error: 'limit must be a positive whole number' }
      }
      limit = args.limit
    }

    let tree: OpenTree
    try {
      tree = this.registry.resolveRef(args.tree)
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }

    const from = args.from
    const notLive = `${String(from)} is not a live note in ${tree.name}`
    if (typeof from !== 'string' || !NODE_ID_RE.test(from)) {
      return { ok: false, error: notLive }
    }

    const toward = args.toward
    if (toward !== undefined) {
      if (typeof toward !== 'string' || !NODE_ID_RE.test(toward)) {
        return { ok: false, error: `toward ${String(toward)} is not a live note in ${tree.name}` }
      }
      if (toward === from) {
        return { ok: false, error: `${from} cannot look toward itself` }
      }
    }

    try {
      const nodes = tree.bridge.getNodes()
      const edges = tree.bridge.getEdges()
      const byId = new Map<string, NodeData>()
      for (const node of nodes) byId.set(node.id, node)

      // Where each note is drawn, followers included. No overrides: main
      // sees no drag in progress.
      const drawn = displayPositions(nodes, edges, new Map())
      /** A note's drawn rectangle; null for a knot or a note with no drawn spot. */
      const drawnRect = (node: NodeData): PlacementRect | null => {
        if (isKnot(node)) return null
        const spot = drawn.get(node.id)
        return spot === undefined ? null : rectAt(spot, noteSize(node))
      }

      const origin = byId.get(from)
      if (!origin) return { ok: false, error: notLive }
      const fromRect = drawnRect(origin)
      if (!fromRect) return { ok: false, error: `${from} is not placed in ${tree.name}` }

      let towardRect: PlacementRect | null = null
      if (toward !== undefined) {
        const target = byId.get(toward)
        if (!target) {
          return { ok: false, error: `toward ${toward} is not a live note in ${tree.name}` }
        }
        if (isKnot(target)) {
          return { ok: false, error: `toward ${toward} is not a live note in ${tree.name}` }
        }
        towardRect = drawnRect(target)
        if (!towardRect) {
          return { ok: false, error: `toward ${toward} is not placed in ${tree.name}` }
        }
        const sameCentre =
          fromRect.x + fromRect.width / 2 === towardRect.x + towardRect.width / 2 &&
          fromRect.y + fromRect.height / 2 === towardRect.y + towardRect.height / 2
        if (sameCentre) {
          return {
            ok: false,
            error: `toward ${toward} has the same centre as ${from} in ${tree.name}`,
          }
        }
      }

      const candidates: Array<{ id: string; rect: PlacementRect }> = []
      for (const node of nodes) {
        if (node.id === from) continue
        const rect = drawnRect(node)
        if (!rect) continue
        if (towardRect && !liesToward(fromRect, rect, towardRect)) continue
        candidates.push({ id: node.id, rect })
      }

      const neighbours: LookNeighbour[] = orderNeighbours(fromRect, candidates)
        .slice(0, limit)
        .map((entry, index) => ({
          note: entry.id,
          space: tree.id,
          relation: entry.relation,
          order: index + 1,
          guess: drawn.get(entry.id)?.following === true,
        }))

      return { ok: true, value: { tree: tree.id, from, neighbours } }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }

  /**
   * Move `args.note` relative to other notes in the named tree (D-09, D-10).
   *
   * Checks run in a fixed order and the first failure returns
   * `{ ok: false, error }` with nothing written:
   * 1. the tree resolves;
   * 2. checks that need no world (id shapes, self, same note) run before the
   *    tree is reconciled, so a refusal decided from the arguments alone
   *    never discards a person's redo on a rewound tree;
   * 3. a rewound tree is returned to its latest state (the hooks announce a
   *    discarded redo);
   * 4. the note is live and is not a knot;
   * 5. its layout lock admits the actor (Phase 2.4, D-15);
   * 6. a person's takeover is never turned back into following (D-17);
   * 7. the spot resolves and is finite;
   * 8. one commit, signed by `actor`.
   *
   * No refusal and no success value carries a coordinate (D-14).
   */
  place(actor: Actor, args: { tree: string; note: string; where: WherePlacement }): CommandResult<PlaceResult> {
    let tree: OpenTree
    try {
      tree = this.registry.resolveRef(args.tree)
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }

    // (2) Checks that need no world, before reconciling (RESEARCH Pitfall 3).
    const noteId = args.note
    const notLive = `${String(noteId)} is not a live note in ${tree.name}`
    if (typeof noteId !== 'string' || !NODE_ID_RE.test(noteId)) {
      return { ok: false, error: notLive }
    }

    const where = args.where
    const anchors: Array<{ role: WhereRole; id: unknown }> =
      where !== null && typeof where === 'object' && 'beyond' in where
        ? [
            { role: 'beyond', id: where.beyond },
            { role: 'from', id: where.from },
          ]
        : [{ role: 'near', id: (where as { near?: unknown } | null)?.near }]
    for (const anchor of anchors) {
      if (typeof anchor.id !== 'string' || !NODE_ID_RE.test(anchor.id)) {
        return { ok: false, error: `${anchor.role} ${String(anchor.id)} is not a live note in ${tree.name}` }
      }
    }
    const refusal = (reason: WhereRefusal['reason'], role: WhereRole, anchor: string): string => {
      const shaped: WhereRefusal =
        'beyond' in where ? { ok: false, reason, role, anchor, from: where.from } : { ok: false, reason, role, anchor }
      return whereRefusalText(shaped, noteId, tree.name)
    }
    for (const anchor of anchors) {
      if (anchor.id === noteId) return { ok: false, error: refusal('self', anchor.role, noteId) }
    }
    if ('beyond' in where && where.beyond === where.from) {
      return { ok: false, error: refusal('same-note', 'beyond', where.beyond) }
    }

    try {
      // (3) Reconcile a rewound tree, as every agent write does.
      prepareWriteFor(tree, actor, this.hooks)

      // (4) The note, in the world the commit will be appended to.
      const nodes = tree.bridge.getNodes()
      const edges = tree.bridge.getEdges()
      const note = nodes.find((node) => node.id === noteId)
      if (!note) return { ok: false, error: notLive }
      if (isKnot(note)) return { ok: false, error: `${noteId} is not a note place can move in ${tree.name}` }

      // (5) Phase 2.4's layout lock (D-15). The default owner is the actor on
      // the commit that created the note, read from the history index.
      const entry = tree.bridge.getHistoryIndex().nodes[noteId]
      if (!entry) return { ok: false, error: notLive }
      const locked = checkLock(noteId, note.props, entry.createdBy, actor, 'layout')
      if (locked) return { ok: false, error: locked }

      // (5b) A person's takeover is never turned back into following (D-17).
      if (!('beyond' in where)) {
        const parent = grewFromParent(note, edges)
        if (parent === where.near && heldByPerson(note)) {
          return {
            ok: false,
            error: `${noteId} was pinned by a person; it will not follow ${parent} again`,
          }
        }
      }

      // (6) The spot, from the same geometry the canvas draws with.
      const outcome = resolveWhere({ nodes, edges }, note, where)
      if (!outcome.ok) return { ok: false, error: whereRefusalText(outcome, noteId, tree.name) }

      // (7) Never write a spot that cannot be read back.
      if (!Number.isFinite(outcome.x) || !Number.isFinite(outcome.y)) {
        return { ok: false, error: `no finite spot for ${noteId} in ${tree.name}` }
      }

      // (8) One commit, signed by the socket's actor.
      const result = tree.bridge.submitAs(actor, placeMessage(noteId, where), placeOps(note, outcome))
      this.hooks.onCommitted?.(tree.id, actor, result)

      return { ok: true, value: { tree: tree.id, note: noteId, seq: result.seq, follows: outcome.follows } }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }
}
