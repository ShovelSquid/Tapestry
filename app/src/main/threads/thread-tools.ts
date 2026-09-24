/**
 * The five MCP thread tools (D-20..D-24): an agent's reach into a shared
 * thread.
 *
 * `THREAD_TOOL_DEFINITIONS` and `runThreadTool` slot into the exact same
 * dispatch contract `agent-tools.ts`'s `runAgentTool` already uses for the
 * base note/connection tools: a `.strict()` zod schema per tool, re-parsed
 * here regardless of anything the shim already checked (D-06: the shim is
 * never trusted), and no schema has an actor field — the caller supplies no
 * actor at all. The actor is the one `runAgentTool` resolved from the
 * agent's socket token before this module is ever reached.
 *
 * **D-22 is enforced in `ThreadService.applyAgentEdit`, not here.** Every
 * write this module performs — append, insert, replace, delete — resolves
 * its target range as plain text/positions (`ThreadService.readFlatText`)
 * and hands the actual edit to `ThreadService`, which is the one place
 * holding the `LetterIndex` a delete/replace is checked against. A refusal
 * there commits nothing: this module never touches the kernel directly.
 *
 * This file imports every main-process type it needs (`Actor`,
 * `ThreadService`, `TreeRegistry`, `OpenTree`, `NoteCommands`) as
 * **type-only**, so its only runtime import is `zod` — exactly as pure as
 * `agent-tools.ts`'s own existing imports from `./connections`. That keeps
 * this module safe to fold into the MCP tool list the stdio shim bundle
 * advertises (`mcp/tools.ts`) without pulling electron, the kernel bridge or
 * the native addon into that bundle.
 */

import * as z from 'zod'
import type { Actor } from '../commands/actor'
import type { CommandResult } from '../commands/notes'
import type { NoteCommands } from '../commands/notes'
import type { OpObject } from '../kernel-bridge'
import type { OpenTree, TreeRegistry } from '../trees/registry'
import type { LetterIndex } from '../../shared/threads/letters'
import type { FlatDocText, ThreadService } from './thread-service'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Mirrors `ThreadCard.tsx`'s `THREAD_TYPE` (app/src/renderer/threads/ThreadCard.tsx).
 * Duplicated as a bare string, never imported, so this module never reaches
 * into renderer/React code. */
export const THREAD_NODE_TYPE = 'tapestry.threads/thread@1'

/** The edge label D-24 threads share with D-04 notes (`commands/notes.ts`'s
 * `GREW_FROM_LABEL`); duplicated as a literal for the same reason. */
const GREW_FROM_LABEL = 'grew-from'

/** Node ids the kernel issues: `n1`, `n2`, ... (never `n0`). */
const NODE_ID_RE = /^n[1-9][0-9]*$/

/** Fallback card width when a note has never been resized (mirrors
 * `commands/notes.ts`'s own private constant of the same name). */
const DEFAULT_NOTE_WIDTH = 280

/** Horizontal gap between a parent note and the thread grown from it. */
const CHILD_GAP = 80

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function numericProp(node: { props: Record<string, { value: unknown } | undefined> }, key: string, fallback: number): number {
  const prop = node.props[key]
  if (!prop) return fallback
  const value = Number(prop.value)
  return Number.isFinite(value) ? value : fallback
}

// ---------------------------------------------------------------------------
// Argument schemas (D-06: no actor field, every schema `.strict()`)
// ---------------------------------------------------------------------------

export const AppendToThreadArgs = z
  .object({
    tree: z.string().min(1).max(200),
    thread: z.string().min(1).max(1024),
    text: z.string().min(1).max(1000000),
  })
  .strict()

export const InsertIntoThreadArgs = z
  .object({
    tree: z.string().min(1).max(200),
    thread: z.string().min(1).max(1024),
    after: z.string().min(1).max(10000).optional(),
    at: z.enum(['start', 'end']).optional(),
    text: z.string().min(1).max(1000000),
  })
  .strict()
  .refine((v) => (v.after !== undefined) !== (v.at !== undefined), {
    message: 'insert_into_thread requires exactly one of after or at',
  })

export const ReplaceInThreadArgs = z
  .object({
    tree: z.string().min(1).max(200),
    thread: z.string().min(1).max(1024),
    quote: z.string().min(1).max(10000),
    text: z.string().max(1000000),
  })
  .strict()

