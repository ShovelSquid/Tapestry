/**
 * Chat session notes: each in-app chat is a note in its workspace tree
 * (Phase 2.8, D-02, D-07), and this module is its only writer.
 *
 * Why here and not through the usual paths: a workspace tree refuses node
 * creation from the renderer (`workspaceSubmitRefusal`, workspace/guards.ts),
 * and NoteCommands refuses workspace trees outright (their notes are files).
 * A session note is neither a file nor a note an agent grows, so main writes
 * it directly through `bridge.submitAs`, then reports the commit through the
 * same `onCommitted` hook every command uses, so the canvas refreshes.
 *
 * Who signs what: creating a session is the person's act (their actor), and
 * each completed turn is signed by that session's own agent (D-03), whose name
 * derives from the note, so nothing extra is stored.
 *
 * The note's stored shape and turn grammar live in `src/shared/chat/transcript.ts`.
 */

import type { OpenTree } from '../trees/registry'
import type { OpObject } from '../kernel-bridge'
import { isValidActorName, type Actor } from '../commands/actor'
import { prepareWriteFor, type CommandHooks } from '../commands/notes'
import {
  resolveNear,
  storedRect,
  type PlacementNode,
  type PlacementPoint,
  type PlacementRect,
  type PlacementSize,
} from '../../renderer/layout/placement'
import { isWorkspaceNode, subspaceRects } from '../../renderer/layout/subspaces'
import {
  appendTurnText,
  committedTurns,
  isSessionNode,
  NEW_SESSION_TITLE,
  SESSION_HEIGHT,
  SESSION_NODE_TYPE,
  SESSION_TURNS_KEY,
  SESSION_WIDTH,
  sessionBody,
  type TurnItem,
} from '../../shared/chat/transcript'

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * The name every in-app chat agent starts with. The 02.7 single chat signed
 * as exactly `agent.claude-chat`; that history stays attributed to it.
 */
export const CHAT_AGENT_NAME = 'claude-chat'

/** Node ids the kernel issues: `n1`, `n2`, ... (never `n0`). */
export const SESSION_NOTE_ID_RE = /^n[1-9][0-9]*$/

/** Said whenever a note id does not name a live session note in that workspace. */
export const SESSION_NOT_FOUND_MESSAGE = "That chat isn't in this workspace"

/**
 * A session's own agent (D-03): `claude-chat-<first 8 hex of the tree id>-<note id>`,
 * the spec's `agent.claude-chat.<session>` in the characters ACTOR_NAME_RE
 * allows. At most 32 characters for note ids up to `n9999999999`, and unique
 * across workspaces (note ids repeat between trees).
 */
export function sessionAgentName(treeId: string, noteId: string): string {
  const hex = treeId.replace(/^sha256:/, '').slice(0, 8)
  const name = `${CHAT_AGENT_NAME}-${hex}-${noteId}`
  if (!isValidActorName(name)) throw new Error(`No valid agent name for the chat ${noteId}`)
  return name
}

/** A session's key in memory: `<tree id>#<note id>`. */
export function sessionKey(treeId: string, noteId: string): string {
  return `${treeId}#${noteId}`
}

