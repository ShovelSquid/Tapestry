/**
 * The shared note command set (D-01).
 *
 * Renderer, plugins and agents all reach the world through this layer. That is
 * the point of D-01: one place decides what a legal note change is, so a rule
 * added here cannot be bypassed by arriving over a different transport.
 *
 * The rule this plan adds is D-04: **an agent's note always grows from a note
 * that already exists.** It is enforced here, in the main process, not in the
 * agent and not in the MCP schema — a model that ignores its instructions, or
 * a shim that was replaced, still cannot create a loose note.
 *
 * Every refusal returns `{ ok: false }` and writes nothing. A commit either
 * carries both the node and its `grew-from` edge or it does not happen.
 */

import type { Actor } from './actor'
import type { CommitResult, NodeData, OpObject } from '../kernel-bridge'
import type { OpenTree, TreeKind, TreeRegistry } from '../trees/registry'
import {
  CHILD_GAP,
  DEFAULT_NOTE_WIDTH,
  GREW_FROM_LABEL,
  resolveWhere,
  whereRefusalText,
  type WherePlacement,
} from '../../renderer/layout/placement'
import { checkLock, isAgentActor, type LockAspect } from './locks'

// ---------------------------------------------------------------------------
// Result convention (plugin-host.ts lines 736-800)
// ---------------------------------------------------------------------------

export type CommandResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** The error convention used across the main process. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The node type a Tapestry-native note uses (App.tsx "Create note"). */
export const NATIVE_NOTE_TYPE = 'tapestry.notes/note@1'

/**
 * The edge label for D-04, running from the new note to its parent.
 *
 * The direction is chosen so the line reads naturally in the file:
 * `create-edge e5 n13 n12 grew-from` means "n13 grew from n12".
 */
export { GREW_FROM_LABEL }

/** Node ids the kernel issues: `n1`, `n2`, ... (never `n0`). */
const NODE_ID_RE = /^n[1-9][0-9]*$/

/**
 * A window of the note's text around the match.
 *
 * The match itself is always inside the window: a snippet that cut it off
 * would report a hit while showing no evidence of it.
 */
function snippetAround(text: string, query: string): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return text.slice(0, SNIPPET_LENGTH)
  const start = Math.max(0, index - SNIPPET_LEAD)
  return text.slice(start, start + SNIPPET_LENGTH)
}

const MAX_TITLE_LENGTH = 200
const MAX_TEXT_BYTES = 1000000

/** How much of a matching note search_notes shows back. */
const SNIPPET_LENGTH = 120

/** Characters of lead-in kept before the match inside a snippet. */
const SNIPPET_LEAD = 40

const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 100

// ---------------------------------------------------------------------------
// Body text <-> editor JSON (D-12)
// ---------------------------------------------------------------------------

/**
 * Plain text to the ProseMirror doc JSON a native note stores (D-12).
 *
 * One paragraph per line. An empty line becomes a paragraph with no content,
 * which is how the editor represents a blank line, so a note an agent writes
 * opens in the editor exactly as a typed one does.
 */
export function plainTextToDocJson(text: string): string {
  const content = text.split('\n').map((line) =>
    line.length === 0
      ? { type: 'paragraph' }
      : { type: 'paragraph', content: [{ type: 'text', text: line }] },
  )
  return JSON.stringify({ type: 'doc', content })
}

/** Whether a doc node is a block (as opposed to inline text or a break). */
function isBlockNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const type = (node as { type?: unknown }).type
  return type !== 'text' && type !== 'hard_break'
}

function serializeDocNode(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: unknown; text?: unknown; content?: unknown }

  if (n.type === 'text') return typeof n.text === 'string' ? n.text : ''
  if (n.type === 'hard_break') return '\n'

  const kids = Array.isArray(n.content) ? n.content : []
  const parts = kids.map(serializeDocNode)
  // Blocks stack vertically; inline children run together on one line.
  return kids.some(isBlockNode) ? parts.join('\n') : parts.join('')
}

/**
 * Editor JSON back to plain text, for agents reading a note.
 *
 * A body that is not JSON is returned unchanged: notes written before the
 * editor existed hold bare text, and showing it verbatim is more honest than
 * reporting an empty note.
 */