export const DeleteFromThreadArgs = z
  .object({
    tree: z.string().min(1).max(200),
    thread: z.string().min(1).max(1024),
    quote: z.string().min(1).max(10000),
  })
  .strict()

export const CreateThreadArgs = z
  .object({
    tree: z.string().min(1).max(200),
    grewFrom: z.string().min(1).max(1024),
    title: z.string().min(1).max(200),
    text: z.string().max(1000000).optional(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Tool table (mirrors mcp/schemas.ts's ToolDefinition shape structurally, so
// mcp/tools.ts can spread these into the array it hands the MCP server
// without this module importing anything from mcp/schemas.ts at all)
// ---------------------------------------------------------------------------

export interface ThreadToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ThreadToolDefinition {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly schema: z.ZodType
  readonly annotations: ThreadToolAnnotations
}

export const THREAD_TOOL_DEFINITIONS: readonly ThreadToolDefinition[] = Object.freeze([
  {
    name: 'append_to_thread',
    title: 'Append text to a thread',
    description:
      'Adds text at the end of a thread\'s document, landing as one cluster at the moment this call arrives (never replayed as fake typing). Repeated calls are streaming: each lands separately, at its own arrival time.',
    schema: AppendToThreadArgs,
    annotations: {},
  },
  {
    name: 'insert_into_thread',
    title: 'Insert text into a thread at a specific point',
    description:
      'Inserts text either right after an exact quote from the thread (after), or at the very start or end of the document (at). The quote must match exactly once; if it matches zero or several times, nothing is written.',
    schema: InsertIntoThreadArgs,
    annotations: {},
  },
  {
    name: 'replace_in_thread',
    title: 'Replace an exact quote in a thread you wrote',
    description:
      'Replaces an exact quote with new text. Refused unless every letter in the quote was written by you; the quote must also match exactly once. A refusal writes nothing.',
    schema: ReplaceInThreadArgs,
    annotations: { destructiveHint: false },
  },
  {
    name: 'delete_from_thread',
    title: 'Delete an exact quote you wrote from a thread',
    description:
      'Deletes an exact quote. Refused unless every letter in the quote was written by you; the quote must also match exactly once. A refusal writes nothing, and the letters stay exactly as they were.',
    schema: DeleteFromThreadArgs,
    annotations: { destructiveHint: true },
  },
  {
    name: 'create_thread',
    title: 'Start a thread grown from an existing note',
    description:
      'Creates a new thread connected to grewFrom in one commit. Every thread you start must grow from a note that already exists; a thread with no origin note is refused.',
    schema: CreateThreadArgs,
    annotations: {},
  },
])

// ---------------------------------------------------------------------------
// Per-agent rate limit (T-02.3-08-05): a sliding window on top of
// ThreadService's own idle/max-wait coalescing, so a flood of calls is
// refused (nothing committed) rather than merely coalesced into fewer, but
// still unbounded, commits.
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX_CALLS = 20
const RATE_LIMIT_WINDOW_MS = 1000

const callTimestampsByActor = new Map<string, number[]>()

function checkRateLimit(actorId: string, nowMs: number): string | null {
  const recent = (callTimestampsByActor.get(actorId) ?? []).filter((t) => nowMs - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX_CALLS) {
    callTimestampsByActor.set(actorId, recent)
    return `${actorId} is writing to threads too quickly; wait a moment and try again`
  }
  recent.push(nowMs)
  callTimestampsByActor.set(actorId, recent)
  return null
}

/** Test-only: the rate limiter is module-level state, shared across every
 * call in this process, so a test suite exercising many calls for the same
 * actor id needs a way to start clean. */
export function _resetThreadToolRateLimiterForTests(): void {
  callTimestampsByActor.clear()
}

// ---------------------------------------------------------------------------
// Quote / anchor resolution (plain text + positions only)
// ---------------------------------------------------------------------------

function findQuoteRange(flat: FlatDocText, quote: string): { from: number; to: number } | { error: string } {
  if (quote.length === 0) return { error: 'quote must not be empty' }
  const first = flat.text.indexOf(quote)
  if (first === -1) return { error: 'No text in the thread matches the given quote' }
  const second = flat.text.indexOf(quote, first + 1)
  if (second !== -1) {
    return { error: 'The quote matches more than once in the thread; make it more specific' }
  }
  const from = flat.positions[first]
  const lastCharIndex = first + quote.length - 1
  const to = flat.positions[lastCharIndex] + 1
  return { from, to }
}

/**
 * D-22, checked directly against the `LetterIndex`'s own public read API —
 * every letter `lettersIn` finds in `[from, to)` must be `authorOf` this
 * actor, or the whole call is refused before `applyAgentEdit` is ever asked
 * to touch the document. `ThreadService.applyAgentEdit` checks the identical
 * invariant again itself (the actual security boundary, never bypassable by
 * skipping this function) — this is the specific, per-letter refusal reason
 * a caller sees, resolved from the same authoritative index.
 */
function assertRangeAuthoredBy(letterIndex: LetterIndex, from: number, to: number, actorId: string): string | null {
  if (to <= from) return null
  for (const letterId of letterIndex.lettersIn(from, to)) {
    const author = letterIndex.authorOf(letterId)
    if (author !== actorId) {
      return `${actorId} may only delete or replace letters it wrote; a letter in range was written by ${author ?? 'someone else'}`
    }
  }
  return null
}

function resolveInsertAnchor(
  flat: FlatDocText,
  anchor: { after?: string; at?: 'start' | 'end' },
): { pos: number } | { error: string } {
  if (anchor.at === 'start') return { pos: flat.startPos }
  if (anchor.at === 'end') return { pos: flat.endPos }
  if (anchor.after !== undefined) {
    const range = findQuoteRange(flat, anchor.after)
    if ('error' in range) return range
    return { pos: range.to }
  }
  return { error: 'insert_into_thread requires after or at' }
}

// ---------------------------------------------------------------------------
// Thread resolution: a live thread node in a named tree
// ---------------------------------------------------------------------------

function resolveThread(
  registry: TreeRegistry,
  treeRef: string,
  threadRef: string,
): { tree: OpenTree; nodeId: string } | { error: string } {
  let tree: OpenTree
  try {
    tree = registry.resolveRef(treeRef)
  } catch (err) {
    return { error: errorMessage(err) }
  }

  const notFound = `${String(threadRef)} is not a live thread in ${tree.name}`
  if (typeof threadRef !== 'string' || !NODE_ID_RE.test(threadRef)) {
    return { error: notFound }
  }
  const node = tree.bridge.getNode(threadRef)
  if (!node || node.type !== THREAD_NODE_TYPE) {
    return { error: notFound }
  }
  return { tree, nodeId: threadRef }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export interface ThreadToolCommands {
  registry: TreeRegistry
  threadService: ThreadService
  /** Reused only for `create_thread`'s D-04-shaped "grow from a live note"
   * check pattern; the actual node/edge creation happens directly against
   * the resolved tree's bridge, the identical shape `NoteCommands.createFrom`
   * uses. */
  notes: NoteCommands
}

type AppendArgs = z.infer<typeof AppendToThreadArgs>
type InsertArgs = z.infer<typeof InsertIntoThreadArgs>
type ReplaceArgs = z.infer<typeof ReplaceInThreadArgs>
type DeleteArgs = z.infer<typeof DeleteFromThreadArgs>
type CreateArgs = z.infer<typeof CreateThreadArgs>

function appendToThread(
  cmds: ThreadToolCommands,
  actor: Actor,
  args: AppendArgs,
): CommandResult<{ tree: string; thread: string }> {
  const resolved = resolveThread(cmds.registry, args.tree, args.thread)
  if ('error' in resolved) return { ok: false, error: resolved.error }

  const rateLimitError = checkRateLimit(actor.id, Date.now())
  if (rateLimitError) return { ok: false, error: rateLimitError }

  const flat = cmds.threadService.readFlatText(resolved.tree.bridge, actor, resolved.tree.id, resolved.nodeId)
  if ('error' in flat) return { ok: false, error: flat.error }

  const result = cmds.threadService.applyAgentEdit(resolved.tree.bridge, actor, resolved.tree.id, resolved.nodeId, {
    from: flat.endPos,
    to: flat.endPos,
    insertText: args.text,
  })
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, value: { tree: resolved.tree.id, thread: resolved.nodeId } }
}

function insertIntoThread(
  cmds: ThreadToolCommands,
  actor: Actor,
  args: InsertArgs,
): CommandResult<{ tree: string; thread: string }> {
  const resolved = resolveThread(cmds.registry, args.tree, args.thread)
  if ('error' in resolved) return { ok: false, error: resolved.error }

  const rateLimitError = checkRateLimit(actor.id, Date.now())
  if (rateLimitError) return { ok: false, error: rateLimitError }

  const flat = cmds.threadService.readFlatText(resolved.tree.bridge, actor, resolved.tree.id, resolved.nodeId)
  if ('error' in flat) return { ok: false, error: flat.error }

  const anchor = resolveInsertAnchor(flat, { after: args.after, at: args.at })
  if ('error' in anchor) return { ok: false, error: anchor.error }

  const result = cmds.threadService.applyAgentEdit(resolved.tree.bridge, actor, resolved.tree.id, resolved.nodeId, {
    from: anchor.pos,
    to: anchor.pos,
    insertText: args.text,
  })
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, value: { tree: resolved.tree.id, thread: resolved.nodeId } }
}

function replaceInThread(
  cmds: ThreadToolCommands,
  actor: Actor,
  args: ReplaceArgs,
): CommandResult<{ tree: string; thread: string }> {
  const resolved = resolveThread(cmds.registry, args.tree, args.thread)
  if ('error' in resolved) return { ok: false, error: resolved.error }

  const rateLimitError = checkRateLimit(actor.id, Date.now())
  if (rateLimitError) return { ok: false, error: rateLimitError }

  const flat = cmds.threadService.readFlatText(resolved.tree.bridge, actor, resolved.tree.id, resolved.nodeId)
  if ('error' in flat) return { ok: false, error: flat.error }

  const range = findQuoteRange(flat, args.quote)
  if ('error' in range) return { ok: false, error: range.error }

  // D-22: every letter in the replaced range must already be this actor's
  // own, checked directly against the LetterIndex before applyAgentEdit is
  // ever asked to touch the document — never from anything args carries.
  const letterIndex = cmds.threadService.getLetterIndex(resolved.tree.bridge, actor, resolved.tree.id, resolved.nodeId)
  if ('error' in letterIndex) return { ok: false, error: letterIndex.error }
  const refusal = assertRangeAuthoredBy(letterIndex, range.from, range.to, actor.id)
  if (refusal) return { ok: false, error: refusal }

  const result = cmds.threadService.applyAgentEdit(resolved.tree.bridge, actor, resolved.tree.id, resolved.nodeId, {
    from: range.from,
    to: range.to,
    insertText: args.text,
  })
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, value: { tree: resolved.tree.id, thread: resolved.nodeId } }
}

function deleteFromThread(
  cmds: ThreadToolCommands,
  actor: Actor,
  args: DeleteArgs,
): CommandResult<{ tree: string; thread: string }> {
  const resolved = resolveThread(cmds.registry, args.tree, args.thread)
  if ('error' in resolved) return { ok: false, error: resolved.error }

  const rateLimitError = checkRateLimit(actor.id, Date.now())
  if (rateLimitError) return { ok: false, error: rateLimitError }

  const flat = cmds.threadService.readFlatText(resolved.tree.bridge, actor, resolved.tree.id, resolved.nodeId)
  if ('error' in flat) return { ok: false, error: flat.error }

  const range = findQuoteRange(flat, args.quote)
  if ('error' in range) return { ok: false, error: range.error }

  // D-22: same authorship check as replace_in_thread, resolved from the
  // LetterIndex before any step is constructed.
  const letterIndex = cmds.threadService.getLetterIndex(resolved.tree.bridge, actor, resolved.tree.id, resolved.nodeId)
  if ('error' in letterIndex) return { ok: false, error: letterIndex.error }
  const refusal = assertRangeAuthoredBy(letterIndex, range.from, range.to, actor.id)
  if (refusal) return { ok: false, error: refusal }

  const result = cmds.threadService.applyAgentEdit(resolved.tree.bridge, actor, resolved.tree.id, resolved.nodeId, {
    from: range.from,
    to: range.to,
    insertText: '',
  })
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, value: { tree: resolved.tree.id, thread: resolved.nodeId } }
}

function createThread(
  cmds: ThreadToolCommands,
  actor: Actor,
  args: CreateArgs,
): CommandResult<{ tree: string; thread: string; edge: string }> {
  let tree: OpenTree
  try {
    tree = cmds.registry.resolveRef(args.tree)
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }

  const title = args.title.trim()
  if (title.length === 0) return { ok: false, error: 'title must not be empty' }

  // D-24: grewFrom must name a live node in this tree, checked against the
  // world, not against the argument's shape. A thread with no origin note
  // is refused, so an agent thread is never loose.
  if (typeof args.grewFrom !== 'string' || !NODE_ID_RE.test(args.grewFrom)) {
    return { ok: false, error: `grewFrom ${String(args.grewFrom)} is not a live note in ${tree.name}` }
  }
  const parent = tree.bridge.getNode(args.grewFrom)
  if (!parent) {
    return { ok: false, error: `grewFrom ${args.grewFrom} is not a live note in ${tree.name}` }
  }

  const rateLimitError = checkRateLimit(actor.id, Date.now())
  if (rateLimitError) return { ok: false, error: rateLimitError }

  const parentX = numericProp(parent, 'position.x', 0)
  const parentY = numericProp(parent, 'position.y', 0)
  const parentWidth = numericProp(parent, 'width', DEFAULT_NOTE_WIDTH)
  const cardX = parentX + parentWidth + CHILD_GAP

  const next = tree.bridge.getNextIds()

  const ops: OpObject[] = [
    {
      op: 'createNode',
      type: THREAD_NODE_TYPE,
      props: {
        'position.x': { type: 'real', value: cardX },
        'position.y': { type: 'real', value: parentY },
        'thread.origin.x': { type: 'real', value: cardX },
        'thread.origin.y': { type: 'real', value: parentY },
        'thread.origin.z': { type: 'real', value: 0 },
        'thread.direction.x': { type: 'real', value: 0 },
        'thread.direction.y': { type: 'real', value: 0 },
        'thread.direction.z': { type: 'real', value: -1 },
        'thread.roll': { type: 'real', value: 0 },
        title: { type: 'text', value: title },
        body: { type: 'text', value: '' },
      },
    },
    {
      op: 'createEdge',
      from: next.node,
      to: args.grewFrom,
      label: GREW_FROM_LABEL,
    },
  ]

  let result
  try {
    result = tree.bridge.submitAs(actor, `create thread "${title}" grown from ${args.grewFrom}`, ops)
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }

  if (result.nodeIds[0] !== next.node) {
    return {
      ok: false,
      error: `Expected the new thread to be ${next.node} but the kernel issued ${result.nodeIds[0]}`,
    }
  }
  const threadNodeId = result.nodeIds[0]
  const edgeId = result.edgeIds[0]

  if (args.text !== undefined && args.text.length > 0) {
    // Seed the thread's own log with its first commit, exactly like
    // append_to_thread — a thread's content is always keystroke-shaped
    // history (D-06), never a checkpoint with no log entry behind it.
    const flat = cmds.threadService.readFlatText(tree.bridge, actor, tree.id, threadNodeId)
    if (!('error' in flat)) {
      cmds.threadService.applyAgentEdit(tree.bridge, actor, tree.id, threadNodeId, {
        from: flat.endPos,
        to: flat.endPos,
        insertText: args.text,
      })
    }
  }

  return { ok: true, value: { tree: tree.id, thread: threadNodeId, edge: edgeId } }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function zodMessage(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => {
      const path = issue.path.map((p) => String(p)).join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/**
 * Runs one thread tool for `actor`, or refuses it. Never throws, matching
 * `runAgentTool`'s own contract, and never reads an actor or author field
 * from `args` — the actor is always the parameter, supplied by the host.
 */
export function runThreadTool(
  commands: ThreadToolCommands,
  actor: Actor,
  tool: string,
  args: unknown,
): CommandResult<unknown> {
  const definition = THREAD_TOOL_DEFINITIONS.find((d) => d.name === tool)
  if (!definition) {
    return { ok: false, error: `Unknown tool: ${tool}` }
  }

  const parsed = definition.schema.safeParse(args)
  if (!parsed.success) {
    return { ok: false, error: zodMessage(parsed.error.issues) }
  }

  switch (tool) {
    case 'append_to_thread':
      return appendToThread(commands, actor, parsed.data as AppendArgs)
    case 'insert_into_thread':
      return insertIntoThread(commands, actor, parsed.data as InsertArgs)
    case 'replace_in_thread':
      return replaceInThread(commands, actor, parsed.data as ReplaceArgs)
    case 'delete_from_thread':
      return deleteFromThread(commands, actor, parsed.data as DeleteArgs)
    case 'create_thread':
      return createThread(commands, actor, parsed.data as CreateArgs)
    default:
      return { ok: false, error: `Unknown tool: ${tool}` }
  }
}