/** A session's key in chats.json: `<workspace real root>#<note id>`. */
export function persistKey(realRoot: string, noteId: string): string {
  return `${realRoot}#${noteId}`
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

function unionOf(rects: readonly PlacementRect[]): PlacementRect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Where a new session goes in its workspace frame (frame-local): the first
 * clear spot `CHILD_GAP` right of everything in the frame, level with its top,
 * then `resolveNear`'s downward steps. "Everything" is the boxes the canvas
 * sizes a workspace frame with: the root's file cards and top-level folder
 * frames at default card sizes, plus every non-workspace node's stored rect.
 * An empty workspace gets (0, 0); null means no finite spot.
 */
export function nextSessionSpot(nodes: readonly PlacementNode[], size: PlacementSize): PlacementPoint | null {
  const obstacles: PlacementRect[] = [...subspaceRects(nodes, () => undefined).rootBoxes]
  for (const node of nodes) {
    if (isWorkspaceNode(node)) continue
    const rect = storedRect(node)
    if (rect) obstacles.push(rect)
  }
  if (obstacles.length === 0) return { x: 0, y: 0 }
  const spot = resolveNear(unionOf(obstacles), size, obstacles)
  if (!spot.ok || !Number.isFinite(spot.x) || !Number.isFinite(spot.y)) return null
  return { x: spot.x, y: spot.y }
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

export interface SessionNotesOptions {
  hooks?: CommandHooks
}

/** The only writer of session notes. Every method throws on refusal and writes nothing. */
export class SessionNotes {
  private readonly hooks: CommandHooks

  constructor(options: SessionNotesOptions = {}) {
    this.hooks = options.hooks ?? {}
  }

  /**
   * A new session note in a workspace tree, in one commit signed by `actor`
   * (the person): type `tapestry.chat/session@1` at the next clear spot, titled
   * "New chat", with an empty body, `chat.turns` 0 and its 360 × 440 size.
   */
  create(tree: OpenTree, actor: Actor): { noteId: string; seq: number } {
    if (tree.kind !== 'workspace') throw new Error(`${tree.name} is not a workspace, so it has no chats`)
    const { bridge } = tree
    prepareWriteFor(tree, actor, this.hooks)

    const size = { width: SESSION_WIDTH, height: SESSION_HEIGHT }
    const spot = nextSessionSpot(bridge.getNodes(), size)
    if (!spot) throw new Error(`No clear spot for a new chat in ${tree.name}`)

    const next = bridge.getNextIds()
    const ops: OpObject[] = [
      {
        op: 'createNode',
        type: SESSION_NODE_TYPE,
        props: {
          'position.x': { type: 'real', value: spot.x },
          'position.y': { type: 'real', value: spot.y },
          title: { type: 'text', value: NEW_SESSION_TITLE },
          body: { type: 'text', value: '' },
          [SESSION_TURNS_KEY]: { type: 'int', value: 0 },
          width: { type: 'real', value: size.width },
          height: { type: 'real', value: size.height },
        },
      },
    ]
    const result = bridge.submitAs(actor, `start chat "${NEW_SESSION_TITLE}"`, ops)
    if (result.nodeIds[0] !== next.node) {
      throw new Error(`Expected the new chat to be ${next.node} but the kernel issued ${result.nodeIds[0]}`)
    }
    this.hooks.onCommitted?.(tree.id, actor, result)
    return { noteId: next.node, seq: result.seq }
  }

  /**
   * Append one completed turn to the session note's body (D-07): one commit,
   * signed by `actor` (the session's agent), that sets `body` and
   * `chat.turns` = k and creates no node and no edge.
   */
  appendTurn(tree: OpenTree, noteId: string, actor: Actor, items: TurnItem[]): { turn: number; seq: number } {
    if (typeof noteId !== 'string' || !SESSION_NOTE_ID_RE.test(noteId)) {
      throw new Error(SESSION_NOT_FOUND_MESSAGE)
    }
    const { bridge } = tree
    const before = bridge.getNode(noteId)
    if (!before || !isSessionNode(before)) throw new Error(SESSION_NOT_FOUND_MESSAGE)

    prepareWriteFor(tree, actor, this.hooks)
    const node = bridge.getNode(noteId)
    if (!node || !isSessionNode(node)) throw new Error(SESSION_NOT_FOUND_MESSAGE)

    const turn = committedTurns(node) + 1
    const body = appendTurnText(sessionBody(node), { turn, items })
    const ops: OpObject[] = [
      { op: 'setProperty', target: noteId, key: 'body', type: 'text', value: body },
      { op: 'setProperty', target: noteId, key: SESSION_TURNS_KEY, type: 'int', value: turn },
    ]
    const result = bridge.submitAs(actor, `chat turn ${turn}`, ops)
    this.hooks.onCommitted?.(tree.id, actor, result)
    return { turn, seq: result.seq }
  }
}