export function docJsonToPlainText(body: string): string {
  if (!body) return body
  let doc: unknown
  try {
    doc = JSON.parse(body)
  } catch {
    return body
  }
  if (!doc || typeof doc !== 'object') return body
  return serializeDocNode(doc)
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface CommandHooks {
  /** Called after a commit lands, so the renderer can refresh (D-01). */
  onCommitted?(treeId: string, actor: Actor, result: CommitResult): void
  /**
   * Called when a write from outside the renderer had to return the tree to
   * its latest state, discarding a redo Kaelen could have used (UA-14).
   */
  onRedoDiscarded?(treeId: string, actor: Actor): void
}

/**
 * Make a tree writable for a commit that did not come from the renderer.
 *
 * Kaelen may have undone changes in this tree. The kernel refuses to append
 * behind the journal head, so rather than failing the agent's write for a
 * reason that is nothing to do with it (research Pitfall 10), the tree is
 * returned to its latest state and the discarded redo is announced.
 *
 * Exported because connections write through the same rule; a connection that
 * refused while a note succeeded would be an inconsistency with no meaning.
 */
export function prepareWriteFor(tree: OpenTree, actor: Actor, hooks: CommandHooks): void {
  if (!tree.bridge.isRewound) return
  if (tree.bridge.discardRedo()) {
    hooks.onRedoDiscarded?.(tree.id, actor)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function numericProp(node: NodeData, key: string, fallback: number): number {
  const prop = node.props[key]
  if (!prop) return fallback
  const value = Number(prop.value)
  return Number.isFinite(value) ? value : fallback
}

/**
 * A title that can be read back out of the file.
 *
 * Control characters are refused rather than stripped: the title is written
 * into a `.tree` text block and later becomes a file name (D-28), and silently
 * changing what the caller asked for would make the stored title disagree with
 * the title the agent believes it set.
 */
function validateTitle(raw: unknown): CommandResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'title must be a string' }
  const title = raw.trim()
  if (title.length === 0) return { ok: false, error: 'title must not be empty' }
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `title must be at most ${MAX_TITLE_LENGTH} characters` }
  }
  for (const ch of title) {
    if (ch.codePointAt(0)! < 0x20) {
      return { ok: false, error: 'title must not contain control characters' }
    }
  }
  return { ok: true, value: title }
}

function validateText(raw: unknown): CommandResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'text must be a string' }
  if (raw.includes('\0')) return { ok: false, error: 'text must not contain NUL' }
  if (Buffer.byteLength(raw, 'utf-8') > MAX_TEXT_BYTES) {
    return { ok: false, error: `text must be at most ${MAX_TEXT_BYTES} bytes` }
  }
  return { ok: true, value: raw }
}

// ---------------------------------------------------------------------------
// NoteCommands
// ---------------------------------------------------------------------------

export class NoteCommands {
  constructor(
    private readonly registry: TreeRegistry,
    private readonly hooks: CommandHooks = {},
  ) {}

