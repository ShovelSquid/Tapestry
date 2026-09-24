/**
 * TapestryHome — the always-open Tapestry tree (2.6 D-02).
 *
 * settings.json points at this file, and in 2.6 its only job is to name the
 * forest: a root node, a forest node carrying the forest's digest and path
 * hint, and a `forest` edge from the root to it. The reference is one-sided
 * (answer 1.7) and stored as `text`, because a cross-file `ref` is refused.
 *
 * Like the forest, its bridge is never handed to `TreeRegistry`, so plugins
 * and agents cannot reach it (RESEARCH Pitfall 2), and it is never rewound.
 */

import { resolve } from 'path'
import type { Actor } from '../commands/actor'
import { KernelBridge } from '../kernel-bridge'
import type { OpObject } from '../kernel-bridge'
import { closeQuietly } from '../trees/registry'
import { compareIds, createJournal, nodeIdAt, openJournal, textProp } from './forest-store'
import type { OpenProblem } from './forest-store'
import {
  FOREST_TITLE,
  HOME_FOREST_LABEL,
  HOME_FOREST_TYPE,
  HOME_ROOT_TYPE,
  HOME_TITLE,
  HOME_WORLD,
  KEY_DIGEST,
  KEY_PATH_HINT,
  KEY_TITLE,
} from './shapes'

/** What the Tapestry tree says about its forest. */
export interface ForestRef {
  digest: string
  pathHint: string
}

export class TapestryHome {
  private readonly bridge: KernelBridge

  /** Resolved absolute path of the Tapestry tree. */
  readonly path: string

  private constructor(bridge: KernelBridge, path: string) {
    this.bridge = bridge
    this.path = resolve(path)
  }

  /**
   * Create the Tapestry tree referencing `forest`, in one commit: the root,
   * the forest node and the edge between them.
   */
  static createReferencing(
    path: string,
    forest: ForestRef,
    actor: Actor,
    message: string,
  ): TapestryHome {
    const bridge = createJournal(path, HOME_WORLD, actor, message, (first) => {
      const rootId = first
      const forestId = nodeIdAt(first, 1)
      const ops: OpObject[] = [
        {
          op: 'createNode',
          type: HOME_ROOT_TYPE,
          props: { [KEY_TITLE]: { type: 'text', value: HOME_TITLE } },
        },
        {
          op: 'createNode',
          type: HOME_FOREST_TYPE,
          props: {
            [KEY_DIGEST]: { type: 'text', value: forest.digest },
            [KEY_PATH_HINT]: { type: 'text', value: forest.pathHint },
            [KEY_TITLE]: { type: 'text', value: FOREST_TITLE },
          },
        },
        { op: 'createEdge', from: rootId, to: forestId, label: HOME_FOREST_LABEL },
      ]
      return { ops, nodeIds: [rootId, forestId] }
    })
    return new TapestryHome(bridge, path)
  }

  /** Open an existing Tapestry tree, or say why it cannot be used. Writes nothing. */
  static open(path: string): TapestryHome | OpenProblem {
    const opened = openJournal(path, HOME_ROOT_TYPE)
    if (!(opened instanceof KernelBridge)) return opened
    return new TapestryHome(opened, path)
  }

  /**
   * The root node: the lowest-id node of the root type.
   *
   * 2.4's lock ceiling hangs its properties on this node (Spec - Locks and
   * Rank §3), so it is the one stable place for tree-wide settings.
   */
  rootNodeId(): string {
    const ids = this.bridge
      .getNodes()
      .filter((node) => node.type === HOME_ROOT_TYPE)
      .map((node) => node.id)
      .sort(compareIds)
    if (ids.length === 0) {
      throw new Error(`The Tapestry tree at ${this.path} has no root node`)
    }
    return ids[0]
  }

  /**
   * The forest this tree names: the lowest-id forest node linked from the
   * root, or null when there is none (the file is then not usable as a
   * Tapestry tree).
   */
  forestRef(): ForestRef | null {
    const rootId = this.rootNodeId()
    const linked = new Set(
      this.bridge
        .getEdges()
        .filter((edge) => edge.from === rootId && edge.label === HOME_FOREST_LABEL)
        .map((edge) => edge.to),
    )
    const node = this.bridge
      .getNodes()
      .filter((n) => n.type === HOME_FOREST_TYPE && linked.has(n.id))
      .sort((a, b) => compareIds(a.id, b.id))[0]
    if (!node) return null
    const digest = textProp(node.props, KEY_DIGEST)
    const pathHint = textProp(node.props, KEY_PATH_HINT)
    if (digest === undefined || pathHint === undefined) return null
    return { digest, pathHint }
  }

  /** The Tapestry tree's own identity. */
  digest(): string {
    return this.bridge.getHeaderDigest()
  }

  /** The last verified commit's seq. */
  headSeq(): number {
    return this.bridge.status().lastGoodSeq
  }

  /** Release the journal lock. */
  close(): void {
    closeQuietly(this.bridge)
  }
}
