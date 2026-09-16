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
 * `place` joins this class after Phase 2.4 (Plan 04).
 */

import type { OpenTree, TreeRegistry } from '../trees/registry'
import type { CommandHooks, CommandResult } from './notes'
import type { NodeData } from '../kernel-bridge'
import {
  displayPositions,
  isKnot,
  liesToward,
  noteSize,
  orderNeighbours,
  rectAt,
  type PlacementRect,
  type Relation,
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

export class SpatialCommands {
  /** `hooks` is held for `place` (Plan 04); `look` writes nothing and calls none of them. */
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
}
