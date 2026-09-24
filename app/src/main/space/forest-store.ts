/**
 * ForestStore — the one forest tree, held outside the tree registry (2.6 D-06).
 *
 * The forest is an ordinary readable `.tree` file: a space node, one stand-in
 * per member tree, and one `placement` edge per frame carrying its origin
 * (D-01, D-04). Arranging trees is therefore an edit like any other, with an
 * actor, a message and a history.
 *
 * Its bridge is never handed to `TreeRegistry`. Plugins and agents reach trees
 * only through the registry (`primaryBridgeProxy`, `resolveRef`), so a forest
 * the registry does not know is a forest they cannot write to (RESEARCH
 * Pitfall 2, T-2.6-02). Only main, through `SpaceService`, holds it.
 *
 * The bridge is never rewound. `submitAs` refuses while rewound, so a rewind
 * would silently turn every later drag into an error (RESEARCH Pitfall 8).
 * D-09's frame undo is a compensating commit, not a rewind (Plan 05).
 *
 * Opening never repairs: a torn or corrupt forest is closed again at once and
 * reported, exactly as `registry.tryOpen` treats a member (Phase 1 PD-04).
 */

import { existsSync, mkdirSync, rmSync } from 'fs'
import { dirname, resolve } from 'path'
import type { Actor } from '../commands/actor'
import { KernelBridge } from '../kernel-bridge'
import type { CommitResult, EdgeData, NodeData, OpObject } from '../kernel-bridge'
import { classifyOpenFailure, closeQuietly } from '../trees/registry'
import {
  FOREST_TITLE,
  FOREST_WORLD,
  KEY_DIGEST,
  KEY_KIND,
  KEY_ORIGIN_X,
  KEY_ORIGIN_Y,
  KEY_PATH_HINT,
  KEY_TITLE,
  KEY_VAULT_ROOT_HINT,
  MEMBER_KIND_NATIVE,
  MEMBER_KIND_VAULT,
  MEMBER_TYPE,
  PLACEMENT_LABEL,
  SPACE_KIND_CANVAS,
  SPACE_TYPE,
} from './shapes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Why the forest or the Tapestry tree could not be used. Nothing was written. */
export interface OpenProblem {
  status: 'missing' | 'locked' | 'damaged' | 'foreign'
  reason: string
}

export type MemberKind = 'native' | 'vault'

/** One member to write when the forest is created. */
export interface MemberSeed {
  kind: MemberKind
  pathHint: string
  vaultRootHint?: string
  /** Written only when known; a first open records it later (D-03). */
  digest?: string
  origin: { x: number; y: number }
}

/** One stand-in as read back from the forest. */
export interface ForestMember {
  nodeId: string
  kind: MemberKind
  pathHint: string
  vaultRootHint?: string
  digest?: string
  /** The placement edge from the space node, or null when there is none. */
  placement: { edgeId: string; x: number; y: number } | null
}

// ---------------------------------------------------------------------------
// Shared journal helpers (also used by home-tree.ts)
// ---------------------------------------------------------------------------

const ID_RE = /^([ne])([1-9][0-9]*)$/

/** The numeric part of `n12` or `e3`, or null for any other shape. */
function idNumber(id: string): number | null {
  const match = ID_RE.exec(id)
  return match ? Number(match[2]) : null
}