  /**
   * Create a note grown from an existing note, in one commit (D-04).
   *
   * The node and the `grew-from` edge are a single commit, so history never
   * contains a moment where the note exists unattached. That is only possible
   * because `getNextIds()` (Plan 02) predicts the id the new node will get,
   * letting the edge name it before it exists.
   *
   * `where` (02.5 SC2) is optional. Without it nothing changes: the note goes
   * to the right of its parent, with no collision step and no `pinned` key
   * (D-02). With it, the spot comes from the same `resolveWhere` as `place`;
   * near its own parent the note follows (`pinned` bool false, D-01), any
   * other relation is fixed, and the value adds `follows`. A refusal writes
   * nothing.
   */
  createFrom(
    actor: Actor,
    args: { tree: string; grewFrom: string; title: string; text: string; where?: WherePlacement },
  ): CommandResult<{ tree: string; note: string; edge: string; seq: number; follows?: boolean }> {
    let tree: OpenTree
    try {
      tree = this.registry.resolveRef(args.tree)
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }

    const titleResult = validateTitle(args.title)
    if (!titleResult.ok) return titleResult
    const title = titleResult.value

    const textResult = validateText(args.text)
    if (!textResult.ok) return textResult
    const text = textResult.value

    const { bridge } = tree

    // D-04: the parent must be a live note in this same tree. Checked against
    // the world, not against the argument's shape, so a deleted note is
    // refused as firmly as a malformed id.
    if (typeof args.grewFrom !== 'string' || !NODE_ID_RE.test(args.grewFrom)) {
      return { ok: false, error: `grewFrom ${String(args.grewFrom)} is not a live note in ${tree.name}` }
    }

    // 02.5 SC2: a `where` refusal that needs no world comes before reconciling,
    // so it never discards a person's redo.
    const where = args.where
    if (where !== undefined) {
      const anchors: Array<{ role: 'near' | 'beyond' | 'from'; id: unknown }> =
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
      if ('beyond' in where && where.beyond === where.from) {
        return {
          ok: false,
          error: whereRefusalText(
            { ok: false, reason: 'same-note', role: 'beyond', anchor: where.beyond, from: where.from },
            '',
            tree.name,
          ),
        }
      }
    }

    try {
      // UA-14: an agent's note is not lost because Kaelen happened to have
      // undone something. The tree returns to its latest state, and the
      // discarded redo is announced rather than passing unnoticed.
      this.prepareWrite(tree, actor)

      const parent = bridge.getNode(args.grewFrom)
      if (!parent) {
        return { ok: false, error: `grewFrom ${args.grewFrom} is not a live note in ${tree.name}` }
      }

      // Place the child to the right of its parent so the connection is
      // visible without overlapping the note it grew from.
      const parentX = numericProp(parent, 'position.x', 0)
      const parentY = numericProp(parent, 'position.y', 0)
      const parentWidth = numericProp(parent, 'width', DEFAULT_NOTE_WIDTH)

      const next = bridge.getNextIds()

      const ops: OpObject[] = [
        {
          op: 'createNode',
          type: NATIVE_NOTE_TYPE,
          props: {
            'position.x': { type: 'real', value: parentX + parentWidth + CHILD_GAP },
            'position.y': { type: 'real', value: parentY },
            title: { type: 'text', value: title },
            body: { type: 'text', value: plainTextToDocJson(text) },
          },
        },
        {
          op: 'createEdge',
          from: next.node,
          to: args.grewFrom,
          label: GREW_FROM_LABEL,
        },
      ]
      let message = `grow note "${title}" from ${args.grewFrom}`
      let follows: boolean | undefined

      // 02.5 SC2: the spot the agent asked for, resolved against the tree as
      // it is now plus the new note's own grew-from edge, so near its parent
      // it follows exactly where it will be drawn (D-01, D-06). Anchors are
      // looked up only in this tree (D-12). Nothing is written on a refusal.
      if (where !== undefined) {
        const subject = { id: next.node, type: NATIVE_NOTE_TYPE, props: {} }
        const edges = [
          ...bridge.getEdges(),
          { id: next.edge, from: next.node, to: args.grewFrom, label: GREW_FROM_LABEL },
        ]
        const outcome = resolveWhere({ nodes: bridge.getNodes(), edges }, subject, where)
        if (!outcome.ok) return { ok: false, error: whereRefusalText(outcome, next.node, tree.name) }
        if (!Number.isFinite(outcome.x) || !Number.isFinite(outcome.y)) {
          return { ok: false, error: `no finite spot for ${next.node} in ${tree.name}` }
        }

        // The createNode op above, with the resolved spot in place of the default.
        const props = ops[0].props as NodeData['props']
        props['position.x'] = { type: 'real', value: outcome.x }
        props['position.y'] = { type: 'real', value: outcome.y }
        if (outcome.follows) props['pinned'] = { type: 'bool', value: false }
        message +=
          'beyond' in where ? `, placed beyond ${where.beyond} from ${where.from}` : `, placed near ${where.near}`
        follows = outcome.follows
      }

      const result = bridge.submitAs(actor, message, ops)

      // The edge was written against a predicted id. If the kernel issued a
      // different one the edge points at the wrong note, so say so rather than
      // reporting a success whose connection is wrong.
      if (result.nodeIds[0] !== next.node) {
        return {
          ok: false,
          error: `Expected the new note to be ${next.node} but the kernel issued ${result.nodeIds[0]}`,
        }
      }

      this.hooks.onCommitted?.(tree.id, actor, result)

      return {
        ok: true,
        value: {
          tree: tree.id,
          note: next.node,
          edge: result.edgeIds[0],
          seq: result.seq,
          ...(follows === undefined ? {} : { follows }),
        },
      }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }

  /**
   * Read a note: its text, who wrote it, and what it connects to.
   *
   * `author` is the actor on the commit that created the node, read from the
   * history index (Plan 02). It is not a property on the node, so it is not
   * something a writer could have set about itself (HIST-08). It is also the
   * note's default lock owner (02.4 D-04).
   */
  readNote(args: { tree: string; note: string }): CommandResult<{
    tree: string
    treeName: string
    note: string
    type: string
    title: string
    text: string
    author: string | null
    lastChangedBy: string | null
    connections: Array<{ edge: string; label: string; direction: 'out' | 'in'; other: string }>
  }> {
    let tree: OpenTree
    try {
      tree = this.registry.resolveRef(args.tree)
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }

    const { bridge } = tree
    const notFound = `${String(args.note)} is not a live note in ${tree.name}`

    if (typeof args.note !== 'string' || !NODE_ID_RE.test(args.note)) {
      return { ok: false, error: notFound }
    }

    try {
      const node = bridge.getNode(args.note)
      if (!node) return { ok: false, error: notFound }

      const entry = bridge.getHistoryIndex().nodes[args.note]

      const connections = bridge
        .getEdges()
        .filter((edge) => edge.from === args.note || edge.to === args.note)
        .map((edge) => {
          const outgoing = edge.from === args.note
          return {
            edge: edge.id,
            label: edge.label,
            direction: outgoing ? ('out' as const) : ('in' as const),
            other: outgoing ? edge.to : edge.from,
          }
        })

      return {
        ok: true,
        value: {
          tree: tree.id,
          treeName: tree.name,
          note: args.note,
          type: node.type,
          title: String(node.props['title']?.value ?? ''),
          text: docJsonToPlainText(String(node.props['body']?.value ?? '')),
          author: entry ? entry.createdBy.id : null,
          lastChangedBy: entry ? entry.changedBy.id : null,
          connections,
        },
      }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }

  /** The trees currently open, so an agent can name one in a later call. */
  listTrees(): CommandResult<Array<{ id: string; name: string; kind: TreeKind; path: string }>> {
    try {
      return {
        ok: true,
        value: this.registry.list().map((tree) => ({
          id: tree.id,
          name: tree.name,
          kind: tree.kind,
          path: tree.path,
        })),
      }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }

  /**
   * Search titles and text across the open trees, or one named tree.
   *
   * Read-only, and deliberately unrestricted: locks gate changes, never
   * reading, so an agent may read any note (02.4 D-01). Nothing is committed, so no actor is needed.
   */
  searchNotes(args: { tree?: string; query: string; limit?: number }): CommandResult<
    Array<{ tree: string; treeName: string; note: string; title: string; snippet: string }>
  > {
    if (typeof args.query !== 'string' || args.query.trim().length === 0) {
      return { ok: false, error: 'query must not be empty' }
    }
    const query = args.query.trim()

    let limit = DEFAULT_SEARCH_LIMIT
    if (args.limit !== undefined) {
      if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > MAX_SEARCH_LIMIT) {
        return {
          ok: false,
          error: `limit must be a whole number from 1 to ${MAX_SEARCH_LIMIT}`,
        }
      }
      limit = args.limit
    }

    let trees: OpenTree[]
    try {
      trees = args.tree === undefined ? this.registry.list() : [this.registry.resolveRef(args.tree)]
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }

    const needle = query.toLowerCase()
    const results: Array<{
      tree: string
      treeName: string
      note: string
      title: string
      snippet: string
    }> = []

    try {
      for (const openTree of trees) {
        for (const node of openTree.bridge.getNodes()) {
          if (results.length >= limit) return { ok: true, value: results }

          const title = String(node.props['title']?.value ?? '')
          const text = docJsonToPlainText(String(node.props['body']?.value ?? ''))
          const matches =
            title.toLowerCase().includes(needle) || text.toLowerCase().includes(needle)
          if (!matches) continue

          results.push({
            tree: openTree.id,
            treeName: openTree.name,
            note: node.id,
            title,
            snippet: snippetAround(text, query),
          })
        }
      }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }

    return { ok: true, value: results }
  }

  /**
   * Replace a note's text.
   *
   * An agent is refused when the note's `text` aspect is locked against it
   * (02.4 D-01, D-08); people and non-agent plugins are not checked (D-10).
   * The lock rule lives in locks.ts.
   */
  updateNote(
    actor: Actor,
    args: { tree: string; note: string; text: string },
  ): CommandResult<{ tree: string; note: string; seq: number }> {
    const textResult = validateText(args.text)
    if (!textResult.ok) return textResult

    return this.writeToNote(actor, args.tree, args.note, 'text', (tree) => ({
      message: `update note ${args.note}`,
      ops: [
        {
          op: 'setProperty',
          target: args.note,
          key: 'body',
          type: 'text',
          value: plainTextToDocJson(textResult.value),
        },
      ],
      tree,
    }))
  }

  /**
   * Retitle a note.
   *
   * A title is part of what the note says, so rename checks the note's `text`
   * aspect, the same lock as updateNote (02.4 D-03). See locks.ts.
   */
  renameNote(
    actor: Actor,
    args: { tree: string; note: string; title: string },
  ): CommandResult<{ tree: string; note: string; seq: number }> {
    const titleResult = validateTitle(args.title)
    if (!titleResult.ok) return titleResult

    return this.writeToNote(actor, args.tree, args.note, 'text', (tree) => ({
      message: `rename note ${args.note} to "${titleResult.value}"`,
      ops: [
        {
          op: 'setProperty',
          target: args.note,
          key: 'title',
          type: 'text',
          value: titleResult.value,
        },
      ],
      tree,
    }))
  }

  /**
   * Delete a note.
   *
   * An agent is refused when the note's `delete` aspect is locked against it
   * (02.4 D-02). For a note no agent created, whether that aspect starts locked
   * follows NON_AGENT_NOTES_DELETE_LOCKED in locks.ts (02.4 D-05).
   *
   * The note leaves the world but not the history: the journal is append-only,
   * so the commits that created and changed it remain readable.
   */
  deleteNote(
    actor: Actor,
    args: { tree: string; note: string },
  ): CommandResult<{ tree: string; note: string; seq: number }> {
    return this.writeToNote(actor, args.tree, args.note, 'delete', (tree) => ({
      message: `delete note ${args.note}`,
      ops: [{ op: 'deleteNode', id: args.note }],
      tree,
    }))
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The shared shape of an agent-reachable note change: resolve, reconcile a
   * rewound tree, check the lock on `aspect`, then commit.
   *
   * The lock is checked **after** the tree is returned to its latest state,
   * so the answer comes from the world the commit will actually be appended
   * to rather than from a rewound view of it (02.4 D-11). A refusal returns
   * before anything is built or submitted, so it writes nothing.
   */
  private writeToNote(
    actor: Actor,
    treeRef: string,
    noteId: string,
    aspect: LockAspect,
    build: (tree: OpenTree) => { message: string; ops: OpObject[]; tree: OpenTree },
  ): CommandResult<{ tree: string; note: string; seq: number }> {
    let tree: OpenTree
    try {
      tree = this.registry.resolveRef(treeRef)
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }

    try {
      this.prepareWrite(tree, actor)

      const refusal = this.assertMayWrite(tree, noteId, actor, aspect)
      if (refusal) return { ok: false, error: refusal }

      const { message, ops } = build(tree)
      const result = tree.bridge.submitAs(actor, message, ops)
      this.hooks.onCommitted?.(tree.id, actor, result)

      return { ok: true, value: { tree: tree.id, note: noteId, seq: result.seq } }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }

  /**
   * Whether `actor` may change `aspect` of `noteId` (02.4 D-01, D-10).
   *
   * A note that is not live is refused as such (D-13). People and non-agent
   * plugins are not checked. For an agent, the lock is resolved from the
   * note's properties and from its creator, which is the `actor` line of the
   * commit that created it, read through the history index. There is no
   * created-by property, so the default lock owner is a fact recorded on disk
   * rather than a claim a writer could make about itself (HIST-08, D-04).
   *
   * Returns the refusal message, or null when the write may proceed.
   */
  private assertMayWrite(
    tree: OpenTree,
    noteId: string,
    actor: Actor,
    aspect: LockAspect,
  ): string | null {
    const notLive = `${String(noteId)} is not a live note in ${tree.name}`

    if (typeof noteId !== 'string' || !NODE_ID_RE.test(noteId)) return notLive
    const node = tree.bridge.getNode(noteId)
    if (!node) return notLive

    if (!isAgentActor(actor)) return null

    const entry = tree.bridge.getHistoryIndex().nodes[noteId]
    if (!entry) return notLive

    return checkLock(noteId, node.props, entry.createdBy, actor, aspect)
  }

  /** See prepareWriteFor: this is the same rule, bound to these hooks. */
  private prepareWrite(tree: OpenTree, actor: Actor): void {
    prepareWriteFor(tree, actor, this.hooks)
  }
}
