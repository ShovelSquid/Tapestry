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
  firstClearSpot,
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
 * What a new session must not overlap, frame-local: the boxes the canvas
 * sizes a workspace frame with (the root's file cards and top-level folder
 * frames at default card sizes), plus every non-workspace node's stored rect.
 */
function sessionObstacles(nodes: readonly PlacementNode[]): PlacementRect[] {
  const obstacles: PlacementRect[] = [...subspaceRects(nodes, () => undefined).rootBoxes]
  for (const node of nodes) {
    if (isWorkspaceNode(node)) continue
    const rect = storedRect(node)
    if (rect) obstacles.push(rect)
  }
  return obstacles
}

/**
 * Where a new session goes in its workspace frame (frame-local): the first
 * clear spot `CHILD_GAP` right of everything in the frame, level with its top,
 * then `resolveNear`'s downward steps. An empty workspace gets (0, 0); null
 * means no finite spot.
 */
export function nextSessionSpot(nodes: readonly PlacementNode[], size: PlacementSize): PlacementPoint | null {
  const obstacles = sessionObstacles(nodes)
  if (obstacles.length === 0) return { x: 0, y: 0 }
  const spot = resolveNear(unionOf(obstacles), size, obstacles)
  if (!spot.ok || !Number.isFinite(spot.x) || !Number.isFinite(spot.y)) return null
  return { x: spot.x, y: spot.y }
}

/**
 * Where a new session asked for at a frame-local point goes (the pointer
 * case): the first clear spot at or below `at`, in the same downward steps
 * as `resolveNear`. Null means no finite clear spot.
 */
export function sessionSpotAt(
  nodes: readonly PlacementNode[],
  at: PlacementPoint,
  size: PlacementSize,
): PlacementPoint | null {
  const spot = firstClearSpot(at, size, sessionObstacles(nodes))
  if (!spot.ok || !Number.isFinite(spot.x) || !Number.isFinite(spot.y)) return null
  return { x: spot.x, y: spot.y }
}

/** The largest magnitude a requested spot's coordinate may have. */
export const MAX_SESSION_COORDINATE = 1_000_000

/** Said when a new chat's placement is anything but `{ at: { x, y } }`. */
export const SESSION_PLACEMENT_MESSAGE = 'A new chat can be placed only at a point'

/** Said when a requested spot is not a finite point near the frame. */
export const SESSION_SPOT_MESSAGE = `A new chat's spot must be two finite numbers within ${MAX_SESSION_COORDINATE.toLocaleString('en-US')} of the frame's origin`

/** Where a new chat was asked to go: nothing (the next free spot) or a frame-local point. */
export type SessionPlacement = { at: PlacementPoint }

/**
 * Check a requested placement from outside main (T-02.8-11): undefined, or
 * exactly `{ at: { x, y } }` with finite numbers of magnitude at most
 * MAX_SESSION_COORDINATE. Throws on anything else.
 */
export function checkSessionPlacement(placement: unknown): SessionPlacement | undefined {
  if (placement === undefined || placement === null) return undefined
  if (typeof placement !== 'object' || Array.isArray(placement)) throw new Error(SESSION_PLACEMENT_MESSAGE)
  const keys = Object.keys(placement)
  if (keys.length !== 1 || keys[0] !== 'at') throw new Error(SESSION_PLACEMENT_MESSAGE)
  const at = (placement as { at: unknown }).at
  if (!at || typeof at !== 'object' || Array.isArray(at)) throw new Error(SESSION_PLACEMENT_MESSAGE)
  const { x, y } = at as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number') throw new Error(SESSION_PLACEMENT_MESSAGE)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(SESSION_SPOT_MESSAGE)
  if (Math.abs(x) > MAX_SESSION_COORDINATE || Math.abs(y) > MAX_SESSION_COORDINATE) {
    throw new Error(SESSION_SPOT_MESSAGE)
  }
  return { at: { x, y } }
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
   * (the person): type `tapestry.chat/session@1` at the next clear spot (or
   * the first clear spot at or below `placement.at`), titled "New chat", with
   * an empty body, `chat.turns` 0 and its 360 × 440 size.
   */
  create(tree: OpenTree, actor: Actor, placement?: SessionPlacement): { noteId: string; seq: number } {
    if (tree.kind !== 'workspace') throw new Error(`${tree.name} is not a workspace, so it has no chats`)
    const checked = checkSessionPlacement(placement)
    const { bridge } = tree
    prepareWriteFor(tree, actor, this.hooks)

    const size = { width: SESSION_WIDTH, height: SESSION_HEIGHT }
    const spot = checked
      ? sessionSpotAt(bridge.getNodes(), checked.at, size)
      : nextSessionSpot(bridge.getNodes(), size)
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

  /**
   * Delete a session note (chat:delete): one `deleteNode` commit signed by
   * `actor` (the person), message `delete chat <nK> "<title>"`. Every edge
   * touching the note goes with it. The conversation stays readable in the
   * journal's history. Refuses any note that is not a session.
   */
  delete(tree: OpenTree, noteId: string, actor: Actor): { seq: number } {
    if (typeof noteId !== 'string' || !SESSION_NOTE_ID_RE.test(noteId)) {
      throw new Error(SESSION_NOT_FOUND_MESSAGE)
    }
    if (tree.kind !== 'workspace') throw new Error(SESSION_NOT_FOUND_MESSAGE)
    const before = tree.bridge.getNode(noteId)
    if (!before || !isSessionNode(before)) throw new Error(SESSION_NOT_FOUND_MESSAGE)

    prepareWriteFor(tree, actor, this.hooks)
    const node = tree.bridge.getNode(noteId)
    if (!node || !isSessionNode(node)) throw new Error(SESSION_NOT_FOUND_MESSAGE)

    const rawTitle = node.props['title']?.value
    const title = typeof rawTitle === 'string' ? rawTitle.replace(/[\r\n]+/g, ' ') : ''
    const result = tree.bridge.submitAs(actor, `delete chat ${noteId} "${title}"`, [{ op: 'deleteNode', id: noteId }])
    this.hooks.onCommitted?.(tree.id, actor, result)
    return { seq: result.seq }
  }
}