/** Order ids by their number; anything unparseable sorts last, by text. */
export function compareIds(a: string, b: string): number {
  const na = idNumber(a)
  const nb = idNumber(b)
  if (na !== null && nb !== null) return na - nb
  if (na !== null) return -1
  if (nb !== null) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The node id `offset` places after `first` (`nodeIdAt('n4', 2)` is `n6`).
 *
 * Only the plain `n<digits>` form is accepted. Phase 3's branch-tagged ids
 * will break this arithmetic, and throwing here makes that visible rather
 * than writing edges to the wrong nodes.
 */
export function nodeIdAt(first: string, offset: number): string {
  const match = /^n([1-9][0-9]*)$/.exec(first)
  if (!match) {
    throw new Error(`Cannot predict node ids after ${first}`)
  }
  return `n${Number(match[1]) + offset}`
}

/** A property's text value, or undefined when absent or not text-shaped. */
export function textProp(
  props: NodeData['props'] | EdgeData['props'],
  key: string,
): string | undefined {
  const value = props[key]?.value
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** A property's finite number, or the default 0 an unwritten origin has. */
function realProp(props: EdgeData['props'], key: string): number {
  const value = props[key]?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Create a new world at `path` with exactly one first commit whose node ids
 * are predicted.
 *
 * The kernel creates with exclusive-create, so an existing file is never
 * overwritten (T-2.6-12). If the first commit fails, or the kernel issues
 * different ids than predicted, the file this call just created (a header
 * and at most that one commit, both ours) is removed, so a half-made forest
 * never looks like a real one to the next launch.
 */
export function createJournal(
  path: string,
  worldName: string,
  actor: Actor,
  message: string,
  build: (firstNode: string) => { ops: OpObject[]; nodeIds: string[] },
): KernelBridge {
  const target = resolve(path)
  mkdirSync(dirname(target), { recursive: true })

  const bridge = new KernelBridge()
  bridge.create(target, worldName)

  try {
    const { ops, nodeIds } = build(bridge.getNextIds().node)
    const result = bridge.submitAs(actor, message, ops)
    const issued = result.nodeIds
    if (issued.length !== nodeIds.length || issued.some((id, i) => id !== nodeIds[i])) {
      throw new Error(
        `Expected nodes ${nodeIds.join(', ')} but the kernel issued ${issued.join(', ')}`,
      )
    }
  } catch (err) {
    closeQuietly(bridge)
    rmSync(target, { force: true })
    throw err
  }
  return bridge
}

/**
 * Open a world and check it holds a node of `rootType`, without writing.
 *
 * Follows `registry.tryOpen`: missing first, then locked or damaged from the
 * open error, then a journal that did not verify. A world without the root
 * type is someone else's file (`foreign`) and is closed untouched.
 */
export function openJournal(path: string, rootType: string): KernelBridge | OpenProblem {
  const target = resolve(path)
  if (!existsSync(target)) {
    return { status: 'missing', reason: `No file at ${target}` }
  }

  const bridge = new KernelBridge()
  try {
    bridge.open(target)
  } catch (err) {
    const detail = errorMessage(err)
    return { status: classifyOpenFailure(detail), reason: detail }
  }

  try {
    const status = bridge.status()
    if (status.kind !== 'Ok') {
      closeQuietly(bridge)
      return { status: 'damaged', reason: status.reason || `the journal is ${status.kind}` }
    }
    if (!bridge.getNodes().some((node) => node.type === rootType)) {
      closeQuietly(bridge)
      return { status: 'foreign', reason: `No ${rootType} node in ${target}` }
    }
  } catch (err) {
    closeQuietly(bridge)
    return { status: 'damaged', reason: errorMessage(err) }
  }
  return bridge
}

// ---------------------------------------------------------------------------
// ForestStore
// ---------------------------------------------------------------------------

export class ForestStore {
  private readonly bridge: KernelBridge

  /** Resolved absolute path of the forest file. */
  readonly path: string

  private constructor(bridge: KernelBridge, path: string) {
    this.bridge = bridge
    this.path = resolve(path)
  }

  /**
   * Create the forest with its space node and every seed in one commit
   * (answer 2.4): stand-ins first, then one placement edge per seed, with the
   * origins typed `real` (RESEARCH Pitfall 3).
   */
  static createWithMembers(
    path: string,
    seeds: MemberSeed[],
    actor: Actor,
    message: string,
  ): ForestStore {
    const bridge = createJournal(path, FOREST_WORLD, actor, message, (first) => {
      const spaceId = first
      const nodeIds = [spaceId]
      const ops: OpObject[] = [
        {
          op: 'createNode',
          type: SPACE_TYPE,
          props: {
            [KEY_TITLE]: { type: 'text', value: FOREST_TITLE },
            [KEY_KIND]: { type: 'text', value: SPACE_KIND_CANVAS },
          },
        },
      ]

      seeds.forEach((seed, i) => {
        nodeIds.push(nodeIdAt(first, i + 1))
        const props: Record<string, { type: string; value: string }> = {
          [KEY_KIND]: { type: 'text', value: seed.kind },
          [KEY_PATH_HINT]: { type: 'text', value: seed.pathHint },
        }
        if (seed.kind === 'vault' && seed.vaultRootHint !== undefined) {
          props[KEY_VAULT_ROOT_HINT] = { type: 'text', value: seed.vaultRootHint }
        }
        if (seed.digest !== undefined) {
          props[KEY_DIGEST] = { type: 'text', value: seed.digest }
        }
        ops.push({ op: 'createNode', type: MEMBER_TYPE, props })
      })

      seeds.forEach((seed, i) => {
        ops.push({
          op: 'createEdge',
          from: spaceId,
          to: nodeIdAt(first, i + 1),
          label: PLACEMENT_LABEL,
          props: {
            [KEY_ORIGIN_X]: { type: 'real', value: seed.origin.x },
            [KEY_ORIGIN_Y]: { type: 'real', value: seed.origin.y },
          },
        })
      })

      return { ops, nodeIds }
    })
    return new ForestStore(bridge, path)
  }

  /** Open an existing forest, or say why it cannot be used. Writes nothing. */
  static open(path: string): ForestStore | OpenProblem {
    const opened = openJournal(path, SPACE_TYPE)
    if (!(opened instanceof KernelBridge)) return opened
    return new ForestStore(opened, path)
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** The forest's identity, `sha256:<hex>` of its header. */
  digest(): string {
    return this.bridge.getHeaderDigest()
  }

  /** The last verified commit's seq. */
  headSeq(): number {
    return this.bridge.status().lastGoodSeq
  }

  /** The lowest-id node of the space type. */
  spaceNodeId(): string {
    const ids = this.bridge
      .getNodes()
      .filter((node) => node.type === SPACE_TYPE)
      .map((node) => node.id)
      .sort(compareIds)
    if (ids.length === 0) {
      throw new Error(`The forest at ${this.path} has no space node`)
    }
    return ids[0]
  }

  /** Every stand-in with its placement, in node-id order. */
  members(): ForestMember[] {
    const spaceId = this.spaceNodeId()

    const placements = new Map<string, EdgeData>()
    const edges = this.bridge
      .getEdges()
      .filter((edge) => edge.from === spaceId && edge.label === PLACEMENT_LABEL)
      .sort((a, b) => compareIds(a.id, b.id))
    for (const edge of edges) {
      // A hand-edited file could place one member twice; the first edge wins.
      if (!placements.has(edge.to)) placements.set(edge.to, edge)
    }

    return this.bridge
      .getNodes()
      .filter((node) => node.type === MEMBER_TYPE)
      .sort((a, b) => compareIds(a.id, b.id))
      .flatMap((node): ForestMember[] => {
        const pathHint = textProp(node.props, KEY_PATH_HINT)
        if (pathHint === undefined) return []
        const kind: MemberKind =
          textProp(node.props, KEY_KIND) === MEMBER_KIND_VAULT ? 'vault' : MEMBER_KIND_NATIVE
        const vaultRootHint = textProp(node.props, KEY_VAULT_ROOT_HINT)
        const digest = textProp(node.props, KEY_DIGEST)
        const edge = placements.get(node.id)
        return [
          {
            nodeId: node.id,
            kind,
            pathHint,
            ...(vaultRootHint !== undefined ? { vaultRootHint } : {}),
            ...(digest !== undefined ? { digest } : {}),
            placement: edge
              ? {
                  edgeId: edge.id,
                  x: realProp(edge.props, KEY_ORIGIN_X),
                  y: realProp(edge.props, KEY_ORIGIN_Y),
                }
              : null,
          },
        ]
      })
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /** Write new origins for several placements as one commit (D-11). */
  setOrigins(
    changes: Array<{ edgeId: string; x: number; y: number }>,
    actor: Actor,
    message: string,
  ): CommitResult {
    this.assertWritable()
    const ops: OpObject[] = []
    for (const change of changes) {
      ops.push(
        { op: 'setProperty', target: change.edgeId, key: KEY_ORIGIN_X, type: 'real', value: change.x },
        { op: 'setProperty', target: change.edgeId, key: KEY_ORIGIN_Y, type: 'real', value: change.y },
      )
    }
    return this.bridge.submitAs(actor, message, ops)
  }

  /** Release the journal lock. */
  close(): void {
    closeQuietly(this.bridge)
  }

  /** A rewound forest is a bug here, never a state to write from (Pitfall 8). */
  private assertWritable(): void {
    if (this.bridge.isRewound) {
      throw new Error('The forest is rewound; Tapestry never rewinds it, so this is a bug')
    }
  }
}
