/**
 * Connections between notes — the other half of the shared command set (D-01).
 *
 * D-05 restricts *changing* a note to the actor that created it, but places
 * **no restriction on connecting**: "agents may read any note and draw
 * connections to any note". That asymmetry is deliberate and is why this lives
 * beside NoteCommands rather than inside its ownership check — a connection
 * says "these two thoughts relate", which is a claim anyone reading the world
 * is entitled to make, while rewriting somebody's words is not.
 *
 * In this plan both endpoints must be in the same tree. Plan 15 adds
 * cross-tree endpoints (D-16) without changing the argument shape, which is
 * why the endpoints are already tree-qualified here.
 */

import type { Actor } from './actor'
import type { OpObject } from '../kernel-bridge'
import type { OpenTree, TreeRegistry } from '../trees/registry'
import { type CommandHooks, type CommandResult, prepareWriteFor } from './notes'

/** The edge label a human connection already uses (App.tsx handleEdgeCreate). */
export const LINK_LABEL = 'link'

/**
 * Kaelen's own short label for a connection, stored as Tapestry's rather than
 * as source data (D-14). The namespace is what keeps it distinguishable from
 * anything a mirrored source puts on the same edge.
 */
export const TAPESTRY_LABEL_PROP = 'tapestry.label'

const MAX_LABEL_LENGTH = 80

/** Node ids the kernel issues: `n1`, `n2`, ... (never `n0`). */
const NODE_ID_RE = /^n[1-9][0-9]*$/

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * A label that can be read back out of the file.
 *
 * Control characters are refused rather than stripped, for the same reason a
 * note title is: the value is written into a `.tree` text block, and quietly
 * changing it would make the stored label disagree with the one the caller
 * believes it set.
 */
function validateLabel(raw: unknown): CommandResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'label must be a string' }
  const label = raw.trim()
  if (label.length === 0) return { ok: false, error: 'label must not be empty' }
  if (label.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: `label must be at most ${MAX_LABEL_LENGTH} characters` }
  }
  for (const ch of label) {
    if (ch.codePointAt(0)! < 0x20) {
      return { ok: false, error: 'label must not contain control characters' }
    }
  }
  return { ok: true, value: label }
}

export interface ConnectionEndpoint {
  tree: string
  note: string
}

export class ConnectionCommands {
  constructor(
    private readonly registry: TreeRegistry,
    private readonly hooks: CommandHooks = {},
  ) {}

  /**
   * Connect two notes in the same tree.
   *
   * Any actor may do this, including an agent connecting two notes it did not
   * write (D-05).
   */
  connect(
    actor: Actor,
    args: { from: ConnectionEndpoint; to: ConnectionEndpoint; label?: string },
  ): CommandResult<{ tree: string; edge: string; seq: number }> {
    if (!args.from || !args.to) {
      return { ok: false, error: 'from and to are required' }
    }

    let fromTree: OpenTree
    let toTree: OpenTree
    try {
      fromTree = this.registry.resolveRef(args.from.tree)
      toTree = this.registry.resolveRef(args.to.tree)
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }

    // Cross-tree connections are recorded in both trees (D-16) and are Plan
    // 15's work. Refusing plainly is better than writing one end now and
    // leaving the other tree with no record that the link exists.
    if (fromTree.id !== toTree.id) {
      return { ok: false, error: 'from and to must be in the same tree' }
    }
    const tree = fromTree

    let label: string | undefined
    if (args.label !== undefined) {
      const labelResult = validateLabel(args.label)
      if (!labelResult.ok) return labelResult
      label = labelResult.value
    }

    try {
      // Same reconciliation as a note write: a connection must not fail
      // because Kaelen has undone something (UA-14).
      prepareWriteFor(tree, actor, this.hooks)

      for (const endpoint of [args.from.note, args.to.note]) {
        if (typeof endpoint !== 'string' || !NODE_ID_RE.test(endpoint)) {
          return { ok: false, error: `${String(endpoint)} is not a live note in ${tree.name}` }
        }
        if (!tree.bridge.getNode(endpoint)) {
          return { ok: false, error: `${endpoint} is not a live note in ${tree.name}` }
        }
      }

      const ops: OpObject[] = [
        {
          op: 'createEdge',
          from: args.from.note,
          to: args.to.note,
          label: LINK_LABEL,
          ...(label !== undefined
            ? { props: { [TAPESTRY_LABEL_PROP]: { type: 'text', value: label } } }
            : {}),
        },
      ]

      const result = tree.bridge.submitAs(
        actor,
        `connect ${args.from.note} to ${args.to.note}`,
        ops,
      )
      this.hooks.onCommitted?.(tree.id, actor, result)

      return {
        ok: true,
        value: { tree: tree.id, edge: result.edgeIds[0], seq: result.seq },
      }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }
}
